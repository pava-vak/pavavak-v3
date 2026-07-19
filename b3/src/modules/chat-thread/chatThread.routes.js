const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { listMessagesForChat } = require('./chatThread.service');
const chatAdapter = require('../../db/chatAdapter');

const threadQuerySchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20)
});

function registerChatThreadRoutes(app) {
  app.get('/api/v3/chats/:chatId/messages', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = threadQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid query parameters',
        details: parsed.error.flatten()
      });
    }

    const hasAccess = await chatAdapter.userHasAccess(request.auth, request.params.chatId);
    if (!hasAccess) {
      return reply.status(404).send({
        success: false,
        error: 'Chat not found'
      });
    }

    const result = await listMessagesForChat({
      user: request.auth,
      chatId: request.params.chatId,
      cursor: parsed.data.cursor || null,
      limit: parsed.data.limit
    });

    return {
      success: true,
      chatId: request.params.chatId,
      items: result.items,
      page: {
        nextCursor: result.nextCursor,
        hasMore: result.hasMore
      }
    };
  });
}

module.exports = { registerChatThreadRoutes };
