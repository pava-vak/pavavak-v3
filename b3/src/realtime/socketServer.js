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
const { isGhost, isGhostCached, getPresencePrefs, presenceVisibility } = require('../modules/privacy/privacy');

const realtime = require('./eventEmitter');

const typingTimers = new Map();

/**
 * Marks every message that arrived for [userId] while they were offline as delivered, and tells
 * each sender (message:delivered) so it shows two ticks — without the recipient opening each chat.
 */
async function deliverPendingFor(userId) {
  const db = getPool();
  const { rows } = await db.query(
    `update v3_message_receipts r
     set delivered_at = now()
     from v3_messages msg
     where r.message_id = msg.message_id
       and r.user_id = $1
       and r.delivered_at is null
       and r.cleared_at is null
       and msg.sender_id <> $1
       and msg.deleted_at is null
     returning r.message_id, msg.conversation_id, msg.sender_id`,
    [Number(userId)]
  );
  for (const row of rows) {
    const senderUserId = Number(row.sender_id);
    await db.query(
      `update v3_user_chat_summaries
       set last_message_status = 'delivered', updated_at = now()
       where user_id = $1 and conversation_id = $2 and last_message_id = $3 and last_message_status = 'sent'`,
      [senderUserId, row.conversation_id, row.message_id]
    ).catch(() => {});
    realtime.emitMessageDelivered(senderUserId, { chatId: row.conversation_id, messageId: row.message_id, status: 'delivered' });
  }
}

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
    },
    // Detect a client that vanished (app swipe-killed, network dropped) within ~15s
    // instead of the ~45s default, so it stops showing as "online" sooner.
    pingInterval: 10000,
    pingTimeout: 5000,
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

    const firstConnection = !isUserOnline(user.userId);
    addConnection(user.userId, socket.id);
    socket.join(userRoom);
    // They just came online: deliver anything queued "send when online" for them,
    // and mark everything that arrived while they were away as delivered (two ticks),
    // telling each sender — WhatsApp-style, without the recipient having to open each chat.
    if (firstConnection) {
      require('../modules/features/extras').flushOnlineQueueFor(user.userId).catch(() => {});
      deliverPendingFor(user.userId).catch((err) => console.error('[deliver] on connect failed:', err.message));
    }
    // Ring for a call that arrived while they were away (app woken by the call push)
    require('../modules/calls/calls').deliverPendingCall(socket, user.userId);

    // Cache the set of chat IDs this socket is allowed in — used for O(1) typing auth
    socket.data.chatIdSet = new Set();

    try {
      const chatIds = await chatAdapter.listChatIdsForUser(user);
      for (const chatId of chatIds) {
        socket.join(`chat:${chatId}`);
        socket.data.chatIdSet.add(chatId);
      }

      // Map each 1:1 chat to the other member so presence can be gated per viewer
      const peerByChat = new Map();
      try {
        const { rows } = await getPool().query(
          'select conversation_id, user_id from v3_conversation_members where conversation_id = any($1) and user_id <> $2',
          [chatIds, user.userId]
        );
        for (const r of rows) if (!peerByChat.has(r.conversation_id)) peerByChat.set(r.conversation_id, Number(r.user_id));
      } catch { /* best effort; fall back to default visibility */ }
      socket.data.peerByChat = peerByChat;

      // Announce online only to peers allowed to see it (ghost / last-seen / online rules, reciprocal)
      const selfPrefs = await getPresencePrefs(user.userId);
      for (const chatId of chatIds) {
        const peerId = peerByChat.get(chatId);
        const peerPrefs = peerId ? await getPresencePrefs(peerId) : null;
        if (presenceVisibility(selfPrefs, peerPrefs).online) {
          socket.to(`chat:${chatId}`).emit('presence:online', {
            chatId,
            userId: user.userId,
            displayName: user.displayName,
            lastSeenAt: new Date().toISOString()
          });
        }
        // Snapshot the other way: tell THIS user which peers are already online and visible to them,
        // so chat-list dots are correct right after (re)connecting instead of only after opening a chat.
        if (peerId && isUserOnline(peerId)) {
          const vis = presenceVisibility(peerPrefs, selfPrefs);
          if (vis.online) {
            socket.emit('presence:online', { chatId, userId: peerId, lastSeenAt: new Date().toISOString() });
          }
        }
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
      if (isGhostCached(user.userId)) return;

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

    // Voice/video call signaling (SDP + ICE relay between the two members)
    require('../modules/calls/calls').registerCallSignaling(io, socket, user);

    socket.on('disconnect', async () => {
      clearTypingTimersForUser(user.userId);
      removeConnection(user.userId, socket.id);
      if (!isUserOnline(user.userId) && !isGhostCached(user.userId)) {
        const lastSeenAt = new Date().toISOString();
        getPool().query('update v3_users set last_seen_at=$1 where user_id=$2', [lastSeenAt, user.userId]).catch(() => {});
        const selfPrefs = await getPresencePrefs(user.userId);
        const peerByChat = socket.data.peerByChat || new Map();
        for (const chatId of socket.data.chatIdSet) {
          const peerId = peerByChat.get(chatId);
          const peerPrefs = peerId ? await getPresencePrefs(peerId) : null;
          // Going offline isn't secret, but the "last seen" time is only sent to peers allowed to see it
          const showLastSeen = presenceVisibility(selfPrefs, peerPrefs).lastSeen;
          io.to(`chat:${chatId}`).emit('presence:offline', { chatId, userId: user.userId, lastSeenAt: showLastSeen ? lastSeenAt : null });
        }
      }
    });
  });

  return io;
}

module.exports = { attachSocketServer };
