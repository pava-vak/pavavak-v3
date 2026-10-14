-- Migration 010: GIN index for full-text message search
create index if not exists idx_v3_messages_body_fts
  on v3_messages using gin(to_tsvector('simple', coalesce(body, '')));
