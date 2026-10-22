import { escapeHtml } from '../shared/html.js';
import { createSessionStore } from '../features/session/sessionStore.js';
import { bindLoginView, renderLoginView } from '../features/session/loginView.js';
import { createChatListStore } from '../features/chat-list/chatListStore.js';
import { bindChatListView, renderChatListView } from '../features/chat-list/chatListView.js';
import { createChatThreadStore } from '../features/chat-thread/chatThreadStore.js';
import { bindChatThreadView, renderChatThreadView, expiryLabel } from '../features/chat-thread/chatThreadView.js';
import { createPeopleStore } from '../features/people/peopleStore.js';
import { bindPeopleView, renderPeopleView } from '../features/people/peopleView.js';
import { createAdminStore } from '../features/admin/adminStore.js';
import { bindAdminView, renderAdminView, renderAddUserModal, bindAddUserModal } from '../features/admin/adminView.js';
import { renderSettingsModal, bindSettingsModal } from '../features/settings/settingsView.js';
import { renderOnboarding, requestPermissions } from '../features/onboarding/onboardingView.js';
import { isEnabled as isLockEnabled, disable as disableLock, setPin, verifyPin, hasPin, clearPin, getLockTimer, setLockTimer, isSupported as isBiometricSupported, isPlatformAvailable, hasEnrolledLocally, checkEnrolled, enroll, verify, revoke as revokeBiometric } from '../shared/biometricLock.js';
import { playMessageTone } from '../shared/notificationSound.js';
import { bindHiddenChatsModal, getHiddenChats, renderHiddenChatsModal, setChatHidden, syncHiddenChats, verifyOwner } from '../shared/privacyPrefs.js';

// Chats hidden on this browser; refreshed on every render from localStorage
let hiddenChatIds = new Set();
import { subscribeSocket, getSocketStatus, onSocketConnect } from '../shared/socketClient.js';
import { config } from '../shared/config.js';
import { getActiveTheme, setTheme } from '../shared/themeStore.js';
import { initPush, unsubscribePush } from '../shared/pushClient.js';
import { updateFaviconBadge } from '../shared/faviconBadge.js';
import { ANDROID_APK_URL, isAndroidBrowser, fetchAndroidRelease, formatReleaseLabel, isAndroidBannerDismissed, dismissAndroidBanner } from '../shared/androidApp.js';

function renderMobileBottomNav(user, mobileTab, totalUnread, canInstall) {
  return `
    <nav class="mobile-bottom-nav" role="navigation" aria-label="Main navigation">
      <button class="mobile-nav-btn ${mobileTab === 'chats' ? 'active' : ''}" data-role="mobile-tab" data-tab="chats" aria-label="Chats">
        <span class="nav-icon">💬</span>
        ${totalUnread > 0 && mobileTab !== 'chats' ? `<span class="nav-badge">${totalUnread > 99 ? '99+' : totalUnread}</span>` : ''}
        <span class="nav-label">Chats</span>
      </button>
      <button class="mobile-nav-btn ${mobileTab === 'people' ? 'active' : ''}" data-role="mobile-tab" data-tab="people" aria-label="People">
        <span class="nav-icon">👥</span>
        <span class="nav-label">People</span>
      </button>
      <button class="mobile-nav-btn ${mobileTab === 'settings' ? 'active' : ''}" data-role="mobile-tab" data-tab="settings" aria-label="Settings">
        <span class="nav-icon">⚙</span>
        <span class="nav-label">Settings</span>
      </button>
      ${user.isAdmin ? `
      <button class="mobile-nav-btn ${mobileTab === 'admin' ? 'active' : ''}" data-role="mobile-tab" data-tab="admin" aria-label="Admin">
        <span class="nav-icon">🔐</span>
        <span class="nav-label">Admin</span>
      </button>` : ''}
      ${canInstall ? `
      <button class="mobile-nav-btn" data-role="pwa-install" aria-label="Install app">
        <span class="nav-icon">⬇</span>
        <span class="nav-label">Install</span>
      </button>` : ''}
    </nav>
  `;
}

function renderAuthenticatedView(user, chatState, peopleState, adminState, activeChat, threadState, composerValue = '', isMonitoring = false, viewOnce = false, deleteAfter = 'never', mobileTab = 'chats', canInstall = false, onlineUserIds = new Set(), reactions = null, pinnedMessage = null, threadSearch = null) {
  const socketStatus = getSocketStatus();
  const avatarLetter = escapeHtml((user.displayName || user.username || '?').slice(0, 1).toUpperCase());
  const totalUnread = chatState.items.reduce((n, c) => n + (hiddenChatIds.has(c.chatId) ? 0 : (c.unreadCount || 0)), 0);
  const activeChatWithPresence = activeChat
    ? { ...activeChat, peerOnline: activeChat.peerId ? onlineUserIds.has(activeChat.peerId) : false }
    : null;
  return `
    <div class="app-shell ${activeChat ? 'thread-open' : ''}" data-mobile-tab="${mobileTab}">
      <aside class="chat-sidebar">
        <div class="sidebar-topbar">
          <div class="sidebar-topbar-avatar">${avatarLetter}</div>
          <div class="sidebar-topbar-info">
            <span class="sidebar-topbar-name" data-role="secret-hidden-chats">${escapeHtml(user.displayName)}</span>
            <span class="sidebar-topbar-handle">@${escapeHtml(user.username)}</span>
          </div>
          <div class="sidebar-topbar-actions">
            <span class="sidebar-conn-dot ${socketStatus}" title="${socketStatus}"></span>
            <button class="sidebar-icon-btn" data-role="new-group" title="New Group" aria-label="New group">👥</button>
            <button class="sidebar-icon-btn" data-role="notes-to-self" title="Notes to self" aria-label="Notes to self">📝</button>
            <button class="sidebar-icon-btn" data-role="open-search" title="Search messages" aria-label="Search">🔍</button>
            <button class="sidebar-icon-btn" data-role="open-scheduled" title="Scheduled messages" aria-label="Scheduled messages">📅</button>
            <button class="sidebar-icon-btn" data-role="app-refresh" title="Check for update &amp; reload" aria-label="Refresh app">🔄</button>
            <button class="sidebar-icon-btn" data-role="open-settings" title="Settings" aria-label="Settings">⚙</button>
            <button class="sidebar-icon-btn" data-role="sign-out" title="Sign out" aria-label="Sign out">✕</button>
          </div>
        </div>
        <div class="sidebar-tab-bar">
          <button class="stb-btn ${mobileTab !== 'people' ? 'stb-active' : ''}" data-role="mobile-tab" data-tab="chats">
            Chats${totalUnread > 0 ? `<span class="stb-badge">${totalUnread}</span>` : ''}
          </button>
          <button class="stb-btn ${mobileTab === 'people' ? 'stb-active' : ''}" data-role="mobile-tab" data-tab="people">
            People
          </button>
        </div>
        <div class="sidebar-body">
          <div class="sidebar-section-chats">
            ${renderChatListView(chatState, activeChat?.chatId, onlineUserIds, hiddenChatIds)}
          </div>
          <div class="sidebar-section-people">
            ${renderPeopleView(peopleState)}
          </div>
          ${user.isAdmin ? `<div class="sidebar-section-admin">${renderAdminView(adminState)}</div>` : ''}
        </div>
        <button class="sidebar-fab" data-role="mobile-tab" data-tab="people" title="New chat" aria-label="Start a new chat">✏</button>
      </aside>
      <main class="thread-area">
        ${renderChatThreadView({ activeChat: activeChatWithPresence, threadState, composerValue, readOnly: isMonitoring, viewOnce, deleteAfter, reactions, pinnedMessage, threadSearch })}
      </main>
    </div>
    ${renderMobileBottomNav(user, activeChat ? '' : mobileTab, totalUnread, canInstall)}
  `;
}

function renderAndroidAppBanner(release) {
  return `
    <div class="pwa-install-banner" role="dialog" aria-label="Get the PaVa Vak Android app">
      <div class="pwa-install-banner-icon">
        <img src="/icon.svg" alt="" aria-hidden="true" width="40" height="40" />
      </div>
      <div class="pwa-install-banner-body">
        <strong class="pwa-install-banner-title">Android app</strong>
        <span class="pwa-install-banner-sub">${escapeHtml(formatReleaseLabel(release))}</span>
      </div>
      <div class="pwa-install-banner-actions">
        <a class="pwa-install-banner-btn pwa-install-banner-btn--install" href="${ANDROID_APK_URL}" download data-role="android-banner-download">Download</a>
        <button class="pwa-install-banner-btn pwa-install-banner-btn--dismiss" data-role="android-banner-dismiss" aria-label="Dismiss">✕</button>
      </div>
    </div>
  `;
}

function renderInstallBanner() {
  return `
    <div class="pwa-install-banner" role="dialog" aria-label="Install PaVa Vak">
      <div class="pwa-install-banner-icon">
        <img src="/icon.svg" alt="" aria-hidden="true" width="40" height="40" />
      </div>
      <div class="pwa-install-banner-body">
        <strong class="pwa-install-banner-title">Add to Home Screen</strong>
        <span class="pwa-install-banner-sub">Install PaVa Vak for the best experience</span>
      </div>
      <div class="pwa-install-banner-actions">
        <button class="pwa-install-banner-btn pwa-install-banner-btn--install" data-role="pwa-banner-install">Install</button>
        <button class="pwa-install-banner-btn pwa-install-banner-btn--dismiss" data-role="pwa-banner-dismiss" aria-label="Dismiss">✕</button>
      </div>
    </div>
  `;
}

function renderGroupCreateModal(groupState) {
  const { step = 'name', title = '', members = [], searchQuery = '', searchResults = [], loading = false, error = '' } = groupState;
  return `
    <div class="modal-overlay" data-role="group-modal-overlay">
      <div class="modal-dialog group-create-modal">
        <div class="modal-header">
          <button class="modal-close-btn" data-role="close-group-modal" aria-label="Close">✕</button>
          <h2 class="modal-title">New Group</h2>
        </div>
        ${step === 'name' ? `
          <div class="modal-body">
            <label class="field-label">Group Name</label>
            <input class="field-input" data-role="group-title-input" type="text" value="${escapeHtml(title)}" placeholder="e.g. Family, Team Alpha…" maxlength="80" autocomplete="off" />
            ${error ? `<p class="error-text">${escapeHtml(error)}</p>` : ''}
          </div>
          <div class="modal-footer">
            <button class="primary-button" data-role="group-next-btn" ${!title.trim() ? 'disabled' : ''}>Next →</button>
          </div>
        ` : `
          <div class="modal-body">
            <p class="modal-subtitle">Add members · <strong>${members.length}</strong> selected</p>
            <input class="field-input" data-role="group-member-search" type="search" value="${escapeHtml(searchQuery)}" placeholder="Search people…" autocomplete="off" />
            <div class="group-member-list">
              ${searchResults.map(u => {
                const sel = members.includes(u.userId);
                return `<label class="group-member-row ${sel ? 'selected' : ''}">
                  <span class="gm-avatar">${escapeHtml((u.displayName || u.username || '?')[0].toUpperCase())}</span>
                  <span class="gm-name">${escapeHtml(u.displayName || u.username)}</span>
                  <input type="checkbox" class="gm-check" data-user-id="${u.userId}" ${sel ? 'checked' : ''} />
                </label>`;
              }).join('')}
              ${loading ? '<p class="muted" style="padding:8px">Searching…</p>' : ''}
              ${!loading && searchResults.length === 0 && searchQuery ? '<p class="muted" style="padding:8px">No results</p>' : ''}
            </div>
            ${error ? `<p class="error-text">${escapeHtml(error)}</p>` : ''}
          </div>
          <div class="modal-footer">
            <button class="secondary-button" data-role="group-back-btn">← Back</button>
            <button class="primary-button" data-role="group-create-btn" ${members.length < 1 ? 'disabled' : ''}>
              ${loading ? 'Creating…' : `Create Group (${members.length})`}
            </button>
          </div>
        `}
      </div>
    </div>
  `;
}

