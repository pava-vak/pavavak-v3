import { escapeHtml } from '../../shared/html.js';
import { changePassword } from '../../shared/apiClient.js';

export function renderSettingsModal() {
  return `
    <div class="settings-overlay" data-role="settings-overlay">
      <div class="settings-modal" role="dialog" aria-modal="true" aria-label="Settings">
        <div class="settings-header">
          <h2 class="settings-title">Settings</h2>
          <button class="settings-close" data-role="settings-close" aria-label="Close">✕</button>
        </div>
        <div class="settings-body">
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

export function bindSettingsModal(root, { onClose }) {
  root.querySelector('[data-role="settings-close"]')?.addEventListener('click', onClose);
  root.querySelector('[data-role="settings-overlay"]')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) onClose();
  });

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

  const form = root.querySelector('[data-role="change-password-form"]');
  const errorEl = root.querySelector('#settings-pw-error');
  const successEl = root.querySelector('#settings-pw-success');

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.style.display = 'block';
    if (successEl) successEl.style.display = 'none';
  }

  function showSuccess() {
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

    if (newPassword !== confirmPassword) {
      showError('New passwords do not match.');
      return;
    }
    if (newPassword.length < 8) {
      showError('New password must be at least 8 characters.');
      return;
    }

    const submitBtn = form.querySelector('[type="submit"]');
    if (submitBtn) submitBtn.disabled = true;
    try {
      await changePassword({ currentPassword, newPassword });
      showSuccess();
    } catch (err) {
      showError(err.message || 'Failed to change password.');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
    }
  });
}
