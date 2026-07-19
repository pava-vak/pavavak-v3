import { escapeHtml } from '../../shared/html.js';

function formatRelativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

function renderChatItem(item, activeChatId) {
  const activeClass = item.chatId === activeChatId ? 'chat-row-active' : '';
  return `
    <button class="chat-row ${activeClass}" type="button" data-chat-id="${escapeHtml(item.chatId)}">
      <span class="chat-avatar">${escapeHtml(item.avatarText || '?')}</span>
      <span class="chat-copy">
        <span class="chat-copy-top">
          <strong>${escapeHtml(item.title)}</strong>
          <small>${formatRelativeTime(item.lastMessage?.sentAt)}</small>
        </span>
        <span class="chat-copy-bottom">
          <span>${escapeHtml(item.lastMessage?.text || 'No messages yet')}</span>
          ${item.unreadCount ? `<span class="chat-unread">${escapeHtml(item.unreadCount)}</span>` : ''}
        </span>
      </span>
    </button>
  `;
}

export function renderChatListView(state, activeChatId = '') {
  if (state.status === 'loading') {
    return '<p class="sidebar-section-label" style="padding: 12px 16px; font-size: 13px; text-transform: none; letter-spacing: 0;">Loading chats…</p>';
  }

  if (state.status === 'error') {
    return `<div style="padding: 10px 16px;"><p class="error-text" style="margin: 0 0 8px;">${escapeHtml(state.error)}</p><button class="secondary-button" data-role="retry-chats">Retry</button></div>`;
  }

  if (!state.items.length) {
    return '<p style="padding: 10px 16px; margin: 0; color: var(--v3-muted); font-size: 13px;">No chats yet.</p>';
  }

  return `
    <div class="chat-list-panel">
      <div class="sidebar-section-label">Chats</div>
      <div class="chat-list-items">
        ${state.items.map((item) => renderChatItem(item, activeChatId)).join('')}
      </div>
    </div>
  `;
}

export function bindChatListView(root, { onOpenChat, onRetry }) {
  root.querySelector('[data-role="retry-chats"]')?.addEventListener('click', () => onRetry?.());
  root.querySelectorAll('[data-chat-id]').forEach((button) => {
    button.addEventListener('click', () => {
      onOpenChat(button.dataset.chatId);
    });
  });
}
