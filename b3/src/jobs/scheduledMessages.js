const { getPool } = require('../db/pool');
const realtime = require('../realtime/eventEmitter');
const { randomUUID } = require('crypto');

let timer = null;

async function runOnce() {
  const db = getPool();
  const now = new Date().toISOString();

  let rows;
  try {
    const result = await db.query(
      `select s.id, s.sender_id, s.conversation_id, s.body,
              u.display_name, u.username
       from v3_scheduled_messages s
       join v3_users u on u.user_id = s.sender_id
       where s.scheduled_at <= $1 and not s.sent
       order by s.scheduled_at asc
       limit 50`,
      [now]
    );
    rows = result.rows;
  } catch {
    return; // DB not ready or table doesn't exist yet — skip silently
  }

  for (const row of rows) {
    const messageId = `m-${randomUUID()}`;
    const sentAt = new Date().toISOString();
    const client = await db.connect();
    try {
      await client.query('begin');
      await client.query(
        `insert into v3_messages(message_id, conversation_id, sender_id, body, created_at)
         values($1, $2, $3, $4, now())`,
        [messageId, row.conversation_id, row.sender_id, row.body]
      );
      await client.query(
        'update v3_scheduled_messages set sent=true, sent_at=now() where id=$1',
        [row.id]
      );
      const { rows: memberRows } = await client.query(
        'select user_id from v3_conversation_members where conversation_id=$1',
        [row.conversation_id]
      );
      const memberIds = memberRows.map(r => Number(r.user_id));
      const senderId = Number(row.sender_id);
      for (const memberId of memberIds) {
        const isSender = memberId === senderId;
        // Every member needs a receipt row: thread queries only return messages the reader received
        await client.query(
          `insert into v3_message_receipts(message_id, user_id) values($1, $2) on conflict do nothing`,
          [messageId, memberId]
        );
        await client.query(
          `insert into v3_user_chat_summaries(user_id, conversation_id, unread_count, last_message_id,
             last_message_preview, last_message_at, last_message_direction, last_message_status, updated_at)
           values($1,$2,$3,$4,$5,$6::timestamptz,$7,'sent',now())
           on conflict(user_id, conversation_id) do update
           set unread_count = case when $8 then 0 else v3_user_chat_summaries.unread_count + 1 end,
               last_message_id = excluded.last_message_id,
               last_message_preview = excluded.last_message_preview,
               last_message_at = excluded.last_message_at,
               last_message_direction = excluded.last_message_direction,
               last_message_status = excluded.last_message_status,
               updated_at = now()`,
          [memberId, row.conversation_id, isSender ? 0 : 1, messageId,
           row.body, sentAt, isSender ? 'outgoing' : 'incoming', isSender]
        );
      }
      await client.query('commit');
      const auth = { userId: Number(row.sender_id), displayName: row.display_name, username: row.username };
      const message = {
        messageId,
        chatId: row.conversation_id,
        text: row.body,
        direction: 'outgoing',
        sentAt,
        status: 'sent',
        senderDisplayName: row.display_name
      };
      realtime.emitMessageNewToMembers(auth, row.conversation_id, message, memberIds);
    } catch (err) {
      console.error('[scheduledMessages] failed to send message', row.id, err.message);
      try { await client.query('rollback'); } catch {}
    } finally {
      client.release();
    }
  }
}

function start() {
  if (timer) return;
  // Check every 30 seconds
  timer = setInterval(runOnce, 30_000);
  runOnce(); // run immediately on startup
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop };
