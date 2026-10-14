-- Feature tables added after initial schema
-- Run this once on the server: psql $DATABASE_URL < sql/007_feature_tables.sql

-- Edit message support
alter table v3_messages add column if not exists edited_at timestamptz;

-- Polls
create table if not exists v3_polls (
  message_id text primary key references v3_messages(message_id) on delete cascade,
  question   text not null,
  options    jsonb not null
);

create table if not exists v3_poll_votes (
  message_id   text not null references v3_polls(message_id) on delete cascade,
  user_id      bigint not null references v3_users(user_id) on delete cascade,
  option_index integer not null,
  voted_at     timestamptz not null default now(),
  primary key (message_id, user_id)
);

-- Scheduled messages
create table if not exists v3_scheduled_messages (
  id              bigserial primary key,
  sender_id       bigint not null references v3_users(user_id) on delete cascade,
  conversation_id text not null references v3_conversations(conversation_id) on delete cascade,
  body            text not null,
  scheduled_at    timestamptz not null,
  sent            boolean not null default false,
  sent_at         timestamptz,
  created_at      timestamptz not null default now()
);

create index if not exists idx_scheduled_pending on v3_scheduled_messages(scheduled_at)
  where not sent;
