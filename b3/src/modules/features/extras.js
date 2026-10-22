// Block, delete-for-me, edit history, self-notes and send-when-online.
const { z } = require('zod');
const { randomUUID } = require('crypto');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { getPool } = require('../../db/pool');
const { env } = require('../../config/env');
const realtime = require('../../realtime/eventEmitter');

async function ensureTables() {
  if (!env.DATABASE_URL) return;
  const db = getPool();
  await db.query(`create table if not exists v3_blocks (
    blocker_id bigint not null,
    blocked_id bigint not null,
    created_at timestamptz not null default now(),
    primary key (blocker_id, blocked_id)
  )`);
  await db.query(`create table if not exists v3_message_edits (
    id bigserial primary key,
    message_id text not null,
    old_body text not null,
    edited_at timestamptz not null default now()
  )`);
  await db.query('create index if not exists v3_message_edits_msg_idx on v3_message_edits(message_id)');
  await db.query(`create table if not exists v3_online_queue (
    id bigserial primary key,
    conversation_id text not null,
    sender_id bigint not null,
    recipient_id bigint not null,
    body text not null,
    created_at timestamptz not null default now()
  )`);
  await db.query('create index if not exists v3_online_queue_recipient_idx on v3_online_queue(recipient_id)');
}

// ── Blocking ──────────────────────────────────────────────────────────────

/** True if sender is blocked by, or has blocked, any other member of the chat. */
async function isBlockedInChat(db, senderId, chatId) {
  if (!env.DATABASE_URL) return false;
  try {
  const { rows } = await db.query(
    `select 1 from v3_conversation_members m
     join v3_blocks b on (b.blocker_id = m.user_id and b.blocked_id = $1)
                      or (b.blocker_id = $1 and b.blocked_id = m.user_id)
     where m.conversation_id = $2 and m.user_id <> $1
     limit 1`,
    [Number(senderId), chatId]
  );
  return rows.length > 0;
  } catch { return false; }
}

async function isBlockedBetween(db, a, b) {
  if (!env.DATABASE_URL) return false;
  try {
  const { rows } = await db.query(
    `select 1 from v3_blocks where (blocker_id=$1 and blocked_id=$2) or (blocker_id=$2 and blocked_id=$1) limit 1`,
    [Number(a), Number(b)]
  );
  return rows.length > 0;
  } catch { return false; }
}

// ── Send-when-online ──────────────────────────────────────────────────────

