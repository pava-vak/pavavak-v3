create table if not exists v3_users (
  user_id bigserial primary key,
  username text not null unique,
  display_name text not null,
  password_hash text,
  is_admin boolean not null default false,
  disabled boolean not null default false,
  token_version integer not null default 0,
  created_at timestamptz not null default now()
);

alter table v3_users add column if not exists password_hash text;
alter table v3_users add column if not exists disabled boolean not null default false;
alter table v3_users add column if not exists token_version integer not null default 0;

create table if not exists v3_conversations (
  conversation_id text primary key,
  type text not null,
  title text,
  created_at timestamptz not null default now()
);

create table if not exists v3_conversation_members (
  conversation_id text not null references v3_conversations (conversation_id) on delete cascade,
  user_id bigint not null references v3_users (user_id) on delete cascade,
  role text not null default 'member',
  muted boolean not null default false,
  joined_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);

create table if not exists v3_messages (
  message_id text primary key,
  conversation_id text not null references v3_conversations (conversation_id) on delete cascade,
  sender_id bigint not null references v3_users (user_id),
  body text not null,
  created_at timestamptz not null default now()
);

create table if not exists v3_message_receipts (
  message_id text not null references v3_messages (message_id) on delete cascade,
  user_id bigint not null references v3_users (user_id) on delete cascade,
  delivered_at timestamptz,
  read_at timestamptz,
  primary key (message_id, user_id)
);

create table if not exists v3_user_chat_summaries (
  user_id bigint not null references v3_users (user_id) on delete cascade,
  conversation_id text not null references v3_conversations (conversation_id) on delete cascade,
  unread_count integer not null default 0,
  last_message_id text,
  last_message_preview text,
  last_message_at timestamptz,
  last_message_direction text,
  last_message_status text,
  updated_at timestamptz not null default now(),
  primary key (user_id, conversation_id)
);

create index if not exists idx_v3_user_chat_summaries_user_updated
  on v3_user_chat_summaries (user_id, updated_at desc);

create index if not exists idx_v3_messages_conversation_created
  on v3_messages (conversation_id, created_at desc, message_id desc);

create index if not exists idx_v3_message_receipts_unread
  on v3_message_receipts (user_id, read_at)
  where read_at is null;
