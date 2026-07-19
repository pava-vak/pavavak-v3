import { escapeHtml } from '../../shared/html.js';

function formatBubbleTime(value) {
  const date = new Date(value);
  return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }).toLowerCase();
}

function formatDateLabel(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) return 'Today';
  const yesterday = new Date(now);
  yesterday.setDate(now.getDate() - 1);
  if (d.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return d.toLocaleDateString([], { weekday: 'short', day: 'numeric', month: 'short' });
}

function renderTick(status) {
  if (status === 'sending') {
    return `<span class="msg-tick msg-tick-pending" aria-label="sending">⏱</span>`;
  }
  if (status === 'read') {
    return `<span class="msg-tick msg-tick-read" aria-label="read"><span>✓</span><span>✓</span></span>`;
  }
  if (status === 'delivered') {
    return `<span class="msg-tick msg-tick-delivered" aria-label="delivered"><span>✓</span><span>✓</span></span>`;
  }
  // sent (server confirmed)
  return `<span class="msg-tick" aria-label="sent">✓</span>`;
}

function backButton() {
  return `<button class="thread-back" type="button" data-role="thread-back" aria-label="Back to chats">←</button>`;
}

function expiryLabel(expiresAt) {
  if (!expiresAt) return '';
  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `⏱ ${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `⏱ ${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `⏱ ${h}h`;
  return `⏱ ${Math.floor(h / 24)}d`;
}

function renderViewOnceBubble(item) {
  const isOutgoing = item.direction === 'outgoing';
  if (isOutgoing) {
    return `
      <article class="message-bubble message-outgoing">
        <p class="message-text view-once-sent">👁 View once sent</p>
        <footer class="message-meta">
          <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
          ${renderTick(item.status)}
        </footer>
      </article>
    `;
  }
  if (item.viewOnceOpened) {
    return `
      <article class="message-bubble message-incoming">
        <p class="message-text view-once-opened">👁 Opened</p>
        <footer class="message-meta">
          <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
        </footer>
      </article>
    `;
  }
  return `
    <article class="message-bubble message-incoming view-once-tap" data-role="open-view-once" data-message-id="${escapeHtml(item.messageId)}" data-text="${escapeHtml(item.text || '')}">
      <p class="message-text view-once-prompt">👁 Tap to view</p>
      <footer class="message-meta">
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
      </footer>
    </article>
  `;
}

function renderMessageBubble(item, showSender = false) {
  if (item.viewOnce) return renderViewOnceBubble(item);

  const isOutgoing = item.direction === 'outgoing';
  const expiry = expiryLabel(item.expiresAt);
  return `
    <article class="message-bubble ${isOutgoing ? 'message-outgoing' : 'message-incoming'}">
      ${showSender && item.senderDisplayName ? `<span class="bubble-sender">${escapeHtml(item.senderDisplayName)}</span>` : ''}
      <p class="message-text">${escapeHtml(item.text)}</p>
      <footer class="message-meta">
        ${expiry ? `<span class="bubble-expiry">${expiry}</span>` : ''}
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
        ${isOutgoing && !showSender ? renderTick(item.status) : ''}
      </footer>
    </article>
  `;
}

function renderMessagesWithSeparators(items, showSender = false) {
  const parts = [];
  let lastDateLabel = null;
  for (const item of items) {
    const label = formatDateLabel(item.sentAt);
    if (label !== lastDateLabel) {
      parts.push(`<div class="date-separator" role="separator"><span>${escapeHtml(label)}</span></div>`);
      lastDateLabel = label;
    }
    parts.push(renderMessageBubble(item, showSender));
  }
  return parts.join('');
}

export function renderChatThreadView({ activeChat, threadState, composerValue = '', readOnly = false, viewOnce = false, deleteAfter = 'never' }) {
  if (!activeChat) {
    return `
      <section class="thread-panel empty-thread">
        <div class="empty-thread-inner">
          <div class="empty-thread-icon">💬</div>
          <h2>No chat open</h2>
          <p class="muted">Pick a conversation from the list to start messaging.</p>
        </div>
      </section>
    `;
  }

  const typingText = threadState.typingUsers?.length
    ? `${threadState.typingUsers.map((user) => escapeHtml(user.displayName)).join(', ')} typing…`
    : '';

  const avatarLetter = escapeHtml((activeChat.avatarText || activeChat.title || '?').slice(0, 1).toUpperCase());
  const headerInfo = `
    <div class="thread-header-avatar">${avatarLetter}</div>
    <div class="thread-header-info">
      <h2>${escapeHtml(activeChat.title)}</h2>
      <p class="thread-subtitle">
        ${typingText
          ? `<span class="typing-indicator">${typingText}</span>`
          : escapeHtml(activeChat.subtitle || '')}
      </p>
    </div>
  `;

  const monitorBar = readOnly
    ? `<div class="monitor-bar"><span class="monitor-bar-eye">👁</span> Monitoring — read only</div>`
    : '';

  if (threadState.status === 'loading') {
    return `
      <section class="thread-panel">
        <div class="thread-header">${backButton()}${headerInfo}</div>
        ${monitorBar}
        <div class="thread-messages thread-loading"><p class="muted">Loading messages…</p></div>
        ${readOnly ? '' : '<div class="thread-composer-placeholder"></div>'}
      </section>
    `;
  }

  if (threadState.status === 'error') {
    return `
      <section class="thread-panel">
        <div class="thread-header">${backButton()}${headerInfo}</div>
        ${monitorBar}
        <div class="thread-messages thread-loading">
          <p class="error-text">${escapeHtml(threadState.error)}</p>
          ${readOnly ? '' : `<button class="secondary-button" data-role="retry-thread">Retry</button>`}
        </div>
        ${readOnly ? '' : '<div class="thread-composer-placeholder"></div>'}
      </section>
    `;
  }

  return `
    <section class="thread-panel">
      <div class="thread-header">${backButton()}${headerInfo}</div>
      ${monitorBar}
      ${threadState.hasMore ? `
        <button class="secondary-button load-more-button" data-role="load-more" ${threadState.loadMoreStatus === 'loading' ? 'disabled' : ''}>
          ${threadState.loadMoreStatus === 'loading' ? 'Loading…' : '↑ Load older messages'}
        </button>
      ` : ''}
      <div class="thread-messages" data-role="thread-messages">
        ${renderMessagesWithSeparators(threadState.items, readOnly)}
      </div>
      ${!readOnly && threadState.sendError ? `<p class="error-text send-error">${escapeHtml(threadState.sendError)}</p>` : ''}
      ${readOnly ? '' : `
        <div class="composer-privacy-bar">
          <button type="button"
            class="privacy-toggle ${viewOnce ? 'privacy-toggle-active' : ''}"
            data-role="toggle-view-once"
            title="${viewOnce ? 'View once: ON — tap to turn off' : 'View once: OFF — tap to turn on'}">
            👁 ${viewOnce ? 'View Once' : 'Once'}
          </button>
          <select class="privacy-timer" data-role="delete-after-select" title="Auto-delete after">
            <option value="never" ${deleteAfter === 'never' ? 'selected' : ''}>⏱ Never</option>
            <option value="1h"   ${deleteAfter === '1h'    ? 'selected' : ''}>⏱ 1 hour</option>
            <option value="24h"  ${deleteAfter === '24h'   ? 'selected' : ''}>⏱ 24 hours</option>
            <option value="7d"   ${deleteAfter === '7d'    ? 'selected' : ''}>⏱ 7 days</option>
          </select>
        </div>
        <form class="thread-composer" data-role="thread-form">
          <textarea
            class="composer-input"
            data-role="composer-input"
            placeholder="${viewOnce ? '👁 View once message…' : 'Message…'}"
            autocomplete="off"
            rows="1"
            ${threadState.sendStatus === 'sending' ? 'disabled' : ''}
          >${escapeHtml(composerValue)}</textarea>
          <button type="submit" class="send-button primary-button" aria-label="Send" ${threadState.sendStatus === 'sending' ? 'disabled' : ''}>
            ${threadState.sendStatus === 'sending' ? '…' : (viewOnce ? '👁' : '➤')}
          </button>
        </form>
      `}
    </section>
  `;
}

function autoGrow(el) {
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 120)}px`;
}

export function bindChatThreadView(root, { onSubmit, onTyping, onLoadMore, onRetry, onBack, onOpenViewOnce, onToggleViewOnce, onSetDeleteAfter }) {
  const form = root.querySelector('[data-role="thread-form"]');
  const input = root.querySelector('[data-role="composer-input"]');

  root.querySelectorAll('[data-role="open-view-once"]').forEach((el) => {
    el.addEventListener('click', () => {
      const messageId = el.dataset.messageId;
      const text = el.dataset.text;
      if (!text) return;
      el.innerHTML = `<p class="message-text">${escapeHtml(text)}</p><footer class="message-meta"><span class="bubble-time"></span></footer>`;
      el.classList.remove('view-once-tap');
      el.removeAttribute('data-role');
      onOpenViewOnce?.(messageId);
    });
  });

  root.querySelector('[data-role="toggle-view-once"]')?.addEventListener('click', () => {
    onToggleViewOnce?.();
  });

  root.querySelector('[data-role="delete-after-select"]')?.addEventListener('change', (e) => {
    onSetDeleteAfter?.(e.target.value);
  });

  root.querySelector('[data-role="thread-back"]')?.addEventListener('click', () => onBack?.());

  if (input) {
    autoGrow(input);
    input.addEventListener('input', () => {
      onTyping?.('start');
      autoGrow(input);
    });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form?.requestSubmit();
      }
    });
  }

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input || input.disabled) return;

    const value = input.value;
    if (!value.trim()) return;

    onTyping?.('stop');
    input.value = '';
    autoGrow(input);
    await onSubmit(value);
    const nextInput = root.querySelector('[data-role="composer-input"]');
    nextInput?.focus();
  });

  root.querySelector('[data-role="load-more"]')?.addEventListener('click', () => onLoadMore?.());
  root.querySelector('[data-role="retry-thread"]')?.addEventListener('click', () => onRetry?.());
}
