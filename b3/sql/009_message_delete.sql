-- Migration 009: soft-delete support for messages
alter table v3_messages add column if not exists deleted_at timestamptz;
create index if not exists idx_v3_messages_deleted on v3_messages(deleted_at) where deleted_at is not null;
