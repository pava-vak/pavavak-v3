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

async function appendOutgoingMessage(user, chatId, text, messageId = null) {
  await ensureSeededForUser(user);
  const db = getPool();
  const exists = await db.query('select 1 from v3_user_chats where user_id = $1 and chat_id = $2', [user.userId, chatId]);
  if (exists.rowCount === 0) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  const resolvedMessageId = messageId || `m-${crypto.randomUUID()}`;
  const sentAt = new Date().toISOString();
  const message = {
    messageId: resolvedMessageId,
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
      [user.userId, chatId, resolvedMessageId, message.direction, message.senderDisplayName, message.text, message.sentAt, message.status]
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

async function getChatSummary(user, chatId) {
  const db = getPool();
  const result = await db.query(
    `select unread_count, last_message_id, last_message_text, last_message_sent_at, last_message_direction, last_message_status
     from v3_user_chats
     where user_id = $1 and chat_id = $2`,
    [user.userId, chatId]
  );
  if (result.rowCount === 0) return null;
  const row = result.rows[0];
  return {
    unreadCount: row.unread_count,
    lastMessage: row.last_message_id
      ? {
          messageId: row.last_message_id,
          text: row.last_message_text,
          sentAt: row.last_message_sent_at?.toISOString?.() || row.last_message_sent_at,
          direction: row.last_message_direction,
          status: row.last_message_status
        }
      : null
  };
}

async function findSenderUserId(db, chatId, messageId) {
  const r = await db.query(
    `select user_id from v3_user_messages
     where chat_id = $1 and message_id = $2 and direction = 'outgoing'
     limit 1`,
    [chatId, messageId]
  );
  return r.rows[0] ? Number(r.rows[0].user_id) : null;
}

async function markDelivered(user, chatId, messageId) {
  await ensureSeededForUser(user);
  const db = getPool();
  const result = await db.query(
    `update v3_user_messages
     set status = 'delivered'
     where user_id = $1 and chat_id = $2 and message_id = $3 and direction = 'incoming' and status = 'sent'
     returning message_id, status`,
    [user.userId, chatId, messageId]
  );
  if (result.rowCount === 0) {
    const existing = await db.query(
      `select message_id, status from v3_user_messages
       where user_id = $1 and chat_id = $2 and message_id = $3`,
      [user.userId, chatId, messageId]
    );
    if (existing.rowCount === 0) return null;
    return {
      messageId: existing.rows[0].message_id,
      status: existing.rows[0].status,
      senderUserId: await findSenderUserId(db, chatId, messageId)
    };
  }
  return {
    messageId: result.rows[0].message_id,
    status: result.rows[0].status,
    senderUserId: await findSenderUserId(db, chatId, messageId)
  };
}

async function markRead(user, chatId, messageId) {
  await ensureSeededForUser(user);
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('begin');
    const updated = await client.query(
      `update v3_user_messages
       set status = 'read'
       where user_id = $1 and chat_id = $2 and message_id = $3 and status != 'read'
       returning message_id, status`,
      [user.userId, chatId, messageId]
    );
    if (updated.rowCount === 0) {
      const existing = await client.query(
        `select message_id, status from v3_user_messages
         where user_id = $1 and chat_id = $2 and message_id = $3`,
        [user.userId, chatId, messageId]
      );
      if (existing.rowCount === 0) {
        await client.query('rollback');
        return null;
      }
      const unread = await client.query(
        `select count(*)::int as count from v3_user_messages
         where user_id = $1 and chat_id = $2 and direction = 'incoming' and status != 'read'`,
        [user.userId, chatId]
      );
      await client.query('rollback');
      return {
        messageId: existing.rows[0].message_id,
        status: existing.rows[0].status,
        unreadCount: unread.rows[0].count,
        senderUserId: await findSenderUserId(client, chatId, messageId)
      };
    }

    const unread = await client.query(
      `select count(*)::int as count from v3_user_messages
       where user_id = $1 and chat_id = $2 and direction = 'incoming' and status != 'read'`,
      [user.userId, chatId]
    );
    const unreadCount = unread.rows[0].count;
    await client.query(
      `update v3_user_chats set unread_count = $3, updated_at = now()
       where user_id = $1 and chat_id = $2`,
      [user.userId, chatId, unreadCount]
    );
    const senderUserId = await findSenderUserId(client, chatId, messageId);
    await client.query('commit');
    return {
      messageId: updated.rows[0].message_id,
      status: updated.rows[0].status,
      unreadCount,
      senderUserId
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function markChatRead(user, chatId) {
  await ensureSeededForUser(user);
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('begin');
    const exists = await client.query(
      'select 1 from v3_user_chats where user_id = $1 and chat_id = $2',
      [user.userId, chatId]
    );
    if (exists.rowCount === 0) {
      await client.query('rollback');
      return null;
    }

    const updated = await client.query(
      `update v3_user_messages
       set status = 'read'
       where user_id = $1 and chat_id = $2 and direction = 'incoming' and status != 'read'
       returning message_id`,
      [user.userId, chatId]
    );

    await client.query(
      `update v3_user_chats set unread_count = 0, updated_at = now()
       where user_id = $1 and chat_id = $2`,
      [user.userId, chatId]
    );
    await client.query('commit');

    const summary = await getChatSummary(user, chatId);
    const db2 = getPool();
    const receipts = await Promise.all(
      updated.rows.map(async (row) => ({
        messageId: row.message_id,
        senderUserId: await findSenderUserId(db2, chatId, row.message_id)
      }))
    );
    return {
      updatedMessageIds: updated.rows.map((row) => row.message_id),
      updatedReceipts: receipts,
      lastMessage: summary?.lastMessage || null
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function userHasAccess(user, chatId) {
  const db = getPool();
  const result = await db.query(
    'select 1 from v3_user_chats where user_id = $1 and chat_id = $2 limit 1',
    [user.userId, chatId]
  );
  return result.rowCount > 0;
}

async function getConversationMemberUserIds(chatId) {
  const db = getPool();
  const result = await db.query('select distinct user_id from v3_user_chats where chat_id = $1', [chatId]);
  return result.rows.map((row) => Number(row.user_id));
}

module.exports = {
  ensureSeededForUser,
  listChatsForUser,
  listMessagesForChat,
  appendOutgoingMessage,
  markDelivered,
  markRead,
  markChatRead,
  userHasAccess,
  getConversationMemberUserIds
};
