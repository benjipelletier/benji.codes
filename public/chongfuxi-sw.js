// 重复习's service worker: the app opens with no connection (the owner, before
// a flight: "review my cards offline"). Served from the root so its scope can
// be /chongfuxi (the page has no trailing slash). It keeps:
//   the page itself        network first, the last copy when offline
//   the app's code, fonts  cache first (their names change with their content)
//   Today's figures        network first, the last answer when offline
// Everything else goes to the network as before: answers wait in the outbox,
// and a session deals from the offline pack (chongfuxi/lib/offline.ts).

const PAGE = "cfx-page-v1";
const STATIC = "cfx-static-v1";
const API = "cfx-api-v1";
const KEEP = [PAGE, STATIC, API, "cfx-offline-pack"];
/** The few reads Today needs to draw, kept as last answered. */
const API_KEPT = ["/api/chongfuxi/summary", "/api/chongfuxi/days", "/api/chongfuxi/habit"];

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    caches
      .open(PAGE)
      .then((c) => c.add(new Request("/chongfuxi", { cache: "reload" })))
      .catch(() => undefined),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith("cfx-") && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

/** From the network, kept under `key`; the kept copy when the network fails. */
async function networkFirst(req, cacheName, key) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetch(req);
    if (res.ok) await cache.put(key, res.clone());
    return res;
  } catch (err) {
    const kept = await cache.match(key);
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
  if (res.ok) await cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The page, whatever its query (?tab=…): one copy.
  if (req.mode === "navigate" && url.pathname.startsWith("/chongfuxi")) {
    e.respondWith(networkFirst(req, PAGE, "/chongfuxi"));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || (url.pathname.startsWith("/chongfuxi/") && /\.(png|webmanifest|ico|svg)$/.test(url.pathname))) {
    e.respondWith(cacheFirst(req));
    return;
  }
  if (API_KEPT.includes(url.pathname)) {
    e.respondWith(networkFirst(req, API, url.pathname));
  }
});
