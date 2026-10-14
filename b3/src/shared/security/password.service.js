const crypto = require('crypto');
const { promisify } = require('util');

const pbkdf2 = promisify(crypto.pbkdf2);

// Lazy-load argon2 so the server still starts if the native binding isn't compiled yet
let argon2;
try { argon2 = require('argon2'); } catch { argon2 = null; }

const ARGON2_OPTIONS = {
  type: argon2?.argon2id ?? 2,
  memoryCost: 65536, // 64 MB — makes GPU attacks ~1000× harder than PBKDF2
  timeCost: 3,
  parallelism: 2,
};

// Legacy PBKDF2 constants (used only to verify existing hashes)
const PBKDF2_KEY_LENGTH = 32;

async function hashPassword(password) {
  if (argon2) {
    const hash = await argon2.hash(String(password), ARGON2_OPTIONS);
    return `argon2:${hash}`;
  }
  // Fallback to PBKDF2 if argon2 native binding unavailable
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = (await pbkdf2(String(password), salt, 120000, PBKDF2_KEY_LENGTH, 'sha256')).toString('base64url');
  return `pbkdf2:sha256:120000:${salt}:${hash}`;
}

async function verifyPassword(password, storedHash) {
  const str = String(storedHash || '');

  // Argon2id hashes — new format
  if (str.startsWith('argon2:')) {
    if (!argon2) return false;
    try {
      return await argon2.verify(str.slice(7), String(password));
    } catch {
      return false;
    }
  }

  // Legacy PBKDF2 — still valid for existing accounts; re-hashed to argon2 on next login
  if (str.startsWith('pbkdf2:')) {
    const [, digest, iterations, salt, expected] = str.split(':');
    if (!digest || !iterations || !salt || !expected) return false;
    const actual = (await pbkdf2(String(password), salt, Number(iterations), PBKDF2_KEY_LENGTH, digest)).toString('base64url');
    if (actual.length !== expected.length) return false;
    return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
  }

  return false;
}

// Returns true if the stored hash should be re-hashed (old scheme, or argon2 unavailable fallback)
function needsRehash(storedHash) {
  if (!argon2) return false;
  const str = String(storedHash || '');
  if (!str.startsWith('argon2:')) return true;
  try { return argon2.needsRehash(str.slice(7), ARGON2_OPTIONS); } catch { return false; }
}

module.exports = { hashPassword, verifyPassword, needsRehash };
