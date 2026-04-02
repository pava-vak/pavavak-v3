require('dotenv').config();
const { buildApp } = require('./src/app/buildApp');

async function start() {
  const app = buildApp();
  const port = Number(process.env.PORT || 3201);
  try {
    await app.listen({ port, host: '0.0.0.0' });
    app.log.info({ port }, 'b3 listening');
  } catch (error) {
    app.log.error(error, 'b3 failed to start');
    process.exit(1);
  }
}

start();
