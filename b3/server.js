require('dotenv').config();
const { env } = require('./src/config/env');
const { buildApp } = require('./src/app/buildApp');
const { attachSocketServer } = require('./src/realtime/socketServer');
const { closePool } = require('./src/db/pool');
const scheduledMessages = require('./src/jobs/scheduledMessages');
const autoDelete = require('./src/jobs/autoDelete');
const biometricRepo = require('./src/modules/biometric/biometric.repository');
const sessionsRepo = require('./src/modules/auth/sessions.repository');
const mediaAccess = require('./src/modules/media/mediaAccess');
const normalizedChat = require('./src/db/normalizedChat.repository');

let app;
let io;

async function start() {
  app = buildApp();
  await app.ready();
  io = attachSocketServer(app.server);

  await normalizedChat.ensureClearedColumn();
  const port = env.PORT;
  await app.listen({ port, host: '0.0.0.0' });
  app.log.info({ port }, 'b3 listening');
  await biometricRepo.ensureTable();
  await sessionsRepo.ensureTable();
  await mediaAccess.ensureTable();
  scheduledMessages.start();
  autoDelete.start();
}

async function shutdown(signal) {
  if (app) {
    app.log.info({ signal }, 'b3 shutting down');
  }
  scheduledMessages.stop();
  autoDelete.stop();
  if (io) {
    io.close();
  }
  if (app) {
    await app.close();
  }
  await closePool();
  process.exit(0);
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
