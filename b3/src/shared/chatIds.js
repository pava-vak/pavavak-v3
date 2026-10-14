function directChatId(firstUserId, secondUserId) {
  const [lo, hi] = [Number(firstUserId), Number(secondUserId)].sort((a, b) => a - b);
  return `direct::${lo}:${hi}`;
}

module.exports = { directChatId };
