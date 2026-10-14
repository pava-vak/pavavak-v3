export function escapeHtml(value) {
  return String(value || '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
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
