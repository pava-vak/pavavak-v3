const { getPool } = require('../../db/pool');
const { env } = require('../../config/env');

function isAvailable() {
  return Boolean(env.DATABASE_URL);
}

async function ensureTable() {
  if (!isAvailable()) return;
  const db = getPool();
  await db.query(`
    CREATE TABLE IF NOT EXISTS biometric_credentials (
      id             SERIAL PRIMARY KEY,
      user_id        INTEGER NOT NULL UNIQUE,
      credential_id  TEXT    NOT NULL UNIQUE,
      public_key     TEXT    NOT NULL,
      sign_count     BIGINT  NOT NULL DEFAULT 0,
      device_type    TEXT    NOT NULL DEFAULT 'singleDevice',
      backed_up      BOOLEAN NOT NULL DEFAULT FALSE,
      transports     TEXT[]  NOT NULL DEFAULT '{}',
      created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at   TIMESTAMPTZ
    )
  `);
}

async function getCredential(userId) {
  const db = getPool();
  const { rows } = await db.query(
    'SELECT * FROM biometric_credentials WHERE user_id = $1',
    [userId]
  );
  return rows[0] || null;
}

async function saveCredential(userId, { credentialId, publicKey, signCount, deviceType, backedUp, transports }) {
  const db = getPool();
  await db.query(`
    INSERT INTO biometric_credentials
      (user_id, credential_id, public_key, sign_count, device_type, backed_up, transports)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (user_id) DO UPDATE SET
      credential_id = EXCLUDED.credential_id,
      public_key    = EXCLUDED.public_key,
      sign_count    = EXCLUDED.sign_count,
      device_type   = EXCLUDED.device_type,
      backed_up     = EXCLUDED.backed_up,
      transports    = EXCLUDED.transports,
      created_at    = NOW(),
      last_used_at  = NULL
  `, [userId, credentialId, publicKey, signCount, deviceType, backedUp, transports]);
}

async function updateSignCount(userId, signCount) {
  const db = getPool();
  await db.query(
    'UPDATE biometric_credentials SET sign_count = $2, last_used_at = NOW() WHERE user_id = $1',
    [userId, signCount]
  );
}

async function deleteCredential(userId) {
  const db = getPool();
  await db.query('DELETE FROM biometric_credentials WHERE user_id = $1', [userId]);
}

module.exports = { isAvailable, ensureTable, getCredential, saveCredential, updateSignCount, deleteCredential };
