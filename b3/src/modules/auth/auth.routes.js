const rateLimit = require('@fastify/rate-limit');
const { z } = require('zod');
const { env } = require('../../config/env');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const identity = require('../../db/identityAdapter');
const { hashPassword, verifyPassword, needsRehash } = require('../../shared/security/password.service');
const { createLoginThrottle } = require('../../shared/security/loginThrottle');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} = require('../../shared/security/token.service');
const sessions = require('./sessions.repository');

const devLoginSchema = z.object({
  userId: z.coerce.number().int().positive(),
  username: z.string().min(1),
  displayName: z.string().min(1),
  isAdmin: z.boolean().optional().default(false)
});

const usernameSchema = z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/);
const passwordSchema = z.string().min(8).max(128);

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: passwordSchema
});

const registerSchema = z.object({
  username: usernameSchema,
  displayName: z.string().trim().min(1).max(80),
  password: passwordSchema
});

const loginSchema = z.object({
  username: z.string().trim().min(1),
  password: z.string().min(1)
});

const refreshSchema = z.object({
  refreshToken: z.string().min(1).optional() // optional — prefer HttpOnly cookie
});

const REFRESH_COOKIE = 'pava_refresh';
const COOKIE_OPTS = {
  httpOnly: true,
  sameSite: 'lax',
  path: '/api/v3/auth',
  maxAge: 30 * 24 * 60 * 60, // 30 days in seconds
  // secure is set dynamically — true in production, false in dev so localhost works without HTTPS
};

async function issueSession(user, reply, { userAgent = '', ip = '', sessionId = null } = {}) {
  const publicUser = identity.publicUser(user);
  const sessionUser = {
    ...publicUser,
    tokenVersion: Number(user.tokenVersion || 0)
  };

  let sid = sessionId;
  if (!sid && sessions.isAvailable()) {
    sid = await sessions.createSession(user.userId, { userAgent, ip });
  }

  const refreshPayload = sid ? { ...sessionUser, sid } : sessionUser;
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(sessionUser),
    signRefreshToken(refreshPayload)
  ]);

  const secure = env.APP_ENV === 'production';
  reply.setCookie(REFRESH_COOKIE, refreshToken, { ...COOKIE_OPTS, secure });

  return {
    success: true,
    tokens: {
      accessToken,
      tokenType: 'Bearer'
    },
    user: publicUser,
    ...(sid ? { sessionId: sid } : {})
  };
}

function sendCaughtError(request, reply, error, fallbackMessage) {
  const status = error.status || 500;
  if (status >= 500) {
    request.log.error({ err: error }, fallbackMessage);
  }
  return reply.status(status).send({
    success: false,
    error: status >= 500 ? 'Internal server error' : (error.message || fallbackMessage)
  });
}

function loginThrottleKeys(ip, username) {
  const safeIp = ip || 'unknown';
  return [`ip:${safeIp}`, `user:${String(username).toLowerCase()}|ip:${safeIp}`];
}

