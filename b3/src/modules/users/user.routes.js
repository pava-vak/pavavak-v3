const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const identity = require('../../db/identityAdapter');
const chatAdapter = require('../../db/chatAdapter');

const searchSchema = z.object({
  q: z.string().trim().max(80).optional().default('')
});

const directSchema = z.object({
  userId: z.coerce.number().int().positive()
});

function registerUserRoutes(app) {
  app.get('/api/v3/users', {
    preHandler: requireAuth,
    config: {
      rateLimit: {
        max: 30,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const parsed = searchSchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid query parameters',
        details: parsed.error.flatten()
      });
    }

    if (parsed.data.q.length < 3) {
      return { success: true, items: [] };
    }

    const items = await identity.listUsers({
      query: parsed.data.q,
      excludeUserId: request.auth.userId,
      limit: 30
    });
    return { success: true, items };
  });

  app.post('/api/v3/chats/direct', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = directSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.flatten()
      });
    }

    try {
      const chat = await chatAdapter.createDirectConversation(request.auth, parsed.data.userId);
      return { success: true, chat };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) {
        request.log.error({ err: error }, 'Failed to start chat');
      }
      return reply.status(status).send({
        success: false,
        error: status >= 500 ? 'Internal server error' : (error.message || 'Failed to start chat')
      });
    }
  });
}

module.exports = { registerUserRoutes };
