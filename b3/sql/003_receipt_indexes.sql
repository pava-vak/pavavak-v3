create index if not exists idx_v3_user_messages_unread
  on v3_user_messages (user_id, chat_id, direction, status)
  where direction = 'incoming' and status != 'read';
