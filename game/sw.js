// Service worker for offline play. The deploy workflow stamps VERSION with the commit and
// fills FILES with everything in the game folder, so each deploy caches a fresh copy of the
// game on the next launch and removes the old one. Unstamped (local) copies just cache as they go.
'use strict';
const VERSION = '__BUILD__';
const FILES = [/*__FILES__*/];
const CACHE = 'hoard-hopper-' + VERSION;

self.addEventListener('install', event => {
  event.waitUntil(caches.open(CACHE)
    .then(cache => cache.addAll(['./', ...FILES].map(url => new Request(url, { cache: 'reload' }))))
    .then(() => self.skipWaiting()));
});

// The game loads everything at startup, so switching a running page to the new cache is safe.
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k.startsWith('hoard-hopper-') && k !== CACHE).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  const key = req.mode === 'navigate' ? './' : req;
  event.respondWith(caches.open(CACHE).then(cache =>
    cache.match(key, { ignoreSearch: true }).then(hit => hit || fetch(req).then(res => {
      if (res.ok) cache.put(key, res.clone());
      return res;
    }))));
});
