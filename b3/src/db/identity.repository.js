const { getPool } = require('./pool');

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

async function setPasswordHash(userId, passwordHash) {
  const db = getPool();
  const result = await db.query(
    `update v3_users
     set password_hash = $2, token_version = token_version + 1
     where user_id = $1
       and user_id < 9000
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
     order by display_name asc, username asc
     limit $3`,
    [query, excludeUserId, limit]
  );
  return result.rows.map(mapUser);
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
  createUser,
  setPasswordHash,
  listUsers,
  adminSummary,
  incrementTokenVersion
};
