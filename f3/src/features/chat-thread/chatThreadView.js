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

function renderMessageBubble(item, showSender = false) {
  const isOutgoing = item.direction === 'outgoing';
  return `
    <article class="message-bubble ${isOutgoing ? 'message-outgoing' : 'message-incoming'}">
      ${showSender && item.senderDisplayName ? `<span class="bubble-sender">${escapeHtml(item.senderDisplayName)}</span>` : ''}
      <p class="message-text">${escapeHtml(item.text)}</p>
      <footer class="message-meta">
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

export function renderChatThreadView({ activeChat, threadState, composerValue = '', readOnly = false }) {
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
        <form class="thread-composer" data-role="thread-form">
          <textarea
            class="composer-input"
            data-role="composer-input"
            placeholder="Message…"
            autocomplete="off"
            rows="1"
            ${threadState.sendStatus === 'sending' ? 'disabled' : ''}
          >${escapeHtml(composerValue)}</textarea>
          <button type="submit" class="send-button primary-button" aria-label="Send" ${threadState.sendStatus === 'sending' ? 'disabled' : ''}>
            ${threadState.sendStatus === 'sending' ? '…' : '➤'}
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

export function bindChatThreadView(root, { onSubmit, onTyping, onLoadMore, onRetry, onBack }) {
  const form = root.querySelector('[data-role="thread-form"]');
  const input = root.querySelector('[data-role="composer-input"]');

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
