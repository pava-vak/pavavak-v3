import { escapeHtml } from '../../shared/html.js';

const PERMISSIONS = [
  { id: 'notifications', icon: '🔔', label: 'Notifications', desc: 'New message alerts' },
  { id: 'microphone',   icon: '🎤', label: 'Microphone',   desc: 'Voice messages' },
  { id: 'camera',       icon: '📷', label: 'Camera',       desc: 'Share photos & video' },
  { id: 'location',     icon: '📍', label: 'Location',     desc: 'Share your location' },
  { id: 'storage',      icon: '💾', label: 'Storage',      desc: 'Use app offline' },
];

function pinDots(entry) {
  return Array.from({ length: 4 }, (_, i) =>
    `<span class="pin-dot ${i < entry.length ? 'filled' : ''}"></span>`
  ).join('');
}

function pinPad() {
  return `
    <div class="app-pin-pad">
      ${[1,2,3,4,5,6,7,8,9].map(k =>
        `<button class="pin-key" data-role="ob-pin-key" data-key="${k}">${k}</button>`
      ).join('')}
      <div class="pin-key-empty"></div>
      <button class="pin-key" data-role="ob-pin-key" data-key="0">0</button>
      <button class="pin-key pin-key-back" data-role="ob-pin-key" data-key="back">⌫</button>
    </div>
  `;
}

function card(icon, title, sub, body, skipLabel = 'Skip for now') {
  return `
    <div class="app-lock-screen">
      <div class="app-lock-card ob-card">
        <div class="app-lock-icon">${icon}</div>
        <h1 class="app-lock-title">${escapeHtml(title)}</h1>
        <p class="app-lock-sub">${sub}</p>
        ${body}
        ${skipLabel ? `<button class="app-lock-signout" data-role="ob-skip">${escapeHtml(skipLabel)}</button>` : ''}
      </div>
    </div>
  `;
}

export function renderOnboarding({ step, pinFirst, pinEntry, error }) {
  const errHtml = error ? `<p class="app-lock-error" role="alert">${escapeHtml(error)}</p>` : '';

  if (step === 'welcome') {
    return card('👋', 'Welcome to PaVa Vak', 'Quick setup for the best experience.', `
      <button class="app-lock-btn primary-button" data-role="ob-next">Get Started</button>
    `, 'Skip setup');
  }

  if (step === 'pin') {
    const isConfirm = pinFirst !== '';
    return card(
      '🔢',
      isConfirm ? 'Confirm your PIN' : 'Choose a PIN',
      isConfirm ? 'Re-enter the same 4 digits.' : 'A 4-digit PIN locks your messages.',
      `${errHtml}
       <div class="app-pin-dots" data-role="ob-dots">${pinDots(pinEntry)}</div>
       ${pinPad()}`
    );
  }

  if (step === 'permissions') {
    const items = PERMISSIONS.map(p => `
      <label class="ob-perm-row">
        <span class="ob-perm-icon">${p.icon}</span>
        <span class="ob-perm-text">
          <span class="ob-perm-label">${escapeHtml(p.label)}</span>
          <span class="ob-perm-desc">${escapeHtml(p.desc)}</span>
        </span>
        <input type="checkbox" class="ob-perm-check" data-perm="${p.id}" checked />
      </label>
    `).join('');
    return card('🔑', 'Allow permissions', 'Choose what PaVa Vak can access on your device.', `
      <div class="ob-perm-list">${items}</div>
      <button class="app-lock-btn primary-button" data-role="ob-allow" style="margin-top:4px">Allow Selected</button>
    `);
  }

  if (step === 'done') {
    return card('🎉', "You're all set!", 'PaVa Vak is ready to use.', `
      <button class="app-lock-btn primary-button" data-role="ob-done">Start Messaging</button>
    `, '');
  }

  return '';
}

export async function requestPermissions(selected) {
  for (const id of selected) {
    try {
      if (id === 'notifications' && 'Notification' in window) {
        await Notification.requestPermission();
      } else if (id === 'microphone' && navigator.mediaDevices?.getUserMedia) {
        const s = await navigator.mediaDevices.getUserMedia({ audio: true });
        s.getTracks().forEach(t => t.stop());
      } else if (id === 'camera' && navigator.mediaDevices?.getUserMedia) {
        const s = await navigator.mediaDevices.getUserMedia({ video: true });
        s.getTracks().forEach(t => t.stop());
      } else if (id === 'location' && navigator.geolocation) {
        await new Promise(r => navigator.geolocation.getCurrentPosition(r, r, { timeout: 10000 }));
      } else if (id === 'storage' && navigator.storage?.persist) {
        await navigator.storage.persist();
      }
    } catch { /* user denied — silently continue */ }
  }
}
