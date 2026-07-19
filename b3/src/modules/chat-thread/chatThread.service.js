const chatAdapter = require('../../db/chatAdapter');

async function listMessagesForChat({ user, chatId, cursor = null, limit = 20 }) {
  return chatAdapter.listMessagesForChat({ user, chatId, cursor, limit });
}

module.exports = { listMessagesForChat };
