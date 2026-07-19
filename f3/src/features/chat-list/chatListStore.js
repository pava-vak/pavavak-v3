import { requestChats } from '../../shared/apiClient.js';

export function createChatListStore() {
  let state = {
    status: 'idle',
    items: [],
    error: ''
  };

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

  async function load() {
    setState({ status: 'loading', error: '' });
    try {
      const result = await requestChats();
      setState({
        status: 'ready',
        items: result.items || [],
        error: ''
      });
    } catch (error) {
      setState({
        status: 'error',
        items: [],
        error: error.message || 'Failed to load chats'
      });
    }
  }

  function applyOutgoingMessage(chatId, message) {
    const chat = state.items.find((item) => item.chatId === chatId);
    if (!chat) return;

    const updated = {
      ...chat,
      unreadCount: 0,
      lastMessage: {
        messageId: message.messageId,
        text: message.text,
        sentAt: message.sentAt,
        direction: message.direction,
        status: message.status
      }
    };

    setState({
      items: [updated, ...state.items.filter((item) => item.chatId !== chatId)]
    });
  }

  function applyChatUpdated(payload) {
    const chat = state.items.find((item) => item.chatId === payload.chatId);
    if (!chat) {
      load();
      return;
    }

    let unreadCount = payload.unreadCount ?? chat.unreadCount;
    if (payload.incrementUnread && payload.chatId !== payload.activeChatId) {
      unreadCount = (chat.unreadCount || 0) + 1;
    }

    const updated = {
      ...chat,
      unreadCount,
      lastMessage: payload.lastMessage || chat.lastMessage
    };

    setState({
      items: [updated, ...state.items.filter((item) => item.chatId !== payload.chatId)]
    });
  }

  function applyChatRead(chatId) {
    const chat = state.items.find((item) => item.chatId === chatId);
    if (!chat) return;

    const updated = {
      ...chat,
      unreadCount: 0,
      lastMessage: chat.lastMessage
        ? { ...chat.lastMessage, status: chat.lastMessage.direction === 'incoming' ? 'read' : chat.lastMessage.status }
        : chat.lastMessage
    };

    setState({
      items: state.items.map((item) => (item.chatId === chatId ? updated : item))
    });
  }

  function applyMessageStatus(chatId, messageId, status) {
    const chat = state.items.find((item) => item.chatId === chatId);
    if (!chat || chat.lastMessage?.messageId !== messageId) return;

    setState({
      items: state.items.map((item) =>
        item.chatId === chatId
          ? {
              ...item,
              lastMessage: {
                ...item.lastMessage,
                status
              }
            }
          : item
      )
    });
  }

  function reset() {
    setState({
      status: 'idle',
      items: [],
      error: ''
    });
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      listener(state);
      return () => listeners.delete(listener);
    },
    load,
    applyOutgoingMessage,
    applyChatUpdated,
    applyChatRead,
    applyMessageStatus,
    reset,
    getState() {
      return state;
    }
  };
}
