import { apiRequest } from './apiClient.js';

let _registration = null;

export function setServiceWorkerRegistration(reg) {
  _registration = reg;
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map((c) => c.charCodeAt(0)));
}

export async function initPush() {
  if (!('serviceWorker' in navigator) || !('PushManager' in window)) return;
  if (!_registration) return;

  // Don't ask twice — if already granted or denied, respect it
  const permission = Notification.permission;
  if (permission === 'denied') return;

  try {
    // Fetch VAPID public key from backend
    const { publicKey } = await apiRequest('/api/v3/push/vapid-public-key', { method: 'GET' });
    if (!publicKey) return;

    // Check if already subscribed
    const existing = await _registration.pushManager.getSubscription();
    if (existing) {
      await syncSubscription(existing);
      return;
    }

    // Request permission and subscribe
    const result = await Notification.requestPermission();
    if (result !== 'granted') return;

    const subscription = await _registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicKey)
    });

    await syncSubscription(subscription);
  } catch {
    // Push setup failed silently — app still works without it
  }
}

async function syncSubscription(subscription) {
  try {
    await apiRequest('/api/v3/push/subscribe', {
      method: 'POST',
      body: JSON.stringify(subscription.toJSON())
    });
  } catch {
    // Ignore — will retry on next session
  }
}

export async function unsubscribePush() {
  if (!_registration) return;
  try {
    const sub = await _registration.pushManager.getSubscription();
    if (!sub) return;
    await apiRequest('/api/v3/push/subscribe', {
      method: 'DELETE',
      body: JSON.stringify({ endpoint: sub.endpoint })
    });
    await sub.unsubscribe();
  } catch {
    // Ignore
  }
}
