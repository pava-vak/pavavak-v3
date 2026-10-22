const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { getPool } = require('../../db/pool');
const { env } = require('../../config/env');

// Burn-after-reading choices, in seconds, counted from the moment the recipient reads the message
const BURN_SECONDS = { off: null, '10s': 10, '1m': 60, '5m': 300, '1h': 3600 };

// Ghost mode is read on every presence/typing event, so it is cached per user
const ghostCache = new Map();

async function ensureColumns() {
  if (!env.DATABASE_URL) return;
  const db = getPool();
  await db.query('alter table v3_users add column if not exists ghost_mode boolean not null default false');
  await db.query('alter table v3_messages add column if not exists silent boolean not null default false');
  await db.query('alter table v3_messages add column if not exists burn_seconds integer');
  // A read made in ghost mode is recorded for the reader (unread counts) but never shown to the sender
  await db.query('alter table v3_message_receipts add column if not exists read_hidden boolean not null default false');
  // Hidden chats, per member: synced between the person's devices and never pushed
  await db.query('alter table v3_conversation_members add column if not exists hidden boolean not null default false');
  // Previews of messages deleted or expired before previews were scrubbed on delete
  await db.query(
    `update v3_user_chat_summaries s
     set last_message_preview = '🚫 This message was deleted'
     from v3_messages m
     where m.message_id = s.last_message_id and m.deleted_at is not null
       and s.last_message_preview is distinct from '🚫 This message was deleted'
       and s.last_message_preview is distinct from '⏱ Message disappeared'`
  );
}

async function isGhost(userId) {
  const key = Number(userId);
  if (ghostCache.has(key)) return ghostCache.get(key);
  let ghost = false;
  try {
    const { rows } = await getPool().query('select ghost_mode from v3_users where user_id = $1', [key]);
    ghost = Boolean(rows[0]?.ghost_mode);
  } catch { /* column missing or DB down: treat as visible */ }
  ghostCache.set(key, ghost);
  return ghost;
}

/** Synchronous read for hot paths; callers warm the cache with isGhost() first. */
function isGhostCached(userId) {
  return ghostCache.get(Number(userId)) === true;
}

async function setGhost(userId, on) {
  await getPool().query('update v3_users set ghost_mode = $2 where user_id = $1', [Number(userId), Boolean(on)]);
  ghostCache.set(Number(userId), Boolean(on));
}

/**
 * Starts the burn timer on messages the reader just read. Returns the new expiry per message so
 * both members can count down; the auto-delete job removes them when the time is up.
 */
async function startBurnTimers(readerId, messageIds) {
  if (!messageIds?.length) return [];
  const { rows } = await getPool().query(
    `update v3_messages
     set expires_at = now() + make_interval(secs => burn_seconds)
     where message_id = any($1)
       and burn_seconds is not null
       and sender_id != $2
       and expires_at is null
       and deleted_at is null
     returning message_id, conversation_id, expires_at`,
    [messageIds, Number(readerId)]
  );
  return rows.map((r) => ({
    chatId: r.conversation_id,
    messageId: r.message_id,
    expiresAt: r.expires_at?.toISOString?.() || r.expires_at
  }));
}

function registerPrivacyRoutes(app) {
  app.get('/api/v3/me/privacy', { preHandler: requireAuth }, async (request) => ({
    success: true,
    ghostMode: await isGhost(request.auth.userId)
  }));

  app.get('/api/v3/me/hidden-chats', { preHandler: requireAuth }, async (request, reply) => {
    try {
      const { rows } = await getPool().query(
        'select conversation_id from v3_conversation_members where user_id = $1 and hidden',
        [request.auth.userId]
      );
      return { success: true, chatIds: rows.map((r) => r.conversation_id) };
    } catch (err) {
      request.log.error({ err }, 'Failed to list hidden chats');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  app.put('/api/v3/chats/:chatId/hidden', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ hidden: z.boolean() }).safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ success: false, error: 'Invalid request body' });
    try {
      // Only your own membership row: hiding never affects the other person
      const { rowCount } = await getPool().query(
        'update v3_conversation_members set hidden = $3 where conversation_id = $1 and user_id = $2',
        [request.params.chatId, request.auth.userId, parsed.data.hidden]
      );
      if (rowCount === 0) return reply.status(404).send({ success: false, error: 'Chat not found' });
      return { success: true, hidden: parsed.data.hidden };
    } catch (err) {
      request.log.error({ err }, 'Failed to update hidden chat');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  app.put('/api/v3/me/privacy', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = z.object({ ghostMode: z.boolean() }).safeParse(request.body || {});
    if (!parsed.success) return reply.status(400).send({ success: false, error: 'Invalid request body' });
    try {
      const was = await isGhost(request.auth.userId);
      await setGhost(request.auth.userId, parsed.data.ghostMode);
      if (was !== parsed.data.ghostMode) announcePresence(request.auth, !parsed.data.ghostMode);
      return { success: true, ghostMode: parsed.data.ghostMode };
    } catch (err) {
      request.log.error({ err }, 'Failed to update privacy settings');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
}

/** Turning ghost mode on looks like going offline to everyone; turning it off looks like coming online. */
function announcePresence(user, online) {
  const realtime = require('../../realtime/eventEmitter');
  const { isUserOnline } = require('../../realtime/connectionRegistry');
  const chatAdapter = require('../../db/chatAdapter');
  chatAdapter.listChatIdsForUser(user).then((chatIds) => {
    for (const chatId of chatIds) {
      if (online && isUserOnline(user.userId)) {
        realtime.emitToChat(chatId, 'presence:online', { chatId, userId: user.userId, displayName: user.displayName, lastSeenAt: new Date().toISOString() });
      } else if (!online) {
        realtime.emitToChat(chatId, 'presence:offline', { chatId, userId: user.userId, lastSeenAt: null });
      }
    }
  }).catch(() => {});
}

module.exports = { BURN_SECONDS, ensureColumns, isGhost, isGhostCached, setGhost, startBurnTimers, registerPrivacyRoutes };
