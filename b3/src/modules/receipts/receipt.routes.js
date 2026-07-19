const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { markDelivered, markRead, markChatRead } = require('./receipt.service');
const realtime = require('../../realtime/eventEmitter');

const receiptBodySchema = z.object({
  chatId: z.string().min(1)
});

function registerReceiptRoutes(app) {
  app.post('/api/v3/messages/:messageId/delivered', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const parsed = receiptBodySchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await markDelivered(request.auth, parsed.data.chatId, request.params.messageId);
      const deliveredPayload = { chatId: parsed.data.chatId, messageId: result.messageId, status: result.status };
      console.log('[receipt] emitMessageDelivered → userId=%s payload=%j', result.senderUserId || request.auth.userId, deliveredPayload);
      realtime.emitMessageDelivered(result.senderUserId || request.auth.userId, deliveredPayload);
      return {
        success: true,
        messageId: result.messageId,
        status: result.status
      };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) {
        request.log.error({ err: error }, 'Failed to mark delivered');
      }
      return reply.status(status).send({
        success: false,
        error: status >= 500 ? 'Internal server error' : (error.message || 'Failed to mark delivered')
      });
    }
  });

  app.post('/api/v3/messages/:messageId/read', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const parsed = receiptBodySchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.flatten()
      });
    }

    try {
      const result = await markRead(request.auth, parsed.data.chatId, request.params.messageId);
      realtime.emitMessageRead(result.senderUserId || request.auth.userId, {
        chatId: parsed.data.chatId,
        messageId: result.messageId,
        status: result.status,
        unreadCount: result.unreadCount
      });
      return {
        success: true,
        messageId: result.messageId,
        status: result.status,
        unreadCount: result.unreadCount
      };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) {
        request.log.error({ err: error }, 'Failed to mark read');
      }
      return reply.status(status).send({
        success: false,
        error: status >= 500 ? 'Internal server error' : (error.message || 'Failed to mark read')
      });
    }
  });

  app.post('/api/v3/chats/:chatId/read', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 30, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    try {
      const result = await markChatRead(request.auth, request.params.chatId);
      realtime.emitChatUpdated(request.auth.userId, {
        chatId: request.params.chatId,
        unreadCount: 0,
        lastMessage: result.lastMessage || null
      });
      for (const receipt of result.updatedReceipts || []) {
        const readPayload = { chatId: request.params.chatId, messageId: receipt.messageId, status: 'read', unreadCount: 0 };
        console.log('[receipt] emitMessageRead → userId=%s payload=%j', receipt.senderUserId || request.auth.userId, readPayload);
        realtime.emitMessageRead(receipt.senderUserId || request.auth.userId, readPayload);
      }
      return {
        success: true,
        chatId: request.params.chatId,
        unreadCount: 0,
        updatedMessageIds: result.updatedMessageIds
      };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) {
        request.log.error({ err: error }, 'Failed to mark chat read');
      }
      return reply.status(status).send({
        success: false,
        error: status >= 500 ? 'Internal server error' : (error.message || 'Failed to mark chat read')
      });
    }
  });
}

module.exports = { registerReceiptRoutes };
