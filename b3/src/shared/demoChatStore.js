const { createSeedState } = require('./chatSeed');

const identity = require('./demoIdentityStore');

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

function userFromId(userId) {
  return identity.getByIdSync(userId) || {
    userId: Number(userId),
    username: `user-${userId}`,
    displayName: `User ${userId}`,
    isAdmin: false
  };
}

function inferredDirectMemberId(chatId) {
  const legacyMatch = String(chatId).match(/^direct::(\d+)$/);
  if (legacyMatch) return Number(legacyMatch[1]);
  const pairMatch = String(chatId).match(/^direct::(\d+):(\d+)$/);
  return pairMatch ? [Number(pairMatch[1]), Number(pairMatch[2])] : null;
}

function knownMemberIds(chatId) {
  const memberIds = [];
  for (const [userId, store] of stores.entries()) {
    if (store.chats.some((chat) => chat.chatId === chatId)) {
      memberIds.push(Number(userId));
    }
  }

  const inferred = inferredDirectMemberId(chatId);
  const inferredIds = Array.isArray(inferred) ? inferred : inferred ? [inferred] : [];
  for (const directMemberId of inferredIds) {
    if (!memberIds.includes(directMemberId)) {
      memberIds.push(directMemberId);
    }
  }

  return memberIds;
}

function ensureChatForUser(userId, chatId, fallbackTitle) {
  const store = getUserStore(userFromId(userId));
  let chat = store.chats.find((item) => item.chatId === chatId);
  if (!chat) {
    chat = {
      chatId,
      chatType: chatId.startsWith('channel::') ? 'channel' : 'direct',
      title: fallbackTitle || `Chat ${chatId}`,
      subtitle: '',
      avatarText: (fallbackTitle || 'C').slice(0, 1).toUpperCase(),
      unreadCount: 0,
      muted: false,
      lastMessage: null
    };
    store.chats.push(chat);
    store.messagesByChatId[chatId] = [];
  }
  return { store, chat };
}

function directChatId(firstUserId, secondUserId) {
  const ids = [Number(firstUserId), Number(secondUserId)].sort((a, b) => a - b);
  return `direct::${ids[0]}:${ids[1]}`;
}

function createDirectConversation(user, otherUserId) {
  if (Number(otherUserId) === Number(user.userId)) {
    const error = new Error('Cannot start a chat with yourself');
    error.status = 400;
    throw error;
  }

  const otherUser = userFromId(otherUserId);
  const chatId = directChatId(user.userId, otherUser.userId);

  const own = ensureChatForUser(user.userId, chatId, otherUser.displayName);
  own.chat.title = otherUser.displayName;
  own.chat.subtitle = `@${otherUser.username}`;
  own.chat.avatarText = otherUser.displayName.slice(0, 1).toUpperCase();

  const peer = ensureChatForUser(otherUser.userId, chatId, user.displayName);
  peer.chat.title = user.displayName;
  peer.chat.subtitle = `@${user.username}`;
  peer.chat.avatarText = user.displayName.slice(0, 1).toUpperCase();

  return clone(own.chat);
}

