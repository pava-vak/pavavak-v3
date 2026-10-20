const { z } = require('zod');
const crypto = require('crypto');
const https = require('https');
const http = require('http');
const dns = require('dns');
const { requireAuth, requireAdmin } = require('../../shared/security/auth.preHandler');
const { getPool } = require('../../db/pool');
const chatAdapter = require('../../db/chatAdapter');
const realtime = require('../../realtime/eventEmitter');
const { isUserOnline } = require('../../realtime/connectionRegistry');
const { canAccessFile, fileIdFromBody } = require('../media/mediaAccess');

// ── helpers ──────────────────────────────────────────────────────────────────

async function assertMember(db, conversationId, userId) {
  const { rows } = await db.query(
    'select 1 from v3_conversation_members where conversation_id=$1 and user_id=$2 limit 1',
    [conversationId, userId]
  );
  if (!rows.length) { const e = new Error('Not a member of this chat'); e.status = 403; throw e; }
}

async function getMemberIds(db, conversationId) {
  const { rows } = await db.query(
    'select user_id from v3_conversation_members where conversation_id=$1',
    [conversationId]
  );
  return rows.map(r => Number(r.user_id));
}

// Current members who still hold this message (not joined later, not cleared)
async function getMessageRecipientIds(db, messageId, conversationId) {
  const { rows } = await db.query(
    `select r.user_id from v3_message_receipts r
     join v3_conversation_members cm on cm.conversation_id=$2 and cm.user_id=r.user_id
     where r.message_id=$1 and r.cleared_at is null`,
    [messageId, conversationId]
  );
  return rows.map(r => Number(r.user_id));
}

async function getMessageConversation(db, messageId, userId) {
  const { rows } = await db.query(
    `select m.conversation_id, m.sender_id, m.body, m.view_once, m.expires_at
     from v3_messages m
     join v3_conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=$2
     join v3_message_receipts r on r.message_id=m.message_id and r.user_id=$2 and r.cleared_at is null
     where m.message_id=$1 and m.deleted_at is null
       and (m.expires_at is null or m.expires_at > now()) limit 1`,
    [messageId, userId]
  );
  if (!rows.length) { const e = new Error('Message not found'); e.status = 404; throw e; }
  return rows[0];
}

function isPrivateIp(ip) {
  // Reject loopback, private, and link-local ranges
  if (ip === '::1') return true;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false;
  const [a, b] = parts;
  return (
    a === 127 ||                          // 127.x.x.x loopback
    a === 10 ||                           // 10.x.x.x private
    (a === 172 && b >= 16 && b <= 31) || // 172.16-31.x.x private
    (a === 192 && b === 168) ||           // 192.168.x.x private
    (a === 169 && b === 254)              // 169.254.x.x link-local
  );
}

