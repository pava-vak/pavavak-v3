const { verifyAccessToken } = require('../shared/security/token.service');

async function authenticateSocket(token) {
  if (!token) {
    throw new Error('Missing token');
  }

  const claims = await verifyAccessToken(token);
  return {
    userId: Number(claims.sub),
    username: claims.username,
    displayName: claims.displayName || claims.username,
    isAdmin: Boolean(claims.isAdmin)
  };
}

module.exports = { authenticateSocket };
