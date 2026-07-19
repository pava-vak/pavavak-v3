const { env } = require('../config/env');
const dbIdentity = require('./identity.repository');
const demoIdentity = require('../shared/demoIdentityStore');

function useDatabase() {
  return Boolean(env.DATABASE_URL);
}

function store() {
  return useDatabase() ? dbIdentity : demoIdentity;
}

function publicUser(user) {
  if (!user) return null;
  return {
    userId: user.userId,
    username: user.username,
    displayName: user.displayName,
    isAdmin: Boolean(user.isAdmin)
  };
}

async function findByUsername(username) {
  return store().findByUsername(username);
}

async function getById(userId) {
  return store().getById ? store().getById(userId) : null;
}

async function createUser(input) {
  return publicUser(await store().createUser(input));
}

async function listUsers(input) {
  const users = await store().listUsers(input);
  return users.map(publicUser);
}

async function adminSummary() {
  return store().adminSummary();
}

async function ensureUser(user) {
  if (store().ensureUser) {
    return store().ensureUser(user);
  }
  return user;
}

async function incrementTokenVersion(userId) {
  if (!store().incrementTokenVersion) {
    return null;
  }
  return store().incrementTokenVersion(userId);
}

async function setPasswordHash(userId, passwordHash) {
  if (!store().setPasswordHash) {
    const err = new Error('Password reset not supported in this storage mode');
    err.status = 501;
    throw err;
  }
  return store().setPasswordHash(userId, passwordHash);
}

async function setDisabled(userId, disabled) {
  if (!store().setDisabled) {
    const err = new Error('Not supported in this storage mode');
    err.status = 501;
    throw err;
  }
  return store().setDisabled(userId, disabled);
}

async function getByIdWithHash(userId) {
  if (!store().getByIdWithHash) return null;
  return store().getByIdWithHash(userId);
}

async function adminListUsers(input) {
  if (!store().adminListUsers) {
    const users = await store().listUsers(input);
    return users.map((u) => ({ ...publicUser(u), disabled: Boolean(u.disabled) }));
  }
  const users = await store().adminListUsers(input);
  return users.map((u) => ({ ...publicUser(u), disabled: Boolean(u.disabled) }));
}

async function cleanSeedData() {
  if (!store().cleanSeedData) return;
  return store().cleanSeedData();
}

module.exports = {
  findByUsername,
  getById,
  getByIdWithHash,
  createUser,
  setPasswordHash,
  setDisabled,
  listUsers,
  adminListUsers,
  adminSummary,
  ensureUser,
  incrementTokenVersion,
  cleanSeedData,
  publicUser
};