function renderChatInfoPanel(activeChat, members = null, currentUserId = null) {
  const isGroup = activeChat?.chatType === 'group' || activeChat?.chatId?.startsWith('grp-');
  const isGroupAdmin = isGroup && members && members.some(m => m.userId === currentUserId && m.role === 'admin');
  const WALLPAPERS = [
    { id: 'none', label: 'Default', style: '' },
    { id: 'forest', label: 'Forest', style: 'linear-gradient(135deg,#1a3a2a,#2d5a3d)' },
    { id: 'ocean', label: 'Ocean', style: 'linear-gradient(135deg,#1a2a4a,#2d4a7a)' },
    { id: 'sunset', label: 'Sunset', style: 'linear-gradient(135deg,#4a1a2a,#7a3d2d)' },
    { id: 'slate', label: 'Slate', style: 'linear-gradient(135deg,#1e1e2e,#2e2e4e)' },
    { id: 'gold', label: 'Gold', style: 'linear-gradient(135deg,#2a1a0a,#5a3a1a)' },
    { id: 'purple', label: 'Purple', style: 'linear-gradient(135deg,#1a0a2a,#3d1a5a)' },
    { id: 'teal', label: 'Teal', style: 'linear-gradient(135deg,#0a2a2a,#1a5a5a)' },
  ];
  const currentBg = activeChat?.background || 'none';

  return `
    <div class="chat-info-panel" data-role="chat-info-panel">
      <div class="cip-header">
        <button class="modal-close-btn" data-role="close-chat-info" aria-label="Close">✕</button>
        <h2 class="cip-title">${escapeHtml(isGroup ? 'Group Info' : 'Contact Info')}</h2>
      </div>
      <div class="cip-body">
        <div class="cip-avatar-wrap">
          <div class="cip-avatar">${escapeHtml((activeChat?.avatarText || activeChat?.title || '?')[0].toUpperCase())}</div>
        </div>
        <div class="cip-name-row">
          <h3 class="cip-name">${escapeHtml(activeChat?.title || '')}</h3>
          ${isGroupAdmin ? `<button class="cip-group-btn" data-role="cip-rename" title="Rename group" aria-label="Rename group">✏</button>` : ''}
        </div>
        <p class="cip-sub muted">${escapeHtml(activeChat?.subtitle || '')}</p>

        ${isGroup ? `
          <div class="cip-section">
            <div class="cip-section-label-row">
              <p class="cip-section-label">Members</p>
              ${isGroupAdmin ? `<button class="cip-group-btn" data-role="cip-add-member" title="Add member" aria-label="Add member">➕ Add</button>` : ''}
            </div>
            ${members ? members.map(m => `
              <div class="cip-member">
                <span class="cip-member-avatar">${escapeHtml((m.displayName || m.username || '?')[0].toUpperCase())}</span>
                <span class="cip-member-name">${escapeHtml(m.displayName || m.username)}</span>
                ${m.role === 'admin' ? '<span class="cip-member-badge">Admin</span>' : ''}
                ${isGroupAdmin && m.userId !== currentUserId ? `<button class="cip-member-remove" data-role="remove-member" data-user-id="${m.userId}" aria-label="Remove">✕</button>` : ''}
              </div>
            `).join('') : '<p class="muted" style="padding:8px">Loading…</p>'}
          </div>
        ` : ''}

        <div class="cip-section">
          <p class="cip-section-label">Wallpaper</p>
          <div class="cip-wallpapers">
            ${WALLPAPERS.map(w => `
              <button class="cip-wallpaper-btn ${currentBg === w.id ? 'active' : ''}"
                      data-role="set-wallpaper" data-bg-id="${w.id}"
                      title="${w.label}"
                      style="${w.style ? `background:${w.style}` : ''}">
                ${currentBg === w.id ? '✓' : ''}
              </button>
            `).join('')}
          </div>
        </div>

        <div class="cip-section cip-actions">
          <button class="cip-action-btn" data-role="cip-mute">
            🔕 ${activeChat?.muted ? 'Unmute' : 'Mute'}
          </button>
          <button class="cip-action-btn" data-role="cip-archive">
            📦 ${activeChat?.archived ? 'Unarchive' : 'Archive'}
          </button>
          <button class="cip-action-btn cip-action-danger" data-role="cip-clear">🗑 Clear Chat</button>
          ${!isGroup && activeChat?.peerId ? `<button class="cip-action-btn cip-action-danger" data-role="cip-block" data-peer-id="${escapeHtml(String(activeChat.peerId))}">🚫 Block</button>` : ''}
          ${isGroup && !isGroupAdmin ? `<button class="cip-action-btn cip-action-danger" data-role="cip-leave-group">🚪 Leave Group</button>` : ''}
        </div>
      </div>
    </div>
  `;
}

