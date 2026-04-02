function registerHealthRoutes(app) {
  app.get('/api/v3/health', async () => ({
    success: true,
    service: 'b3',
    status: 'ok'
  }));
}

module.exports = { registerHealthRoutes };
