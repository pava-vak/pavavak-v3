// Voice & video calls: short-lived TURN credentials + signaling relay.
//
// Media is peer-to-peer and end-to-end encrypted by WebRTC (DTLS-SRTP); the server only relays
// the signaling (SDP offer/answer and ICE candidates) and mints time-limited TURN credentials.
const crypto = require('crypto');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { env } = require('../../config/env');
const realtime = require('../../realtime/eventEmitter');
const { isUserOnline } = require('../../realtime/connectionRegistry');

const CRED_TTL = 3600; // seconds a TURN credential is valid

/** ICE servers for a client: public STUN + our coturn (time-limited HMAC credential). */
function iceServersFor(userId) {
  const servers = [{ urls: 'stun:stun.l.google.com:19302' }];
  const host = env.TURN_HOST;
  if (host) {
    servers.push({ urls: `stun:${host}` });
    if (env.TURN_SECRET) {
      const username = `${Math.floor(Date.now() / 1000) + CRED_TTL}:${userId}`;
      const credential = crypto.createHmac('sha1', env.TURN_SECRET).update(username).digest('base64');
      servers.push({
        urls: [`turn:${host}?transport=udp`, `turn:${host}?transport=tcp`],
        username,
        credential,
      });
    }
  }
  return { iceServers: servers, ttl: CRED_TTL };
}

function callsEnabled() {
  return Boolean(env.TURN_HOST);
}

function registerCallRoutes(app) {
  // Fresh ICE servers (TURN credentials expire, so clients fetch per call)
  app.get('/api/v3/calls/ice', { preHandler: requireAuth }, async (request) => ({
    success: true,
    enabled: callsEnabled(),
    ...iceServersFor(request.auth.userId),
  }));
}

/**
 * Relays call signaling for one connected socket. Every event carries the peer it is meant for;
 * we only forward between the two members and never store SDP/candidates.
 */
function registerCallSignaling(io, socket, user) {
  const to = (toUserId) => `user:${Number(toUserId)}`;

  // Caller rings callee. If the callee is offline, wake their phone with a data push.
  socket.on('call:offer', (p) => {
    if (!p || !p.toUserId || !p.callId) return;
    const payload = {
      callId: String(p.callId),
      chatId: p.chatId || null,
      fromUserId: user.userId,
      fromName: user.displayName || null,
      media: p.media === 'video' ? 'video' : 'audio',
      sdp: p.sdp,
    };
    io.to(to(p.toUserId)).emit('call:incoming', payload);
    if (!isUserOnline(Number(p.toUserId))) {
      // Data-only push so a closed app can ring (the app shows the incoming-call screen)
      require('../notifications/fcm.service').sendFcmToUser(Number(p.toUserId), {
        type: 'call', callId: payload.callId, fromUserId: String(user.userId),
        fromName: payload.fromName || '', media: payload.media,
      });
    }
  });

  socket.on('call:answer', (p) => {
    if (!p || !p.toUserId || !p.callId) return;
    io.to(to(p.toUserId)).emit('call:answer', { callId: String(p.callId), fromUserId: user.userId, sdp: p.sdp });
  });

  socket.on('call:ice', (p) => {
    if (!p || !p.toUserId || !p.callId || !p.candidate) return;
    io.to(to(p.toUserId)).emit('call:ice', { callId: String(p.callId), fromUserId: user.userId, candidate: p.candidate });
  });

  socket.on('call:reject', (p) => {
    if (!p || !p.toUserId || !p.callId) return;
    io.to(to(p.toUserId)).emit('call:rejected', { callId: String(p.callId), fromUserId: user.userId, reason: p.reason || 'declined' });
  });

  socket.on('call:end', (p) => {
    if (!p || !p.toUserId || !p.callId) return;
    io.to(to(p.toUserId)).emit('call:ended', { callId: String(p.callId), fromUserId: user.userId });
  });
}

module.exports = { iceServersFor, callsEnabled, registerCallRoutes, registerCallSignaling };
