const { hashPassword } = require('./security/password.service');

const users = new Map();
let nextUserId = 10000;
let seedPromise = null;

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function publicUser(user) {
  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    isAdmin: Boolean(user.isAdmin),
    disabled: Boolean(user.disabled),
    tokenVersion: Number(user.tokenVersion || 0)
  };
}

async function seedUser({ userId, username, displayName, password, isAdmin = false }) {
  users.set(String(userId), {
    userId,
    username,
    displayName,
    isAdmin,
    disabled: false,
    tokenVersion: 0,
    passwordHash: await hashPassword(password)
  });
}

async function ensureSeeded() {
  if (users.size > 0 && !seedPromise) return;
  if (!seedPromise) {
    seedPromise = Promise.all([
      seedUser({ userId: 1, username: 'admin', displayName: 'Admin', password: 'admin123', isAdmin: true }),
      seedUser({ userId: 2, username: 'demo', displayName: 'Demo User', password: 'demo123' }),
      seedUser({ userId: 3, username: 'tester', displayName: 'Tester', password: 'tester123' }),
      seedUser({ userId: 101, username: 'nenu', displayName: 'Nenu Natho', password: 'nenu123' }),
      seedUser({ userId: 102, username: 'books', displayName: 'Books', password: 'books123' })
    ]);
  }
  await seedPromise;
  seedPromise = null;
}

async function findByUsername(username) {
  await ensureSeeded();
  const normalized = String(username || '').toLowerCase();
  for (const user of users.values()) {
    if (user.username.toLowerCase() === normalized) {
      return clone(user);
    }
  }
  return null;
}

async function getById(userId) {
  await ensureSeeded();
  const user = users.get(String(userId));
  return user ? clone(user) : null;
}

function getByIdSync(userId) {
  const user = users.get(String(userId));
  return user ? clone(user) : null;
}

async function ensureUser(user) {
  await ensureSeeded();
  if (!users.has(String(user.userId))) {
    users.set(String(user.userId), {
      userId: user.userId,
      username: user.username,
      displayName: user.displayName,
      isAdmin: Boolean(user.isAdmin),
      disabled: false,
      tokenVersion: Number(user.tokenVersion || 0),
      passwordHash: await hashPassword(`dev-${user.userId}`)
    });
  }
  return publicUser(users.get(String(user.userId)));
}

async function createUser({ username, displayName, passwordHash, isAdmin = false }) {
  await ensureSeeded();
  if (await findByUsername(username)) {
    const error = new Error('Username already exists');
    error.status = 409;
    throw error;
  }
  nextUserId += 1;
  const user = {
    userId: nextUserId,
    username,
    displayName,
    isAdmin: Boolean(isAdmin),
    disabled: false,
    tokenVersion: 0,
    passwordHash
  };
  users.set(String(user.userId), user);
  return publicUser(user);
}

async function listUsers({ query = '', excludeUserId = null, limit = 25 } = {}) {
  await ensureSeeded();
  const normalized = String(query || '').toLowerCase();
  return Array.from(users.values())
    .filter((user) => !excludeUserId || user.userId !== Number(excludeUserId))
    .filter((user) =>
      !normalized ||
      user.username.toLowerCase().includes(normalized) ||
      user.displayName.toLowerCase().includes(normalized)
    )
    .sort((a, b) => a.displayName.localeCompare(b.displayName))
    .slice(0, limit)
    .map(publicUser);
}

async function adminSummary() {
  await ensureSeeded();
  return {
    users: users.size,
    conversations: 0,
    messages: 0
  };
}

async function incrementTokenVersion(userId) {
  await ensureSeeded();
  const user = users.get(String(userId));
  if (!user) return null;
  user.tokenVersion = Number(user.tokenVersion || 0) + 1;
  return publicUser(user);
}

async function setUserPatch(userId, patch) {
  await ensureSeeded();
  const user = users.get(String(userId));
  if (!user) return null;
  Object.assign(user, patch);
  return publicUser(user);
}

module.exports = {
  findByUsername,
  getById,
  getByIdSync,
  ensureUser,
  createUser,
  listUsers,
  adminSummary,
  incrementTokenVersion,
  setUserPatch
};
