const { requireAuth } = require('../../shared/security/auth.preHandler');
const { verifyPassword } = require('../../shared/security/password.service');
const { createLoginThrottle } = require('../../shared/security/loginThrottle');
const identity = require('../../db/identityAdapter');
const sessions = require('../auth/sessions.repository');

const REFRESH_COOKIE = 'pava_refresh';

// What a user is told we erase — shown on the web page and mirrored in-app.
const DELETE_SUMMARY = [
  'your account, username and password',
  'your profile and your direct chats',
  'your membership of every group',
  'your push/notification tokens and signed-in devices'
];

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page({ message = '', tone = 'info', showForm = true, done = false }) {
  const color = tone === 'error' ? '#f87171' : tone === 'ok' ? '#4ade80' : '#94a3b8';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>Delete your PaVa Vak account</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1326; color: #e6eaf2;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; box-sizing: border-box; }
  main { width: 100%; max-width: 420px; background: #131c33; border: 1px solid #26314f; border-radius: 16px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8f9bb3; font-size: 14px; margin: 0 0 18px; }
  ul { margin: 0 0 18px; padding-left: 20px; color: #cbd5e1; font-size: 14px; }
  li { margin: 3px 0; }
  .note { font-size: 13px; color: #8f9bb3; margin: 0 0 18px; }
  label { display: block; font-size: 13px; color: #8f9bb3; margin: 14px 0 6px; }
  input { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 1px solid #26314f;
          background: #0b1326; color: #e6eaf2; font-size: 16px; }
  input:focus { outline: 2px solid #f87171; outline-offset: 1px; }
  button { width: 100%; margin-top: 22px; padding: 13px; border: 0; border-radius: 10px; background: #f87171;
           color: #2a0b0b; font-weight: 700; font-size: 16px; cursor: pointer; }
  .msg { margin: 16px 0 0; font-size: 14px; color: ${color}; }
</style></head>
<body><main>
  <h1>Delete your PaVa Vak account</h1>
  <p class="sub">This permanently deletes your account. It cannot be undone.</p>
  ${done ? '' : `<p class="note">We will erase:</p>
  <ul>${DELETE_SUMMARY.map((s) => `<li>${escapeHtml(s)}</li>`).join('')}</ul>
  <p class="note">Messages you already sent stay visible to the people you sent them to, shown as from a &ldquo;Deleted user&rdquo;.</p>`}
  ${showForm ? `<form method="post" autocomplete="off">
    <label for="u">Username</label>
    <input id="u" name="username" type="text" required autocomplete="username">
    <label for="p">Password</label>
    <input id="p" name="password" type="password" required autocomplete="current-password">
    <button type="submit">Permanently delete my account</button>
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

// Shared erase used by both the in-app endpoint and the public web form.
// Throws error.status 409 if the caller is the only admin.
async function eraseAccount(userId) {
  // Belt-and-suspenders: deleteUser also clears sessions in its transaction.
  if (sessions.isAvailable()) {
    await sessions.deleteAllSessions(userId).catch(() => {});
  }
  return identity.deleteUser(userId);
}

function registerAccountRoutes(app) {
  // ── In-app self-service deletion (authenticated) ─────────────────────────────
  app.delete('/api/v3/account', { preHandler: requireAuth }, async (request, reply) => {
    const password = String((request.body || {}).password || '');
    if (!password) {
      return reply.status(400).send({ success: false, error: 'Password is required to delete your account' });
    }
    const user = await identity.getByIdWithHash(request.auth.userId);
    if (!user || !(await verifyPassword(password, user.passwordHash))) {
      return reply.status(401).send({ success: false, error: 'Password is incorrect' });
    }
    try {
      const ok = await eraseAccount(request.auth.userId);
      if (!ok) return reply.status(404).send({ success: false, error: 'Account not found' });
      reply.clearCookie(REFRESH_COOKIE, { path: '/api/v3/auth' });
      return { success: true };
    } catch (error) {
      const status = error.status || 500;
      if (status >= 500) request.log.error({ err: error }, 'Account deletion failed');
      return reply.status(status).send({ success: false, error: status >= 500 ? 'Internal server error' : error.message });
    }
  });

  // ── Public web deletion page (Play "data deletion" URL; works without the app) ─
  app.register(async function accountDeletePlugin(fastify) {
    fastify.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
      done(null, Object.fromEntries(new URLSearchParams(body)));
    });
    // Body carries a password — keep it out of the logs entirely.
    const routeOptions = { logLevel: 'silent', config: { rateLimit: { max: 10, timeWindow: '1 minute' } } };
    const throttle = createLoginThrottle();

    fastify.get('/api/v3/account/delete', routeOptions, async (_request, reply) => sendPage(reply, 200, {}));

    fastify.post('/api/v3/account/delete', routeOptions, async (request, reply) => {
      const keys = [`del:${request.ip || 'unknown'}`];
      const locked = throttle.check(keys);
      if (locked.locked) {
        const secs = Math.ceil(locked.retryAfterMs / 1000);
        return sendPage(reply, 429, { tone: 'error', message: `Too many attempts. Try again in ${secs} seconds.` });
      }

      const { username = '', password = '' } = request.body || {};
      const user = await identity.findByUsername(String(username).trim());
      if (!user || user.disabled || !(await verifyPassword(String(password), user.passwordHash))) {
        throttle.recordFailure(keys);
        return sendPage(reply, 401, { tone: 'error', message: 'Wrong username or password. Nothing was deleted.' });
      }

      try {
        const ok = await eraseAccount(user.userId);
        throttle.reset(keys);
        if (!ok) return sendPage(reply, 404, { tone: 'error', message: 'That account no longer exists.' });
        request.log.warn({ userId: user.userId }, '[account] self-deleted via web');
        return sendPage(reply, 200, { showForm: false, done: true, tone: 'ok',
          message: 'Your account has been permanently deleted.' });
      } catch (error) {
        const status = error.status || 500;
        return sendPage(reply, status, { tone: 'error',
          message: status >= 500 ? 'Something went wrong. Nothing was deleted.' : error.message });
      }
    });
  });
}

module.exports = { registerAccountRoutes };
