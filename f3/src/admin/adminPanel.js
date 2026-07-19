import { escapeHtml } from '../shared/html.js';
import { createAdminPanelStore } from './adminPanelStore.js';

function formatTime(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  const now = new Date();
  if (d.toDateString() === now.toDateString()) {
    return d.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  }
  return d.toLocaleDateString([], { month: 'short', day: 'numeric' });
}

function renderLoginPage(state) {
  const isLoading = state.status === 'loading';
  return `
    <div class="ap-login-shell">
      <div class="ap-login-card">
        <div class="ap-login-brand">
          <span class="ap-login-logo">PaVa Vak</span>
          <span class="ap-login-badge">Admin</span>
        </div>
        <h1 class="ap-login-title">Admin Sign In</h1>
        <p class="ap-login-sub">This area is restricted to administrators only.</p>
        ${state.error ? `<p class="ap-error" role="alert">${escapeHtml(state.error)}</p>` : ''}
        <form class="ap-login-form" data-role="admin-login-form">
          <label class="ap-field">
            <span class="ap-field-label">Username</span>
            <input class="ap-input" name="username" type="text"
              autocomplete="username" autocapitalize="none" spellcheck="false"
              required autofocus />
          </label>
          <label class="ap-field">
            <span class="ap-field-label">Password</span>
            <span class="password-field">
              <input class="ap-input" name="password" type="password"
                autocomplete="current-password" required />
              <button type="button" class="password-toggle" data-role="password-toggle" aria-label="Show password">Show</button>
            </span>
          </label>
          <button class="ap-login-btn" type="submit" ${isLoading ? 'disabled' : ''}>
            ${isLoading ? 'Signing in…' : 'Sign in as Admin'}
          </button>
        </form>
        <a href="/" class="ap-back-link">← Back to PaVa Vak</a>
      </div>
    </div>
  `;
}

function renderDeniedPage(state) {
  return `
    <div class="ap-login-shell">
      <div class="ap-login-card">
        <div class="ap-login-brand">
          <span class="ap-login-logo">PaVa Vak</span>
          <span class="ap-login-badge">Admin</span>
        </div>
        <h1 class="ap-login-title">Access Denied</h1>
        <p class="ap-login-sub">
          <strong>${escapeHtml(state.user?.displayName || state.user?.username || 'Your account')}</strong>
          does not have admin privileges.
        </p>
        <a href="/" class="ap-login-btn" style="display:block;text-align:center;text-decoration:none;margin-top:1.5rem;">
          Back to PaVa Vak
        </a>
      </div>
    </div>
  `;
}

function renderStats(summary) {
  if (!summary) {
    return `
      <div class="ap-stats-row">
        <div class="ap-stat-card ap-stat-loading">—</div>
        <div class="ap-stat-card ap-stat-loading">—</div>
        <div class="ap-stat-card ap-stat-loading">—</div>
      </div>`;
  }
  return `
    <div class="ap-stats-row">
      <div class="ap-stat-card">
        <span class="ap-stat-value">${escapeHtml(String(summary.users ?? 0))}</span>
        <span class="ap-stat-label">Users</span>
      </div>
      <div class="ap-stat-card">
        <span class="ap-stat-value">${escapeHtml(String(summary.conversations ?? 0))}</span>
        <span class="ap-stat-label">Conversations</span>
      </div>
      <div class="ap-stat-card">
        <span class="ap-stat-value">${escapeHtml(String(summary.messages ?? 0))}</span>
        <span class="ap-stat-label">Messages</span>
      </div>
    </div>
  `;
}

