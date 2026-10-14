import { config } from './config.js';
import { clearTokens, readTokens, writeTokens, readUser, writeUser } from './tokenStore.js';
import { updateSocketToken } from './socketClient.js';

export async function uploadMedia({ data, mimeType }) {
  return apiRequest('/api/v3/media/upload', {
    method: 'POST',
    body: JSON.stringify({ data, mimeType })
  });
}

export async function uploadBinaryBlob(blob, mimeType, endpoint = '/api/v3/media/upload-binary') {
  const { accessToken } = readTokens();
  const url = `${config.apiBaseUrl}${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': mimeType, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: blob
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Upload failed');
  return json;
}

export async function uploadVideoBlob(blob, mimeType) {
  const { accessToken } = readTokens();
  const url = `${config.apiBaseUrl}/api/v3/media/upload-video`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: {
      'Content-Type': mimeType,
      ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {})
    },
    body: blob
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Upload failed');
  return json;
}

export async function requestMediaBlob(fileId) {
  const { accessToken } = readTokens();
  const url = `${config.apiBaseUrl}/api/v3/media/${encodeURIComponent(fileId)}`;
  const response = await fetch(url, {
    credentials: 'include',
    headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {}
  });
  if (!response.ok) throw new Error('Media not accessible');
  return response.blob();
}

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
    credentials: 'include',
    headers
  });

  const payload = await parseResponse(response);

  if (response.status === 401 && allowRefresh && !path.endsWith('/auth/refresh')) {
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
  // Refresh token is in the HttpOnly cookie — no body needed
  const result = await request('/api/v3/auth/refresh', {
    method: 'POST',
    body: JSON.stringify({})
  }, false);
  writeTokens(result.tokens);
  if (result.user) {
    writeUser(result.user);
  }
  updateSocketToken(result.tokens.accessToken);
  return result;
}

export async function logout() {
  try {
    // Server clears the HttpOnly cookie via Set-Cookie; credentials: 'include' sends it
    await request('/api/v3/auth/logout', { method: 'POST', body: JSON.stringify({}) }, false);
  } catch {
    // best-effort — clear local tokens regardless
  }
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

export async function openViewOnceMessage(messageId) {
  return request(`/api/v3/messages/${encodeURIComponent(messageId)}/view-once-open`, { method: 'POST' });
}

export async function updateProfile(input) {
  return apiRequest('/api/v3/users/me', {
    method: 'PUT',
    body: JSON.stringify(input)
  });
}

export async function changePassword(input) {
  return request('/api/v3/auth/change-password', {
    method: 'PUT',
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

export async function requestAdminCreateUser({ username, displayName, password }) {
  return request('/api/v3/admin/users', {
    method: 'POST',
    body: JSON.stringify({ username, displayName, password })
  });
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

export async function requestAdminToggleDisabled(userId, disabled) {
  return request(`/api/v3/admin/users/${userId}/disable`, {
    method: 'PUT',
    body: JSON.stringify({ disabled })
  });
}

export async function requestAdminCleanSeedData() {
  return request('/api/v3/admin/seed-data', { method: 'DELETE' });
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

export async function requestDeleteMessage(messageId) {
  return request(`/api/v3/messages/${encodeURIComponent(messageId)}`, { method: 'DELETE' });
}

export async function requestDeleteChat(chatId) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}`, { method: 'DELETE' });
}

export async function requestBroadcastUpdate() {
  return apiRequest('/api/v3/admin/broadcast-update', { method: 'POST' });
}

export async function requestClearChat(chatId) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/messages`, { method: 'DELETE' });
}

export function getCachedUser() {
  return readUser();
}

// ── New feature API calls ──────────────────────────────────────────────────

export async function reactToMessage(messageId, emoji) {
  return request(`/api/v3/messages/${encodeURIComponent(messageId)}/react`, {
    method: 'POST', body: JSON.stringify({ emoji })
  });
}

export async function fetchChatReactions(chatId) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/reactions`);
}

export async function editMessage(messageId, text) {
  return request(`/api/v3/messages/${encodeURIComponent(messageId)}`, {
    method: 'PUT', body: JSON.stringify({ text })
  });
}

