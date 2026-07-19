import { escapeHtml } from '../../shared/html.js';
import { THEMES } from '../../shared/themeStore.js';

const BRAND_FEATURES = [
  { icon: '⚡', label: 'Lightning-fast delivery' },
  { icon: '🔒', label: 'Private by default' },
  { icon: '💬', label: 'Realtime, everywhere' }
];

function themeChip(theme, activeThemeId) {
  const isActive = theme.id === activeThemeId;
  return `
    <button
      type="button"
      class="theme-chip ${isActive ? 'theme-chip-active' : ''}"
      data-theme-id="${escapeHtml(theme.id)}"
      aria-pressed="${isActive ? 'true' : 'false'}"
    >
      <span class="theme-swatch" style="background:${escapeHtml(theme.swatch)}"></span>
      <span>${escapeHtml(theme.label)}</span>
    </button>
  `;
}

function quickUserCard(user) {
  return `
    <button class="dev-user-chip"
      data-user-id="${escapeHtml(String(user.userId))}"
      data-username="${escapeHtml(user.username)}"
      data-display-name="${escapeHtml(user.displayName)}"
      data-is-admin="${user.isAdmin ? 'true' : 'false'}">
      <span>${escapeHtml(user.displayName)}</span>
      <small>${escapeHtml(user.username)} / ${escapeHtml(user.password)}</small>
    </button>
  `;
}

function brandPanel() {
  return `
    <aside class="auth-brand">
      <p class="brand-mark">PaVa-V3</p>
      <h2 class="brand-tagline">Messaging at the speed of thought.</h2>
      <p class="brand-sub">A clean-room messenger built for one goal — get your words there instantly, and keep them yours.</p>
      <ul class="brand-features">
        ${BRAND_FEATURES.map((feature) => `
          <li>
            <span class="feature-dot" aria-hidden="true">${feature.icon}</span>
            <span>${escapeHtml(feature.label)}</span>
          </li>
        `).join('')}
      </ul>
    </aside>
  `;
}

export function renderLoginView({ state, appEnv = 'development', activeThemeId = 'sandstone' }) {
  const showDevTools = appEnv !== 'production';
  const isLoading = state.status === 'loading';
  const quickUsers = [
    { userId: 1,   username: 'admin',  password: 'admin123',  displayName: 'Admin',      isAdmin: true  },
    { userId: 2,   username: 'demo',   password: 'demo123',   displayName: 'Demo User',  isAdmin: false },
    { userId: 3,   username: 'tester', password: 'tester123', displayName: 'Tester',     isAdmin: false },
    { userId: 101, username: 'nenu',   password: 'nenu123',   displayName: 'Nenu Natho', isAdmin: false }
  ];

  return `
    <div class="auth-shell">
      ${brandPanel()}
      <div class="auth-card-wrap">
        <section class="auth-card">
          <div class="auth-copy">
            <p class="eyebrow">Welcome back</p>
            <h1>Sign in</h1>
            <p class="muted">Use your username and password to open your messages.</p>
          </div>

          <div class="auth-tabs" role="tablist">
            <button class="auth-tab auth-tab-active" type="button" data-auth-tab="login">Login</button>
            <button class="auth-tab" type="button" data-auth-tab="register">Register</button>
          </div>

          <form class="auth-form" data-role="login-form">
            <label>
              <span>Username</span>
              <input name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required />
            </label>
            <label>
              <span>Password</span>
              <span class="password-field">
                <input name="password" type="password" autocomplete="current-password" required />
                <button type="button" class="password-toggle" data-role="password-toggle" aria-label="Show password">Show</button>
              </span>
            </label>
            <button class="primary-button" type="submit" ${isLoading ? 'disabled' : ''}>
              ${isLoading ? 'Signing in...' : 'Login'}
            </button>
          </form>

          <form class="auth-form hidden" data-role="register-form">
            <label>
              <span>Display name</span>
              <input name="displayName" type="text" autocomplete="name" required />
            </label>
            <label>
              <span>Username</span>
              <input name="username" type="text" autocomplete="username" autocapitalize="none" spellcheck="false" required />
            </label>
            <label>
              <span>Password</span>
              <span class="password-field">
                <input name="password" type="password" minlength="8" autocomplete="new-password" required />
                <button type="button" class="password-toggle" data-role="password-toggle" aria-label="Show password">Show</button>
              </span>
            </label>
            <button class="primary-button" type="submit" ${isLoading ? 'disabled' : ''}>
              ${isLoading ? 'Creating account...' : 'Create account'}
            </button>
          </form>

          ${state.error ? `<p class="error-text" role="alert">${escapeHtml(state.error)}</p>` : ''}

          <div class="auth-footer">
            <div class="theme-switcher">
              <p class="footer-label">Theme</p>
              <div class="theme-switcher-options" role="group" aria-label="Select a theme">
                ${THEMES.map((theme) => themeChip(theme, activeThemeId)).join('')}
              </div>
            </div>

            ${showDevTools ? `
            <div class="dev-users">
              <p class="footer-label">Quick local accounts</p>
              <div class="dev-user-list">
                ${quickUsers.map(quickUserCard).join('')}
              </div>
            </div>
            ` : ''}
          </div>
        </section>
      </div>
    </div>
  `;
}

export function bindLoginView(root, { onLogin, onRegister, onQuickLogin, onSelectTheme }) {
  const loginForm = root.querySelector('[data-role="login-form"]');
  const registerForm = root.querySelector('[data-role="register-form"]');
  const loginTab = root.querySelector('[data-auth-tab="login"]');
  const registerTab = root.querySelector('[data-auth-tab="register"]');

  function setTab(tab) {
    const isLogin = tab === 'login';
    loginForm?.classList.toggle('hidden', !isLogin);
    registerForm?.classList.toggle('hidden', isLogin);
    loginTab?.classList.toggle('auth-tab-active', isLogin);
    registerTab?.classList.toggle('auth-tab-active', !isLogin);
  }

  loginTab?.addEventListener('click', () => setTab('login'));
  registerTab?.addEventListener('click', () => setTab('register'));

  loginForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(loginForm);
    onLogin({
      username: String(formData.get('username') || ''),
      password: String(formData.get('password') || '')
    });
  });

  registerForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    const formData = new FormData(registerForm);
    onRegister({
      displayName: String(formData.get('displayName') || ''),
      username: String(formData.get('username') || ''),
      password: String(formData.get('password') || '')
    });
  });

  root.querySelectorAll('[data-role="password-toggle"]').forEach((toggle) => {
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

  root.querySelectorAll('.dev-user-chip').forEach((button) => {
    button.addEventListener('click', () => {
      onQuickLogin({
        userId: Number(button.dataset.userId),
        username: button.dataset.username,
        displayName: button.dataset.displayName,
        isAdmin: button.dataset.isAdmin === 'true'
      });
    });
  });

  root.querySelectorAll('.theme-chip').forEach((button) => {
    button.addEventListener('click', () => {
      onSelectTheme?.(button.dataset.themeId);
    });
  });
}
