import {
  biometricStatus,
  biometricEnrollStart,
  biometricEnrollFinish,
  biometricVerifyStart,
  biometricVerifyFinish,
  biometricRevoke
} from './apiClient.js';

// ── Base64url helpers ─────────────────────────────────────────────────────────

function bufferToBase64url(buf) {
  const bytes = buf instanceof ArrayBuffer ? new Uint8Array(buf) : buf;
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function base64urlToUint8Array(str) {
  const padded = str.replace(/-/g, '+').replace(/_/g, '/');
  const b64 = padded.padEnd(padded.length + (4 - padded.length % 4) % 4, '=');
  const raw = atob(b64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

// Serialize a WebAuthn credential into JSON for the server
function serializeCredential(cred) {
  const r = cred.response;
  const base = { id: cred.id, rawId: bufferToBase64url(cred.rawId), type: cred.type };

  if (r.attestationObject !== undefined) {
    return {
      ...base,
      response: {
        clientDataJSON:    bufferToBase64url(r.clientDataJSON),
        attestationObject: bufferToBase64url(r.attestationObject),
        transports:        r.getTransports ? r.getTransports() : []
      }
    };
  }

  return {
    ...base,
    response: {
      clientDataJSON:    bufferToBase64url(r.clientDataJSON),
      authenticatorData: bufferToBase64url(r.authenticatorData),
      signature:         bufferToBase64url(r.signature),
      userHandle:        r.userHandle ? bufferToBase64url(r.userHandle) : null
    }
  };
}

// Convert base64url challenge/ids from server options into Uint8Arrays for WebAuthn
function prepareCreationOptions(opts) {
  return {
    ...opts,
    challenge: base64urlToUint8Array(opts.challenge),
    user: { ...opts.user, id: base64urlToUint8Array(opts.user.id) },
    excludeCredentials: (opts.excludeCredentials || []).map(c => ({ ...c, id: base64urlToUint8Array(c.id) }))
  };
}

function prepareRequestOptions(opts) {
  return {
    ...opts,
    challenge: base64urlToUint8Array(opts.challenge),
    allowCredentials: (opts.allowCredentials || []).map(c => ({ ...c, id: base64urlToUint8Array(c.id) }))
  };
}

// ── WebAuthn support ───────────────────────────────────────────────────────────

export function isSupported() {
  return !!(window.PublicKeyCredential && navigator.credentials?.create && navigator.credentials?.get);
}

export async function isPlatformAvailable() {
  if (!isSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

// ── Enrollment status ─────────────────────────────────────────────────────────

const ENROLLED_CACHE = 'pava-bio-enrolled';
const ENABLED_KEY = 'pava-app-lock-enabled';

// Quick sync check from local cache (use to avoid a network hit on boot)
export function hasEnrolledLocally() {
  return localStorage.getItem(ENROLLED_CACHE) === '1';
}

// Authoritative async check from server; updates local cache
export async function checkEnrolled() {
  try {
    const res = await biometricStatus();
    const enrolled = Boolean(res?.enrolled);
    localStorage.setItem(ENROLLED_CACHE, enrolled ? '1' : '0');
    return enrolled;
  } catch {
    return hasEnrolledLocally();
  }
}

// ── Enroll ────────────────────────────────────────────────────────────────────

export async function enroll() {
  const { options } = await biometricEnrollStart();
  if (!options) throw new Error('No registration options from server');

  let credential;
  try {
    credential = await navigator.credentials.create({ publicKey: prepareCreationOptions(options) });
  } catch (err) {
    throw new Error(err.name === 'NotAllowedError' ? 'Biometric setup was cancelled' : err.message);
  }

  await biometricEnrollFinish(serializeCredential(credential));
  localStorage.setItem(ENROLLED_CACHE, '1');
  localStorage.setItem(ENABLED_KEY, 'true');
}

// ── Verify (unlock) ───────────────────────────────────────────────────────────

export async function verify() {
  const { options } = await biometricVerifyStart();
  if (!options) throw new Error('No authentication options from server');

  let assertion;
  try {
    assertion = await navigator.credentials.get({ publicKey: prepareRequestOptions(options) });
  } catch (err) {
    throw new Error(err.name === 'NotAllowedError' ? 'Biometric cancelled' : err.message);
  }

  await biometricVerifyFinish(serializeCredential(assertion));
}

// ── Revoke ────────────────────────────────────────────────────────────────────

export async function revoke() {
  await biometricRevoke();
  localStorage.removeItem(ENROLLED_CACHE);
}

// ── Lock state ────────────────────────────────────────────────────────────────

export function isEnabled() {
  return localStorage.getItem(ENABLED_KEY) === 'true';
}

export function disable() {
  localStorage.removeItem(ENABLED_KEY);
  localStorage.removeItem('pava-pin-hash');
  localStorage.removeItem('pava-pin-salt');
  localStorage.removeItem(ENROLLED_CACHE);
}

export function getLockTimer() {
  return parseInt(localStorage.getItem('pava-lock-timer') || '0', 10);
}
export function setLockTimer(seconds) {
  localStorage.setItem('pava-lock-timer', String(seconds));
}

// ── PIN ───────────────────────────────────────────────────────────────────────

function _b64(buf) {
  const arr = new Uint8Array(buf);
  let s = '';
  for (const b of arr) s += String.fromCharCode(b);
  return btoa(s);
}

async function _hashPbkdf2(pin, salt) {
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
  const bits = await crypto.subtle.deriveBits(
    { name: 'PBKDF2', hash: 'SHA-256', salt: new TextEncoder().encode(salt), iterations: 200000 },
    key, 256
  );
  return '__pbkdf2__' + _b64(bits);
}

async function _hashLegacy(pin, salt) {
  return _b64(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(pin + salt)));
}

export async function setPin(pin) {
  const salt = _b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
  localStorage.setItem('pava-pin-salt', salt);
  localStorage.setItem('pava-pin-hash', await _hashPbkdf2(pin, salt));
  localStorage.setItem(ENABLED_KEY, 'true');
}

export async function verifyPin(pin) {
  const salt   = localStorage.getItem('pava-pin-salt');
  const stored = localStorage.getItem('pava-pin-hash');
  if (!salt || !stored) throw new Error('No PIN set');

  if (stored.startsWith('__pbkdf2__')) {
    if (await _hashPbkdf2(pin, salt) !== stored) throw new Error('Incorrect PIN');
  } else {
    // Migrate legacy SHA-256 to PBKDF2
    if (await _hashLegacy(pin, salt) !== stored) throw new Error('Incorrect PIN');
    const newSalt = _b64(crypto.getRandomValues(new Uint8Array(16)).buffer);
    localStorage.setItem('pava-pin-salt', newSalt);
    localStorage.setItem('pava-pin-hash', await _hashPbkdf2(pin, newSalt));
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
