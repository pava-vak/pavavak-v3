import { escapeHtml } from '../shared/html.js';
import { createSessionStore } from '../features/session/sessionStore.js';
import { bindLoginView, renderLoginView } from '../features/session/loginView.js';
import { createChatListStore } from '../features/chat-list/chatListStore.js';
import { bindChatListView, renderChatListView } from '../features/chat-list/chatListView.js';
import { createChatThreadStore } from '../features/chat-thread/chatThreadStore.js';
import { bindChatThreadView, renderChatThreadView } from '../features/chat-thread/chatThreadView.js';
import { createPeopleStore } from '../features/people/peopleStore.js';
import { bindPeopleView, renderPeopleView } from '../features/people/peopleView.js';
import { createAdminStore } from '../features/admin/adminStore.js';
import { bindAdminView, renderAdminView } from '../features/admin/adminView.js';
import { renderSettingsModal, bindSettingsModal } from '../features/settings/settingsView.js';
import { subscribeSocket, getSocketStatus } from '../shared/socketClient.js';
import { config } from '../shared/config.js';
import { getActiveTheme, setTheme } from '../shared/themeStore.js';
import { initPush, unsubscribePush } from '../shared/pushClient.js';

function renderAuthenticatedView(user, chatState, peopleState, adminState, activeChat, threadState, composerValue = '', isMonitoring = false, viewOnce = false, deleteAfter = 'never') {
  const socketStatus = getSocketStatus();
  const avatarLetter = escapeHtml((user.displayName || user.username || '?').slice(0, 1).toUpperCase());
  return `
    <div class="app-shell ${activeChat ? 'thread-open' : ''}">
      <aside class="chat-sidebar">
        <div class="sidebar-topbar">
          <div class="sidebar-topbar-avatar">${avatarLetter}</div>
          <div class="sidebar-topbar-info">
            <span class="sidebar-topbar-name">${escapeHtml(user.displayName)}</span>
            <span class="sidebar-topbar-handle">@${escapeHtml(user.username)}</span>
          </div>
          <div class="sidebar-topbar-actions">
            <span class="sidebar-conn-dot ${socketStatus}" title="${socketStatus}"></span>
            <button class="sidebar-icon-btn" data-role="open-settings" title="Settings" aria-label="Settings">⚙</button>
            <button class="sidebar-icon-btn" data-role="sign-out" title="Sign out" aria-label="Sign out">✕</button>
          </div>
        </div>
        <div class="sidebar-body">
          ${renderChatListView(chatState, activeChat?.chatId)}
          ${renderPeopleView(peopleState)}
          ${user.isAdmin ? renderAdminView(adminState) : ''}
        </div>
      </aside>
      <main class="thread-area">
        ${renderChatThreadView({ activeChat, threadState, composerValue, readOnly: isMonitoring, viewOnce, deleteAfter })}
      </main>
    </div>
  `;
}

function renderLoadingShell() {
  return `
    <section class="auth-card">
      <p class="eyebrow">PaVa-V3</p>
      <h1>Restoring session...</h1>
      <p class="muted">Checking your saved credentials.</p>
    </section>
  `;
}

