const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const chatAdapter = require('../../db/chatAdapter');
const realtime = require('../../realtime/eventEmitter');
const { sendPushToUser } = require('../notifications/push.service');

const DELETE_AFTER_DURATIONS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};

const sendMessageSchema = z.object({
  chatId: z.string().min(1),
  text: z.string().trim().min(1).max(4000),
  viewOnce: z.boolean().default(false),
  deleteAfter: z.enum(['never', '1h', '24h', '7d']).default('never')
});

function registerMessageRoutes(app) {
  app.post('/api/v3/messages/:messageId/view-once-open', { preHandler: requireAuth }, async (request) => {
    await chatAdapter.openViewOnceMessage(request.auth, request.params.messageId);
    return { success: true };
  });

  app.post('/api/v3/messages', {
    preHandler: requireAuth,
    config: {
      rateLimit: {
        max: 60,
        timeWindow: '1 minute'
      }
    }
  }, async (request, reply) => {
    const parsed = sendMessageSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid request body',
        details: parsed.error.flatten()
      });
    }

    try {
      const expiresAt = parsed.data.deleteAfter !== 'never'
        ? new Date(Date.now() + DELETE_AFTER_DURATIONS[parsed.data.deleteAfter]).toISOString()
        : null;

      const message = await chatAdapter.appendOutgoingMessage(
        request.auth,
        parsed.data.chatId,
        parsed.data.text,
        null,
        { viewOnce: parsed.data.viewOnce, expiresAt }
      );

      const memberIds = await chatAdapter.getConversationMemberUserIds(parsed.data.chatId);
      const targets = memberIds.length > 0 ? memberIds : [request.auth.userId];

      realtime.emitMessageNewToMembers(request.auth, parsed.data.chatId, message, targets);

      const lastMessage = {
        messageId: message.messageId,
        text: message.text,
        sentAt: message.sentAt,
        direction: message.direction,
        status: message.status
      };

      for (const memberId of targets) {
        const isSender = memberId === request.auth.userId;
        realtime.emitChatUpdated(memberId, {
          chatId: parsed.data.chatId,
          lastMessage: isSender
            ? lastMessage
            : {
                ...lastMessage,
                direction: 'incoming',
                status: 'sent'
              },
          unreadCount: isSender ? 0 : undefined
        });

        // Send Web Push to recipients who are not the sender
        if (!isSender) {
          sendPushToUser(memberId, {
            chatId: parsed.data.chatId,
            title: request.auth.displayName || request.auth.username,
            body: parsed.data.viewOnce
              ? '👁 View once message'
              : (parsed.data.text.length > 100 ? parsed.data.text.slice(0, 97) + '…' : parsed.data.text),
            icon: '/icon.svg',
            badge: '/icon.svg'
          }).catch(() => {});
        }
      }

      return {
        success: true,
        message
      };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) {
        request.log.error({ err: error }, 'Failed to send message');
      }
      return reply.status(status).send({
        success: false,
        error: status >= 500 ? 'Internal server error' : (error.message || 'Failed to send message')
      });
    }
  });
}

module.exports = { registerMessageRoutes };
