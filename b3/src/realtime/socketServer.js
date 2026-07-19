const { Server } = require('socket.io');
const { env } = require('../config/env');
const { authenticateSocket } = require('./socketAuth');
const {
  addConnection,
  removeConnection,
  isUserOnline
} = require('./connectionRegistry');
const chatAdapter = require('../db/chatAdapter');

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

    try {
      const chatIds = await chatAdapter.listChatIdsForUser(user);
      for (const chatId of chatIds) {
        socket.join(`chat:${chatId}`);
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
      socket.emit('error', { message: 'Failed to initialize realtime session' });
      socket.disconnect(true);
      return;
    }

    socket.on('chat:join', async ({ chatId }) => {
      if (!chatId) return;
      const allowed = await chatAdapter.userHasAccess(user, chatId);
      if (!allowed) return;
      socket.join(`chat:${chatId}`);
    });

    socket.on('typing:start', async ({ chatId }) => {
      if (!chatId) return;
      try {
        const allowed = await chatAdapter.userHasAccess(user, chatId);
        if (!allowed) return;
      } catch {
        return;
      }

      socket.to(`chat:${chatId}`).emit('typing:start', {
        chatId,
        userId: user.userId,
        displayName: user.displayName
      });

      const key = typingKey(chatId, user.userId);
      if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key));
      }
      typingTimers.set(
        key,
        setTimeout(() => {
          socket.to(`chat:${chatId}`).emit('typing:stop', {
            chatId,
            userId: user.userId
          });
          typingTimers.delete(key);
        }, 3000)
      );
    });

    socket.on('typing:stop', async ({ chatId }) => {
      if (!chatId) return;
      try {
        const allowed = await chatAdapter.userHasAccess(user, chatId);
        if (!allowed) return;
      } catch {
        return;
      }

      const key = typingKey(chatId, user.userId);
      if (typingTimers.has(key)) {
        clearTimeout(typingTimers.get(key));
        typingTimers.delete(key);
      }
      socket.to(`chat:${chatId}`).emit('typing:stop', {
        chatId,
        userId: user.userId
      });
    });

    socket.on('disconnect', () => {
      clearTypingTimersForUser(user.userId);
      removeConnection(user.userId, socket.id);
      if (!isUserOnline(user.userId)) {
        // Use io.to() — socket is already closed at this point and cannot send.
        chatAdapter.listChatIdsForUser(user).then((chatIds) => {
          for (const chatId of chatIds) {
            io.to(`chat:${chatId}`).emit('presence:offline', {
              chatId,
              userId: user.userId,
              lastSeenAt: new Date().toISOString()
            });
          }
        }).catch(() => {});
      }
    });
  });

  return io;
}

module.exports = { attachSocketServer };
