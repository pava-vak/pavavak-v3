const { z } = require('zod');
const { requireAuth } = require('../../shared/security/auth.preHandler');
const { getPool } = require('../../db/pool');
const { env } = require('../../config/env');

// Burn-after-reading choices, in seconds, counted from the moment the recipient reads the message
const BURN_SECONDS = { off: null, '10s': 10, '1m': 60, '5m': 300, '1h': 3600 };

// Presence prefs are read on every presence/typing event, so they are cached per user.
// Entry shape: { ghost: boolean, lastSeen: 'everyone'|'nobody', online: 'everyone'|'match' }
const prefsCache = new Map();

const LAST_SEEN_CHOICES = new Set(['everyone', 'nobody']);
const ONLINE_CHOICES = new Set(['everyone', 'match']);

async function ensureColumns() {
  if (!env.DATABASE_URL) return;
  const db = getPool();
  await db.query('alter table v3_users add column if not exists ghost_mode boolean not null default false');
  // Who may see my "last seen" time and my "online" dot. online='match' means "same as last seen".
  await db.query("alter table v3_users add column if not exists last_seen_visibility text not null default 'everyone'");
  await db.query("alter table v3_users add column if not exists online_visibility text not null default 'everyone'");
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

const DEFAULT_PREFS = { ghost: false, lastSeen: 'everyone', online: 'everyone' };

/** Loads (and caches) a user's presence prefs. Defaults to fully visible if the row/columns are missing. */
async function getPresencePrefs(userId) {
  const key = Number(userId);
  if (prefsCache.has(key)) return prefsCache.get(key);
  let prefs = { ...DEFAULT_PREFS };
  try {
    const { rows } = await getPool().query(
      'select ghost_mode, last_seen_visibility, online_visibility from v3_users where user_id = $1',
      [key]
    );
    if (rows[0]) {
      prefs = {
        ghost: Boolean(rows[0].ghost_mode),
        lastSeen: LAST_SEEN_CHOICES.has(rows[0].last_seen_visibility) ? rows[0].last_seen_visibility : 'everyone',
        online: ONLINE_CHOICES.has(rows[0].online_visibility) ? rows[0].online_visibility : 'everyone',
      };
    }
  } catch { /* columns missing or DB down: treat as visible */ }
  prefsCache.set(key, prefs);
  return prefs;
}

function getPresencePrefsCached(userId) {
  return prefsCache.get(Number(userId)) || { ...DEFAULT_PREFS };
}

/**
 * What the [viewer] may see of the [target]'s presence. "Last seen" is reciprocal
 * (hide yours and you lose others'); "online" shows to everyone when set to 'everyone',
 * otherwise it follows the reciprocal last-seen visibility ('match' = same as last seen).
 */
function presenceVisibility(targetPrefs, viewerPrefs) {
  const t = targetPrefs || DEFAULT_PREFS;
  const v = viewerPrefs || DEFAULT_PREFS;
  const lastSeen = !t.ghost && t.lastSeen === 'everyone' && v.lastSeen === 'everyone';
  const online = !t.ghost && (t.online === 'everyone' ? true : lastSeen);
  return { lastSeen, online };
}

async function isGhost(userId) {
  return (await getPresencePrefs(userId)).ghost;
}

/** Synchronous read for hot paths; callers warm the cache with isGhost()/getPresencePrefs() first. */
function isGhostCached(userId) {
  return getPresencePrefsCached(userId).ghost === true;
}

async function setGhost(userId, on) {
  await getPool().query('update v3_users set ghost_mode = $2 where user_id = $1', [Number(userId), Boolean(on)]);
  const prefs = { ...(await getPresencePrefs(userId)), ghost: Boolean(on) };
  prefsCache.set(Number(userId), prefs);
}

/** Updates last-seen / online visibility choices. Unspecified fields are left as-is. */
async function setVisibility(userId, { lastSeen, online }) {
  const current = await getPresencePrefs(userId);
  const next = {
    lastSeen: LAST_SEEN_CHOICES.has(lastSeen) ? lastSeen : current.lastSeen,
    online: ONLINE_CHOICES.has(online) ? online : current.online,
  };
  await getPool().query(
    'update v3_users set last_seen_visibility = $2, online_visibility = $3 where user_id = $1',
    [Number(userId), next.lastSeen, next.online]
  );
  prefsCache.set(Number(userId), { ...current, ...next });
  return next;
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
  app.get('/api/v3/me/privacy', { preHandler: requireAuth }, async (request) => {
    const prefs = await getPresencePrefs(request.auth.userId);
    return {
      success: true,
      ghostMode: prefs.ghost,
      lastSeenVisibility: prefs.lastSeen,
      onlineVisibility: prefs.online,
    };
  });

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
    const parsed = z.object({
      ghostMode: z.boolean().optional(),
      lastSeenVisibility: z.enum(['everyone', 'nobody']).optional(),
      onlineVisibility: z.enum(['everyone', 'match']).optional(),
    }).safeParse(request.body || {});
    if (!parsed.success || Object.keys(parsed.data).length === 0) {
      return reply.status(400).send({ success: false, error: 'Invalid request body' });
    }
    try {
      if (parsed.data.lastSeenVisibility !== undefined || parsed.data.onlineVisibility !== undefined) {
        await setVisibility(request.auth.userId, {
          lastSeen: parsed.data.lastSeenVisibility,
          online: parsed.data.onlineVisibility,
        });
      }
      if (parsed.data.ghostMode !== undefined) {
        const was = await isGhost(request.auth.userId);
        await setGhost(request.auth.userId, parsed.data.ghostMode);
        if (was !== parsed.data.ghostMode) announcePresence(request.auth, !parsed.data.ghostMode);
      }
      const prefs = await getPresencePrefs(request.auth.userId);
      return { success: true, ghostMode: prefs.ghost, lastSeenVisibility: prefs.lastSeen, onlineVisibility: prefs.online };
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

module.exports = {
  BURN_SECONDS, ensureColumns, isGhost, isGhostCached, setGhost,
  getPresencePrefs, getPresencePrefsCached, presenceVisibility, setVisibility,
  startBurnTimers, registerPrivacyRoutes,
};