export async function forwardMessage(messageId, chatId) {
  return request(`/api/v3/messages/${encodeURIComponent(messageId)}/forward`, {
    method: 'POST', body: JSON.stringify({ chatId })
  });
}

export async function pinMessage(chatId, messageId) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/pin`, {
    method: 'PUT', body: JSON.stringify({ messageId })
  });
}

export async function fetchPinnedMessage(chatId) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/pin`);
}

export async function archiveChat(chatId, archived) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/archive`, {
    method: 'PUT', body: JSON.stringify({ archived })
  });
}

export async function muteChat(chatId, muted) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/mute`, {
    method: 'PUT', body: JSON.stringify({ muted })
  });
}

export async function setChatBackground(chatId, background) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/background`, {
    method: 'PUT', body: JSON.stringify({ background })
  });
}

export async function fetchPresence(userId) {
  return request(`/api/v3/users/${encodeURIComponent(userId)}/presence`);
}

export async function globalSearch(q) {
  return request(`/api/v3/search?q=${encodeURIComponent(q)}`);
}

export async function fetchLinkPreview(url) {
  return request(`/api/v3/link-preview?url=${encodeURIComponent(url)}`);
}

export async function createGroupChat(title, memberIds) {
  return request('/api/v3/chats/group', { method: 'POST', body: JSON.stringify({ title, memberIds }) });
}

export async function renameGroup(chatId, title) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/group/title`, {
    method: 'PUT', body: JSON.stringify({ title })
  });
}

export async function addGroupMember(chatId, userId) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/group/members`, {
    method: 'POST', body: JSON.stringify({ userId })
  });
}

export async function removeGroupMember(chatId, userId) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/group/members/${encodeURIComponent(userId)}`, {
    method: 'DELETE'
  });
}

export async function createPoll(chatId, question, options) {
  return request('/api/v3/polls', { method: 'POST', body: JSON.stringify({ chatId, question, options }) });
}

export async function votePoll(messageId, optionIndex) {
  return request(`/api/v3/polls/${encodeURIComponent(messageId)}/vote`, {
    method: 'POST', body: JSON.stringify({ optionIndex })
  });
}

export async function fetchPoll(messageId) {
  return request(`/api/v3/polls/${encodeURIComponent(messageId)}`);
}

export async function fetchScheduledMessages() {
  return request('/api/v3/scheduled-messages');
}

export async function scheduleMessage(chatId, text, scheduledAt) {
  return request('/api/v3/scheduled-messages', {
    method: 'POST', body: JSON.stringify({ chatId, text, scheduledAt })
  });
}

export async function cancelScheduledMessage(id) {
  return request(`/api/v3/scheduled-messages/${encodeURIComponent(id)}`, { method: 'DELETE' });
}

export async function fetchChatMembers(chatId) {
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/members`);
}

export async function uploadAvatar(blob, mimeType) {
  const { accessToken } = readTokens();
  const url = `${config.apiBaseUrl}/api/v3/media/upload-binary`;
  const response = await fetch(url, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': mimeType, ...(accessToken ? { Authorization: `Bearer ${accessToken}` } : {}) },
    body: blob
  });
  const json = await response.json();
  if (!response.ok) throw new Error(json.error || 'Upload failed');
  return json;
}

export async function fetchChatMedia(chatId, cursor = null) {
  const params = new URLSearchParams({ limit: '60' });
  if (cursor) params.set('cursor', cursor);
  return request(`/api/v3/chats/${encodeURIComponent(chatId)}/media?${params}`);
}

export async function fetchAdminChatMedia(chatId, cursor = null) {
  const params = new URLSearchParams({ limit: '60' });
  if (cursor) params.set('cursor', cursor);
  return request(`/api/v3/admin/chats/${encodeURIComponent(chatId)}/media?${params}`);
}

export async function starMessage(messageId) {
  return request(`/api/v3/messages/${encodeURIComponent(messageId)}/star`, { method: 'POST' });
}
export async function unstarMessage(messageId) {
  return request(`/api/v3/messages/${encodeURIComponent(messageId)}/star`, { method: 'DELETE' });
}
export async function fetchStarredMessages() {
  return request('/api/v3/starred-messages');
}
