// 重复习's service worker: the app opens with no connection (the owner, before
// a flight: "review my cards offline"). Served from the root so its scope can
// be /chongfuxi (the page has no trailing slash). It keeps:
//   the page itself        network first, the last copy when offline
//   the app's code, fonts  cache first (their names change with their content)
//   Today's figures        network first, the last answer when offline
// Everything else goes to the network as before: answers wait in the outbox,
// and a session deals from the offline pack (chongfuxi/lib/offline.ts).
//
// Wi-Fi that is connected but not online (a plane's, before its sign-in) is
// the hard case (the owner lost the pack's use on a flight): requests hang,
// or a sign-in page answers every address with its own page. So the network
// is given a few seconds before the kept copy is used, and only what the app
// itself sent is kept: a page that is the app's, JSON from its API, code and
// fonts that aren't a web page. The page and Today's figures start afresh
// (v2), in case a sign-in page was kept in their place before this; the code
// is kept (it is what opens the app offline), less any web page in it.

const PAGE = "cfx-page-v2";
const STATIC = "cfx-static-v1";
const API = "cfx-api-v2";
const KEEP = [PAGE, STATIC, API, "cfx-offline-pack"];
/** The few reads Today needs to draw, kept as last answered. */
const API_KEPT = ["/api/chongfuxi/summary", "/api/chongfuxi/days", "/api/chongfuxi/habit"];
/** How long the network gets before the kept copy is used (ms). */
const PAGE_WAIT = 4000;
const API_WAIT = 5000;

self.addEventListener("install", (e) => {
  self.skipWaiting();
  e.waitUntil(
    (async () => {
      const res = await fetch(new Request("/chongfuxi", { cache: "reload" }));
      if (await isAppPage(res.clone())) await (await caches.open(PAGE)).put("/chongfuxi", res);
    })().catch(() => undefined),
  );
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("cfx-") && !KEEP.includes(k)).map((k) => caches.delete(k)));
      // A sign-in page kept in place of code (before this worker checked) goes.
      const code = await caches.open(STATIC);
      for (const req of await code.keys()) {
        const res = await code.match(req);
        if (res && type(res).includes("text/html")) await code.delete(req);
      }
      await self.clients.claim();
    })(),
  );
});

const type = (res) => res.headers.get("content-type") || "";

/** The app's own page: from this site, not sent elsewhere, and loading the app's code (a sign-in page doesn't). */
async function isAppPage(res) {
  if (!res.ok || res.redirected || !type(res).includes("text/html")) return false;
  try {
    return new URL(res.url).origin === self.location.origin && (await res.text()).includes("/_next/static/");
  } catch {
    return false;
  }
}

/** The network, given `ms` before giving up; a kept copy is better than waiting on Wi-Fi with no internet. */
function fetchWithin(req, ms) {
  return Promise.race([fetch(req), new Promise((_, reject) => setTimeout(() => reject(new Error("timeout")), ms))]);
}

/** From the network if it answers soon with something worth keeping (kept under `key`); else the kept copy. */
async function networkFirst(req, cacheName, key, ms, good) {
  const cache = await caches.open(cacheName);
  try {
    const res = await fetchWithin(req, ms);
    if (await good(res.clone())) {
      await cache.put(key, res.clone());
      return res;
    }
    // Something else answered (a sign-in page): the kept copy, if there is one.
    return (await cache.match(key)) || res;
  } catch (err) {
    const kept = await cache.match(key);
    if (kept) return kept;
    throw err;
  }
}

const emptyScript = () => new Response("", { headers: { "Content-Type": "application/javascript" } });

/** From the cache when there; else the network, kept unless it is a web page in place of code. */
async function cacheFirst(req) {
  const cache = await caches.open(STATIC);
  const kept = await cache.match(req);
  if (kept) return kept;
  const res = await fetch(req);
  if (res.ok && !res.redirected && !type(res).includes("text/html")) await cache.put(req, res.clone());
  return res;
}

self.addEventListener("fetch", (e) => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // The page, whatever its query (?tab=…): one copy.
  if (req.mode === "navigate" && url.pathname.startsWith("/chongfuxi")) {
    e.respondWith(networkFirst(req, PAGE, "/chongfuxi", PAGE_WAIT, isAppPage));
    return;
  }
  if (url.pathname.startsWith("/_next/static/") || (url.pathname.startsWith("/chongfuxi/") && /\.(png|webmanifest|ico|svg)$/.test(url.pathname))) {
    e.respondWith(cacheFirst(req));
    return;
  }
  // Vercel's analytics script: never kept, and on Wi-Fi with no internet it would hang (holding the
  // page's load) or come back as a sign-in page; past a moment, an empty script stands in.
  if (url.pathname.startsWith("/_vercel/")) {
    e.respondWith(
      fetchWithin(req, 2000)
        .then((res) => (res.ok && type(res).includes("javascript") ? res : emptyScript()))
        .catch(emptyScript),
    );
    return;
  }
  if (API_KEPT.includes(url.pathname)) {
    e.respondWith(networkFirst(req, API, url.pathname, API_WAIT, async (res) => res.ok && type(res).includes("application/json")));
  }
});
