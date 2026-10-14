require('dotenv').config();
const { Pool } = require('pg');

const sql = `
alter table v3_users add column if not exists last_seen_at timestamptz;
alter table v3_conversations add column if not exists pinned_message_id text;
alter table v3_conversation_members add column if not exists archived boolean not null default false;
alter table v3_conversation_members add column if not exists chat_background text;
alter table v3_messages add column if not exists forwarded_from_id text;
create table if not exists v3_message_reactions (
  message_id text not null references v3_messages(message_id) on delete cascade,
  user_id    bigint not null references v3_users(user_id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists idx_reactions_message on v3_message_reactions(message_id);
create table if not exists v3_link_previews (
  url         text primary key,
  title       text,
  description text,
  image_url   text,
  site_name   text,
  fetched_at  timestamptz not null default now()
);
`;

async function main() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    await pool.query(sql);
    console.log('Migration 008 applied successfully.');
  } catch (err) {
    console.error('Migration failed:', err.message);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

main();
