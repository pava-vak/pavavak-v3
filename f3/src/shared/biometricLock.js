const CRED_KEY = 'pava-webauthn-cred';
const ENABLED_KEY = 'pava-app-lock-enabled';

function randomBytes(n) {
  return crypto.getRandomValues(new Uint8Array(n));
}

function b64ToBuffer(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)).buffer;
}

function bufferToB64(buf) {
  const arr = new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < arr.length; i++) str += String.fromCharCode(arr[i]);
  return btoa(str);
}

export function isSupported() {
  return Boolean(
    window.PublicKeyCredential &&
    navigator.credentials?.create &&
    navigator.credentials?.get
  );
}

export function isEnabled() {
  return localStorage.getItem(ENABLED_KEY) === 'true';
}

// Synchronous — true if a credential is stored (enrollment happened before).
// Use this to fire verify() immediately without waiting for isPlatformAvailable().
export function hasBiometricEnrolled() {
  return !!localStorage.getItem(CRED_KEY);
}

// Slow async OS check — only use this to decide whether to show the
// "Enable Biometric" button in settings, not in the lock flow itself.
export async function isPlatformAvailable() {
  if (!isSupported()) return false;
  try {
    return await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable();
  } catch {
    return false;
  }
}

export async function enroll({ userId, username, displayName }) {
  const credential = await navigator.credentials.create({
    publicKey: {
      challenge: randomBytes(32),
      rp: { name: 'PaVa Vak', id: location.hostname },
      user: {
        id: new TextEncoder().encode(String(userId)),
        name: username,
        displayName: displayName
      },
      pubKeyCredParams: [
        { alg: -7,   type: 'public-key' },  // ES256
        { alg: -257, type: 'public-key' }   // RS256
      ],
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      timeout: 60000,
      attestation: 'none'
    }
  });

  if (!credential) throw new Error('Enrollment cancelled');
  localStorage.setItem(CRED_KEY, bufferToB64(credential.rawId));
  localStorage.setItem(ENABLED_KEY, 'true');
}

export async function verify() {
  const stored = localStorage.getItem(CRED_KEY);
  if (!stored) throw new Error('No biometric enrolled — please re-enable App Lock in Settings');

  await navigator.credentials.get({
    publicKey: {
      challenge: randomBytes(32),
      allowCredentials: [{
        id: b64ToBuffer(stored),
        type: 'public-key',
        transports: ['internal']
      }],
      userVerification: 'required',
      timeout: 60000
    }
  });
}

export function disable() {
  localStorage.removeItem(CRED_KEY);
  localStorage.removeItem(ENABLED_KEY);
  localStorage.removeItem('pava-pin-hash');
  localStorage.removeItem('pava-pin-salt');
}

export function disableBiometricOnly() {
  localStorage.removeItem(CRED_KEY);
  if (!localStorage.getItem('pava-pin-hash')) {
    localStorage.removeItem(ENABLED_KEY);
  }
}

// Lock timer: 0 = immediate, 60 = 1 min, 300 = 5 min, 900 = 15 min
export function getLockTimer() {
  return parseInt(localStorage.getItem('pava-lock-timer') || '0', 10);
}
export function setLockTimer(seconds) {
  localStorage.setItem('pava-lock-timer', String(seconds));
}

// ── PIN fallback ──────────────────────────────────────────────────────────────

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
  if (!localStorage.getItem(CRED_KEY)) {
    localStorage.removeItem(ENABLED_KEY);
  }
}
