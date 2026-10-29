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

function messageForMember(sender, message, memberId, recipientText) {
  if (Number(memberId) === Number(sender.userId)) {
    return message;
  }
  return {
    ...message,
    ...(recipientText != null ? { text: recipientText } : {}),
    direction: 'incoming',
    senderId: Number(sender.userId),
    senderDisplayName: sender.displayName,
    status: 'sent'
  };
}

function emitMessageNewToMembers(sender, chatId, message, memberIds, recipientText = null) {
  for (const memberId of memberIds) {
    emitToUser(memberId, 'message:new', {
      chatId,
      message: messageForMember(sender, message, memberId, recipientText)
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

function emitMessageDeletedToMembers(chatId, messageId, memberIds) {
  for (const memberId of memberIds) {
    emitToUser(memberId, 'message:deleted', { chatId, messageId });
  }
}

function emitMessageEditedToMembers(chatId, messageId, text, editedAt, memberIds) {
  for (const memberId of memberIds) {
    emitToUser(memberId, 'message:edited', { chatId, messageId, text, editedAt });
  }
}

function emitReactionToMembers(chatId, messageId, userId, displayName, emoji, memberIds) {
  for (const memberId of memberIds) {
    emitToUser(memberId, 'message:reaction', { chatId, messageId, userId, displayName, emoji });
  }
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
  emitMessageDeletedToMembers,
  emitMessageEditedToMembers,
  emitReactionToMembers,
  messageForMember
};
