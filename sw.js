const CACHE = 'pillflow-v2';
const ASSETS = [
  './',
  './index.html',
  './app.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', e => {
  e.respondWith(
    caches.match(e.request).then(r => r || fetch(e.request).catch(() => caches.match('./index.html')))
  );
});

// Notification click / snooze
self.addEventListener('notificationclick', event => {
  const action = event.action;
  const data = event.notification.data || {};
  event.notification.close();

  if (action === 'snooze10' || action === 'snooze30') {
    const mins = action === 'snooze10' ? 10 : 30;
    const delay = mins * 60 * 1000;
    event.waitUntil(
      (async () => {
        // Schedule via setTimeout in SW is unreliable when SW sleeps —
        // store and show after delay while SW is alive; also notify clients
        await new Promise(r => setTimeout(r, Math.min(delay, 25000)));
        // For full delay, message clients to reschedule
        const clientsList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
        clientsList.forEach(c => {
          c.postMessage({
            type: 'PILLFLOW_SNOOZE',
            mins: mins,
            title: data.title || 'PillFlow',
            body: data.body || 'Време за хапче',
            tag: data.tag || 'pillflow-snooze'
          });
        });
        // Also try to show if SW still alive after short wait (best-effort)
      })()
    );
    return;
  }

  // Default: open app
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
      if (list.length > 0) return list[0].focus();
      return self.clients.openWindow('./index.html');
    })
  );
});

self.addEventListener('notificationclose', () => {});
