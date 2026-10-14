const { Server } = require('socket.io');
const { env } = require('../config/env');
const { authenticateSocket } = require('./socketAuth');
const {
  addConnection,
  removeConnection,
  isUserOnline
} = require('./connectionRegistry');
const chatAdapter = require('../db/chatAdapter');
const { getPool } = require('../db/pool');

const typingTimers = new Map();

function typingKey(chatId, userId) {
  return `${chatId}:${userId}`;
}

function clearTypingTimersForUser(userId) {
  for (const [key, timer] of typingTimers.entries()) {
    if (key.endsWith(`:${userId}`)) {
      clearTimeout(timer);
      typingTimers.delete(key);
    }
  }
}

function attachSocketServer(httpServer) {
  const io = new Server(httpServer, {
    path: env.SOCKET_PATH,
    cors: {
      origin: env.webOrigins,
      credentials: true
    }
  });

  const realtime = require('./eventEmitter');
  realtime.setIo(io);

  io.use(async (socket, next) => {
    try {
      const token = socket.handshake.auth?.token;
      socket.data.user = await authenticateSocket(token);
      next();
    } catch {
      next(new Error('Unauthorized'));
    }
  });

  io.on('connection', async (socket) => {
    const user = socket.data.user;
    const userRoom = `user:${user.userId}`;

    addConnection(user.userId, socket.id);
    socket.join(userRoom);

    // Cache the set of chat IDs this socket is allowed in — used for O(1) typing auth
    socket.data.chatIdSet = new Set();

    try {
      const chatIds = await chatAdapter.listChatIdsForUser(user);
      for (const chatId of chatIds) {
        socket.join(`chat:${chatId}`);
        socket.data.chatIdSet.add(chatId);
      }

      for (const chatId of chatIds) {
        socket.to(`chat:${chatId}`).emit('presence:online', {
          chatId,
          userId: user.userId,
          displayName: user.displayName,
          lastSeenAt: new Date().toISOString()
        });
      }
    } catch (error) {
      console.error('[socket] connection init failed for user %s: %s', user.userId, error.message);
      removeConnection(user.userId, socket.id);
      socket.emit('error', { message: 'Failed to initialize realtime session' });
      socket.disconnect(true);
      return;
    }

    socket.on('chat:join', async ({ chatId }) => {
      if (!chatId) return;
      if (socket.data.chatIdSet.has(chatId)) {
        socket.join(`chat:${chatId}`);
        return;
      }
      try {
        const allowed = await chatAdapter.userHasAccess(user, chatId);
        if (!allowed) return;
        socket.join(`chat:${chatId}`);
        socket.data.chatIdSet.add(chatId);
      } catch {
        // silently ignore — joining is best-effort
      }
    });

    socket.on('typing:start', ({ chatId }) => {
      if (!chatId || !socket.data.chatIdSet.has(chatId)) return;

      socket.to(`chat:${chatId}`).emit('typing:start', {
        chatId,
        userId: user.userId,
        displayName: user.displayName
      });

      const key = typingKey(chatId, user.userId);
      if (typingTimers.has(key)) clearTimeout(typingTimers.get(key));
      typingTimers.set(
        key,
        setTimeout(() => {
          socket.to(`chat:${chatId}`).emit('typing:stop', { chatId, userId: user.userId });
          typingTimers.delete(key);
        }, 3000)
      );
    });

    socket.on('typing:stop', ({ chatId }) => {
      if (!chatId || !socket.data.chatIdSet.has(chatId)) return;

      const key = typingKey(chatId, user.userId);
      if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key));
        typingTimers.delete(key);
      }
      socket.to(`chat:${chatId}`).emit('typing:stop', { chatId, userId: user.userId });
    });

    socket.on('disconnect', () => {
      clearTypingTimersForUser(user.userId);
      removeConnection(user.userId, socket.id);
      if (!isUserOnline(user.userId)) {
        const lastSeenAt = new Date().toISOString();
        getPool().query('update v3_users set last_seen_at=$1 where user_id=$2', [lastSeenAt, user.userId]).catch(() => {});
        const chatIds = [...socket.data.chatIdSet];
        for (const chatId of chatIds) {
          io.to(`chat:${chatId}`).emit('presence:offline', { chatId, userId: user.userId, lastSeenAt });
        }
      }
    });
  });

  return io;
}

module.exports = { attachSocketServer };
