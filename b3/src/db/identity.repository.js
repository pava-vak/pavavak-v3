const { getPool } = require('./pool');

const MAX_REAL_USER_ID = 9000;

function mapUser(row) {
  return {
    userId: Number(row.user_id),
    username: row.username,
    displayName: row.display_name,
    isAdmin: Boolean(row.is_admin),
    disabled: Boolean(row.disabled),
    tokenVersion: Number(row.token_version || 0)
  };
}

async function findByUsername(username) {
  const db = getPool();
  const result = await db.query(
    `select user_id, username, display_name, is_admin, password_hash, disabled, token_version
     from v3_users
     where lower(username) = lower($1)
     limit 1`,
    [username]
  );
  if (result.rowCount === 0) return null;
  return {
    ...mapUser(result.rows[0]),
    passwordHash: result.rows[0].password_hash
  };
}

async function getById(userId) {
  const db = getPool();
  const result = await db.query(
    `select user_id, username, display_name, is_admin, disabled, token_version
     from v3_users
     where user_id = $1
     limit 1`,
    [userId]
  );
  return result.rowCount > 0 ? mapUser(result.rows[0]) : null;
}

async function createUser({ username, displayName, passwordHash, isAdmin = false }) {
  const db = getPool();
  try {
    const result = await db.query(
      `insert into v3_users (username, display_name, password_hash, is_admin)
       values ($1, $2, $3, $4)
       returning user_id, username, display_name, is_admin, disabled, token_version`,
      [username, displayName, passwordHash, Boolean(isAdmin)]
    );
    return mapUser(result.rows[0]);
  } catch (error) {
    if (error.code === '23505') {
      const err = new Error('Username is already taken');
      err.status = 409;
      throw err;
    }
    throw error;
  }
}

async function updateDisplayName(userId, displayName) {
  const db = getPool();
  const result = await db.query(
    `update v3_users
     set display_name = $2
     where user_id = $1
     returning user_id, username, display_name, is_admin, disabled, token_version`,
    [userId, displayName]
  );
  return result.rowCount > 0 ? mapUser(result.rows[0]) : null;
}

async function setPasswordHash(userId, passwordHash) {
  const db = getPool();
  const result = await db.query(
    `update v3_users
     set password_hash = $2, token_version = token_version + 1
     where user_id = $1
       and user_id < ${MAX_REAL_USER_ID}
     returning user_id, username, display_name, is_admin, disabled, token_version`,
    [userId, passwordHash]
  );
  return result.rowCount > 0 ? mapUser(result.rows[0]) : null;
}

async function listUsers({ query = '', excludeUserId = null, limit = 25 } = {}) {
  const db = getPool();
  const result = await db.query(
    `select user_id, username, display_name, is_admin, disabled, token_version
     from v3_users
     where ($1 = '' or username ilike '%' || $1 || '%' or display_name ilike '%' || $1 || '%')
       and ($2::bigint is null or user_id != $2::bigint)
       and not disabled
       and user_id < ${MAX_REAL_USER_ID}
     order by display_name asc, username asc
     limit $3`,
    [query, excludeUserId, limit]
  );
  return result.rows.map(mapUser);
}

async function adminListUsers({ query = '', limit = 100 } = {}) {
  const db = getPool();
  const result = await db.query(
    `select user_id, username, display_name, is_admin, disabled, token_version
     from v3_users
     where ($1 = '' or username ilike '%' || $1 || '%' or display_name ilike '%' || $1 || '%')
       and user_id < ${MAX_REAL_USER_ID}
     order by user_id asc
     limit $2`,
    [query, limit]
  );
  return result.rows.map(mapUser);
}

async function setDisabled(userId, disabled) {
  const db = getPool();
  const result = await db.query(
    `update v3_users
     set disabled = $2, token_version = token_version + 1
     where user_id = $1 and user_id < ${MAX_REAL_USER_ID}
     returning user_id, username, display_name, is_admin, disabled, token_version`,
    [userId, Boolean(disabled)]
  );
  return result.rowCount > 0 ? mapUser(result.rows[0]) : null;
}

async function getByIdWithHash(userId) {
  const db = getPool();
  const result = await db.query(
    `select user_id, username, display_name, is_admin, disabled, token_version, password_hash
     from v3_users where user_id = $1 limit 1`,
    [userId]
  );
  if (result.rowCount === 0) return null;
  return { ...mapUser(result.rows[0]), passwordHash: result.rows[0].password_hash };
}

