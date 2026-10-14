import { escapeHtml } from '../../shared/html.js';
import { changePassword } from '../../shared/apiClient.js';
import { isEnabled as isLockEnabled, hasPin, getLockTimer, hasBiometricEnrolled } from '../../shared/biometricLock.js';
import { THEMES, getActiveTheme, setTheme } from '../../shared/themeStore.js';

function getLockScreenPrefs() {
  return {
    name: localStorage.getItem('pava-lock-name') || '',
    hasIcon: localStorage.getItem('pava-lock-icon') !== null,
    hidden: localStorage.getItem('pava-lock-icon-hidden') === '1',
    iconData: localStorage.getItem('pava-lock-icon') || null
  };
}

export function renderSettingsModal(user = {}, biometricAvailable = false) {
  const displayName = user.displayName || '';
  const username = user.username || '';
  const lockEnabled = isLockEnabled();
  const lockTimer = getLockTimer();
  const biometricEnabled = lockEnabled && hasBiometricEnrolled();
  const pinEnabled = hasPin();
  return `
    <div class="settings-overlay" data-role="settings-overlay">
      <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="settings-header">
          <h2 class="settings-title">Settings</h2>
          <button class="settings-close" data-role="settings-close" aria-label="Close">✕</button>
        </div>
        <div class="settings-body">

          <section class="settings-section">
            <h3 class="settings-section-title">Display Name</h3>
            <p class="settings-section-sub">This is how others see you. Username <strong>@${escapeHtml(username)}</strong> cannot be changed.</p>
            <div id="settings-name-error" class="settings-error" role="alert" style="display:none"></div>
            <div id="settings-name-success" class="settings-success" role="status" style="display:none">
              Name updated successfully.
            </div>
            <form class="settings-form" data-role="change-name-form">
              <label class="settings-field">
                <span>Display name</span>
                <input class="settings-input" name="displayName" type="text"
                  autocomplete="name" maxlength="80"
                  value="${escapeHtml(displayName)}" required />
              </label>
              <button class="settings-submit primary-button" type="submit">Update Name</button>
            </form>
          </section>

          <section class="settings-section">
            <h3 class="settings-section-title">App Lock</h3>
            <p class="settings-section-sub">Lock PaVa Vak when you leave the app.</p>
            <div id="settings-lock-error" class="settings-error" role="alert" style="display:none"></div>
            <div id="settings-lock-success" class="settings-success" role="status" style="display:none"></div>

            ${biometricAvailable ? `
            <div class="settings-lock-row">
              <span class="settings-lock-label">${biometricEnabled ? '🔐 Biometric ON' : '🔐 Biometric OFF'}</span>
              ${biometricEnabled
                ? `<button class="settings-lock-btn settings-lock-btn--off" data-role="disable-biometric">Remove</button>`
                : `<button class="settings-lock-btn settings-lock-btn--on" data-role="enable-lock">Enable</button>`
              }
            </div>
            ` : `<p class="settings-lock-hint" style="margin-top:4px">Biometric not available — use PIN lock below.</p>`}

            <div class="settings-lock-row" style="margin-top:8px">
              <span class="settings-lock-label">${pinEnabled ? '🔢 PIN ON' : '🔢 PIN OFF'}</span>
              <div style="display:flex;gap:6px">
                ${pinEnabled
                  ? `<button class="settings-lock-btn settings-lock-btn--on" data-role="change-pin">Change</button>
                     <button class="settings-lock-btn settings-lock-btn--off" data-role="remove-pin">Remove</button>`
                  : `<button class="settings-lock-btn settings-lock-btn--on" data-role="set-pin">Set PIN</button>`
                }
              </div>
            </div>

            ${lockEnabled ? `
            <div class="settings-lock-row" style="margin-top:12px">
              <label class="settings-lock-label" for="lock-timer-select">Lock after</label>
              <select id="lock-timer-select" class="settings-input" data-role="lock-timer" style="width:auto;padding:4px 8px">
                <option value="0"    ${lockTimer === 0   ? 'selected' : ''}>Immediately</option>
                <option value="60"   ${lockTimer === 60  ? 'selected' : ''}>1 minute</option>
                <option value="300"  ${lockTimer === 300 ? 'selected' : ''}>5 minutes</option>
                <option value="900"  ${lockTimer === 900 ? 'selected' : ''}>15 minutes</option>
              </select>
            </div>
            <div style="margin-top:10px">
              <button class="settings-lock-btn settings-lock-btn--off" data-role="lock-now" style="width:auto;padding:6px 16px">🔒 Lock Now</button>
              <button class="settings-lock-btn settings-lock-btn--off" data-role="disable-lock" style="width:auto;padding:6px 16px;margin-left:6px">Turn Off All</button>
            </div>
            ` : ''}
          </section>

          <section class="settings-section">
            <h3 class="settings-section-title">Lock Screen Appearance</h3>
            <p class="settings-section-sub">Customise what shows on the lock screen when your app is locked.</p>
            ${(() => {
              const prefs = getLockScreenPrefs();
              const iconPreview = prefs.hidden
                ? `<span class="ls-icon-preview ls-icon-none">Hidden</span>`
                : prefs.iconData
                  ? `<img src="${escapeHtml(prefs.iconData)}" class="ls-icon-preview ls-icon-img" alt="Lock screen icon"/>`
                  : `<span class="ls-icon-preview ls-icon-initial">${escapeHtml((prefs.name || 'PaVa Vak').slice(0,1).toUpperCase())}</span>`;
              return `
                <div class="settings-form">
                  <label class="settings-field">
                    <span>App name on lock screen</span>
                    <input class="settings-input" data-role="ls-name" type="text"
                      placeholder="PaVa Vak" maxlength="40"
                      value="${escapeHtml(prefs.name)}" />
                  </label>
                  <div class="settings-field">
                    <span>Icon</span>
                    <div class="ls-icon-row">
                      ${iconPreview}
                      <label class="settings-lock-btn settings-lock-btn--on ls-icon-upload-label" title="Upload image">
                        Change photo
                        <input type="file" accept="image/*" data-role="ls-icon-file" class="ls-file-hidden"/>
                      </label>
                      ${prefs.iconData ? `<button class="settings-lock-btn settings-lock-btn--off" data-role="ls-icon-reset">Remove</button>` : ''}
                      <button class="settings-lock-btn ${prefs.hidden ? 'settings-lock-btn--on' : 'settings-lock-btn--off'}" data-role="ls-icon-toggle-hide">
                        ${prefs.hidden ? 'Show icon' : 'Hide icon'}
                      </button>
                    </div>
                  </div>
                  <button class="settings-submit primary-button" data-role="ls-save">Save</button>
                  <div id="settings-ls-success" class="settings-success" style="display:none">Lock screen updated.</div>
                </div>
              `;
            })()}
          </section>

          <section class="settings-section">
            <h3 class="settings-section-title">Theme</h3>
            <p class="settings-section-sub">Choose a colour palette for the app.</p>
            <p class="settings-section-sub" style="margin-top:6px;font-size:0.7rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.08em;">Dark</p>
            <div class="theme-switcher-options" id="settings-theme-chips">
              ${THEMES.filter(t => t.scheme === 'dark').map(t => {
                const active = getActiveTheme() === t.id;
                return `<button
                  class="theme-chip ${active ? 'theme-chip-active' : ''}"
                  data-role="settings-theme-chip"
                  data-theme="${escapeHtml(t.id)}"
                  aria-pressed="${active}"
                  aria-label="${escapeHtml(t.label)} dark theme">
                  <span class="theme-swatch" style="background:${escapeHtml(t.swatch)}"></span>
                  ${escapeHtml(t.label)}
                </button>`;
              }).join('')}
            </div>
            <p class="settings-section-sub" style="margin-top:12px;font-size:0.7rem;opacity:0.6;text-transform:uppercase;letter-spacing:0.08em;">Light</p>
            <div class="theme-switcher-options" id="settings-theme-chips-light">
              ${THEMES.filter(t => t.scheme === 'light').map(t => {
                const active = getActiveTheme() === t.id;
                return `<button
                  class="theme-chip ${active ? 'theme-chip-active' : ''}"
                  data-role="settings-theme-chip"
                  data-theme="${escapeHtml(t.id)}"
                  aria-pressed="${active}"
                  aria-label="${escapeHtml(t.label)} light theme">
                  <span class="theme-swatch" style="background:${escapeHtml(t.swatch)}"></span>
                  ${escapeHtml(t.label)}
                </button>`;
              }).join('')}
            </div>
          </section>

          <section class="settings-section">
            <h3 class="settings-section-title">Starred Messages</h3>
            <p class="settings-section-sub">Messages you've bookmarked across all chats.</p>
            <button class="secondary-button" style="margin-top:8px" data-role="view-starred">⭐ View Starred Messages</button>
          </section>

          <section class="settings-section">
            <h3 class="settings-section-title">Change Password</h3>
            <p class="settings-section-sub">Enter your current password to set a new one.</p>
            <div id="settings-pw-error" class="settings-error" role="alert" style="display:none"></div>
            <div id="settings-pw-success" class="settings-success" role="status" style="display:none">
              Password changed successfully.
            </div>
            <form class="settings-form" data-role="change-password-form">
              <label class="settings-field">
                <span>Current password</span>
                <span class="password-field">
                  <input class="settings-input" name="currentPassword" type="password"
                    autocomplete="current-password" required />
                  <button type="button" class="password-toggle" data-role="password-toggle" aria-label="Show password">Show</button>
                </span>
              </label>
              <label class="settings-field">
                <span>New password</span>
                <span class="password-field">
                  <input class="settings-input" name="newPassword" type="password"
                    autocomplete="new-password" minlength="8" required />
                  <button type="button" class="password-toggle" data-role="password-toggle" aria-label="Show password">Show</button>
                </span>
              </label>
              <label class="settings-field">
                <span>Confirm new password</span>
                <span class="password-field">
                  <input class="settings-input" name="confirmPassword" type="password"
                    autocomplete="new-password" minlength="8" required />
                  <button type="button" class="password-toggle" data-role="password-toggle" aria-label="Show password">Show</button>
                </span>
              </label>
              <button class="settings-submit primary-button" type="submit">Update Password</button>
            </form>
          </section>

        </div>
      </div>
    </div>
  `;
}

