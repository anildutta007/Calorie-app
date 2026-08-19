// Service Worker — Dutta Food Planner
// Cache static shell for offline load; always network-first for API calls.

const CACHE = "dutta-v1";
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

// ── Fetch strategy ────────────────────────────────────────
self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  // 1. API requests → network only (never cache dynamic data)
  if (url.pathname.startsWith("/api/")) return;

  // 2. Non-GET requests → network only
  if (event.request.method !== "GET") return;

  // 3. Static assets → cache-first, fallback to network then cache update
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const fresh = fetch(event.request).then((response) => {
        if (response.ok) {
          const copy = response.clone();
          caches.open(CACHE).then((c) => c.put(event.request, copy));
        }
        return response;
      });
      return cached || fresh;
    })
  );
});
