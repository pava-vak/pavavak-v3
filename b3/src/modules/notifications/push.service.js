const webPush = require('web-push');
const { env } = require('../../config/env');
const { getSubscriptions, removeStaleEndpoint } = require('./pushStore');

let vapidConfigured = false;

function ensureVapid() {
  if (vapidConfigured) return;
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) return;
  webPush.setVapidDetails(
    env.VAPID_SUBJECT,
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY
  );
  vapidConfigured = true;
}

async function sendPushToUser(userId, payload) {
  ensureVapid();
  if (!vapidConfigured) return;

  const subs = getSubscriptions(userId);
  if (!subs.length) return;

  const data = JSON.stringify(payload);

  await Promise.allSettled(
    subs.map(async (sub) => {
      try {
        await webPush.sendNotification(sub, data);
      } catch (err) {
        // 404/410 = subscription expired or revoked — remove it
        if (err.statusCode === 404 || err.statusCode === 410) {
          removeStaleEndpoint(userId, sub.endpoint);
        }
      }
    })
  );
}

module.exports = { sendPushToUser };
