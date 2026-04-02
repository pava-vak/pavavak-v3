const Fastify = require('fastify');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const { registerHealthRoutes } = require('../modules/health/health.routes');
const { registerAuthRoutes } = require('../modules/auth/auth.routes');
const { registerChatListRoutes } = require('../modules/chat-list/chatList.routes');
const { registerChatThreadRoutes } = require('../modules/chat-thread/chatThread.routes');
const { registerMessageRoutes } = require('../modules/messages/message.routes');
const { registerReceiptRoutes } = require('../modules/receipts/receipt.routes');

function buildApp() {
  const app = Fastify({ logger: true });

  app.register(helmet, { global: true });
  app.register(cors, {
    origin: true,
    credentials: true
  });

  registerHealthRoutes(app);
  registerAuthRoutes(app);
  registerChatListRoutes(app);
  registerChatThreadRoutes(app);
  registerMessageRoutes(app);
  registerReceiptRoutes(app);

  return app;
}

module.exports = { buildApp };
