const crypto = require('crypto');
const { getPool } = require('./pool');
const { createSeedState } = require('../shared/chatSeed');
const identity = require('./identityAdapter');
const { env } = require('../config/env');

// Creates the row if missing. Never updates it: the values come from the access token, which can be
// stale (e.g. right after a rename), and the identity repository owns these columns.
async function ensureUser(user) {
  const db = getPool();
  await db.query(
    `insert into v3_users (user_id, username, display_name, is_admin)
     values ($1, $2, $3, $4)
     on conflict (user_id) do nothing`,
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
    archived: Boolean(row.archived),
    background: row.chat_background || null,
    peerId: row.peer_user_id || null,
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
  // Single LATERAL JOIN fetches the peer user once per direct conversation,
  // eliminating the 3 correlated subqueries the old query ran per row.
  const result = await db.query(
    `select
      s.conversation_id,
      c.type,
      case
        when c.type = 'direct' then coalesce(peer.name, c.title)
        else c.title
      end as title,
      '' as subtitle,
      left(case
        when c.type = 'direct' then coalesce(peer.name, '?')
        else coalesce(c.title, '?')
      end, 1) as avatar_text,
      s.unread_count,
      m.muted,
      m.archived,
      m.chat_background,
      s.last_message_id,
      s.last_message_preview,
      s.last_message_at,
      s.last_message_direction,
      s.last_message_status,
      case when c.type = 'direct' then peer.user_id else null end as peer_user_id
    from v3_user_chat_summaries s
    join v3_conversations c on c.conversation_id = s.conversation_id
    join v3_conversation_members m on m.conversation_id = s.conversation_id and m.user_id = s.user_id
    left join lateral (
      select cm.user_id, coalesce(u.display_name, u.username) as name
      from v3_conversation_members cm
      join v3_users u on u.user_id = cm.user_id
      where cm.conversation_id = c.conversation_id
        and cm.user_id != $1
        and c.type = 'direct'
      limit 1
    ) peer on true
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
         msg.sender_id,
         case when msg.sender_id = $1 then 'outgoing' else 'incoming' end as direction,
         case when msg.sender_id = $1
              then ${dnParam}
              else coalesce(sender.display_name, sender.username, msg.sender_id::text)
         end as sender_display_name,
         msg.view_once,
         msg.expires_at,
         msg.deleted_at,
         msg.edited_at,
         msg.forwarded_from_id,
         msg.silent,
         msg.burn_seconds,
         r.view_once_opened_at,
         case
           when msg.deleted_at is not null then ''
           when msg.view_once and msg.sender_id = $1 then ''
           when msg.view_once and msg.sender_id != $1 and r.view_once_opened_at is not null then ''
           else msg.body
         end as text,
         p.question as poll_question,
         p.options as poll_options,
         (select option_index from v3_poll_votes where message_id = msg.message_id and user_id = $1 limit 1) as poll_my_vote,
         (select json_object_agg(option_index::text, cnt) from (select option_index, count(*) as cnt from v3_poll_votes where message_id = msg.message_id group by option_index) t) as poll_votes,
         msg.created_at as sent_at,
         case
           when msg.sender_id = $1 then
             case
               when peer_agg.peer_count = 0 then 'sent'
               when peer_agg.read_count >= peer_agg.peer_count then 'read'
               when peer_agg.delivered_count >= peer_agg.peer_count then 'delivered'
               else 'sent'
             end
           when r.read_at is not null then 'read'
           when r.delivered_at is not null then 'delivered'
           else 'sent'
         end as status
       from v3_messages msg
       join v3_message_receipts r on r.message_id = msg.message_id and r.user_id = $1 and r.cleared_at is null
       left join v3_users sender on sender.user_id = msg.sender_id
       left join v3_polls p on p.message_id = msg.message_id
       left join lateral (
         select
           count(*) filter (where peer.user_id != msg.sender_id) as peer_count,
           count(*) filter (where peer.user_id != msg.sender_id and peer.read_at is not null and not peer.read_hidden) as read_count,
           count(*) filter (where peer.user_id != msg.sender_id and peer.delivered_at is not null) as delivered_count
         from v3_message_receipts peer
         where peer.message_id = msg.message_id
       ) peer_agg on true
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
    senderId: row.sender_id != null ? Number(row.sender_id) : null,
    senderDisplayName: row.sender_display_name,
    text: row.text,
    sentAt: row.sent_at?.toISOString?.() || row.sent_at,
    status: row.status,
    viewOnce: Boolean(row.view_once),
    viewOnceOpened: Boolean(row.view_once_opened_at),
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at || null,
    deleted: Boolean(row.deleted_at),
    edited: Boolean(row.edited_at),
    editedAt: row.edited_at?.toISOString?.() || row.edited_at || null,
    forwarded: Boolean(row.forwarded_from_id),
    silent: Boolean(row.silent),
    burnSeconds: row.burn_seconds != null ? Number(row.burn_seconds) : null,
    poll: row.poll_question ? {
      question: row.poll_question,
      options: Array.isArray(row.poll_options) ? row.poll_options : JSON.parse(row.poll_options || '[]'),
      votes: row.poll_votes || {},
      myVote: row.poll_my_vote != null ? Number(row.poll_my_vote) : null
    } : undefined
  }));

  return {
    items,
    nextCursor: hasMore && items.length > 0 ? items[0].messageId : null,
    hasMore
  };
}

async function appendOutgoingMessage(user, chatId, text, messageId = null, { viewOnce = false, expiresAt = null, silent = false, burnSeconds = null } = {}) {
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
    senderId: Number(user.userId),
    senderDisplayName: user.displayName,
    text: viewOnce ? '' : text,
    sentAt,
    status: 'sent',
    viewOnce: Boolean(viewOnce),
    viewOnceOpened: false,
    expiresAt: expiresAt || null,
    silent: Boolean(silent),
    burnSeconds: burnSeconds || null
  };

  const membersResult = await db.query(
    'select user_id from v3_conversation_members where conversation_id = $1',
    [chatId]
  );
  const memberIds = membersResult.rows.map((row) => Number(row.user_id));

  // Extract file_id from media messages for indexed auth lookups
  const mediaMatch = /^__(IMG|VID|AUD|DOC)__:([^:]+)/.exec(text);
  const mediaFileId = mediaMatch ? mediaMatch[2] : null;

  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into v3_messages (message_id, conversation_id, sender_id, body, view_once, expires_at, created_at, silent, burn_seconds)
       values ($1, $2, $3, $4, $5, $6::timestamptz, $7::timestamptz, $8, $9)`,
      [resolvedMessageId, chatId, user.userId, text, Boolean(viewOnce), expiresAt, sentAt, Boolean(silent), burnSeconds || null]
    );

    if (mediaFileId) {
      await client.query(
        `insert into v3_message_media (file_id, message_id, conversation_id, uploaded_by)
         values ($1, $2, $3, $4::bigint)
         on conflict (file_id) do nothing`,
        [mediaFileId, resolvedMessageId, chatId, user.userId]
      );
    }

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
          'sent',
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

const { directChatId: directConversationId } = require('../shared/chatIds');

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

// ── Groups ──────────────────────────────────────────────────────────────────
//
// Groups reuse the whole 1:1 machinery (members, messages, N-way receipts, summaries).
// The only group-specific pieces are: creating a conversation with type='group' and many
// members, membership/role management, and the "X added Y / Z left" system messages.

/** A short centered status line in a group ("Asha added Ravi"). Stored as a message so it
 *  lands in everyone's timeline and chat-list preview, keyed off the body marker __SYS__:. */
async function insertSystemMessage(client, chatId, actorId, text, memberIds) {
  const messageId = `m-${crypto.randomUUID()}`;
  const sentAt = new Date().toISOString();
  const body = `__SYS__:${text}`;
  await client.query(
    `insert into v3_messages (message_id, conversation_id, sender_id, body, created_at)
     values ($1, $2, $3, $4, $5::timestamptz)`,
    [messageId, chatId, actorId, body, sentAt]
  );
  for (const memberId of memberIds) {
    // The actor has already "read" their own status line; everyone else gets it delivered.
    const readAt = Number(memberId) === Number(actorId) ? new Date().toISOString() : null;
    await client.query(
      `insert into v3_message_receipts (message_id, user_id, delivered_at, read_at)
       values ($1, $2, now(), $3)
       on conflict (message_id, user_id) do nothing`,
      [messageId, memberId, readAt]
    );
    await client.query(
      `insert into v3_user_chat_summaries (
         user_id, conversation_id, unread_count, last_message_id, last_message_preview,
         last_message_at, last_message_direction, last_message_status, updated_at
       ) values ($1, $2, 0, $3, $4, $5::timestamptz, 'incoming', 'read', now())
       on conflict (user_id, conversation_id) do update
       set last_message_id = excluded.last_message_id,
           last_message_preview = excluded.last_message_preview,
           last_message_at = excluded.last_message_at,
           last_message_direction = excluded.last_message_direction,
           updated_at = now()`,
      [memberId, chatId, messageId, text, sentAt]
    );
  }
  return { messageId, conversationId: chatId, sentAt, body };
}

/** Build the message object the socket layer emits for a system line (same shape as a normal one). */
function systemMessageObject(sys) {
  return {
    messageId: sys.messageId,
    direction: 'incoming',
    senderDisplayName: null,
    text: sys.body, // keeps the __SYS__: marker so the client renders it centered
    sentAt: sys.sentAt,
    status: 'read',
    system: true
  };
}

async function requireAdmin(db, chatId, userId) {
  const res = await db.query(
    `select role from v3_conversation_members where conversation_id = $1 and user_id = $2`,
    [chatId, userId]
  );
  if (res.rowCount === 0) throw Object.assign(new Error('Not a member'), { status: 403 });
  if (res.rows[0].role !== 'admin') throw Object.assign(new Error('Admins only'), { status: 403 });
}

async function createGroupConversation(user, { title, memberIds = [], avatarEmoji = null }) {
  await ensureUser(user);
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw Object.assign(new Error('Group name is required'), { status: 400 });

  // Resolve + validate the other members; always include the creator.
  const unique = [...new Set(memberIds.map(Number).filter((id) => id && id !== Number(user.userId)))];
  const resolved = [];
  for (const id of unique) {
    const u = await identity.getById(id);
    if (u) resolved.push(u);
  }
  if (resolved.length === 0) throw Object.assign(new Error('Add at least one member'), { status: 400 });

  const db = getPool();
  const chatId = `group::${crypto.randomUUID()}`;
  let sys = null;
  let createdMemberIds = [];
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `insert into v3_conversations (conversation_id, type, title, created_by, avatar_emoji)
       values ($1, 'group', $2, $3, $4)`,
      [chatId, cleanTitle, user.userId, avatarEmoji]
    );
    // Creator is the first admin; everyone else joins as a member.
    const allMembers = [{ userId: user.userId, role: 'admin' }, ...resolved.map((u) => ({ userId: u.userId, role: 'member' }))];
    for (const m of allMembers) {
      await client.query(
        `insert into v3_conversation_members (conversation_id, user_id, role, muted)
         values ($1, $2, $3, false)
         on conflict (conversation_id, user_id) do nothing`,
        [chatId, m.userId, m.role]
      );
      await client.query(
        `insert into v3_user_chat_summaries (user_id, conversation_id, unread_count, updated_at)
         values ($1, $2, 0, now())
         on conflict (user_id, conversation_id) do nothing`,
        [m.userId, chatId]
      );
    }
    sys = await insertSystemMessage(client, chatId, user.userId, `${user.displayName} created the group "${cleanTitle}"`, allMembers.map((m) => m.userId));
    createdMemberIds = allMembers.map((m) => m.userId);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }

  return {
    chat: {
      chatId,
      chatType: 'group',
      title: cleanTitle,
      subtitle: `${resolved.length + 1} members`,
      avatarText: avatarEmoji || cleanTitle.slice(0, 1).toUpperCase(),
      unreadCount: 0,
      muted: false,
      lastMessage: null
    },
    memberIds: createdMemberIds,
    system: systemMessageObject(sys)
  };
}

