const assert = require('node:assert/strict');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.ALLOW_DEV_LOGIN = 'true';
process.env.LOG_LEVEL = 'silent';
process.env.CHAT_STORAGE_MODE = 'legacy';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-12345';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-12345';

const { buildApp } = require('../src/app/buildApp');
const demoIdentity = require('../src/shared/demoIdentityStore');

async function withApp(fn) {
  const app = buildApp();
  await app.ready();
  try {
    await fn(app);
  } finally {
    await app.close();
  }
}

async function login(app, userId = 9001, isAdmin = true) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v3/auth/dev-login',
    payload: {
      userId,
      username: `test-user-${userId}`,
      displayName: `Test User ${userId}`,
      isAdmin
    }
  });

  assert.equal(response.statusCode, 200);
  return response.json();
}

function authHeaders(accessToken) {
  return {
    authorization: `Bearer ${accessToken}`
  };
}

test('refresh token flow returns complete user identity', async () => {
  await withApp(async (app) => {
    const session = await login(app, 9101);

    const response = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/refresh',
      payload: {
        refreshToken: session.tokens.refreshToken
      }
    });

    assert.equal(response.statusCode, 200);
    const body = response.json();
    assert.equal(body.success, true);
    assert.equal(body.user.userId, 9101);
    assert.equal(body.user.username, 'test-user-9101');
    assert.equal(body.user.displayName, 'Test User 9101');
    assert.equal(body.user.isAdmin, true);
    assert.ok(body.tokens.accessToken);
    assert.ok(body.tokens.refreshToken);
  });
});

test('refresh reloads user state and rejects disabled users', async () => {
  await withApp(async (app) => {
    const session = await login(app, 9111);
    await demoIdentity.setUserPatch(9111, {
      displayName: 'Renamed User',
      isAdmin: false
    });

    const refreshed = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/refresh',
      payload: {
        refreshToken: session.tokens.refreshToken
      }
    });

    assert.equal(refreshed.statusCode, 200);
    assert.equal(refreshed.json().user.displayName, 'Renamed User');
    assert.equal(refreshed.json().user.isAdmin, false);

    await demoIdentity.setUserPatch(9111, { disabled: true });
    const disabled = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/refresh',
      payload: {
        refreshToken: refreshed.json().tokens.refreshToken
      }
    });

    assert.equal(disabled.statusCode, 401);
  });
});

test('logout revokes previously issued refresh tokens', async () => {
  await withApp(async (app) => {
    const session = await login(app, 9121);

    const logout = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/logout',
      headers: authHeaders(session.tokens.accessToken)
    });
    assert.equal(logout.statusCode, 200);

    const refresh = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/refresh',
      payload: {
        refreshToken: session.tokens.refreshToken
      }
    });
    assert.equal(refresh.statusCode, 401);
  });
});

test('registered users can login with username and password', async () => {
  await withApp(async (app) => {
    const suffix = Date.now();
    const registerResponse = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/register',
      payload: {
        username: `newuser${suffix}`,
        displayName: 'New User',
        password: 'new-user-password'
      }
    });

    assert.equal(registerResponse.statusCode, 200);
    assert.equal(registerResponse.json().user.displayName, 'New User');

    const loginResponse = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/login',
      payload: {
        username: `newuser${suffix}`,
        password: 'new-user-password'
      }
    });

    assert.equal(loginResponse.statusCode, 200);
    const body = loginResponse.json();
    assert.equal(body.success, true);
    assert.ok(body.tokens.accessToken);
    assert.equal(body.user.username, `newuser${suffix}`);
  });
});

test('login locks out after repeated failed attempts', async () => {
  await withApp(async (app) => {
    let response;
    for (let i = 0; i < 5; i += 1) {
      response = await app.inject({
        method: 'POST',
        url: '/api/v3/auth/login',
        payload: { username: 'tester', password: 'wrong-password' }
      });
      assert.equal(response.statusCode, 401);
    }

    // Next attempt is locked out, even though the limit was just reached.
    const locked = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/login',
      payload: { username: 'tester', password: 'wrong-password' }
    });
    assert.equal(locked.statusCode, 429);
    assert.ok(locked.headers['retry-after']);

    // The correct password is also blocked while the lockout is active.
    const correctButLocked = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/login',
      payload: { username: 'tester', password: 'tester123' }
    });
    assert.equal(correctButLocked.statusCode, 429);
  });
});

