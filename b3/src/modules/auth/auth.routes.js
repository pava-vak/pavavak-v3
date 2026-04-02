function registerAuthRoutes(app) {
  app.get('/api/v3/auth/health', async () => ({
    success: true,
    module: 'auth',
    status: 'scaffolded'
  }));
}

module.exports = { registerAuthRoutes };