export function bindSettingsModal(root, { onClose, onUpdateDisplayName, onEnableLock, onDisableLock, onDisableBiometric, onSetPin, onRemovePin, onSetLockTimer, onLockNow, onViewStarred }) {
  root.querySelector('[data-role="settings-close"]')?.addEventListener('click', onClose);

  root.querySelector('[data-role="view-starred"]')?.addEventListener('click', () => {
    onViewStarred?.();
  });

  // Theme switcher
  root.querySelectorAll('[data-role="settings-theme-chip"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.theme;
      setTheme(id);
      root.querySelectorAll('[data-role="settings-theme-chip"]').forEach(b => {
        const active = b.dataset.theme === id;
        b.classList.toggle('theme-chip-active', active);
        b.setAttribute('aria-pressed', active);
      });
    });
  });
  root.querySelector('[data-role="settings-overlay"]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) onClose();
  });

  // Password show/hide toggles
  root.querySelectorAll('.settings-modal [data-role="password-toggle"]').forEach((toggle) => {
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

  // App Lock
  const lockErrorEl = root.querySelector('#settings-lock-error');
  const lockSuccessEl = root.querySelector('#settings-lock-success');

  function showLockMsg(el, msg) {
    if (!el) return;
    el.textContent = msg;
    el.style.display = 'block';
  }

  root.querySelector('[data-role="enable-lock"]')?.addEventListener('click', async () => {
    if (lockErrorEl) lockErrorEl.style.display = 'none';
    if (lockSuccessEl) lockSuccessEl.style.display = 'none';
    try {
      await onEnableLock?.();
      showLockMsg(lockSuccessEl, '🔐 App Lock enabled.');
    } catch (err) {
      showLockMsg(lockErrorEl, err.message || 'Could not enable App Lock.');
    }
  });

  root.querySelector('[data-role="disable-lock"]')?.addEventListener('click', () => {
    onDisableLock?.();
    showLockMsg(lockSuccessEl, '🔓 App Lock disabled.');
  });

  root.querySelector('[data-role="disable-biometric"]')?.addEventListener('click', () => {
    onDisableBiometric?.();
    showLockMsg(lockSuccessEl, '🔐 Biometric removed.');
  });

  root.querySelector('[data-role="lock-timer"]')?.addEventListener('change', (e) => {
    onSetLockTimer?.(parseInt(e.target.value, 10));
  });

  root.querySelector('[data-role="lock-now"]')?.addEventListener('click', () => {
    onLockNow?.();
  });

  function promptPin(title, onConfirm) {
    const pin = window.prompt(`${title}\nEnter a 4-digit PIN:`);
    if (!pin) return;
    if (!/^\d{4}$/.test(pin)) {
      showLockMsg(lockErrorEl, 'PIN must be exactly 4 digits.');
      return;
    }
    onConfirm(pin);
  }

  root.querySelector('[data-role="set-pin"]')?.addEventListener('click', () => {
    if (lockErrorEl) lockErrorEl.style.display = 'none';
    if (lockSuccessEl) lockSuccessEl.style.display = 'none';
    promptPin('Set PIN lock', async (pin) => {
      try {
        await onSetPin?.(pin);
        showLockMsg(lockSuccessEl, '🔢 PIN lock enabled.');
      } catch (err) {
        showLockMsg(lockErrorEl, err.message || 'Could not set PIN.');
      }
    });
  });

  root.querySelector('[data-role="change-pin"]')?.addEventListener('click', () => {
    if (lockErrorEl) lockErrorEl.style.display = 'none';
    if (lockSuccessEl) lockSuccessEl.style.display = 'none';
    promptPin('Change PIN', async (pin) => {
      try {
        await onSetPin?.(pin);
        showLockMsg(lockSuccessEl, '🔢 PIN updated.');
      } catch (err) {
        showLockMsg(lockErrorEl, err.message || 'Could not update PIN.');
      }
    });
  });

  root.querySelector('[data-role="remove-pin"]')?.addEventListener('click', () => {
    if (lockErrorEl) lockErrorEl.style.display = 'none';
    if (lockSuccessEl) lockSuccessEl.style.display = 'none';
    onRemovePin?.();
    showLockMsg(lockSuccessEl, '🔢 PIN removed.');
  });

  // Lock screen appearance
  const lsSuccess = root.querySelector('#settings-ls-success');
  const lsNameInput = root.querySelector('[data-role="ls-name"]');
  let lsPendingIcon = undefined; // undefined = no change; null = remove; string = new base64

  root.querySelector('[data-role="ls-icon-file"]')?.addEventListener('change', (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (ev) => {
      lsPendingIcon = ev.target.result; // full data URL
      const preview = root.querySelector('.ls-icon-preview');
      if (preview) {
        preview.outerHTML = `<img src="${escapeHtml(lsPendingIcon)}" class="ls-icon-preview ls-icon-img" alt="Lock screen icon"/>`;
      }
    };
    reader.readAsDataURL(file);
  });

  root.querySelector('[data-role="ls-icon-reset"]')?.addEventListener('click', () => {
    lsPendingIcon = null;
    const preview = root.querySelector('.ls-icon-preview');
    const nameVal = lsNameInput?.value.trim() || 'PaVa Vak';
    if (preview) preview.outerHTML = `<span class="ls-icon-preview ls-icon-initial">${escapeHtml(nameVal.slice(0,1).toUpperCase())}</span>`;
  });

  root.querySelector('[data-role="ls-icon-toggle-hide"]')?.addEventListener('click', (btn) => {
    const el = root.querySelector('[data-role="ls-icon-toggle-hide"]');
    const hidden = localStorage.getItem('pava-lock-icon-hidden') === '1';
    if (hidden) {
      localStorage.removeItem('pava-lock-icon-hidden');
      el.textContent = 'Hide icon';
      el.classList.replace('settings-lock-btn--on', 'settings-lock-btn--off');
    } else {
      localStorage.setItem('pava-lock-icon-hidden', '1');
      el.textContent = 'Show icon';
      el.classList.replace('settings-lock-btn--off', 'settings-lock-btn--on');
    }
  });

  root.querySelector('[data-role="ls-save"]')?.addEventListener('click', () => {
    const name = lsNameInput?.value.trim() || '';
    if (name) localStorage.setItem('pava-lock-name', name);
    else localStorage.removeItem('pava-lock-name');

    if (lsPendingIcon === null) {
      localStorage.removeItem('pava-lock-icon');
    } else if (typeof lsPendingIcon === 'string') {
      try { localStorage.setItem('pava-lock-icon', lsPendingIcon); } catch { /* quota */ }
    }
    lsPendingIcon = undefined;

    if (lsSuccess) { lsSuccess.style.display = 'block'; setTimeout(() => { lsSuccess.style.display = 'none'; }, 2500); }
  });

  // Change display name
  const nameForm = root.querySelector('[data-role="change-name-form"]');
  const nameErrorEl = root.querySelector('#settings-name-error');
  const nameSuccessEl = root.querySelector('#settings-name-success');

  nameForm?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(nameForm);
    const displayName = String(fd.get('displayName') || '').trim();
    if (!displayName) {
      if (nameErrorEl) { nameErrorEl.textContent = 'Display name cannot be empty.'; nameErrorEl.style.display = 'block'; }
      return;
    }
    const btn = nameForm.querySelector('[type="submit"]');
    if (btn) btn.disabled = true;
    if (nameErrorEl) nameErrorEl.style.display = 'none';
    if (nameSuccessEl) nameSuccessEl.style.display = 'none';
    try {
      await onUpdateDisplayName(displayName);
      if (nameSuccessEl) nameSuccessEl.style.display = 'block';
    } catch (err) {
      if (nameErrorEl) { nameErrorEl.textContent = err.message || 'Failed to update name.'; nameErrorEl.style.display = 'block'; }
    } finally {
      if (btn) btn.disabled = false;
    }
  });

  // Change password
  const form = root.querySelector('[data-role="change-password-form"]');
  const errorEl = root.querySelector('#settings-pw-error');
  const successEl = root.querySelector('#settings-pw-success');

  function showPwError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    if (successEl) successEl.style.display = 'none';
  }

  function showPwSuccess() {
    if (!successEl) return;
    successEl.style.display = 'block';
    if (errorEl) errorEl.style.display = 'none';
    form?.reset();
  }

  form?.addEventListener('submit', async (e) => {
    e.preventDefault();
    const fd = new FormData(form);
    const currentPassword = String(fd.get('currentPassword') || '');
    const newPassword = String(fd.get('newPassword') || '');
    const confirmPassword = String(fd.get('confirmPassword') || '');

    if (newPassword !== confirmPassword) { showPwError('New passwords do not match.'); return; }
    if (newPassword.length < 8) { showPwError('New password must be at least 8 characters.'); return; }

    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await changePassword({ currentPassword, newPassword });
      showPwSuccess();
    } catch (err) {
      showPwError(err.message || 'Failed to change password.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
