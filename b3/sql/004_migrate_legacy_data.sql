-- Best-effort migration from legacy per-user mailbox to normalized schema.
-- Run after 001_chat_bootstrap.sql and 002_normalized_schema.sql.
-- Review output before switching CHAT_STORAGE_MODE=normalized.

insert into v3_users (user_id, username, display_name, is_admin)
select distinct
  user_id,
  'user-' || user_id::text,
  'User ' || user_id::text,
  false
from v3_user_chats
on conflict (user_id) do nothing;

insert into v3_users (user_id, username, display_name, is_admin)
select distinct
  substring(chat_id from '(\d+)$')::bigint,
  'user-' || substring(chat_id from '(\d+)$'),
  'User ' || substring(chat_id from '(\d+)$'),
  false
from v3_user_chats
where substring(chat_id from '(\d+)$') is not null
on conflict (user_id) do nothing;

insert into v3_conversations (conversation_id, type, title)
select distinct
  chat_id,
  chat_type,
  title
from v3_user_chats
on conflict (conversation_id) do nothing;

insert into v3_conversation_members (conversation_id, user_id, muted)
select distinct
  chat_id,
  user_id,
  muted
from v3_user_chats
on conflict (conversation_id, user_id) do nothing;

insert into v3_conversation_members (conversation_id, user_id, muted)
select distinct
  chat_id,
  substring(chat_id from '(\d+)$')::bigint,
  false
from v3_user_chats
where substring(chat_id from '(\d+)$') is not null
on conflict (conversation_id, user_id) do nothing;

insert into v3_messages (message_id, conversation_id, sender_id, body, created_at)
with inferred_messages as (
  select
    message_id,
    chat_id,
    coalesce(
      max(user_id) filter (where direction = 'outgoing'),
      substring(chat_id from '(\d+)$')::bigint,
      min(user_id)
    ) as sender_id,
    max(text) as text,
    max(sent_at) as sent_at
  from v3_user_messages
  group by message_id, chat_id
)
select
  message_id,
  chat_id,
  sender_id,
  text,
  sent_at
from inferred_messages
on conflict (message_id) do nothing;

insert into v3_message_receipts (message_id, user_id, delivered_at, read_at)
select
  message_id,
  user_id,
  case when status in ('delivered', 'read') then sent_at else null end,
  case when status = 'read' then sent_at else null end
from v3_user_messages
on conflict (message_id, user_id) do nothing;

insert into v3_user_chat_summaries (
  user_id,
  conversation_id,
  unread_count,
  last_message_id,
  last_message_preview,
  last_message_at,
  last_message_direction,
  last_message_status,
  updated_at
)
select
  user_id,
  chat_id,
  unread_count,
  last_message_id,
  last_message_text,
  last_message_sent_at,
  last_message_direction,
  last_message_status,
  updated_at
from v3_user_chats
on conflict (user_id, conversation_id) do update
set unread_count = excluded.unread_count,
    last_message_id = excluded.last_message_id,
    last_message_preview = excluded.last_message_preview,
    last_message_at = excluded.last_message_at,
    last_message_direction = excluded.last_message_direction,
    last_message_status = excluded.last_message_status,
    updated_at = excluded.updated_at;
