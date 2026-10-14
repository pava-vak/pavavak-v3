import { io } from 'socket.io-client';
import { socketBaseUrl } from './config.js';
import { readTokens } from './tokenStore.js';
import { refreshSession } from './apiClient.js';

let socket = null;
let listeners = new Set();
let activeChatId = '';
let connectListeners = new Set();
let refreshOnAuthError = false;
let authRefreshAttempts = 0;

function notify(event, payload) {
  for (const listener of listeners) {
    listener(event, payload);
  }
}

function rejoinActiveChat() {
  if (activeChatId && socket?.connected) {
    socket.emit('chat:join', { chatId: activeChatId });
  }
}

export function onSocketConnect(listener) {
  connectListeners.add(listener);
  return () => connectListeners.delete(listener);
}

export function connectSocket() {
  const { accessToken } = readTokens();
  if (!accessToken) return null;

  if (socket) {
    socket.auth = { token: accessToken };
    if (!socket.connected) {
      socket.connect();
    }
    return socket;
  }

  socket = io(socketBaseUrl(), {
    path: '/socket.io',
    transports: ['websocket'],
    auth: { token: accessToken },
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelayMax: 5000
  });

  socket.on('connect', () => {
    authRefreshAttempts = 0;
    rejoinActiveChat();
    for (const listener of connectListeners) {
      listener();
    }
  });

  socket.on('connect_error', async () => {
    if (refreshOnAuthError) return;
    if (authRefreshAttempts >= 2) return;
    const { accessToken } = readTokens();
    if (!accessToken) return; // not logged in — don't try to refresh
    refreshOnAuthError = true;
    authRefreshAttempts += 1;
    try {
      // Refresh token is in the HttpOnly cookie — just call refresh
      await refreshSession();
      socket.auth = { token: readTokens().accessToken };
      socket.connect();
    } catch {
      socket.disconnect();
    } finally {
      refreshOnAuthError = false;
    }
  });

  const relay = (event) => {
    socket.on(event, (payload) => {
      notify(event, payload);
    });
  };

  [
    'message:new',
    'message:deleted',
    'message:edited',
    'chat:new',
    'chat:updated',
    'chat:removed',
    'message:delivered',
    'message:read',
    'message:reaction',
    'chat:pinned',
    'poll:voted',
    'typing:start',
    'typing:stop',
    'presence:online',
    'presence:offline'
  ].forEach(relay);

  return socket;
}

export function disconnectSocket() {
  activeChatId = '';
  socket?.disconnect();
  socket = null;
}

export function joinChat(chatId) {
  activeChatId = chatId || '';
  socket?.emit('chat:join', { chatId: activeChatId });
}

export function emitTypingStart(chatId) {
  socket?.emit('typing:start', { chatId });
}

export function emitTypingStop(chatId) {
  socket?.emit('typing:stop', { chatId });
}

export function subscribeSocket(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function updateSocketToken(accessToken) {
  if (!socket) return;
  socket.auth = { token: accessToken };
  if (!socket.connected) {
    socket.connect();
  } else {
    rejoinActiveChat();
  }
}

export function getSocketStatus() {
  if (!socket) return 'disconnected';
  return socket.connected ? 'connected' : 'connecting';
}
