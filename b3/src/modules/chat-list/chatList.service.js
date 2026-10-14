const chatAdapter = require('../../db/chatAdapter');

async function listChatsForUser(user) {
  return chatAdapter.listChatsForUser(user);
}

module.exports = { listChatsForUser };
