// Refresh token is now an HttpOnly cookie — only the short-lived access token lives in localStorage.
const ACCESS_KEY = 'pavav3.accessToken';
const USER_KEY   = 'pavav3.user';

export function readTokens() {
  return {
    accessToken: window.localStorage.getItem(ACCESS_KEY) || '',
  };
}

export function writeTokens(tokens) {
  if (tokens.accessToken) {
    window.localStorage.setItem(ACCESS_KEY, tokens.accessToken);
  }
  // refreshToken is ignored — it's set as an HttpOnly cookie by the server
}

export function readUser() {
  const raw = window.localStorage.getItem(USER_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export function writeUser(user) {
  if (!user) {
    window.localStorage.removeItem(USER_KEY);
    return;
  }
  window.localStorage.setItem(USER_KEY, JSON.stringify(user));
}

export function clearTokens() {
  window.localStorage.removeItem(ACCESS_KEY);
  window.localStorage.removeItem(USER_KEY);
  // Also clear legacy key if it exists from before the HttpOnly migration
  window.localStorage.removeItem('pavav3.refreshToken');
}