test('a successful login clears the failed-attempt counter', async () => {
  await withApp(async (app) => {
    // Four failures (below the limit of five), then a success must reset.
    for (let i = 0; i < 4; i += 1) {
      const fail = await app.inject({
        method: 'POST',
        url: '/api/v3/auth/login',
        payload: { username: 'tester', password: 'wrong-password' }
      });
      assert.equal(fail.statusCode, 401);
    }

    const ok = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/login',
      payload: { username: 'tester', password: 'tester123' }
    });
    assert.equal(ok.statusCode, 200);

    // Counter was reset, so a fresh wrong attempt is a 401, not a 429.
    const afterReset = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/login',
      payload: { username: 'tester', password: 'wrong-password' }
    });
    assert.equal(afterReset.statusCode, 401);
  });
});

test('invalid refresh token is rejected', async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v3/auth/refresh',
      payload: {
        refreshToken: 'not-a-real-token'
      }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().success, false);
  });
});

test('receipt endpoints reject unauthenticated requests', async () => {
  await withApp(async (app) => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/v3/messages/m-101-1/delivered',
      payload: {
        chatId: 'direct::101'
      }
    });

    assert.equal(response.statusCode, 401);
    assert.equal(response.json().success, false);
  });
});

test('marking a chat read clears unread count and marks incoming thread messages read', async () => {
  await withApp(async (app) => {
    const session = await login(app, 9201);
    const headers = authHeaders(session.tokens.accessToken);

    const readResponse = await app.inject({
      method: 'POST',
      url: '/api/v3/chats/direct%3A%3A101/read',
      headers,
      payload: {}
    });

    assert.equal(readResponse.statusCode, 200);
    const readBody = readResponse.json();
    assert.equal(readBody.success, true);
    assert.equal(readBody.unreadCount, 0);
    assert.deepEqual(readBody.updatedMessageIds.sort(), ['m-101-1', 'm-101-3']);

    const chatsResponse = await app.inject({
      method: 'GET',
      url: '/api/v3/chats',
      headers
    });
    assert.equal(chatsResponse.statusCode, 200);
    const chat = chatsResponse.json().items.find((item) => item.chatId === 'direct::101');
    assert.equal(chat.unreadCount, 0);

    const threadResponse = await app.inject({
      method: 'GET',
      url: '/api/v3/chats/direct%3A%3A101/messages',
      headers
    });
    assert.equal(threadResponse.statusCode, 200);
    const incoming = threadResponse.json().items.filter((item) => item.direction === 'incoming');
    assert.ok(incoming.length > 0);
    assert.ok(incoming.every((item) => item.status === 'read'));
  });
});

test('sending a message appends it and updates the sender chat summary', async () => {
  await withApp(async (app) => {
    const session = await login(app, 9301);
    const headers = authHeaders(session.tokens.accessToken);

    const sendResponse = await app.inject({
      method: 'POST',
      url: '/api/v3/messages',
      headers,
      payload: {
        chatId: 'direct::101',
        text: 'Automated test message'
      }
    });

    assert.equal(sendResponse.statusCode, 200);
    const message = sendResponse.json().message;
    assert.equal(message.direction, 'outgoing');
    assert.equal(message.status, 'sent');
    assert.equal(message.text, 'Automated test message');

    const chatsResponse = await app.inject({
      method: 'GET',
      url: '/api/v3/chats',
      headers
    });
    assert.equal(chatsResponse.statusCode, 200);
    const chat = chatsResponse.json().items.find((item) => item.chatId === 'direct::101');
    assert.equal(chat.unreadCount, 0);
    assert.equal(chat.lastMessage.messageId, message.messageId);
    assert.equal(chat.lastMessage.text, 'Automated test message');
  });
});

test('message send is rate limited', async () => {
  await withApp(async (app) => {
    const session = await login(app, 9311);
    const headers = authHeaders(session.tokens.accessToken);
    let lastResponse;
    for (let i = 0; i < 61; i += 1) {
      lastResponse = await app.inject({
        method: 'POST',
        url: '/api/v3/messages',
        headers,
        payload: {
          chatId: 'direct::101',
          text: `Rate limit message ${i}`
        }
      });
    }
    assert.equal(lastResponse.statusCode, 429);
  });
});

