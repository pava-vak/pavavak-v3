const Fastify = require('fastify');
const cors = require('@fastify/cors');
const helmet = require('@fastify/helmet');
const cookie = require('@fastify/cookie');
const rateLimit = require('@fastify/rate-limit');
const { env } = require('../config/env');
const { registerHealthRoutes } = require('../modules/health/health.routes');
const { registerAuthRoutes } = require('../modules/auth/auth.routes');
const { registerChatListRoutes } = require('../modules/chat-list/chatList.routes');
const { registerChatThreadRoutes } = require('../modules/chat-thread/chatThread.routes');
const { registerMessageRoutes } = require('../modules/messages/message.routes');
const { registerReceiptRoutes } = require('../modules/receipts/receipt.routes');
const { registerPrivacyRoutes } = require('../modules/privacy/privacy');
const { registerUserRoutes } = require('../modules/users/user.routes');
const { registerAdminRoutes } = require('../modules/admin/admin.routes');
const { registerPushRoutes, registerFcmRoutes } = require('../modules/notifications/push.routes');
const { registerMediaRoutes } = require('../modules/media/media.routes');
const { registerFeatureRoutes } = require('../modules/features/features.routes');
const { registerBiometricRoutes } = require('../modules/biometric/biometric.routes');
const { recoveryPlugin } = require('../modules/recovery/recovery.routes');
const biometricRepo = require('../modules/biometric/biometric.repository');

function buildApp() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL },
    // nginx on the same host sets X-Forwarded-For to the real client; trust only that hop so
    // request.ip is the visitor (login throttling, rate limits, logs) and can't be spoofed
    trustProxy: '127.0.0.1',
    bodyLimit: 6 * 1024 * 1024  // 6 MB — covers base64-encoded images up to ~4.5 MB
  });

  app.register(cookie);

  app.register(helmet, {
    global: true,
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc:  ["'self'"],
        styleSrc:   ["'self'", "'unsafe-inline'"],
        imgSrc:     ["'self'", 'blob:', 'data:'],
        mediaSrc:   ["'self'", 'blob:'],
        connectSrc: ["'self'", 'wss:', 'ws:'],
        workerSrc:  ["'self'"],
        fontSrc:    ["'self'"],
        objectSrc:  ["'none'"],
        frameAncestors: ["'none'"],
        baseUri:    ["'self'"],
      },
    },
    crossOriginResourcePolicy: { policy: 'same-site' },
  });

  app.register(cors, {
    origin: env.webOrigins,
    credentials: true
  });

  app.register(async function apiScope(instance) {
    // Register the limiter and AWAIT it before any routes so the plugin's
    // onRoute hook is installed first — otherwise per-route `config.rateLimit`
    // is silently ignored for routes added synchronously below.
    await instance.register(rateLimit, {
      global: false,
      max: 1000,
      timeWindow: '1 minute'
    });

    registerHealthRoutes(instance);
    registerAuthRoutes(instance);
    registerChatListRoutes(instance);
    registerChatThreadRoutes(instance);
    registerMessageRoutes(instance);
    registerReceiptRoutes(instance);
    registerPrivacyRoutes(instance);
    registerUserRoutes(instance);
    registerAdminRoutes(instance);
    registerPushRoutes(instance);
    registerFcmRoutes(instance);
    registerMediaRoutes(instance);
    registerFeatureRoutes(instance);
    registerBiometricRoutes(instance);
    instance.register(recoveryPlugin);
  });

  app.setErrorHandler((error, request, reply) => {
    // Fastify sets statusCode on framework/plugin errors (validation 400,
    // rate-limit 429, payload-too-large 413, ...); our routes set error.status.
    const status = error.statusCode || error.status || 500;
    if (status >= 500) {
      request.log.error({ err: error }, 'Unhandled request error');
      return reply.status(500).send({
        success: false,
        error: 'Internal server error'
      });
    }
    request.log.warn({ err: error }, 'Request error');
    return reply.status(status).send({
      success: false,
      error: error.message || 'Request error'
    });
  });

  app.setNotFoundHandler((request, reply) => {
    return reply.status(404).send({
      success: false,
      error: 'Not Found'
    });
  });

  return app;
}

module.exports = { buildApp };
