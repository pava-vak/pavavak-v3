const assert = require('node:assert/strict');
const test = require('node:test');
const { io } = require('../../f3/node_modules/socket.io-client');

process.env.NODE_ENV = 'test';
process.env.APP_ENV = 'development';
process.env.ALLOW_DEV_LOGIN = 'true';
process.env.LOG_LEVEL = 'silent';
process.env.CHAT_STORAGE_MODE = 'legacy';
process.env.JWT_ACCESS_SECRET = 'test-access-secret-12345';
process.env.JWT_REFRESH_SECRET = 'test-refresh-secret-12345';

const { buildApp } = require('../src/app/buildApp');
const { attachSocketServer } = require('../src/realtime/socketServer');

async function startRealtimeApp() {
  const app = buildApp();
  await app.ready();
  const ioServer = attachSocketServer(app.server);
  await app.listen({ port: 0, host: '127.0.0.1' });
  const address = app.server.address();
  return {
    app,
    ioServer,
    baseUrl: `http://127.0.0.1:${address.port}`
  };
}

async function stopRealtimeApp({ app, ioServer }) {
  ioServer.close();
  await app.close();
}

async function login(app, userId, username, displayName) {
  const response = await app.inject({
    method: 'POST',
    url: '/api/v3/auth/dev-login',
    payload: {
      userId,
      username,
      displayName,
      isAdmin: false
    }
  });
  assert.equal(response.statusCode, 200);
  return response.json();
}

function connectSocket(baseUrl, accessToken) {
  return io(baseUrl, {
    path: '/socket.io',
    transports: ['websocket'],
    auth: {
      token: accessToken
    },
    reconnection: false,
    forceNew: true
  });
}

function waitFor(socket, event, predicate = () => true, timeoutMs = 3000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off(event, listener);
      reject(new Error(`Timed out waiting for ${event}`));
    }, timeoutMs);

    function listener(payload) {
      if (!predicate(payload)) return;
      clearTimeout(timer);
      socket.off(event, listener);
      resolve(payload);
    }

    socket.on(event, listener);
  });
}

function waitForConnect(socket) {
  return new Promise((resolve, reject) => {
    if (socket.connected) {
      resolve();
      return;
    }

    const timer = setTimeout(() => {
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
      reject(new Error('Timed out waiting for socket connect'));
    }, 3000);

    function cleanup() {
      clearTimeout(timer);
      socket.off('connect', onConnect);
      socket.off('connect_error', onError);
    }

    function onConnect() {
      cleanup();
      resolve();
    }

    function onError(error) {
      cleanup();
      reject(error);
    }

    socket.on('connect', onConnect);
    socket.on('connect_error', onError);
  });
}

test('two users exchange realtime message and sender receives delivered/read statuses', async () => {
  const server = await startRealtimeApp();
  const sockets = [];

  try {
    const alice = await login(server.app, 9401, 'alice-9401', 'Alice');
    const bob = await login(server.app, 101, 'bob-101', 'Bob');
    const aliceSocket = connectSocket(server.baseUrl, alice.tokens.accessToken);
    const bobSocket = connectSocket(server.baseUrl, bob.tokens.accessToken);
    sockets.push(aliceSocket, bobSocket);

    await Promise.all([waitForConnect(aliceSocket), waitForConnect(bobSocket)]);
    aliceSocket.emit('chat:join', { chatId: 'direct::101' });
    bobSocket.emit('chat:join', { chatId: 'direct::101' });

    const bobMessagePromise = waitFor(
      bobSocket,
      'message:new',
      (payload) => payload.chatId === 'direct::101' && payload.message?.text === 'Realtime hello'
    );

    const sendResponse = await server.app.inject({
      method: 'POST',
      url: '/api/v3/messages',
      headers: {
        authorization: `Bearer ${alice.tokens.accessToken}`
      },
      payload: {
        chatId: 'direct::101',
        text: 'Realtime hello'
      }
    });

    assert.equal(sendResponse.statusCode, 200);
    const sentMessage = sendResponse.json().message;
    const bobMessage = await bobMessagePromise;
    assert.equal(bobMessage.message.messageId, sentMessage.messageId);
    assert.equal(bobMessage.message.direction, 'incoming');
    assert.equal(bobMessage.message.senderDisplayName, 'Alice');

    const deliveredPromise = waitFor(
      aliceSocket,
      'message:delivered',
      (payload) => payload.messageId === sentMessage.messageId
    );
    const deliveredResponse = await server.app.inject({
      method: 'POST',
      url: `/api/v3/messages/${encodeURIComponent(sentMessage.messageId)}/delivered`,
      headers: {
        authorization: `Bearer ${bob.tokens.accessToken}`
      },
      payload: {
        chatId: 'direct::101'
      }
    });
    assert.equal(deliveredResponse.statusCode, 200);
    assert.equal((await deliveredPromise).status, 'delivered');

    const readPromise = waitFor(
      aliceSocket,
      'message:read',
      (payload) => payload.messageId === sentMessage.messageId
    );
    const readResponse = await server.app.inject({
      method: 'POST',
      url: `/api/v3/messages/${encodeURIComponent(sentMessage.messageId)}/read`,
      headers: {
        authorization: `Bearer ${bob.tokens.accessToken}`
      },
      payload: {
        chatId: 'direct::101'
      }
    });
    assert.equal(readResponse.statusCode, 200);
    assert.equal((await readPromise).status, 'read');
  } finally {
    for (const socket of sockets) {
      socket.disconnect();
    }
    await stopRealtimeApp(server);
  }
});
