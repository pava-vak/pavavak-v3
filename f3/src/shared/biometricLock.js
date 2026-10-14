// Biometric (WebAuthn) removed — to be rewritten.
// This file now handles only PIN lock and the lock-enabled flag.

const ENABLED_KEY = 'pava-app-lock-enabled';

function bufferToB64(buf) {
  const arr = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str);
}

export function isEnabled() {
  return localStorage.getItem(ENABLED_KEY) === 'true';
}

export function disable() {
  localStorage.removeItem(ENABLED_KEY);
  localStorage.removeItem('pava-pin-hash');
  localStorage.removeItem('pava-pin-salt');
}

// Lock timer: 0 = immediate, 60 = 1 min, 300 = 5 min, 900 = 15 min
export function getLockTimer() {
  return parseInt(localStorage.getItem('pava-lock-timer') || '0', 10);
}
export function setLockTimer(seconds) {
  localStorage.setItem('pava-lock-timer', String(seconds));
}

// ── PIN ──────────────────────────────────────────────────────────────────────

async function hashPinPbkdf2(pin, salt) {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']
  );
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 200000 },
    keyMaterial, 256
  );
  return '__pbkdf2__' + bufferToB64(bits);
}

async function hashPinLegacy(pin, salt) {
  const data = new TextEncoder().encode(pin + salt);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return bufferToB64(buf);
}

export async function setPin(pin) {
  const saltBytes = crypto.getRandomValues(new Uint8Array(16));
  const salt = bufferToB64(saltBytes.buffer);
  const hash = await hashPinPbkdf2(pin, salt);
  localStorage.setItem('pava-pin-salt', salt);
  localStorage.setItem('pava-pin-hash', hash);
  localStorage.setItem(ENABLED_KEY, 'true');
}

export async function verifyPin(pin) {
  const salt = localStorage.getItem('pava-pin-salt');
  const stored = localStorage.getItem('pava-pin-hash');
  if (!salt || !stored) throw new Error('No PIN set');
  if (stored.startsWith('__pbkdf2__')) {
    const hash = await hashPinPbkdf2(pin, salt);
    if (hash !== stored) throw new Error('Incorrect PIN');
  } else {
    // Legacy SHA-256: verify then migrate to PBKDF2
    const legacyHash = await hashPinLegacy(pin, salt);
    if (legacyHash !== stored) throw new Error('Incorrect PIN');
    const newSaltBytes = crypto.getRandomValues(new Uint8Array(16));
    const newSalt = btoa(String.fromCharCode(...newSaltBytes));
    const newHash = await hashPinPbkdf2(pin, newSalt);
    localStorage.setItem('pava-pin-salt', newSalt);
    localStorage.setItem('pava-pin-hash', newHash);
  }
}

export function hasPin() {
  return !!(localStorage.getItem('pava-pin-hash') && localStorage.getItem('pava-pin-salt'));
}

export function clearPin() {
  localStorage.removeItem('pava-pin-hash');
  localStorage.removeItem('pava-pin-salt');
  localStorage.removeItem(ENABLED_KEY);
}