function renderUsersTab(state) {
  const realUsers = state.users.filter((u) => u.userId < 9000);
  return `
    <div class="ap-tab-content">
      ${state.otpResult ? `
        <div class="ap-otp-banner">
          <div class="ap-otp-body">
            <span class="ap-otp-label">Temporary password for user #${escapeHtml(String(state.otpResult.userId))}:</span>
            <code class="ap-otp-code">${escapeHtml(state.otpResult.password)}</code>
            <span class="ap-otp-hint">Share this with the user — valid until they change it.</span>
          </div>
          <button class="ap-otp-dismiss" data-role="clear-otp">Dismiss</button>
        </div>
      ` : ''}
      <div class="ap-toolbar">
        <button class="ap-danger-btn" data-role="clean-seed-data">🗑 Remove Demo Bots</button>
      </div>
      ${state.usersLoading ? '<p class="ap-loading">Loading users…</p>' : ''}
      ${!state.usersLoading && realUsers.length === 0 ? '<p class="ap-empty">No users registered yet.</p>' : ''}
      ${realUsers.length > 0 ? `
        <div class="ap-table-wrap">
          <table class="ap-table">
            <thead>
              <tr>
                <th>#</th>
                <th>Display Name</th>
                <th>Username</th>
                <th>Status</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              ${realUsers.map((u) => `
                <tr class="${u.disabled ? 'ap-row-disabled' : ''}">
                  <td class="ap-td-id">${escapeHtml(String(u.userId))}</td>
                  <td>${escapeHtml(u.displayName || '—')}</td>
                  <td class="ap-td-username">@${escapeHtml(u.username)}</td>
                  <td>
                    <span class="ap-role-badge ${u.isAdmin ? 'ap-role-admin' : (u.disabled ? 'ap-role-disabled' : 'ap-role-user')}">
                      ${u.isAdmin ? 'Admin' : (u.disabled ? 'Disabled' : 'Active')}
                    </span>
                  </td>
                  <td class="ap-td-actions">
                    <button class="ap-action-btn" data-role="reset-password"
                      data-user-id="${escapeHtml(String(u.userId))}">
                      Reset PW
                    </button>
                    ${!u.isAdmin ? `
                      <button class="ap-action-btn ${u.disabled ? 'ap-action-enable' : 'ap-action-disable'}"
                        data-role="toggle-disabled"
                        data-user-id="${escapeHtml(String(u.userId))}"
                        data-disabled="${u.disabled ? 'true' : 'false'}">
                        ${u.disabled ? 'Enable' : 'Disable'}
                      </button>
                    ` : ''}
                  </td>
                </tr>
              `).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function renderMonitorMessages(state) {
  const { monitorChat, monitorMessages, monitorLoading } = state;
  return `
    <div class="ap-tab-content">
      <div class="ap-monitor-topbar">
        <button class="ap-back-btn" data-role="monitor-back">← Conversations</button>
        <span class="ap-monitor-chat-title">${escapeHtml(monitorChat.title || monitorChat.chatId)}</span>
      </div>
      <div class="ap-monitor-messages">
        ${monitorLoading ? '<p class="ap-loading">Loading messages…</p>' : ''}
        ${!monitorLoading && monitorMessages.length === 0 ? '<p class="ap-empty">No messages in this conversation.</p>' : ''}
        ${monitorMessages.map((m) => `
          <div class="ap-monitor-msg">
            <span class="ap-monitor-sender">${escapeHtml(m.senderName || String(m.senderId) || '?')}</span>
            <span class="ap-monitor-text">${escapeHtml(m.text || '')}</span>
            <span class="ap-monitor-time">${formatTime(m.createdAt)}</span>
          </div>
        `).join('')}
      </div>
    </div>
  `;
}

function renderMonitorTab(state) {
  if (state.monitorChat) return renderMonitorMessages(state);

  return `
    <div class="ap-tab-content">
      ${state.chatsLoading ? '<p class="ap-loading">Loading conversations…</p>' : ''}
      ${!state.chatsLoading && state.chats.length === 0 ? '<p class="ap-empty">No conversations yet.</p>' : ''}
      ${state.chats.length > 0 ? `
        <div class="ap-table-wrap">
          <table class="ap-table">
            <thead>
              <tr>
                <th>Participants</th>
                <th>Last Message</th>
                <th>Time</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              ${state.chats.map((chat) => {
                const title = chat.participants?.map((p) => escapeHtml(p.displayName)).join(' & ') || escapeHtml(chat.chatId);
                const preview = chat.lastMessage?.text ? escapeHtml(chat.lastMessage.text.slice(0, 60)) : '—';
                const time = escapeHtml(formatTime(chat.lastSentAt));
                return `
                  <tr>
                    <td>${title}</td>
                    <td class="ap-td-preview">${preview}</td>
                    <td class="ap-td-time">${time}</td>
                    <td>
                      <button class="ap-action-btn" data-role="monitor-open"
                        data-chat-id="${escapeHtml(chat.chatId)}"
                        data-chat-title="${title}">
                        View
                      </button>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      ` : ''}
    </div>
  `;
}

function renderChangePwModal(state) {
  return `
    <div class="ap-change-pw-overlay" data-role="ap-change-pw-overlay">
      <div class="ap-change-pw-modal" role="dialog" aria-modal="true" aria-label="Change Password">
        <div class="ap-change-pw-header">
          <h2>Change Password</h2>
          <button type="button" class="ap-close-btn" data-role="ap-change-pw-close" aria-label="Close">✕</button>
        </div>
        ${state.changePwError ? `<p class="ap-error" role="alert">${escapeHtml(state.changePwError)}</p>` : ''}
        ${state.changePwSuccess ? `<p class="ap-pw-success" role="status">✓ Password changed successfully.</p>` : ''}
        <form class="ap-change-pw-form" data-role="ap-change-pw-form">
          <label class="ap-field">
            <span class="ap-field-label">Current password</span>
            <span class="password-field">
              <input class="ap-input" name="currentPassword" type="password"
                autocomplete="current-password" required />
              <button type="button" class="password-toggle" data-role="password-toggle" aria-label="Show password">Show</button>
            </span>
          </label>
          <label class="ap-field">
            <span class="ap-field-label">New password <span class="ap-field-hint">(min 8 characters)</span></span>
            <span class="password-field">
              <input class="ap-input" name="newPassword" type="password"
                autocomplete="new-password" minlength="8" required />
              <button type="button" class="password-toggle" data-role="password-toggle" aria-label="Show password">Show</button>
            </span>
          </label>
          <label class="ap-field">
            <span class="ap-field-label">Confirm new password</span>
            <span class="password-field">
              <input class="ap-input" name="confirmPassword" type="password"
                autocomplete="new-password" minlength="8" required />
              <button type="button" class="password-toggle" data-role="password-toggle" aria-label="Show password">Show</button>
            </span>
          </label>
          <button class="ap-login-btn" type="submit">Update Password</button>
        </form>
      </div>
    </div>
  `;
}

function renderDashboard(state) {
  const { activeTab, user } = state;
  const tabLabel = activeTab === 'users' ? 'Users' : 'Monitor';
  return `
    <div class="ap-shell">
      <header class="ap-header">
        <div class="ap-header-left">
          <span class="ap-logo">PaVa Vak</span>
          <span class="ap-admin-badge">Admin</span>
        </div>
        <nav class="ap-nav">
          <button class="ap-nav-btn ${activeTab === 'users' ? 'active' : ''}"
            data-role="ap-tab" data-tab="users">Users</button>
          <button class="ap-nav-btn ${activeTab === 'monitor' ? 'active' : ''}"
            data-role="ap-tab" data-tab="monitor">Monitor</button>
        </nav>
        <div class="ap-header-right">
          <span class="ap-header-user">${escapeHtml(user?.displayName || user?.username || '')}</span>
          <button class="ap-change-pw-btn" data-role="ap-open-change-pw" title="Change your password">🔑 Password</button>
          <button class="ap-signout-btn" data-role="ap-signout">Sign out</button>
        </div>
      </header>
      <main class="ap-main">
        <div class="ap-page-header">
          <h1 class="ap-page-title">${tabLabel}</h1>
          <button class="ap-refresh-btn" data-role="ap-refresh">↻ Refresh</button>
        </div>
        ${renderStats(state.summary)}
        ${activeTab === 'users' ? renderUsersTab(state) : renderMonitorTab(state)}
      </main>
    </div>
    ${state.changePwOpen ? renderChangePwModal(state) : ''}
  `;
}

export function renderAdminPanel(root) {
  const store = createAdminPanelStore();

  function bindPasswordToggles(scope) {
    (scope || root).querySelectorAll('[data-role="password-toggle"]').forEach((toggle) => {
      toggle.addEventListener('click', () => {
        const input = toggle.parentElement?.querySelector('input');
        if (!input) return;
        const show = input.type === 'password';
        input.type = show ? 'text' : 'password';
        toggle.textContent = show ? 'Hide' : 'Show';
        toggle.setAttribute('aria-label', show ? 'Hide password' : 'Show password');
        input.focus();
      });
    });
  }

  function bind() {
    const state = store.getState();
    if (state.status === 'checking' || state.status === 'loading') return;

    if (state.status === 'login') {
      root.querySelector('[data-role="admin-login-form"]')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const fd = new FormData(e.target);
        store.adminLogin({
          username: String(fd.get('username') || ''),
          password: String(fd.get('password') || '')
        });
      });
      bindPasswordToggles();
      return;
    }

    if (state.status !== 'ready') return;

    root.querySelectorAll('[data-role="ap-tab"]').forEach((btn) => {
      btn.addEventListener('click', () => store.setTab(btn.dataset.tab));
    });
    root.querySelector('[data-role="ap-signout"]')?.addEventListener('click', () => store.signOut());
    root.querySelector('[data-role="ap-refresh"]')?.addEventListener('click', () => {
      store.loadData();
      if (store.getState().activeTab === 'monitor') store.loadChats();
    });
    root.querySelectorAll('[data-role="reset-password"]').forEach((btn) => {
      btn.addEventListener('click', () => store.resetPassword(Number(btn.dataset.userId)));
    });
    root.querySelectorAll('[data-role="toggle-disabled"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const isCurrentlyDisabled = btn.dataset.disabled === 'true';
        store.toggleDisabled(Number(btn.dataset.userId), !isCurrentlyDisabled);
      });
    });
    root.querySelector('[data-role="clean-seed-data"]')?.addEventListener('click', () => {
      if (confirm('Remove all demo bot users (Alex, Books, etc.)? This cannot be undone.')) {
        store.cleanSeedData();
      }
    });
    root.querySelector('[data-role="clear-otp"]')?.addEventListener('click', () => store.clearOtp());
    root.querySelectorAll('[data-role="monitor-open"]').forEach((btn) => {
      btn.addEventListener('click', () =>
        store.openMonitorChat({ chatId: btn.dataset.chatId, title: btn.dataset.chatTitle })
      );
    });
    root.querySelector('[data-role="monitor-back"]')?.addEventListener('click', () => store.closeMonitorChat());

    root.querySelector('[data-role="ap-open-change-pw"]')?.addEventListener('click', () => store.openChangePw());

    const overlay = root.querySelector('[data-role="ap-change-pw-overlay"]');
    if (overlay) {
      overlay.addEventListener('click', (e) => { if (e.target === e.currentTarget) store.closeChangePw(); });
      root.querySelector('[data-role="ap-change-pw-close"]')?.addEventListener('click', () => store.closeChangePw());
      const pwForm = root.querySelector('[data-role="ap-change-pw-form"]');
      pwForm?.addEventListener('submit', async (e) => {
        e.preventDefault();
        const fd = new FormData(pwForm);
        const currentPassword = String(fd.get('currentPassword') || '');
        const newPassword = String(fd.get('newPassword') || '');
        const confirmPassword = String(fd.get('confirmPassword') || '');
        const confirmInput = pwForm.querySelector('[name="confirmPassword"]');
        if (newPassword !== confirmPassword) {
          confirmInput?.setCustomValidity('Passwords do not match.');
          pwForm.reportValidity();
          return;
        }
        confirmInput?.setCustomValidity('');
        const btn = pwForm.querySelector('[type="submit"]');
        if (btn) btn.disabled = true;
        await store.submitChangePw({ currentPassword, newPassword });
        if (btn) btn.disabled = false;
      });
      bindPasswordToggles(overlay);
    }
  }

  store.subscribe((state) => {
    if (state.status === 'checking') {
      root.innerHTML = '<div class="ap-checking">Loading…</div>';
      return;
    }
    if (state.status === 'denied') { root.innerHTML = renderDeniedPage(state); bind(); return; }
    if (state.status === 'login' || state.status === 'loading') { root.innerHTML = renderLoginPage(state); bind(); return; }
    root.innerHTML = renderDashboard(state);
    bind();
  });

  store.bootstrap();
}
