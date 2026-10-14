const { getPool } = require('../db/pool');
const realtime = require('../realtime/eventEmitter');

let timer = null;

async function runOnce() {
  const db = getPool();
  let rows;
  try {
    const result = await db.query(
      `select message_id, conversation_id from v3_messages
       where expires_at is not null and expires_at <= now() and deleted_at is null
       limit 100`
    );
    rows = result.rows;
  } catch {
    return; // DB not ready or table doesn't exist yet — skip silently
  }
  for (const row of rows) {
    try {
      await db.query(
        "update v3_messages set deleted_at=now(), body='' where message_id=$1",
        [row.message_id]
      );
      const { rows: memberRows } = await db.query(
        'select user_id from v3_conversation_members where conversation_id=$1',
        [row.conversation_id]
      );
      const memberIds = memberRows.map(r => r.user_id);
      memberIds.forEach(id => realtime.emitToUser(id, 'message:deleted', {
        chatId: row.conversation_id,
        messageId: row.message_id
      }));
    } catch { /* skip failed row, try next */ }
  }
}

function start() {
  if (timer) return;
  timer = setInterval(runOnce, 60_000); // check every minute
  runOnce(); // run immediately on startup
}

function stop() {
  if (timer) { clearInterval(timer); timer = null; }
}

module.exports = { start, stop };
