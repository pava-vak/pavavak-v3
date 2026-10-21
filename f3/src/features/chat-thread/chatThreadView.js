import { escapeHtml, linkifyHtml, linkifyAndEmojiHtml, isEmojiOnly, countEmoji } from '../../shared/html.js';
import { uploadMedia, uploadVideoBlob, uploadBinaryBlob, requestMediaBlob, reactToMessage, editMessage, votePoll, fetchPoll, fetchLinkPreview, forwardMessage, pinMessage, fetchPinnedMessage } from '../../shared/apiClient.js';
import { createEmojiPicker } from '../../shared/emojiPicker.js';
import { openMediaGallery } from './mediaGallery.js';

const TIME_OPTS = { hour: 'numeric', minute: '2-digit', hour12: true };

function formatBubbleTime(value) {
  return new Date(value).toLocaleTimeString(undefined, TIME_OPTS).toLowerCase();
}

function formatDateLabel(isoString) {
  const d = new Date(isoString);
  const now = new Date();
  const dDay  = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const diff = today - dDay;
  if (diff === 0) return 'Today';
  if (diff === 86_400_000) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
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
  return `<span class="msg-tick" aria-label="sent">✓</span>`;
}

function backButton() {
  return `<button class="thread-back" type="button" data-role="thread-back" aria-label="Back to chats">←</button>`;
}