/** Full group detail for the header: title, avatar, every member with role + display name. */
async function getConversationDetail(user, chatId) {
  const db = getPool();
  const conv = await db.query(
    `select c.conversation_id, c.type, c.title, c.avatar_emoji, c.created_by
     from v3_conversations c
     join v3_conversation_members m on m.conversation_id = c.conversation_id and m.user_id = $2
     where c.conversation_id = $1`,
    [chatId, user.userId]
  );
  if (conv.rowCount === 0) throw Object.assign(new Error('Chat not found'), { status: 404 });
  const row = conv.rows[0];
  const members = await db.query(
    `select m.user_id, m.role, coalesce(u.display_name, u.username, m.user_id::text) as display_name, u.username
     from v3_conversation_members m
     left join v3_users u on u.user_id = m.user_id
     where m.conversation_id = $1
     order by (m.role = 'admin') desc, display_name asc`,
    [chatId]
  );
  return {
    chatId: row.conversation_id,
    chatType: row.type,
    title: row.title,
    avatarEmoji: row.avatar_emoji || null,
    createdBy: row.created_by != null ? Number(row.created_by) : null,
    myRole: members.rows.find((m) => Number(m.user_id) === Number(user.userId))?.role || 'member',
    members: members.rows.map((m) => ({
      userId: Number(m.user_id),
      role: m.role,
      displayName: m.display_name,
      username: m.username || null
    }))
  };
}

