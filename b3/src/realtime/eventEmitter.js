let io = null;

function setIo(instance) {
  io = instance;
}

function emitToUser(userId, event, payload) {
  if (!io) return;
  io.to(`user:${userId}`).emit(event, payload);
}

function emitToUsers(userIds, event, payload) {
  if (!io) return;
  for (const userId of userIds) {
    emitToUser(userId, event, payload);
  }
}

function emitToChat(chatId, event, payload, exceptSocketId = null) {
  if (!io) return;
  const room = `chat:${chatId}`;
  if (exceptSocketId) {
    io.to(room).except(exceptSocketId).emit(event, payload);
    return;
  }
  io.to(room).emit(event, payload);
}

function messageForMember(sender, message, memberId) {
  if (memberId === sender.userId) {
    return message;
  }
  return {
    ...message,
    direction: 'incoming',
    senderDisplayName: sender.displayName,
    status: 'sent'
  };
}

function emitMessageNewToMembers(sender, chatId, message, memberIds) {
  for (const memberId of memberIds) {
    emitToUser(memberId, 'message:new', {
      chatId,
      message: messageForMember(sender, message, memberId)
    });
  }
}

function emitChatUpdatedToMembers(chatId, payload, memberIds) {
  for (const memberId of memberIds) {
    emitToUser(memberId, 'chat:updated', payload);
  }
}

function emitMessageNew(userId, payload) {
  emitToUser(userId, 'message:new', payload);
}

function emitChatUpdated(userId, payload) {
  emitToUser(userId, 'chat:updated', payload);
}

function emitMessageDelivered(userId, payload) {
  emitToUser(userId, 'message:delivered', payload);
}

function emitMessageRead(userId, payload) {
  emitToUser(userId, 'message:read', payload);
}

module.exports = {
  setIo,
  emitToUser,
  emitToUsers,
  emitToChat,
  emitMessageNew,
  emitMessageNewToMembers,
  emitChatUpdated,
  emitChatUpdatedToMembers,
  emitMessageDelivered,
  emitMessageRead,
  messageForMember
};
