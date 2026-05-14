/*
 * iBrain service worker — offline support for a no-backend SPA.
 *
 * Hand-rolled (no build step): the app's JS/CSS are content-hashed, so a
 * plain cache-first strategy is safe — a new deploy produces new filenames
 * that simply miss the cache and get fetched fresh. Bump CACHE to force a
 * clean slate.
 */
const CACHE = "ibrain-v1";
const APP_SHELL = [
  "/",
  "/index.html",
  "/favicon.svg",
  "/icon-maskable.svg",
  "/manifest.webmanifest",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(APP_SHELL))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);

  // SPA navigations: network-first so new deploys are picked up, falling back
  // to the cached app shell so the app still boots with no connection.
  // (React Router resolves the actual route on the client.)
  if (req.mode === "navigate") {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put("/index.html", copy));
          return res;
        })
        .catch(() =>
          caches
            .match("/index.html")
            .then((r) => r || caches.match("/"))
        )
    );
    return;
  }

  // Cache-first for our own assets and the Google Fonts used by the UI.
  const cacheable =
    url.origin === self.location.origin ||
    url.origin === "https://fonts.googleapis.com" ||
    url.origin === "https://fonts.gstatic.com";
  if (!cacheable) return;

  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req)
        .then((res) => {
          // res.ok covers same-origin 200s; opaque covers cross-origin fonts.
          if (res && (res.ok || res.type === "opaque")) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => cached);
    })
  );
});
