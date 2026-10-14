import { markChatRead, markDelivered, openViewOnceMessage, requestAdminThread, requestClearChat, requestDeleteMessage, requestThread, sendMessage } from '../../shared/apiClient.js';
import { emitTypingStart, emitTypingStop, joinChat } from '../../shared/socketClient.js';
import { createStore } from '../../shared/createStore.js';

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
  let lastTypingEmit = 0;

  const { emit, subscribe } = createStore(() => state);

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
    if (typingTimer) { clearTimeout(typingTimer); typingTimer = null; }
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

      // markChatRead is best-effort — a failure must NOT reset the loaded thread
      (async () => {
        try {
          await markChatRead(chatId);
          if (generation !== openGeneration) return;
          setState({
            items: state.items.map((item) =>
              item.direction === 'incoming' ? { ...item, status: 'read' } : item
            )
          });
        } catch { /* ignored */ }
      })();

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
        nextCursor: result.page?.nextCursor || null,
        hasMore: Boolean(result.page?.hasMore),
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

    const chatIdAtStart = state.chatId;
    const cursorAtStart = state.nextCursor;
    setState({ loadMoreStatus: 'loading' });
    try {
      const result = await requestThread(chatIdAtStart, cursorAtStart);
      // Abort if user switched to a different chat while we were loading
      if (state.chatId !== chatIdAtStart) return;
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
        loadMoreStatus: 'error'
        // Note: do NOT write to sendError here — that field is for the composer
      });
    }
  }

  async function submitMessage(text) {
    const trimmedText = String(text || '').trim();
    if (!state.chatId || !trimmedText) return null;
    if (state.sendStatus === 'sending') return null;

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
      const now = Date.now();
      if (now - lastTypingEmit > 800) {
        emitTypingStart(state.chatId);
        lastTypingEmit = now;
      }
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
        // markChatRead already sets delivered_at, so no need for a separate markDelivered call
        markChatRead(state.chatId).catch(() => {});
        updateMessageStatus(payload.message.messageId, 'read');
      }
      return;
    }

    if (event === 'message:deleted') {
      setState({
        items: state.items.map((item) =>
          item.messageId === payload.messageId ? { ...item, deleted: true, text: '' } : item
        )
      });
      return;
    }

    if (event === 'message:delivered' || event === 'message:read') {
      updateMessageStatus(payload.messageId, payload.status);
      return;
    }

    if (event === 'message:edited' && payload.messageId && payload.text) {
      setState({
        items: state.items.map(item =>
          item.messageId === payload.messageId
            ? { ...item, text: payload.text, editedAt: payload.editedAt || new Date().toISOString() }
            : item
        )
      });
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
      return;
    }

    if (event === 'poll:voted' && payload.messageId && payload.votes) {
      setState({
        items: state.items.map(item =>
          item.messageId === payload.messageId
            ? { ...item, poll: item.poll ? { ...item.poll, votes: payload.votes } : item.poll }
            : item
        )
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

  async function deleteMessage(messageId) {
    await requestDeleteMessage(messageId);
    setState({
      items: state.items.map((m) =>
        m.messageId === messageId ? { ...m, deleted: true, text: '' } : m
      )
    });
  }

  async function clearChat() {
    if (!state.chatId) return;
    await requestClearChat(state.chatId);
    setState({ items: [], nextCursor: null, hasMore: false });
  }

  function reset() {
    openGeneration += 1;
    lastTypingEmit = 0;
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
    subscribe,
    openChat,
    openAdminChat,
    loadMore,
    submitMessage,
    deleteMessage,
    clearChat,
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