async function addGroupMembers(user, chatId, memberIds) {
  const db = getPool();
  await requireAdmin(db, chatId, user.userId);
  const existing = new Set((await getConversationMemberUserIds(chatId)).map(Number));
  const toAdd = [];
  for (const id of [...new Set(memberIds.map(Number))]) {
    if (!id || existing.has(id)) continue;
    const u = await identity.getById(id);
    if (u) toAdd.push(u);
  }
  if (toAdd.length === 0) throw Object.assign(new Error('No new members to add'), { status: 400 });

  let sys = null;
  const client = await db.connect();
  try {
    await client.query('begin');
    for (const u of toAdd) {
      await client.query(
        `insert into v3_conversation_members (conversation_id, user_id, role, muted)
         values ($1, $2, 'member', false) on conflict (conversation_id, user_id) do nothing`,
        [chatId, u.userId]
      );
      await client.query(
        `insert into v3_user_chat_summaries (user_id, conversation_id, unread_count, updated_at)
         values ($1, $2, 0, now()) on conflict (user_id, conversation_id) do nothing`,
        [u.userId, chatId]
      );
    }
    const allMembers = await client.query('select user_id from v3_conversation_members where conversation_id = $1', [chatId]);
    const names = toAdd.map((u) => u.displayName).join(', ');
    sys = await insertSystemMessage(client, chatId, user.userId, `${user.displayName} added ${names}`, allMembers.rows.map((r) => Number(r.user_id)));
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return { added: toAdd.map((u) => Number(u.userId)), memberIds: await getConversationMemberUserIds(chatId), system: systemMessageObject(sys) };
}

async function removeGroupMember(user, chatId, targetUserId) {
  const db = getPool();
  await requireAdmin(db, chatId, user.userId);
  const target = Number(targetUserId);
  if (target === Number(user.userId)) throw Object.assign(new Error('Use leave to remove yourself'), { status: 400 });
  const targetUser = await identity.getById(target);
  const beforeMembers = await getConversationMemberUserIds(chatId);
  if (!beforeMembers.map(Number).includes(target)) throw Object.assign(new Error('Not a member'), { status: 404 });

  let sys = null;
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query('delete from v3_conversation_members where conversation_id = $1 and user_id = $2', [chatId, target]);
    await client.query('delete from v3_user_chat_summaries where conversation_id = $1 and user_id = $2', [chatId, target]);
    const allMembers = await client.query('select user_id from v3_conversation_members where conversation_id = $1', [chatId]);
    sys = await insertSystemMessage(client, chatId, user.userId, `${user.displayName} removed ${targetUser?.displayName || 'a member'}`, allMembers.rows.map((r) => Number(r.user_id)));
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return { removed: target, memberIds: await getConversationMemberUserIds(chatId), system: systemMessageObject(sys) };
}

async function leaveGroup(user, chatId) {
  const db = getPool();
  const memberIds = (await getConversationMemberUserIds(chatId)).map(Number);
  if (!memberIds.includes(Number(user.userId))) throw Object.assign(new Error('Not a member'), { status: 404 });

  let sys = null;
  let remainingIds = [];
  const client = await db.connect();
  try {
    await client.query('begin');
    // If the last admin leaves, promote the oldest remaining member so the group isn't left headless.
    const roles = await client.query(
      `select user_id, role from v3_conversation_members where conversation_id = $1`, [chatId]
    );
    const remaining = roles.rows.filter((r) => Number(r.user_id) !== Number(user.userId));
    const leaverIsAdmin = roles.rows.find((r) => Number(r.user_id) === Number(user.userId))?.role === 'admin';
    const anotherAdmin = remaining.some((r) => r.role === 'admin');
    if (leaverIsAdmin && !anotherAdmin && remaining.length > 0) {
      await client.query(
        `update v3_conversation_members set role = 'admin'
         where conversation_id = $1 and user_id = (
           select user_id from v3_conversation_members where conversation_id = $1 and user_id <> $2
           order by joined_at asc limit 1)`,
        [chatId, user.userId]
      );
    }
    await client.query('delete from v3_conversation_members where conversation_id = $1 and user_id = $2', [chatId, user.userId]);
    await client.query('delete from v3_user_chat_summaries where conversation_id = $1 and user_id = $2', [chatId, user.userId]);
    remainingIds = remaining.map((r) => Number(r.user_id));
    if (remaining.length > 0) {
      sys = await insertSystemMessage(client, chatId, user.userId, `${user.displayName} left`, remainingIds);
    }
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return { left: Number(user.userId), memberIds: remainingIds, system: sys ? systemMessageObject(sys) : null };
}

async function renameGroup(user, chatId, title) {
  const db = getPool();
  await requireAdmin(db, chatId, user.userId);
  const cleanTitle = String(title || '').trim();
  if (!cleanTitle) throw Object.assign(new Error('Group name is required'), { status: 400 });
  let sys = null;
  let memberIds = [];
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(`update v3_conversations set title = $2 where conversation_id = $1`, [chatId, cleanTitle]);
    const allMembers = await client.query('select user_id from v3_conversation_members where conversation_id = $1', [chatId]);
    memberIds = allMembers.rows.map((r) => Number(r.user_id));
    sys = await insertSystemMessage(client, chatId, user.userId, `${user.displayName} changed the group name to "${cleanTitle}"`, memberIds);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return { chatId, title: cleanTitle, memberIds, system: systemMessageObject(sys) };
}

async function setMemberRole(user, chatId, targetUserId, role) {
  const db = getPool();
  await requireAdmin(db, chatId, user.userId);
  const newRole = role === 'admin' ? 'admin' : 'member';
  const target = Number(targetUserId);
  const targetUser = await identity.getById(target);
  let sys = null;
  let memberIds = [];
  const client = await db.connect();
  try {
    await client.query('begin');
    const res = await client.query(
      `update v3_conversation_members set role = $3 where conversation_id = $1 and user_id = $2 returning user_id`,
      [chatId, target, newRole]
    );
    if (res.rowCount === 0) { await client.query('rollback'); throw Object.assign(new Error('Not a member'), { status: 404 }); }
    const allMembers = await client.query('select user_id from v3_conversation_members where conversation_id = $1', [chatId]);
    memberIds = allMembers.rows.map((r) => Number(r.user_id));
    const verb = newRole === 'admin' ? 'is now an admin' : 'is no longer an admin';
    sys = await insertSystemMessage(client, chatId, user.userId, `${targetUser?.displayName || 'A member'} ${verb}`, memberIds);
    await client.query('commit');
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
  return { userId: target, role: newRole, memberIds, system: systemMessageObject(sys) };
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

async function markRead(user, chatId, messageId, { hidden = false } = {}) {
  await ensureSeededForUser(user);
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('begin');
    const updated = await client.query(
      `update v3_message_receipts r
       set read_hidden = case when r.read_at is null then $4 else r.read_hidden end,
           read_at = coalesce(read_at, now()),
           delivered_at = coalesce(delivered_at, now())
       from v3_messages msg
       where r.message_id = msg.message_id
         and r.user_id = $1
         and msg.conversation_id = $2
         and r.message_id = $3
         and msg.sender_id != $1
       returning r.message_id, msg.sender_id`,
      [user.userId, chatId, messageId, Boolean(hidden)]
    );
    if (updated.rowCount === 0) {
      await client.query('rollback');
      return null;
    }

    const unread = await client.query(
      `select count(*)::int as count
       from v3_message_receipts r
       join v3_messages msg on msg.message_id = r.message_id
       where r.user_id = $1 and msg.conversation_id = $2 and r.read_at is null and r.cleared_at is null and msg.sender_id != $1`,
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
    if (!hidden) {
      await client.query(
        `update v3_user_chat_summaries
         set last_message_status = 'read', updated_at = now()
         where user_id = $1 and conversation_id = $2 and last_message_id = $3`,
        [senderUserId, chatId, messageId]
      );
    }
    await client.query('commit');
    return { messageId, status: 'read', unreadCount, senderUserId };
  } catch (error) {
    await client.query('rollback');
    throw error;
  } finally {
    client.release();
  }
}

async function markChatRead(user, chatId, { hidden = false } = {}) {
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
           read_hidden = $3,
           delivered_at = coalesce(delivered_at, now())
       from v3_messages msg
       where r.message_id = msg.message_id
         and r.user_id = $1
         and msg.conversation_id = $2
         and msg.sender_id != $1
         and r.read_at is null
       returning r.message_id, msg.sender_id`,
      [user.userId, chatId, Boolean(hidden)]
    );

    // Clear reader's unread count
    await client.query(
      `update v3_user_chat_summaries
       set unread_count = 0, updated_at = now()
       where user_id = $1 and conversation_id = $2`,
      [user.userId, chatId]
    );

    // Update each sender's summary to 'read' so offline senders see correct tick on next load
    if (updated.rows.length > 0 && !hidden) {
      const senderIds = [...new Set(updated.rows.map(r => Number(r.sender_id)))];
      const messageIds = updated.rows.map(r => r.message_id);
      await client.query(
        `update v3_user_chat_summaries
         set last_message_status = 'read', updated_at = now()
         where conversation_id = $1
           and user_id = any($2)
           and last_message_id = any($3)
           and last_message_status in ('sent', 'delivered')`,
        [chatId, senderIds, messageIds]
      );
    }

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
       ) order by m.user_id) as participants,
       (select msg.body from v3_messages msg where msg.conversation_id = c.conversation_id order by msg.created_at desc limit 1) as last_body,
       (select msg.created_at from v3_messages msg where msg.conversation_id = c.conversation_id order by msg.created_at desc limit 1) as last_sent_at
     from v3_conversations c
     join v3_conversation_members m on m.conversation_id = c.conversation_id
     left join v3_users u on u.user_id = m.user_id
     group by c.conversation_id, c.type, c.title
     order by last_sent_at desc nulls last`
  );
  return result.rows.map((row) => ({
    chatId: row.conversation_id,
    chatType: row.type,
    title: row.title,
    participants: (row.participants || []).map((p) => ({
      userId: Number(p.userId),
      username: p.username,
      displayName: p.displayName
    })),
    lastMessage: row.last_body ? { text: row.last_body } : null,
    lastSentAt: row.last_sent_at?.toISOString?.() || null
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
         msg.deleted_at,
         msg.view_once,
         msg.expires_at,
         msg.edited_at,
         msg.silent,
         msg.burn_seconds,
         p.question as poll_question,
         p.options as poll_options,
         (select json_object_agg(t.option_index::text, t.cnt)
            from (select option_index, count(*) as cnt from v3_poll_votes
                  where message_id = msg.message_id group by option_index) t) as poll_votes,
         msg.created_at as sent_at
       from v3_messages msg
       left join v3_users u on u.user_id = msg.sender_id
       left join v3_polls p on p.message_id = msg.message_id
       where msg.conversation_id = $1 ${cursorClause}
       order by msg.created_at desc, msg.message_id desc
       limit $2
     ) recent
     order by sent_at asc, message_id asc`,
    params
  );

  const rows = result.rows;
  const hasMore = rows.length > safeLimit;
  // Rows are oldest-first here, so the extra probe row is the first one, not the last
  const visibleRows = hasMore ? rows.slice(1) : rows;
  const items = visibleRows.map((row) => ({
    messageId: row.message_id,
    senderId: Number(row.sender_id),
    senderDisplayName: row.sender_display_name,
    direction: 'incoming',
    text: row.text,
    sentAt: row.sent_at?.toISOString?.() || row.sent_at,
    status: 'sent',
    deletedAt: row.deleted_at?.toISOString?.() || row.deleted_at || null,
    viewOnce: Boolean(row.view_once),
    expiresAt: row.expires_at?.toISOString?.() || row.expires_at || null,
    edited: Boolean(row.edited_at),
    silent: Boolean(row.silent),
    burnSeconds: row.burn_seconds != null ? Number(row.burn_seconds) : null,
    poll: row.poll_question ? {
      question: row.poll_question,
      options: Array.isArray(row.poll_options) ? row.poll_options : JSON.parse(row.poll_options || '[]'),
      votes: row.poll_votes || {},
      myVote: null
    } : undefined
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

async function ensureClearedColumn() {
  if (!env.DATABASE_URL) return;
  await getPool().query('alter table v3_message_receipts add column if not exists cleared_at timestamptz');
}

// Clearing / deleting a chat only hides the caller's copy (their receipts).
// Messages stay for other members and for admin monitoring.
async function hideChatForUser(user, chatId, { removeFromList }) {
  const db = getPool();
  const access = await db.query(
    'select 1 from v3_conversation_members where conversation_id = $1 and user_id = $2 limit 1',
    [chatId, user.userId]
  );
  if (access.rowCount === 0) {
    throw Object.assign(new Error('Access denied'), { status: 403 });
  }
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      `update v3_message_receipts set cleared_at = now()
       where user_id = $2 and cleared_at is null
         and message_id in (select message_id from v3_messages where conversation_id = $1)`,
      [chatId, user.userId]
    );
    if (removeFromList) {
      await client.query(
        'delete from v3_user_chat_summaries where conversation_id = $1 and user_id = $2',
        [chatId, user.userId]
      );
    } else {
      await client.query(
        `update v3_user_chat_summaries
         set last_message_preview = null, unread_count = 0, updated_at = now()
         where conversation_id = $1 and user_id = $2`,
        [chatId, user.userId]
      );
    }
    await client.query('commit');
  } catch (err) {
    await client.query('rollback');
    throw err;
  } finally {
    client.release();
  }
}

async function deleteConversation(user, chatId) {
  return hideChatForUser(user, chatId, { removeFromList: true });
}

async function clearChatMessages(user, chatId) {
  return hideChatForUser(user, chatId, { removeFromList: false });
}

/** A deleted or expired message must not live on as a chat-list preview. */
async function scrubPreview(messageId, label) {
  await getPool().query(
    `update v3_user_chat_summaries set last_message_preview = $2, updated_at = now() where last_message_id = $1`,
    [messageId, label]
  );
}

async function deleteMessage(user, messageId) {
  const db = getPool();
  // Admins can delete any message; regular users can only delete their own
  const whereClause = user.isAdmin
    ? 'message_id = $1'
    : 'message_id = $1 and sender_id = $2';
  const params = user.isAdmin ? [messageId] : [messageId, user.userId];
  const result = await db.query(
    `update v3_messages set deleted_at = now() where ${whereClause} and deleted_at is null returning message_id, conversation_id`,
    params
  );
  if (result.rowCount === 0) {
    throw Object.assign(new Error('Message not found or permission denied'), { status: 404 });
  }
  const { conversation_id: conversationId } = result.rows[0];
  await scrubPreview(messageId, '🚫 This message was deleted');
  const memberResult = await db.query(
    'select user_id from v3_conversation_members where conversation_id = $1',
    [conversationId]
  );
  return {
    messageId,
    conversationId,
    memberIds: memberResult.rows.map((r) => Number(r.user_id))
  };
}

async function broadcastSystemUpdate(adminUserId) {
  const db = getPool();
  const convResult = await db.query(
    `select cm.conversation_id, array_agg(cm.user_id::bigint) as member_ids
     from v3_conversation_members cm
     group by cm.conversation_id`
  );

  const now = new Date().toISOString();
  const results = [];

  for (const row of convResult.rows) {
    const messageId = `m-${crypto.randomUUID()}`;
    const conversationId = row.conversation_id;
    const memberIds = row.member_ids.map(Number);

    await db.query(
      `insert into v3_messages (message_id, conversation_id, sender_id, body, created_at)
       values ($1, $2, $3, $4, $5::timestamptz)`,
      [messageId, conversationId, adminUserId, '__SYS_UPDATE__', now]
    );

    for (const memberId of memberIds) {
      await db.query(
        `insert into v3_message_receipts (message_id, user_id, delivered_at)
         values ($1, $2, now())
         on conflict (message_id, user_id) do nothing`,
        [messageId, memberId]
      );
      await db.query(
        `insert into v3_user_chat_summaries
           (user_id, conversation_id, unread_count, last_message_id, last_message_preview,
            last_message_at, last_message_direction, last_message_status, updated_at)
         values ($1, $2, 1, $3, $4, $5::timestamptz, 'incoming', 'sent', $5::timestamptz)
         on conflict (user_id, conversation_id) do update set
           last_message_id = excluded.last_message_id,
           last_message_preview = excluded.last_message_preview,
           last_message_at = excluded.last_message_at,
           last_message_direction = excluded.last_message_direction,
           last_message_status = excluded.last_message_status,
           updated_at = excluded.updated_at`,
        [memberId, conversationId, messageId, '🔄 App update available', now]
      );
    }

    results.push({ conversationId, messageId, memberIds });
  }

  return results;
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
  createGroupConversation,
  getConversationDetail,
  addGroupMembers,
  removeGroupMember,
  leaveGroup,
  renameGroup,
  setMemberRole,
  listAllChats,
  adminListMessagesForChat,
  clearChatMessages,
  deleteMessage,
  deleteConversation,
  ensureClearedColumn,
  scrubPreview,
  broadcastSystemUpdate
};