function renderGlobalSearch(query = '', results = null, loading = false) {
  const hits = results?.messages || [];
  return `
    <div class="global-search-overlay" data-role="search-overlay">
      <div class="global-search-modal">
        <div class="global-search-header">
          <input class="global-search-input" data-role="search-input" type="search" placeholder="Search messages…" value="${escapeHtml(query)}" autocomplete="off" autofocus />
          <button class="global-search-close" data-role="close-search" aria-label="Close">✕</button>
        </div>
        <div class="global-search-body">
          ${loading ? '<p class="global-search-status">Searching…</p>' : ''}
          ${!loading && results?.error ? `<p class="global-search-status" style="color:var(--v3-danger)">${escapeHtml(results.error)}</p>` : ''}
          ${!loading && results && !results.error && !hits.length ? '<p class="global-search-status muted">No results.</p>' : ''}
          ${hits.map(r => `
            <button class="global-search-result" data-chat-id="${escapeHtml(r.chatId)}" data-role="search-result">
              <span class="gsr-chat">${escapeHtml(r.chatTitle)}</span>
              <span class="gsr-preview">${escapeHtml(r.text?.slice(0, 80) || '')}</span>
              <span class="gsr-sender">${escapeHtml(r.senderName)} · ${new Date(r.sentAt).toLocaleDateString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short' })}</span>
            </button>`).join('')}
        </div>
      </div>
    </div>
  `;
}

const FINGERPRINT_SVG = `<svg viewBox="0 0 48 48" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" width="36" height="36">
  <path d="M17 22c0-3.87 3.13-7 7-7s7 3.13 7 7c0 4-1.5 8-3.5 11"/>
  <path d="M13 22c0-6.07 4.93-11 11-11s11 4.93 11 11c0 5.5-2 10.5-5 15"/>
  <path d="M9 22c0-8.28 6.72-15 15-15s15 6.72 15 15c0 7-2.5 13.5-6.5 19"/>
  <path d="M21 22c0-1.66 1.34-3 3-3s3 1.34 3 3c0 2.5-0.8 5-2 7"/>
  <path d="M14 16c2.5-3.5 6-5.5 10-5.5"/>
</svg>`;

function getLockScreenName() {
  return localStorage.getItem('pava-lock-name') || 'PaVa Vak';
}
function getLockScreenIcon() {
  if (localStorage.getItem('pava-lock-icon-hidden') === '1') return 'hidden';
  return localStorage.getItem('pava-lock-icon') || null; // null = use initial letter
}

function renderLockScreen(error = '', pinEntry = '', showPin = false, biometricEnrolled = false) {
  const lockName = getLockScreenName();
  const lockIcon = getLockScreenIcon();
  const initial = escapeHtml(lockName.trim().slice(0, 1).toUpperCase() || 'P');
  const avatarHtml = lockIcon === 'hidden'
    ? ''
    : lockIcon
      ? `<div class="app-lock-avatar"><img src="${escapeHtml(lockIcon)}" class="app-lock-avatar-img" alt=""/></div>`
      : `<div class="app-lock-avatar">${initial}</div>`;

  const lockIdentity = `
    <div class="app-lock-identity">
      ${avatarHtml}
      <h1 class="app-lock-title">${escapeHtml(lockName)}</h1>
    </div>
  `;

  if (!biometricEnrolled || showPin) {
    const dots = Array.from({ length: 4 }, (_, i) =>
      `<span class="pin-dot ${i < pinEntry.length ? 'filled' : ''}"></span>`
    ).join('');
    return `
      <div class="app-lock-screen">
        <button class="app-refresh-btn app-refresh-btn--lock" type="button" data-role="app-refresh" title="Check for update &amp; reload">🔄</button>
        ${lockIdentity}
        <div class="app-lock-pin-zone">
          <p class="app-lock-pin-label">Enter Passcode</p>
          ${error ? `<p class="app-lock-error" role="alert">${escapeHtml(error)}</p>` : ''}
          <div class="app-pin-dots" data-role="pin-dots">${dots}</div>
          <input
            class="pin-native-input"
            data-role="pin-native-input"
            type="password"
            inputmode="numeric"
            pattern="[0-9]*"
            maxlength="4"
            autocomplete="off"
            aria-label="Enter 4-digit PIN"
          />
        </div>
        <div class="app-lock-links">
          ${biometricEnrolled ? `<button class="app-lock-link" data-role="use-biometric">Use Fingerprint</button>` : ''}
          <button class="app-lock-signout" data-role="lock-signout">Sign out</button>
        </div>
      </div>
    `;
  }

  // Biometric screen — fingerprint circle auto-fires on mount, tap to retry
  const bioState = error ? 'bio-error' : 'bio-idle';
  return `
    <div class="app-lock-screen">
      <button class="app-refresh-btn app-refresh-btn--lock" type="button" data-role="app-refresh" title="Check for update &amp; reload">🔄</button>
      ${lockIdentity}
      <div class="app-lock-bio-zone">
        <button class="app-lock-bio-btn ${bioState}" data-role="retry-bio" aria-label="Verify with fingerprint or Face ID">
          ${FINGERPRINT_SVG}
        </button>
        ${error
          ? `<p class="app-lock-error" role="alert">${escapeHtml(error)}</p>`
          : `<p class="app-lock-bio-hint">Touch to unlock</p>`
        }
      </div>
      <div class="app-lock-links">
        ${hasPin() ? `<button class="app-lock-link" data-role="show-pin">Use Passcode</button>` : ''}
        <button class="app-lock-signout" data-role="lock-signout">Sign out</button>
      </div>
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

async function openEditHistory(messageId) {
  try {
    const { fetchEditHistory } = await import('../shared/apiClient.js');
    const r = await fetchEditHistory(messageId);
    const edits = r?.edits || [];
    const overlay = document.createElement('div');
    overlay.className = 'privacy-pin-overlay';
    const fmt = (t) => t ? new Date(t).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
    overlay.innerHTML = `
      <div class="privacy-pin-card">
        <h3>Edit history</h3>
        ${edits.length ? edits.map(e => `<div style="margin:8px 0"><div>${escapeHtml(e.text)}</div><div class="muted" style="font-size:0.75rem">${escapeHtml(fmt(e.editedAt))}</div></div>`).join('<hr style="border:none;border-top:1px solid var(--v3-border)">')
          : '<p class="muted">No earlier versions.</p>'}
        <div class="privacy-pin-actions"><button type="button" class="secondary-button" data-role="eh-close">Close</button></div>
      </div>`;
    document.body.appendChild(overlay);
    const close = () => overlay.remove();
    overlay.querySelector('[data-role="eh-close"]').addEventListener('click', close);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) close(); });
  } catch (e) { showToast(e?.message || 'Could not load history'); }
}

function showToast(message, type = 'error') {
  const existing = document.getElementById('pava-toast');
  if (existing) existing.remove();
  const el = document.createElement('div');
  el.id = 'pava-toast';
  el.className = `pava-toast pava-toast--${type}`;
  el.textContent = message;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 3500);
}

function showConfirm(message, onYes) {
  document.getElementById('pava-confirm-dialog')?.remove();
  const el = document.createElement('div');
  el.id = 'pava-confirm-dialog';
  el.innerHTML = `
    <div class="pava-confirm-overlay">
      <div class="pava-confirm-box">
        <p class="pava-confirm-msg">${escapeHtml(message)}</p>
        <div class="pava-confirm-btns">
          <button class="secondary-button pava-confirm-cancel">Cancel</button>
          <button class="primary-button pava-confirm-danger pava-confirm-yes">Confirm</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(el);
  const close = () => el.remove();
  el.querySelector('.pava-confirm-cancel').addEventListener('click', close);
  el.querySelector('.pava-confirm-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) close(); });
  el.querySelector('.pava-confirm-yes').addEventListener('click', () => { close(); onYes?.(); });
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
  let onlineUserIds = new Set();
  let reactions = null;
  let pinnedMessage = null;
  let searchOpen = false;
  let searchQuery = '';
  let searchResults = null;
  let threadSearch = null; // { query: '' } when open
  let searchLoading = false;
  let groupModalOpen = false;
  let groupModalState = { step: 'name', title: '', members: [], searchQuery: '', searchResults: [], loading: false, error: '' };
  let addUserModalOpen = false;
  let hiddenModalOpen = false;
  let hiddenSyncedFor = null;
  let chatInfoOpen = false;
  let chatInfoMembers = null;
  let mobileTab = 'chats';
  let installPrompt = null;
  let installBannerDismissed = localStorage.getItem('pava-install-dismissed') === '1';
  let androidRelease = null;
  let androidBannerDismissed = isAndroidBannerDismissed();
  if (isAndroidBrowser()) {
    fetchAndroidRelease().then((release) => {
      androidRelease = release;
      if (release && !androidBannerDismissed && sessionState.status === 'authenticated') render();
    });
  }
  let appLocked = isLockEnabled();
  let lockError = '';
  let onboarding = null;
  let lockPinEntry = '';
  let lockShowPin = false;
  let biometricEnrolled = hasEnrolledLocally();
  let biometricFiring = false;

  // Refresh server-side enrollment status (async, non-blocking)
  if (isBiometricSupported()) {
    checkEnrolled().then(enrolled => {
      biometricEnrolled = enrolled;
      if (appLocked && sessionState.status === 'authenticated') render();
    }).catch(() => {});
  }

  function fireBiometric() {
    if (biometricFiring) return;
    biometricFiring = true;
    lockError = '';
    verify().then(() => {
      biometricFiring = false;
      appLocked = false; lockPinEntry = ''; lockError = ''; lockShowPin = false;
      render();
    }).catch(err => {
      biometricFiring = false;
      lockError = err.message?.includes('cancelled') ? '' : (err.message || 'Biometric failed');
      render();
    });
  }

  // Auto-fire biometric on load if enrolled
  if (appLocked && biometricEnrolled && sessionState.tokensPresent) {
    biometricFiring = true;
    verify().then(() => {
      biometricFiring = false;
      appLocked = false; lockPinEntry = ''; lockError = ''; lockShowPin = false;
      if (sessionState.status === 'authenticated') render();
    }).catch(err => {
      biometricFiring = false;
      lockError = err.message?.includes('cancelled') ? '' : (err.message || 'Biometric failed');
      if (sessionState.status === 'authenticated') render();
    });
  }

  let _prevVpHeight = 0;
  function _updateVH() {
    const h = window.visualViewport ? window.visualViewport.height : window.innerHeight;
    document.documentElement.style.setProperty('--vp-height', `${h}px`);
    return h;
  }
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', () => {
      const newH = _updateVH();
      if (newH < _prevVpHeight - 50 && activeChat) {
        const c = root.querySelector('[data-role="thread-messages"]');
        if (c) requestAnimationFrame(() => requestAnimationFrame(() => c.scrollTo({ top: c.scrollHeight, behavior: 'instant' })));
      }
      _prevVpHeight = newH;
    });
  }
  window.addEventListener('resize', _updateVH);
  _prevVpHeight = _updateVH();

  // On socket reconnect (PWA resume from background), reload chats + current thread
  onSocketConnect(() => {
    if (sessionState.status !== 'authenticated') return;
    chatListStore.load();
    if (activeChat) {
      chatThreadStore.openChat(activeChat.chatId);
    }
  });

  // Close all navigation state and DOM overlays — called on lock so unlock always lands on chat list
  function closeAllForLock() {
    // Stop camera stream if open
    const cam = document.getElementById('pava-camera');
    if (cam) { cam.querySelector('.pava-camera-close')?.click(); cam.remove(); }
    // Remove DOM overlays
    document.getElementById('pava-ctx-menu')?.remove();
    document.getElementById('pava-img-viewer')?.remove();
    document.querySelectorAll('.media-gallery-overlay').forEach(el => el.remove());
    // Reset navigation state → chat list
    activeChat = null;
    settingsOpen = false;
    searchOpen = false;
    chatInfoOpen = false;
    groupModalOpen = false;
    addUserModalOpen = false;
    isMonitoring = false;
    reactions = null;
    pinnedMessage = null;
    mobileTab = 'chats';
  }

  document.addEventListener('visibilitychange', () => {
    if (!isLockEnabled()) {
      if (!document.hidden) render();
      return;
    }

    const timer = getLockTimer();
    if (document.hidden) {
      sessionStorage.setItem('pava-last-active', Date.now().toString());
      biometricFiring = false;
      lockError = '';
      if (timer === 0) {
        appLocked = true;
        lockPinEntry = '';
        lockError = '';
        lockShowPin = false;
        closeAllForLock();
      }
      ensureSplash();
    } else {
      ensureSplash();

      if (!appLocked && timer > 0) {
        const elapsed = (Date.now() - parseInt(sessionStorage.getItem('pava-last-active') || '0', 10)) / 1000;
        if (elapsed >= timer) {
          appLocked = true;
          lockPinEntry = '';
          lockError = '';
          lockShowPin = false;
          closeAllForLock();
        }
      }

      if (appLocked) {
        if (biometricEnrolled && !biometricFiring && !lockShowPin) {
          fireBiometric();
        }
        if (sessionState.status === 'authenticated') render();
      } else {
        removeSplash();
        render();
      }
    }
  });

  // Android snapshots the last painted frame when leaving the app; `blur` fires while
  // the page is still visible, so the cover gets painted before the snapshot.
  const isTouchDevice = window.matchMedia?.('(pointer: coarse)').matches;
  window.addEventListener('blur', () => {
    if (isTouchDevice && isLockEnabled() && getLockTimer() === 0 && sessionState.status === 'authenticated') {
      ensureSplash();
    }
  });
  window.addEventListener('focus', () => {
    if (!appLocked && !document.hidden) removeSplash();
  });

  ['pointerdown', 'keydown', 'touchstart'].forEach((ev) => {
    document.addEventListener(ev, () => {
      if (getLockTimer() > 0 && isLockEnabled()) {
        sessionStorage.setItem('pava-last-active', Date.now().toString());
      }
    }, { passive: true, capture: true });
  });

  // System back button — intercept and navigate within app instead of minimising
  function pushBackState() {
    history.pushState({ pava: true }, '');
  }

  function closeTopOverlay() {
    // Close DOM overlays in reverse Z-order (topmost first)
    if (document.getElementById('pava-ctx-menu')) {
      document.getElementById('pava-ctx-menu').remove(); return true;
    }
    if (document.getElementById('pava-img-viewer')) {
      document.getElementById('pava-img-viewer').remove(); return true;
    }
    if (document.getElementById('pava-camera')) {
      // Stop stream and remove
      document.getElementById('pava-camera').querySelector('.pava-camera-close')?.click();
      if (document.getElementById('pava-camera')) document.getElementById('pava-camera').remove();
      return true;
    }
    if (document.querySelector('.media-gallery-overlay')) {
      document.querySelector('.media-gallery-overlay')?.remove(); return true;
    }
    if (chatInfoOpen) { chatInfoOpen = false; render(); return true; }
    if (groupModalOpen) { groupModalOpen = false; render(); return true; }
    if (addUserModalOpen) { addUserModalOpen = false; adminStore.clearAddUserError(); render(); return true; }
    return false;
  }

  function handleBack() {
    if (appLocked) return false;
    // Always close DOM overlays before navigating away
    if (closeTopOverlay()) return true;
    if (settingsOpen) { settingsOpen = false; render(); return true; }
    if (searchOpen) { searchOpen = false; render(); return true; }
    if (activeChat) { const wasMonitoring = isMonitoring; activeChat = null; isMonitoring = false; reactions = null; pinnedMessage = null; mobileTab = wasMonitoring ? 'admin' : 'chats'; render(); return true; }
    if (mobileTab !== 'chats') { mobileTab = 'chats'; render(); return true; }
    return false;
  }

  pushBackState(); // seed initial history entry

  window.addEventListener('popstate', () => {
    const handled = handleBack();
    if (handled) pushBackState(); // re-push so next back is also intercepted
    // if not handled, natural back runs → Android minimises the app
  });

  const isStandalone = window.matchMedia('(display-mode: standalone)').matches
    || window.navigator.standalone === true;

  window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    if (!isStandalone) { installPrompt = e; render(); }
  });
  window.addEventListener('appinstalled', () => {
    installPrompt = null;
    render();
  });

  function saveDraft(chatId, text) {
    if (!chatId) return;
    try {
      if (text) localStorage.setItem(`pava-draft-${chatId}`, text);
      else localStorage.removeItem(`pava-draft-${chatId}`);
    } catch {}
  }
  function loadDraft(chatId) {
    if (!chatId) return '';
    try { return localStorage.getItem(`pava-draft-${chatId}`) || ''; } catch { return ''; }
  }

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

  let _lastScrollChatId = null;
  let _lastScrollItemCount = 0;
  let unreadScrollCount = 0;
  let _loadingMore = false; // true while load-more (older messages) is in progress

  // ── Starred messages overlay ─────────────────────────────────────────────
  async function openStarredOverlay() {
    document.getElementById('pava-starred-overlay')?.remove();
    const overlay = document.createElement('div');
    overlay.id = 'pava-starred-overlay';
    overlay.className = 'media-gallery-overlay';
    overlay.innerHTML = `
      <div class="mg-sheet">
        <div class="mg-header">
          <button class="mg-close" aria-label="Close">✕</button>
          <h2 class="mg-title">⭐ Starred Messages</h2>
          <div class="mg-header-actions"></div>
        </div>
        <div class="mg-body" id="starred-body"><p class="mg-loading mg-empty">Loading…</p></div>
      </div>`;
    overlay.querySelector('.mg-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });
    const onKey = e => { if (e.key === 'Escape') { overlay.remove(); document.removeEventListener('keydown', onKey); } };
    document.addEventListener('keydown', onKey);
    document.body.appendChild(overlay);

    try {
      const { fetchStarredMessages, unstarMessage } = await import('../shared/apiClient.js');
      const data = await fetchStarredMessages();
      const items = data.messages || [];
      const body = overlay.querySelector('#starred-body');
      if (!items.length) {
        body.innerHTML = '<p class="mg-empty">No starred messages yet.<br>Long-press a message and tap ⭐ Star to save it.</p>';
        return;
      }
      body.innerHTML = `<div class="starred-list">${items.map(m => `
        <div class="starred-item" data-mid="${escapeHtml(m.messageId)}">
          <div class="starred-meta">
            <span class="starred-sender">${escapeHtml(m.senderDisplayName || m.senderName || 'Unknown')}</span>
            <span class="starred-chat">${escapeHtml(m.chatTitle || m.chatId || '')}</span>
            <span class="starred-time">${m.sentAt ? new Date(m.sentAt).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true }) : ''}</span>
          </div>
          <p class="starred-text">${escapeHtml(
            m.text?.startsWith('__IMG__:') ? '📷 Photo' :
            m.text?.startsWith('__VID__:') ? '▶ Video' :
            m.text?.startsWith('__AUD__:') ? '🎤 Voice note' :
            m.text?.startsWith('__DOC__:') ? '📄 Document' :
            (m.text || '')
          )}</p>
          <button class="starred-unstar secondary-button" data-role="unstar" data-mid="${escapeHtml(m.messageId)}" title="Remove star">✕ Unstar</button>
        </div>`).join('')}</div>`;

      body.querySelectorAll('[data-role="unstar"]').forEach(btn => {
        btn.addEventListener('click', async () => {
          const mid = btn.dataset.mid;
          btn.disabled = true; btn.textContent = '…';
          try {
            await unstarMessage(mid);
            btn.closest('.starred-item').remove();
            if (!body.querySelector('.starred-item')) {
              body.innerHTML = '<p class="mg-empty">No starred messages yet.</p>';
            }
          } catch { btn.disabled = false; btn.textContent = '✕ Unstar'; }
        });
      });
    } catch {
      overlay.querySelector('#starred-body').innerHTML = '<p class="mg-empty error-text">Could not load starred messages.</p>';
    }
  }

  // Every render() rebuilds the thread DOM, so scroll state lives here, not in the element.
  let _threadPinned = true; // user is at (or near) the newest message
  let _threadScrollMemo = null; // { chatId, scrollTop, scrollHeight } of the previous DOM
  let _threadResizeObs = null;

  function captureThreadScroll() {
    const c = root.querySelector('[data-role="thread-messages"]');
    _threadScrollMemo = c ? { chatId: _lastScrollChatId, scrollTop: c.scrollTop, scrollHeight: c.scrollHeight } : null;
  }

  function stickToBottom(container) {
    container.scrollTop = container.scrollHeight;
    requestAnimationFrame(() => { if (_threadPinned) container.scrollTop = container.scrollHeight; });
  }

  function scrollThreadToBottom() {
    _threadResizeObs?.disconnect();
    const container = root.querySelector('[data-role="thread-messages"]');
    if (!container) return;
    const chatId = threadState?.chatId;
    const items = threadState?.items || [];
    const chatChanged = chatId !== _lastScrollChatId;
    const addedCount = items.length - _lastScrollItemCount;
    const memo = _threadScrollMemo?.chatId === chatId ? _threadScrollMemo : null;
    _lastScrollChatId = chatId;
    _lastScrollItemCount = items.length;
    if (_loadingMore && addedCount <= 0 && threadState?.loadMoreStatus !== 'loading') _loadingMore = false;

    if (chatChanged || !memo) {
      _threadPinned = true;
      _loadingMore = false;
      unreadScrollCount = 0;
      syncScrollBtn(false);
      stickToBottom(container);
    } else if (addedCount > 0 && _loadingMore) {
      // Older messages were prepended: keep the message the user was reading in place
      _loadingMore = false;
      container.scrollTop = container.scrollHeight - memo.scrollHeight + memo.scrollTop;
    } else if (addedCount > 0 && (_threadPinned || items[items.length - 1]?.direction === 'outgoing')) {
      _threadPinned = true;
      unreadScrollCount = 0;
      syncScrollBtn(false);
      stickToBottom(container);
    } else if (addedCount > 0) {
      container.scrollTop = memo.scrollTop;
      unreadScrollCount += addedCount;
      syncScrollBtn(true);
    } else if (_threadPinned) {
      stickToBottom(container);
    } else {
      container.scrollTop = memo.scrollTop;
    }

    container.addEventListener('scroll', () => {
      _threadPinned = container.scrollHeight - container.scrollTop - container.clientHeight < 80;
    }, { passive: true });

    // Photos/videos loading and the keyboard opening both change sizes after render;
    // while pinned, keep the newest message in view.
    if (window.ResizeObserver) {
      _threadResizeObs = new ResizeObserver(() => {
        if (_threadPinned) container.scrollTop = container.scrollHeight;
      });
      _threadResizeObs.observe(container);
      for (const child of container.children) _threadResizeObs.observe(child);
    }
  }

  function syncScrollBtn(show) {
    const btn = root.querySelector('[data-role="scroll-to-new"]');
    if (!btn) return;
    const countEl = btn.querySelector('[data-role="new-count"]');
    if (show && unreadScrollCount > 0) {
      if (countEl) countEl.textContent = unreadScrollCount;
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
      unreadScrollCount = 0;
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
    // Save draft for the chat we're leaving
    const leavingId = activeChat?.chatId;
    if (leavingId) saveDraft(leavingId, captureComposerState().value);

    isMonitoring = false;
    reactions = null;
    pinnedMessage = null;
    threadSearch = null;
    unreadScrollCount = 0;
    activeChat = chatState.items.find((item) => item.chatId === chatId) || null;
    chatThreadStore.openChat(chatId).then(() => {
      chatListStore.applyChatRead(chatId);
    });
    // Load reactions and pinned message in background
    import('../shared/apiClient.js').then(async ({ fetchChatReactions, fetchPinnedMessage }) => {
      const [rxResult, pinResult] = await Promise.allSettled([
        fetchChatReactions(chatId),
        fetchPinnedMessage(chatId)
      ]);
      if (rxResult.status === 'fulfilled' && rxResult.value?.reactions) {
        reactions = rxResult.value.reactions;
      }
      if (pinResult.status === 'fulfilled' && pinResult.value?.pinned) {
        pinnedMessage = pinResult.value.pinned;
      }
      render();
    }).catch(() => {});
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
      saveDraft(activeChat.chatId, '');
    }
  }

  function openForwardPickerInApp(messageId) {
    document.getElementById('pava-forward-picker')?.remove();
    const el = document.createElement('div');
    el.id = 'pava-forward-picker';
    const chats = chatState.items.filter(c => c.chatId !== activeChat?.chatId);
    el.innerHTML = `
      <div class="admin-modal-overlay" style="z-index:4000">
        <div class="admin-modal" style="max-width:360px;max-height:80vh;display:flex;flex-direction:column;padding:0">
          <div class="admin-modal-header">
            <h3>↪ Forward to…</h3>
            <button class="admin-modal-close" id="pava-fwd-close" aria-label="Close">✕</button>
          </div>
          <div style="padding:8px 12px;border-bottom:1px solid var(--v3-border)">
            <input id="pava-fwd-search" class="admin-field-input" placeholder="Search chats…" type="search" />
          </div>
          <div id="pava-fwd-list" style="overflow-y:auto;flex:1">
            ${chats.map(c => `
              <button class="pava-fwd-chat-btn" data-chat-id="${escapeHtml(c.chatId)}">
                <span class="pava-fwd-avatar">${escapeHtml((c.avatarText || c.title || '?')[0].toUpperCase())}</span>
                <span class="pava-fwd-name">${escapeHtml(c.title || c.chatId)}</span>
              </button>`).join('')}
            ${chats.length === 0 ? '<p style="padding:16px;text-align:center;color:var(--v3-muted)">No other chats</p>' : ''}
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);

    const close = () => el.remove();
    document.getElementById('pava-fwd-close').addEventListener('click', close);
    el.querySelector('.admin-modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) close(); });

    document.getElementById('pava-fwd-search').addEventListener('input', e => {
      const q = e.target.value.toLowerCase();
      el.querySelectorAll('.pava-fwd-chat-btn').forEach(btn => {
        btn.style.display = btn.querySelector('.pava-fwd-name').textContent.toLowerCase().includes(q) ? '' : 'none';
      });
    });

    el.querySelectorAll('.pava-fwd-chat-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const targetChatId = btn.dataset.chatId;
        btn.disabled = true; btn.style.opacity = '0.5';
        try {
          const { forwardMessage } = await import('../shared/apiClient.js');
          await forwardMessage(messageId, targetChatId);
          close();
          showToast('Message forwarded', 'success');
        } catch (err) {
          showToast(err?.message || 'Forward failed');
          btn.disabled = false; btn.style.opacity = '';
        }
      });
    });

    document.getElementById('pava-fwd-search').focus();
  }

  async function openScheduledMsgsPanel() {
    document.getElementById('pava-sched-panel')?.remove();
    const el = document.createElement('div');
    el.id = 'pava-sched-panel';
    el.innerHTML = `
      <div class="admin-modal-overlay" style="z-index:4000">
        <div class="admin-modal" style="max-width:400px;max-height:80vh;display:flex;flex-direction:column;padding:0">
          <div class="admin-modal-header">
            <h3>🕐 Scheduled Messages</h3>
            <button class="admin-modal-close" id="pava-sp-close" aria-label="Close">✕</button>
          </div>
          <div id="pava-sp-body" style="overflow-y:auto;flex:1;padding:8px 0">
            <p style="text-align:center;color:var(--v3-muted);padding:16px">Loading…</p>
          </div>
        </div>
      </div>`;
    document.body.appendChild(el);

    const close = () => el.remove();
    document.getElementById('pava-sp-close').addEventListener('click', close);
    el.querySelector('.admin-modal-overlay').addEventListener('click', e => { if (e.target === e.currentTarget) close(); });

    const body = document.getElementById('pava-sp-body');
    const IST = { timeZone: 'Asia/Kolkata', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' };

    try {
      const { fetchScheduledMessages } = await import('../shared/apiClient.js');
      const data = await fetchScheduledMessages();
      const items = data?.items || [];
      if (items.length === 0) {
        body.innerHTML = '<p style="text-align:center;color:var(--v3-muted);padding:24px">No scheduled messages</p>';
        return;
      }
      body.innerHTML = items.map(item => `
        <div class="sched-msg-row" data-id="${escapeHtml(String(item.id))}">
          <div class="sched-msg-meta">
            <span class="sched-msg-chat">${escapeHtml(item.chatTitle || item.chatId)}</span>
            <span class="sched-msg-time">🕐 ${new Date(item.scheduledAt).toLocaleString('en-IN', IST)}</span>
          </div>
          <p class="sched-msg-text">${escapeHtml(item.text.slice(0, 100))}${item.text.length > 100 ? '…' : ''}</p>
          <button class="secondary-button sched-msg-cancel" data-id="${escapeHtml(String(item.id))}">Cancel</button>
        </div>`).join('');

      body.querySelectorAll('.sched-msg-cancel').forEach(btn => {
        btn.addEventListener('click', async () => {
          const id = btn.dataset.id;
          btn.disabled = true; btn.textContent = 'Cancelling…';
          try {
            const { cancelScheduledMessage } = await import('../shared/apiClient.js');
            await cancelScheduledMessage(id);
            btn.closest('.sched-msg-row').remove();
            if (!body.querySelector('.sched-msg-row')) {
              body.innerHTML = '<p style="text-align:center;color:var(--v3-muted);padding:24px">No scheduled messages</p>';
            }
          } catch (err) {
            btn.disabled = false; btn.textContent = 'Cancel';
            showToast(err?.message || 'Could not cancel');
          }
        });
      });
    } catch (err) {
      body.innerHTML = `<p style="text-align:center;color:var(--v3-danger);padding:16px">${escapeHtml(err?.message || 'Failed to load')}</p>`;
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
      showToast(error?.message || 'Could not start chat');
      await peopleStore.search(peopleState.query || '');
    }
  }

  function ensureSplash() {
    document.documentElement.setAttribute('data-locked', '1');
    if (!document.getElementById('app-lock-splash')) {
      const el = document.createElement('div');
      el.id = 'app-lock-splash';
      el.className = 'app-lock-splash-cover';
      el.innerHTML = '<div style="font-size:48px;line-height:1">🔐</div><p class="app-lock-splash-label">Pava Vak</p>';
      document.body.appendChild(el);
    }
  }

  function removeSplash() {
    document.documentElement.removeAttribute('data-locked');
    const el = document.getElementById('app-lock-splash');
    if (!el) return;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      if (!document.documentElement.hasAttribute('data-locked')) el.remove();
    }));
  }

  function render() {
    const composerSnapshot = captureComposerState();
    captureThreadScroll();

    if (appLocked && sessionState.status === 'loading') {
      return;
    }

    if (appLocked && sessionState.status === 'authenticated') {
      // Hold render while biometric is auto-firing (no UI flash)
      if (biometricEnrolled && biometricFiring && !lockShowPin && !lockError) return;

      root.innerHTML = renderLockScreen(lockError, lockPinEntry, lockShowPin, biometricEnrolled);
      removeSplash();

      root.querySelector('[data-role="retry-bio"]')?.addEventListener('click', fireBiometric);
      root.querySelector('[data-role="show-pin"]')?.addEventListener('click', () => {
        lockShowPin = true; lockError = ''; lockPinEntry = ''; render();
      });
      root.querySelector('[data-role="use-biometric"]')?.addEventListener('click', () => {
        lockShowPin = false; lockError = ''; lockPinEntry = ''; fireBiometric();
      });

      const pinInput = root.querySelector('[data-role="pin-native-input"]');
      if (pinInput) {
        pinInput.focus();
        root.querySelector('[data-role="pin-dots"]')?.addEventListener('click', () => pinInput.focus());

        pinInput.addEventListener('input', async () => {
          pinInput.value = pinInput.value.replace(/\D/g, '').slice(0, 4);
          lockPinEntry = pinInput.value;

          // Update dot indicators in-place (no full re-render needed)
          root.querySelectorAll('[data-role="pin-dots"] .pin-dot').forEach((dot, i) => {
            dot.classList.toggle('filled', i < pinInput.value.length);
            dot.classList.remove('error');
          });
          root.querySelector('[data-role="pin-dots"]')?.classList.remove('shake');

          if (pinInput.value.length === 4) {
            pinInput.disabled = true;
            try {
              await verifyPin(pinInput.value);
              appLocked = false; lockPinEntry = ''; lockError = ''; lockShowPin = false;
              render();
            } catch {
              const dotsEl = root.querySelector('[data-role="pin-dots"]');
              dotsEl?.querySelectorAll('.pin-dot').forEach(d => d.classList.add('error'));
              dotsEl?.classList.add('shake');
              setTimeout(() => { lockPinEntry = ''; render(); }, 700);
            }
          }
        });
      }

      root.querySelector('[data-role="lock-signout"]')?.addEventListener('click', () => {
        appLocked = false;
        lockPinEntry = '';
        lockShowPin = false;
        sessionStore.signOut();
      });
      root.querySelector('[data-role="app-refresh"]')?.addEventListener('click', () => {
        navigator.serviceWorker?.getRegistration?.().then(r => r?.update?.()).catch(() => {}).finally(() => window.location.reload());
      });
      return;
    }

    // First-login onboarding flow
    if (onboarding && sessionState.status === 'authenticated') {
      root.innerHTML = renderOnboarding(onboarding);
      removeSplash();

      root.querySelector('[data-role="ob-skip"]')?.addEventListener('click', () => {
        const { step } = onboarding;
        if (step === 'welcome') { onboarding = null; localStorage.setItem('pava-onboarded', '1'); render(); return; }
        if (step === 'pin')     { onboarding = { ...onboarding, step: biometricEnrolled ? 'permissions' : 'biometric', pinFirst: '', pinEntry: '', error: '' }; render(); return; }
        if (step === 'biometric') { onboarding = { ...onboarding, step: 'permissions', error: '' }; render(); return; }
        if (step === 'permissions') { localStorage.setItem('pava-onboarded', '1'); onboarding = { ...onboarding, step: 'done' }; render(); return; }
      });

      root.querySelector('[data-role="ob-next"]')?.addEventListener('click', () => {
        onboarding = { ...onboarding, step: 'pin', pinFirst: '', pinEntry: '', error: '' };
        render();
      });

      root.querySelector('[data-role="ob-biometric"]')?.addEventListener('click', async () => {
        try {
          await enroll();
          biometricEnrolled = true;
        } catch { /* user cancelled or not supported */ }
        onboarding = { ...onboarding, step: 'permissions', error: '' };
        render();
      });

      root.querySelector('[data-role="ob-allow"]')?.addEventListener('click', async () => {
        const selected = [...root.querySelectorAll('.ob-perm-check:checked')].map(el => el.dataset.perm);
        await requestPermissions(selected);
        localStorage.setItem('pava-onboarded', '1');
        onboarding = { ...onboarding, step: 'done' };
        render();
      });

      root.querySelector('[data-role="ob-done"]')?.addEventListener('click', () => {
        onboarding = null;
        render();
      });

      root.querySelectorAll('[data-role="ob-pin-key"]').forEach((btn) => {
        btn.addEventListener('click', async () => {
          const key = btn.dataset.key;
          let { pinFirst, pinEntry } = onboarding;

          if (key === 'back') {
            onboarding = { ...onboarding, pinEntry: pinEntry.slice(0, -1), error: '' };
            render();
            return;
          }
          if (pinEntry.length >= 4) return;
          pinEntry += key;
          onboarding = { ...onboarding, pinEntry, error: '' };
          render();

          if (pinEntry.length === 4) {
            if (pinFirst === '') {
              // First entry — save and go to confirm
              onboarding = { ...onboarding, pinFirst: pinEntry, pinEntry: '', error: '' };
              render();
            } else {
              // Confirm — check match
              if (pinEntry === pinFirst) {
                await setPin(pinEntry);
                onboarding = { ...onboarding, step: 'biometric', pinFirst: '', pinEntry: '', error: '' };
                render();
              } else {
                // Mismatch — shake and reset
                const dotsEl = root.querySelector('[data-role="ob-dots"]');
                dotsEl?.querySelectorAll('.pin-dot').forEach(d => d.classList.add('error'));
                dotsEl?.classList.add('shake');
                setTimeout(() => {
                  onboarding = { ...onboarding, pinFirst: '', pinEntry: '', error: 'PINs did not match. Start again.' };
                  render();
                }, 700);
              }
            }
          }
        });
      });

      return;
    }

    if (sessionState.status === 'loading') {
      root.innerHTML = renderLoadingShell();
      if (!appLocked) removeSplash();
      return;
    }

    if (sessionState.status === 'authenticated' && sessionState.user) {
      const { viewOnce, deleteAfter } = chatThreadStore.getState();
      hiddenChatIds = getHiddenChats(sessionState.user.userId);
      // Once per signed-in user per page load: pull hidden chats hidden on other devices
      if (hiddenSyncedFor !== sessionState.user.userId) {
        hiddenSyncedFor = sessionState.user.userId;
        syncHiddenChats(hiddenSyncedFor).then(() => render()).catch(() => { hiddenSyncedFor = null; });
      }
      // On Android the native app replaces "Add to Home Screen"
      const showAndroidBanner = !!androidRelease && !androidBannerDismissed;
      const showInstallBanner = !showAndroidBanner && !!installPrompt && !installBannerDismissed;
      removeSplash();
      const _totalUnread = chatState.items.reduce((n, c) => n + (hiddenChatIds.has(c.chatId) ? 0 : (c.unreadCount || 0)), 0);
      updateFaviconBadge(_totalUnread);
      root.innerHTML = renderAuthenticatedView(
        sessionState.user,
        chatState,
        peopleState,
        adminState,
        activeChat,
        threadState,
        composerSnapshot.value || loadDraft(activeChat?.chatId),
        isMonitoring,
        viewOnce,
        deleteAfter,
        mobileTab,
        !!installPrompt,
        onlineUserIds,
        reactions,
        pinnedMessage,
        threadSearch
      ) + (settingsOpen ? renderSettingsModal(sessionState.user, biometricEnrolled) : '')
        + (showInstallBanner ? renderInstallBanner() : '')
        + (showAndroidBanner ? renderAndroidAppBanner(androidRelease) : '')
        + (searchOpen ? renderGlobalSearch(searchQuery, searchResults, searchLoading) : '')
        + (groupModalOpen ? renderGroupCreateModal(groupModalState) : '')
        + (addUserModalOpen ? renderAddUserModal(adminStore.getState()) : '')
        + (chatInfoOpen && activeChat ? renderChatInfoPanel(activeChat, chatInfoMembers, sessionState.user?.userId) : '')
        + (hiddenModalOpen ? renderHiddenChatsModal(chatState.items.filter((c) => hiddenChatIds.has(c.chatId))) : '');
      if (hiddenModalOpen) {
        bindHiddenChatsModal(root, {
          onOpen: (chatId) => { hiddenModalOpen = false; settingsOpen = false; openChat(chatId); },
          onUnhide: (chatId) => { setChatHidden(sessionState.user.userId, chatId, false); showToast('Chat is back in your list', 'success'); render(); },
          onClose: () => { hiddenModalOpen = false; render(); }
        });
      }
      // Double-click your own name to open hidden chats
      root.querySelector('[data-role="secret-hidden-chats"]')?.addEventListener('dblclick', () => openHiddenChats());
      root.querySelector('[data-role="sign-out"]')?.addEventListener('click', () => {
        sessionStore.signOut();
      });
      root.querySelector('[data-role="app-refresh"]')?.addEventListener('click', () => {
        navigator.serviceWorker?.getRegistration?.().then(r => r?.update?.()).catch(() => {}).finally(() => window.location.reload());
      });
      root.querySelector('[data-role="open-settings"]')?.addEventListener('click', () => {
        settingsOpen = true;
        render();
      });
      root.querySelector('[data-role="open-scheduled"]')?.addEventListener('click', () => {
        openScheduledMsgsPanel();
      });
      root.querySelector('[data-role="open-search"]')?.addEventListener('click', () => {
        searchOpen = true;
        searchQuery = '';
        searchResults = null;
        render();
      });
      if (searchOpen) {
        const searchOverlay = root.querySelector('[data-role="search-overlay"]');
        const searchInput = root.querySelector('[data-role="search-input"]');
        root.querySelector('[data-role="close-search"]')?.addEventListener('click', () => {
          searchOpen = false; render();
        });
        searchOverlay?.addEventListener('click', (e) => {
          if (e.target === searchOverlay) { searchOpen = false; render(); }
        });
        let searchDebounce = null;
        searchInput?.addEventListener('input', () => {
          searchQuery = searchInput.value;
          clearTimeout(searchDebounce);
          if (searchQuery.trim().length < 2) { searchResults = null; render(); return; }
          searchLoading = true; render();
          searchDebounce = setTimeout(() => {
            import('../shared/apiClient.js').then(({ globalSearch }) =>
              globalSearch(searchQuery.trim())
            ).then(data => {
              searchResults = data;
              searchLoading = false;
              render();
            }).catch((err) => {
              searchLoading = false;
              searchResults = { error: err?.message || 'Search failed' };
              render();
            });
          }, 400);
        });
        root.querySelectorAll('[data-role="search-result"]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const chatId = btn.dataset.chatId;
            searchOpen = false;
            if (chatId) openChat(chatId);
          });
        });
        searchInput?.focus();
      }
      if (settingsOpen) {
        bindSettingsModal(root, {
          onClose: () => { settingsOpen = false; render(); },
          onUpdateDisplayName: async (displayName) => {
            await sessionStore.updateDisplayName(displayName);
            render();
          },
          onEnableBiometric: async () => {
            await enroll();
            biometricEnrolled = true;
            render();
          },
          onRevokeBiometric: async () => {
            await revokeBiometric();
            biometricEnrolled = false;
            render();
          },
          onDisableLock: () => {
            disableLock();
            biometricEnrolled = false;
            render();
          },
          onSetPin: async (pin) => {
            await setPin(pin);
            render();
          },
          onRemovePin: () => {
            clearPin();
            render();
          },
          onSetLockTimer: (seconds) => {
            setLockTimer(seconds);
            render();
          },
          onLockNow: () => {
            appLocked = true;
            lockPinEntry = '';
            lockError = '';
            lockShowPin = false;
            settingsOpen = false;
            render();
          },
          onViewHidden: () => openHiddenChats(),
          onViewStarred: () => {
            settingsOpen = false;
            render();
            openStarredOverlay();
          },
          onSignOutAll: () => {
            sessionStore.signOut();
          }
        });
      }
      bindChatListView(root, {
        onOpenChat: openChat,
        onRetry: () => chatListStore.load(),
        onDeleteChat: (chatId) => {
          showConfirm('Delete this chat from your list? The other person keeps their copy.', () => {
            chatListStore.deleteChat(chatId).then(() => {
              if (activeChat?.chatId === chatId) {
                activeChat = null;
                isMonitoring = false;
                mobileTab = 'chats';
                chatThreadStore.reset();
                render();
              }
            }).catch(() => {});
          });
        },
        onArchive: async (chatId) => {
          try {
            const { archiveChat } = await import('../shared/apiClient.js');
            await archiveChat(chatId, true);
            chatListStore.load();
          } catch (err) { showToast(err?.message || 'Archive failed'); }
        },
        onHide: (chatId) => {
          setChatHidden(sessionState.user.userId, chatId, true);
          if (activeChat?.chatId === chatId) {
            activeChat = null;
            chatThreadStore.reset();
          }
          showToast('Chat hidden. See it in Settings → Privacy → Hidden chats.', 'success');
          render();
        },
        onUnarchive: async (chatId) => {
          try {
            const { archiveChat } = await import('../shared/apiClient.js');
            await archiveChat(chatId, false);
            chatListStore.load();
          } catch (err) { showToast(err?.message || 'Unarchive failed'); }
        }
      });
      bindChatThreadView(root, {
        onSubmit: handleSendMessage,
        onTyping: (action) => chatThreadStore.notifyTyping(action),
        onLoadMore: () => { _loadingMore = true; chatThreadStore.loadMore(); },
        onRetry: () => activeChat && chatThreadStore.openChat(activeChat.chatId),
        onBack: () => {
          const wasMonitoring = isMonitoring;
          activeChat = null;
          isMonitoring = false;
          mobileTab = wasMonitoring ? 'admin' : 'chats';
          render();
        },
        onOpenViewOnce: (messageId) => chatThreadStore.openViewOnce(messageId),
        onToggleViewOnce: () => chatThreadStore.setViewOnce(!chatThreadStore.getState().viewOnce),
        onSetDeleteAfter: (value) => chatThreadStore.setDeleteAfter(value),
        onSetBurn: (value) => chatThreadStore.setBurn(value),
        onToggleSilent: () => chatThreadStore.setSilent(!chatThreadStore.getState().silent),
        onClearSilent: () => chatThreadStore.setSilent(false),
        onScheduleMessage: async (text, scheduledAt) => {
          if (!activeChat) throw new Error('No active chat');
          const { scheduleMessage } = await import('../shared/apiClient.js');
          await scheduleMessage(activeChat.chatId, text, scheduledAt);
          showToast(`Scheduled for ${new Date(scheduledAt).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}`, 'success');
          // Clear composer after scheduling
          root.querySelector('[data-role="composer-input"]').value = '';
        },
        onDeleteMessage: (messageId) => chatThreadStore.deleteMessage(messageId).catch(() => {}),
        onDeleteForMe: (messageId) => chatThreadStore.deleteForMe(messageId).catch((e) => showToast(e?.message || 'Could not delete')),
        onShowHistory: (messageId) => openEditHistory(messageId),
        onSendWhenOnline: async (text) => {
          if (!activeChat) return;
          try {
            const { sendWhenOnline } = await import('../shared/apiClient.js');
            await sendWhenOnline(activeChat.chatId, text);
            showToast(`Will send when ${activeChat.title || 'they'} are online`, 'success');
          } catch (e) { showToast(e?.message || 'Could not queue'); }
        },
        onReact: async (messageId, emoji) => {
          if (!activeChat) return;
          try {
            const { reactToMessage, fetchChatReactions } = await import('../shared/apiClient.js');
            await reactToMessage(messageId, emoji);
            const data = await fetchChatReactions(activeChat.chatId);
            if (data?.reactions) { reactions = data.reactions; render(); }
          } catch (err) { showToast(err?.message || 'Reaction failed'); }
        },
        onPin: async (messageId) => {
          if (!activeChat) return;
          try {
            const { pinMessage, fetchPinnedMessage } = await import('../shared/apiClient.js');
            await pinMessage(activeChat.chatId, messageId);
            const data = await fetchPinnedMessage(activeChat.chatId);
            pinnedMessage = data?.pinned || null;
            render();
          } catch (err) { showToast(err?.message || 'Pin failed'); }
        },
        onUnpin: async () => {
          if (!activeChat) return;
          try {
            const { pinMessage } = await import('../shared/apiClient.js');
            await pinMessage(activeChat.chatId, null);
            pinnedMessage = null;
            render();
          } catch (err) { showToast(err?.message || 'Unpin failed'); }
        },
        onForwardMessage: (messageId) => openForwardPickerInApp(messageId),
        onStarMessage: async (messageId) => {
          try {
            const { starMessage } = await import('../shared/apiClient.js');
            await starMessage(messageId);
            showToast('Message starred', 'success');
          } catch (err) { showToast(err?.message || 'Could not star message'); }
        },
        onCreatePoll: async (question, options) => {
          if (!activeChat?.chatId) throw new Error('No active chat');
          const { createPoll } = await import('../shared/apiClient.js');
          await createPoll(activeChat.chatId, question, options);
        },
        chatId: activeChat?.chatId,
        chatTitle: activeChat?.title,
        isMonitoring,
        currentUserId: sessionState.user?.userId
      });

      // ── Thread search ─────────────────────────────────────────────────────
      root.querySelector('[data-role="open-thread-search"]')?.addEventListener('click', () => {
        threadSearch = { query: '' };
        render();
        requestAnimationFrame(() => root.querySelector('[data-role="thread-search-input"]')?.focus());
      });
      root.querySelector('[data-role="close-thread-search"]')?.addEventListener('click', () => {
        threadSearch = null;
        render();
      });
      let _threadSearchDebounce = null;
      root.querySelector('[data-role="thread-search-input"]')?.addEventListener('input', (e) => {
        threadSearch = { query: e.target.value };
        clearTimeout(_threadSearchDebounce);
        _threadSearchDebounce = setTimeout(() => render(), 200);
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
        onClearOtp: () => adminStore.clearOtp(),
        onBroadcastUpdate: () => adminStore.broadcastUpdate(),
        onOpenAddUser: () => {
          addUserModalOpen = true;
          adminStore.clearAddUserError();
          render();
        }
      });

      // ── Add User Modal ────────────────────────────────────────────────────
      if (addUserModalOpen) {
        const modalEl = root.querySelector('.admin-modal-overlay');
        if (modalEl) {
          bindAddUserModal(modalEl, {
            onClose: () => {
              addUserModalOpen = false;
              adminStore.clearAddUserError();
              render();
            },
            onSubmit: async ({ displayName, username, password }) => {
              if (!displayName) return;
              if (!username) return;
              if (!password || password.length < 8) return;
              const result = await adminStore.createUser({ displayName, username, password });
              if (result.success) {
                addUserModalOpen = false;
                render();
              }
              // on error, adminStore re-renders via subscribe and modal stays open showing error
            }
          });
        }
      }
      // ── New Group button ────────────────────────────────────────────────────
root.querySelector('[data-role="notes-to-self"]')?.addEventListener('click', async () => {
        try {
          const { startSelfChat } = await import('../shared/apiClient.js');
          const r = await startSelfChat();
          if (r?.chat?.chatId) { await chatListStore.load(); openChat(r.chat.chatId); }
        } catch (e) { showToast(e?.message || 'Could not open notes'); }
      });
            root.querySelector('[data-role="new-group"]')?.addEventListener('click', () => {
        groupModalOpen = true;
        groupModalState = { step: 'name', title: '', members: [], searchQuery: '', searchResults: [], loading: false, error: '' };
        render();
      });

      // ── Group Creation Modal ──────────────────────────────────────────────
      if (groupModalOpen) {
        const overlay = root.querySelector('[data-role="group-modal-overlay"]');
        overlay?.addEventListener('click', (e) => { if (e.target === overlay) { groupModalOpen = false; render(); } });
        root.querySelector('[data-role="close-group-modal"]')?.addEventListener('click', () => { groupModalOpen = false; render(); });

        const titleInput = root.querySelector('[data-role="group-title-input"]');
        titleInput?.addEventListener('input', () => {
          groupModalState = { ...groupModalState, title: titleInput.value, error: '' };
          const nextBtn = root.querySelector('[data-role="group-next-btn"]');
          if (nextBtn) nextBtn.disabled = !titleInput.value.trim();
        });

        root.querySelector('[data-role="group-next-btn"]')?.addEventListener('click', () => {
          if (!groupModalState.title.trim()) return;
          // Pre-populate from direct chat contacts
          const contacts = chatState.items
            .filter(c => c.chatType === 'direct' && c.peerId)
            .map(c => ({ userId: c.peerId, displayName: c.title, username: c.title }));
          groupModalState = { ...groupModalState, step: 'members', loading: false, searchResults: contacts, error: '' };
          render();
        });

        root.querySelector('[data-role="group-back-btn"]')?.addEventListener('click', () => {
          groupModalState = { ...groupModalState, step: 'name', error: '' };
          render();
        });

        const memberSearch = root.querySelector('[data-role="group-member-search"]');
        let memberSearchDebounce = null;
        memberSearch?.addEventListener('input', () => {
          const q = memberSearch.value;
          groupModalState = { ...groupModalState, searchQuery: q };
          if (q.trim().length < 3) {
            // Show existing contacts
            const contacts = chatState.items
              .filter(c => c.chatType === 'direct' && c.peerId)
              .map(c => ({ userId: c.peerId, displayName: c.title, username: c.title }));
            groupModalState = { ...groupModalState, searchResults: contacts, loading: false };
            render(); return;
          }
          groupModalState = { ...groupModalState, loading: true };
          render();
          clearTimeout(memberSearchDebounce);
          memberSearchDebounce = setTimeout(() => {
            import('../shared/apiClient.js').then(({ searchUsers }) => searchUsers(q)).then(data => {
              groupModalState = { ...groupModalState, searchResults: data?.items || [], loading: false };
              render();
            }).catch(() => { groupModalState = { ...groupModalState, loading: false }; render(); });
          }, 300);
        });

        root.querySelectorAll('.gm-check').forEach((chk) => {
          chk.addEventListener('change', () => {
            const uid = Number(chk.dataset.userId);
            const cur = [...groupModalState.members];
            if (chk.checked) { if (!cur.includes(uid)) cur.push(uid); }
            else { const i = cur.indexOf(uid); if (i >= 0) cur.splice(i, 1); }
            groupModalState = { ...groupModalState, members: cur, error: '' };
            const createBtn = root.querySelector('[data-role="group-create-btn"]');
            if (createBtn) createBtn.disabled = cur.length < 1;
            // Update row styling
            chk.closest('.group-member-row')?.classList.toggle('selected', chk.checked);
          });
        });

        root.querySelector('[data-role="group-create-btn"]')?.addEventListener('click', async () => {
          if (groupModalState.members.length < 1) return;
          groupModalState = { ...groupModalState, loading: true, error: '' };
          render();
          try {
            const { createGroupChat } = await import('../shared/apiClient.js');
            const result = await createGroupChat(groupModalState.title.trim(), groupModalState.members);
            groupModalOpen = false;
            await chatListStore.load();
            if (result?.chat?.chatId) openChat(result.chat.chatId);
            else render();
          } catch (err) {
            groupModalState = { ...groupModalState, loading: false, error: err.message || 'Failed to create group' };
            render();
          }
        });

      }

      const openChatInfo = () => {
        if (!activeChat || isMonitoring) return;
        chatInfoOpen = true;
        chatInfoMembers = null;
        render();
        const isGroup = activeChat.chatType === 'group' || activeChat.chatId?.startsWith('grp-');
        if (isGroup) {
          import('../shared/apiClient.js').then(({ fetchChatMembers }) => fetchChatMembers(activeChat.chatId)).then(data => {
            chatInfoMembers = data?.members || [];
            render();
          }).catch(() => {});
        }
      };
      root.querySelector('.thread-header-avatar-wrap')?.addEventListener('click', openChatInfo);
      root.querySelector('.thread-header-info')?.addEventListener('click', openChatInfo);

      if (chatInfoOpen && activeChat) {
        const panel = root.querySelector('[data-role="chat-info-panel"]');
        root.querySelector('[data-role="close-chat-info"]')?.addEventListener('click', () => { chatInfoOpen = false; render(); });

        root.querySelectorAll('[data-role="set-wallpaper"]').forEach((btn) => {
          btn.addEventListener('click', async () => {
            const bgId = btn.dataset.bgId;
            try {
              const { setChatBackground } = await import('../shared/apiClient.js');
              await setChatBackground(activeChat.chatId, bgId === 'none' ? null : bgId);
              // Update local chat object
              activeChat = { ...activeChat, background: bgId === 'none' ? null : bgId };
              render();
            } catch { /* silently ignore */ }
          });
        });

        root.querySelector('[data-role="cip-mute"]')?.addEventListener('click', async () => {
          try {
            const { muteChat } = await import('../shared/apiClient.js');
            await muteChat(activeChat.chatId, !activeChat.muted);
            activeChat = { ...activeChat, muted: !activeChat.muted };
            render();
          } catch (err) { showToast(err?.message || 'Mute failed'); }
        });

        root.querySelector('[data-role="cip-archive"]')?.addEventListener('click', async () => {
          try {
            const { archiveChat } = await import('../shared/apiClient.js');
            await archiveChat(activeChat.chatId, !activeChat.archived);
            chatInfoOpen = false;
            chatListStore.load();
            render();
          } catch (err) { showToast(err?.message || 'Archive failed'); }
        });

        root.querySelector('[data-role="cip-clear"]')?.addEventListener('click', () => {
          showConfirm('Clear messages from your view? The other person keeps their copy.', () => {
            chatThreadStore.clearChat().catch(() => {});
            chatInfoOpen = false;
            render();
          });
        });

        const blockBtn = root.querySelector('[data-role="cip-block"]');
        if (blockBtn) {
          const peerId = blockBtn.dataset.peerId;
          import('../shared/apiClient.js').then(({ fetchBlocks, setUserBlocked }) => {
            fetchBlocks().then(r => { if ((r.blocked || []).includes(String(peerId))) blockBtn.textContent = '✅ Unblock'; }).catch(() => {});
            blockBtn.addEventListener('click', async () => {
              const blocking = !blockBtn.textContent.includes('Unblock');
              try {
                await setUserBlocked(peerId, blocking);
                blockBtn.textContent = blocking ? '✅ Unblock' : '🚫 Block';
                showToast(blocking ? 'Blocked' : 'Unblocked', 'success');
              } catch (e) { showToast(e?.message || 'Could not update'); }
            });
          });
        }

        root.querySelectorAll('[data-role="remove-member"]').forEach((btn) => {
          btn.addEventListener('click', () => {
            const userId = btn.dataset.userId;
            showConfirm('Remove this member from the group?', async () => {
              try {
                const { removeGroupMember } = await import('../shared/apiClient.js');
                await removeGroupMember(activeChat.chatId, userId);
                chatInfoMembers = (chatInfoMembers || []).filter(m => String(m.userId) !== String(userId));
                render();
              } catch { /* silently ignore */ }
            });
          });
        });

        root.querySelector('[data-role="cip-leave-group"]')?.addEventListener('click', () => {
          showConfirm('Leave this group? You will no longer receive messages from it.', async () => {
            try {
              const { removeGroupMember } = await import('../shared/apiClient.js');
              await removeGroupMember(activeChat.chatId, sessionState.user.userId);
              chatInfoOpen = false;
              activeChat = null;
              chatListStore.load();
              chatThreadStore.reset();
              render();
            } catch (err) { showToast(err?.message || 'Could not leave group'); }
          });
        });

        root.querySelector('[data-role="cip-rename"]')?.addEventListener('click', () => {
          const current = activeChat?.title || '';
          const overlay = document.createElement('div');
          overlay.className = 'pava-confirm-overlay';
          overlay.innerHTML = `
            <div class="pava-confirm-box">
              <p class="pava-confirm-msg">Rename group</p>
              <input class="pava-rename-input" type="text" maxlength="80" value="${escapeHtml(current)}" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--v3-border);background:var(--v3-input-bg);color:var(--v3-text);font-size:14px;margin-bottom:12px;" />
              <div class="pava-confirm-btns">
                <button class="pava-confirm-cancel">Cancel</button>
                <button class="pava-confirm-ok">Rename</button>
              </div>
            </div>`;
          document.body.appendChild(overlay);
          const input = overlay.querySelector('.pava-rename-input');
          input.focus(); input.select();
          overlay.querySelector('.pava-confirm-cancel').addEventListener('click', () => overlay.remove());
          overlay.querySelector('.pava-confirm-ok').addEventListener('click', async () => {
            const newName = input.value.trim();
            if (!newName || newName === current) { overlay.remove(); return; }
            try {
              const { renameGroup } = await import('../shared/apiClient.js');
              await renameGroup(activeChat.chatId, newName);
              activeChat = { ...activeChat, title: newName };
              render();
            } catch { /* silently ignore */ }
            overlay.remove();
          });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') overlay.querySelector('.pava-confirm-ok').click();
            if (e.key === 'Escape') overlay.remove();
          });
        });

        root.querySelector('[data-role="cip-add-member"]')?.addEventListener('click', () => {
          const overlay = document.createElement('div');
          overlay.className = 'pava-confirm-overlay';
          overlay.innerHTML = `
            <div class="pava-confirm-box">
              <p class="pava-confirm-msg">Add member</p>
              <input class="pava-rename-input" type="text" placeholder="Username or user ID" style="width:100%;padding:8px;border-radius:8px;border:1px solid var(--v3-border);background:var(--v3-input-bg);color:var(--v3-text);font-size:14px;margin-bottom:12px;" />
              <div class="pava-confirm-btns">
                <button class="pava-confirm-cancel">Cancel</button>
                <button class="pava-confirm-ok">Add</button>
              </div>
            </div>`;
          document.body.appendChild(overlay);
          const input = overlay.querySelector('.pava-rename-input');
          input.focus();
          overlay.querySelector('.pava-confirm-cancel').addEventListener('click', () => overlay.remove());
          overlay.querySelector('.pava-confirm-ok').addEventListener('click', async () => {
            const identifier = input.value.trim();
            if (!identifier) return;
            try {
              const { addGroupMember, fetchChatMembers } = await import('../shared/apiClient.js');
              await addGroupMember(activeChat.chatId, identifier);
              chatInfoMembers = await fetchChatMembers(activeChat.chatId);
              render();
            } catch (err) {
              input.style.borderColor = 'var(--v3-danger, #e05)';
              input.placeholder = err?.message || 'User not found';
              input.value = '';
              return;
            }
            overlay.remove();
          });
          input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') overlay.querySelector('.pava-confirm-ok').click();
            if (e.key === 'Escape') overlay.remove();
          });
        });
      }

      // ── Mobile bottom nav
      root.querySelectorAll('[data-role="mobile-tab"]').forEach((btn) => {
        btn.addEventListener('click', () => {
          const tab = btn.dataset.tab;
          if (tab === 'settings') {
            settingsOpen = true;
            render();
            return;
          }
          mobileTab = tab;
          render();
          if (tab === 'people') {
            root.querySelector('.people-search input')?.focus();
          }
        });
      });
      root.querySelector('[data-role="pwa-install"]')?.addEventListener('click', async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        if (outcome === 'accepted') installPrompt = null;
        render();
      });
      root.querySelector('[data-role="pwa-banner-install"]')?.addEventListener('click', async () => {
        if (!installPrompt) return;
        installPrompt.prompt();
        const { outcome } = await installPrompt.userChoice;
        if (outcome === 'accepted') installPrompt = null;
        installBannerDismissed = true;
        render();
      });
      root.querySelector('[data-role="android-banner-dismiss"]')?.addEventListener('click', () => {
        androidBannerDismissed = true;
        dismissAndroidBanner();
        render();
      });

      root.querySelector('[data-role="pwa-banner-dismiss"]')?.addEventListener('click', () => {
        installBannerDismissed = true;
        localStorage.setItem('pava-install-dismissed', '1');
        render();
      });

      restoreComposerState(composerSnapshot);
      scrollThreadToBottom();

      // Wire scroll-to-new button
      const scrollNewBtn = root.querySelector('[data-role="scroll-to-new"]');
      if (scrollNewBtn) {
        const countEl = scrollNewBtn.querySelector('[data-role="new-count"]');
        if (countEl) countEl.textContent = unreadScrollCount;
        scrollNewBtn.classList.toggle('hidden', unreadScrollCount === 0);
        scrollNewBtn.addEventListener('click', () => {
          unreadScrollCount = 0;
          scrollNewBtn.classList.add('hidden');
          const c = root.querySelector('[data-role="thread-messages"]');
          if (c) c.scrollTo({ top: c.scrollHeight, behavior: 'smooth' });
        });
        // Hide when user scrolls to bottom manually
        const threadContainer = root.querySelector('[data-role="thread-messages"]');
        if (threadContainer) {
          threadContainer.addEventListener('scroll', () => {
            const atBottom = threadContainer.scrollHeight - threadContainer.scrollTop - threadContainer.clientHeight < 80;
            if (atBottom) {
              unreadScrollCount = 0;
              scrollNewBtn.classList.add('hidden');
            }
          }, { passive: true });
        }
      }

      return;
    }

    removeSplash();
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

  // In-place typing indicator update — no full re-render needed
  function applyTypingInPlace(event, payload) {
    if (event !== 'typing:start' && event !== 'typing:stop') return false;
    if (!payload?.chatId || payload.chatId !== activeChat?.chatId) return false;

    // Update the store's typingUsers without triggering render()
    const cur = chatThreadStore.getState().typingUsers || [];
    let next;
    if (event === 'typing:start') {
      next = [...cur.filter(u => u.userId !== payload.userId),
              { userId: payload.userId, displayName: payload.displayName }];
    } else {
      next = cur.filter(u => u.userId !== payload.userId);
    }

    // Patch subtitle DOM element directly
    const subtitleEl = document.querySelector('.thread-subtitle');
    if (subtitleEl) {
      const isOnline = activeChat?.peerOnline === true;
      if (next.length) {
        subtitleEl.innerHTML = `<span class="typing-indicator">${next.map(u => u.displayName).map(n => n.replace(/&/g,'&amp;').replace(/</g,'&lt;')).join(', ')} typing…</span>`;
      } else {
        subtitleEl.innerHTML = isOnline
          ? '<span class="thread-online-label">online</span>'
          : (activeChat?.subtitle ? activeChat.subtitle.replace(/&/g,'&amp;').replace(/</g,'&lt;') : '');
      }
    }

    // Also auto-clear on the client as a safety net (5s)
    if (event === 'typing:start') {
      clearTimeout(applyTypingInPlace._timers?.[payload.userId]);
      if (!applyTypingInPlace._timers) applyTypingInPlace._timers = {};
      applyTypingInPlace._timers[payload.userId] = setTimeout(() => {
        applyTypingInPlace('typing:stop', payload);
      }, 5000);
    } else {
      if (applyTypingInPlace._timers) delete applyTypingInPlace._timers[payload.userId];
    }

    return true; // handled — skip full render
  }

  async function openHiddenChats() {
    const ok = await verifyOwner();
    if (ok === 'no-lock') { showToast('Set an app PIN in Settings → App Lock first, so only you can open hidden chats.'); return; }
    if (!ok) return;
    hiddenModalOpen = true;
    render();
  }

  // Disappearing and burn-after-reading countdowns tick in place; expired messages are removed
  setInterval(() => {
    const items = chatThreadStore.getState().items || [];
    if (!items.some((m) => m.expiresAt)) return;
    if (chatThreadStore.pruneExpired()) return; // the store change re-renders the thread
    for (const m of items) {
      if (!m.expiresAt) continue;
      const el = root.querySelector(`[data-message-id="${CSS.escape(m.messageId)}"] .bubble-expiry`);
      if (el) el.textContent = expiryLabel(m.expiresAt, m);
    }
  }, 1000);

  subscribeSocket((event, payload) => {
    if (applyTypingInPlace(event, payload)) return; // typing handled in-place
    chatThreadStore.handleSocketEvent(event, payload);
    if (event === 'chat:new' && payload.chat) {
      chatListStore.load(); // Reload to pick up the new group chat
    }
    if (event === 'chat:updated') {
      if (payload.reload) {
        chatListStore.load(); // Full reload requested (e.g. added to a group)
      } else {
        chatListStore.applyChatUpdated(payload);
      }
    }
    if (event === 'chat:removed') {
      // We were removed from a group — remove it from the list and close if active
      chatListStore.removeChat(payload.chatId);
      if (activeChat?.chatId === payload.chatId) {
        activeChat = null;
        chatThreadStore.reset();
        render();
      }
    }
    if (event === 'message:new' && payload.chatId) {
      const isActiveChat = payload.chatId === threadState.chatId;
      if (payload.message?.direction === 'incoming' && !document.hidden
          && !payload.message?.silent && !hiddenChatIds.has(payload.chatId)) {
        playMessageTone();
      }
      // No scroll indicator needed — new messages always auto-scroll to bottom
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
    if (event === 'presence:online' && payload.userId) {
      onlineUserIds = new Set([...onlineUserIds, payload.userId]);
      render();
    }
    if (event === 'presence:offline' && payload.userId) {
      const next = new Set(onlineUserIds);
      next.delete(payload.userId);
      onlineUserIds = next;
      render();
    }
    if (event === 'message:reaction' && payload.chatId === activeChat?.chatId) {
      // Update reactions in place
      if (reactions === null) reactions = {};
      const msgId = payload.messageId;
      if (!reactions[msgId]) reactions[msgId] = [];
      if (payload.emoji === null) {
        reactions[msgId] = reactions[msgId].filter(r => r.userId !== payload.userId);
      } else {
        reactions[msgId] = reactions[msgId].filter(r => r.userId !== payload.userId);
        reactions[msgId].push({ userId: payload.userId, displayName: payload.displayName, emoji: payload.emoji });
      }
      reactions = { ...reactions }; // new ref
      render();
    }
    if (event === 'chat:pinned' && payload.chatId === activeChat?.chatId) {
      if (!payload.messageId) {
        pinnedMessage = null; render();
      } else {
        import('../shared/apiClient.js').then(({ fetchPinnedMessage }) =>
          fetchPinnedMessage(payload.chatId).then(data => {
            pinnedMessage = data?.pinned || null; render();
          }).catch(() => {})
        );
      }
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
    // Trigger onboarding on first-ever login
    if (nowAuthenticated && !wasAuthenticated && !localStorage.getItem('pava-onboarded')) {
      onboarding = { step: 'welcome', pinFirst: '', pinEntry: '', error: '' };
    }
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
