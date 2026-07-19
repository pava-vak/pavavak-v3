const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { env } = require('../../config/env');
const { addSubscription, removeSubscription } = require('./pushStore');

const subscribeSchema = z.object({
  endpoint: z.string().url(),
  keys: z.object({
    p256dh: z.string().min(1),
    auth: z.string().min(1)
  }),
  expirationTime: z.number().nullable().optional()
});

function registerPushRoutes(app) {
  // Public — frontend needs this before auth to subscribe
  app.get('/api/v3/push/vapid-public-key', async (_request, reply) => {
    if (!env.VAPID_PUBLIC_KEY) {
      return reply.status(503).send({ success: false, error: 'Push not configured' });
    }
    return { success: true, publicKey: env.VAPID_PUBLIC_KEY };
  });

  app.post('/api/v3/push/subscribe', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const parsed = subscribeSchema.safeParse(request.body || {});
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid subscription object' });
    }
    addSubscription(request.auth.userId, parsed.data);
    return { success: true };
  });

  app.delete('/api/v3/push/subscribe', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 20, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    const { endpoint } = request.body || {};
    if (endpoint) removeSubscription(request.auth.userId, endpoint);
    return { success: true };
  });
}

module.exports = { registerPushRoutes };
