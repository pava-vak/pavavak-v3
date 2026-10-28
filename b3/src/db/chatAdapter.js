const crypto = require('crypto');
const { env } = require('../config/env');
const demoStore = require('../shared/demoChatStore');
const dbRepo = require('./chat.repository');
const normalizedRepo = require('./normalizedChat.repository');

function assertStorageConfigured() {
  if (env.CHAT_STORAGE_MODE !== 'legacy' && !env.DATABASE_URL) {
    throw new Error(`DATABASE_URL is required when CHAT_STORAGE_MODE=${env.CHAT_STORAGE_MODE}`);
  }
}

function useNormalized() {
  return env.DATABASE_URL && (env.CHAT_STORAGE_MODE === 'normalized' || env.CHAT_STORAGE_MODE === 'dual-write');
}

function useLegacyDb() {
  return env.DATABASE_URL && env.CHAT_STORAGE_MODE === 'legacy';
}

function getStore() {
  if (useNormalized()) {
    return normalizedRepo;
  }
  if (useLegacyDb()) {
    return dbRepo;
  }
  return demoStore;
}

async function listChatsForUser(user) {
  assertStorageConfigured();
  return getStore().listChatsForUser(user);
}

async function listMessagesForChat(params) {
  assertStorageConfigured();
  const store = getStore();
  if (useNormalized() || useLegacyDb()) {
    return store.listMessagesForChat(params);
  }
  return demoStore.listMessagesForChat(params.user, params.chatId, params.cursor, params.limit);
}

async function appendOutgoingMessage(user, chatId, text, flags = {}) {
  assertStorageConfigured();
  const messageId = `m-${crypto.randomUUID()}`;

  if (env.CHAT_STORAGE_MODE === 'dual-write' && env.DATABASE_URL) {
    const legacyMessage = await dbRepo.appendOutgoingMessage(user, chatId, text, messageId);
    const normalizedMessage = await normalizedRepo.appendOutgoingMessage(user, chatId, text, messageId, flags);
    return normalizedMessage || legacyMessage;
  }

  const store = getStore();
  if (useNormalized() || useLegacyDb()) {
    return store.appendOutgoingMessage(user, chatId, text, messageId, flags);
  }
  return demoStore.appendOutgoingMessage(user, chatId, text, messageId);
}

async function openViewOnceMessage(user, messageId) {
  assertStorageConfigured();
  const store = getStore();
  if (store.openViewOnceMessage) {
    return store.openViewOnceMessage(user, messageId);
  }
}

async function markDelivered(user, chatId, messageId) {
  assertStorageConfigured();
  if (env.CHAT_STORAGE_MODE === 'dual-write' && env.DATABASE_URL) {
    const [legacy, normalized] = await Promise.all([
      dbRepo.markDelivered(user, chatId, messageId),
      normalizedRepo.markDelivered(user, chatId, messageId)
    ]);
    return normalized ?? legacy;
  }
  return getStore().markDelivered(user, chatId, messageId);
}

async function markRead(user, chatId, messageId, opts = {}) {
  assertStorageConfigured();
  if (env.CHAT_STORAGE_MODE === 'dual-write' && env.DATABASE_URL) {
    const [legacy, normalized] = await Promise.all([
      dbRepo.markRead(user, chatId, messageId),
      normalizedRepo.markRead(user, chatId, messageId, opts)
    ]);
    return normalized ?? legacy;
  }
  return getStore().markRead(user, chatId, messageId, opts);
}

async function markChatRead(user, chatId, opts = {}) {
  assertStorageConfigured();
  if (env.CHAT_STORAGE_MODE === 'dual-write' && env.DATABASE_URL) {
    const [legacy, normalized] = await Promise.all([
      dbRepo.markChatRead(user, chatId),
      normalizedRepo.markChatRead(user, chatId, opts)
    ]);
    return normalized ?? legacy;
  }
  return getStore().markChatRead(user, chatId, opts);
}

async function listChatIdsForUser(user) {
  const chats = await listChatsForUser(user);
  return chats.map((chat) => chat.chatId);
}

async function userHasAccess(user, chatId) {
  assertStorageConfigured();
  const store = getStore();
  if (store.userHasAccess) {
    return store.userHasAccess(user, chatId);
  }
  const chats = await listChatsForUser(user);
  return chats.some((chat) => chat.chatId === chatId);
}

async function getConversationMemberUserIds(chatId) {
  assertStorageConfigured();
  const store = getStore();
  if (store.getConversationMemberUserIds) {
    return store.getConversationMemberUserIds(chatId);
  }
  return [];
}

async function createDirectConversation(user, otherUserId) {
  assertStorageConfigured();
  const store = getStore();
  if (!store.createDirectConversation) {
    const error = new Error('Direct chat creation is not supported by this storage mode');
    error.status = 501;
    throw error;
  }
  return store.createDirectConversation(user, otherUserId);
}

function groupStoreOrThrow() {
  const store = getStore();
  if (!store.createGroupConversation) {
    throw Object.assign(new Error('Groups are not supported by this storage mode'), { status: 501 });
  }
  return store;
}

async function createGroupConversation(user, opts) {
  assertStorageConfigured();
  return groupStoreOrThrow().createGroupConversation(user, opts);
}

async function getConversationDetail(user, chatId) {
  assertStorageConfigured();
  return groupStoreOrThrow().getConversationDetail(user, chatId);
}

async function addGroupMembers(user, chatId, memberIds) {
  assertStorageConfigured();
  return groupStoreOrThrow().addGroupMembers(user, chatId, memberIds);
}

async function removeGroupMember(user, chatId, targetUserId) {
  assertStorageConfigured();
  return groupStoreOrThrow().removeGroupMember(user, chatId, targetUserId);
}

async function leaveGroup(user, chatId) {
  assertStorageConfigured();
  return groupStoreOrThrow().leaveGroup(user, chatId);
}

async function renameGroup(user, chatId, title) {
  assertStorageConfigured();
  return groupStoreOrThrow().renameGroup(user, chatId, title);
}

async function setMemberRole(user, chatId, targetUserId, role) {
  assertStorageConfigured();
  return groupStoreOrThrow().setMemberRole(user, chatId, targetUserId, role);
}

async function listAllChats() {
  assertStorageConfigured();
  const store = getStore();
  if (store.listAllChats) {
    return store.listAllChats();
  }
  return [];
}

async function adminListMessagesForChat(chatId, cursor = null, limit = 50) {
  assertStorageConfigured();
  const store = getStore();
  if (store.adminListMessagesForChat) {
    return store.adminListMessagesForChat(chatId, cursor, limit);
  }
  return { items: [], nextCursor: null, hasMore: false };
}

async function deleteConversation(user, chatId) {
  assertStorageConfigured();
  return getStore().deleteConversation(user, chatId);
}

async function clearChatMessages(user, chatId) {
  assertStorageConfigured();
  return getStore().clearChatMessages(user, chatId);
}

async function deleteMessage(user, messageId) {
  assertStorageConfigured();
  return getStore().deleteMessage(user, messageId);
}

async function broadcastSystemUpdate(adminUserId) {
  assertStorageConfigured();
  const store = getStore();
  if (store.broadcastSystemUpdate) {
    return store.broadcastSystemUpdate(adminUserId);
  }
  return [];
}

module.exports = {
  listChatsForUser,
  listMessagesForChat,
  appendOutgoingMessage,
  openViewOnceMessage,
  markDelivered,
  markRead,
  markChatRead,
  listChatIdsForUser,
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
  broadcastSystemUpdate
};
