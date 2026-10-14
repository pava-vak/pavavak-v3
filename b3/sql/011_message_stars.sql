-- Migration 011: starred messages
create table if not exists v3_message_stars (
  user_id    bigint not null references v3_users(user_id) on delete cascade,
  message_id text   not null references v3_messages(message_id) on delete cascade,
  starred_at timestamptz not null default now(),
  primary key (user_id, message_id)
);
create index if not exists idx_v3_message_stars_user on v3_message_stars(user_id, starred_at desc);
