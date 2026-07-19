import { config } from './config.js';
import { clearTokens, readTokens, writeTokens, readUser, writeUser } from './tokenStore.js';
import { updateSocketToken } from './socketClient.js';

let refreshPromise = null;
let onUnauthorized = null;

export function setUnauthorizedHandler(handler) {
  onUnauthorized = handler;
}

async function parseResponse(response) {
  return response.json().catch(() => ({
    success: false,
    error: 'Invalid JSON response'
  }));
}

export async function apiRequest(path, options = {}) {
  return request(path, options);
}

async function request(path, options = {}, allowRefresh = true) {
  const url = `${config.apiBaseUrl}${path}`;
  const tokens = readTokens();
  const headers = new Headers(options.headers || {});

  if (!headers.has('Content-Type') && options.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (tokens.accessToken) {
    headers.set('Authorization', `Bearer ${tokens.accessToken}`);
  }

  const response = await fetch(url, {
    ...options,
    headers
  });

  const payload = await parseResponse(response);

  if (response.status === 401 && allowRefresh && tokens.refreshToken && !path.endsWith('/auth/refresh')) {
    try {
      refreshPromise ??= refreshSession().finally(() => {
        refreshPromise = null;
      });
      await refreshPromise;
      return request(path, options, false);
    } catch {
      clearTokens();
      onUnauthorized?.();
      const error = new Error('Session expired');
      error.status = 401;
      throw error;
    }
  }

  if (!response.ok) {
    const error = new Error(payload.error || 'Request failed');
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

export async function devLogin(input) {
  const result = await request('/api/v3/auth/dev-login', {
    method: 'POST',
    body: JSON.stringify(input)
  }, false);
  writeTokens(result.tokens);
  writeUser(result.user);
  return result;
}

export async function login(input) {
  const result = await request('/api/v3/auth/login', {
    method: 'POST',
    body: JSON.stringify(input)
  }, false);
  writeTokens(result.tokens);
  writeUser(result.user);
  return result;
}

export async function register(input) {
  const result = await request('/api/v3/auth/register', {
    method: 'POST',
    body: JSON.stringify(input)
  }, false);
  writeTokens(result.tokens);
  writeUser(result.user);
  return result;
}

export async function fetchMe() {
  const result = await request('/api/v3/me');
  writeUser(result.user);
  return result;
}

export async function refreshSession() {
  const { refreshToken } = readTokens();
  const result = await request('/api/v3/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({ refreshToken })
  }, false);
  writeTokens(result.tokens);
  if (result.user) {
    writeUser(result.user);
  }
  updateSocketToken(result.tokens.accessToken);
  return result;
}

export function logout() {
  clearTokens();
}

export async function requestChats() {
  return request('/api/v3/chats');
}

export async function requestThread(chatId, cursor = null) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/messages${suffix}`);
}

export async function sendMessage(input) {
  return request('/api/v3/messages', {
    method: 'POST',
    body: JSON.stringify(input)
  });
}

export async function searchUsers(query = '') {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/v3/users${suffix}`);
}

export async function startDirectChat(userId) {
  return request('/api/v3/chats/direct', {
    method: 'POST',
    body: JSON.stringify({ userId })
  });
}

export async function requestAdminSummary() {
  return request('/api/v3/admin/summary');
}

export async function requestAdminChats() {
  return request('/api/v3/admin/chats');
}

export async function requestAdminResetPassword(userId) {
  return request(`/api/v3/admin/users/${userId}/reset-password`, { method: 'POST' });
}

export async function requestAdminThread(chatId, cursor = null) {
  const params = new URLSearchParams();
  if (cursor) params.set('cursor', cursor);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/v3/admin/chats/${encodeURIComponent(chatId)}/messages${suffix}`);
}

export async function requestAdminUsers(query = '') {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  const suffix = params.toString() ? `?${params.toString()}` : '';
  return request(`/api/v3/admin/users${suffix}`);
}

export async function markChatRead(chatId) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/read`, {
    method: 'POST',
    body: JSON.stringify({})
  });
}

export async function markDelivered(chatId, messageId) {
  return request(`/api/v3/messages/${encodeURIComponent(messageId)}/delivered`, {
    method: 'POST',
    body: JSON.stringify({ chatId })
  });
}

export async function markRead(chatId, messageId) {
  return request(`/api/v3/messages/${encodeURIComponent(messageId)}/read`, {
    method: 'POST',
    body: JSON.stringify({ chatId })
  });
}

export function getCachedUser() {
  return readUser();
}
