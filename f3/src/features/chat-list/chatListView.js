import { escapeHtml, formatMessagePreview } from '../../shared/html.js';

function formatRelativeTime(value) {
  if (!value) return '';
  const date = new Date(value);
  const now = new Date();
  // Compare calendar dates in the device's local timezone
  const d    = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diffDays = Math.round((today - d) / 86_400_000);
  if (diffDays === 0) return date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit', hour12: true }).toLowerCase();
  if (diffDays === 1) return 'yesterday';
  if (diffDays < 7)  return date.toLocaleDateString(undefined, { weekday: 'short' });
  return date.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
}

function renderLastMsgTick(status) {
  if (status === 'read')      return '<span class="chat-tick chat-tick-read"><span>✓</span><span>✓</span></span>';
  if (status === 'delivered') return '<span class="chat-tick chat-tick-delivered"><span>✓</span><span>✓</span></span>';
  return '<span class="chat-tick chat-tick-sent">✓</span>';
}

function renderChatItem(item, activeChatId, onlineUserIds = new Set()) {
  const activeClass = item.chatId === activeChatId ? 'chat-row-active' : '';
  const isOutgoing = item.lastMessage?.direction === 'outgoing';
  const tick = isOutgoing ? renderLastMsgTick(item.lastMessage?.status) : '';
  const youLabel = isOutgoing ? '<span class="chat-you-label">You:</span>' : '';
  const mutedIcon = item.muted ? '<span class="chat-muted-icon" title="Muted">🔇</span>' : '';
  const archiveBtn = item.archived
    ? `<button class="chat-action-btn" data-role="unarchive-chat" data-chat-id="${escapeHtml(item.chatId)}" title="Unarchive">📤</button>`
    : `<button class="chat-action-btn" data-role="archive-chat" data-chat-id="${escapeHtml(item.chatId)}" title="Archive">📥</button>`;
  return `
    <div class="chat-row-wrap" data-chat-id="${escapeHtml(item.chatId)}">
      <button class="chat-row ${activeClass}" type="button" data-role="open-chat" data-chat-id="${escapeHtml(item.chatId)}">
        <span class="chat-avatar-wrap">
          <span class="chat-avatar">${escapeHtml(item.avatarText || '?')}</span>
          ${onlineUserIds.has(item.peerId) ? '<span class="online-dot"></span>' : ''}
        </span>
        <span class="chat-copy">
          <span class="chat-copy-top">
            <strong>${escapeHtml(item.title)}</strong>
            <span class="chat-copy-meta">${mutedIcon}${tick}<small>${formatRelativeTime(item.lastMessage?.sentAt)}</small></span>
          </span>
          <span class="chat-copy-bottom">
            <span class="chat-preview-text">${youLabel}${escapeHtml(formatMessagePreview(item.lastMessage?.text))}</span>
            ${item.unreadCount && !item.muted ? `<span class="chat-unread">${escapeHtml(String(item.unreadCount))}</span>` : ''}
            ${item.unreadCount && item.muted ? `<span class="chat-unread chat-unread-muted">${escapeHtml(String(item.unreadCount))}</span>` : ''}
          </span>
        </span>
      </button>
      <button class="chat-delete-btn" data-role="delete-chat" data-chat-id="${escapeHtml(item.chatId)}" title="Delete chat" aria-label="Delete chat">🗑</button>
      ${archiveBtn}
    </div>
  `;
}

export function renderChatListView(state, activeChatId = '', onlineUserIds = new Set()) {
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
      <div class="chat-list-items">
        ${state.items.map((item) => renderChatItem(item, activeChatId, onlineUserIds)).join('')}
      </div>
      <p class="chat-list-secure-footer">🔒 Private and secure by default.</p>
    </div>
  `;
}

export function bindChatListView(root, { onOpenChat, onDeleteChat, onRetry, onArchive, onUnarchive }) {
  root.querySelector('[data-role="retry-chats"]')?.addEventListener('click', () => onRetry?.());

  root.querySelectorAll('[data-role="open-chat"]').forEach((btn) => {
    let pressTimer = null;
    const wrap = btn.closest('.chat-row-wrap');

    btn.addEventListener('click', () => {
      if (wrap?.classList.contains('chat-row-wrap--reveal')) return;
      onOpenChat(btn.dataset.chatId);
    });

    btn.addEventListener('touchstart', () => {
      pressTimer = setTimeout(() => {
        wrap?.classList.add('chat-row-wrap--reveal');
        pressTimer = null;
      }, 500);
    }, { passive: true });

    btn.addEventListener('touchend', () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    });
    btn.addEventListener('touchcancel', () => {
      if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
    });

    btn.addEventListener('click', () => {
      if (wrap?.classList.contains('chat-row-wrap--reveal')) {
        wrap.classList.remove('chat-row-wrap--reveal');
      }
    });
  });

  root.querySelectorAll('[data-role="delete-chat"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const chatId = btn.dataset.chatId;
      const wrap = btn.closest('.chat-row-wrap');
      wrap?.classList.remove('chat-row-wrap--reveal');
      onDeleteChat?.(chatId);
    });
  });

  root.querySelectorAll('[data-role="archive-chat"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onArchive?.(btn.dataset.chatId);
    });
  });

  root.querySelectorAll('[data-role="unarchive-chat"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      onUnarchive?.(btn.dataset.chatId);
    });
  });
}
