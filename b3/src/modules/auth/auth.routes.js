const rateLimit = require('@fastify/rate-limit');
const { z } = require('zod');
const { env } = require('../../config/env');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const identity = require('../../db/identityAdapter');
const { hashPassword, verifyPassword } = require('../../shared/security/password.service');
const { createLoginThrottle } = require('../../shared/security/loginThrottle');
const {
  signAccessToken,
  signRefreshToken,
  verifyRefreshToken
} = require('../../shared/security/token.service');

const devLoginSchema = z.object({
  userId: z.coerce.number().int().positive(),
  username: z.string().min(1),
  displayName: z.string().min(1),
  isAdmin: z.boolean().optional().default(false)
});

const usernameSchema = z.string().trim().min(3).max(32).regex(/^[a-zA-Z0-9_.-]+$/);
const passwordSchema = z.string().min(8).max(128);

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
  refreshToken: z.string().min(1)
});

async function issueSession(user) {
  const publicUser = identity.publicUser(user);
  const sessionUser = {
    ...publicUser,
    tokenVersion: Number(user.tokenVersion || 0)
  };
  const [accessToken, refreshToken] = await Promise.all([
    signAccessToken(sessionUser),
    signRefreshToken(sessionUser)
  ]);

  return {
    success: true,
    tokens: {
      accessToken,
      refreshToken,
      tokenType: 'Bearer'
    },
    user: publicUser
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
        return issueSession(user);
      } catch (error) {
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
      return issueSession(user);
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
      return issueSession(user);
    });

    fastify.post('/api/v3/auth/refresh', async (request, reply) => {
      const parsed = refreshSchema.safeParse(request.body || {});
      if (!parsed.success) {
        return reply.status(400).send({
          success: false,
          error: 'Invalid request body',
          details: parsed.error.flatten()
        });
      }

      try {
        const claims = await verifyRefreshToken(parsed.data.refreshToken);
        const user = await identity.getById(Number(claims.sub));
        if (!user || user.disabled || Number(claims.tv || 0) !== Number(user.tokenVersion || 0)) {
          throw new Error('Invalid refresh token');
        }
        return issueSession(user);
      } catch {
        return reply.status(401).send({
          success: false,
          error: 'Invalid refresh token'
        });
      }
    });

    fastify.post('/api/v3/auth/logout', { preHandler: requireAuth }, async (request, reply) => {
      try {
        await identity.incrementTokenVersion(request.auth.userId);
        return { success: true };
      } catch (error) {
        return sendCaughtError(request, reply, error, 'Failed to logout');
      }
    });
  });

  app.get('/api/v3/me', { preHandler: requireAuth }, async (request) => ({
    success: true,
    user: request.auth
  }));
}

module.exports = { registerAuthRoutes };
