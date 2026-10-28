// Group calls: room-based signaling for multi-party WebRTC.
//
// Today the media is a full mesh — every participant opens a direct, end-to-end encrypted
// (DTLS-SRTP) PeerConnection to every other participant, so the server never sees call media,
// exactly like the 1:1 path. The signaling here is deliberately a *room* abstraction
// (join → peer list → per-peer signal → leave) so an SFU can later replace the mesh without
// changing the client protocol: the client would just get one "peer" (the SFU) instead of N.
const { isUserOnline } = require('../../realtime/connectionRegistry');
const chatAdapter = require('../../db/chatAdapter');

// callId -> { chatId, media, initiator, title, participants: Map<userId, socketId>, createdAt }
const rooms = new Map();
const ROOM_TTL_MS = 2 * 60 * 60 * 1000; // a call can't outlive 2h of signaling silence

function pruneRoom(callId) {
  const room = rooms.get(callId);
  if (room && room.participants.size === 0) rooms.delete(callId);
}

/** The live group call for a chat, if any (so a late member can see "join ongoing call"). */
function activeCallForChat(chatId) {
  for (const [callId, room] of rooms) {
    if (room.chatId === chatId && room.participants.size > 0) {
      return { callId, media: room.media, participants: [...room.participants.keys()] };
    }
  }
  return null;
}

function registerGroupCallSignaling(io, socket, user) {
  const toUser = (id) => `user:${Number(id)}`;
  const self = Number(user.userId);

  // Caller opens a group call and rings every other member of the group.
  socket.on('gcall:start', async (p) => {
    if (!p || !p.chatId || !p.callId) return;
    const callId = String(p.callId);
    const chatId = String(p.chatId);
    const media = p.media === 'video' ? 'video' : 'audio';

    let memberIds;
    try { memberIds = (await chatAdapter.getConversationMemberUserIds(chatId)).map(Number); }
    catch { return; }
    if (!memberIds.includes(self)) return; // caller must belong to the group

    if (!rooms.has(callId)) {
      rooms.set(callId, {
        chatId, media, initiator: self, title: p.title || null,
        participants: new Map(), createdAt: Date.now(),
      });
    }
    const room = rooms.get(callId);
    room.participants.set(self, socket.id);

    const payload = {
      callId, chatId, media,
      fromUserId: self, fromName: user.displayName || null,
      title: p.title || null,
    };
    for (const id of memberIds) {
      if (id === self) continue;
      io.to(toUser(id)).emit('gcall:incoming', payload);
      if (!isUserOnline(id)) {
        require('../notifications/fcm.service').sendFcmToUser(id, {
          type: 'call', group: '1', callId, chatId,
          fromUserId: String(self), fromName: payload.title || payload.fromName || '', media,
        });
      }
    }
    socket.emit('gcall:started', { callId, participants: [...room.participants.keys()] });
  });

  // A member accepts and joins the room. They receive the current peer list and initiate offers.
  socket.on('gcall:join', (p) => {
    if (!p || !p.callId) return;
    const room = rooms.get(String(p.callId));
    if (!room) { socket.emit('gcall:ended', { callId: String(p.callId) }); return; }
    const existing = [...room.participants.keys()].filter((id) => id !== self);
    room.participants.set(self, socket.id);
    // Tell the joiner who is already here (it will offer to each of them)
    socket.emit('gcall:peers', { callId: String(p.callId), peers: existing });
    // Tell everyone else a new peer arrived (they wait for the joiner's offer)
    for (const id of existing) {
      io.to(toUser(id)).emit('gcall:peer-joined', { callId: String(p.callId), userId: self, name: user.displayName || null });
    }
  });

  // Pairwise SDP/ICE relay between two participants of a call.
  socket.on('gcall:signal', (p) => {
    if (!p || !p.callId || !p.toUserId || !p.kind) return;
    const room = rooms.get(String(p.callId));
    if (!room || !room.participants.has(self)) return;
    io.to(toUser(p.toUserId)).emit('gcall:signal', {
      callId: String(p.callId), fromUserId: self, kind: p.kind, payload: p.payload,
    });
  });

  // A member declines the ring (tells the room so UIs can show "declined" — optional nicety).
  socket.on('gcall:decline', (p) => {
    if (!p || !p.callId) return;
    const room = rooms.get(String(p.callId));
    if (!room) return;
    for (const id of room.participants.keys()) {
      io.to(toUser(id)).emit('gcall:peer-declined', { callId: String(p.callId), userId: self });
    }
  });

  function leave(callId) {
    const room = rooms.get(callId);
    if (!room || !room.participants.has(self)) return;
    room.participants.delete(self);
    for (const id of room.participants.keys()) {
      io.to(toUser(id)).emit('gcall:peer-left', { callId, userId: self });
    }
    pruneRoom(callId);
  }

  socket.on('gcall:leave', (p) => { if (p && p.callId) leave(String(p.callId)); });

  socket.on('disconnect', () => {
    // Drop this user from every room they were in (another of their devices may still be in).
    for (const [callId, room] of rooms) {
      if (room.participants.get(self) === socket.id) leave(callId);
    }
  });
}

/** Expose "is there an ongoing group call here?" for the chat detail endpoint. */
function registerGroupCallRoutes(app) {
  const { requireAuth } = require('../../shared/security/auth.preHandler');
  app.get('/api/v3/chats/:chatId/call', { preHandler: requireAuth }, async (request) => ({
    success: true, call: activeCallForChat(String(request.params.chatId)),
  }));
}

module.exports = { registerGroupCallSignaling, registerGroupCallRoutes, activeCallForChat };
