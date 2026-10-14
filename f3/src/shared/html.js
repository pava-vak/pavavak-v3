export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// Matches a full emoji sequence: base + optional skin tone + optional ZWJ chain
const EMOJI_SEQ_RE = /\p{Extended_Pictographic}(?:️|⃣)?(?:[\u{1F3FB}-\u{1F3FF}])?(?:‍(?:\p{Extended_Pictographic}(?:️)?(?:[\u{1F3FB}-\u{1F3FF}])?))*(?:️)?/gu;

// Returns true if the text contains ONLY emoji (and whitespace)
export function isEmojiOnly(text) {
  const t = String(text || '').trim();
  if (!t) return false;
  return t.replace(EMOJI_SEQ_RE, '').trim().length === 0;
}

// Counts emoji sequences in a string
export function countEmoji(text) {
  return (String(text || '').match(EMOJI_SEQ_RE) || []).length;
}

export function formatMessagePreview(text) {
  if (!text) return 'No messages yet';
  if (text === '__SYS_UPDATE__') return '🔄 App update';
  if (text.startsWith('__IMG__:')) return '📷 Image';
  if (text.startsWith('__VID__:')) return '🎥 Video';
  if (text.startsWith('> ')) {
    const nl = text.indexOf('\n');
    return nl !== -1 ? text.slice(nl + 1).trim() : text;
  }
  return text;
}

// Escape text but auto-link URLs as clickable <a> tags
export function linkifyHtml(text) {
  const urlRe = /(https?:\/\/[^\s<>"')\]]+)/g;
  const parts = String(text || '').split(urlRe);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const escaped = escapeHtml(part);
      return `<a href="${escaped}" target="_blank" rel="noopener noreferrer" class="msg-link">${escaped}</a>`;
    }
    return escapeHtml(part);
  }).join('');
}

// Like linkifyHtml but also wraps emoji sequences with <span class="inline-emoji"> for size boost
function wrapInlineEmoji(text) {
  const re = new RegExp(EMOJI_SEQ_RE.source, 'gu');
  let result = '';
  let lastIndex = 0;
  let match;
  while ((match = re.exec(text)) !== null) {
    result += escapeHtml(text.slice(lastIndex, match.index));
    result += `<span class="inline-emoji">${match[0]}</span>`;
    lastIndex = re.lastIndex;
  }
  result += escapeHtml(text.slice(lastIndex));
  return result;
}

export function linkifyAndEmojiHtml(text) {
  const urlRe = /(https?:\/\/[^\s<>"')\]]+)/g;
  const parts = String(text || '').split(urlRe);
  return parts.map((part, i) => {
    if (i % 2 === 1) {
      const escaped = escapeHtml(part);
      return `<a href="${escaped}" target="_blank" rel="noopener noreferrer" class="msg-link">${escaped}</a>`;
    }
    return wrapInlineEmoji(part);
  }).join('');
}
