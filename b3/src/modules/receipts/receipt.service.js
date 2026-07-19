const chatAdapter = require('../../db/chatAdapter');

async function markDelivered(user, chatId, messageId) {
  const result = await chatAdapter.markDelivered(user, chatId, messageId);
  if (!result) {
    const error = new Error('Message not found');
    error.status = 404;
    throw error;
  }
  return result;
}

async function markRead(user, chatId, messageId) {
  const result = await chatAdapter.markRead(user, chatId, messageId);
  if (!result) {
    const error = new Error('Message not found');
    error.status = 404;
    throw error;
  }
  return result;
}

async function markChatRead(user, chatId) {
  const result = await chatAdapter.markChatRead(user, chatId);
  if (!result) {
    const error = new Error('Chat not found');
    error.status = 404;
    throw error;
  }
  return result;
}

module.exports = {
  markDelivered,
  markRead,
  markChatRead
};
