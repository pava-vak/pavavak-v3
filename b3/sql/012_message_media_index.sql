-- Migration 012: Dedicated media lookup table + user search trigram indexes
-- Replaces full-table body scan in media auth with a single indexed lookup.
-- Also adds pg_trgm GIN indexes for fast ILIKE user search.

-- ── Media lookup table ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS v3_message_media (
  file_id         TEXT        NOT NULL,
  message_id      TEXT        NOT NULL REFERENCES v3_messages(message_id) ON DELETE CASCADE,
  conversation_id TEXT        NOT NULL REFERENCES v3_conversations(conversation_id) ON DELETE CASCADE,
  uploaded_by     BIGINT      NOT NULL REFERENCES v3_users(user_id),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (file_id)
);

CREATE INDEX IF NOT EXISTS idx_v3_message_media_conv ON v3_message_media(conversation_id);
CREATE INDEX IF NOT EXISTS idx_v3_message_media_msg  ON v3_message_media(message_id);

-- Back-fill from existing messages so auth works for old files too.
-- Parses __IMG__:uuid.ext, __VID__:uuid.ext, __AUD__:uuid.ext, __DOC__:uuid.ext patterns.
INSERT INTO v3_message_media (file_id, message_id, conversation_id, uploaded_by)
SELECT
  substring(body FROM '[^:]+$') AS file_id,
  message_id,
  conversation_id,
  sender_id AS uploaded_by
FROM v3_messages
WHERE body ~ '^__(IMG|VID|AUD|DOC)__:[a-f0-9\-]+\.[a-z0-9]+$'
  AND deleted_at IS NULL
ON CONFLICT (file_id) DO NOTHING;

-- ── Trigram indexes for fast user search (ILIKE '%...%') ──────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX IF NOT EXISTS idx_v3_users_username_trgm
  ON v3_users USING gin(username gin_trgm_ops);

CREATE INDEX IF NOT EXISTS idx_v3_users_displayname_trgm
  ON v3_users USING gin(display_name gin_trgm_ops);

-- ── Pool connection default timeout ───────────────────────────────────────
-- Set per-connection statement timeout as a fallback (pool.js also does this
-- via the 'connect' event, but the ALTER USER approach makes it persistent).
-- ALTER ROLE is optional — skip if the DB user lacks SUPERUSER privilege.
-- DO $$
-- BEGIN
--   EXECUTE format('ALTER ROLE %I SET statement_timeout = ''8s''', current_user);
-- EXCEPTION WHEN insufficient_privilege THEN NULL;
-- END $$;
