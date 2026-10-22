// Firebase Cloud Messaging (HTTP v1) for the Android app.
//
// Privacy: the payload carries only { type, chatId } as data. No message text, names or
// previews ever go through Google; the app decides what to show from what it already knows.
//
// Configured by FIREBASE_SERVICE_ACCOUNT_PATH (a service-account JSON file kept outside git).
// Without it every call is a silent no-op.
const fs = require('fs');
const { SignJWT, importPKCS8 } = require('jose');
const { env } = require('../../config/env');
const { getPool } = require('../../db/pool');

let account = null;
let accountLoaded = false;
let cachedToken = null; // { value, expiresAt }

function loadAccount() {
  if (accountLoaded) return account;
  accountLoaded = true;
  const path = env.FIREBASE_SERVICE_ACCOUNT_PATH;
  if (!path) return null;
  try {
    const json = JSON.parse(fs.readFileSync(path, 'utf8'));
    if (json.client_email && json.private_key && json.project_id) account = json;
    else console.error('[fcm] service account file is missing client_email/private_key/project_id');
  } catch (err) {
    console.error('[fcm] could not read service account file:', err.message);
  }
  return account;
}

function isConfigured() {
  return Boolean(loadAccount());
}

async function ensureTable() {
  if (!env.DATABASE_URL) return;
  await getPool().query(
    `create table if not exists v3_fcm_tokens (
       token text primary key,
       user_id bigint not null,
       updated_at timestamptz not null default now()
     )`
  );
  await getPool().query('create index if not exists v3_fcm_tokens_user_idx on v3_fcm_tokens(user_id)');
}

async function saveToken(userId, token) {
  // A token belongs to one device; if another account signs in there, it moves to that account
  await getPool().query(
    `insert into v3_fcm_tokens (token, user_id, updated_at) values ($1, $2, now())
     on conflict (token) do update set user_id = excluded.user_id, updated_at = now()`,
    [token, Number(userId)]
  );
}

async function removeToken(userId, token) {
  await getPool().query('delete from v3_fcm_tokens where token = $1 and user_id = $2', [token, Number(userId)]);
}

async function accessToken() {
  if (cachedToken && cachedToken.expiresAt > Date.now() + 60_000) return cachedToken.value;
  const acct = loadAccount();
  const key = await importPKCS8(acct.private_key, 'RS256');
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: 'https://www.googleapis.com/auth/firebase.messaging' })
    .setProtectedHeader({ alg: 'RS256', typ: 'JWT' })
    .setIssuer(acct.client_email)
    .setAudience('https://oauth2.googleapis.com/token')
    .setIssuedAt(now)
    .setExpirationTime(now + 3600)
    .sign(key);
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion })
  });
  if (!res.ok) throw new Error(`FCM auth failed (${res.status})`);
  const json = await res.json();
  cachedToken = { value: json.access_token, expiresAt: Date.now() + (json.expires_in || 3600) * 1000 };
  return cachedToken.value;
}

async function sendToToken(token, data) {
  const acct = loadAccount();
  const res = await fetch(`https://fcm.googleapis.com/v1/projects/${acct.project_id}/messages:send`, {
    method: 'POST',
    headers: { authorization: `Bearer ${await accessToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      message: {
        token,
        data,
        // Data-only + high priority wakes the app so it can decide what (if anything) to show
        android: { priority: 'high', ttl: '86400s' }
      }
    })
  });
  if (res.ok) return true;
  const body = await res.text().catch(() => '');
  // Uninstalled app or rotated token: forget it
  if (res.status === 404 || body.includes('UNREGISTERED') || body.includes('not a valid FCM registration token')) {
    await getPool().query('delete from v3_fcm_tokens where token = $1', [token]).catch(() => {});
  } else {
    console.error('[fcm] send failed', res.status, body.slice(0, 200));
  }
  return false;
}

/** Wakes every Android device of [userId]. Never throws. */
async function sendFcmToUser(userId, data) {
  if (!isConfigured()) return;
  try {
    const { rows } = await getPool().query('select token from v3_fcm_tokens where user_id = $1', [Number(userId)]);
    const payload = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    await Promise.allSettled(rows.map((r) => sendToToken(r.token, payload)));
  } catch (err) {
    console.error('[fcm] sendFcmToUser failed:', err.message);
  }
}

/** Wakes every registered device — for app-wide notices like a new version. Never throws. */
async function sendFcmToAll(data) {
  if (!isConfigured()) return { sent: 0, total: 0 };
  try {
    const { rows } = await getPool().query('select token from v3_fcm_tokens');
    const payload = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, String(v)]));
    const results = await Promise.allSettled(rows.map((r) => sendToToken(r.token, payload)));
    const sent = results.filter((r) => r.status === 'fulfilled' && r.value).length;
    return { sent, total: rows.length };
  } catch (err) {
    console.error('[fcm] sendFcmToAll failed:', err.message);
    return { sent: 0, total: 0 };
  }
}

module.exports = { ensureTable, isConfigured, saveToken, removeToken, sendFcmToUser, sendFcmToAll };
