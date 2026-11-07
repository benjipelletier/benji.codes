// Voiceshed's service worker, the same approach as 重复习's
// (public/chongfuxi-sw.js): the app opens with no connection. Served from the
// root so its scope can be /voiceshed. It keeps:
//   the three pages        network first, the last copy when offline
//   the app's code, fonts  cache first (their names change with their content)
//   Google Fonts           cache first
// The data itself (voicings, progressions, tunes, schedules, answers) is in
// IndexedDB (voiceshed/components/TrainerProvider.tsx), so the API is
// left to the network: a failed sync just waits for the connection.

const PAGE = "vsh-page-v1";
// v2: drops a manifest kept from v1, which kept it cache first (see below).
const STATIC = "vsh-static-v2";
const KEEP = [PAGE, STATIC];
const ROUTES = ["/voiceshed", "/voiceshed/practice", "/voiceshed/voicings"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches
      .open(PAGE)
      .then((c) => Promise.all(ROUTES.map((r) => c.add(new Request(r, { cache: "reload" })).catch(() => undefined))))
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("vsh-") && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** From the network, kept under `key`; the kept copy when the network fails (for a page, else the main page). */
async function networkFirst(req, key, isPage = true) {
  const cache = await caches.open(PAGE);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const kept = (await cache.match(key)) || (isPage ? await cache.match(ROUTES[0]) : undefined);
    if (kept) return kept;
    throw err;
  }
}

/** From the cache when there; else the network, kept. */
async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const kept = await cache.match(req);
  if (kept) return kept;
  const res = await fetch(req);
  if (res.ok || res.type === "opaque") await cache.put(req, res.clone());
  return res;
}

/** A page's path without a trailing slash, or null when it isn't one of the trainer's. */
function route(url) {
  const p = url.pathname.replace(/\/+$/, "") || "/";
  return ROUTES.includes(p) ? p : null;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin === "https://fonts.googleapis.com" || url.origin === "https://fonts.gstatic.com") {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (url.origin !== self.location.origin) return;
  // A page, whatever its query: one copy each. A fetch of the page itself
  // (the app saving it for offline) is kept the same way.
  const r = route(url);
  if (r && (req.mode === "navigate" || req.destination === "" || req.destination === "document") && !req.headers.get("RSC")) {
    e.respondWith(networkFirst(req, r));
    return;
  }
  // The manifest describes the installed app, so it's fetched fresh when online
  // (cache first would keep an old one on the phone for good); the last copy offline.
  if (url.pathname === "/voiceshed/manifest.webmanifest") {
    e.respondWith(networkFirst(req, url.pathname, false));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || (url.pathname.startsWith("/voiceshed/") && /\.(png|ico|svg)$/.test(url.pathname))) {
    e.respondWith(cacheFirst(req));
  }
});
