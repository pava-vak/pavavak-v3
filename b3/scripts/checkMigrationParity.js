#!/usr/bin/env node
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
const { getPool, closePool } = require('../src/db/pool');

async function scalar(db, sql) {
  const result = await db.query(sql);
  return Number(result.rows[0]?.count || 0);
}

async function run() {
  if (!process.env.DATABASE_URL) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const db = getPool();
  const checks = [
    {
      name: 'legacy chat summaries missing in normalized cache',
      sql: `
        select count(*)::int as count
        from v3_user_chats legacy
        left join v3_user_chat_summaries normalized
          on normalized.user_id = legacy.user_id
         and normalized.conversation_id = legacy.chat_id
        where normalized.user_id is null
      `
    },
    {
      name: 'normalized chat summaries missing in legacy mailbox',
      sql: `
        select count(*)::int as count
        from v3_user_chat_summaries normalized
        left join v3_user_chats legacy
          on legacy.user_id = normalized.user_id
         and legacy.chat_id = normalized.conversation_id
        where legacy.user_id is null
      `
    },
    {
      name: 'chat summary field mismatches',
      sql: `
        select count(*)::int as count
        from v3_user_chats legacy
        join v3_user_chat_summaries normalized
          on normalized.user_id = legacy.user_id
         and normalized.conversation_id = legacy.chat_id
        where legacy.unread_count is distinct from normalized.unread_count
           or legacy.last_message_id is distinct from normalized.last_message_id
           or legacy.last_message_text is distinct from normalized.last_message_preview
           or legacy.last_message_direction is distinct from normalized.last_message_direction
           or legacy.last_message_status is distinct from normalized.last_message_status
      `
    },
    {
      name: 'legacy message receipts missing in normalized receipts',
      sql: `
        select count(*)::int as count
        from v3_user_messages legacy
        left join v3_message_receipts normalized
          on normalized.user_id = legacy.user_id
         and normalized.message_id = legacy.message_id
        where normalized.user_id is null
      `
    },
    {
      name: 'normalized receipts missing in legacy messages',
      sql: `
        select count(*)::int as count
        from v3_message_receipts normalized
        left join v3_user_messages legacy
          on legacy.user_id = normalized.user_id
         and legacy.message_id = normalized.message_id
        where legacy.user_id is null
      `
    },
    {
      name: 'message body or timestamp mismatches',
      sql: `
        select count(*)::int as count
        from v3_user_messages legacy
        join v3_messages normalized
          on normalized.message_id = legacy.message_id
         and normalized.conversation_id = legacy.chat_id
        where legacy.text is distinct from normalized.body
           or legacy.sent_at is distinct from normalized.created_at
      `
    }
  ];

  const rows = [];
  for (const check of checks) {
    rows.push({
      check: check.name,
      mismatches: await scalar(db, check.sql)
    });
  }

  console.table(rows);
  await closePool();

  const total = rows.reduce((sum, row) => sum + row.mismatches, 0);
  if (total > 0) {
    console.error(`migration parity failed with ${total} mismatches`);
    process.exit(1);
  }
  console.log('migration parity passed');
}

run().catch(async (error) => {
  await closePool();
  console.error(error);
  process.exit(1);
});
