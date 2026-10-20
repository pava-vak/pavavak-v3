const crypto = require('crypto');
const { hashPassword, verifyPassword } = require('../../shared/security/password.service');
const identity = require('../../db/identityAdapter');
const { getPool } = require('../../db/pool');

// Private admin password recovery page, reachable only at /api/v3/recovery/<RECOVERY_TOKEN>.
// Disabled unless RECOVERY_TOKEN (64 hex chars) and RECOVERY_CODE_HASH are set in the server .env.
// Any wrong/unknown token gets the app's normal 404, so the page is indistinguishable from nothing.

const MAX_FAILURES = 5;
const LOCK_WINDOW_MS = 60 * 60 * 1000;
const failures = []; // timestamps of wrong-code attempts (single PM2 process)

function config() {
  const token = process.env.RECOVERY_TOKEN || '';
  const codeHash = process.env.RECOVERY_CODE_HASH || '';
  if (!/^[a-f0-9]{64}$/.test(token) || !codeHash) return null;
  return { token, codeHash, username: process.env.RECOVERY_USERNAME || 'admin' };
}

function tokenMatches(expected, given) {
  const a = Buffer.from(expected);
  const b = Buffer.from(String(given || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function isLocked() {
  const cutoff = Date.now() - LOCK_WINDOW_MS;
  while (failures.length && failures[0] < cutoff) failures.shift();
  return failures.length >= MAX_FAILURES;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page({ title, message = '', tone = 'info', showForm = true, username }) {
  const color = tone === 'error' ? '#f87171' : tone === 'ok' ? '#4ade80' : '#94a3b8';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1326; color: #e6eaf2;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; box-sizing: border-box; }
  main { width: 100%; max-width: 380px; background: #131c33; border: 1px solid #26314f; border-radius: 16px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8f9bb3; font-size: 14px; margin: 0 0 20px; }
  label { display: block; font-size: 13px; color: #8f9bb3; margin: 14px 0 6px; }
  input { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 1px solid #26314f;
          background: #0b1326; color: #e6eaf2; font-size: 16px; }
  input:focus { outline: 2px solid #38bdf8; outline-offset: 1px; }
  button { width: 100%; margin-top: 22px; padding: 13px; border: 0; border-radius: 10px; background: #38bdf8;
           color: #04263a; font-weight: 600; font-size: 16px; cursor: pointer; }
  .msg { margin: 16px 0 0; font-size: 14px; color: ${color}; }
</style></head>
<body><main>
  <h1>${escapeHtml(title)}</h1>
  <p class="sub">Account: <strong>${escapeHtml(username)}</strong>. Every device will be signed out.</p>
  ${showForm ? `<form method="post" autocomplete="off">
    <label for="code">Recovery code</label>
    <input id="code" name="code" type="password" inputmode="numeric" required autocomplete="off">
    <label for="pw">New password (8–128 characters)</label>
    <input id="pw" name="newPassword" type="password" minlength="8" maxlength="128" required autocomplete="new-password">
    <label for="pw2">Confirm new password</label>
    <input id="pw2" name="confirmPassword" type="password" minlength="8" maxlength="128" required autocomplete="new-password">
    <button type="submit">Reset password</button>
  </form>` : ''}
  ${message ? `<p class="msg">${escapeHtml(message)}</p>` : ''}
</main></body></html>`;
}

function sendPage(reply, status, opts) {
  return reply
    .status(status)
    .header('Content-Type', 'text/html; charset=utf-8')
    .header('Cache-Control', 'no-store')
    .header('X-Robots-Tag', 'noindex, nofollow')
    .send(page(opts));
}

function notFound(reply) {
  return reply.status(404).send({ success: false, error: 'Not Found' });
}

async function recoveryPlugin(app) {
  // Scoped to this plugin: plain HTML form posts, no JavaScript needed on the page
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body)));
  });

  // logLevel silent: the URL contains the secret token and must never reach the logs
  const routeOptions = { logLevel: 'silent', config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };

  app.get('/api/v3/recovery/:token', routeOptions, async (request, reply) => {
    const cfg = config();
    if (!cfg || !tokenMatches(cfg.token, request.params.token)) return notFound(reply);
    if (isLocked()) {
      return sendPage(reply, 429, { title: 'Reset admin password', username: cfg.username, showForm: false, tone: 'error',
        message: 'Too many wrong codes. This page is locked for up to an hour.' });
    }
    return sendPage(reply, 200, { title: 'Reset admin password', username: cfg.username });
  });

  app.post('/api/v3/recovery/:token', routeOptions, async (request, reply) => {
    const cfg = config();
    if (!cfg || !tokenMatches(cfg.token, request.params.token)) return notFound(reply);
    const base = { title: 'Reset admin password', username: cfg.username };
    if (isLocked()) {
      return sendPage(reply, 429, { ...base, showForm: false, tone: 'error',
        message: 'Too many wrong codes. This page is locked for up to an hour.' });
    }

    const { code = '', newPassword = '', confirmPassword = '' } = request.body || {};
    if (!(await verifyPassword(String(code), cfg.codeHash))) {
      failures.push(Date.now());
      app.log.warn({ ip: request.ip, remaining: Math.max(0, MAX_FAILURES - failures.length) }, '[recovery] wrong code');
      return sendPage(reply, 403, { ...base, tone: 'error',
        message: isLocked() ? 'Wrong code. This page is now locked for up to an hour.' : 'Wrong code. Nothing was changed.' });
    }
    if (newPassword.length < 8 || newPassword.length > 128) {
      return sendPage(reply, 400, { ...base, tone: 'error', message: 'The new password must be 8–128 characters. Nothing was changed.' });
    }
    if (newPassword !== confirmPassword) {
      return sendPage(reply, 400, { ...base, tone: 'error', message: 'The two passwords did not match. Nothing was changed.' });
    }

    const user = await identity.findByUsername(cfg.username);
    if (!user) {
      return sendPage(reply, 404, { ...base, showForm: false, tone: 'error', message: `No "${cfg.username}" account exists.` });
    }
    // setPasswordHash also bumps token_version, which invalidates every existing login
    await identity.setPasswordHash(user.userId, await hashPassword(newPassword));
    await getPool().query('delete from user_sessions where user_id = $1', [user.userId]).catch(() => {});
    failures.length = 0;
    app.log.warn({ ip: request.ip, userId: user.userId }, '[recovery] admin password reset via recovery page');
    return sendPage(reply, 200, { ...base, showForm: false, tone: 'ok',
      message: 'Password updated. All devices were signed out — sign in again with the new password.' });
  });
}

module.exports = { recoveryPlugin };
