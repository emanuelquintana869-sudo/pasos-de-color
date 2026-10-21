// Service worker de Pasos de Color: recibe notificaciones push.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let data = {};
  try { data = event.data ? event.data.json() : {}; } catch { data = { body: event.data && event.data.text() }; }
  const title = data.title || 'Pasos de Color';
  event.waitUntil(self.registration.showNotification(title, {
    body: data.body || '¡Hay novedades en la ronda!',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: data.tag || 'pdc',
    renotify: true,
    data: { url: data.url || '/' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.location.origin)) { await c.focus(); c.navigate(url); return; }
    }
    await self.clients.openWindow(url);
  })());
});
