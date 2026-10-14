const { verifyAccessToken, userFromClaims } = require('./token.service');

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
    request.auth = userFromClaims(claims);
  } catch {
    return reply.status(401).send({
      success: false,
      error: 'Unauthorized'
    });
  }
}

async function requireAdmin(request, reply) {
  await requireAuth(request, reply);
  if (reply.sent) return;
  if (!request.auth?.isAdmin) {
    return reply.status(403).send({ success: false, error: 'Forbidden' });
  }
}

module.exports = { requireAuth, requireAdmin };
