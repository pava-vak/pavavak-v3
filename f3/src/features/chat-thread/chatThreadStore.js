import { markChatRead, markDelivered, openViewOnceMessage, requestAdminThread, requestThread, sendMessage } from '../../shared/apiClient.js';
import { emitTypingStart, emitTypingStop, joinChat } from '../../shared/socketClient.js';

export function createChatThreadStore() {
  let state = {
    status: 'idle',
    chatId: '',
    items: [],
    error: '',
    nextCursor: null,
    hasMore: false,
    sendStatus: 'idle',
    sendError: '',
    typingUsers: [],
    loadMoreStatus: 'idle',
    viewOnce: false,
    deleteAfter: 'never'
  };

  let openGeneration = 0;
  let typingTimer = null;

  const listeners = new Set();

  function emit() {
    for (const listener of listeners) {
      listener(state);
    }
  }

  function setState(patch) {
    state = { ...state, ...patch };
    emit();
  }

  function appendMessageIfNew(message) {
    if (!message?.messageId) return;
    if (state.items.some((item) => item.messageId === message.messageId)) return;
    setState({ items: [...state.items, message] });
  }

  function updateMessageStatus(messageId, status) {
    setState({
      items: state.items.map((item) =>
        item.messageId === messageId ? { ...item, status } : item
      )
    });
  }

  function replaceOptimisticMessage(finalMessage, tempId) {
    const withoutTemp = state.items.filter((item) => item.messageId !== tempId);
    if (withoutTemp.some((item) => item.messageId === finalMessage.messageId)) {
      setState({ items: withoutTemp, sendStatus: 'idle', sendError: '' });
      return;
    }
    setState({
      items: [...withoutTemp, finalMessage],
      sendStatus: 'idle',
      sendError: ''
    });
  }

  async function openChat(chatId) {
    const generation = ++openGeneration;
    setState({
      status: 'loading',
      chatId,
      items: [],
      error: '',
      nextCursor: null,
      hasMore: false,
      sendStatus: 'idle',
      sendError: '',
      typingUsers: [],
      loadMoreStatus: 'idle'
    });

    joinChat(chatId);

    try {
      const result = await requestThread(chatId);
      if (generation !== openGeneration || state.chatId !== chatId) return;

      setState({
        status: 'ready',
        chatId,
        items: result.items || [],
        error: '',
        nextCursor: result.page?.nextCursor || null,
        hasMore: Boolean(result.page?.hasMore),
        sendStatus: 'idle',
        sendError: ''
      });

      await markChatRead(chatId);
      if (generation !== openGeneration) return;

      setState({
        items: state.items.map((item) =>
          item.direction === 'incoming' ? { ...item, status: 'read' } : item
        )
      });

      for (const item of result.items || []) {
        if (item.direction === 'incoming' && item.status === 'sent') {
          markDelivered(chatId, item.messageId).catch(() => {});
        }
      }
    } catch (error) {
      if (generation !== openGeneration) return;
      setState({
        status: 'error',
        chatId,
        items: [],
        error: error.message || 'Failed to load thread',
        nextCursor: null,
        hasMore: false,
        sendStatus: 'idle',
        sendError: ''
      });
    }
  }

  async function openAdminChat(chatId) {
    const generation = ++openGeneration;
    setState({
      status: 'loading',
      chatId,
      items: [],
      error: '',
      nextCursor: null,
      hasMore: false,
      sendStatus: 'idle',
      sendError: '',
      typingUsers: [],
      loadMoreStatus: 'idle'
    });

    try {
      const result = await requestAdminThread(chatId);
      if (generation !== openGeneration || state.chatId !== chatId) return;
      setState({
        status: 'ready',
        chatId,
        items: result.items || [],
        error: '',
        nextCursor: result.nextCursor || null,
        hasMore: Boolean(result.hasMore),
        sendStatus: 'idle',
        sendError: ''
      });
    } catch (error) {
      if (generation !== openGeneration) return;
      setState({
        status: 'error',
        chatId,
        items: [],
        error: error.message || 'Failed to load conversation',
        nextCursor: null,
        hasMore: false
      });
    }
  }

  async function loadMore() {
    if (!state.chatId || !state.hasMore || !state.nextCursor || state.loadMoreStatus === 'loading') {
      return;
    }

    setState({ loadMoreStatus: 'loading' });
    try {
      const result = await requestThread(state.chatId, state.nextCursor);
      const existingIds = new Set(state.items.map((item) => item.messageId));
      const older = (result.items || []).filter((item) => !existingIds.has(item.messageId));
      setState({
        items: [...older, ...state.items],
        nextCursor: result.page?.nextCursor || null,
        hasMore: Boolean(result.page?.hasMore),
        loadMoreStatus: 'idle'
      });
    } catch (error) {
      setState({
        loadMoreStatus: 'error',
        sendError: error.message || 'Failed to load older messages'
      });
    }
  }

  async function submitMessage(text) {
    const trimmedText = String(text || '').trim();
    if (!state.chatId || !trimmedText) return null;

    const tempId = `temp-${Date.now()}`;
    const optimisticMessage = {
      messageId: tempId,
      direction: 'outgoing',
      senderDisplayName: 'You',
      text: trimmedText,
      sentAt: new Date().toISOString(),
      status: 'sending'
    };

    setState({
      items: [...state.items, optimisticMessage],
      sendStatus: 'sending',
      sendError: ''
    });

    const { viewOnce, deleteAfter } = state;

    try {
      const result = await sendMessage({
        chatId: state.chatId,
        text: trimmedText,
        viewOnce,
        deleteAfter
      });
      replaceOptimisticMessage(result.message, tempId);
      setState({ viewOnce: false, deleteAfter: 'never' });
      return result.message;
    } catch (error) {
      setState({
        items: state.items.filter((item) => item.messageId !== tempId),
        sendStatus: 'error',
        sendError: error.message || 'Failed to send message'
      });
      return null;
    }
  }

  function notifyTyping(action) {
    if (!state.chatId) return;
    if (action === 'start') {
      emitTypingStart(state.chatId);
      if (typingTimer) clearTimeout(typingTimer);
      typingTimer = setTimeout(() => notifyTyping('stop'), 1200);
      return;
    }
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    emitTypingStop(state.chatId);
  }

  function handleSocketEvent(event, payload) {
    if (!payload?.chatId || payload.chatId !== state.chatId) {
      return;
    }

    if (event === 'message:new' && payload.message) {
      appendMessageIfNew(payload.message);
      if (payload.message.direction === 'incoming') {
        markDelivered(state.chatId, payload.message.messageId).catch(() => {});
        markChatRead(state.chatId).catch(() => {});
        updateMessageStatus(payload.message.messageId, 'read');
      }
      return;
    }

    if (event === 'message:delivered' || event === 'message:read') {
      updateMessageStatus(payload.messageId, payload.status);
      return;
    }

    if (event === 'typing:start') {
      const typingUsers = state.typingUsers.filter((user) => user.userId !== payload.userId);
      typingUsers.push({
        userId: payload.userId,
        displayName: payload.displayName
      });
      setState({ typingUsers });
      return;
    }

    if (event === 'typing:stop') {
      setState({
        typingUsers: state.typingUsers.filter((user) => user.userId !== payload.userId)
      });
    }
  }

  async function openViewOnce(messageId) {
    setState({
      items: state.items.map((item) =>
        item.messageId === messageId ? { ...item, viewOnceOpened: true } : item
      )
    });
    openViewOnceMessage(messageId).catch(() => {});
  }

  function setViewOnce(value) {
    setState({ viewOnce: Boolean(value) });
  }

  function setDeleteAfter(value) {
    setState({ deleteAfter: value });
  }

  function reset() {
    openGeneration += 1;
    if (typingTimer) {
      clearTimeout(typingTimer);
      typingTimer = null;
    }
    setState({
      status: 'idle',
      chatId: '',
      items: [],
      error: '',
      nextCursor: null,
      hasMore: false,
      sendStatus: 'idle',
      sendError: '',
      typingUsers: [],
      loadMoreStatus: 'idle',
      viewOnce: false,
      deleteAfter: 'never'
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    openChat,
    openAdminChat,
    loadMore,
    submitMessage,
    openViewOnce,
    setViewOnce,
    setDeleteAfter,
    notifyTyping,
    handleSocketEvent,
    reset,
    getState() {
      return state;
    }
  };
}
