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
    const title = chat.participants.map((p) => escapeHtml(p.displayName)).join(' & ');
    const avatarLetter = escapeHtml((chat.participants[0]?.displayName || 'C').slice(0, 1).toUpperCase());
    const preview = chat.lastMessage?.text ? escapeHtml(chat.lastMessage.text) : '';
    const time = escapeHtml(formatMonitorTime(chat.lastSentAt));
    return `
      <div class="chat-row" role="button" tabindex="0"
           data-role="monitor-open-chat"
           data-chat-id="${escapeHtml(chat.chatId)}"
           data-chat-title="${title}"
           data-chat-avatar="${avatarLetter}">
        <div class="chat-row-avatar">${avatarLetter}</div>
        <div class="chat-row-body">
          <div class="chat-row-header">
            <span class="chat-row-title">${title}</span>
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
        <div class="admin-users">
          ${state.users.filter(u => u.userId < 9000).map((user) => `
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
        <div class="admin-refresh-row">
          <button class="secondary-button" type="button" data-role="refresh-admin">Refresh</button>
        </div>
      ` : ''}
      ${activeTab === 'monitor' ? renderMonitorTab(state) : ''}
    </section>
  `;
}

export function bindAdminView(root, { onRefresh, onTabChange, onOpenMonitorChat, onResetPassword, onClearOtp }) {
  root.querySelector('[data-role="refresh-admin"]')?.addEventListener('click', () => onRefresh?.());
  root.querySelector('[data-role="clear-otp"]')?.addEventListener('click', () => onClearOtp?.());

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
