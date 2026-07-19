const { requireAuth } = require('../../shared/security/auth.preHandler');
const { listChatsForUser } = require('./chatList.service');

function registerChatListRoutes(app) {
  app.get('/api/v3/chats', { preHandler: requireAuth }, async (request) => {
    const items = await listChatsForUser(request.auth);
    return {
      success: true,
      items,
      page: {
        nextCursor: null,
        hasMore: false
      }
    };
  });
}

module.exports = { registerChatListRoutes };
