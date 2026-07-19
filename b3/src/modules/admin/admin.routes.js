const crypto = require('crypto');
const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { hashPassword } = require('../../shared/security/password.service');
const identity = require('../../db/identityAdapter');
const chatAdapter = require('../../db/chatAdapter');

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
    if (!userId || userId >= 9000) {
      return reply.status(400).send({ success: false, error: 'Invalid user' });
    }
    const { disabled } = request.body || {};
    const user = await identity.setDisabled(userId, Boolean(disabled));
    if (!user) {
      return reply.status(404).send({ success: false, error: 'User not found' });
    }
    return { success: true, user };
  });

  app.delete('/api/v3/admin/seed-data', { preHandler: requireAdmin }, async () => {
    await identity.cleanSeedData();
    return { success: true };
  });

  app.post('/api/v3/admin/users/:userId/reset-password', { preHandler: requireAdmin }, async (request, reply) => {
    const userId = Number(request.params.userId);
    if (!userId || userId >= 9000) {
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
