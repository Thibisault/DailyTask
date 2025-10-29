/* DailyTask Service Worker */
const CACHE_NAME = 'dailytask-cache-v1';
const FILES_TO_CACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './assets/styles.css',
  './assets/app.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-192.png',
  './icons/maskable-512.png'
];

self.addEventListener('install', (event) => {
  self.skipWaiting();
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache => cache.addAll(FILES_TO_CACHE))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then(keys => Promise.all(
      keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // App shell and same-origin requests: cache-first with network fallback
  if (new URL(req.url).origin === self.location.origin) {
    // Ensure navigations work offline
    if (req.mode === 'navigate') {
      event.respondWith(
        caches.match('./index.html').then(cached => cached || fetch(req))
      );
      return;
    }

    event.respondWith(
      caches.match(req).then(cached => cached || fetch(req))
    );
    return;
  }

  // For cross-origin (not expected here), just pass through
  event.respondWith(fetch(req));
});
