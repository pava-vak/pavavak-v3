const { SignJWT, jwtVerify } = require('jose');
const { env } = require('../../config/env');

const accessSecret = new TextEncoder().encode(env.JWT_ACCESS_SECRET);
const refreshSecret = new TextEncoder().encode(env.JWT_REFRESH_SECRET);

function baseClaims(user) {
  return {
    sub: String(user.userId),
    username: user.username,
    displayName: user.displayName,
    isAdmin: Boolean(user.isAdmin)
  };
}

async function signAccessToken(user) {
  return new SignJWT(baseClaims(user))
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(env.JWT_ACCESS_TTL)
    .sign(accessSecret);
}

async function signRefreshToken(user) {
  return new SignJWT({
    sub: String(user.userId),
    username: user.username,
    tokenType: 'refresh'
  })
    .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
    .setIssuedAt()
    .setExpirationTime(env.JWT_REFRESH_TTL)
    .sign(refreshSecret);
}

async function verifyAccessToken(token) {
  const result = await jwtVerify(token, accessSecret);
  return result.payload;
}

async function verifyRefreshToken(token) {
  const result = await jwtVerify(token, refreshSecret);
  return result.payload;
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken
};
