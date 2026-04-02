function registerChatThreadRoutes(app) {
  app.get('/api/v3/chats/:chatId/messages', async (request) => ({
    success: true,
    chatId: request.params.chatId,
    items: [],
    nextCursor: null,
    module: 'chat-thread',
    status: 'scaffolded'
  }));
}

module.exports = { registerChatThreadRoutes };