// Minimal og-tag / title fetch (no npm dependency)
function fetchLinkPreview(rawUrl) {
  return new Promise((resolve) => {
    let url;
    try { url = new URL(rawUrl); } catch { return resolve(null); }
    // SSRF protection: resolve hostname and reject private/loopback IPs
    dns.promises.lookup(url.hostname).then(({ address }) => {
      if (isPrivateIp(address)) return resolve(null);
      const lib = url.protocol === 'https:' ? https : http;
      const req = lib.get(
      { hostname: address, path: url.pathname + url.search, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        headers: { 'User-Agent': 'PaVa-Bot/1.0 (+https://pava.app)', Accept: 'text/html', Host: url.hostname },
        timeout: 5000 },
      (res) => {
        if (res.statusCode > 399) { res.destroy(); return resolve(null); }
        let html = '';
        res.setEncoding('utf8');
        res.on('data', chunk => { html += chunk; if (html.length > 80000) res.destroy(); });
        res.on('end', () => {
          const get = (prop) => {
            const m = html.match(new RegExp(`<meta[^>]+(?:property|name)=["']${prop}["'][^>]+content=["']([^"']+)["']`, 'i'))
                     || html.match(new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+(?:property|name)=["']${prop}["']`, 'i'));
            return m?.[1] || null;
          };
          const titleM = html.match(/<title[^>]*>([^<]{1,200})<\/title>/i);
          resolve({
            title: get('og:title') || get('twitter:title') || titleM?.[1]?.trim() || null,
            description: get('og:description') || get('twitter:description') || null,
            image_url: get('og:image') || get('twitter:image') || null,
            site_name: get('og:site_name') || url.hostname
          });
        });
        res.on('error', () => resolve(null));
      }
    );
      req.on('error', () => resolve(null));
      req.on('timeout', () => { req.destroy(); resolve(null); });
    }).catch(() => resolve(null));
  });
}

// ── routes ───────────────────────────────────────────────────────────────────

function registerFeatureRoutes(app) {

  // ── Reactions ──────────────────────────────────────────────────────────────
  app.post('/api/v3/messages/:messageId/react', { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const emoji = String(request.body?.emoji || '').trim().slice(0, 8);
    if (!emoji) return reply.status(400).send({ success: false, error: 'emoji required' });
    const db = getPool();
    try {
      const msg = await getMessageConversation(db, request.params.messageId, request.auth.userId);
      const memberIds = await getMessageRecipientIds(db, request.params.messageId, msg.conversation_id);
      // Toggle: if same emoji exists, remove; otherwise upsert
      const existing = await db.query(
        'select emoji from v3_message_reactions where message_id=$1 and user_id=$2',
        [request.params.messageId, request.auth.userId]
      );
      if (existing.rows[0]?.emoji === emoji) {
        await db.query('delete from v3_message_reactions where message_id=$1 and user_id=$2',
          [request.params.messageId, request.auth.userId]);
        realtime.emitReactionToMembers(msg.conversation_id, request.params.messageId, request.auth.userId, null, null, memberIds);
        return { success: true, removed: true };
      }
      await db.query(
        `insert into v3_message_reactions(message_id,user_id,emoji) values($1,$2,$3)
         on conflict(message_id,user_id) do update set emoji=$3, created_at=now()`,
        [request.params.messageId, request.auth.userId, emoji]
      );
      realtime.emitReactionToMembers(msg.conversation_id, request.params.messageId, request.auth.userId, request.auth.displayName, emoji, memberIds);
      return { success: true, emoji };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // Get chat members
  app.get('/api/v3/chats/:chatId/members', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    try {
      await assertMember(db, request.params.chatId, request.auth.userId);
      const { rows } = await db.query(
        `select u.user_id, coalesce(u.display_name, u.username) as display_name, u.username, cm.role
         from v3_conversation_members cm
         join v3_users u on u.user_id = cm.user_id
         where cm.conversation_id = $1
         order by cm.role desc, display_name asc`,
        [request.params.chatId]
      );
      return { success: true, members: rows.map(r => ({ userId: r.user_id, displayName: r.display_name, username: r.username, role: r.role })) };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // Get reactions for all messages in a chat
  app.get('/api/v3/chats/:chatId/reactions', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    try {
      await assertMember(db, request.params.chatId, request.auth.userId);
      const { rows } = await db.query(
        `select r.message_id, r.user_id, r.emoji, u.display_name
         from v3_message_reactions r
         join v3_users u on u.user_id=r.user_id
         join v3_messages m on m.message_id=r.message_id
         join v3_message_receipts mine on mine.message_id=m.message_id and mine.user_id=$2 and mine.cleared_at is null
         where m.conversation_id=$1`,
        [request.params.chatId, request.auth.userId]
      );
      // Group by message
      const byMessage = {};
      for (const row of rows) {
        if (!byMessage[row.message_id]) byMessage[row.message_id] = [];
        byMessage[row.message_id].push({ userId: row.user_id, displayName: row.display_name, emoji: row.emoji });
      }
      return { success: true, reactions: byMessage };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // ── Edit message ───────────────────────────────────────────────────────────
  app.put('/api/v3/messages/:messageId', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const text = String(request.body?.text || '').trim();
    if (!text || text.length > 4000) return reply.status(400).send({ success: false, error: 'text required (max 4000)' });
    const db = getPool();
    try {
      const msg = await getMessageConversation(db, request.params.messageId, request.auth.userId);
      if (Number(msg.sender_id) !== Number(request.auth.userId))
        return reply.status(403).send({ success: false, error: 'Cannot edit another person\'s message' });
      if (/^__[A-Z]+__:/.test(text) || /^__[A-Z]+__:/.test(msg.body || '') || msg.view_once)
        return reply.status(400).send({ success: false, error: 'Only text messages can be edited' });
      await db.query(
        'update v3_messages set body=$1, edited_at=now() where message_id=$2',
        [text, request.params.messageId]
      );
      const recipientIds = await getMessageRecipientIds(db, request.params.messageId, msg.conversation_id);
      realtime.emitMessageEditedToMembers(msg.conversation_id, request.params.messageId, text, new Date().toISOString(), recipientIds);
      return { success: true };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // ── Forward message ────────────────────────────────────────────────────────
  app.post('/api/v3/messages/:messageId/forward', { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const toChatId = String(request.body?.chatId || '').trim();
    if (!toChatId) return reply.status(400).send({ success: false, error: 'chatId required' });
    const db = getPool();
    try {
      const msg = await getMessageConversation(db, request.params.messageId, request.auth.userId);
      if (msg.view_once) return reply.status(403).send({ success: false, error: 'View-once messages cannot be forwarded' });
      await assertMember(db, toChatId, request.auth.userId);
      const newMessageId = `m-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      await db.query(
        `insert into v3_messages(message_id,conversation_id,sender_id,body,created_at,forwarded_from_id)
         values($1,$2,$3,$4,$5,$6)`,
        [newMessageId, toChatId, request.auth.userId, msg.body, now, request.params.messageId]
      );
      // Update summaries and emit
      const memberIds = await getMemberIds(db, toChatId);
      for (const memberId of memberIds) {
        const dir = memberId === request.auth.userId ? 'outgoing' : 'incoming';
        await db.query(
          `insert into v3_message_receipts(message_id,user_id,delivered_at,read_at)
           values($1,$2,$3,$4) on conflict do nothing`,
          [newMessageId, memberId,
           memberId === request.auth.userId ? null : now,
           memberId === request.auth.userId ? null : null]
        );
        await db.query(
          `insert into v3_user_chat_summaries(user_id,conversation_id,last_message_id,last_message_preview,last_message_at,last_message_direction,last_message_status,unread_count,updated_at)
           values($1::bigint,$2,$3,$4,$5,$6,$7,
             case when $1::bigint=$8::bigint then 0 else coalesce((select unread_count from v3_user_chat_summaries where user_id=$1::bigint and conversation_id=$2),0)+1 end,
             now())
           on conflict(user_id,conversation_id) do update set
             last_message_id=$3, last_message_preview=$4, last_message_at=$5,
             last_message_direction=$6, last_message_status=$7,
             unread_count=case when $1::bigint=$8::bigint then 0 else v3_user_chat_summaries.unread_count+1 end,
             updated_at=now()`,
          [memberId, toChatId, newMessageId, msg.body, now, dir, 'sent', request.auth.userId]
        );
        realtime.emitToUser(memberId, 'message:new', {
          chatId: toChatId,
          message: {
            messageId: newMessageId, text: msg.body, sentAt: now,
            direction: dir, status: 'sent', forwarded: true,
            senderDisplayName: dir === 'incoming' ? request.auth.displayName : undefined
          }
        });
      }
      return { success: true, messageId: newMessageId };
    } catch (err) {
      if (!err.status) request.log.error({ err }, 'Failed to forward message');
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // ── Pin message ────────────────────────────────────────────────────────────
  app.put('/api/v3/chats/:chatId/pin', { preHandler: requireAuth }, async (request, reply) => {
    const messageId = request.body?.messageId || null;
    const db = getPool();
    try {
      await assertMember(db, request.params.chatId, request.auth.userId);
      if (messageId) {
        const msg = await getMessageConversation(db, messageId, request.auth.userId);
        if (msg.conversation_id !== request.params.chatId || msg.view_once) {
          return reply.status(404).send({ success: false, error: 'Message not found' });
        }
      }
      await db.query(
        'update v3_conversations set pinned_message_id=$1 where conversation_id=$2',
        [messageId, request.params.chatId]
      );
      const memberIds = await getMemberIds(db, request.params.chatId);
      memberIds.forEach(id => realtime.emitToUser(id, 'chat:pinned',
        { chatId: request.params.chatId, messageId }));
      return { success: true };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // Get pinned message
  app.get('/api/v3/chats/:chatId/pin', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    try {
      await assertMember(db, request.params.chatId, request.auth.userId);
      const { rows } = await db.query(
        `select m.message_id, m.body, u.display_name as sender_name
         from v3_conversations c
         join v3_messages m on m.message_id=c.pinned_message_id
           and m.conversation_id=c.conversation_id
           and m.deleted_at is null and not m.view_once
           and (m.expires_at is null or m.expires_at > now())
         join v3_message_receipts r on r.message_id=m.message_id and r.user_id=$2 and r.cleared_at is null
         left join v3_users u on u.user_id=m.sender_id
         where c.conversation_id=$1`,
        [request.params.chatId, request.auth.userId]
      );
      const row = rows[0];
      return { success: true, pinned: row
        ? { messageId: row.message_id, text: row.body, senderName: row.sender_name }
        : null };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // ── Archive / unarchive ────────────────────────────────────────────────────
  app.put('/api/v3/chats/:chatId/archive', { preHandler: requireAuth }, async (request, reply) => {
    const archived = Boolean(request.body?.archived);
    const db = getPool();
    try {
      await assertMember(db, request.params.chatId, request.auth.userId);
      await db.query(
        'update v3_conversation_members set archived=$1 where conversation_id=$2 and user_id=$3',
        [archived, request.params.chatId, request.auth.userId]
      );
      return { success: true };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // ── Mute / unmute ──────────────────────────────────────────────────────────
  app.put('/api/v3/chats/:chatId/mute', { preHandler: requireAuth }, async (request, reply) => {
    const muted = Boolean(request.body?.muted);
    const db = getPool();
    try {
      await assertMember(db, request.params.chatId, request.auth.userId);
      await db.query(
        'update v3_conversation_members set muted=$1 where conversation_id=$2 and user_id=$3',
        [muted, request.params.chatId, request.auth.userId]
      );
      return { success: true };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // ── Chat background ────────────────────────────────────────────────────────
  app.put('/api/v3/chats/:chatId/background', { preHandler: requireAuth }, async (request, reply) => {
    const background = request.body?.background || null;
    const db = getPool();
    try {
      await assertMember(db, request.params.chatId, request.auth.userId);
      await db.query(
        'update v3_conversation_members set chat_background=$1 where conversation_id=$2 and user_id=$3',
        [background, request.params.chatId, request.auth.userId]
      );
      return { success: true };
    } catch (err) {
      if (err.status === 403) return reply.status(403).send({ success: false, error: err.message });
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // ── Presence ───────────────────────────────────────────────────────────────
  app.get('/api/v3/users/:userId/presence', { preHandler: requireAuth }, async (request, reply) => {
    const userId = Number(request.params.userId);
    const db = getPool();
    try {
      const { rows } = await db.query(
        `select u.last_seen_at from v3_users u
         where u.user_id=$1 and exists (
           select 1 from v3_conversation_members a
           join v3_conversation_members b on b.conversation_id=a.conversation_id
           where a.user_id=$1 and b.user_id=$2)`,
        [userId, request.auth.userId]
      );
      if (!rows.length) return reply.status(404).send({ success: false, error: 'User not found' });
      return { success: true, online: isUserOnline(userId), lastSeenAt: rows[0].last_seen_at };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // ── Global search ──────────────────────────────────────────────────────────
  app.get('/api/v3/search', { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const q = String(request.query?.q || '').trim();
    if (q.length < 2) return { success: true, messages: [], chats: [] };
    const db = getPool();
    try {
      // Use GIN full-text index when the query is plain words; fall back to ILIKE for partial/symbol queries
      const useFullText = /^[\w\s]{2,}$/.test(q);
      const whereClause = useFullText
        ? `to_tsvector('simple', coalesce(m.body,'')) @@ plainto_tsquery('simple', $2)`
        : `m.body ilike $2`;
      const param = useFullText ? q : `%${q}%`;
      const { rows: messages } = await db.query(
        `select m.message_id, m.conversation_id as chat_id, m.body, m.created_at,
                u.display_name as sender_name,
                case when c.type='direct' then
                  coalesce((select display_name from v3_users u2
                    join v3_conversation_members cm2 on cm2.user_id=u2.user_id
                    where cm2.conversation_id=c.conversation_id and cm2.user_id!=$1 limit 1), c.title)
                else c.title end as chat_title
         from v3_messages m
         join v3_conversations c on c.conversation_id=m.conversation_id
         join v3_conversation_members cm on cm.conversation_id=m.conversation_id and cm.user_id=$1
         join v3_message_receipts r on r.message_id=m.message_id and r.user_id=$1 and r.cleared_at is null
         join v3_users u on u.user_id=m.sender_id
         where ${whereClause} and m.deleted_at is null and not m.view_once
           and (m.expires_at is null or m.expires_at > now())
         order by m.created_at desc limit 30`,
        [request.auth.userId, param]
      );
      return {
        success: true,
        messages: messages.map(r => ({
          messageId: r.message_id, chatId: r.chat_id, text: r.body,
          sentAt: r.created_at, senderName: r.sender_name, chatTitle: r.chat_title
        }))
      };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // ── Link preview ───────────────────────────────────────────────────────────
  app.get('/api/v3/link-preview', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const rawUrl = String(request.query?.url || '').trim();
    if (!rawUrl.startsWith('http')) return reply.status(400).send({ success: false, error: 'Invalid URL' });
    const db = getPool();
    try {
      // Check cache (1 day TTL)
      const cached = await db.query(
        'select title,description,image_url,site_name from v3_link_previews where url=$1 and fetched_at > now()-interval\'1 day\'',
        [rawUrl]
      );
      if (cached.rows.length) return { success: true, preview: cached.rows[0] };
      const preview = await fetchLinkPreview(rawUrl);
      if (!preview) return { success: true, preview: null };
      await db.query(
        `insert into v3_link_previews(url,title,description,image_url,site_name,fetched_at)
         values($1,$2,$3,$4,$5,now())
         on conflict(url) do update set title=$2,description=$3,image_url=$4,site_name=$5,fetched_at=now()`,
        [rawUrl, preview.title, preview.description, preview.image_url, preview.site_name]
      );
      return { success: true, preview };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // ── Group chats ────────────────────────────────────────────────────────────
  app.post('/api/v3/chats/group', { preHandler: requireAuth, config: { rateLimit: { max: 10, timeWindow: '1 minute' } } }, async (request, reply) => {
    const title = String(request.body?.title || '').trim().slice(0, 80);
    const memberIds = Array.isArray(request.body?.memberIds) ? request.body.memberIds.map(Number).filter(Boolean) : [];
    if (!title) return reply.status(400).send({ success: false, error: 'title required' });
    const db = getPool();
    const client = await db.connect();
    try {
      await client.query('begin');
      const chatId = `grp-${crypto.randomUUID()}`;
      await client.query(
        'insert into v3_conversations(conversation_id,type,title) values($1,\'group\',$2)',
        [chatId, title]
      );
      const allMembers = [...new Set([request.auth.userId, ...memberIds])];
      for (const uid of allMembers) {
        const role = uid === request.auth.userId ? 'admin' : 'member';
        await client.query(
          'insert into v3_conversation_members(conversation_id,user_id,role) values($1,$2,$3) on conflict do nothing',
          [chatId, uid, role]
        );
        await client.query(
          `insert into v3_user_chat_summaries(user_id,conversation_id,unread_count,updated_at)
           values($1,$2,0,now()) on conflict do nothing`,
          [uid, chatId]
        );
      }
      await client.query('commit');
      const chat = { chatId, chatType: 'group', title, avatarText: title[0].toUpperCase(),
        subtitle: `${allMembers.length} members`, unreadCount: 0, muted: false, lastMessage: null };
      allMembers.forEach(id => realtime.emitToUser(id, 'chat:new', { chat }));
      return { success: true, chat };
    } catch (err) {
      await client.query('rollback');
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    } finally { client.release(); }
  });

  app.put('/api/v3/chats/:chatId/group/title', { preHandler: requireAuth }, async (request, reply) => {
    const title = String(request.body?.title || '').trim().slice(0, 80);
    if (!title) return reply.status(400).send({ success: false, error: 'title required' });
    const db = getPool();
    try {
      const { rows } = await db.query(
        'select role from v3_conversation_members where conversation_id=$1 and user_id=$2 limit 1',
        [request.params.chatId, request.auth.userId]
      );
      if (!rows.length || rows[0].role !== 'admin')
        return reply.status(403).send({ success: false, error: 'Admins only' });
      await db.query('update v3_conversations set title=$1 where conversation_id=$2', [title, request.params.chatId]);
      const memberIds = await getMemberIds(db, request.params.chatId);
      memberIds.forEach(id => realtime.emitToUser(id, 'chat:updated',
        { chatId: request.params.chatId, title }));
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  app.post('/api/v3/chats/:chatId/group/members', { preHandler: requireAuth }, async (request, reply) => {
    const userId = Number(request.body?.userId);
    if (!userId) return reply.status(400).send({ success: false, error: 'userId required' });
    const db = getPool();
    try {
      const { rows: callerRows } = await db.query(
        'select role from v3_conversation_members where conversation_id=$1 and user_id=$2',
        [request.params.chatId, request.auth.userId]
      );
      if (!callerRows.length || callerRows[0].role !== 'admin')
        return reply.status(403).send({ success: false, error: 'Admins only' });

      // Validate target user exists
      const { rows: userRows } = await db.query('select user_id from v3_users where user_id=$1', [userId]);
      if (!userRows.length) return reply.status(404).send({ success: false, error: 'User not found' });

      await db.query(
        'insert into v3_conversation_members(conversation_id,user_id,role) values($1,$2,\'member\') on conflict do nothing',
        [request.params.chatId, userId]
      );
      await db.query(
        'insert into v3_user_chat_summaries(user_id,conversation_id,unread_count,updated_at) values($1,$2,0,now()) on conflict do nothing',
        [userId, request.params.chatId]
      );

      // Notify added user so their chat list updates in realtime
      realtime.emitChatUpdated(userId, { chatId: request.params.chatId, reload: true });

      return { success: true };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  app.delete('/api/v3/chats/:chatId/group/members/:userId', { preHandler: requireAuth }, async (request, reply) => {
    const targetId = Number(request.params.userId);
    const db = getPool();
    try {
      const { rows } = await db.query(
        'select role from v3_conversation_members where conversation_id=$1 and user_id=$2',
        [request.params.chatId, request.auth.userId]
      );
      // Admin can remove anyone; member can only remove themselves
      const isAdmin = rows[0]?.role === 'admin';
      if (!isAdmin && targetId !== request.auth.userId)
        return reply.status(403).send({ success: false, error: 'Admins only' });
      await db.query(
        'delete from v3_conversation_members where conversation_id=$1 and user_id=$2',
        [request.params.chatId, targetId]
      );
      // Clean up the removed member's summary so chat disappears from their list
      await db.query(
        'delete from v3_user_chat_summaries where user_id=$1 and conversation_id=$2',
        [targetId, request.params.chatId]
      );
      // Notify removed user so their chat list updates in realtime
      realtime.emitToUser(targetId, 'chat:removed', { chatId: request.params.chatId });

      return { success: true };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // ── Polls ──────────────────────────────────────────────────────────────────
  app.post('/api/v3/polls', { preHandler: requireAuth }, async (request, reply) => {
    const question = String(request.body?.question || '').trim().slice(0, 200);
    const options = Array.isArray(request.body?.options) ? request.body.options.slice(0, 6).map(o => String(o).trim().slice(0, 100)).filter(Boolean) : [];
    const chatId = String(request.body?.chatId || '').trim();
    if (!question || options.length < 2 || !chatId)
      return reply.status(400).send({ success: false, error: 'question, >=2 options and chatId required' });
    const db = getPool();
    const client = await db.connect();
    try {
      await assertMember(db, chatId, request.auth.userId);
      await client.query('begin');
      const messageId = `m-${crypto.randomUUID()}`;
      const now = new Date().toISOString();
      const pollBody = `__POLL__:${messageId}`;
      await client.query(
        'insert into v3_messages(message_id,conversation_id,sender_id,body,created_at) values($1,$2,$3,$4,$5)',
        [messageId, chatId, request.auth.userId, pollBody, now]
      );
      await client.query(
        'insert into v3_polls(message_id,question,options) values($1,$2,$3)',
        [messageId, question, JSON.stringify(options)]
      );
      const memberIds = await getMemberIds(db, chatId);
      // Receipts make the poll visible in each member's thread (queries are receipt-based)
      for (const memberId of memberIds) {
        await client.query(
          'insert into v3_message_receipts(message_id,user_id) values($1,$2) on conflict do nothing',
          [messageId, memberId]
        );
      }
      await client.query('commit');
      for (const memberId of memberIds) {
        const dir = memberId === request.auth.userId ? 'outgoing' : 'incoming';
        await db.query(
          `insert into v3_user_chat_summaries(user_id,conversation_id,last_message_id,last_message_preview,last_message_at,last_message_direction,last_message_status,unread_count,updated_at)
           values($1::bigint,$2,$3,$4,$5,$6,$7,
             case when $1::bigint=$8::bigint then 0 else coalesce((select unread_count from v3_user_chat_summaries where user_id=$1::bigint and conversation_id=$2),0)+1 end,now())
           on conflict(user_id,conversation_id) do update set last_message_id=$3,last_message_preview=$4,last_message_at=$5,last_message_direction=$6,last_message_status=$7,
           unread_count=case when $1::bigint=$8::bigint then 0 else v3_user_chat_summaries.unread_count+1 end,updated_at=now()`,
          [memberId, chatId, messageId, `📊 Poll: ${question}`, now, dir, 'sent', request.auth.userId]
        );
        realtime.emitToUser(memberId, 'message:new', {
          chatId,
          message: { messageId, text: pollBody, sentAt: now, direction: dir, status: 'sent',
            senderDisplayName: dir === 'incoming' ? request.auth.displayName : undefined,
            poll: { question, options, votes: {} } }
        });
      }
      return { success: true, messageId };
    } catch (err) {
      await client.query('rollback');
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    } finally { client.release(); }
  });

  app.post('/api/v3/polls/:messageId/vote', { preHandler: requireAuth }, async (request, reply) => {
    const optionIndex = Number(request.body?.optionIndex);
    if (isNaN(optionIndex) || optionIndex < 0)
      return reply.status(400).send({ success: false, error: 'optionIndex required' });
    const db = getPool();
    try {
      const { rows: pollRows } = await db.query(
        'select p.*, m.conversation_id from v3_polls p join v3_messages m on m.message_id=p.message_id where p.message_id=$1',
        [request.params.messageId]
      );
      if (!pollRows.length) return reply.status(404).send({ success: false, error: 'Poll not found' });
      const poll = pollRows[0];
      if (optionIndex >= poll.options.length)
        return reply.status(400).send({ success: false, error: 'Invalid option' });
      await assertMember(db, poll.conversation_id, request.auth.userId);
      await db.query(
        `insert into v3_poll_votes(message_id,user_id,option_index) values($1,$2,$3)
         on conflict(message_id,user_id) do update set option_index=$3, voted_at=now()`,
        [request.params.messageId, request.auth.userId, optionIndex]
      );
      const { rows: voteRows } = await db.query(
        'select option_index, count(*) as cnt from v3_poll_votes where message_id=$1 group by option_index',
        [request.params.messageId]
      );
      const votes = {};
      voteRows.forEach(r => { votes[r.option_index] = parseInt(r.cnt); });
      const memberIds = await getMemberIds(db, poll.conversation_id);
      memberIds.forEach(id => realtime.emitToUser(id, 'poll:voted',
        { messageId: request.params.messageId, chatId: poll.conversation_id, votes }));
      return { success: true, votes };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  app.get('/api/v3/polls/:messageId', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    try {
      // Verify membership via message lookup (returns 404 if not a member)
      await getMessageConversation(db, request.params.messageId, request.auth.userId);
      const { rows } = await db.query(
        `select p.question, p.options,
                (select json_object_agg(t.option_index::text, t.cnt)
                   from (select option_index, count(*) as cnt from v3_poll_votes
                         where message_id=p.message_id group by option_index) t) as votes,
                (select option_index from v3_poll_votes where message_id=p.message_id and user_id=$2 limit 1) as my_vote
         from v3_polls p
         where p.message_id=$1`,
        [request.params.messageId, request.auth.userId]
      );
      if (!rows.length) return reply.status(404).send({ success: false, error: 'Poll not found' });
      const r = rows[0];
      return { success: true, poll: { question: r.question, options: r.options, votes: r.votes || {}, myVote: r.my_vote } };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // ── Scheduled messages ─────────────────────────────────────────────────────
  app.post('/api/v3/scheduled-messages', { preHandler: requireAuth, config: { rateLimit: { max: 20, timeWindow: '1 minute' } } }, async (request, reply) => {
    const text = String(request.body?.text || '').trim().slice(0, 4000);
    const chatId = String(request.body?.chatId || '').trim();
    const scheduledAt = request.body?.scheduledAt;
    if (!text || !chatId || !scheduledAt)
      return reply.status(400).send({ success: false, error: 'text, chatId, scheduledAt required' });
    if (text.length === 0)
      return reply.status(400).send({ success: false, error: 'text cannot be empty' });
    const schedDate = new Date(scheduledAt);
    if (isNaN(schedDate) || schedDate <= new Date())
      return reply.status(400).send({ success: false, error: 'scheduledAt must be in the future' });
    const db = getPool();
    try {
      await assertMember(db, chatId, request.auth.userId);
      const attachedFileId = fileIdFromBody(text);
      if (attachedFileId && !(await canAccessFile(request.auth.userId, attachedFileId))) {
        return reply.status(403).send({ success: false, error: 'You can only send files you uploaded or received' });
      }
      const { rows } = await db.query(
        'insert into v3_scheduled_messages(sender_id,conversation_id,body,scheduled_at) values($1,$2,$3,$4) returning id,scheduled_at',
        [request.auth.userId, chatId, text, schedDate.toISOString()]
      );
      return { success: true, id: rows[0].id, scheduledAt: rows[0].scheduled_at };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  app.get('/api/v3/scheduled-messages', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    try {
      const { rows } = await db.query(
        `select s.id, s.conversation_id as chat_id, s.body, s.scheduled_at,
                case when c.type='direct' then
                  coalesce((select display_name from v3_users u join v3_conversation_members cm on cm.user_id=u.user_id
                    where cm.conversation_id=c.conversation_id and cm.user_id!=$1 limit 1), c.title)
                else c.title end as chat_title
         from v3_scheduled_messages s
         join v3_conversations c on c.conversation_id=s.conversation_id
         where s.sender_id=$1 and not s.sent
         order by s.scheduled_at asc`,
        [request.auth.userId]
      );
      return { success: true, items: rows.map(r => ({ id: r.id, chatId: r.chat_id, text: r.body, scheduledAt: r.scheduled_at, chatTitle: r.chat_title })) };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  app.delete('/api/v3/scheduled-messages/:id', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    try {
      const { rowCount } = await db.query(
        'delete from v3_scheduled_messages where id=$1 and sender_id=$2 and not sent',
        [request.params.id, request.auth.userId]
      );
      if (!rowCount) return reply.status(404).send({ success: false, error: 'Not found' });
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // ── Chat media gallery ─────────────────────────────────────────────────────
  // viewerId = null for the admin gallery; otherwise only media delivered to that user
  async function fetchMediaGallery(db, chatId, limit, cursor, viewerId = null) {
    let cursorClause = '';
    let params = [chatId, limit + 1, viewerId];
    if (cursor) {
      const cr = await db.query(
        'select created_at, message_id from v3_messages where message_id=$1 and conversation_id=$2',
        [cursor, chatId]
      );
      if (cr.rowCount > 0) {
        cursorClause = 'and (msg.created_at, msg.message_id) < ($4::timestamptz, $5::text)';
        params = [chatId, limit + 1, viewerId, cr.rows[0].created_at, cr.rows[0].message_id];
      }
    }
    const { rows } = await db.query(
      `select msg.message_id, msg.body, msg.created_at,
              coalesce(u.display_name, u.username, msg.sender_id::text) as sender_name
       from v3_messages msg
       left join v3_users u on u.user_id = msg.sender_id
       where msg.conversation_id=$1
         and msg.deleted_at is null
         and ($3::bigint is null or (
           not msg.view_once
           and (msg.expires_at is null or msg.expires_at > now())
           and exists (select 1 from v3_message_receipts r where r.message_id = msg.message_id and r.user_id = $3::bigint and r.cleared_at is null)))
         and (msg.body like '__IMG__%' or msg.body like '__VID__%' or msg.body like '__AUD__%' or msg.body like '__DOC__%')
         ${cursorClause}
       order by msg.created_at desc, msg.message_id desc
       limit $2`,
      params
    );
    const hasMore = rows.length > limit;
    const items = (hasMore ? rows.slice(0, limit) : rows).map(r => ({
      messageId: r.message_id,
      fileId: r.body.startsWith('__DOC__') ? r.body.slice(8).split(':')[0] : r.body.slice(8),
      type: r.body.startsWith('__IMG__') ? 'image'
          : r.body.startsWith('__VID__') ? 'video'
          : r.body.startsWith('__AUD__') ? 'audio'
          : 'document',
      sentAt: r.created_at?.toISOString?.() || r.created_at,
      senderName: r.sender_name
    }));
    return { items, hasMore, nextCursor: hasMore ? items[items.length - 1].messageId : null };
  }

  // GET /api/v3/chats/:chatId/media?cursor=&limit=
  app.get('/api/v3/chats/:chatId/media', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    const { chatId } = request.params;
    const limit = Math.min(Number(request.query?.limit) || 60, 120);
    const cursor = request.query?.cursor || null;
    try {
      await assertMember(db, chatId, request.auth.userId);
      const result = await fetchMediaGallery(db, chatId, limit, cursor, request.auth.userId);
      return { success: true, ...result };
    } catch (err) {
      return reply.status(err.status || 500).send({ success: false, error: err.status ? err.message : 'Internal server error' });
    }
  });

  // ── Admin chat media gallery ───────────────────────────────────────────────
  app.get('/api/v3/admin/chats/:chatId/media', { preHandler: requireAdmin }, async (request, reply) => {
    const db = getPool();
    const { chatId } = request.params;
    const limit = Math.min(Number(request.query?.limit) || 60, 120);
    const cursor = request.query?.cursor || null;
    try {
      const result = await fetchMediaGallery(db, chatId, limit, cursor);
      return { success: true, ...result };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  // ── Message stars ──────────────────────────────────────────────────────────
  app.post('/api/v3/messages/:messageId/star', { preHandler: requireAuth, config: { rateLimit: { max: 60, timeWindow: '1 minute' } } }, async (request, reply) => {
    const db = getPool();
    try {
      // Verify user has access to this message
      const { rows } = await db.query(
        `select m.message_id from v3_messages m
         join v3_conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = $1
         join v3_message_receipts r on r.message_id = m.message_id and r.user_id = $1 and r.cleared_at is null
         where m.message_id = $2 and m.deleted_at is null and not m.view_once limit 1`,
        [request.auth.userId, request.params.messageId]
      );
      if (!rows.length) return reply.status(404).send({ success: false, error: 'Message not found' });
      await db.query(
        'insert into v3_message_stars(user_id, message_id) values($1,$2) on conflict do nothing',
        [request.auth.userId, request.params.messageId]
      );
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  app.delete('/api/v3/messages/:messageId/star', { preHandler: requireAuth }, async (request, reply) => {
    const db = getPool();
    try {
      await db.query(
        'delete from v3_message_stars where user_id=$1 and message_id=$2',
        [request.auth.userId, request.params.messageId]
      );
      return { success: true };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });

  app.get('/api/v3/starred-messages', { preHandler: requireAuth, config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async (request, reply) => {
    const db = getPool();
    try {
      const { rows } = await db.query(
        `select m.message_id, m.conversation_id as chat_id, m.body, m.created_at,
                u.display_name as sender_name, s.starred_at,
                case when c.type='direct' then
                  coalesce((select display_name from v3_users u2
                    join v3_conversation_members cm2 on cm2.user_id=u2.user_id
                    where cm2.conversation_id=c.conversation_id and cm2.user_id!=$1 limit 1), c.title)
                else c.title end as chat_title
         from v3_message_stars s
         join v3_messages m on m.message_id = s.message_id
         join v3_conversations c on c.conversation_id = m.conversation_id
         join v3_conversation_members cm on cm.conversation_id = m.conversation_id and cm.user_id = $1
         join v3_message_receipts r on r.message_id = m.message_id and r.user_id = $1 and r.cleared_at is null
         join v3_users u on u.user_id = m.sender_id
         where s.user_id = $1 and m.deleted_at is null
           and (m.expires_at is null or m.expires_at > now())
         order by s.starred_at desc limit 100`,
        [request.auth.userId]
      );
      return {
        success: true,
        messages: rows.map(r => ({
          messageId: r.message_id, chatId: r.chat_id, text: r.body,
          sentAt: r.created_at, starredAt: r.starred_at, senderName: r.sender_name, chatTitle: r.chat_title
        }))
      };
    } catch (err) {
      return reply.status(500).send({ success: false, error: 'Internal server error' });
    }
  });
}

module.exports = { registerFeatureRoutes };
