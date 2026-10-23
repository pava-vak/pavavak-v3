const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const chatAdapter = require('../../db/chatAdapter');
const realtime = require('../../realtime/eventEmitter');
const { sendPushToUser } = require('../notifications/push.service');
const { sendFcmToUser } = require('../notifications/fcm.service');
const { getPool } = require('../../db/pool');
const { canAccessFile, fileIdFromBody } = require('../media/mediaAccess');
const { BURN_SECONDS } = require('../privacy/privacy');
const { isBlockedInChat } = require('../features/extras');

const DELETE_AFTER_DURATIONS = {
  '1h': 60 * 60 * 1000,
  '24h': 24 * 60 * 60 * 1000,
  '7d': 7 * 24 * 60 * 60 * 1000
};

const sendMessageSchema = z.object({
  chatId: z.string().min(1),
  text: z.string().trim().min(1).max(4000),
  viewOnce: z.boolean().default(false),
  deleteAfter: z.enum(['never', '1h', '24h', '7d']).default('never'),
  // No sound, banner or push for the recipient
  silent: z.boolean().default(false),
  burnAfterRead: z.enum(['off', '10s', '1m', '5m', '1h']).default('off')
});

function registerMessageRoutes(app) {
  app.delete('/api/v3/messages/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { messageId, conversationId, memberIds } = await chatAdapter.deleteMessage(request.auth, request.params.messageId);
      realtime.emitMessageDeletedToMembers(conversationId, messageId, memberIds);
      for (const id of memberIds) realtime.emitChatUpdated(id, { chatId: conversationId, reload: true });
      return { success: true };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) request.log.error({ err: error }, 'Failed to delete message');
      return reply.status(status).send({
        success: false,
        error: status >= 500 ? 'Internal server error' : (error.message || 'Failed to delete message')
      });
    }
  });

  app.delete('/api/v3/chats/:chatId/messages', { preHandler: requireAuth }, async (request, reply) => {
    try {
      await chatAdapter.clearChatMessages(request.auth, request.params.chatId);
      return { success: true };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) request.log.error({ err: error }, 'Failed to clear chat');
      return reply.status(status).send({
        success: false,
        error: status >= 500 ? 'Internal server error' : (error.message || 'Failed to clear chat')
      });
    }
  });

  app.delete('/api/v3/chats/:chatId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      await chatAdapter.deleteConversation(request.auth, request.params.chatId);
      return { success: true };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) request.log.error({ err: error }, 'Failed to delete chat');
      return reply.status(status).send({
        success: false,
        error: status >= 500 ? 'Internal server error' : (error.message || 'Failed to delete chat')
      });
    }
  });

  app.post('/api/v3/messages/:messageId/view-once-open', { preHandler: requireAuth }, async (request, reply) => {
    try {
      await chatAdapter.openViewOnceMessage(request.auth, request.params.messageId);
      return { success: true };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) request.log.error({ err: error }, 'Failed to mark view-once open');
      return reply.status(status).send({ success: false, error: status >= 500 ? 'Internal server error' : error.message });
    }
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
      const attachedFileId = fileIdFromBody(parsed.data.text);
      if (attachedFileId && !(await canAccessFile(request.auth.userId, attachedFileId))) {
        return reply.status(403).send({ success: false, error: 'You can only send files you uploaded or received' });
      }
      if (await isBlockedInChat(getPool(), request.auth.userId, parsed.data.chatId)) {
        return reply.status(403).send({ success: false, error: 'You cannot message this contact' });
      }

      const expiresAt = parsed.data.deleteAfter !== 'never'
        ? new Date(Date.now() + DELETE_AFTER_DURATIONS[parsed.data.deleteAfter]).toISOString()
        : null;

      const message = await chatAdapter.appendOutgoingMessage(
        request.auth,
        parsed.data.chatId,
        parsed.data.text,
        {
          viewOnce: parsed.data.viewOnce,
          expiresAt,
          silent: parsed.data.silent,
          burnSeconds: BURN_SECONDS[parsed.data.burnAfterRead]
        }
      );

      const memberIds = await chatAdapter.getConversationMemberUserIds(parsed.data.chatId);
      const targets = memberIds.length > 0 ? memberIds : [request.auth.userId];

      // The sender's copy of a view-once message is blank; recipients still need the content to open it
      realtime.emitMessageNewToMembers(request.auth, parsed.data.chatId, message, targets,
        parsed.data.viewOnce ? parsed.data.text : null);

      const lastMessage = {
        messageId: message.messageId,
        text: message.text,
        sentAt: message.sentAt,
        direction: message.direction,
        status: message.status
      };

      // Fetch muted members once to skip push for them
      let mutedUserIds = new Set();
      try {
        const { rows: mutedRows } = await getPool().query(
          // Muted and hidden chats never notify (web push or Android)
          'select user_id from v3_conversation_members where conversation_id=$1 and (muted = true or hidden = true)',
          [parsed.data.chatId]
        );
        // bigint arrives as a string; member ids are numbers
        mutedUserIds = new Set(mutedRows.map(r => Number(r.user_id)));
      } catch { /* non-fatal — proceed without mute check */ }

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

        // Send Web Push only to recipients who are not the sender and have not muted the chat
        if (!isSender && !mutedUserIds.has(Number(memberId)) && !parsed.data.silent) {
          // Android: only the chat id travels through Google; the app fetches nothing until opened
          sendFcmToUser(memberId, { type: 'message', chatId: parsed.data.chatId });
          // Privacy: never put the app name or the sender in the web notification — the
          // browser already attributes it to the installed app; the content stays generic.
          sendPushToUser(memberId, {
            chatId: parsed.data.chatId,
            title: 'New message',
            body: 'You have a new message',
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
