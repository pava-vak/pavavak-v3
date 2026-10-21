// Device-only privacy settings: hidden chats live in this browser and are never sent to the server.
import { escapeHtml } from './html.js';
import { hasEnrolledLocally, hasPin, isEnabled, verify, verifyPin } from './biometricLock.js';

const hiddenKey = (userId) => `pava-hidden-chats-${userId}`;

export function getHiddenChats(userId) {
  if (!userId) return new Set();
  try {
    return new Set(JSON.parse(localStorage.getItem(hiddenKey(userId)) || '[]'));
  } catch {
    return new Set();
  }
}

export function setChatHidden(userId, chatId, hidden) {
  const next = getHiddenChats(userId);
  if (hidden) next.add(chatId); else next.delete(chatId);
  try { localStorage.setItem(hiddenKey(userId), JSON.stringify([...next])); } catch { /* storage full or blocked */ }
  return next;
}

/**
 * Confirms the person at the screen owns the account before revealing hidden chats:
 * fingerprint/face if enrolled, else the app PIN. With no app lock set, it asks to set one first.
 */
export async function verifyOwner() {
  if (isEnabled() && hasEnrolledLocally()) {
    try { await verify(); return true; } catch { /* fall back to PIN if there is one */ }
  }
  if (hasPin()) return askPin();
  return 'no-lock';
}

function askPin() {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'privacy-pin-overlay';
    overlay.innerHTML = `
      <form class="privacy-pin-card" data-role="privacy-pin-form">
        <h3>Hidden chats</h3>
        <p>Enter your app PIN to continue.</p>
        <input type="password" inputmode="numeric" autocomplete="off" maxlength="12" class="settings-input" data-role="privacy-pin-input" aria-label="PIN" />
        <p class="error-text hidden" data-role="privacy-pin-error">Wrong PIN</p>
        <div class="privacy-pin-actions">
          <button type="button" class="secondary-button" data-role="privacy-pin-cancel">Cancel</button>
          <button type="submit" class="primary-button">Unlock</button>
        </div>
      </form>`;
    document.body.appendChild(overlay);
    const input = overlay.querySelector('[data-role="privacy-pin-input"]');
    const error = overlay.querySelector('[data-role="privacy-pin-error"]');
    const done = (ok) => { overlay.remove(); resolve(ok); };
    input.focus();
    overlay.querySelector('[data-role="privacy-pin-cancel"]').addEventListener('click', () => done(false));
    overlay.addEventListener('keydown', (e) => { if (e.key === 'Escape') done(false); });
    overlay.querySelector('[data-role="privacy-pin-form"]').addEventListener('submit', async (e) => {
      e.preventDefault();
      try {
        await verifyPin(input.value);
        done(true);
      } catch {
        error.classList.remove('hidden');
        input.value = '';
        input.focus();
      }
    });
  });
}

export function renderHiddenChatsModal(chats) {
  return `
    <div class="privacy-pin-overlay" data-role="hidden-chats-overlay">
      <div class="privacy-pin-card hidden-chats-card">
        <h3>Hidden chats</h3>
        <p>Only on this browser. Hidden chats don't appear in your list or make a sound.</p>
        ${chats.length ? `<ul class="hidden-chats-list">
          ${chats.map((c) => `
            <li>
              <button type="button" class="hidden-chat-open" data-role="hidden-chat-open" data-chat-id="${escapeHtml(c.chatId)}">
                <span class="chat-avatar">${escapeHtml(c.avatarText || '?')}</span>
                <span>${escapeHtml(c.title || 'Chat')}${c.unreadCount ? ` <span class="chat-unread">${escapeHtml(String(c.unreadCount))}</span>` : ''}</span>
              </button>
              <button type="button" class="secondary-button" data-role="hidden-chat-unhide" data-chat-id="${escapeHtml(c.chatId)}">Unhide</button>
            </li>`).join('')}
        </ul>` : '<p class="settings-section-sub">No hidden chats. Use 🙈 on a chat to hide it.</p>'}
        <div class="privacy-pin-actions"><button type="button" class="secondary-button" data-role="hidden-chats-close">Close</button></div>
      </div>
    </div>`;
}

export function bindHiddenChatsModal(root, { onOpen, onUnhide, onClose }) {
  root.querySelector('[data-role="hidden-chats-close"]')?.addEventListener('click', onClose);
  root.querySelectorAll('[data-role="hidden-chat-open"]').forEach((b) => b.addEventListener('click', () => onOpen(b.dataset.chatId)));
  root.querySelectorAll('[data-role="hidden-chat-unhide"]').forEach((b) => b.addEventListener('click', () => onUnhide(b.dataset.chatId)));
}
