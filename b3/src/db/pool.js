const { Pool } = require('pg');
const { env } = require('../config/env');

let pool;

function getPool() {
  if (!pool) {
    const config = {
      connectionString: env.DATABASE_URL,
      max: 20,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    };
    if (env.DATABASE_URL && env.DATABASE_SSL_REJECT_UNAUTHORIZED) {
      config.ssl = { rejectUnauthorized: true };
    }
    pool = new Pool(config);
    pool.on('connect', (client) => {
      client.query("SET statement_timeout = '8s'").catch(() => {});
    });
  }
  return pool;
}

async function pingDatabase() {
  if (!env.DATABASE_URL) {
    return {
      configured: false,
      connected: false
    };
  }

  const db = getPool();
  await db.query('select 1');
  return {
    configured: true,
    connected: true
  };
}

async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}

module.exports = { getPool, pingDatabase, closePool };
