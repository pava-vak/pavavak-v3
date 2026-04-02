function registerChatListRoutes(app) {
  app.get('/api/v3/chats', async () => ({
    success: true,
    items: [],
    module: 'chat-list',
    status: 'scaffolded'
  }));
}

module.exports = { registerChatListRoutes };
