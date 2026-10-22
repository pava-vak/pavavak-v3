const crypto = require('crypto');
const fs = require('fs');
const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { hashPassword } = require('../../shared/security/password.service');
const { env } = require('../../config/env');
const identity = require('../../db/identityAdapter');
const chatAdapter = require('../../db/chatAdapter');
const realtime = require('../../realtime/eventEmitter');

// The currently published Android build, from the download dir's android.json. Best effort.
function readPublishedRelease() {
  const path = env.ANDROID_RELEASE_JSON_PATH || '/var/www/pava-vak/downloads/android.json';
  try {
    return JSON.parse(fs.readFileSync(path, 'utf8')) || {};
  } catch {
    return {};
  }
}

async function requireAdmin(request, reply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (!request.auth?.isAdmin) {
    return reply.status(403).send({
      success: false,
      error: 'Forbidden'
    });
  }
}

const usersQuerySchema = z.object({
  q: z.string().trim().max(80).optional().default('')
});

const createUserSchema = z.object({
  username:    z.string().trim().min(2).max(40).regex(/^[a-z0-9._-]+$/, 'Lowercase letters, numbers, dots, hyphens only'),
  displayName: z.string().trim().min(1).max(80),
  password:    z.string().min(8).max(128)
});

function registerAdminRoutes(app) {
  app.get('/api/v3/admin/summary', { preHandler: requireAdmin }, async () => {
    const summary = await identity.adminSummary();
    return {
      success: true,
      summary
    };
  });

  app.get('/api/v3/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = usersQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Invalid query parameters',
        details: parsed.error.flatten()
      });
    }

    const items = await identity.adminListUsers({
      query: parsed.data.q,
      limit: 100
    });
    return { success: true, items };
  });

  app.put('/api/v3/admin/users/:userId/disable', { preHandler: requireAdmin }, async (request, reply) => {
    const userId = Number(request.params.userId);
    if (!userId) {
      return reply.status(400).send({ success: false, error: 'Invalid user' });
    }
    const parsed = z.object({ disabled: z.boolean() }).safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid request body', details: parsed.error.flatten() });
    }
    const user = await identity.setDisabled(userId, parsed.data.disabled);
    if (!user) {
      return reply.status(404).send({ success: false, error: 'User not found' });
    }
    return { success: true, user };
  });

  app.post('/api/v3/admin/users', { preHandler: requireAdmin }, async (request, reply) => {
    const parsed = createUserSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({
        success: false,
        error: 'Validation failed',
        details: parsed.error.flatten()
      });
    }
    try {
      const user = await identity.createUser({
        username:     parsed.data.username,
        displayName:  parsed.data.displayName,
        passwordHash: await hashPassword(parsed.data.password),
        isAdmin:      false
      });
      return reply.status(201).send({ success: true, user });
    } catch (error) {
      const msg = error?.message || '';
      if (msg.toLowerCase().includes('unique') || msg.toLowerCase().includes('duplicate') || msg.toLowerCase().includes('already')) {
        return reply.status(409).send({ success: false, error: 'Username already taken' });
      }
      request.log.error({ err: error }, 'Admin create user failed');
      return reply.status(500).send({ success: false, error: 'Failed to create user' });
    }
  });

  app.delete('/api/v3/admin/seed-data', { preHandler: requireAdmin }, async () => {
    await identity.cleanSeedData();
    return { success: true };
  });

  app.post('/api/v3/admin/users/:userId/reset-password', { preHandler: requireAdmin }, async (request, reply) => {
    const userId = Number(request.params.userId);
    if (!userId) {
      return reply.status(400).send({ success: false, error: 'Invalid user' });
    }
    const temporaryPassword = crypto.randomBytes(5).toString('hex'); // 10 hex chars
    const passwordHash = await hashPassword(temporaryPassword);
    const user = await identity.setPasswordHash(userId, passwordHash);
    if (!user) {
      return reply.status(404).send({ success: false, error: 'User not found' });
    }
    return { success: true, temporaryPassword };
  });

  app.get('/api/v3/admin/chats', { preHandler: requireAdmin }, async () => {
    const items = await chatAdapter.listAllChats();
    return { success: true, items };
  });

  const adminChatMsgsQuerySchema = z.object({
    cursor: z.string().optional()
  });

  app.post('/api/v3/admin/broadcast-update', { preHandler: requireAdmin }, async (request, reply) => {
    try {
      const results = await chatAdapter.broadcastSystemUpdate(request.auth.userId);
      const now = new Date().toISOString();
      for (const { conversationId, messageId, memberIds } of results) {
        const sysMessage = {
          messageId,
          text: '__SYS_UPDATE__',
          sentAt: now,
          direction: 'incoming',
          status: 'sent',
          viewOnce: false,
          expiresAt: null
        };
        for (const memberId of memberIds) {
          realtime.emitMessageNew(memberId, { chatId: conversationId, message: sysMessage });
          realtime.emitChatUpdated(memberId, {
            chatId: conversationId,
            lastMessage: { ...sysMessage },
            incrementUnread: true
          });
        }
      }
      // Also push a notification to every Android device so people see it even with the app closed.
      // The payload is version-only; the app builds the notice and shows the in-app popup on open.
      let push = { sent: 0, total: 0 };
      try {
        const { sendFcmToAll } = require('../notifications/fcm.service');
        const release = readPublishedRelease();
        push = await sendFcmToAll({
          type: 'app_update',
          versionName: release.versionName || '',
          versionCode: release.versionCode || 0,
        });
      } catch (err) {
        request.log.error({ err }, 'Update push failed (in-app notice still delivered)');
      }
      return { success: true, count: results.length, push };
    } catch (error) {
      request.log.error({ err: error }, 'Failed to broadcast update');
      return reply.status(500).send({ success: false, error: 'Failed to broadcast update' });
    }
  });

  app.get('/api/v3/admin/chats/:chatId/messages', { preHandler: requireAdmin }, async (request, reply) => {
    const { chatId } = request.params;
    const parsed = adminChatMsgsQuerySchema.safeParse(request.query || {});
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid query' });
    }
    const result = await chatAdapter.adminListMessagesForChat(chatId, parsed.data.cursor || null, 50);
    return { success: true, ...result };
  });
}

module.exports = { registerAdminRoutes };
