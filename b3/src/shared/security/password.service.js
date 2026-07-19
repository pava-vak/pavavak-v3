const crypto = require('crypto');
const { promisify } = require('util');

const pbkdf2 = promisify(crypto.pbkdf2);

const ITERATIONS = 120000;
const KEY_LENGTH = 32;
const DIGEST = 'sha256';

async function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('base64url');
  const hash = (await pbkdf2(String(password), salt, ITERATIONS, KEY_LENGTH, DIGEST)).toString('base64url');
  return `pbkdf2:${DIGEST}:${ITERATIONS}:${salt}:${hash}`;
}

async function verifyPassword(password, storedHash) {
  const [scheme, digest, iterations, salt, expected] = String(storedHash || '').split(':');
  if (scheme !== 'pbkdf2' || !digest || !iterations || !salt || !expected) {
    return false;
  }

  const actual = (await pbkdf2(String(password), salt, Number(iterations), KEY_LENGTH, digest)).toString('base64url');
  if (actual.length !== expected.length) {
    return false;
  }
  return crypto.timingSafeEqual(Buffer.from(actual), Buffer.from(expected));
}

module.exports = { hashPassword, verifyPassword };
