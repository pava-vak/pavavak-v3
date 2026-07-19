const userSockets = new Map();

function addConnection(userId, socketId) {
  const key = String(userId);
  if (!userSockets.has(key)) {
    userSockets.set(key, new Set());
  }
  userSockets.get(key).add(socketId);
}

function removeConnection(userId, socketId) {
  const key = String(userId);
  const sockets = userSockets.get(key);
  if (!sockets) return;
  sockets.delete(socketId);
  if (sockets.size === 0) {
    userSockets.delete(key);
  }
}

function getSocketIds(userId) {
  return Array.from(userSockets.get(String(userId)) || []);
}

function isUserOnline(userId) {
  return getSocketIds(userId).length > 0;
}

module.exports = {
  addConnection,
  removeConnection,
  getSocketIds,
  isUserOnline
};
