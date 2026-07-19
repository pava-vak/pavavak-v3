const crypto = require('crypto');
const { getPool } = require('./pool');
const { createSeedState } = require('../shared/chatSeed');
const identity = require('./identityAdapter');
const { env } = require('../config/env');

async function ensureUser(user) {
  const db = getPool();
  await db.query(
    `insert into v3_users (user_id, username, display_name, is_admin)
     values ($1, $2, $3, $4)
     on conflict (user_id) do update
     set username = excluded.username,
         display_name = excluded.display_name,
         is_admin = excluded.is_admin`,
    [user.userId, user.username, user.displayName, Boolean(user.isAdmin)]
  );
}

async function ensureSeededForUser(user) {
  await ensureUser(user);
  // No demo seed in production — real users should not get bot contacts
  if (env.APP_ENV === 'production') return;
  const db = getPool();
  const existing = await db.query(
    'select 1 from v3_user_chat_summaries where user_id = $1 limit 1',
    [user.userId]
  );
  if (existing.rowCount > 0) return;

  const seed = createSeedState(user);
  const client = await db.connect();
  try {
    await client.query('begin');

    for (const chat of seed.chats) {
      const contactUserId = Number(chat.contactUserId || 0);
      if (contactUserId > 0) {
        await client.query(
          `insert into v3_users (user_id, username, display_name, is_admin)
           values ($1, $2, $3, false)
           on conflict do nothing`,
          [contactUserId, chat.subtitle.replace(/^@/, '') || chat.title, chat.title]
        );
      }

      await client.query(
        `insert into v3_conversations (conversation_id, type, title)
         values ($1, $2, $3)
         on conflict (conversation_id) do nothing`,
        [chat.chatId, chat.chatType, chat.title]
      );
      await client.query(
        `insert into v3_conversation_members (conversation_id, user_id, muted)
         values ($1, $2, $3)
         on conflict (conversation_id, user_id) do nothing`,
        [chat.chatId, user.userId, chat.muted]
      );
      if (contactUserId > 0) {
        await client.query(
          `insert into v3_conversation_members (conversation_id, user_id, muted)
           values ($1, $2, false)
           on conflict (conversation_id, user_id) do nothing`,
          [chat.chatId, contactUserId]
        );
      }

      const messages = seed.messagesByChatId[chat.chatId] || [];
      for (const message of messages) {
        const senderId = message.direction === 'outgoing' ? user.userId : contactUserId || user.userId;
        await client.query(
          `insert into v3_messages (message_id, conversation_id, sender_id, body, created_at)
           values ($1, $2, $3, $4, $5::timestamptz)
           on conflict (message_id) do nothing`,
          [message.messageId, chat.chatId, senderId, message.text, message.sentAt]
        );

        // Viewer's own receipt
        await client.query(
          `insert into v3_message_receipts (message_id, user_id, delivered_at, read_at)
           values ($1, $2, $3, $4)
           on conflict (message_id, user_id) do nothing`,
          [
            message.messageId,
            user.userId,
            message.status === 'sent' ? null : new Date(message.sentAt).toISOString(),
            message.status === 'read' ? new Date(message.sentAt).toISOString() : null
          ]
        );

        // Peer receipt — required so the outgoing-status SQL CASE can find a peer row.
        // Without this, NOT EXISTS(peer) is true and every outgoing message shows 'sent'.
        if (contactUserId > 0 && contactUserId !== user.userId) {
          const peerIsRecipient = message.direction === 'outgoing';
          await client.query(
            `insert into v3_message_receipts (message_id, user_id, delivered_at, read_at)
             values ($1, $2, $3, $4)
             on conflict (message_id, user_id) do nothing`,
            [
              message.messageId,
              contactUserId,
              peerIsRecipient && message.status !== 'sent' ? new Date(message.sentAt).toISOString() : null,
              peerIsRecipient && message.status === 'read' ? new Date(message.sentAt).toISOString() : null
            ]
          );
        }
      }

      await client.query(
        `insert into v3_user_chat_summaries (
          user_id, conversation_id, unread_count, last_message_id, last_message_preview,
          last_message_at, last_message_direction, last_message_status, updated_at
        ) values ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, coalesce($6::timestamptz, now()))
        on conflict (user_id, conversation_id) do nothing`,
        [
          user.userId,
          chat.chatId,
          chat.unreadCount,
          chat.lastMessage?.messageId || null,
          chat.lastMessage?.text || null,
          chat.lastMessage?.sentAt || null,
          chat.lastMessage?.direction || null,
          chat.lastMessage?.status || null
        ]
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

function mapSummaryRow(row) {
  return {
    chatId: row.conversation_id,
    chatType: row.type,
    title: row.title,
    subtitle: row.subtitle || '',
    avatarText: row.avatar_text || '?',
    unreadCount: row.unread_count,
    muted: row.muted,
    lastMessage: row.last_message_id
      ? {
          messageId: row.last_message_id,
          text: row.last_message_preview,
          sentAt: row.last_message_at?.toISOString?.() || row.last_message_at,
          direction: row.last_message_direction,
          status: row.last_message_status
        }
      : null
  };
}

async function listChatsForUser(user) {
  await ensureSeededForUser(user);
  const db = getPool();
  const result = await db.query(
    `select
      s.conversation_id,
      c.type,
      -- for direct chats show the OTHER person's name, not the stored title
      case
        when c.type = 'direct' then
          coalesce(
            (select coalesce(u.display_name, u.username)
             from v3_conversation_members cm
             join v3_users u on u.user_id = cm.user_id
             where cm.conversation_id = c.conversation_id
               and cm.user_id != $1
             limit 1),
            c.title
          )
        else c.title
      end as title,
      '' as subtitle,
      left(coalesce(
        case when c.type = 'direct' then
          (select coalesce(u.display_name, u.username)
           from v3_conversation_members cm
           join v3_users u on u.user_id = cm.user_id
           where cm.conversation_id = c.conversation_id
             and cm.user_id != $1
           limit 1)
        else c.title end,
        '?'
      ), 1) as avatar_text,
      s.unread_count,
      m.muted,
      s.last_message_id,
      s.last_message_preview,
      s.last_message_at,
      s.last_message_direction,
      s.last_message_status
     from v3_user_chat_summaries s
     join v3_conversations c on c.conversation_id = s.conversation_id
     join v3_conversation_members m on m.conversation_id = s.conversation_id and m.user_id = s.user_id
     where s.user_id = $1
     order by coalesce(s.last_message_at, s.updated_at) desc, s.updated_at desc`,
    [user.userId]
  );
  return result.rows.map(mapSummaryRow);
}

async function listMessagesForChat({ user, chatId, cursor = null, limit = 20 }) {
  await ensureSeededForUser(user);
  const db = getPool();
  const safeLimit = Math.max(1, Math.min(limit, 50));

  let cursorClause = '';
  let params;
  const displayName = user.displayName || 'User';

  if (cursor) {
    const cursorResult = await db.query(
      'select created_at, message_id from v3_messages where message_id = $1 and conversation_id = $2',
      [cursor, chatId]
    );
    if (cursorResult.rowCount > 0) {
      const cursorAt = cursorResult.rows[0].created_at;
      const cursorId = cursorResult.rows[0].message_id;
      // $1=userId, $2=chatId, $3=limit+1, $4=cursorAt, $5=cursorId, $6=displayName
      cursorClause = 'and (msg.created_at, msg.message_id) < ($4::timestamptz, $5::text)';
      params = [user.userId, chatId, safeLimit + 1, cursorAt, cursorId, displayName];
    }
  }
  if (!params) {
    // $1=userId, $2=chatId, $3=limit+1, $4=displayName
    params = [user.userId, chatId, safeLimit + 1, displayName];
  }

  const dnParam = params.length === 6 ? '$6' : '$4';
  const result = await db.query(
    `select * from (
       select
         msg.message_id,
         case when msg.sender_id = $1 then 'outgoing' else 'incoming' end as direction,
         case when msg.sender_id = $1
              then ${dnParam}
              else coalesce(sender.display_name, sender.username, msg.sender_id::text)
         end as sender_display_name,
         msg.view_once,
         msg.expires_at,
         r.view_once_opened_at,
         case
           when msg.view_once and msg.sender_id = $1 then ''
           when msg.view_once and msg.sender_id != $1 and r.view_once_opened_at is not null then ''
           else msg.body
         end as text,
         msg.created_at as sent_at,
         case
           when msg.sender_id = $1 then
             case
               when not exists (
                 select 1
                 from v3_message_receipts peer
                 where peer.message_id = msg.message_id
                   and peer.user_id != msg.sender_id
               ) then 'sent'
               when not exists (
                 select 1
                 from v3_message_receipts peer
                 where peer.message_id = msg.message_id
                   and peer.user_id != msg.sender_id
                   and peer.read_at is null
               ) then 'read'
               when not exists (
                 select 1
                 from v3_message_receipts peer
                 where peer.message_id = msg.message_id
                   and peer.user_id != msg.sender_id
                   and peer.delivered_at is null
               ) then 'delivered'
               else 'sent'
             end
           when r.read_at is not null then 'read'
           when r.delivered_at is not null then 'delivered'
           else 'sent'
         end as status
       from v3_messages msg
       join v3_message_receipts r on r.message_id = msg.message_id and r.user_id = $1
       left join v3_users sender on sender.user_id = msg.sender_id
       where msg.conversation_id = $2
         and (msg.expires_at is null or msg.expires_at > now())
         ${cursorClause}
       order by msg.created_at desc, msg.message_id desc
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
    status: row.status,
    viewOnce: Boolean(row.view_once),
    viewOnceOpened: Boolean(row.view_once_opened_at),
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at || null
  }));

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[0].messageId : null,
    hasMore
  };
}

async function appendOutgoingMessage(user, chatId, text, messageId = null, { viewOnce = false, expiresAt = null } = {}) {
  await ensureSeededForUser(user);
  const db = getPool();
  const exists = await db.query(
    `select 1 from v3_conversation_members where conversation_id = $1 and user_id = $2`,
    [chatId, user.userId]
  );
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
    text: viewOnce ? '' : text,
    sentAt,
    status: 'sent',
    viewOnce: Boolean(viewOnce),
    viewOnceOpened: false,
    expiresAt: expiresAt || null
  };

  const membersResult = await db.query(
    'select user_id from v3_conversation_members where conversation_id = $1',
    [chatId]
  );
  const memberIds = membersResult.rows.map((row) => Number(row.user_id));

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into v3_messages (message_id, conversation_id, sender_id, body, view_once, expires_at, created_at)
       values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz)`,
      [resolvedMessageId, chatId, user.userId, text, Boolean(viewOnce), expiresAt, sentAt]
    );

    for (const memberId of memberIds) {
      await client.query(
        `insert into v3_message_receipts (message_id, user_id)
         values ($1, $2)
         on conflict (message_id, user_id) do nothing`,
        [resolvedMessageId, memberId]
      );

      const isSender = memberId === user.userId;
      await client.query(
        `insert into v3_user_chat_summaries (
          user_id, conversation_id, unread_count, last_message_id, last_message_preview,
          last_message_at, last_message_direction, last_message_status, updated_at
        ) values ($1, $2, $3, $4, $5, $6::timestamptz, $7, $8, now())
        on conflict (user_id, conversation_id) do update
        set unread_count = case when $9 then 0 else v3_user_chat_summaries.unread_count + 1 end,
            last_message_id = excluded.last_message_id,
            last_message_preview = excluded.last_message_preview,
            last_message_at = excluded.last_message_at,
            last_message_direction = excluded.last_message_direction,
            last_message_status = excluded.last_message_status,
            updated_at = now()`,
        [
          memberId,
          chatId,
          isSender ? 0 : 1,
          resolvedMessageId,
          viewOnce ? '👁 View once message' : text,
          sentAt,
          isSender ? 'outgoing' : 'incoming',
          isSender ? 'sent' : 'sent',
          isSender
        ]
      );
    }

    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return message;
}

function directConversationId(firstUserId, secondUserId) {
  const ids = [Number(firstUserId), Number(secondUserId)].sort((a, b) => a - b);
  return `direct::${ids[0]}:${ids[1]}`;
}

async function createDirectConversation(user, otherUserId) {
  await ensureUser(user);
  const otherUser = await identity.getById(otherUserId);
  if (!otherUser) {
    const error = new Error('User not found');
    error.status = 404;
    throw error;
  }
  if (Number(otherUser.userId) === Number(user.userId)) {
    const error = new Error('Cannot start a chat with yourself');
    error.status = 400;
    throw error;
  }

  const db = getPool();
  const chatId = directConversationId(user.userId, otherUser.userId);
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into v3_conversations (conversation_id, type, title)
       values ($1, 'direct', $2)
       on conflict (conversation_id) do nothing`,
      [chatId, otherUser.displayName]
    );
    for (const member of [user, otherUser]) {
      await client.query(
        `insert into v3_conversation_members (conversation_id, user_id, muted)
         values ($1, $2, false)
         on conflict (conversation_id, user_id) do nothing`,
        [chatId, member.userId]
      );
      await client.query(
        `insert into v3_user_chat_summaries (user_id, conversation_id, unread_count, updated_at)
         values ($1, $2, 0, now())
         on conflict (user_id, conversation_id) do nothing`,
        [member.userId, chatId]
      );
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return {
    chatId,
    chatType: 'direct',
    title: otherUser.displayName,
    subtitle: `@${otherUser.username}`,
    avatarText: otherUser.displayName.slice(0, 1).toUpperCase(),
    unreadCount: 0,
    muted: false,
    lastMessage: null
  };
}

async function markDelivered(user, chatId, messageId) {
  await ensureSeededForUser(user);
  const db = getPool();
  const result = await db.query(
    `update v3_message_receipts r
     set delivered_at = coalesce(delivered_at, now())
     from v3_messages msg
     where r.message_id = msg.message_id
       and r.user_id = $1
       and msg.conversation_id = $2
       and r.message_id = $3
       and msg.sender_id != $1
     returning r.message_id, msg.sender_id`,
    [user.userId, chatId, messageId]
  );
  if (result.rowCount === 0) return null;
  const senderUserId = Number(result.rows[0].sender_id);
  await db.query(
    `update v3_user_chat_summaries
     set last_message_status = 'delivered', updated_at = now()
     where user_id = $1 and conversation_id = $2 and last_message_id = $3 and last_message_status = 'sent'`,
    [senderUserId, chatId, messageId]
  );
  return { messageId, status: 'delivered', senderUserId };
}

async function markRead(user, chatId, messageId) {
  await ensureSeededForUser(user);
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('begin');
    const updated = await client.query(
      `update v3_message_receipts r
       set read_at = coalesce(read_at, now()),
           delivered_at = coalesce(delivered_at, now())
       from v3_messages msg
       where r.message_id = msg.message_id
         and r.user_id = $1
         and msg.conversation_id = $2
         and r.message_id = $3
         and msg.sender_id != $1
       returning r.message_id, msg.sender_id`,
      [user.userId, chatId, messageId]
    );
    if (updated.rowCount === 0) {
      await client.query('rollback');
      return null;
    }

    const unread = await client.query(
      `select count(*)::int as count
       from v3_message_receipts r
       join v3_messages msg on msg.message_id = r.message_id
       where r.user_id = $1 and msg.conversation_id = $2 and r.read_at is null and msg.sender_id != $1`,
      [user.userId, chatId]
    );
    const unreadCount = unread.rows[0].count;
    await client.query(
      `update v3_user_chat_summaries
       set unread_count = $3, last_message_status = 'read', updated_at = now()
       where user_id = $1 and conversation_id = $2`,
      [user.userId, chatId, unreadCount]
    );
    const senderUserId = Number(updated.rows[0].sender_id);
    await client.query(
      `update v3_user_chat_summaries
       set last_message_status = 'read', updated_at = now()
       where user_id = $1 and conversation_id = $2 and last_message_id = $3`,
      [senderUserId, chatId, messageId]
    );
    await client.query('commit');
    return { messageId, status: 'read', unreadCount, senderUserId };
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
      'select 1 from v3_user_chat_summaries where user_id = $1 and conversation_id = $2',
      [user.userId, chatId]
    );
    if (exists.rowCount === 0) {
      await client.query('rollback');
      return null;
    }

    const updated = await client.query(
      `update v3_message_receipts r
       set read_at = coalesce(read_at, now()),
           delivered_at = coalesce(delivered_at, now())
       from v3_messages msg
       where r.message_id = msg.message_id
         and r.user_id = $1
         and msg.conversation_id = $2
         and msg.sender_id != $1
         and r.read_at is null
       returning r.message_id, msg.sender_id`,
      [user.userId, chatId]
    );

    await client.query(
      `update v3_user_chat_summaries
       set unread_count = 0, updated_at = now()
       where user_id = $1 and conversation_id = $2`,
      [user.userId, chatId]
    );
    await client.query('commit');

    const summary = await db.query(
      `select last_message_id, last_message_preview, last_message_at, last_message_direction, last_message_status
       from v3_user_chat_summaries where user_id = $1 and conversation_id = $2`,
      [user.userId, chatId]
    );
    const row = summary.rows[0];
    return {
      updatedMessageIds: updated.rows.map((item) => item.message_id),
      updatedReceipts: updated.rows.map((item) => ({
        messageId: item.message_id,
        senderUserId: Number(item.sender_id)
      })),
      lastMessage: row?.last_message_id
        ? {
            messageId: row.last_message_id,
            text: row.last_message_preview,
            sentAt: row.last_message_at?.toISOString?.() || row.last_message_at,
            direction: row.last_message_direction,
            status: row.last_message_status
          }
        : null
    };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function listAllChats() {
  const db = getPool();
  const result = await db.query(
    `select
       c.conversation_id,
       c.type,
       c.title,
       json_agg(json_build_object(
         'userId', m.user_id,
         'username', coalesce(u.username, m.user_id::text),
         'displayName', coalesce(u.display_name, u.username, m.user_id::text)
       ) order by m.user_id) as participants
     from v3_conversations c
     join v3_conversation_members m on m.conversation_id = c.conversation_id
     left join v3_users u on u.user_id = m.user_id
     group by c.conversation_id, c.type, c.title
     order by c.conversation_id`
  );
  return result.rows.map((row) => ({
    chatId: row.conversation_id,
    chatType: row.type,
    title: row.title,
    participants: (row.participants || []).map((p) => ({
      userId: Number(p.userId),
      username: p.username,
      displayName: p.displayName
    }))
  }));
}

async function adminListMessagesForChat(chatId, cursor = null, limit = 50) {
  const db = getPool();
  const safeLimit = Math.max(1, Math.min(limit, 50));

  let cursorClause = '';
  let params = [chatId, safeLimit + 1];

  if (cursor) {
    const cursorResult = await db.query(
      'select created_at, message_id from v3_messages where message_id = $1 and conversation_id = $2',
      [cursor, chatId]
    );
    if (cursorResult.rowCount > 0) {
      cursorClause = 'and (msg.created_at, msg.message_id) < ($3::timestamptz, $4::text)';
      params = [chatId, safeLimit + 1, cursorResult.rows[0].created_at, cursorResult.rows[0].message_id];
    }
  }

  const result = await db.query(
    `select * from (
       select
         msg.message_id,
         msg.sender_id,
         coalesce(u.display_name, u.username, msg.sender_id::text) as sender_display_name,
         msg.body as text,
         msg.created_at as sent_at
       from v3_messages msg
       left join v3_users u on u.user_id = msg.sender_id
       where msg.conversation_id = $1 ${cursorClause}
       order by msg.created_at desc, msg.message_id desc
       limit $2
     ) recent
     order by sent_at asc, message_id asc`,
    params
  );

  const rows = result.rows;
  const hasMore = rows.length > safeLimit;
  const visibleRows = hasMore ? rows.slice(1) : rows;
  const items = visibleRows.map((row) => ({
    messageId: row.message_id,
    senderId: Number(row.sender_id),
    senderDisplayName: row.sender_display_name,
    direction: 'incoming',
    text: row.text,
    sentAt: row.sent_at?.toISOString?.() || row.sent_at,
    status: 'sent'
  }));

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[0].messageId : null,
    hasMore
  };
}

async function openViewOnceMessage(user, messageId) {
  const db = getPool();
  await db.query(
    `update v3_message_receipts
     set view_once_opened_at = coalesce(view_once_opened_at, now())
     where message_id = $1 and user_id = $2`,
    [messageId, user.userId]
  );
}

async function userHasAccess(user, chatId) {
  const db = getPool();
  const result = await db.query(
    'select 1 from v3_conversation_members where conversation_id = $1 and user_id = $2 limit 1',
    [chatId, user.userId]
  );
  return result.rowCount > 0;
}

async function getConversationMemberUserIds(chatId) {
  const db = getPool();
  const result = await db.query(
    'select user_id from v3_conversation_members where conversation_id = $1',
    [chatId]
  );
  return result.rows.map((row) => Number(row.user_id));
}

module.exports = {
  ensureSeededForUser,
  listChatsForUser,
  listMessagesForChat,
  appendOutgoingMessage,
  openViewOnceMessage,
  markDelivered,
  markRead,
  markChatRead,
  userHasAccess,
  getConversationMemberUserIds,
  createDirectConversation,
  listAllChats,
  adminListMessagesForChat
};
