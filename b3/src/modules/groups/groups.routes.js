const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const chatAdapter = require('../../db/chatAdapter');
const realtime = require('../../realtime/eventEmitter');
const { sendFcmToUser } = require('../notifications/fcm.service');

const createSchema = z.object({
  title: z.string().trim().min(1).max(60),
  memberIds: z.array(z.coerce.number().int().positive()).min(1).max(50),
  avatarEmoji: z.string().trim().max(8).optional()
});
const membersSchema = z.object({
  memberIds: z.array(z.coerce.number().int().positive()).min(1).max(50)
});
const renameSchema = z.object({ title: z.string().trim().min(1).max(60) });
const roleSchema = z.object({ role: z.enum(['admin', 'member']) });

/** Tell every affected member to reload this chat (list + open thread), and drop in the system line. */
function broadcast(chatId, memberIds, system, { reload = true } = {}) {
  for (const id of memberIds) {
    if (system) realtime.emitToUser(id, 'message:new', { chatId, message: system });
    realtime.emitToUser(id, 'chat:updated', { chatId, reload });
    realtime.emitToUser(id, 'group:updated', { chatId });
  }
}

function fail(reply, error, log, msg) {
  const status = error.status || 500;
  if (status >= 500) log.error({ err: error }, msg);
  return reply.status(status).send({
    success: false,
    error: status >= 500 ? 'Internal server error' : (error.message || msg)
  });
}

function registerGroupRoutes(app) {
  // Create a group
  app.post('/api/v3/groups', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ success: false, error: 'Invalid request body', details: parsed.error.flatten() });
    try {
      const { chat, memberIds, system } = await chatAdapter.createGroupConversation(request.auth, parsed.data);
      broadcast(chat.chatId, memberIds, system);
      // Wake the phones of members who aren't connected so the new group lands promptly.
      for (const id of memberIds) if (id !== request.auth.userId) sendFcmToUser(id, { type: 'message', chatId: chat.chatId });
      return { success: true, chat };
    } catch (error) {
      return fail(reply, error, request.log, 'Failed to create group');
    }
  });

  // Group detail (members, roles, my role)
  app.get('/api/v3/chats/:chatId/detail', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const detail = await chatAdapter.getConversationDetail(request.auth, request.params.chatId);
      return { success: true, detail };
    } catch (error) {
      return fail(reply, error, request.log, 'Failed to load chat detail');
    }
  });

  // Add members (admin)
  app.post('/api/v3/chats/:chatId/members', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = membersSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ success: false, error: 'Invalid request body', details: parsed.error.flatten() });
    try {
      const { added, memberIds, system } = await chatAdapter.addGroupMembers(request.auth, request.params.chatId, parsed.data.memberIds);
      broadcast(request.params.chatId, memberIds, system);
      for (const id of added) sendFcmToUser(id, { type: 'message', chatId: request.params.chatId });
      return { success: true, added };
    } catch (error) {
      return fail(reply, error, request.log, 'Failed to add members');
    }
  });

  // Remove a member (admin)
  app.delete('/api/v3/chats/:chatId/members/:userId', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { removed, memberIds, system } = await chatAdapter.removeGroupMember(request.auth, request.params.chatId, request.params.userId);
      broadcast(request.params.chatId, memberIds, system);
      realtime.emitToUser(removed, 'chat:updated', { chatId: request.params.chatId, reload: true, removed: true });
      return { success: true, removed };
    } catch (error) {
      return fail(reply, error, request.log, 'Failed to remove member');
    }
  });

  // Leave a group (any member)
  app.post('/api/v3/chats/:chatId/leave', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { memberIds, system } = await chatAdapter.leaveGroup(request.auth, request.params.chatId);
      broadcast(request.params.chatId, memberIds, system);
      realtime.emitToUser(request.auth.userId, 'chat:updated', { chatId: request.params.chatId, reload: true, removed: true });
      return { success: true };
    } catch (error) {
      return fail(reply, error, request.log, 'Failed to leave group');
    }
  });

  // Rename (admin)
  app.patch('/api/v3/chats/:chatId', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = renameSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ success: false, error: 'Invalid request body', details: parsed.error.flatten() });
    try {
      const { title, memberIds, system } = await chatAdapter.renameGroup(request.auth, request.params.chatId, parsed.data.title);
      broadcast(request.params.chatId, memberIds, system);
      return { success: true, title };
    } catch (error) {
      return fail(reply, error, request.log, 'Failed to rename group');
    }
  });

  // Promote / demote (admin)
  app.patch('/api/v3/chats/:chatId/members/:userId', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = roleSchema.safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ success: false, error: 'Invalid request body', details: parsed.error.flatten() });
    try {
      const { userId, role, memberIds, system } = await chatAdapter.setMemberRole(request.auth, request.params.chatId, request.params.userId, parsed.data.role);
      broadcast(request.params.chatId, memberIds, system);
      return { success: true, userId, role };
    } catch (error) {
      return fail(reply, error, request.log, 'Failed to update member role');
    }
  });
}

module.exports = { registerGroupRoutes };