export function renderAppShell(root) {
  const sessionStore = createSessionStore();
  const chatListStore = createChatListStore();
  const chatThreadStore = createChatThreadStore();
  const peopleStore = createPeopleStore();
  const adminStore = createAdminStore();

  let sessionState = sessionStore.getState();
  let chatState = chatListStore.getState();
  let threadState = chatThreadStore.getState();
  let peopleState = peopleStore.getState();
  let adminState = adminStore.getState();
  let activeChat = null;
  let isMonitoring = false;
  let settingsOpen = false;

  function captureComposerState() {
    const input = root.querySelector('[data-role="composer-input"]');
    if (!input) {
      return { value: '', hadFocus: false, selectionStart: 0, selectionEnd: 0 };
    }

    return {
      value: input.value,
      hadFocus: document.activeElement === input,
      selectionStart: input.selectionStart ?? input.value.length,
      selectionEnd: input.selectionEnd ?? input.value.length
    };
  }

  function restoreComposerState(snapshot) {
    if (!snapshot) return;
    const input = root.querySelector('[data-role="composer-input"]');
    if (!input) return;

    input.value = snapshot.value;
    if (snapshot.hadFocus) {
      input.focus();
      try {
        input.setSelectionRange(snapshot.selectionStart, snapshot.selectionEnd);
      } catch {
        // ignore selection restore issues
      }
    }
  }

  function scrollThreadToBottom() {
    const container = root.querySelector('[data-role="thread-messages"]');
    if (container) {
      container.scrollTop = container.scrollHeight;
    }
  }

  function syncChatLoading() {
    if (sessionState.status === 'authenticated' && sessionState.user) {
      chatListStore.load();
      peopleStore.search('');
      if (sessionState.user.isAdmin) {
        adminStore.load();
      }
    } else {
      chatListStore.reset();
      chatThreadStore.reset();
      peopleStore.reset();
      adminStore.reset();
      activeChat = null;
    }
  }

  function openChat(chatId) {
    isMonitoring = false;
    activeChat = chatState.items.find((item) => item.chatId === chatId) || null;
    chatThreadStore.openChat(chatId).then(() => {
      chatListStore.applyChatRead(chatId);
    });
    render();
  }

  function openMonitorChat({ chatId, title, avatarText }) {
    isMonitoring = true;
    activeChat = { chatId, title, avatarText, subtitle: 'Monitored conversation' };
    chatThreadStore.openAdminChat(chatId);
    render();
  }

  async function handleSendMessage(text) {
    const message = await chatThreadStore.submitMessage(text);
    if (message && activeChat) {
      chatListStore.applyOutgoingMessage(activeChat.chatId, message);
    }
  }

  async function handleStartChat(userId) {
    try {
      const chat = await peopleStore.startChat(userId);
      await chatListStore.load();
      activeChat = chat;
      chatThreadStore.openChat(chat.chatId).then(() => {
        chatListStore.applyChatRead(chat.chatId);
      });
    } catch (error) {
      // Surface start-chat errors through the people search panel.
      await peopleStore.search(peopleState.query || '');
    }
  }

  function render() {
    const composerSnapshot = captureComposerState();

    if (sessionState.status === 'loading') {
      root.innerHTML = renderLoadingShell();
      return;
    }

    if (sessionState.status === 'authenticated' && sessionState.user) {
      const { viewOnce, deleteAfter } = chatThreadStore.getState();
      root.innerHTML = renderAuthenticatedView(
        sessionState.user,
        chatState,
        peopleState,
        adminState,
        activeChat,
        threadState,
        composerSnapshot.value,
        isMonitoring,
        viewOnce,
        deleteAfter
      ) + (settingsOpen ? renderSettingsModal() : '');
      root.querySelector('[data-role="sign-out"]')?.addEventListener('click', () => {
        sessionStore.signOut();
      });
      root.querySelector('[data-role="open-settings"]')?.addEventListener('click', () => {
        settingsOpen = true;
        render();
      });
      if (settingsOpen) {
        bindSettingsModal(root, {
          onClose: () => { settingsOpen = false; render(); }
        });
      }
      bindChatListView(root, {
        onOpenChat: openChat,
        onRetry: () => chatListStore.load()
      });
      bindChatThreadView(root, {
        onSubmit: handleSendMessage,
        onTyping: (action) => chatThreadStore.notifyTyping(action),
        onLoadMore: () => chatThreadStore.loadMore(),
        onRetry: () => activeChat && chatThreadStore.openChat(activeChat.chatId),
        onBack: () => {
          activeChat = null;
          isMonitoring = false;
          render();
        },
        onOpenViewOnce: (messageId) => chatThreadStore.openViewOnce(messageId),
        onToggleViewOnce: () => chatThreadStore.setViewOnce(!chatThreadStore.getState().viewOnce),
        onSetDeleteAfter: (value) => chatThreadStore.setDeleteAfter(value)
      });
      bindPeopleView(root, {
        onSearch: (query) => peopleStore.search(query),
        onStartChat: handleStartChat
      });
      bindAdminView(root, {
        onRefresh: () => adminStore.load(),
        onTabChange: (tab) => adminStore.setTab(tab),
        onOpenMonitorChat: openMonitorChat,
        onResetPassword: (userId) => adminStore.resetPassword(userId),
        onClearOtp: () => adminStore.clearOtp()
      });
      restoreComposerState(composerSnapshot);
      scrollThreadToBottom();
      return;
    }

    root.innerHTML = renderLoginView({
      state: sessionState,
      appEnv: config.appEnv,
      activeThemeId: getActiveTheme()
    });
    bindLoginView(root, {
      onLogin: sessionStore.loginWithPassword,
      onRegister: sessionStore.registerAccount,
      onQuickLogin: sessionStore.loginAsDev,
      onSelectTheme: (themeId) => {
        setTheme(themeId);
        render();
      }
    });
  }

  subscribeSocket((event, payload) => {
    chatThreadStore.handleSocketEvent(event, payload);
    if (event === 'chat:updated') {
      chatListStore.applyChatUpdated(payload);
    }
    if (event === 'message:new' && payload.chatId) {
      const isActiveChat = payload.chatId === threadState.chatId;
      chatListStore.applyChatUpdated({
        chatId: payload.chatId,
        lastMessage: payload.message,
        unreadCount: isActiveChat ? 0 : undefined,
        incrementUnread: !isActiveChat && payload.message?.direction === 'incoming',
        activeChatId: threadState.chatId
      });
    }
    if ((event === 'message:delivered' || event === 'message:read') && payload.chatId) {
      chatListStore.applyMessageStatus(payload.chatId, payload.messageId, payload.status);
    }
  });

  // Handle notification tap → open the correct chat
  window.addEventListener('pava:open-chat', (event) => {
    const { chatId } = event.detail || {};
    if (chatId && chatState.items.length) openChat(chatId);
  });

  sessionStore.subscribe((state) => {
    const wasAuthenticated = sessionState.status === 'authenticated';
    const nowAuthenticated = state.status === 'authenticated' && !!state.user;
    const shouldLoadChats = nowAuthenticated && !wasAuthenticated;
    sessionState = state;
    render();
    if (shouldLoadChats) {
      syncChatLoading();
      initPush().catch(() => {});
    }
    if (state.status !== 'authenticated') {
      unsubscribePush().catch(() => {});
      activeChat = null;
      isMonitoring = false;
      chatState = chatListStore.getState();
      threadState = chatThreadStore.getState();
      peopleState = peopleStore.getState();
      adminState = adminStore.getState();
    }
  });

  chatListStore.subscribe((state) => {
    chatState = state;
    if (activeChat) {
      activeChat = state.items.find((item) => item.chatId === activeChat.chatId) || activeChat;
    }
    render();
  });

  chatThreadStore.subscribe((state) => {
    threadState = state;
    render();
  });

  peopleStore.subscribe((state) => {
    peopleState = state;
    render();
  });

  adminStore.subscribe((state) => {
    adminState = state;
    render();
  });

  sessionStore.bootstrap();
}
