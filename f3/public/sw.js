const CACHE = 'pava-v3-shell-v1';

const SHELL = [
  '/',
  '/src/styles.css',
  '/icon.svg',
  '/icon-maskable.svg'
];

// ── Install: cache the app shell ─────────────────────────────────────────
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE).then((cache) => cache.addAll(SHELL))
  );
  self.skipWaiting();
});

// ── Activate: drop old caches ─────────────────────────────────────────────
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first for API/socket, cache-first for shell ───────────
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API, socket, or cross-origin requests
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  event.respondWith(
    fetch(event.request).catch(() =>
      caches.match(event.request).then((cached) => cached || caches.match('/'))
    )
  );
});

// ── Push: show notification ───────────────────────────────────────────────
self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: 'PaVa', body: event.data ? event.data.text() : 'New message' };
  }

  const title = data.title || 'PaVa';
  const options = {
    body: data.body || 'You have a new message',
    icon: data.icon || '/icon.svg',
    badge: data.badge || '/icon.svg',
    tag: data.chatId || 'pava-message',   // groups notifications per chat
    renotify: true,
    data: { chatId: data.chatId || '' },
    vibrate: [100, 50, 100]
  };

  event.waitUntil(self.registration.showNotification(title, options));
});

// ── Notification click: open / focus the app ──────────────────────────────
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const chatId = event.notification.data?.chatId || '';
  const target = self.location.origin + (chatId ? `/?chat=${encodeURIComponent(chatId)}` : '/');

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if (client.url.startsWith(self.location.origin) && 'focus' in client) {
          client.postMessage({ type: 'OPEN_CHAT', chatId });
          return client.focus();
        }
      }
      return clients.openWindow(target);
    })
  );
});
