const { env } = require('../../config/env');
const chatAdapter = require('../../db/chatAdapter');
const realtime = require('../../realtime/eventEmitter');

async function listChatsForUser(user) {
  return chatAdapter.listChatsForUser(user);
}

module.exports = { listChatsForUser };
