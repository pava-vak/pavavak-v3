const { env } = require('../../config/env');
const demoStore = require('../../shared/demoChatStore');
const dbRepo = require('../../db/chat.repository');
async function listChatsForUser(user) {
  if (!env.DATABASE_URL) {
    return demoStore.listChatsForUser(user);
  }
  return dbRepo.listChatsForUser(user);
}
module.exports = { listChatsForUser };
