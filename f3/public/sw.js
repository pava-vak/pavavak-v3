// __SW_VERSION__ is replaced at build time by the injectSwVersion plugin in vite.config.js
const _v = typeof __SW_VERSION__ !== 'undefined' ? __SW_VERSION__ : 'dev';
const SHELL_CACHE = `pava-shell-${_v}`;
const ASSET_CACHE = `pava-assets-${_v}`;

// On install: cache the navigation shell only
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(['/', '/icon.svg', '/icon-maskable.svg'])
    )
  );
  self.skipWaiting();
});

// On activate: drop all old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Never intercept API, WebSocket, or cross-origin
  if (
    url.pathname.startsWith('/api/') ||
    url.pathname.startsWith('/socket.io') ||
    url.origin !== self.location.origin
  ) {
    return;
  }

  // Hashed build assets (/assets/*.js, /assets/*.css) → cache-first
  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const hit = await cache.match(event.request);
        if (hit) return hit;
        const response = await fetch(event.request);
        if (response.ok) cache.put(event.request, response.clone());
        return response;
      })
    );
    return;
  }

  // Navigation (HTML pages) → network first, fall back to cached shell
  if (event.request.mode === 'navigate') {
    event.respondWith(
      fetch(event.request).catch(() =>
        caches.match('/').then((cached) => cached || new Response('Offline', { status: 503 }))
      )
    );
    return;
  }

  // Static files (icons, manifest) → network first with cache fallback
  event.respondWith(
    fetch(event.request)
      .then((response) => {
        if (response.ok) {
          const clone = response.clone();
          caches.open(SHELL_CACHE).then((cache) => cache.put(event.request, clone));
        }
        return response;
      })
      .catch(() => caches.match(event.request))
  );
});

// ── Push: show notification (skip if any client window is focused) ────────
self.addEventListener('push', (event) => {
  event.waitUntil((async () => {
    let data = {};
    try {
      data = event.data ? event.data.json() : {};
    } catch {
      data = { title: 'New message', body: 'You have a new message' };
    }

    // Suppress notification if the app is already open and in focus
    const windowClients = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (windowClients.some(c => c.focused)) return;

    const title = data.title || 'New message';
    const options = {
      body: data.body || 'You have a new message',
      icon: data.icon || '/icon.svg',
      badge: data.badge || '/icon.svg',
      tag: data.chatId || 'pava-message',
      renotify: true,
      data: { chatId: data.chatId || '' },
      vibrate: [100, 50, 100]
    };

    await self.registration.showNotification(title, options);
  })());
});

// ── Message from client: clear all notifications ──────────────────────────
self.addEventListener('message', (event) => {
  if (event.data?.type === 'CLEAR_NOTIFICATIONS') {
    event.waitUntil(
      self.registration.getNotifications().then(notifs => notifs.forEach(n => n.close()))
    );
  }
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
