#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getPool, closePool } = require('../src/db/pool');

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sqlDir = path.join(__dirname, '..', 'sql');
  const files = fs.readdirSync(sqlDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const db = getPool();
  await db.query(`
    create table if not exists v3_schema_migrations (
      filename text primary key,
      applied_at timestamptz not null default now()
    )
  `);

  for (const file of files) {
    const applied = await db.query('select 1 from v3_schema_migrations where filename = $1', [file]);
    if (applied.rowCount > 0) {
      console.log(`skip ${file}`);
      continue;
    }
    const sql = fs.readFileSync(path.join(sqlDir, file), 'utf8');
    console.log(`apply ${file}`);
    await db.query(sql);
    await db.query('insert into v3_schema_migrations (filename) values ($1)', [file]);
  }

  await closePool();
  console.log('migrations complete');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