test('users can search people and start a one-to-one chat', async () => {
  await withApp(async (app) => {
    const session = await login(app, 9501);
    const headers = authHeaders(session.tokens.accessToken);

    const searchResponse = await app.inject({
      method: 'GET',
      url: '/api/v3/users?q=nenu',
      headers
    });
    assert.equal(searchResponse.statusCode, 200);
    const nenu = searchResponse.json().items.find((item) => item.username === 'nenu');
    assert.ok(nenu);

    const directResponse = await app.inject({
      method: 'POST',
      url: '/api/v3/chats/direct',
      headers,
      payload: {
        userId: nenu.userId
      }
    });
    assert.equal(directResponse.statusCode, 200);
    const chat = directResponse.json().chat;
    assert.equal(chat.chatType, 'direct');
    assert.equal(chat.title, 'Nenu Natho');
    assert.equal(chat.subtitle, '@nenu');
  });
});

test('user search is rate limited', async () => {
  await withApp(async (app) => {
    const session = await login(app, 9511);
    const headers = authHeaders(session.tokens.accessToken);
    let lastResponse;
    for (let i = 0; i < 31; i += 1) {
      lastResponse = await app.inject({
        method: 'GET',
        url: '/api/v3/users?q=nenu',
        headers
      });
    }
    assert.equal(lastResponse.statusCode, 429);
  });
});

test('admin dashboard requires admin and returns summary', async () => {
  await withApp(async (app) => {
    const admin = await login(app, 9601);
    const user = await login(app, 9602, false);

    const forbidden = await app.inject({
      method: 'GET',
      url: '/api/v3/admin/summary',
      headers: authHeaders(user.tokens.accessToken)
    });
    assert.equal(forbidden.statusCode, 403);

    const allowed = await app.inject({
      method: 'GET',
      url: '/api/v3/admin/summary',
      headers: authHeaders(admin.tokens.accessToken)
    });
    assert.equal(allowed.statusCode, 200);
    assert.equal(allowed.json().success, true);
    assert.ok(Number.isInteger(allowed.json().summary.users));
  });
});

test('production environment requires explicit JWT secrets', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', "require('./src/config/env')"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APP_ENV: 'production',
        ALLOW_DEV_LOGIN: 'false',
        JWT_ACCESS_SECRET: '',
        JWT_REFRESH_SECRET: ''
      },
      encoding: 'utf8'
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /JWT_ACCESS_SECRET/);
  assert.match(`${result.stderr}${result.stdout}`, /JWT_REFRESH_SECRET/);
});

test('production environment rejects dev login flag', () => {
  const result = spawnSync(
    process.execPath,
    ['-e', "require('./src/config/env')"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: 'production',
        APP_ENV: 'production',
        ALLOW_DEV_LOGIN: 'true',
        JWT_ACCESS_SECRET: 'production-access-secret-12345',
        JWT_REFRESH_SECRET: 'production-refresh-secret-12345'
      },
      encoding: 'utf8'
    }
  );

  assert.notEqual(result.status, 0);
  assert.match(`${result.stderr}${result.stdout}`, /ALLOW_DEV_LOGIN/);
});

test('default storage mode is normalized when unset', () => {
  const { CHAT_STORAGE_MODE, ...baseEnv } = process.env;
  const result = spawnSync(
    process.execPath,
    ['-e', "const { env } = require('./src/config/env'); console.log(env.CHAT_STORAGE_MODE)"],
    {
      cwd: process.cwd(),
      env: {
        ...baseEnv,
        DATABASE_URL: 'postgres://user:pass@localhost:5432/pavav3'
      },
      encoding: 'utf8'
    }
  );

  assert.equal(result.status, 0);
  assert.match(result.stdout, /normalized/);
});

test('global 500 handler returns a generic error', async () => {
  const app = buildApp();
  app.get('/test-boom', async () => {
    throw new Error('secret implementation detail');
  });
  await app.ready();
  try {
    const response = await app.inject({
      method: 'GET',
      url: '/test-boom'
    });
    assert.equal(response.statusCode, 500);
    assert.deepEqual(response.json(), {
      success: false,
      error: 'Internal server error'
    });
  } finally {
    await app.close();
  }
});

test('password service does not use synchronous pbkdf2', () => {
  const source = fs.readFileSync('src/shared/security/password.service.js', 'utf8');
  assert.equal(source.includes('pbkdf2Sync'), false);
});
