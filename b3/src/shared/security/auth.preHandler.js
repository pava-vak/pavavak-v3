const { verifyAccessToken } = require('./token.service');

async function requireAuth(request, reply) {
  const header = request.headers.authorization || '';
  if (!header.startsWith('Bearer ')) {
    return reply.status(401).send({
      success: false,
      error: 'Unauthorized'
    });
  }

  const token = header.slice('Bearer '.length).trim();
  try {
    const claims = await verifyAccessToken(token);
    request.auth = {
      userId: Number(claims.sub),
      username: claims.username,
      displayName: claims.displayName,
      isAdmin: Boolean(claims.isAdmin)
    };
  } catch {
    return reply.status(401).send({
      success: false,
      error: 'Unauthorized'
    });
  }
}

module.exports = { requireAuth };
