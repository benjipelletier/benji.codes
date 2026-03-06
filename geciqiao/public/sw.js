// Minimal service worker — enables PWA installability and Web Share Target
const CACHE = 'geciqiao-v1';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('fetch', e => {
  // Pass through all requests — no offline caching needed
  e.respondWith(fetch(e.request));
});