function findOutgoingMessageOwner(chatId, messageId) {
  for (const [userId, store] of stores.entries()) {
    const messages = store.messagesByChatId[chatId] || [];
    if (messages.some((item) => item.messageId === messageId && item.direction === 'outgoing')) {
      return Number(userId);
    }
  }
  return null;
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

function appendOutgoingMessage(user, chatId, text, messageId = null) {
  const store = getUserStore(user);
  const chat = store.chats.find((item) => item.chatId === chatId);
  if (!chat) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }

  store.sequence += 1;
  const resolvedMessageId = messageId || `m-${store.sequence}`;
  const message = {
    messageId: resolvedMessageId,
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

  const memberIds = knownMemberIds(chatId);
  for (const memberId of memberIds) {
    if (memberId === user.userId) continue;

    const { store: recipientStore, chat: recipientChat } = ensureChatForUser(memberId, chatId, user.displayName);
    if (!recipientStore.messagesByChatId[chatId]) {
      recipientStore.messagesByChatId[chatId] = [];
    }
    if (recipientStore.messagesByChatId[chatId].some((item) => item.messageId === message.messageId)) {
      continue;
    }

    const incomingMessage = {
      ...message,
      direction: 'incoming',
      senderDisplayName: user.displayName,
      status: 'sent'
    };
    recipientStore.messagesByChatId[chatId].push(incomingMessage);
    recipientChat.lastMessage = {
      messageId: incomingMessage.messageId,
      text: incomingMessage.text,
      sentAt: incomingMessage.sentAt,
      direction: incomingMessage.direction,
      status: incomingMessage.status
    };
    recipientChat.unreadCount += 1;
    recipientStore.chats = [recipientChat, ...recipientStore.chats.filter((item) => item.chatId !== chatId)];
  }

  return clone(message);
}

function markDelivered(user, chatId, messageId) {
  const store = getUserStore(user);
  const messages = store.messagesByChatId[chatId] || [];
  const message = messages.find((item) => item.messageId === messageId);
  if (!message) return null;
  if (message.direction === 'incoming' && message.status === 'sent') {
    message.status = 'delivered';
  }
  const senderUserId = findOutgoingMessageOwner(chatId, messageId);
  if (senderUserId) {
    const senderStore = getUserStore(userFromId(senderUserId));
    const senderMessage = (senderStore.messagesByChatId[chatId] || []).find((item) => item.messageId === messageId);
    if (senderMessage && senderMessage.status === 'sent') {
      senderMessage.status = 'delivered';
    }
    const senderChat = senderStore.chats.find((item) => item.chatId === chatId);
    if (senderChat?.lastMessage?.messageId === messageId && senderChat.lastMessage.status === 'sent') {
      senderChat.lastMessage.status = 'delivered';
    }
  }
  return clone({ messageId: message.messageId, status: message.status, senderUserId });
}

function markRead(user, chatId, messageId) {
  const store = getUserStore(user);
  const chat = store.chats.find((item) => item.chatId === chatId);
  const messages = store.messagesByChatId[chatId] || [];
  const message = messages.find((item) => item.messageId === messageId);
  if (!message) return null;
  if (message.status !== 'read') {
    message.status = 'read';
  }
  const senderUserId = findOutgoingMessageOwner(chatId, messageId);
  if (senderUserId) {
    const senderStore = getUserStore(userFromId(senderUserId));
    const senderMessage = (senderStore.messagesByChatId[chatId] || []).find((item) => item.messageId === messageId);
    if (senderMessage) {
      senderMessage.status = 'read';
    }
    const senderChat = senderStore.chats.find((item) => item.chatId === chatId);
    if (senderChat?.lastMessage?.messageId === messageId) {
      senderChat.lastMessage.status = 'read';
    }
  }
  const unreadCount = messages.filter(
    (item) => item.direction === 'incoming' && item.status !== 'read'
  ).length;
  if (chat) {
    chat.unreadCount = unreadCount;
  }
  return clone({ messageId: message.messageId, status: message.status, unreadCount, senderUserId });
}

function markChatRead(user, chatId) {
  const store = getUserStore(user);
  const chat = store.chats.find((item) => item.chatId === chatId);
  if (!chat) return null;

  const messages = store.messagesByChatId[chatId] || [];
  const updatedMessageIds = [];
  const updatedReceipts = [];
  for (const message of messages) {
    if (message.direction === 'incoming' && message.status !== 'read') {
      message.status = 'read';
      updatedMessageIds.push(message.messageId);
      const senderUserId = findOutgoingMessageOwner(chatId, message.messageId);
      updatedReceipts.push({
        messageId: message.messageId,
        senderUserId
      });
      if (senderUserId) {
        const senderStore = getUserStore(userFromId(senderUserId));
        const senderMessage = (senderStore.messagesByChatId[chatId] || []).find((item) => item.messageId === message.messageId);
        if (senderMessage) {
          senderMessage.status = 'read';
        }
      }
    }
  }
  chat.unreadCount = 0;

  return clone({
    updatedMessageIds,
    updatedReceipts,
    lastMessage: chat.lastMessage || null
  });
}

function userHasAccess(user, chatId) {
  const store = getUserStore(user);
  return store.chats.some((chat) => chat.chatId === chatId);
}

function getConversationMemberUserIds(chatId) {
  return knownMemberIds(chatId);
}

function listAllChats() {
  const chatMap = new Map();
  for (const [userId, store] of stores.entries()) {
    for (const chat of store.chats) {
      if (!chatMap.has(chat.chatId)) {
        chatMap.set(chat.chatId, {
          chatId: chat.chatId,
          participants: [],
          lastMessage: chat.lastMessage ? clone(chat.lastMessage) : null,
          lastSentAt: chat.lastMessage?.sentAt || null
        });
      }
      const entry = chatMap.get(chat.chatId);
      const user = userFromId(Number(userId));
      if (!entry.participants.find((p) => p.userId === Number(userId))) {
        entry.participants.push({
          userId: Number(userId),
          displayName: user.displayName,
          username: user.username
        });
      }
      if (
        chat.lastMessage?.sentAt &&
        (!entry.lastSentAt || new Date(chat.lastMessage.sentAt) > new Date(entry.lastSentAt))
      ) {
        entry.lastMessage = clone(chat.lastMessage);
        entry.lastSentAt = chat.lastMessage.sentAt;
      }
    }
  }
  return clone(
    [...chatMap.values()].sort((a, b) => new Date(b.lastSentAt || 0) - new Date(a.lastSentAt || 0))
  );
}

function adminListMessagesForChat(chatId, cursor = null, limit = 50) {
  const msgMap = new Map();
  for (const store of stores.values()) {
    const messages = store.messagesByChatId[chatId] || [];
    for (const msg of messages) {
      if (!msgMap.has(msg.messageId) || msg.direction === 'outgoing') {
        msgMap.set(msg.messageId, { ...msg, direction: 'incoming' });
      }
    }
  }

  const allMessages = [...msgMap.values()].sort((a, b) => new Date(a.sentAt) - new Date(b.sentAt));

  let endIndex = allMessages.length;
  if (cursor) {
    const cursorIndex = allMessages.findIndex((m) => m.messageId === cursor);
    endIndex = cursorIndex >= 0 ? cursorIndex : allMessages.length;
  }

  const startIndex = Math.max(0, endIndex - limit);
  const items = allMessages.slice(startIndex, endIndex);
  const nextCursor = startIndex > 0 ? allMessages[startIndex].messageId : null;

  return {
    items: clone(items),
    nextCursor,
    hasMore: startIndex > 0
  };
}

module.exports = {
  listChatsForUser,
  listMessagesForChat,
  appendOutgoingMessage,
  markDelivered,
  markRead,
  markChatRead,
  userHasAccess,
  getConversationMemberUserIds,
  createDirectConversation,
  listAllChats,
  adminListMessagesForChat
};
