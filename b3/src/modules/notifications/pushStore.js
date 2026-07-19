// In-memory push subscription store — keyed by userId, value = array of subscription objects.
// Each subscription is the full Web Push subscription JSON from the browser.
// On PostgreSQL migration this moves to a v3_push_subscriptions table.

const subscriptions = new Map();

function addSubscription(userId, subscription) {
  const endpoint = subscription.endpoint;
  const existing = subscriptions.get(userId) || [];
  const filtered = existing.filter((s) => s.endpoint !== endpoint);
  subscriptions.set(userId, [...filtered, subscription]);
}

function removeSubscription(userId, endpoint) {
  const existing = subscriptions.get(userId) || [];
  subscriptions.set(userId, existing.filter((s) => s.endpoint !== endpoint));
}

function getSubscriptions(userId) {
  return subscriptions.get(userId) || [];
}

function removeStaleEndpoint(userId, endpoint) {
  removeSubscription(userId, endpoint);
}

module.exports = { addSubscription, removeSubscription, getSubscriptions, removeStaleEndpoint };
