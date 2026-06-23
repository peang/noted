const CACHE = 'noted-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.open(CACHE).then((c) =>
      c.match(e.request).then((cached) => {
        const fetched = fetch(e.request).then((res) => {
          if (res.ok) c.put(e.request, res.clone());
          return res;
        });
        return cached || fetched;
      }),
    ),
  );
});