async function cleanSeedData() {
  const db = getPool();
  await db.query(`delete from v3_users where user_id >= ${MAX_REAL_USER_ID}`);
}

async function tableExists(client, qualifiedName) {
  const r = await client.query('select to_regclass($1) as t', [qualifiedName]);
  return Boolean(r.rows[0] && r.rows[0].t);
}

// Account deletion (GDPR / Play "delete account"): erase the account, credentials
// and all personal data, but keep the person's already-sent messages visible in
// other people's chats/groups attributed to a reserved, disabled "Deleted user"
// sentinel — so deleting one member never tears holes in everyone else's history.
// Returns false if the account doesn't exist (or isn't a real account).
async function deleteUser(userId) {
  const db = getPool();
  const client = await db.connect();
  try {
    await client.query('begin');

    const target = await client.query(
      `select user_id, is_admin from v3_users
       where user_id = $1 and user_id < ${MAX_REAL_USER_ID}
       for update`,
      [userId]
    );
    if (target.rowCount === 0) {
      await client.query('rollback');
      return false;
    }

    // Never let the last admin delete themselves — it would lock everyone out of admin.
    if (target.rows[0].is_admin) {
      const admins = await client.query(
        `select count(*)::int as c from v3_users
         where is_admin = true and not disabled and user_id < ${MAX_REAL_USER_ID}`
      );
      if (admins.rows[0].c <= 1) {
        const err = new Error('You are the only admin. Make another member an admin before deleting this account.');
        err.status = 409;
        throw err;
      }
    }

    // Reserved sentinel; '__deleted__' can never collide with a real username
    // (the create-user rules forbid underscores). Disabled => hidden from search.
    let sentinel = await client.query(`select user_id from v3_users where username = '__deleted__' limit 1`);
    let sentinelId;
    if (sentinel.rowCount) {
      sentinelId = sentinel.rows[0].user_id;
    } else {
      const ins = await client.query(
        `insert into v3_users (username, display_name, password_hash, is_admin, disabled)
         values ('__deleted__', 'Deleted user', null, false, true)
         returning user_id`
      );
      sentinelId = ins.rows[0].user_id;
    }

    // Reassign authored content whose FK is NOT on delete cascade.
    await client.query('update v3_messages set sender_id = $2 where sender_id = $1', [userId, sentinelId]);
    if (await tableExists(client, 'public.v3_message_media')) {
      await client.query('update v3_message_media set uploaded_by = $2 where uploaded_by = $1', [userId, sentinelId]);
    }
    // created_by is nullable with no cascade — just detach it.
    await client.query('update v3_conversations set created_by = null where created_by = $1', [userId]);

    // Per-user auth/push state (not FK-linked to v3_users).
    if (await tableExists(client, 'public.v3_fcm_tokens')) {
      await client.query('delete from v3_fcm_tokens where user_id = $1', [userId]);
    }
    if (await tableExists(client, 'public.user_sessions')) {
      await client.query('delete from user_sessions where user_id = $1', [userId]);
    }

    // Everything else (memberships, receipts, summaries, reactions, stars,
    // poll votes, scheduled messages) is ON DELETE CASCADE off this row.
    const del = await client.query(
      `delete from v3_users where user_id = $1 and user_id < ${MAX_REAL_USER_ID} returning user_id`,
      [userId]
    );

    await client.query('commit');
    return del.rowCount > 0;
  } catch (error) {
    await client.query('rollback').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function adminSummary() {
  const db = getPool();
  const [users, conversations, messages] = await Promise.all([
    db.query('select count(*)::int as count from v3_users'),
    db.query('select count(*)::int as count from v3_conversations'),
    db.query('select count(*)::int as count from v3_messages')
  ]);
  return {
    users: users.rows[0].count,
    conversations: conversations.rows[0].count,
    messages: messages.rows[0].count
  };
}

async function incrementTokenVersion(userId) {
  const db = getPool();
  const result = await db.query(
    `update v3_users
     set token_version = token_version + 1
     where user_id = $1
     returning user_id, username, display_name, is_admin, disabled, token_version`,
    [userId]
  );
  return result.rowCount > 0 ? mapUser(result.rows[0]) : null;
}

module.exports = {
  findByUsername,
  getById,
  getByIdWithHash,
  createUser,
  updateDisplayName,
  setPasswordHash,
  setDisabled,
  listUsers,
  adminListUsers,
  adminSummary,
  incrementTokenVersion,
  cleanSeedData,
  deleteUser
};
