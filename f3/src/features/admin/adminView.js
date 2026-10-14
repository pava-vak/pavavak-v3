import { escapeHtml } from '../../shared/html.js';

function formatMonitorTime(isoString) {
  if (!isoString) return '';
  const d = new Date(isoString);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderMonitorTab(state) {
  if (state.monitorStatus === 'loading') {
    return '<p class="muted admin-monitor-empty">Loading conversations…</p>';
  }
  if (state.monitorStatus === 'error') {
    return `<p class="error-text admin-monitor-empty">${escapeHtml(state.error)}</p>`;
  }
  if (!state.monitorChats.length) {
    return '<p class="muted admin-monitor-empty">No conversations yet.</p>';
  }

  return state.monitorChats.map((chat) => {
    const rawTitle = chat.participants.map((p) => p.displayName).join(' & ');
    const avatarLetter = escapeHtml((chat.participants[0]?.displayName || 'C').slice(0, 1).toUpperCase());
    const preview = chat.lastMessage?.text ? escapeHtml(chat.lastMessage.text) : '';
    const time = escapeHtml(formatMonitorTime(chat.lastSentAt));
    return `
      <div class="chat-row" role="button" tabindex="0"
           data-role="monitor-open-chat"
           data-chat-id="${escapeHtml(chat.chatId)}"
           data-chat-title="${escapeHtml(rawTitle)}"
           data-chat-avatar="${avatarLetter}">
        <div class="chat-row-avatar">${avatarLetter}</div>
        <div class="chat-row-body">
          <div class="chat-row-header">
            <span class="chat-row-title">${escapeHtml(rawTitle)}</span>
            ${time ? `<span class="chat-row-time">${time}</span>` : ''}
          </div>
          ${preview ? `<p class="chat-row-preview">${preview}</p>` : ''}
        </div>
      </div>
    `;
  }).join('');
}

export function renderAdminView(state) {
  if (state.status === 'idle') return '';

  const { activeTab } = state;

  return `
    <section class="admin-panel">
      <div class="sidebar-section-label">Admin</div>
      <div class="admin-tabs">
        <button class="admin-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}" data-role="admin-tab" data-tab="dashboard">Overview</button>
        <button class="admin-tab-btn ${activeTab === 'monitor' ? 'active' : ''}" data-role="admin-tab" data-tab="monitor">Monitor</button>
      </div>
      ${activeTab === 'dashboard' ? `
        ${state.status === 'loading' ? '<p class="muted admin-monitor-empty">Loading…</p>' : ''}
        ${state.error ? `<p class="error-text admin-monitor-empty">${escapeHtml(state.error)}</p>` : ''}
        ${state.summary ? `
          <div class="admin-stats">
            <div><span>${escapeHtml(String(state.summary.users))}</span><small>Users</small></div>
            <div><span>${escapeHtml(String(state.summary.conversations))}</span><small>Chats</small></div>
            <div><span>${escapeHtml(String(state.summary.messages))}</span><small>Messages</small></div>
          </div>
        ` : ''}
        ${state.otpResult ? `
          <div class="admin-otp-banner">
            <p><strong>Temporary password for user #${escapeHtml(String(state.otpResult.userId))}:</strong></p>
            <code class="admin-otp-code">${escapeHtml(state.otpResult.password)}</code>
            <p class="muted">Share this with the user. It will work once until they set a new password.</p>
            <button class="secondary-button" type="button" data-role="clear-otp">Dismiss</button>
          </div>
        ` : ''}
        <div class="admin-users-header">
          <span class="admin-users-label">Users</span>
          <button class="admin-add-user-btn" type="button" data-role="open-add-user" title="Add new user">
            + Add User
          </button>
        </div>
        <div class="admin-users">
          ${state.users.map((user) => `
            <div class="admin-user-row">
              <div class="admin-user-info">
                <strong>${escapeHtml(user.displayName)}</strong>
                <span>@${escapeHtml(user.username)}</span>
                <small>${user.isAdmin ? 'Admin' : 'User'}</small>
              </div>
              <button class="admin-reset-btn" type="button"
                      data-role="reset-password"
                      data-user-id="${escapeHtml(String(user.userId))}">
                Reset PW
              </button>
            </div>
          `).join('')}
        </div>
        <div class="admin-broadcast-row">
          <button class="primary-button admin-broadcast-btn" type="button" data-role="broadcast-update"
            ${state.broadcastStatus === 'loading' ? 'disabled' : ''}>
            ${state.broadcastStatus === 'loading' ? 'Broadcasting…' : '📲 Broadcast Update to All Chats'}
          </button>
          ${state.broadcastStatus === 'done' ? `<p class="admin-broadcast-result">✓ Sent to ${escapeHtml(String(state.broadcastCount))} chats</p>` : ''}
          ${state.broadcastStatus === 'error' ? `<p class="error-text admin-broadcast-result">${escapeHtml(state.error)}</p>` : ''}
        </div>
        <div class="admin-refresh-row">
          <button class="secondary-button" type="button" data-role="refresh-admin">Refresh</button>
        </div>
      ` : ''}
      ${activeTab === 'monitor' ? renderMonitorTab(state) : ''}
    </section>
  `;
}

export function renderAddUserModal(state) {
  const saving = state.addUserStatus === 'saving';
  return `
    <div class="admin-modal-overlay" data-role="close-add-user-overlay">
      <div class="admin-modal" role="dialog" aria-modal="true" aria-label="Add new user">
        <div class="admin-modal-header">
          <h3>Add New User</h3>
          <button class="admin-modal-close" data-role="close-add-user" aria-label="Close">✕</button>
        </div>
        <div class="admin-modal-body">
          ${state.addUserError ? `<p class="error-text admin-modal-error">${escapeHtml(state.addUserError)}</p>` : ''}
          <label class="admin-field-label" for="au-displayName">Display Name</label>
          <input id="au-displayName" class="admin-field-input" type="text" name="displayName"
            placeholder="e.g. Ravi Kumar" autocomplete="off" maxlength="80" />

          <label class="admin-field-label" for="au-username">Username</label>
          <input id="au-username" class="admin-field-input" type="text" name="username"
            placeholder="e.g. ravi.kumar" autocomplete="off" maxlength="40"
            pattern="[a-z0-9._-]+" />
          <p class="admin-field-hint">Lowercase letters, numbers, dots, hyphens only</p>

          <label class="admin-field-label" for="au-password">Password</label>
          <div class="admin-pw-wrap">
            <input id="au-password" class="admin-field-input" type="password" name="password"
              placeholder="Min 8 characters" autocomplete="new-password" maxlength="128" />
            <button type="button" class="admin-pw-toggle" data-role="toggle-add-user-pw" aria-label="Show/hide password">👁</button>
          </div>
        </div>
        <div class="admin-modal-footer">
          <button class="secondary-button" type="button" data-role="close-add-user" ${saving ? 'disabled' : ''}>Cancel</button>
          <button class="primary-button" type="button" data-role="submit-add-user" ${saving ? 'disabled' : ''}>
            ${saving ? 'Creating…' : 'Create User'}
          </button>
        </div>
      </div>
    </div>
  `;
}

export function bindAdminView(root, { onRefresh, onTabChange, onOpenMonitorChat, onResetPassword, onClearOtp, onBroadcastUpdate, onOpenAddUser }) {
  root.querySelector('[data-role="refresh-admin"]')?.addEventListener('click', () => onRefresh?.());
  root.querySelector('[data-role="clear-otp"]')?.addEventListener('click', () => onClearOtp?.());
  root.querySelector('[data-role="broadcast-update"]')?.addEventListener('click', () => onBroadcastUpdate?.());
  root.querySelector('[data-role="open-add-user"]')?.addEventListener('click', () => onOpenAddUser?.());

  root.querySelectorAll('[data-role="reset-password"]').forEach((btn) => {
    btn.addEventListener('click', () => onResetPassword?.(Number(btn.dataset.userId)));
  });

  root.querySelectorAll('[data-role="admin-tab"]').forEach((btn) => {
    btn.addEventListener('click', () => onTabChange?.(btn.dataset.tab));
  });

  root.querySelectorAll('[data-role="monitor-open-chat"]').forEach((row) => {
    row.addEventListener('click', () => {
      onOpenMonitorChat?.({
        chatId: row.dataset.chatId,
        title: row.dataset.chatTitle,
        avatarText: row.dataset.chatAvatar
      });
    });
  });
}

export function bindAddUserModal(modalEl, { onClose, onSubmit }) {
  modalEl.querySelector('[data-role="close-add-user"]')?.addEventListener('click', () => onClose?.());
  modalEl.querySelector('[data-role="close-add-user-overlay"]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) onClose?.();
  });

  modalEl.querySelector('[data-role="toggle-add-user-pw"]')?.addEventListener('click', () => {
    const input = modalEl.querySelector('#au-password');
    if (input) input.type = input.type === 'password' ? 'text' : 'password';
  });

  modalEl.querySelector('[data-role="submit-add-user"]')?.addEventListener('click', () => {
    const displayName = modalEl.querySelector('#au-displayName')?.value.trim() || '';
    const username    = modalEl.querySelector('#au-username')?.value.trim().toLowerCase() || '';
    const password    = modalEl.querySelector('#au-password')?.value || '';

    const errorEl = modalEl.querySelector('.admin-modal-error') || (() => {
      const p = document.createElement('p');
      p.className = 'error-text admin-modal-error';
      modalEl.querySelector('.admin-modal-body').prepend(p);
      return p;
    })();

    if (!displayName) { errorEl.textContent = 'Display Name is required'; return; }
    if (!username || username.length < 2) { errorEl.textContent = 'Username must be at least 2 characters'; return; }
    if (!/^[a-z0-9._-]+$/.test(username)) { errorEl.textContent = 'Username: lowercase letters, numbers, dots, hyphens only'; return; }
    if (!password || password.length < 8) { errorEl.textContent = 'Password must be at least 8 characters'; return; }
    errorEl.textContent = '';

    onSubmit?.({ displayName, username, password });
  });

  // Submit on Enter in any field
  modalEl.querySelectorAll('.admin-field-input').forEach((input) => {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') modalEl.querySelector('[data-role="submit-add-user"]')?.click();
    });
  });

  // Focus first field
  setTimeout(() => modalEl.querySelector('#au-displayName')?.focus(), 50);
}
