const crypto = require('crypto');
const { z } = require('zod');
const { hashPassword } = require('../../shared/security/password.service');
const identity = require('../../db/identityAdapter');

// Private "add a member" page, reachable only at /api/v3/admin-panel/<ADMIN_PANEL_TOKEN>.
// Public self-registration is closed, so new accounts are created here by an admin.
// Disabled (normal 404) unless ADMIN_PANEL_TOKEN (64 hex chars) is set in the server .env,
// so without the secret URL the page is indistinguishable from nothing.

function config() {
  const token = process.env.ADMIN_PANEL_TOKEN || '';
  if (!/^[a-f0-9]{64}$/.test(token)) return null;
  return { token };
}

function tokenMatches(expected, given) {
  const a = Buffer.from(expected);
  const b = Buffer.from(String(given || ''));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const createSchema = z.object({
  username: z.string().trim().min(2).max(40).regex(/^[a-z0-9._-]+$/, 'Lowercase letters, numbers, dots, hyphens only'),
  displayName: z.string().trim().min(1).max(80),
  password: z.string().min(8).max(128)
});

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function page({ token, message = '', tone = 'info', values = {} }) {
  const color = tone === 'error' ? '#f87171' : tone === 'ok' ? '#4ade80' : '#94a3b8';
  const v = (k) => escapeHtml(values[k] || '');
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer">
<title>Add a member</title>
<style>
  :root { color-scheme: dark; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0b1326; color: #e6eaf2;
         font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 16px; box-sizing: border-box; }
  main { width: 100%; max-width: 400px; background: #131c33; border: 1px solid #26314f; border-radius: 16px; padding: 28px; }
  h1 { font-size: 20px; margin: 0 0 4px; }
  .sub { color: #8f9bb3; font-size: 14px; margin: 0 0 18px; }
  label { display: block; font-size: 13px; color: #8f9bb3; margin: 14px 0 6px; }
  .hint { font-weight: 400; color: #64748b; }
  input { width: 100%; box-sizing: border-box; padding: 12px; border-radius: 10px; border: 1px solid #26314f;
          background: #0b1326; color: #e6eaf2; font-size: 16px; }
  input:focus { outline: 2px solid #38bdf8; outline-offset: 1px; }
  button { width: 100%; margin-top: 22px; padding: 13px; border: 0; border-radius: 10px; background: #38bdf8;
           color: #04263a; font-weight: 600; font-size: 16px; cursor: pointer; }
  .msg { margin: 16px 0 0; font-size: 14px; color: ${color}; }
</style></head>
<body><main>
  <h1>Add a member</h1>
  <p class="sub">Creates a new PaVa Vak account. Give the person their username and password to sign in.</p>
  <form method="post" action="/api/v3/admin-panel/${escapeHtml(token)}" autocomplete="off">
    <label for="d">Full name</label>
    <input id="d" name="displayName" type="text" required maxlength="80" value="${v('displayName')}">
    <label for="u">Username <span class="hint">(lowercase letters, numbers, dots, hyphens)</span></label>
    <input id="u" name="username" type="text" required minlength="2" maxlength="40"
           pattern="[a-z0-9._-]+" autocapitalize="none" autocorrect="off" value="${v('username')}">
    <label for="p">Password <span class="hint">(8–128 characters)</span></label>
    <input id="p" name="password" type="password" required minlength="8" maxlength="128" autocomplete="new-password">
    <button type="submit">Create account</button>
  </form>
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

async function adminPanelPlugin(app) {
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 4096 }, (_req, body, done) => {
    done(null, Object.fromEntries(new URLSearchParams(body)));
  });

  // logLevel silent: the URL carries the secret token and the body carries a password
  const routeOptions = { logLevel: 'silent', config: { rateLimit: { max: 20, timeWindow: '1 minute' } } };

  app.get('/api/v3/admin-panel/:token', routeOptions, async (request, reply) => {
    const cfg = config();
    if (!cfg || !tokenMatches(cfg.token, request.params.token)) return notFound(reply);
    return sendPage(reply, 200, { token: request.params.token });
  });

  app.post('/api/v3/admin-panel/:token', routeOptions, async (request, reply) => {
    const cfg = config();
    if (!cfg || !tokenMatches(cfg.token, request.params.token)) return notFound(reply);

    const token = request.params.token;
    const parsed = createSchema.safeParse(request.body || {});
    if (!parsed.success) {
      const first = parsed.error.issues[0];
      return sendPage(reply, 400, { token, tone: 'error', values: request.body || {},
        message: first ? first.message : 'Please check the fields and try again.' });
    }

    try {
      const user = await identity.createUser({
        username: parsed.data.username,
        displayName: parsed.data.displayName,
        passwordHash: await hashPassword(parsed.data.password),
        isAdmin: false
      });
      return sendPage(reply, 201, { token, tone: 'ok',
        message: `Created “${user.displayName}” (@${user.username}). They can sign in now.` });
    } catch (error) {
      const msg = (error && error.message || '').toLowerCase();
      if (error.status === 409 || msg.includes('taken') || msg.includes('unique') || msg.includes('duplicate')) {
        return sendPage(reply, 409, { token, tone: 'error', values: request.body || {},
          message: 'That username is already taken. Pick another.' });
      }
      app.log.error({ err: error }, '[admin-panel] create user failed');
      return sendPage(reply, 500, { token, tone: 'error', values: request.body || {},
        message: 'Something went wrong. The account was not created.' });
    }
  });
}

module.exports = { adminPanelPlugin };