/** Sends one message immediately (used when the recipient comes online). Mirrors the scheduled-message insert. */
async function insertMessageNow(db, conversationId, senderId, body) {
  const messageId = `m-${randomUUID()}`;
  const sentAt = new Date().toISOString();
  const client = await db.connect();
  try {
    await client.query('begin');
    await client.query(
      'insert into v3_messages(message_id, conversation_id, sender_id, body, created_at) values($1,$2,$3,$4,now())',
      [messageId, conversationId, senderId, body]
    );
    const mediaMatch = /^__(IMG|VID|AUD|DOC)__:([^:]+)/.exec(body);
    if (mediaMatch) {
      await client.query(
        `insert into v3_message_media (file_id, message_id, conversation_id, uploaded_by)
         values ($1,$2,$3,$4) on conflict (file_id) do nothing`,
        [mediaMatch[2], messageId, conversationId, Number(senderId)]
      );
    }
    const { rows: memberRows } = await client.query('select user_id from v3_conversation_members where conversation_id=$1', [conversationId]);
    const memberIds = memberRows.map((r) => Number(r.user_id));
    for (const memberId of memberIds) {
      const isSender = memberId === Number(senderId);
      await client.query('insert into v3_message_receipts(message_id, user_id) values($1,$2) on conflict do nothing', [messageId, memberId]);
      await client.query(
        `insert into v3_user_chat_summaries(user_id, conversation_id, unread_count, last_message_id,
           last_message_preview, last_message_at, last_message_direction, last_message_status, updated_at)
         values($1,$2,$3,$4,$5,$6::timestamptz,$7,'sent',now())
         on conflict(user_id, conversation_id) do update
         set unread_count = case when $8 then 0 else v3_user_chat_summaries.unread_count + 1 end,
             last_message_id = excluded.last_message_id, last_message_preview = excluded.last_message_preview,
             last_message_at = excluded.last_message_at, last_message_direction = excluded.last_message_direction,
             last_message_status = excluded.last_message_status, updated_at = now()`,
        [memberId, conversationId, isSender ? 0 : 1, messageId, body, sentAt, isSender ? 'outgoing' : 'incoming', isSender]
      );
    }
    await client.query('commit');
    const sender = memberRows.length ? { userId: Number(senderId) } : { userId: Number(senderId) };
    const message = { messageId, chatId: conversationId, text: body, direction: 'outgoing', sentAt, status: 'sent' };
    realtime.emitMessageNewToMembers(sender, conversationId, message, memberIds);
    for (const memberId of memberIds) realtime.emitChatUpdated(memberId, { chatId: conversationId, reload: true });
  } catch (err) {
    await client.query('rollback').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/** Flushes everything queued for [userId] (they just came online). Never throws. */
async function flushOnlineQueueFor(userId) {
  if (!env.DATABASE_URL) return;
  const db = getPool();
  try {
    const { rows } = await db.query(
      'select id, conversation_id, sender_id, body from v3_online_queue where recipient_id=$1 order by created_at asc limit 100',
      [Number(userId)]
    );
    for (const row of rows) {
      // Skip if the sender has since been blocked
      if (await isBlockedBetween(db, row.sender_id, userId)) { await db.query('delete from v3_online_queue where id=$1', [row.id]); continue; }
      await insertMessageNow(db, row.conversation_id, row.sender_id, row.body);
      await db.query('delete from v3_online_queue where id=$1', [row.id]);
    }
  } catch (err) {
    console.error('[online-queue] flush failed:', err.message);
  }
}

// ── Routes ────────────────────────────────────────────────────────────────

function registerExtrasRoutes(app) {
  app.get('/api/v3/blocks', { preHandler: requireAuth }, async (request) => {
    const { rows } = await getPool().query('select blocked_id from v3_blocks where blocker_id=$1', [request.auth.userId]);
    return { success: true, blocked: rows.map((r) => String(r.blocked_id)) };
  });

  app.put('/api/v3/users/:userId/block', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ blocked: z.boolean() }).safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ success: false, error: 'Invalid request body' });
    const target = Number(request.params.userId);
    if (!Number.isInteger(target) || target === request.auth.userId)
      return reply.status(400).send({ success: false, error: 'Invalid user' });
    const db = getPool();
    if (parsed.data.blocked) {
      await db.query('insert into v3_blocks(blocker_id, blocked_id) values($1,$2) on conflict do nothing', [request.auth.userId, target]);
    } else {
      await db.query('delete from v3_blocks where blocker_id=$1 and blocked_id=$2', [request.auth.userId, target]);
    }
    return { success: true, blocked: parsed.data.blocked };
  });

  // Delete a single message just for me (hide my receipt; others keep it, admin still sees it)
  app.delete('/api/v3/messages/:messageId/for-me', { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const { rowCount } = await getPool().query(
      'update v3_message_receipts set cleared_at = now() where message_id=$1 and user_id=$2 and cleared_at is null',
      [request.params.messageId, request.auth.userId]
    );
    if (rowCount === 0) return reply.status(404).send({ success: false, error: 'Message not found' });
    return { success: true };
  });

  // Previous versions of an edited message (members of the chat only)
  app.get('/api/v3/messages/:messageId/history', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    const { rows: access } = await db.query(
      `select 1 from v3_messages m join v3_conversation_members cm on cm.conversation_id = m.conversation_id
       where m.message_id=$1 and (cm.user_id=$2 or $3) limit 1`,
      [request.params.messageId, request.auth.userId, request.auth.isAdmin === true]
    );
    if (!access.length) return reply.status(404).send({ success: false, error: 'Message not found' });
    const { rows } = await db.query(
      'select old_body, edited_at from v3_message_edits where message_id=$1 order by edited_at asc',
      [request.params.messageId]
    );
    return { success: true, edits: rows.map((r) => ({ text: r.old_body, editedAt: r.edited_at?.toISOString?.() || r.edited_at })) };
  });

  // Notes to self: a private one-member conversation
  app.post('/api/v3/chats/self', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    const chatId = `self::${request.auth.userId}`;
    try {
      await db.query(`insert into v3_conversations(conversation_id, type, title) values($1,'self',$2) on conflict (conversation_id) do nothing`, [chatId, 'Notes to self']);
      await db.query(`insert into v3_conversation_members(conversation_id, user_id, muted) values($1,$2,false) on conflict do nothing`, [chatId, request.auth.userId]);
      await db.query(`insert into v3_user_chat_summaries(user_id, conversation_id, unread_count, updated_at) values($1,$2,0,now()) on conflict do nothing`, [request.auth.userId, chatId]);
      return { success: true, chat: { chatId, chatType: 'self', title: 'Notes to self', subtitle: 'Only you', avatarText: '🗒', unreadCount: 0, muted: false, lastMessage: null } };
    } catch (err) {
      request.log.error({ err }, 'Failed to create self chat');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  app.post('/api/v3/chats/:chatId/send-when-online', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const parsed = z.object({ text: z.string().trim().min(1).max(4000) }).safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ success: false, error: 'Invalid request body' });
    const db = getPool();
    const { rows: members } = await db.query('select user_id from v3_conversation_members where conversation_id=$1', [request.params.chatId]);
    if (!members.some((m) => Number(m.user_id) === request.auth.userId)) return reply.status(404).send({ success: false, error: 'Chat not found' });
    const recipient = members.map((m) => Number(m.user_id)).find((id) => id !== request.auth.userId);
    if (!recipient) return reply.status(400).send({ success: false, error: 'No recipient in this chat' });
    if (await isBlockedBetween(db, request.auth.userId, recipient)) return reply.status(403).send({ success: false, error: 'You can\'t message this contact' });
    const { rows } = await db.query(
      'insert into v3_online_queue(conversation_id, sender_id, recipient_id, body) values($1,$2,$3,$4) returning id',
      [request.params.chatId, request.auth.userId, recipient, parsed.data.text]
    );
    // If they are already online, send right away
    const { isUserOnline } = require('../../realtime/connectionRegistry');
    if (isUserOnline(recipient)) flushOnlineQueueFor(recipient).catch(() => {});
    return { success: true, id: String(rows[0].id) };
  });

  app.get('/api/v3/online-queue', { preHandler: requireAuth }, async (request) => {
    const { rows } = await getPool().query(
      `select q.id, q.conversation_id, q.body, q.created_at, c.title
       from v3_online_queue q left join v3_conversations c on c.conversation_id = q.conversation_id
       where q.sender_id=$1 order by q.created_at asc`,
      [request.auth.userId]
    );
    return { success: true, items: rows.map((r) => ({ id: String(r.id), chatId: r.conversation_id, text: r.body, chatTitle: r.title, createdAt: r.created_at?.toISOString?.() || r.created_at })) };
  });

  app.delete('/api/v3/online-queue/:id', { preHandler: requireAuth }, async (request) => {
    await getPool().query('delete from v3_online_queue where id=$1 and sender_id=$2', [Number(request.params.id), request.auth.userId]);
    return { success: true };
  });
}

module.exports = { ensureTables, registerExtrasRoutes, isBlockedInChat, isBlockedBetween, flushOnlineQueueFor };
