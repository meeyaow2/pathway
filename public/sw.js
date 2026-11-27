/* Pathway service worker: faster repeat visits on GitHub Pages (whose HTTP cache lifetime is only 10 minutes).
 * - App shell + map library: served from cache, refreshed in the background (stale-while-revalidate).
 *   The cache name includes the build ID, which the deploy workflow stamps in, so each release replaces it.
 * - Page navigations: network first (fresh deploys win), cached copy if offline or slow.
 * - Map tiles, styles, fonts, sprites (OneMap / OpenFreeMap): cache first, capped at MAX_TILES entries.
 * - Search, routing and reverse-geocoding requests (Photon, Valhalla) are NEVER intercepted or stored.
 */
const BUILD = '__BUILD__';
const SHELL = 'pathway-shell-' + BUILD;
const TILES = 'pathway-tiles-v1';
const MAX_TILES = 600;
const SHELL_FILES = ['./', 'index.html', 'styles.css', 'providers.js', 'app.js', 'audio.js',
  'vendor/maplibre-gl-4.7.1/maplibre-gl.js', 'vendor/maplibre-gl-4.7.1/maplibre-gl.css'];
const TILE_HOSTS = ['www.onemap.gov.sg', 'tiles.openfreemap.org'];

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pathway-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

async function trimTiles() {
  const cache = await caches.open(TILES); const keys = await cache.keys();
  for (let i = 0; i < keys.length - MAX_TILES; i++) await cache.delete(keys[i]); // oldest first
}
async function tileFirst(request) {
  const cache = await caches.open(TILES);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) { cache.put(request, res.clone()); trimTiles(); }
  return res;
}
async function staleWhileRevalidate(request, cacheName = SHELL) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request, {ignoreSearch: true});
  const fresh = fetch(request).then(res => { if (res.ok) cache.put(request, res.clone()); return res; }).catch(() => hit);
  return hit || fresh;
}
async function networkFirst(request) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(request), new Promise((_, rej) => setTimeout(() => rej(Error('slow')), 4000))]);
    if (res.ok) cache.put('./', res.clone());
    return res;
  } catch { return (await cache.match('./')) || (await cache.match('index.html')) || Response.error(); }
}

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (req.mode === 'navigate' && url.origin === location.origin) return event.respondWith(networkFirst(req));
  if (url.origin === location.origin) return event.respondWith(staleWhileRevalidate(req));
  if (TILE_HOSTS.includes(url.hostname)) {
    // Tiles, fonts and sprites are immutable enough for cache-first; style/tile JSON can change, so revalidate it.
    const immutable = /\.(pbf|png|jpe?g|webp)$/i.test(url.pathname);
    return event.respondWith(immutable ? tileFirst(req) : staleWhileRevalidate(req, TILES));
  }
  // Everything else (Photon, Valhalla, …) goes straight to the network, uncached.
});
