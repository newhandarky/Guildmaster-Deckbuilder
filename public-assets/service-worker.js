/* global self, caches, fetch, URL, Response */
const cachePrefix = 'guildmaster-app-shell-';
const cacheName = `${cachePrefix}v3`;
const scopeUrl = new URL(self.registration.scope);
const indexUrl = new URL('index.html', scopeUrl).href;
const shell = [scopeUrl.href, indexUrl, new URL('manifest.webmanifest', scopeUrl).href];
self.addEventListener('install', (event) => event.waitUntil(caches.open(cacheName).then((cache) => cache.addAll(shell)).then(() => self.skipWaiting())));
self.addEventListener('activate', (event) => event.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((key) => key.startsWith(cachePrefix) && key !== cacheName).map((key) => caches.delete(key)))).then(() => self.clients.claim())));
self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  event.respondWith((async () => {
    const requestUrl = new URL(event.request.url);
    const sameScope = requestUrl.origin === scopeUrl.origin && requestUrl.pathname.startsWith(scopeUrl.pathname);
    if (event.request.mode === 'navigate' && sameScope) {
      try {
        const response = await fetch(event.request);
        if (response.ok) await (await caches.open(cacheName)).put(indexUrl, response.clone());
        return response;
      } catch {
        return (await caches.match(indexUrl)) ?? Response.error();
      }
    }
    if (!sameScope) return fetch(event.request);
    const cached = await caches.match(event.request);
    if (cached) return cached;
    try {
      const response = await fetch(event.request);
      if (response.ok) {
        const cache = await caches.open(cacheName);
        await cache.put(event.request, response.clone());
      }
      return response;
    } catch {
      return Response.error();
    }
  })());
});