function registerAuthRoutes(app) {
  const loginThrottle = createLoginThrottle();

  app.register(async function authPlugin(fastify) {
    await fastify.register(rateLimit, {
      max: 30,
      timeWindow: '1 minute'
    });

    fastify.get('/api/v3/auth/health', async () => ({
      success: true,
      module: 'auth',
      mode: 'token',
      status: 'ready_for_client_integration'
    }));

    fastify.post('/api/v3/auth/register', async (request, reply) => {
      // Closed by default: accounts are admin-provisioned. Hide the endpoint entirely (404)
      // unless public signup is explicitly enabled, so the API can't be used to self-register.
      if (!env.ALLOW_PUBLIC_REGISTRATION) {
        return reply.status(404).send({ success: false, error: 'Not Found' });
      }
      const parsed = registerSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten()
        });
      }

      try {
        const user = await identity.createUser({
          username: parsed.data.username,
          displayName: parsed.data.displayName,
          passwordHash: await hashPassword(parsed.data.password),
          isAdmin: false
        });
        return issueSession(user, reply);
      } catch (error) {
        const msg = error?.message || '';
        if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already')) {
          return reply.status(409).send({ success: false, error: 'Username already taken' });
        }
        return sendCaughtError(request, reply, error, 'Failed to register');
      }
    });

    fastify.post('/api/v3/auth/login', async (request, reply) => {
      const parsed = loginSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten()
        });
      }

      const throttleKeys = loginThrottleKeys(request.ip, parsed.data.username);
      const throttleStatus = loginThrottle.check(throttleKeys);
      if (throttleStatus.locked) {
        const retryAfterSeconds = Math.ceil(throttleStatus.retryAfterMs / 1000);
        reply.header('Retry-After', String(retryAfterSeconds));
        return reply.status(429).send({
          success: false,
          error: `Too many failed attempts. Try again in ${retryAfterSeconds} seconds.`
        });
      }

      const user = await identity.findByUsername(parsed.data.username);
      if (!user || user.disabled || !(await verifyPassword(parsed.data.password, user.passwordHash))) {
        loginThrottle.recordFailure(throttleKeys);
        return reply.status(401).send({
          success: false,
          error: 'Invalid username or password'
        });
      }

      loginThrottle.reset(throttleKeys);

      // Transparently re-hash PBKDF2 passwords to Argon2id on successful login
      const _loginUa = request.headers['user-agent'] || '';
      const _loginIp = request.ip || '';
      if (needsRehash(user.passwordHash)) {
        identity.setPasswordHash(user.userId, await hashPassword(parsed.data.password)).catch(() => {});
      }

      return issueSession(user, reply, { userAgent: _loginUa, ip: _loginIp });
    });

    fastify.post('/api/v3/auth/dev-login', async (request, reply) => {
      if (env.APP_ENV === 'production') {
        return reply.status(404).send({
          success: false,
          error: 'Not Found'
        });
      }
      if (env.NODE_ENV !== 'development' && !env.ALLOW_DEV_LOGIN) {
        return reply.status(404).send({
          success: false,
          error: 'Not Found'
        });
      }

      const parsed = devLoginSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten()
        });
      }

      const user = await identity.ensureUser(parsed.data);
      return issueSession(user, reply);
    });

    fastify.post('/api/v3/auth/refresh', async (request, reply) => {
      // Cookie takes precedence; body token is accepted for backward compat with older clients
      const tokenFromCookie = request.cookies?.[REFRESH_COOKIE];
      const parsed = refreshSchema.safeParse(request.body || {});
      const tokenFromBody = parsed.success ? parsed.data.refreshToken : undefined;
      const token = tokenFromCookie || tokenFromBody;

      if (!token) {
        return reply.status(401).send({ success: false, error: 'No refresh token' });
      }

      try {
        const claims = await verifyRefreshToken(token);
        const user = await identity.getById(Number(claims.sub));
        if (!user || user.disabled || Number(claims.tv || 0) !== Number(user.tokenVersion || 0)) {
          throw new Error('Invalid refresh token');
        }
        // If session tracking is active, validate the session still exists
        const sid = claims.sid;
        if (sid && sessions.isAvailable()) {
          const sessionRow = await sessions.getSession(sid);
          if (!sessionRow) throw new Error('Invalid refresh token');
          sessions.touchSession(sid).catch(() => {});
        }
        return issueSession(user, reply, {
          userAgent: request.headers['user-agent'] || '',
          ip: request.ip || '',
          sessionId: sid || null
        });
      } catch (error) {
        // JWT library errors have specific names; our manual throw has the exact message.
        // Anything else (DB connectivity, pool errors) should return 503 so the client retries.
        // jose reports bad/expired/forged tokens with ERR_JWS_* / ERR_JWT_* codes (e.g. JWTExpired)
        const jwtErrorNames = ['JsonWebTokenError', 'TokenExpiredError', 'NotBeforeError', 'JWTError'];
        const isTokenError = jwtErrorNames.includes(error?.name)
          || /^ERR_JW[ST]_/.test(error?.code || '')
          || (error?.message === 'Invalid refresh token');
        if (!isTokenError) {
          request.log.error({ err: error }, 'Service error during token refresh');
          return reply.status(503).send({ success: false, error: 'Service temporarily unavailable' });
        }
        return reply.status(401).send({
          success: false,
          error: 'Invalid refresh token'
        });
      }
    });

    fastify.post('/api/v3/auth/logout', { preHandler: requireAuth }, async (request, reply) => {
      try {
        // Delete the current session if session_id was passed
        const sid = request.headers['x-session-id'];
        if (sid && sessions.isAvailable()) {
          await sessions.deleteSession(sid, request.auth.userId).catch(() => {});
        }
        await identity.incrementTokenVersion(request.auth.userId);
        reply.clearCookie(REFRESH_COOKIE, { path: '/api/v3/auth' });
        return { success: true };
      } catch (error) {
        return sendCaughtError(request, reply, error, 'Failed to logout');
      }
    });
  });

  // ── Session management ───────────────────────────────────────────────────────
  app.get('/api/v3/auth/sessions', { preHandler: requireAuth }, async (request) => {
    if (!sessions.isAvailable()) return { success: true, sessions: [] };
    const currentSid = request.headers['x-session-id'] || null;
    const list = await sessions.listSessions(request.auth.userId);
    return {
      success: true,
      sessions: list.map(s => ({ ...s, isCurrent: s.id === currentSid }))
    };
  });

  app.delete('/api/v3/auth/sessions/:id', { preHandler: requireAuth }, async (request, reply) => {
    if (!sessions.isAvailable()) return { success: true };
    const deleted = await sessions.deleteSession(request.params.id, request.auth.userId);
    if (!deleted) return reply.status(404).send({ success: false, error: 'Session not found' });
    return { success: true };
  });

  app.delete('/api/v3/auth/sessions', { preHandler: requireAuth }, async (request, reply) => {
    // Sign out all devices by incrementing tokenVersion and deleting all session records
    if (sessions.isAvailable()) {
      await sessions.deleteAllSessions(request.auth.userId).catch(() => {});
    }
    await identity.incrementTokenVersion(request.auth.userId);
    reply.clearCookie(REFRESH_COOKIE, { path: '/api/v3/auth' });
    return { success: true };
  });

  app.get('/api/v3/me', { preHandler: requireAuth }, async (request) => ({
    success: true,
    user: request.auth
  }));

  app.put('/api/v3/users/me', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({
      displayName: z.string().trim().min(1).max(80)
    }).safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Display name must be 1–80 characters' });
    }
    const user = await identity.updateDisplayName(request.auth.userId, parsed.data.displayName);
    if (!user) return reply.status(404).send({ success: false, error: 'User not found' });
    return { success: true, user };
  });

  app.put('/api/v3/auth/change-password', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.flatten()
      });
    }

    const user = await identity.getByIdWithHash(request.auth.userId);
    if (!user || !(await verifyPassword(parsed.data.currentPassword, user.passwordHash))) {
      return reply.status(401).send({ success: false, error: 'Current password is incorrect' });
    }

    const passwordHash = await hashPassword(parsed.data.newPassword);
    await identity.setPasswordHash(request.auth.userId, passwordHash);
    return { success: true };
  });
}

module.exports = { registerAuthRoutes };