function shortDuration(seconds) {
  if (seconds < 60) return `${seconds}s`;
  const m = Math.floor(seconds / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}

// ⏱ disappearing, 🔥 burn after reading (counts down once read), 🔕 sent silently
export function expiryLabel(expiresAt, item = null) {
  const burning = item?.burnSeconds != null;
  const silent = item?.silent && item?.direction === 'outgoing' ? ' 🔕' : '';
  if (!expiresAt) return burning ? `🔥 ${shortDuration(item.burnSeconds)} after reading${silent}` : silent.trim();
  const ms = new Date(expiresAt) - Date.now();
  if (ms <= 0) return '';
  return `${burning ? '🔥' : '⏱'} ${shortDuration(Math.floor(ms / 1000))}${silent}`;
}

function voContentType(text) {
  if (!text) return 'text';
  if (text.startsWith('__IMG__:')) return 'image';
  if (text.startsWith('__VID__:')) return 'video';
  return 'text';
}

function renderViewOnceBubble(item, isAdminView = false) {
  const isOutgoing = item.direction === 'outgoing';
  const text = item.text || '';
  const contentType = voContentType(text);
  const fileId = (contentType === 'image' || contentType === 'video') ? text.slice(8) : null;

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

  // Admin monitoring view: show actual content directly, no tap-to-view restriction
  if (isAdminView) {
    const icon = '<span class="vo-admin-badge" title="View once message">👁</span>';
    if (contentType === 'image') {
      return `
        <article class="message-bubble message-incoming vo-admin-bubble"
                 data-message-id="${escapeHtml(item.messageId)}" data-direction="incoming">
          ${icon}
          <div class="img-bubble" data-role="img-bubble" data-file-id="${escapeHtml(fileId)}" data-view="placeholder">
            <span class="img-bubble-icon">📷</span><span class="img-bubble-label">Image</span>
          </div>
          <footer class="message-meta"><span class="bubble-time">${formatBubbleTime(item.sentAt)}</span></footer>
        </article>
      `;
    }
    if (contentType === 'video') {
      return `
        <article class="message-bubble message-incoming vo-admin-bubble"
                 data-message-id="${escapeHtml(item.messageId)}" data-direction="incoming">
          ${icon}
          <div class="vid-bubble" data-role="vid-bubble" data-file-id="${escapeHtml(fileId)}" data-view="placeholder">
            <span class="vid-bubble-icon">▶</span><span class="vid-bubble-label">Video</span>
          </div>
          <footer class="message-meta"><span class="bubble-time">${formatBubbleTime(item.sentAt)}</span></footer>
        </article>
      `;
    }
    return `
      <article class="message-bubble message-incoming vo-admin-bubble">
        ${icon}
        <p class="message-text">${escapeHtml(text)}</p>
        <footer class="message-meta"><span class="bubble-time">${formatBubbleTime(item.sentAt)}</span></footer>
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

  const typeIcon = contentType === 'image' ? '🖼' : contentType === 'video' ? '▶' : '💬';
  return `
    <article class="message-bubble message-incoming view-once-tap"
             data-role="open-view-once"
             data-message-id="${escapeHtml(item.messageId)}"
             data-vo-type="${contentType}"
             ${fileId ? `data-vo-file-id="${escapeHtml(fileId)}"` : `data-vo-text="${escapeHtml(text)}"`}>
      <p class="message-text view-once-prompt">${typeIcon} 👁 Tap to view</p>
      <footer class="message-meta">
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
      </footer>
    </article>
  `;
}

function revealViewOnceText(el, text) {
  let secs = 10;
  el.innerHTML = `
    <p class="message-text vo-text-revealed">${escapeHtml(text)}</p>
    <div class="vo-countdown-bar"><div class="vo-countdown-fill" style="animation-duration:${secs}s"></div></div>
    <footer class="message-meta"><span class="vo-timer">${secs}s</span></footer>
  `;
  el.classList.remove('view-once-tap');
  el.removeAttribute('data-role');
  const timerEl = el.querySelector('.vo-timer');
  const interval = setInterval(() => {
    secs--;
    if (timerEl) timerEl.textContent = `${secs}s`;
    if (secs <= 0) {
      clearInterval(interval);
      el.innerHTML = `<p class="message-text view-once-opened">👁 Opened</p><footer class="message-meta"></footer>`;
    }
  }, 1000);
}

async function openViewOnceMediaOverlay(type, fileId) {
  const overlay = document.createElement('div');
  overlay.className = 'vo-media-overlay';
  overlay.innerHTML = `
    <div class="vo-media-inner">
      <div class="vo-media-spinner">⏳ Loading…</div>
    </div>
  `;
  document.body.appendChild(overlay);

  let secs = type === 'video' ? 30 : 10;
  let interval = null;
  let blobObjectUrl = null;

  function closeOverlay() {
    clearInterval(interval);
    if (blobObjectUrl) { URL.revokeObjectURL(blobObjectUrl); blobObjectUrl = null; }
    overlay.remove();
  }

  overlay.addEventListener('click', (e) => { if (e.target === overlay) closeOverlay(); });

  try {
    const blob = await requestMediaBlob(fileId);
    blobObjectUrl = URL.createObjectURL(blob);
    const url = blobObjectUrl;

    const mediaEl = type === 'video'
      ? `<video class="vo-media-vid" src="${url}" autoplay playsinline controls></video>`
      : `<img class="vo-media-img" src="${url}" alt="View once image" draggable="false">`;

    overlay.querySelector('.vo-media-inner').innerHTML = `
      ${mediaEl}
      <div class="vo-media-bar"><div class="vo-media-progress" style="animation-duration:${secs}s"></div></div>
      <span class="vo-media-timer">${secs}s</span>
      <button class="vo-media-close" aria-label="Close">✕</button>
    `;

    overlay.querySelector('.vo-media-close').addEventListener('click', closeOverlay);

    if (type === 'video') {
      const vid = overlay.querySelector('video');
      vid?.addEventListener('ended', closeOverlay);
    }

    interval = setInterval(() => {
      secs--;
      const t = overlay.querySelector('.vo-media-timer');
      if (t) t.textContent = `${secs}s`;
      if (secs <= 0) closeOverlay();
    }, 1000);

  } catch {
    closeOverlay();
  }
}

function renderImageBubble(item) {
  const fileId = item.text.slice(8); // strip '__IMG__:'
  const isOutgoing = item.direction === 'outgoing';
  const expiry = expiryLabel(item.expiresAt, item);
  return `
    <article class="message-bubble ${isOutgoing ? 'message-outgoing' : 'message-incoming'}"
             data-message-id="${escapeHtml(item.messageId)}"
             data-direction="${isOutgoing ? 'outgoing' : 'incoming'}">
      ${item.senderDisplayName && !isOutgoing ? `<span class="bubble-sender">${escapeHtml(item.senderDisplayName)}</span>` : ''}
      <div class="img-bubble" data-role="img-bubble" data-file-id="${escapeHtml(fileId)}" data-view="placeholder">
        <span class="img-bubble-icon">📷</span>
        <span class="img-bubble-label">Image</span>
      </div>
      <footer class="message-meta">
        ${expiry ? `<span class="bubble-expiry">${expiry}</span>` : ''}
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
        ${isOutgoing ? renderTick(item.status) : ''}
        ${isOutgoing ? `<button class="msg-delete-btn" data-role="delete-message" data-message-id="${escapeHtml(item.messageId)}" title="Delete message" aria-label="Delete">✕</button>` : ''}
      </footer>
    </article>
  `;
}

function renderVideoBubble(item) {
  const fileId = item.text.slice(8); // strip '__VID__:'
  const isOutgoing = item.direction === 'outgoing';
  const expiry = expiryLabel(item.expiresAt, item);
  return `
    <article class="message-bubble ${isOutgoing ? 'message-outgoing' : 'message-incoming'}"
             data-message-id="${escapeHtml(item.messageId)}"
             data-direction="${isOutgoing ? 'outgoing' : 'incoming'}">
      ${item.senderDisplayName && !isOutgoing ? `<span class="bubble-sender">${escapeHtml(item.senderDisplayName)}</span>` : ''}
      <div class="vid-bubble" data-role="vid-bubble" data-file-id="${escapeHtml(fileId)}" data-view="placeholder">
        <span class="vid-bubble-icon">▶</span>
        <span class="vid-bubble-label">Video</span>
      </div>
      <footer class="message-meta">
        ${expiry ? `<span class="bubble-expiry">${expiry}</span>` : ''}
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
        ${isOutgoing ? renderTick(item.status) : ''}
        ${isOutgoing ? `<button class="msg-delete-btn" data-role="delete-message" data-message-id="${escapeHtml(item.messageId)}" title="Delete message" aria-label="Delete">✕</button>` : ''}
      </footer>
    </article>
  `;
}

function renderAudioBubble(item) {
  const fileId = item.text.slice(8); // strip '__AUD__:'
  const isOutgoing = item.direction === 'outgoing';
  return `
    <article class="message-bubble ${isOutgoing ? 'message-outgoing' : 'message-incoming'}"
             data-message-id="${escapeHtml(item.messageId)}"
             data-direction="${isOutgoing ? 'outgoing' : 'incoming'}">
      ${item.senderDisplayName && !isOutgoing ? `<span class="bubble-sender">${escapeHtml(item.senderDisplayName)}</span>` : ''}
      <div class="aud-bubble" data-role="aud-bubble" data-file-id="${escapeHtml(fileId)}">
        <button class="aud-play-btn" aria-label="Play voice note">▶</button>
        <div class="aud-waveform"><span></span><span></span><span></span><span></span><span></span><span></span><span></span><span></span></div>
        <span class="aud-duration"></span>
      </div>
      <footer class="message-meta">
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
        ${isOutgoing ? renderTick(item.status) : ''}
      </footer>
    </article>
  `;
}

function renderDocBubble(item) {
  // body: __DOC__:fileId:filename
  const rest = item.text.slice(8); // strip '__DOC__:'
  const colonIdx = rest.indexOf(':');
  const fileId = colonIdx >= 0 ? rest.slice(0, colonIdx) : rest;
  const filename = colonIdx >= 0 ? rest.slice(colonIdx + 1) : 'Document';
  const isOutgoing = item.direction === 'outgoing';
  return `
    <article class="message-bubble ${isOutgoing ? 'message-outgoing' : 'message-incoming'}"
             data-message-id="${escapeHtml(item.messageId)}"
             data-direction="${isOutgoing ? 'outgoing' : 'incoming'}">
      ${item.senderDisplayName && !isOutgoing ? `<span class="bubble-sender">${escapeHtml(item.senderDisplayName)}</span>` : ''}
      <div class="doc-bubble" data-role="doc-bubble" data-file-id="${escapeHtml(fileId)}" data-filename="${escapeHtml(filename)}">
        <span class="doc-icon">📄</span>
        <span class="doc-name">${escapeHtml(filename)}</span>
        <button class="doc-dl-btn" data-role="doc-download" aria-label="Download">⬇</button>
      </div>
      <footer class="message-meta">
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
        ${isOutgoing ? renderTick(item.status) : ''}
      </footer>
    </article>
  `;
}

function renderPollBubble(item) {
  const poll = item.poll;
  const isOutgoing = item.direction === 'outgoing';
  const totalVotes = poll ? Object.values(poll.votes || {}).reduce((s, c) => s + Number(c), 0) : 0;

  const optionBars = poll ? poll.options.map((opt, idx) => {
    const count = Number(poll.votes?.[String(idx)] || 0);
    const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
    const voted = poll.myVote === idx;
    return `
      <button class="poll-option ${voted ? 'poll-option-voted' : ''}"
              data-role="poll-vote" data-option-index="${idx}"
              data-message-id="${escapeHtml(item.messageId)}">
        <div class="poll-option-bar" style="width:${pct}%"></div>
        <span class="poll-option-label">${escapeHtml(opt)}</span>
        <span class="poll-option-count">${pct}%</span>
      </button>
    `;
  }).join('') : '<p class="muted" style="padding:8px">Loading poll…</p>';

  return `
    <article class="message-bubble ${isOutgoing ? 'message-outgoing' : 'message-incoming'}"
             data-message-id="${escapeHtml(item.messageId)}"
             data-direction="${isOutgoing ? 'outgoing' : 'incoming'}">
      ${item.senderDisplayName && !isOutgoing ? `<span class="bubble-sender">${escapeHtml(item.senderDisplayName)}</span>` : ''}
      <div class="poll-bubble" data-role="poll-bubble" data-message-id="${escapeHtml(item.messageId)}">
        <p class="poll-question">📊 ${poll ? escapeHtml(poll.question) : 'Poll'}</p>
        <div class="poll-options">${optionBars}</div>
        <p class="poll-footer">${totalVotes} vote${totalVotes !== 1 ? 's' : ''}</p>
      </div>
      <footer class="message-meta">
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
        ${isOutgoing ? renderTick(item.status) : ''}
      </footer>
    </article>
  `;
}

function renderDeletedBubble(item) {
  const isOutgoing = item.direction === 'outgoing';
  return `
    <article class="message-bubble ${isOutgoing ? 'message-outgoing' : 'message-incoming'} msg-deleted-bubble"
             data-message-id="${escapeHtml(item.messageId)}">
      <p class="msg-deleted-text">🚫 This message was deleted</p>
      <footer class="message-meta">
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
      </footer>
    </article>
  `;
}

function renderReactionsRow(messageId, reactions) {
  if (!reactions) return '';
  const msgReactions = reactions[messageId];
  if (!msgReactions || !msgReactions.length) return '';
  // Group by emoji
  const counts = {};
  for (const r of msgReactions) {
    counts[r.emoji] = (counts[r.emoji] || 0) + 1;
  }
  const chips = Object.entries(counts).map(([emoji, count]) =>
    `<span class="reaction-chip" data-emoji="${escapeHtml(emoji)}" data-message-id="${escapeHtml(messageId)}">${escapeHtml(emoji)}${count > 1 ? ` <span class="reaction-count">${escapeHtml(String(count))}</span>` : ''}</span>`
  ).join('');
  return `<div class="reactions-row">${chips}</div>`;
}

function renderMessageBubble(item, showSender = false, reactions = null, isAdminView = false) {
  if (item.deleted) return renderDeletedBubble(item);
  if (item.viewOnce) return renderViewOnceBubble(item, isAdminView);

  if (item.text === '__SYS_UPDATE__') {
    return `
      <div class="sys-update-banner">
        <span class="sys-update-text">🔄 PaVa Vak updated</span>
        <button class="sys-update-btn" type="button" data-role="sys-update-reload">Reload now</button>
      </div>
    `;
  }

  if (item.text?.startsWith('__IMG__:')) return renderImageBubble(item) + renderReactionsRow(item.messageId, reactions);
  if (item.text?.startsWith('__VID__:')) return renderVideoBubble(item) + renderReactionsRow(item.messageId, reactions);
  if (item.text?.startsWith('__AUD__:')) return renderAudioBubble(item) + renderReactionsRow(item.messageId, reactions);
  if (item.text?.startsWith('__DOC__:')) return renderDocBubble(item) + renderReactionsRow(item.messageId, reactions);
  if (item.text?.startsWith('__POLL__:')) return renderPollBubble(item) + renderReactionsRow(item.messageId, reactions);

  const isOutgoing = item.direction === 'outgoing';
  const expiry = expiryLabel(item.expiresAt, item);

  // Parse reply-quoted prefix: "> Sender: preview\nactual text"
  let quoteBlock = '';
  let bodyText = item.text;
  if (bodyText?.startsWith('> ')) {
    const nl = bodyText.indexOf('\n');
    if (nl !== -1) {
      quoteBlock = `<div class="msg-quote">${escapeHtml(bodyText.slice(2, nl))}</div>`;
      bodyText = bodyText.slice(nl + 1);
    }
  }

  // Emoji-only detection (only when no quote block)
  const emojiOnlyMsg = !quoteBlock && isEmojiOnly(bodyText);
  const emojiCount = emojiOnlyMsg ? countEmoji(bodyText) : 0;
  // jumbo = 1-3 emoji (no bubble bg), large = 4-7 emoji (bubble, bigger font)
  const emojiSizeClass = emojiOnlyMsg
    ? (emojiCount <= 3 ? 'msg-emoji-jumbo' : emojiCount <= 7 ? 'msg-emoji-large' : '')
    : '';

  // Detect first URL for link preview
  const urlMatch = bodyText?.match(/https?:\/\/[^\s<>"']+/);
  const previewUrl = urlMatch ? urlMatch[0] : null;

  return `
    <article class="message-bubble ${isOutgoing ? 'message-outgoing' : 'message-incoming'}${emojiSizeClass ? ` ${emojiSizeClass}` : ''}"
             data-message-id="${escapeHtml(item.messageId)}"
             data-direction="${isOutgoing ? 'outgoing' : 'incoming'}"
             ${previewUrl ? `data-preview-url="${escapeHtml(previewUrl)}"` : ''}>
      ${showSender && item.senderDisplayName ? `<span class="bubble-sender">${escapeHtml(item.senderDisplayName)}</span>` : ''}
      ${quoteBlock}
      <p class="message-text">${emojiOnlyMsg ? bodyText : linkifyAndEmojiHtml(bodyText)}</p>
      ${previewUrl ? `<div class="link-preview-slot" data-role="link-preview-slot"></div>` : ''}
      ${item.editedAt ? `<span class="msg-edited-badge">edited</span>` : ''}
      ${item.forwarded ? `<span class="msg-forwarded-badge">↪ Forwarded</span>` : ''}
      ${item.deletedAt ? `<span class="msg-admin-deleted-badge">🚫 deleted</span>` : ''}
      <footer class="message-meta">
        ${expiry ? `<span class="bubble-expiry">${expiry}</span>` : ''}
        <span class="bubble-time">${formatBubbleTime(item.sentAt)}</span>
        ${isOutgoing && !showSender ? renderTick(item.status) : ''}
        ${isOutgoing && !showSender ? `<button class="msg-delete-btn" data-role="delete-message" data-message-id="${escapeHtml(item.messageId)}" title="Delete message" aria-label="Delete">✕</button>` : ''}
      </footer>
    </article>
    ${renderReactionsRow(item.messageId, reactions)}
  `;
}

function renderMessagesWithSeparators(items, showSender = false, reactions = null, isAdminView = false) {
  const parts = [];
  let lastDateLabel = null;
  for (const item of items) {
    const label = formatDateLabel(item.sentAt);
    if (label !== lastDateLabel) {
      parts.push(`<div class="date-separator" role="separator"><span>${escapeHtml(label)}</span></div>`);
      lastDateLabel = label;
    }
    parts.push(renderMessageBubble(item, showSender, reactions, isAdminView));
  }
  return parts.join('');
}

const WALLPAPER_CSS = {
  forest: 'linear-gradient(135deg,#1a3a2a,#2d5a3d)',
  ocean: 'linear-gradient(135deg,#1a2a4a,#2d4a7a)',
  sunset: 'linear-gradient(135deg,#4a1a2a,#7a3d2d)',
  slate: 'linear-gradient(135deg,#1e1e2e,#2e2e4e)',
  gold: 'linear-gradient(135deg,#2a1a0a,#5a3a1a)',
  purple: 'linear-gradient(135deg,#1a0a2a,#3d1a5a)',
  teal: 'linear-gradient(135deg,#0a2a2a,#1a5a5a)',
};

export function renderChatThreadView({ activeChat, threadState, composerValue = '', readOnly = false, viewOnce = false, deleteAfter = 'never', reactions = null, pinnedMessage = null, threadSearch = null }) {
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
  const isOnline = activeChat.peerOnline === true;
  const headerInfo = `
    <div class="thread-header-avatar-wrap" style="cursor:pointer" title="View info">
      <div class="thread-header-avatar">${avatarLetter}</div>
      ${isOnline ? '<span class="thread-online-dot"></span>' : ''}
    </div>
    <div class="thread-header-info" style="cursor:pointer">
      <h2>${escapeHtml(activeChat.title)}</h2>
      <p class="thread-subtitle">
        ${typingText
          ? `<span class="typing-indicator">${typingText}</span>`
          : isOnline ? '<span class="thread-online-label">online</span>' : escapeHtml(activeChat.subtitle || '')}
      </p>
    </div>
    <button class="thread-header-action" data-role="open-media-gallery" title="Media gallery" aria-label="Media gallery">🖼</button>
    <button class="thread-header-action ${threadSearch ? 'active' : ''}" data-role="open-thread-search" title="Search in chat" aria-label="Search messages">🔍</button>  `;

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

  const searchQuery = threadSearch?.query?.trim() || '';
  const filteredItems = searchQuery.length >= 2
    ? (threadState.items || []).filter(m => {
        if (!m.text) return false;
        const cleaned = m.text.startsWith('__IMG__:') || m.text.startsWith('__VID__:') || m.text.startsWith('__AUD__:') ? '' : m.text;
        return cleaned.toLowerCase().includes(searchQuery.toLowerCase());
      })
    : null;
  const searchBar = threadSearch ? `
    <div class="thread-search-bar">
      <input class="thread-search-input" type="search" placeholder="Search messages…" value="${escapeHtml(threadSearch.query || '')}" data-role="thread-search-input" autocomplete="off" />
      <button class="thread-search-close" data-role="close-thread-search" aria-label="Close search">✕</button>
      ${searchQuery.length >= 2 ? `<span class="thread-search-count">${filteredItems?.length || 0} result${filteredItems?.length !== 1 ? 's' : ''}</span>` : ''}
    </div>` : '';

  return `
    <section class="thread-panel">
      <div class="thread-header">${backButton()}${headerInfo}</div>
      ${searchBar}
      ${monitorBar}
      ${threadState.hasMore ? `
        <button class="secondary-button load-more-button" data-role="load-more" ${threadState.loadMoreStatus === 'loading' ? 'disabled' : ''}>
          ${threadState.loadMoreStatus === 'loading' ? 'Loading…' : '↑ Load older messages'}
        </button>
      ` : ''}
      ${pinnedMessage ? `
        <div class="pinned-banner" data-role="pinned-banner">
          <span class="pinned-icon">📌</span>
          <span class="pinned-text">${escapeHtml(pinnedMessage.text?.startsWith('__IMG__:') ? '📷 Photo' : pinnedMessage.text?.startsWith('__VID__:') ? '▶ Video' : pinnedMessage.text?.startsWith('__AUD__:') ? '🎤 Voice note' : pinnedMessage.text?.slice(0, 60) || '')}</span>
          ${!readOnly ? `<button class="pinned-close" data-role="unpin-message" title="Unpin">✕</button>` : ''}
        </div>` : ''}
      <div class="thread-messages-wrap">
        <div class="thread-messages" data-role="thread-messages"
             ${activeChat?.background && WALLPAPER_CSS[activeChat.background] ? `style="background:${WALLPAPER_CSS[activeChat.background]}"` : ''}>
          ${filteredItems !== null
            ? (filteredItems.length === 0
                ? `<p class="muted thread-search-empty">No messages found for "${escapeHtml(searchQuery)}"</p>`
                : renderMessagesWithSeparators(filteredItems, readOnly, reactions, readOnly))
            : renderMessagesWithSeparators(threadState.items, readOnly, reactions, readOnly)}
        </div>
        <button class="scroll-to-new-btn hidden" data-role="scroll-to-new" aria-label="New messages">
          ↓ <span data-role="new-count">0</span> new
        </button>
      </div>
      ${!readOnly && threadState.sendError ? `<p class="error-text send-error">${escapeHtml(threadState.sendError)}</p>` : ''}
      ${readOnly ? '' : `
        ${(viewOnce || deleteAfter !== 'never' || threadState.silent || (threadState.burn && threadState.burn !== 'off')) ? `
        <div class="composer-mode-bar">
          ${viewOnce ? '<span class="composer-mode-chip">👁 View Once</span>' : ''}
          ${deleteAfter !== 'never' ? `<span class="composer-mode-chip">⏱ ${deleteAfter}</span>` : ''}
          ${threadState.burn && threadState.burn !== 'off' ? `<span class="composer-mode-chip">🔥 Burn ${escapeHtml(threadState.burn)} after reading</span>` : ''}
          ${threadState.silent ? '<span class="composer-mode-chip">🔕 Silent</span>' : ''}
          <button type="button" class="composer-mode-clear" data-role="clear-composer-modes" aria-label="Clear modes" title="Clear modes">✕</button>
        </div>` : ''}
        <div class="reply-preview-bar hidden" data-role="reply-preview-bar">
          <div class="reply-preview-content">
            <span class="reply-preview-label">Replying to:</span>
            <span class="reply-preview-text" data-role="reply-preview-text"></span>
          </div>
          <button type="button" class="reply-preview-cancel" data-role="cancel-reply" aria-label="Cancel reply">✕</button>
        </div>
        <form class="thread-composer" data-role="thread-form">
          <input type="file" accept="image/*,video/*" class="hidden" data-role="gallery-input" tabindex="-1" aria-hidden="true" />
          <input type="file" accept="*/*" class="hidden" data-role="doc-input" tabindex="-1" aria-hidden="true" />
          <div class="img-source-wrap" data-role="img-source-wrap">
            <button type="button" class="composer-icon-btn" data-role="attach-image" aria-label="Attach / more options" title="Attach">＋</button>
            <div class="img-source-menu hidden" data-role="img-source-menu">
              <div class="extras-group">
                <button type="button" class="img-source-btn" data-role="pick-gallery">🖼 Photo/Video</button>
                <button type="button" class="img-source-btn" data-role="pick-camera">📸 Camera</button>
                <button type="button" class="img-source-btn" data-role="pick-doc">📄 Document</button>
              </div>
              <div class="extras-divider"></div>
              <div class="extras-group">
                <button type="button" class="img-source-btn${viewOnce ? ' extras-btn--active' : ''}" data-role="toggle-view-once">
                  👁 View Once${viewOnce ? ' ✓' : ''}
                </button>
                <label class="extras-timer-row">
                  <span class="extras-timer-label">⏱ Auto-delete</span>
                  <select class="privacy-timer extras-timer-select" data-role="delete-after-select">
                    <option value="never" ${deleteAfter === 'never' ? 'selected' : ''}>Never</option>
                    <option value="1h"   ${deleteAfter === '1h'    ? 'selected' : ''}>1 hour</option>
                    <option value="24h"  ${deleteAfter === '24h'   ? 'selected' : ''}>24 hours</option>
                    <option value="7d"   ${deleteAfter === '7d'    ? 'selected' : ''}>7 days</option>
                  </select>
                </label>
                <label class="extras-timer-row">
                  <span class="extras-timer-label">🔥 Burn after reading</span>
                  <select class="privacy-timer extras-timer-select" data-role="burn-select">
                    ${[['off', 'Off'], ['10s', '10 seconds'], ['1m', '1 minute'], ['5m', '5 minutes'], ['1h', '1 hour']]
                      .map(([v, l]) => `<option value="${v}" ${(threadState.burn || 'off') === v ? 'selected' : ''}>${l}</option>`).join('')}
                  </select>
                </label>
                <button type="button" class="img-source-btn${threadState.silent ? ' extras-btn--active' : ''}" data-role="toggle-silent">
                  🔕 Send silently${threadState.silent ? ' ✓' : ''}
                </button>
                <button type="button" class="img-source-btn" data-role="schedule-message">🕐 Schedule</button>
                <button type="button" class="img-source-btn" data-role="create-poll">📊 Poll</button>
              </div>
            </div>
          </div>
          <textarea
            class="composer-input"
            data-role="composer-input"
            placeholder="${viewOnce ? '👁 View once…' : 'Message…'}"
            autocomplete="off"
            rows="1"
            ${threadState.sendStatus === 'sending' ? 'disabled' : ''}
          >${escapeHtml(composerValue)}</textarea>
          <button type="button" class="composer-icon-btn" data-role="toggle-emoji" aria-label="Emoji" title="Emoji">😊</button>
          <button type="button" class="composer-icon-btn mic-btn" data-role="mic-record" aria-label="Voice note" title="Hold to record voice note">🎤</button>
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

// Module-level state that survives re-renders
let _activeCloseImgMenu = null;

// Image blob cache (LRU, max 80 entries)
const imgCache = new Map();
const IMG_CACHE_MAX = 80;
function imgCacheSet(fileId, url) {
  if (imgCache.size >= IMG_CACHE_MAX) {
    const oldest = imgCache.keys().next().value;
    URL.revokeObjectURL(imgCache.get(oldest));
    imgCache.delete(oldest);
  }
  imgCache.set(fileId, url);
}

// allFileIds: ordered list of all image fileIds visible in the current thread
// startIdx: which one to open first
function openImageViewer(allFileIds, startIdx) {
  document.getElementById('pava-img-viewer')?.remove();

  let currentIdx = startIdx;
  const total = allFileIds.length;

  const overlay = document.createElement('div');
  overlay.id = 'pava-img-viewer';
  overlay.className = 'img-viewer-overlay';
  overlay.innerHTML = `
    <div class="img-viewer-topbar">
      <button class="img-viewer-close" aria-label="Close">✕</button>
      <span class="img-viewer-counter">${total > 1 ? `${currentIdx + 1} / ${total}` : ''}</span>
      <button class="img-viewer-save" aria-label="Save image">⬇ Save</button>
    </div>
    <div class="img-viewer-stage">
      <img class="img-viewer-img" draggable="false" alt="">
      <div class="img-viewer-spinner hidden">⏳</div>
    </div>
    ${total > 1 ? `
      <button class="img-viewer-nav img-viewer-prev" aria-label="Previous">‹</button>
      <button class="img-viewer-nav img-viewer-next" aria-label="Next">›</button>
    ` : ''}
  `;
  overlay.addEventListener('contextmenu', e => e.preventDefault());

  const stage    = overlay.querySelector('.img-viewer-stage');
  const img      = overlay.querySelector('.img-viewer-img');
  const spinner  = overlay.querySelector('.img-viewer-spinner');
  const counter  = overlay.querySelector('.img-viewer-counter');
  const prevBtn  = overlay.querySelector('.img-viewer-prev');
  const nextBtn  = overlay.querySelector('.img-viewer-next');

  // ── Zoom / pan state ─────────────────────────────────────────────────
  let scale = 1, tx = 0, ty = 0;
  let dragging = false, dragX = 0, dragY = 0;
  let lastTap = 0, pinchDist = 0;

  function applyTransform() {
    img.style.transform = `translate(${tx}px, ${ty}px) scale(${scale})`;
    stage.style.cursor = scale > 1 ? (dragging ? 'grabbing' : 'grab') : 'default';
  }

  function clamp() {
    if (scale <= 1) { tx = 0; ty = 0; return; }
    const sw = stage.clientWidth, sh = stage.clientHeight;
    const maxX = (sw * (scale - 1)) / 2;
    const maxY = (sh * (scale - 1)) / 2;
    tx = Math.max(-maxX, Math.min(maxX, tx));
    ty = Math.max(-maxY, Math.min(maxY, ty));
  }

  function resetZoom() { scale = 1; tx = 0; ty = 0; applyTransform(); }

  // ── Load image at index ──────────────────────────────────────────────
  async function showAt(idx) {
    currentIdx = idx;
    const fileId = allFileIds[idx];

    if (counter) counter.textContent = total > 1 ? `${idx + 1} / ${total}` : '';
    if (prevBtn) prevBtn.disabled = idx === 0;
    if (nextBtn) nextBtn.disabled = idx === total - 1;

    const cached = imgCache.get(fileId);
    if (cached) {
      img.src = cached;
      resetZoom();
      return;
    }

    // Not cached yet — show spinner, fetch
    img.style.opacity = '0';
    spinner?.classList.remove('hidden');
    try {
      const blob = await requestMediaBlob(fileId);
      const url = URL.createObjectURL(blob);
      imgCacheSet(fileId, url);
      img.src = url;
      img.style.opacity = '1';
    } catch {
      img.alt = '⚠ Could not load image';
      img.style.opacity = '1';
    } finally {
      spinner?.classList.add('hidden');
    }
    resetZoom();

    // Pre-fetch neighbours silently
    [idx - 1, idx + 1].forEach(ni => {
      if (ni >= 0 && ni < total && !imgCache.has(allFileIds[ni])) {
        requestMediaBlob(allFileIds[ni])
          .then(b => imgCacheSet(allFileIds[ni], URL.createObjectURL(b)))
          .catch(() => {});
      }
    });
  }

  // ── Navigation ───────────────────────────────────────────────────────
  function goNext() { if (currentIdx < total - 1) showAt(currentIdx + 1); }
  function goPrev() { if (currentIdx > 0)         showAt(currentIdx - 1); }

  prevBtn?.addEventListener('click', (e) => { e.stopPropagation(); goPrev(); });
  nextBtn?.addEventListener('click', (e) => { e.stopPropagation(); goNext(); });

  // ── Mouse wheel zoom ─────────────────────────────────────────────────
  stage.addEventListener('wheel', (e) => {
    e.preventDefault();
    scale = Math.max(1, Math.min(6, scale * (e.deltaY < 0 ? 1.15 : 0.87)));
    clamp(); applyTransform();
  }, { passive: false });

  // ── Mouse drag (pan when zoomed) ─────────────────────────────────────
  stage.addEventListener('mousedown', (e) => {
    if (scale <= 1) return;
    dragging = true; dragX = e.clientX; dragY = e.clientY; applyTransform();
  });
  const onMouseMove = (e) => {
    if (!dragging) return;
    tx += e.clientX - dragX; ty += e.clientY - dragY;
    dragX = e.clientX; dragY = e.clientY;
    clamp(); applyTransform();
  };
  const onMouseUp = () => { dragging = false; applyTransform(); };
  window.addEventListener('mousemove', onMouseMove);
  window.addEventListener('mouseup', onMouseUp);

  // ── Touch: pinch-zoom + pan + swipe-to-navigate ──────────────────────
  let touchStartX = 0, touchStartY = 0, swipeDir = null, swipeDelta = 0;

  stage.addEventListener('touchstart', (e) => {
    if (e.touches.length === 2) {
      pinchDist = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      swipeDir = null;
    } else if (e.touches.length === 1) {
      touchStartX = e.touches[0].clientX;
      touchStartY = e.touches[0].clientY;
      swipeDir = null; swipeDelta = 0;
      if (scale > 1) { dragging = true; dragX = touchStartX; dragY = touchStartY; }
    }
  }, { passive: true });

  stage.addEventListener('touchmove', (e) => {
    if (e.touches.length === 2) {
      e.preventDefault();
      const d = Math.hypot(
        e.touches[0].clientX - e.touches[1].clientX,
        e.touches[0].clientY - e.touches[1].clientY
      );
      if (pinchDist) scale = Math.max(1, Math.min(6, scale * (d / pinchDist)));
      pinchDist = d; clamp(); applyTransform();
      return;
    }
    if (e.touches.length !== 1) return;

    const dx = e.touches[0].clientX - touchStartX;
    const dy = e.touches[0].clientY - touchStartY;

    if (scale > 1) {
      // Zoomed in — pan
      e.preventDefault();
      tx += e.touches[0].clientX - dragX; ty += e.touches[0].clientY - dragY;
      dragX = e.touches[0].clientX; dragY = e.touches[0].clientY;
      clamp(); applyTransform();
      return;
    }

    // Not zoomed — detect swipe direction on first significant move
    if (swipeDir === null && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
      swipeDir = Math.abs(dx) > Math.abs(dy) ? 'h' : 'v';
    }

    if (swipeDir === 'h' && total > 1) {
      e.preventDefault();
      swipeDelta = dx;
      // Drag the image with the finger
      img.style.transform = `translateX(${dx * 0.4}px) scale(1)`;
    }
  }, { passive: false });

  stage.addEventListener('touchend', (e) => {
    if (e.touches.length < 2) pinchDist = 0;
    if (e.touches.length === 0) dragging = false;

    if (swipeDir === 'h' && total > 1) {
      img.style.transition = 'transform 0.2s';
      img.style.transform = 'translateX(0) scale(1)';
      setTimeout(() => { if (img.isConnected) img.style.transition = ''; }, 220);

      if (swipeDelta < -60) goNext();
      else if (swipeDelta > 60) goPrev();
    }
    swipeDir = null; swipeDelta = 0;
  }, { passive: true });

  // ── Tap: single = close backdrop, double = zoom 2.5× ─────────────────
  stage.addEventListener('click', (e) => {
    if (e.target !== img && e.target !== stage) return;
    const now = Date.now();
    if (now - lastTap < 280) {
      scale = scale > 1 ? 1 : 2.5;
      clamp(); applyTransform();
    } else if (scale <= 1 && e.target === stage) {
      closeViewer();
    }
    lastTap = now;
  });

  // ── Keyboard + cleanup ───────────────────────────────────────────────
  function closeViewer() {
    window.removeEventListener('mousemove', onMouseMove);
    window.removeEventListener('mouseup', onMouseUp);
    window.removeEventListener('keydown', onKey);
    overlay.remove();
  }
  function onKey(e) {
    if (e.key === 'Escape')       closeViewer();
    if (e.key === 'ArrowRight')   goNext();
    if (e.key === 'ArrowLeft')    goPrev();
  }
  window.addEventListener('keydown', onKey);
  overlay.querySelector('.img-viewer-close').addEventListener('click', closeViewer);

  // ── Save current image ────────────────────────────────────────────────
  overlay.querySelector('.img-viewer-save').addEventListener('click', async (e) => {
    e.stopPropagation();
    const btn = overlay.querySelector('.img-viewer-save');
    btn.textContent = '…'; btn.disabled = true;
    try {
      const url = imgCache.get(allFileIds[currentIdx]);
      if (!url) throw new Error('Not loaded');
      const res = await fetch(url);
      const blob = await res.blob();
      const ext = (blob.type.split('/')[1] || 'jpg').replace('jpeg', 'jpg');
      const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `PaVa_photo_${ts}.${ext}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 15000);
    } catch { /* silently ignore */ }
    finally { btn.textContent = '⬇ Save'; btn.disabled = false; }
  });

  document.body.appendChild(overlay);
  showAt(currentIdx);
}

