const { env } = require('../../config/env');
const demoStore = require('../../shared/demoChatStore');
const dbRepo = require('../../db/chat.repository');
async function listMessagesForChat({ user, chatId, cursor = null, limit = 20 }) {
  if (!env.DATABASE_URL) {
    return demoStore.listMessagesForChat(user, chatId, cursor, limit);
  }
  return dbRepo.listMessagesForChat({ user, chatId, cursor, limit });
}
module.exports = { listMessagesForChat };
