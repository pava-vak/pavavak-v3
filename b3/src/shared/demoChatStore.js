const { createSeedState } = require('./chatSeed');

const stores = new Map();

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function getUserStore(user) {
  const key = String(user.userId);
  if (!stores.has(key)) {
    stores.set(key, {
      ...createSeedState(user),
      sequence: 1000
    });
  }
  return stores.get(key);
}

function listChatsForUser(user) {
  const store = getUserStore(user);
  return clone(store.chats).sort(
    (a, b) => new Date(b.lastMessage?.sentAt || 0) - new Date(a.lastMessage?.sentAt || 0)
  );
}

function listMessagesForChat(user, chatId, cursor = null, limit = 20) {
  const store = getUserStore(user);
  const messages = store.messagesByChatId[chatId] || [];

  let endIndex = messages.length;
  if (cursor) {
    const cursorIndex = messages.findIndex((message) => message.messageId === cursor);
    endIndex = cursorIndex >= 0 ? cursorIndex : messages.length;
  }

  const startIndex = Math.max(0, endIndex - limit);
  const items = messages.slice(startIndex, endIndex);
  const nextCursor = startIndex > 0 ? messages[startIndex].messageId : null;

  return {
    items: clone(items),
    nextCursor,
    hasMore: startIndex > 0
  };
}

function appendOutgoingMessage(user, chatId, text) {
  const store = getUserStore(user);
  const chat = store.chats.find((item) => item.chatId === chatId);
  if (!chat) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  store.sequence += 1;
  const messageId = `m-${store.sequence}`;
  const message = {
    messageId,
    direction: 'outgoing',
    senderDisplayName: user.displayName,
    text,
    sentAt: new Date().toISOString(),
    status: 'sent'
  };

  if (!store.messagesByChatId[chatId]) {
    store.messagesByChatId[chatId] = [];
  }

  store.messagesByChatId[chatId].push(message);
  chat.lastMessage = {
    messageId: message.messageId,
    text: message.text,
    sentAt: message.sentAt,
    direction: message.direction,
    status: message.status
  };
  chat.unreadCount = 0;
  store.chats = [chat, ...store.chats.filter((item) => item.chatId !== chatId)];

  return clone(message);
}

module.exports = {
  listChatsForUser,
  listMessagesForChat,
  appendOutgoingMessage
};
