const { getPool } = require('../../db/pool');
const { env } = require('../../config/env');

const MEDIA_MARKER_RE = /^__(IMG|VID|AUD|DOC)__:([^:]+)/;

// Documents are stored as __DOC__:<fileId>:<filename>; other media as __XXX__:<fileId>
function fileIdFromBody(text) {
  const match = MEDIA_MARKER_RE.exec(String(text || ''));
  return match ? match[2] : null;
}

async function ensureTable() {
  if (!env.DATABASE_URL) return;
  await getPool().query(`
    CREATE TABLE IF NOT EXISTS v3_media_uploads (
      file_id     TEXT PRIMARY KEY,
      uploaded_by BIGINT NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
}

async function recordUpload(fileId, userId) {
  await getPool().query(
    'insert into v3_media_uploads(file_id, uploaded_by) values($1, $2) on conflict do nothing',
    [fileId, userId]
  );
}

// A file is visible to its uploader, or to a current chat member who received a
// live (not deleted / expired) message carrying it.
async function canAccessFile(userId, fileId) {
  const db = getPool();
  const { rows: own } = await db.query(
    'select 1 from v3_media_uploads where file_id = $1 and uploaded_by = $2 limit 1',
    [fileId, userId]
  );
  if (own.length) return true;

  const { rows: indexed } = await db.query(
    `select 1 from v3_message_media mm
     join v3_messages m on m.message_id = mm.message_id
     join v3_message_receipts r on r.message_id = m.message_id and r.user_id = $2
     join v3_conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = $2
     where mm.file_id = $1 and m.deleted_at is null
       and (m.expires_at is null or m.expires_at > now())
     limit 1`,
    [fileId, userId]
  );
  if (indexed.length) return true;

  // Forwarded copies are not in v3_message_media, so match on the message body
  const { rows: byBody } = await db.query(
    `select 1 from v3_messages m
     join v3_message_receipts r on r.message_id = m.message_id and r.user_id = $1
     join v3_conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = $1
     where m.deleted_at is null
       and (m.expires_at is null or m.expires_at > now())
       and (m.body in ($2, $3, $4) or m.body like $5)
     limit 1`,
    [userId, `__IMG__:${fileId}`, `__VID__:${fileId}`, `__AUD__:${fileId}`, `__DOC__:${fileId}:%`]
  );
  return byBody.length > 0;
}

module.exports = { ensureTable, recordUpload, canAccessFile, fileIdFromBody };
