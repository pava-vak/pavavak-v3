create table if not exists v3_user_chats (
  user_id bigint not null,
  chat_id text not null,
  chat_type text not null,
  title text not null,
  subtitle text not null default '',
  avatar_text text not null default '?',
  muted boolean not null default false,
  unread_count integer not null default 0,
  last_message_id text,
  last_message_text text,
  last_message_sent_at timestamptz,
  last_message_direction text,
  last_message_status text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, chat_id)
);

create index if not exists idx_v3_user_chats_user_updated
  on v3_user_chats (user_id, updated_at desc);

create index if not exists idx_v3_user_chats_user_last_message
  on v3_user_chats (user_id, last_message_sent_at desc);

create table if not exists v3_user_messages (
  user_id bigint not null,
  chat_id text not null,
  message_id text not null,
  direction text not null,
  sender_display_name text not null,
  text text not null,
  sent_at timestamptz not null default now(),
  status text not null default 'sent',
  primary key (user_id, chat_id, message_id),
  foreign key (user_id, chat_id) references v3_user_chats (user_id, chat_id) on delete cascade
);

create index if not exists idx_v3_user_messages_thread
  on v3_user_messages (user_id, chat_id, sent_at desc, message_id desc);