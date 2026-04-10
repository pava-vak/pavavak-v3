const { z } = require('zod');
const { env } = require('../../config/env');
const { requireAuth } = require('../../shared/security/auth.preHandler');
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

const refreshSchema = z.object({
  refreshToken: z.string().min(1)
});

function registerAuthRoutes(app) {
  app.get('/api/v3/auth/health', async () => ({
    success: true,
    module: 'auth',
    mode: 'token',
    status: 'ready_for_client_integration'
  }));

  app.post('/api/v3/auth/dev-login', async (request, reply) => {
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

    const user = parsed.data;
    const [accessToken, refreshToken] = await Promise.all([
      signAccessToken(user),
      signRefreshToken(user)
    ]);

    return {
      success: true,
      tokens: {
        accessToken,
        refreshToken,
        tokenType: 'Bearer'
      },
      user
    };
  });

  app.post('/api/v3/auth/refresh', async (request, reply) => {
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
      const user = {
        userId: Number(claims.sub),
        username: claims.username,
        displayName: claims.username,
        isAdmin: false
      };

      const [accessToken, refreshToken] = await Promise.all([
        signAccessToken(user),
        signRefreshToken(user)
      ]);

      return {
        success: true,
        tokens: {
          accessToken,
          refreshToken,
          tokenType: 'Bearer'
        }
      };
    } catch {
      return reply.status(401).send({
        success: false,
        error: 'Invalid refresh token'
      });
    }
  });

  app.get('/api/v3/me', { preHandler: requireAuth }, async (request) => ({
    success: true,
    user: request.auth
  }));
}

module.exports = { registerAuthRoutes };
