// Service Worker — Dutta Food Planner
//
// Strategy: NETWORK-FIRST for all static assets.
// Always fetch fresh files from the server; serve from cache only when
// the network is unavailable (offline / connection lost).
//
// Why network-first instead of cache-first?
// The app doesn't use content-hashed filenames (app.js, style.css etc. keep
// the same name across deployments), so a cache-first strategy would silently
// serve stale files after every deploy.  Network-first means updates are
// visible immediately while the app still loads when the user is offline.

const CACHE = "dutta-v4"; // reverted to original dark-green/gold icon

const SHELL = [
  "/",
  "/index.html",
  "/style.css",
  "/app.js",
  "/manifest.json",
  "/icon.svg",
  "/icon-maskable.svg",
];

// ── Install: pre-cache the app shell ──────────────────────
self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE).then((c) => c.addAll(SHELL))
  );
  self.skipWaiting();
});

// ── Activate: purge old caches ────────────────────────────
self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// ── Fetch: network-first, cache as offline fallback ───────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // API requests and non-GET → pass through untouched (never cache)
  if (url.pathname.startsWith("/api/")) return;
  if (event.request.method !== "GET") return;

  event.respondWith(
    fetch(event.request)
      .then((response) => {
        // Update the cache with the fresh response for offline use
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return response;
      })
      .catch(() =>
        // Network unavailable — serve from cache so the app still opens
        caches.match(event.request)
      )
  );
});
