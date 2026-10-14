const { getPool } = require('../../db/pool');
const { env } = require('../../config/env');
const { randomUUID } = require('crypto');

function isAvailable() {
  return Boolean(env.DATABASE_URL);
}

async function ensureTable() {
  if (!isAvailable()) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id           TEXT PRIMARY KEY,
      user_id      INTEGER NOT NULL,
      user_agent   TEXT    NOT NULL DEFAULT '',
      ip_address   TEXT    NOT NULL DEFAULT '',
      device_name  TEXT    NOT NULL DEFAULT 'Unknown device',
      created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await getPool().query(`
    CREATE INDEX IF NOT EXISTS user_sessions_user_id_idx ON user_sessions(user_id)
  `);
}

async function createSession(userId, { userAgent = '', ip = '', deviceName = '' } = {}) {
  const id = randomUUID();
  await getPool().query(
    `INSERT INTO user_sessions (id, user_id, user_agent, ip_address, device_name)
     VALUES ($1, $2, $3, $4, $5)`,
    [id, userId, userAgent.slice(0, 512), ip.slice(0, 64), (deviceName || guessDeviceName(userAgent)).slice(0, 128)]
  );
  return id;
}

async function touchSession(sessionId) {
  if (!sessionId) return;
  await getPool().query(
    `UPDATE user_sessions SET last_used_at = NOW() WHERE id = $1`,
    [sessionId]
  ).catch(() => {});
}

async function getSession(sessionId) {
  const { rows } = await getPool().query(
    `SELECT * FROM user_sessions WHERE id = $1`,
    [sessionId]
  );
  return rows[0] || null;
}

async function listSessions(userId) {
  const { rows } = await getPool().query(
    `SELECT id, device_name, ip_address, created_at, last_used_at
     FROM user_sessions WHERE user_id = $1
     ORDER BY last_used_at DESC`,
    [userId]
  );
  return rows;
}

async function deleteSession(sessionId, userId) {
  const { rowCount } = await getPool().query(
    `DELETE FROM user_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  return rowCount > 0;
}

async function deleteAllSessions(userId) {
  await getPool().query(`DELETE FROM user_sessions WHERE user_id = $1`, [userId]);
}

function guessDeviceName(ua) {
  if (!ua) return 'Unknown device';
  if (/iPhone/i.test(ua)) return 'iPhone';
  if (/iPad/i.test(ua)) return 'iPad';
  if (/Android/i.test(ua)) {
    if (/Mobile/i.test(ua)) return 'Android Phone';
    return 'Android Tablet';
  }
  if (/Windows/i.test(ua)) return 'Windows PC';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'Mac';
  if (/Linux/i.test(ua)) return 'Linux PC';
  return 'Browser';
}

module.exports = { isAvailable, ensureTable, createSession, touchSession, getSession, listSessions, deleteSession, deleteAllSessions };
