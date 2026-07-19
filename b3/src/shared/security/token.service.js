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
    ...baseClaims(user),
    tokenType: 'refresh',
    tv: Number(user.tokenVersion || 0)
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
  if (result.payload.tokenType !== 'refresh') {
    throw new Error('Invalid token type');
  }
  return result.payload;
}

function userFromClaims(claims) {
  return {
    userId: Number(claims.sub),
    username: claims.username,
    displayName: claims.displayName || claims.username,
    isAdmin: Boolean(claims.isAdmin),
    tokenVersion: Number(claims.tv || 0)
  };
}

module.exports = {
  signAccessToken,
  signRefreshToken,
  verifyAccessToken,
  verifyRefreshToken,
  userFromClaims
};