function openPollCreatorModal(onCreatePoll) {
  document.getElementById('pava-poll-modal')?.remove();
  const el = document.createElement('div');
  el.id = 'pava-poll-modal';
  el.innerHTML = `
    <div class="admin-modal-overlay" style="z-index:4000">
      <div class="admin-modal" style="max-width:360px">
        <div class="admin-modal-header">
          <h3>📊 Create Poll</h3>
          <button class="admin-modal-close" id="pava-poll-close" aria-label="Close">✕</button>
        </div>
        <div class="admin-modal-body">
          <label class="admin-field-label">Question</label>
          <input id="pava-poll-q" class="admin-field-input" type="text" placeholder="Ask a question…" maxlength="200" autocomplete="off" />
          <label class="admin-field-label" style="margin-top:12px">Options <span class="admin-field-hint">(2–6)</span></label>
          <div id="pava-poll-opts">
            <div class="poll-opt-row">
              <input class="admin-field-input poll-opt-input" placeholder="Option 1" maxlength="100" />
              <button type="button" class="poll-opt-del secondary-button" style="display:none">✕</button>
            </div>
            <div class="poll-opt-row">
              <input class="admin-field-input poll-opt-input" placeholder="Option 2" maxlength="100" />
              <button type="button" class="poll-opt-del secondary-button" style="display:none">✕</button>
            </div>
          </div>
          <button type="button" id="pava-poll-add" class="secondary-button" style="margin-top:8px;font-size:13px">+ Add option</button>
          <p id="pava-poll-err" class="error-text" style="display:none;margin-top:8px"></p>
        </div>
        <div class="admin-modal-footer">
          <button class="secondary-button" id="pava-poll-cancel">Cancel</button>
          <button class="primary-button" id="pava-poll-submit">📊 Create Poll</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);

  const optsEl = document.getElementById('pava-poll-opts');
  const addBtn = document.getElementById('pava-poll-add');
  const errEl  = document.getElementById('pava-poll-err');

  function refreshDeleteBtns() {
    const rows = optsEl.querySelectorAll('.poll-opt-row');
    rows.forEach(r => { r.querySelector('.poll-opt-del').style.display = rows.length > 2 ? '' : 'none'; });
  }

  function wireDeleteBtn(row) {
    row.querySelector('.poll-opt-del').addEventListener('click', () => {
      row.remove();
      refreshDeleteBtns();
      if (optsEl.querySelectorAll('.poll-opt-row').length < 6) addBtn.style.display = '';
    });
  }

  optsEl.querySelectorAll('.poll-opt-row').forEach(wireDeleteBtn);
  refreshDeleteBtns();

  addBtn.addEventListener('click', () => {
    const count = optsEl.querySelectorAll('.poll-opt-row').length;
    if (count >= 6) return;
    const row = document.createElement('div');
    row.className = 'poll-opt-row';
    row.innerHTML = `<input class="admin-field-input poll-opt-input" placeholder="Option ${count + 1}" maxlength="100" /><button type="button" class="poll-opt-del secondary-button">✕</button>`;
    optsEl.appendChild(row);
    wireDeleteBtn(row);
    refreshDeleteBtns();
    if (count + 1 >= 6) addBtn.style.display = 'none';
    row.querySelector('input').focus();
  });

  const close = () => el.remove();
  document.getElementById('pava-poll-close').addEventListener('click', close);
  document.getElementById('pava-poll-cancel').addEventListener('click', close);
  el.querySelector('.admin-modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) close(); });

  document.getElementById('pava-poll-submit').addEventListener('click', async () => {
    const question = document.getElementById('pava-poll-q').value.trim();
    const options = [...optsEl.querySelectorAll('.poll-opt-input')].map(i => i.value.trim()).filter(Boolean);
    if (!question) { errEl.textContent = 'Question is required'; errEl.style.display = ''; return; }
    if (options.length < 2) { errEl.textContent = 'Add at least 2 options'; errEl.style.display = ''; return; }
    errEl.style.display = 'none';
    const btn = document.getElementById('pava-poll-submit');
    btn.disabled = true; btn.textContent = 'Creating…';
    try {
      await onCreatePoll?.(question, options);
      close();
    } catch (err) {
      errEl.textContent = err?.message || 'Failed to create poll';
      errEl.style.display = '';
      btn.disabled = false; btn.textContent = '📊 Create Poll';
    }
  });

  document.getElementById('pava-poll-q').focus();
}

function openScheduleModal(text, onScheduleMessage) {
  document.getElementById('pava-schedule-modal')?.remove();
  const el = document.createElement('div');
  el.id = 'pava-schedule-modal';
  // Default to 1 hour from now
  const defaultDate = new Date(Date.now() + 60 * 60 * 1000);
  const toLocal = (d) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  el.innerHTML = `
    <div class="admin-modal-overlay" style="z-index:4000">
      <div class="admin-modal" style="max-width:340px">
        <div class="admin-modal-header">
          <h3>Schedule Message</h3>
          <button class="admin-modal-close" id="pava-sched-close" aria-label="Close">✕</button>
        </div>
        <div class="admin-modal-body">
          <p class="admin-field-hint" style="margin-bottom:8px">Message: <em>${escapeHtml(text.slice(0, 80))}${text.length > 80 ? '…' : ''}</em></p>
          <label class="admin-field-label">Send at</label>
          <input id="pava-sched-dt" class="admin-field-input" type="datetime-local"
            value="${toLocal(defaultDate)}"
            min="${toLocal(new Date(Date.now() + 60000))}" />
          <p id="pava-sched-err" class="error-text" style="display:none"></p>
        </div>
        <div class="admin-modal-footer">
          <button class="secondary-button" id="pava-sched-cancel">Cancel</button>
          <button class="primary-button" id="pava-sched-submit">🕐 Schedule</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  document.getElementById('pava-sched-close').addEventListener('click', close);
  document.getElementById('pava-sched-cancel').addEventListener('click', close);
  el.querySelector('.admin-modal-overlay').addEventListener('click', (e) => { if (e.target === e.currentTarget) close(); });
  document.getElementById('pava-sched-submit').addEventListener('click', async () => {
    const dtVal = document.getElementById('pava-sched-dt').value;
    const errEl = document.getElementById('pava-sched-err');
    if (!dtVal) { errEl.textContent = 'Pick a date and time'; errEl.style.display = ''; return; }
    const scheduledAt = new Date(dtVal).toISOString();
    if (new Date(scheduledAt) <= new Date()) { errEl.textContent = 'Time must be in the future'; errEl.style.display = ''; return; }
    errEl.style.display = 'none';
    const btn = document.getElementById('pava-sched-submit');
    btn.disabled = true; btn.textContent = 'Scheduling…';
    try {
      await onScheduleMessage?.(text, scheduledAt);
      close();
    } catch (err) {
      errEl.textContent = err?.message || 'Schedule failed';
      errEl.style.display = '';
      btn.disabled = false; btn.textContent = '🕐 Schedule';
    }
  });
}

