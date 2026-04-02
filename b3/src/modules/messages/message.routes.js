function registerMessageRoutes(app) {
  app.post('/api/v3/messages', async () => ({
    success: false,
    module: 'messages',
    status: 'not_implemented'
  }));
}

module.exports = { registerMessageRoutes };
