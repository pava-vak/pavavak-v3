-- Migration 008: add all missing tables and columns
-- These were referenced in application code but never created in earlier migrations.

-- 1. Presence: last_seen_at on users
alter table v3_users add column if not exists last_seen_at timestamptz;

-- 2. Pin message: pinned_message_id on conversations
alter table v3_conversations add column if not exists pinned_message_id text;

-- 3. Archive chat: archived flag on conversation members
alter table v3_conversation_members add column if not exists archived boolean not null default false;

-- 4. Chat wallpaper: chat_background on conversation members
alter table v3_conversation_members add column if not exists chat_background text;

-- 5. Forward message: forwarded_from_id on messages
alter table v3_messages add column if not exists forwarded_from_id text;

-- 6. Emoji reactions table
create table if not exists v3_message_reactions (
  message_id text not null references v3_messages(message_id) on delete cascade,
  user_id    bigint not null references v3_users(user_id) on delete cascade,
  emoji      text not null,
  created_at timestamptz not null default now(),
  primary key (message_id, user_id)
);
create index if not exists idx_reactions_message on v3_message_reactions(message_id);

-- 7. Link preview cache table
create table if not exists v3_link_previews (
  url         text primary key,
  title       text,
  description text,
  image_url   text,
  site_name   text,
  fetched_at  timestamptz not null default now()
);
