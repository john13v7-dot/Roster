// Minimal service worker: caches the app shell (HTML/CSS/JS/icons) so the
// app opens instantly and still opens (to a "you're offline" state) with
// no signal. It deliberately does NOT cache Firestore/Storage calls - the
// roster itself always needs a live connection, since it's meant to be
// self-service and current, not a frozen snapshot.
const CACHE = "roster-shell-v1";
const SHELL = ["/", "/index.html", "/manifest.json", "/firebase-config.js"];

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  // Only ever serve our own shell files from cache; everything else
  // (Firebase APIs, the gstatic SDK, Google auth) goes straight to the
  // network, cache-as-fallback only so a flaky connection doesn't just
  // break the app outright.
  if (url.origin !== self.location.origin) return;
  event.respondWith(
    caches.match(event.request).then((cached) => {
      const network = fetch(event.request)
        .then((res) => {
          if (res.ok) caches.open(CACHE).then((c) => c.put(event.request, res.clone()));
          return res;
        })
        .catch(() => cached);
      return cached || network;
    })
  );
});
