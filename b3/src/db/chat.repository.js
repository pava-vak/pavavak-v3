const crypto = require('crypto');
const { getPool } = require('./pool');
const { createSeedState } = require('../shared/chatSeed');

async function ensureSeededForUser(user) {
  const db = getPool();
  const existing = await db.query('select 1 from v3_user_chats where user_id = $1 limit 1', [user.userId]);
  if (existing.rowCount > 0) return;

  const seed = createSeedState(user);
  const client = await db.connect();
  try {
    await client.query('begin');

    for (const chat of seed.chats) {
      await client.query(
        `insert into v3_user_chats (
          user_id, chat_id, chat_type, title, subtitle, avatar_text, muted, unread_count,
          last_message_id, last_message_text, last_message_sent_at, last_message_direction, last_message_status,
          created_at, updated_at
        ) values (
          $1, $2, $3, $4, $5, $6, $7, $8,
          $9, $10, $11, $12, $13,
          now(), coalesce($11::timestamptz, now())
        ) on conflict (user_id, chat_id) do nothing`,
        [
          user.userId,
          chat.chatId,
          chat.chatType,
          chat.title,
          chat.subtitle,
          chat.avatarText,
          chat.muted,
          chat.unreadCount,
          chat.lastMessage?.messageId || null,
          chat.lastMessage?.text || null,
          chat.lastMessage?.sentAt || null,
          chat.lastMessage?.direction || null,
          chat.lastMessage?.status || null
        ]
      );

      const messages = seed.messagesByChatId[chat.chatId] || [];
      for (const message of messages) {
        await client.query(
          `insert into v3_user_messages (
            user_id, chat_id, message_id, direction, sender_display_name, text, sent_at, status
          ) values (
            $1, $2, $3, $4, $5, $6, $7::timestamptz, $8
          ) on conflict (user_id, chat_id, message_id) do nothing`,
          [
            user.userId,
            chat.chatId,
            message.messageId,
            message.direction,
            message.senderDisplayName,
            message.text,
            message.sentAt,
            message.status
          ]
        );
      }
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function listChatsForUser(user) {
  await ensureSeededForUser(user);
  const db = getPool();
  const result = await db.query(
    `select
      chat_id,
      chat_type,
      title,
      subtitle,
      avatar_text,
      unread_count,
      muted,
      last_message_id,
      last_message_text,
      last_message_sent_at,
      last_message_direction,
      last_message_status
     from v3_user_chats
     where user_id = $1
     order by coalesce(last_message_sent_at, updated_at) desc, updated_at desc`,
    [user.userId]
  );

  return result.rows.map((row) => ({
    chatId: row.chat_id,
    chatType: row.chat_type,
    title: row.title,
    subtitle: row.subtitle,
    avatarText: row.avatar_text,
    unreadCount: row.unread_count,
    muted: row.muted,
    lastMessage: row.last_message_id
      ? {
          messageId: row.last_message_id,
          text: row.last_message_text,
          sentAt: row.last_message_sent_at?.toISOString?.() || row.last_message_sent_at,
          direction: row.last_message_direction,
          status: row.last_message_status
        }
      : null
  }));
}

async function listMessagesForChat({ user, chatId, cursor = null, limit = 20 }) {
  await ensureSeededForUser(user);
  const db = getPool();
  const safeLimit = Math.max(1, Math.min(limit, 50));

  let cursorClause = '';
  const params = [user.userId, chatId, safeLimit + 1];
  if (cursor) {
    const cursorResult = await db.query(
      'select sent_at, message_id from v3_user_messages where user_id = $1 and chat_id = $2 and message_id = $3',
      [user.userId, chatId, cursor]
    );
    if (cursorResult.rowCount > 0) {
      cursorClause = 'and (sent_at, message_id) < ($4::timestamptz, $5)';
      params.push(cursorResult.rows[0].sent_at, cursorResult.rows[0].message_id);
    }
  }

  const result = await db.query(
    `select * from (
       select message_id, direction, sender_display_name, text, sent_at, status
       from v3_user_messages
       where user_id = $1 and chat_id = $2 ${cursorClause}
       order by sent_at desc, message_id desc
       limit $3
     ) recent
     order by sent_at asc, message_id asc`,
    params
  );

  const rows = result.rows;
  const hasMore = rows.length > safeLimit;
  const visibleRows = hasMore ? rows.slice(1) : rows;
  const items = visibleRows.map((row) => ({
    messageId: row.message_id,
    direction: row.direction,
    senderDisplayName: row.sender_display_name,
    text: row.text,
    sentAt: row.sent_at?.toISOString?.() || row.sent_at,
    status: row.status
  }));

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[0].messageId : null,
    hasMore
  };
}

async function appendOutgoingMessage(user, chatId, text) {
  await ensureSeededForUser(user);
  const db = getPool();
  const exists = await db.query('select 1 from v3_user_chats where user_id = $1 and chat_id = $2', [user.userId, chatId]);
  if (exists.rowCount === 0) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  const messageId = `m-${crypto.randomUUID()}`;
  const sentAt = new Date().toISOString();
  const message = {
    messageId,
    direction: 'outgoing',
    senderDisplayName: user.displayName,
    text,
    sentAt,
    status: 'sent'
  };

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into v3_user_messages (
        user_id, chat_id, message_id, direction, sender_display_name, text, sent_at, status
      ) values (
        $1, $2, $3, $4, $5, $6, $7::timestamptz, $8
      )`,
      [user.userId, chatId, message.messageId, message.direction, message.senderDisplayName, message.text, message.sentAt, message.status]
    );
    await client.query(
      `update v3_user_chats
       set last_message_id = $3,
           last_message_text = $4,
           last_message_sent_at = $5::timestamptz,
           last_message_direction = $6,
           last_message_status = $7,
           unread_count = 0,
           updated_at = now()
       where user_id = $1 and chat_id = $2`,
      [user.userId, chatId, message.messageId, message.text, message.sentAt, message.direction, message.status]
    );
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return message;
}

module.exports = {
  ensureSeededForUser,
  listChatsForUser,
  listMessagesForChat,
  appendOutgoingMessage
};
