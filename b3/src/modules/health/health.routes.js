const { env } = require('../../config/env');
const { pingDatabase } = require('../../db/pool');

function registerHealthRoutes(app) {
  app.get('/api/v3/health', async () => ({
    success: true,
    service: 'b3',
    status: 'ok',
    environment: env.NODE_ENV
  }));

  app.get('/api/v3/health/dependencies', async (request, reply) => {
    try {
      const database = await pingDatabase();
      return {
        success: true,
        service: 'b3',
        dependencies: {
          database
        }
      };
    } catch (error) {
      request.log.error(error, 'dependency health check failed');
      return reply.status(503).send({
        success: false,
        service: 'b3',
        dependencies: {
          database: {
            configured: Boolean(env.DATABASE_URL),
            connected: false
          }
        }
      });
    }
  });
}

module.exports = { registerHealthRoutes };
