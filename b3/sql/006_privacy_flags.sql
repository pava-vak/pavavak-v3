-- Privacy flags: view-once messages + auto-expiry
alter table v3_messages add column if not exists view_once boolean not null default false;
alter table v3_messages add column if not exists expires_at timestamptz;

-- Track per-user opening of view-once messages
alter table v3_message_receipts add column if not exists view_once_opened_at timestamptz;

create index if not exists idx_v3_messages_expires
  on v3_messages (expires_at)
  where expires_at is not null;
