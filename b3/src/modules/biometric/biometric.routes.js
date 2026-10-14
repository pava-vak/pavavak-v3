const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const repo = require('./biometric.repository');
const { env } = require('../../config/env');
const {
  generateRegistrationOptions,
  verifyRegistrationResponse,
  generateAuthenticationOptions,
  verifyAuthenticationResponse
} = require('@simplewebauthn/server');

// ── Per-user challenge store (single PM2 process) ────────────────────────────
const challengeMap = new Map(); // userId (string) → { challenge, expiresAt }
const CHALLENGE_TTL = 2 * 60 * 1000; // 2 minutes

function storeChallenge(userId, challenge) {
  if (challengeMap.size > 2000) {
    const now = Date.now();
    for (const [k, v] of challengeMap) {
      if (now > v.expiresAt) challengeMap.delete(k);
    }
  }
  challengeMap.set(String(userId), { challenge, expiresAt: Date.now() + CHALLENGE_TTL });
}

function consumeChallenge(userId) {
  const key = String(userId);
  const entry = challengeMap.get(key);
  if (!entry) return null;
  challengeMap.delete(key);
  return Date.now() <= entry.expiresAt ? entry.challenge : null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function getRpId(request) {
  if (env.WEBAUTHN_RP_ID) return env.WEBAUTHN_RP_ID;
  try {
    return new URL(request.headers.origin).hostname;
  } catch {
    return 'localhost';
  }
}

function getOrigin(request) {
  return request.headers.origin || `http://${getRpId(request)}`;
}

// ── Input schemas ─────────────────────────────────────────────────────────────
const enrollFinishSchema = z.object({
  id:    z.string().max(1024),
  rawId: z.string().max(1024),
  response: z.object({
    clientDataJSON:    z.string(),
    attestationObject: z.string(),
    transports: z.array(z.string()).optional().default([])
  }),
  type: z.literal('public-key')
});

const verifyFinishSchema = z.object({
  id:    z.string().max(1024),
  rawId: z.string().max(1024),
  response: z.object({
    clientDataJSON:     z.string(),
    authenticatorData:  z.string(),
    signature:          z.string(),
    userHandle:         z.string().optional().nullable()
  }),
  type: z.literal('public-key')
});

// ── Route registration ────────────────────────────────────────────────────────
function registerBiometricRoutes(app) {

  // GET /api/v3/auth/biometric/status
  app.get('/api/v3/auth/biometric/status', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 60, timeWindow: '1 minute' } }
  }, async (request) => {
    if (!repo.isAvailable()) return { success: true, enrolled: false };
    const cred = await repo.getCredential(request.auth.userId);
    return { success: true, enrolled: !!cred };
  });

  // POST /api/v3/auth/biometric/enroll/start
  app.post('/api/v3/auth/biometric/enroll/start', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!repo.isAvailable()) {
      return reply.status(501).send({ success: false, error: 'Biometric not available in demo mode' });
    }

    const { userId, username, displayName } = request.auth;
    const rpId = getRpId(request);

    const existing = await repo.getCredential(userId);
    // v9 requires Buffer/Uint8Array for credential id fields; string inputs silently produce empty strings
    const excludeCredentials = existing
      ? [{ id: Buffer.from(existing.credential_id, 'base64url'), type: 'public-key', transports: existing.transports }]
      : [];

    const options = await generateRegistrationOptions({
      rpName: 'PaVa Vak',
      rpID: rpId,
      userID: Buffer.from(String(userId)),
      userName: username,
      userDisplayName: displayName,
      attestation: 'none',
      authenticatorSelection: {
        authenticatorAttachment: 'platform',
        userVerification: 'required',
        residentKey: 'preferred'
      },
      excludeCredentials,
      timeout: 60000,
      supportedAlgorithmIDs: [-7, -257] // ES256, RS256
    });

    // v9 returns user.id as Buffer — must be a base64url string for the client
    if (Buffer.isBuffer(options.user?.id)) {
      options.user = { ...options.user, id: options.user.id.toString('base64url') };
    }

    storeChallenge(userId, options.challenge);
    return { success: true, options };
  });

  // POST /api/v3/auth/biometric/enroll/finish
  app.post('/api/v3/auth/biometric/enroll/finish', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!repo.isAvailable()) {
      return reply.status(501).send({ success: false, error: 'Biometric not available in demo mode' });
    }

    const parsed = enrollFinishSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid registration response' });
    }

    const expectedChallenge = consumeChallenge(request.auth.userId);
    if (!expectedChallenge) {
      return reply.status(400).send({ success: false, error: 'Challenge expired — please try again' });
    }

    let verification;
    try {
      verification = await verifyRegistrationResponse({
        response: parsed.data,
        expectedChallenge,
        expectedOrigin: getOrigin(request),
        expectedRPID: getRpId(request),
        requireUserVerification: true
      });
    } catch (err) {
      request.log.warn({ err }, '[biometric] enroll verify failed');
      return reply.status(400).send({ success: false, error: 'Registration verification failed' });
    }

    if (!verification.verified || !verification.registrationInfo) {
      return reply.status(400).send({ success: false, error: 'Registration not verified' });
    }

    const { credentialID, credentialPublicKey, counter, credentialDeviceType, credentialBackedUp } =
      verification.registrationInfo;

    await repo.saveCredential(request.auth.userId, {
      credentialId: Buffer.from(credentialID).toString('base64url'),
      publicKey:    Buffer.from(credentialPublicKey).toString('base64'),
      signCount:    counter,
      deviceType:   credentialDeviceType,
      backedUp:     credentialBackedUp,
      transports:   parsed.data.response.transports
    });

    return { success: true };
  });

  // POST /api/v3/auth/biometric/verify/start
  app.post('/api/v3/auth/biometric/verify/start', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!repo.isAvailable()) {
      return reply.status(501).send({ success: false, error: 'Biometric not available in demo mode' });
    }

    const cred = await repo.getCredential(request.auth.userId);
    if (!cred) {
      return reply.status(404).send({ success: false, error: 'No biometric enrolled' });
    }

    const options = await generateAuthenticationOptions({
      rpID: getRpId(request),
      allowCredentials: [{
        // v9 requires Buffer/Uint8Array; string input silently produces empty string
        id: Buffer.from(cred.credential_id, 'base64url'),
        type: 'public-key',
        transports: cred.transports?.length ? cred.transports : ['internal']
      }],
      userVerification: 'required',
      timeout: 60000
    });

    storeChallenge(request.auth.userId, options.challenge);
    return { success: true, options };
  });

  // POST /api/v3/auth/biometric/verify/finish
  app.post('/api/v3/auth/biometric/verify/finish', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!repo.isAvailable()) {
      return reply.status(501).send({ success: false, error: 'Biometric not available in demo mode' });
    }

    const parsed = verifyFinishSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ success: false, error: 'Invalid authentication response' });
    }

    const expectedChallenge = consumeChallenge(request.auth.userId);
    if (!expectedChallenge) {
      return reply.status(400).send({ success: false, error: 'Challenge expired — please try again' });
    }

    const cred = await repo.getCredential(request.auth.userId);
    if (!cred) {
      return reply.status(404).send({ success: false, error: 'No biometric credential found' });
    }

    let verification;
    try {
      verification = await verifyAuthenticationResponse({
        response: parsed.data,
        expectedChallenge,
        expectedOrigin: getOrigin(request),
        expectedRPID: getRpId(request),
        requireUserVerification: true,
        authenticator: {
          credentialID:        Buffer.from(cred.credential_id, 'base64url'),
          credentialPublicKey: Buffer.from(cred.public_key, 'base64'),
          counter:             Number(cred.sign_count),
          transports:          cred.transports?.length ? cred.transports : ['internal']
        }
      });
    } catch (err) {
      request.log.warn({ err }, '[biometric] verify failed');
      return reply.status(401).send({ success: false, error: 'Verification failed — try again' });
    }

    if (!verification.verified) {
      return reply.status(401).send({ success: false, error: 'Verification failed' });
    }

    await repo.updateSignCount(request.auth.userId, verification.authenticationInfo.newCounter);
    return { success: true };
  });

  // DELETE /api/v3/auth/biometric
  app.delete('/api/v3/auth/biometric', {
    preHandler: requireAuth,
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (request, reply) => {
    if (!repo.isAvailable()) {
      return reply.status(501).send({ success: false, error: 'Not available in demo mode' });
    }
    await repo.deleteCredential(request.auth.userId);
    return { success: true };
  });
}

module.exports = { registerBiometricRoutes };