export function bindChatThreadView(root, { onSubmit, onTyping, onLoadMore, onRetry, onBack, onOpenViewOnce, onToggleViewOnce, onSetDeleteAfter, onSetBurn, onToggleSilent, onClearSilent, onScheduleMessage, onDeleteMessage, onReact, onPin, onUnpin, onForwardMessage, onCreatePoll, onStarMessage, chatId, chatTitle, isMonitoring, currentUserId }) {
  const form = root.querySelector('[data-role="thread-form"]');
  const input = root.querySelector('[data-role="composer-input"]');

  // ── View-once ──────────────────────────────────────────────────────────
  root.querySelectorAll('[data-role="open-view-once"]').forEach((el) => {
    el.addEventListener('click', () => {
      const messageId = el.dataset.messageId;
      const type = el.dataset.voType || 'text';
      const fileId = el.dataset.voFileId;
      const text = el.dataset.voText || '';

      onOpenViewOnce?.(messageId); // notify store + backend immediately

      if ((type === 'image' || type === 'video') && fileId) {
        // Show fullscreen overlay; bubble stays as "Opened" after close
        el.innerHTML = `<p class="message-text view-once-opened">👁 Opened</p><footer class="message-meta"></footer>`;
        el.classList.remove('view-once-tap');
        el.removeAttribute('data-role');
        openViewOnceMediaOverlay(type, fileId);
      } else {
        revealViewOnceText(el, text);
      }
    });
  });

  root.querySelector('[data-role="toggle-view-once"]')?.addEventListener('click', () => onToggleViewOnce?.());
  root.querySelector('[data-role="delete-after-select"]')?.addEventListener('change', (e) => onSetDeleteAfter?.(e.target.value));
  root.querySelector('[data-role="burn-select"]')?.addEventListener('change', (e) => onSetBurn?.(e.target.value));
  root.querySelector('[data-role="toggle-silent"]')?.addEventListener('click', () => onToggleSilent?.());
  root.querySelector('[data-role="clear-composer-modes"]')?.addEventListener('click', () => {
    onSetBurn?.('off');
    onClearSilent?.();
    onSetDeleteAfter?.('never');
    // Clear view-once only if it was active (chip exists in the mode bar)
    if (root.querySelector('.composer-mode-chip')) {
      const voChip = root.querySelector('.composer-mode-bar')?.textContent?.includes('👁');
      if (voChip) onToggleViewOnce?.();
    }
  });
  root.querySelector('[data-role="schedule-message"]')?.addEventListener('click', () => {
    const text = input?.value?.trim();
    if (!text) { input?.focus(); return; }
    openScheduleModal(text, onScheduleMessage);
  });
  root.querySelector('[data-role="create-poll"]')?.addEventListener('click', () => {
    openPollCreatorModal(onCreatePoll);
  });
  root.querySelector('[data-role="thread-back"]')?.addEventListener('click', () => onBack?.());

  // ── Composer input ──────────────────────────────────────────────────────
  if (input) {
    autoGrow(input);
    input.addEventListener('input', () => { onTyping?.('start'); autoGrow(input); });
    input.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && !event.shiftKey) {
        event.preventDefault();
        form?.requestSubmit();
      }
    });
  }

  // ── Reply state ─────────────────────────────────────────────────────────
  let replyTo = null;

  function showReply({ messageId, text, senderDisplayName }) {
    replyTo = { messageId, text, senderDisplayName };
    const bar = root.querySelector('[data-role="reply-preview-bar"]');
    const textEl = root.querySelector('[data-role="reply-preview-text"]');
    if (!bar || !textEl) return;
    const preview = (senderDisplayName ? `${senderDisplayName}: ` : '') + text.slice(0, 60) + (text.length > 60 ? '…' : '');
    textEl.textContent = preview;
    bar.classList.remove('hidden');
    input?.focus();
  }

  function clearReply() {
    replyTo = null;
    root.querySelector('[data-role="reply-preview-bar"]')?.classList.add('hidden');
  }

  root.querySelector('[data-role="cancel-reply"]')?.addEventListener('click', clearReply);

  // ── Form submit ─────────────────────────────────────────────────────────
  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (!input || input.disabled) return;

    let value = input.value;
    if (!value.trim()) return;

    if (replyTo) {
      const name = replyTo.senderDisplayName || '';
      const preview = replyTo.text.slice(0, 80).replace(/\n/g, ' ');
      value = `> ${name ? name + ': ' : ''}${preview}\n${value}`;
      clearReply();
    }

    onTyping?.('stop');
    input.value = '';
    autoGrow(input);
    await onSubmit(value);
    const nextInput = root.querySelector('[data-role="composer-input"]');
    nextInput?.focus();
  });

  // ── Swipe to reply ──────────────────────────────────────────────────────
  // IMPORTANT: touchmove must be non-passive so we can preventDefault() to
  // stop the scroll container from hijacking horizontal swipe gestures.
  root.querySelectorAll('.message-bubble[data-message-id]').forEach((bubble) => {
    let startX = 0;
    let startY = 0;
    let direction = null; // null=undecided, 'h'=horizontal, 'v'=vertical
    let indicator = null;

    bubble.addEventListener('touchstart', (e) => {
      startX = e.touches[0].clientX;
      startY = e.touches[0].clientY;
      direction = null;
      indicator?.remove();
      indicator = null;
      bubble.style.transition = 'none';
    }, { passive: true });

    bubble.addEventListener('touchmove', (e) => {
      const deltaX = e.touches[0].clientX - startX;
      const deltaY = e.touches[0].clientY - startY;

      // Determine direction on first significant movement
      if (direction === null && (Math.abs(deltaX) > 6 || Math.abs(deltaY) > 6)) {
        direction = Math.abs(deltaX) > Math.abs(deltaY) ? 'h' : 'v';
      }

      if (direction !== 'h') return; // vertical scroll — don't interfere

      e.preventDefault(); // prevent scroll container from stealing the gesture

      if (deltaX > 0 && deltaX < 100) {
        bubble.style.transform = `translateX(${Math.round(deltaX * 0.65)}px)`;
        if (!indicator) {
          indicator = document.createElement('span');
          indicator.className = 'swipe-reply-icon';
          indicator.textContent = '↩';
          bubble.appendChild(indicator);
        }
        indicator.style.opacity = String(Math.min(1, deltaX / 50));
      }
    }, { passive: false }); // non-passive required for preventDefault

    bubble.addEventListener('touchend', (e) => {
      const deltaX = e.changedTouches[0].clientX - startX;

      bubble.style.transition = 'transform 0.22s cubic-bezier(0.25, 0.46, 0.45, 0.94)';
      bubble.style.transform = '';
      setTimeout(() => { bubble.style.transition = ''; }, 230);

      indicator?.remove();
      indicator = null;

      if (direction === 'h' && deltaX >= 50) {
        const messageId = bubble.dataset.messageId;
        const rawText = bubble.querySelector('.message-text')?.textContent
          || (bubble.querySelector('.img-bubble') ? '📷 Image' : '')
          || (bubble.querySelector('.vid-bubble') ? '▶ Video' : '');
        const senderName = bubble.querySelector('.bubble-sender')?.textContent || '';
        showReply({ messageId, text: rawText, senderDisplayName: senderName });
      }
      direction = null;
    }, { passive: true });
  });

  // ── Image bubbles ───────────────────────────────────────────────────────
  // Collect all image fileIds in DOM order for viewer navigation
  function getAllImgFileIds() {
    return [...root.querySelectorAll('[data-role="img-bubble"]')].map(b => b.dataset.fileId);
  }

  root.querySelectorAll('[data-role="img-bubble"]').forEach((bubble) => {
    const fileId = bubble.dataset.fileId;

    bubble.addEventListener('click', async () => {
      const view = bubble.dataset.view;

      if (view === 'placeholder') {
        bubble.dataset.view = 'loading';
        bubble.innerHTML = '<span class="img-bubble-spinner">⏳</span>';

        try {
          let url = imgCache.get(fileId);
          if (!url) {
            const blob = await requestMediaBlob(fileId);
            url = URL.createObjectURL(blob);
            imgCacheSet(fileId, url);
          }
          bubble.dataset.view = 'blurred';
          bubble.style.backgroundImage = `url('${url}')`;
          bubble.innerHTML = '';
          // Open viewer immediately after first load
          const allIds = getAllImgFileIds();
          openImageViewer(allIds, allIds.indexOf(fileId));
        } catch {
          bubble.dataset.view = 'placeholder';
          bubble.innerHTML = '<span class="img-bubble-icon">📷</span><span class="img-bubble-label">Image</span>';
        }
      } else if (view === 'blurred') {
        const allIds = getAllImgFileIds();
        openImageViewer(allIds, allIds.indexOf(fileId));
      }
    });

    // Prevent long-press save on the image bubble
    bubble.addEventListener('contextmenu', e => e.preventDefault());
  });

  // ── Video bubbles ───────────────────────────────────────────────────────
  root.querySelectorAll('[data-role="vid-bubble"]').forEach((bubble) => {
    const fileId = bubble.dataset.fileId;

    bubble.addEventListener('click', async () => {
      if (bubble.dataset.view !== 'placeholder') return;
      bubble.dataset.view = 'loading';
      bubble.innerHTML = '<span class="img-bubble-spinner">⏳</span>';
      try {
        let url = imgCache.get(fileId);
        if (!url) {
          const blob = await requestMediaBlob(fileId);
          url = URL.createObjectURL(blob);
          imgCacheSet(fileId, url);
        }
        bubble.dataset.view = 'ready';
        bubble.innerHTML = `
          <video class="vid-player" src="${url}" controls playsinline
            controlsList="nodownload"></video>
          <button class="vid-save-btn" aria-label="Save video">⬇ Save</button>
        `;
        bubble.querySelector('video')?.play().catch(() => {});
        bubble.querySelector('.vid-save-btn')?.addEventListener('click', async (e) => {
          e.stopPropagation();
          const btn = e.currentTarget;
          btn.textContent = '…'; btn.disabled = true;
          try {
            const res = await fetch(url);
            const blob = await res.blob();
            const ext = blob.type.includes('webm') ? 'webm' : 'mp4';
            const ts = new Date().toISOString().slice(0, 19).replace('T', '_').replace(/:/g, '-');
            const a = document.createElement('a');
            a.href = URL.createObjectURL(blob);
            a.download = `PaVa_video_${ts}.${ext}`;
            a.click();
            setTimeout(() => URL.revokeObjectURL(a.href), 15000);
          } catch { /* silently ignore */ } finally {
            btn.textContent = '⬇ Save'; btn.disabled = false;
          }
        });
      } catch {
        bubble.dataset.view = 'placeholder';
        bubble.innerHTML = '<span class="vid-bubble-icon">▶</span><span class="vid-bubble-label">Video</span>';
      }
    });

    bubble.addEventListener('contextmenu', e => e.preventDefault());
  });

  // ── In-app camera (getUserMedia — no device timestamp watermarks) ───────
  // Tap shutter = photo. Hold shutter (>250 ms) = video recording.
  let cameraStream = null;
  let cameraFacing = 'environment';

  function bestVideoMime() {
    const types = [
      'video/mp4;codecs=avc1,mp4a',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ];
    return types.find(t => MediaRecorder.isTypeSupported(t)) || '';
  }

  async function openCamera(onCapture) {
    document.getElementById('pava-camera')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'pava-camera';
    overlay.className = 'pava-camera-overlay';
    overlay.innerHTML = `
      <video class="pava-camera-video" autoplay playsinline muted></video>
      <div class="pava-camera-hint">Tap for photo · Hold for video</div>
      <div class="pava-camera-rec hidden"><span class="pava-camera-reddot"></span><span class="pava-camera-timer">0:00</span></div>
      <div class="pava-camera-bar">
        <button class="pava-camera-flip" aria-label="Flip camera">🔄</button>
        <button class="pava-camera-shutter" aria-label="Take photo or record video"></button>
        <button class="pava-camera-close" aria-label="Close">✕</button>
      </div>
    `;
    document.body.appendChild(overlay);

    const video      = overlay.querySelector('.pava-camera-video');
    const shutterBtn = overlay.querySelector('.pava-camera-shutter');
    const recBar     = overlay.querySelector('.pava-camera-rec');
    const timerEl    = overlay.querySelector('.pava-camera-timer');
    const hint       = overlay.querySelector('.pava-camera-hint');

    async function startStream(facing) {
      if (cameraStream) cameraStream.getTracks().forEach(t => t.stop());
      try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
          video: { facingMode: facing, width: { ideal: 1920 }, height: { ideal: 1080 } },
          audio: true
        });
        video.srcObject = cameraStream;
      } catch {
        alert('Cannot access camera. Please allow camera permission in your browser settings.');
        overlay.remove();
        cameraStream = null;
      }
    }

    function closeCamera() {
      clearInterval(recInterval);
      if (mediaRec?.state === 'recording') mediaRec.stop();
      if (cameraStream) { cameraStream.getTracks().forEach(t => t.stop()); cameraStream = null; }
      overlay.remove();
    }

    overlay.querySelector('.pava-camera-close').addEventListener('click', closeCamera);
    overlay.querySelector('.pava-camera-flip').addEventListener('click', () => {
      cameraFacing = cameraFacing === 'environment' ? 'user' : 'environment';
      startStream(cameraFacing);
    });

    // Tap = photo; hold >250ms = video
    let holdTimer = null;
    let mediaRec = null;
    let recChunks = [];
    let recInterval = null;
    let recSecs = 0;

    function capturePhoto() {
      if (!cameraStream) return;
      const canvas = document.createElement('canvas');
      canvas.width  = video.videoWidth  || 1280;
      canvas.height = video.videoHeight || 720;
      const ctx = canvas.getContext('2d');
      if (cameraFacing === 'user') { ctx.translate(canvas.width, 0); ctx.scale(-1, 1); }
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => {
        if (!blob) return;
        closeCamera();
        onCapture(new File([blob], 'photo.jpg', { type: 'image/jpeg' }), 'image');
      }, 'image/jpeg', 0.92);
    }

    function startVideoRec() {
      if (!cameraStream) return;
      const mime = bestVideoMime();
      if (!mime) { alert('Video recording is not supported in this browser.'); return; }
      recChunks = [];
      mediaRec = new MediaRecorder(cameraStream, { mimeType: mime });
      mediaRec.ondataavailable = e => { if (e.data.size > 0) recChunks.push(e.data); };
      mediaRec.onstop = () => {
        const mimeBase = mime.split(';')[0];
        const ext = mimeBase === 'video/mp4' ? 'mp4' : 'webm';
        const blob = new Blob(recChunks, { type: mimeBase });
        closeCamera();
        onCapture(new File([blob], `video.${ext}`, { type: mimeBase }), 'video');
      };
      mediaRec.start();
      // UI
      hint.classList.add('hidden');
      recBar.classList.remove('hidden');
      shutterBtn.classList.add('recording');
      recSecs = 0;
      recInterval = setInterval(() => {
        recSecs++;
        const m = Math.floor(recSecs / 60);
        const s = String(recSecs % 60).padStart(2, '0');
        timerEl.textContent = `${m}:${s}`;
        if (recSecs >= 120) stopVideoRec(); // 2-min cap
      }, 1000);
    }

    function stopVideoRec() {
      clearInterval(recInterval);
      if (mediaRec?.state === 'recording') mediaRec.stop();
      shutterBtn.classList.remove('recording');
    }

    shutterBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      holdTimer = setTimeout(() => {
        holdTimer = null;
        startVideoRec();
      }, 250);
    });

    shutterBtn.addEventListener('pointerup', () => {
      if (holdTimer !== null) {
        clearTimeout(holdTimer);
        holdTimer = null;
        capturePhoto();
      } else {
        stopVideoRec();
      }
    });

    shutterBtn.addEventListener('pointerleave', () => {
      if (holdTimer !== null) { clearTimeout(holdTimer); holdTimer = null; }
    });

    await startStream(cameraFacing);
  }

  // ── Image upload ────────────────────────────────────────────────────────
  const galleryInput = root.querySelector('[data-role="gallery-input"]');
  const attachBtn    = root.querySelector('[data-role="attach-image"]');
  const imgMenu      = root.querySelector('[data-role="img-source-menu"]');
  let imgMenuOpen = false;

  function toggleImgMenu(e) {
    e.stopPropagation();
    imgMenuOpen = !imgMenuOpen;
    imgMenu?.classList.toggle('hidden', !imgMenuOpen);
  }
  function closeImgMenu() {
    imgMenuOpen = false;
    imgMenu?.classList.add('hidden');
  }

  attachBtn?.addEventListener('click', toggleImgMenu);
  root.querySelector('[data-role="pick-gallery"]')?.addEventListener('click', (e) => {
    e.stopPropagation(); closeImgMenu(); galleryInput?.click();
  });
  root.querySelector('[data-role="pick-camera"]')?.addEventListener('click', async (e) => {
    e.stopPropagation(); closeImgMenu();
    await openCamera((file) => uploadAndSendFile(file));
  });
  if (_activeCloseImgMenu) {
    document.removeEventListener('click', _activeCloseImgMenu);
  }
  _activeCloseImgMenu = closeImgMenu;
  document.addEventListener('click', closeImgMenu);

  // Resize + re-encode only if necessary. Small files (≤500KB) are sent as-is
  // to avoid double-compression quality loss. Larger files are resized to
  // 1920px max and re-encoded as JPEG 90% — visually lossless for chat.
  async function compressImage(file, maxDim = 1920, quality = 0.90) {
    if (file.size <= 500 * 1024) return file; // already small enough, skip canvas
    return new Promise((resolve, reject) => {
      const img = new Image();
      const blobUrl = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(blobUrl);
        let { width, height } = img;
        if (width > maxDim || height > maxDim) {
          if (width >= height) { height = Math.round(height * maxDim / width); width = maxDim; }
          else                 { width = Math.round(width * maxDim / height);  height = maxDim; }
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        canvas.getContext('2d').drawImage(img, 0, 0, width, height);
        canvas.toBlob(blob => blob ? resolve(blob) : reject(new Error('Compression failed')), 'image/jpeg', quality);
      };
      img.onerror = () => { URL.revokeObjectURL(blobUrl); reject(new Error('Could not read image')); };
      img.src = blobUrl;
    });
  }

  async function uploadAndSendFile(file) {
    const isVid = file.type.startsWith('video/');
    const isImg = file.type.startsWith('image/');
    if (!isImg && !isVid) { alert('Please select an image or video file.'); return; }
    attachBtn.disabled = true;
    attachBtn.textContent = '⏳';
    try {
      let result;
      if (isVid) {
        result = await uploadVideoBlob(file, file.type.split(';')[0]);
        await onSubmit(`__VID__:${result.fileId}`);
      } else {
        const compressed = await compressImage(file);
        const base64 = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = e => resolve(e.target.result.split(',')[1]);
          reader.onerror = reject;
          reader.readAsDataURL(compressed);
        });
        result = await uploadMedia({ data: base64, mimeType: 'image/jpeg' });
        await onSubmit(`__IMG__:${result.fileId}`);
      }
    } catch (err) {
      alert('Failed to send: ' + (err.message || 'Unknown error'));
    } finally {
      attachBtn.disabled = false;
      attachBtn.textContent = '＋';
    }
  }

  function handleImageFile(input) {
    const file = input.files?.[0];
    if (!file) return;
    uploadAndSendFile(file).finally(() => { input.value = ''; });
  }

  galleryInput?.addEventListener('change', () => handleImageFile(galleryInput));

  // ── Document upload ─────────────────────────────────────────────────────
  const docInput = root.querySelector('[data-role="doc-input"]');
  root.querySelector('[data-role="pick-doc"]')?.addEventListener('click', (e) => {
    e.stopPropagation(); closeImgMenu(); docInput?.click();
  });
  docInput?.addEventListener('change', async () => {
    const file = docInput.files?.[0];
    if (!file) return;
    docInput.value = '';
    const btn = root.querySelector('[data-role="attach-image"]');
    if (btn) { btn.disabled = true; btn.textContent = '⏳'; }
    try {
      const result = await uploadBinaryBlob(file, file.type || 'application/octet-stream');
      const safeName = file.name.replace(/:/g, '_');
      await onSubmit(`__DOC__:${result.fileId}:${safeName}`);
    } catch (err) {
      alert('Failed to send file: ' + (err.message || 'Unknown error'));
    } finally {
      if (btn) { btn.disabled = false; btn.textContent = '＋'; }
    }
  });

  // ── Document download ───────────────────────────────────────────────────
  root.querySelectorAll('[data-role="doc-download"]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const bubble = btn.closest('[data-role="doc-bubble"]');
      const fileId = bubble?.dataset.fileId;
      const filename = bubble?.dataset.filename || 'document';
      if (!fileId) return;
      btn.textContent = '⏳'; btn.disabled = true;
      try {
        const blob = await requestMediaBlob(fileId);
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = filename;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 15000);
      } catch { alert('Download failed'); }
      finally { btn.textContent = '⬇'; btn.disabled = false; }
    });
  });

  // ── Audio bubbles ───────────────────────────────────────────────────────
  root.querySelectorAll('[data-role="aud-bubble"]').forEach((bubble) => {
    const fileId = bubble.dataset.fileId;
    const playBtn = bubble.querySelector('.aud-play-btn');
    let audio = null;
    playBtn?.addEventListener('click', async () => {
      if (audio) {
        if (audio.paused) { audio.play(); playBtn.textContent = '⏸'; }
        else { audio.pause(); playBtn.textContent = '▶'; }
        return;
      }
      playBtn.textContent = '⏳';
      try {
        const blob = await requestMediaBlob(fileId);
        const url = URL.createObjectURL(blob);
        audio = new Audio(url);
        const dur = bubble.querySelector('.aud-duration');
        audio.addEventListener('loadedmetadata', () => {
          if (dur && isFinite(audio.duration)) {
            const m = Math.floor(audio.duration / 60);
            const s = String(Math.floor(audio.duration % 60)).padStart(2, '0');
            dur.textContent = `${m}:${s}`;
          }
        });
        audio.addEventListener('ended', () => { playBtn.textContent = '▶'; audio = null; });
        audio.play();
        playBtn.textContent = '⏸';
      } catch { playBtn.textContent = '▶'; alert('Could not play audio'); }
    });
  });

  // ── Voice recording (mic button) ────────────────────────────────────────
  const micBtn = root.querySelector('[data-role="mic-record"]');
  let micRec = null;
  let micChunks = [];
  let micStream = null;
  let micHoldTimer = null;
  let micRecording = false;

  async function startMicRecording() {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus'
                 : MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/ogg';
      micChunks = [];
      micRec = new MediaRecorder(micStream, { mimeType: mime });
      micRec.ondataavailable = e => { if (e.data.size > 0) micChunks.push(e.data); };
      micRec.start();
      micRecording = true;
      micBtn.classList.add('mic-recording');
      micBtn.textContent = '⏹';
    } catch {
      alert('Microphone permission denied. Please allow microphone access.');
    }
  }

  async function stopMicRecording() {
    micRecording = false;
    micBtn.classList.remove('mic-recording');
    micBtn.textContent = '🎤';
    if (!micRec || micRec.state === 'inactive') return;
    return new Promise((resolve) => {
      micRec.onstop = async () => {
        micStream?.getTracks().forEach(t => t.stop());
        micStream = null;
        if (!micChunks.length) { resolve(); return; }
        const mimeBase = micRec.mimeType.split(';')[0];
        const blob = new Blob(micChunks, { type: mimeBase });
        if (blob.size < 500) { resolve(); return; } // too short
        micBtn.disabled = true; micBtn.textContent = '⏳';
        try {
          const result = await uploadBinaryBlob(blob, mimeBase, '/api/v3/media/upload-binary');
          await onSubmit(`__AUD__:${result.fileId}`);
        } catch (err) {
          alert('Failed to send voice note: ' + (err.message || 'Unknown error'));
        } finally {
          micBtn.disabled = false; micBtn.textContent = '🎤';
        }
        resolve();
      };
      micRec.stop();
    });
  }

  if (micBtn) {
    micBtn.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      micHoldTimer = setTimeout(() => { micHoldTimer = null; startMicRecording(); }, 300);
    });
    micBtn.addEventListener('pointerup', () => {
      if (micHoldTimer !== null) { clearTimeout(micHoldTimer); micHoldTimer = null; return; }
      if (micRecording) stopMicRecording();
    });
    micBtn.addEventListener('pointerleave', () => {
      if (micHoldTimer !== null) { clearTimeout(micHoldTimer); micHoldTimer = null; }
    });
    micBtn.addEventListener('click', (e) => e.preventDefault());
  }

  // ── Long-press context menu ─────────────────────────────────────────────
  const QUICK_EMOJIS = ['❤️', '👍', '😂', '😮', '😢', '🙏'];

  function closeContextMenu() {
    document.getElementById('pava-ctx-menu')?.remove();
  }

  function openContextMenu(bubble, x, y) {
    closeContextMenu();
    const messageId = bubble.dataset.messageId;
    const isOutgoing = bubble.dataset.direction === 'outgoing';
    const rawText = bubble.querySelector('.message-text')?.textContent || '';
    const isMediaBubble = !!bubble.querySelector('[data-role="img-bubble"],[data-role="vid-bubble"],[data-role="aud-bubble"],[data-role="doc-bubble"]');

    const menu = document.createElement('div');
    menu.id = 'pava-ctx-menu';
    menu.className = 'ctx-menu';
    // Quick emoji reactions bar
    menu.innerHTML = `
      <div class="ctx-react-bar">
        ${QUICK_EMOJIS.map(e => `<button class="ctx-react-btn" data-emoji="${e}" aria-label="${e}">${e}</button>`).join('')}
      </div>
      <div class="ctx-actions">
        <button class="ctx-action" data-action="reply">↩ Reply</button>
        ${!isMediaBubble ? `<button class="ctx-action" data-action="copy">📋 Copy</button>` : ''}
        ${isOutgoing && !isMediaBubble ? `<button class="ctx-action" data-action="edit">✏ Edit</button>` : ''}
        <button class="ctx-action" data-action="forward">↪ Forward</button>
        <button class="ctx-action" data-action="pin">📌 Pin</button>
        <button class="ctx-action" data-action="star">⭐ Star</button>
        ${isOutgoing ? `<button class="ctx-action ctx-action-danger" data-action="delete">🗑 Delete</button>` : ''}
      </div>
    `;

    // Position
    const vw = window.innerWidth, vh = window.innerHeight;
    menu.style.cssText = 'position:fixed;z-index:3000;';
    document.body.appendChild(menu);
    const mw = menu.offsetWidth, mh = menu.offsetHeight;
    let left = x, top = y;
    if (left + mw > vw - 8) left = vw - mw - 8;
    if (top + mh > vh - 8) top = y - mh - 8;
    if (top < 8) top = 8;
    menu.style.left = left + 'px';
    menu.style.top = top + 'px';

    // Quick react
    menu.querySelectorAll('.ctx-react-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        closeContextMenu();
        onReact?.(messageId, btn.dataset.emoji);
      });
    });

    // Actions
    menu.querySelectorAll('[data-action]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const action = btn.dataset.action;
        closeContextMenu();
        if (action === 'reply') {
          const senderName = bubble.querySelector('.bubble-sender')?.textContent || '';
          showReply({ messageId, text: rawText, senderDisplayName: senderName });
        } else if (action === 'copy') {
          navigator.clipboard?.writeText(rawText).catch(() => {});
        } else if (action === 'edit') {
          const textEl = bubble.querySelector('.message-text');
          if (!textEl) return;
          const originalText = rawText;
          const editForm = document.createElement('div');
          editForm.className = 'inline-edit-wrap';
          editForm.innerHTML = `
            <textarea class="inline-edit-input" rows="1">${escapeHtml(originalText)}</textarea>
            <div class="inline-edit-actions">
              <button class="inline-edit-save primary-button" type="button">Save</button>
              <button class="inline-edit-cancel secondary-button" type="button">Cancel</button>
            </div>`;
          textEl.replaceWith(editForm);
          const ta = editForm.querySelector('textarea');
          ta.style.height = 'auto';
          ta.style.height = ta.scrollHeight + 'px';
          ta.addEventListener('input', () => { ta.style.height = 'auto'; ta.style.height = ta.scrollHeight + 'px'; });
          ta.focus();
          ta.setSelectionRange(ta.value.length, ta.value.length);
          const doSave = () => {
            const newText = ta.value.trim();
            if (newText && newText !== originalText) {
              editMessage(messageId, newText).catch(() => {});
            }
            editForm.replaceWith(textEl);
          };
          const doCancel = () => editForm.replaceWith(textEl);
          editForm.querySelector('.inline-edit-save').addEventListener('click', doSave);
          editForm.querySelector('.inline-edit-cancel').addEventListener('click', doCancel);
          ta.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); doSave(); }
            if (e.key === 'Escape') doCancel();
          });
        } else if (action === 'forward') {
          onForwardMessage?.(messageId);
        } else if (action === 'pin') {
          onPin?.(messageId);
        } else if (action === 'star') {
          onStarMessage?.(messageId);
        } else if (action === 'delete') {
          // The menu is already closed, so confirm with a dialog rather than a second tap on the item
          if (window.confirm('Delete this message for everyone?')) onDeleteMessage?.(messageId);
        }
      });
    });

    setTimeout(() => document.addEventListener('click', closeContextMenu, { once: true }), 10);
  }

  // Attach long-press + right-click to all message bubbles
  root.querySelectorAll('.message-bubble[data-message-id]').forEach((bubble) => {
    let pressTimer = null;

    bubble.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      openContextMenu(bubble, e.clientX, e.clientY);
    });

    bubble.addEventListener('touchstart', (e) => {
      pressTimer = setTimeout(() => {
        pressTimer = null;
        const t = e.touches[0];
        openContextMenu(bubble, t.clientX, t.clientY);
      }, 500);
    }, { passive: true });

    bubble.addEventListener('touchend', () => {
      if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
    }, { passive: true });

    bubble.addEventListener('touchmove', () => {
      if (pressTimer !== null) { clearTimeout(pressTimer); pressTimer = null; }
    }, { passive: true });
  });

  // ── Reaction chip toggle (tap existing chip to re-react) ─────────────────
  root.querySelectorAll('.reaction-chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      onReact?.(chip.dataset.messageId, chip.dataset.emoji);
    });
  });

  // ── Unpin ───────────────────────────────────────────────────────────────
  root.querySelector('[data-role="unpin-message"]')?.addEventListener('click', () => {
    onUnpin?.();
  });

  // ── Emoji picker ────────────────────────────────────────────────────────
  const emojiBtn = root.querySelector('[data-role="toggle-emoji"]');
  let emojiPicker = null;
  let emojiOpen = false;

  emojiBtn?.addEventListener('click', (e) => {
    e.stopPropagation();
    if (!emojiPicker) {
      emojiPicker = createEmojiPicker((emoji) => {
        const inp = root.querySelector('[data-role="composer-input"]');
        if (!inp) return;
        const start = inp.selectionStart ?? inp.value.length;
        const end = inp.selectionEnd ?? inp.value.length;
        inp.value = inp.value.slice(0, start) + emoji + inp.value.slice(end);
        inp.selectionStart = inp.selectionEnd = start + [...emoji].length;
        autoGrow(inp);
        inp.focus();
        emojiOpen = false;
        emojiPicker.style.display = 'none';
      });
      form?.appendChild(emojiPicker);
    }
    emojiOpen = !emojiOpen;
    emojiPicker.style.display = emojiOpen ? '' : 'none';
  });

  // Close emoji picker on outside click
  function closeEmojiOutside(e) {
    if (emojiOpen && emojiPicker && !emojiPicker.contains(e.target) && e.target !== emojiBtn) {
      emojiOpen = false;
      emojiPicker.style.display = 'none';
    }
  }
  document.addEventListener('click', closeEmojiOutside);
  // Cleanup when the thread unmounts (next render replaces root.innerHTML)
  const observer = new MutationObserver(() => {
    if (!root.contains(form)) {
      document.removeEventListener('click', closeEmojiOutside);
      observer.disconnect();
    }
  });
  if (form) observer.observe(root, { childList: true, subtree: false });

  // ── Poll voting ──────────────────────────────────────────────────────────
  root.querySelectorAll('[data-role="poll-vote"]').forEach((btn) => {
    btn.addEventListener('click', async () => {
      const messageId = btn.dataset.messageId;
      const optionIndex = Number(btn.dataset.optionIndex);
      btn.disabled = true;
      try {
        await votePoll(messageId, optionIndex);
        const data = await fetchPoll(messageId);
        if (data?.poll) {
          const pollBubble = root.querySelector(`.poll-bubble[data-message-id="${messageId}"]`);
          if (pollBubble) {
            const totalVotes = Object.values(data.poll.votes || {}).reduce((s, c) => s + Number(c), 0);
            const opts = data.poll.options.map((opt, idx) => {
              const count = Number(data.poll.votes?.[String(idx)] || 0);
              const pct = totalVotes > 0 ? Math.round((count / totalVotes) * 100) : 0;
              const voted = data.poll.myVote === idx;
              return `<button class="poll-option ${voted ? 'poll-option-voted' : ''}" data-role="poll-vote" data-option-index="${idx}" data-message-id="${messageId}">
                <div class="poll-option-bar" style="width:${pct}%"></div>
                <span class="poll-option-label">${escapeHtml(opt)}</span>
                <span class="poll-option-count">${pct}%</span>
              </button>`;
            }).join('');
            pollBubble.querySelector('.poll-options').innerHTML = opts;
            pollBubble.querySelector('.poll-footer').textContent = `${totalVotes} vote${totalVotes !== 1 ? 's' : ''}`;
          }
        }
      } catch { /* silently ignore */ }
      finally { btn.disabled = false; }
    });
  });

  // ── Link preview fetching (lazy, after render) ────────────────────────────
  const linkPreviewCache = bindChatThreadView._linkCache || (bindChatThreadView._linkCache = new Map());
  root.querySelectorAll('[data-preview-url]').forEach((bubble) => {
    const url = bubble.dataset.previewUrl;
    const slot = bubble.querySelector('[data-role="link-preview-slot"]');
    if (!slot) return;
    const inject = (preview) => {
      if (!preview?.title) return;
      slot.innerHTML = `
        <a class="link-preview-card" href="${escapeHtml(url)}" target="_blank" rel="noopener noreferrer">
          ${preview.image ? `<div class="lp-image" style="background-image:url('${escapeHtml(preview.image)}')"></div>` : ''}
          <div class="lp-body">
            <span class="lp-domain">${escapeHtml(new URL(url).hostname)}</span>
            <strong class="lp-title">${escapeHtml(preview.title.slice(0, 80))}</strong>
            ${preview.description ? `<p class="lp-desc">${escapeHtml(preview.description.slice(0, 120))}</p>` : ''}
          </div>
        </a>
      `;
    };
    if (linkPreviewCache.has(url)) { inject(linkPreviewCache.get(url)); return; }
    fetchLinkPreview(url).then(data => {
      // API returns { success, preview: { title, image_url, description, ... } }
      const preview = data?.preview || data;
      // Normalise image_url → image for the inject function
      const normalised = preview ? { ...preview, image: preview.image_url || preview.image } : null;
      linkPreviewCache.set(url, normalised);
      inject(normalised);
    }).catch(() => {});
  });

  // ── Misc ────────────────────────────────────────────────────────────────
  root.querySelector('[data-role="load-more"]')?.addEventListener('click', () => onLoadMore?.());
  root.querySelector('[data-role="retry-thread"]')?.addEventListener('click', () => onRetry?.());

  root.querySelector('[data-role="open-media-gallery"]')?.addEventListener('click', () => {
    if (chatId) openMediaGallery({ chatId, chatTitle: chatTitle || '', isAdmin: !!isMonitoring });
  });

  root.querySelectorAll('[data-role="delete-message"]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const messageId = btn.dataset.messageId;
      if (!messageId) return;
      if (btn.dataset.confirm === '1') {
        onDeleteMessage?.(messageId);
      } else {
        btn.dataset.confirm = '1';
        btn.textContent = '✓ Delete?';
        btn.classList.add('msg-delete-btn-confirm');
        setTimeout(() => {
          if (btn.isConnected) { btn.dataset.confirm = ''; btn.textContent = '✕'; btn.classList.remove('msg-delete-btn-confirm'); }
        }, 3000);
      }
    });
  });


  root.querySelectorAll('[data-role="sys-update-reload"]').forEach((btn) => {
    btn.addEventListener('click', () => window.location.reload());
  });
}
