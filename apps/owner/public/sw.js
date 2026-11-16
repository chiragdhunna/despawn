// Despawn service worker: caches the app shell so the app opens offline. It never touches
// /v1/ (sessions) or /s/ (the shop page), and it never stores documents or keys.
const CACHE = 'despawn-shell-v1';
const SHELL = ['/app/', '/app/manifest.webmanifest', '/app/favicon.svg'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((c) => c.addAll(SHELL))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);
  if (
    req.method !== 'GET' ||
    url.origin !== self.location.origin ||
    !url.pathname.startsWith('/app/')
  )
    return;
  if (req.mode === 'navigate') {
    event.respondWith(fetch(req).catch(() => caches.match('/app/')));
    return;
  }
  event.respondWith(
    caches.match(req).then(
      (hit) =>
        hit ||
        fetch(req).then((res) => {
          if (res.ok && url.pathname.startsWith('/app/assets/')) {
            const copy = res.clone();
            caches.open(CACHE).then((c) => c.put(req, copy));
          }
          return res;
        }),
    ),
  );
});
