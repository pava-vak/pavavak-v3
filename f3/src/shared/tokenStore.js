const ACCESS_KEY = 'pavav3.accessToken';
const REFRESH_KEY = 'pavav3.refreshToken';
const USER_KEY = 'pavav3.user';

export function readTokens() {
  return {
    accessToken: window.localStorage.getItem(ACCESS_KEY) || '',
    refreshToken: window.localStorage.getItem(REFRESH_KEY) || ''
  };
}

export function writeTokens(tokens) {
  window.localStorage.setItem(ACCESS_KEY, tokens.accessToken || '');
  window.localStorage.setItem(REFRESH_KEY, tokens.refreshToken || '');
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
  window.localStorage.removeItem(REFRESH_KEY);
  window.localStorage.removeItem(USER_KEY);
}
