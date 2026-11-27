/* Pathway service worker — faster repeat visits on GitHub Pages without ever pinning people to an old version.
 *
 * - Pages and app files (HTML, JS, CSS): NETWORK FIRST, so a new deploy is used immediately and HTML/JS never mismatch.
 *   The cached copy is used only when the network fails or takes longer than 4 s (offline / very slow).
 * - Versioned vendor folders (vendor/<name>-<version>/): cache first — their contents never change.
 * - Map tiles, map fonts and sprites (OneMap / OpenFreeMap): cache first, capped at MAX_TILES entries;
 *   style/tile JSON is revalidated in the background.
 * - NOT intercepted, NOT stored: search and routing (Photon, Valhalla), place lookups, POST requests, anything else.
 *   Camera photos never touch the network at all.
 * - Any failure inside the worker falls back to a normal network request, so the worker can't block the site.
 * The deploy workflow stamps the commit ID into BUILD; a new BUILD installs immediately and deletes old app caches.
 * To retire the worker completely, delete sw.js: browsers unregister a worker whose script returns 404.
 */
const BUILD = '__BUILD__';
const SHELL = 'pathway-shell-' + BUILD;
const VENDOR = 'pathway-vendor-v1';
const TILES = 'pathway-tiles-v1';
const MAX_TILES = 600;
const SHELL_FILES = ['./', 'styles.css', 'providers.js', 'audio.js', 'access.js', 'app.js', 'data/mrt-exits.json'];
const TILE_HOSTS = ['www.onemap.gov.sg', 'tiles.openfreemap.org'];

self.addEventListener('install', event => {
  // Precache is best-effort: a failed request here must not block installation.
  event.waitUntil(caches.open(SHELL).then(c => Promise.all(SHELL_FILES.map(f => c.add(f).catch(() => {})))).catch(() => {}).then(() => self.skipWaiting()));
});
self.addEventListener('activate', event => {
  event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pathway-shell-') && k !== SHELL).map(k => caches.delete(k))))
    .catch(() => {}).then(() => self.clients.claim()));
});

const timeout = (ms) => new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), ms));

async function networkFirst(request, key) {
  const cache = await caches.open(SHELL);
  try {
    const res = await Promise.race([fetch(request), timeout(4000)]);
    if (res.ok) cache.put(key || request, res.clone()).catch(() => {});
    return res;
  } catch (e) {
    const hit = (await cache.match(key || request, {ignoreSearch: true})) || (key && await cache.match('./'));
    if (hit) return hit;
    throw e;
  }
}
async function cacheFirst(request, cacheName, limit) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  if (hit) return hit;
  const res = await fetch(request);
  if (res.ok) {
    cache.put(request, res.clone()).then(async () => {
      if (!limit) return;
      const keys = await cache.keys();
      for (let i = 0; i < keys.length - limit; i++) await cache.delete(keys[i]); // oldest first
    }).catch(() => {});
  }
  return res;
}
async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(request);
  const fresh = fetch(request).then(res => { if (res.ok) cache.put(request, res.clone()).catch(() => {}); return res; });
  return hit ? (fresh.catch(() => {}), hit) : fresh;
}
// Never let a worker problem break the page: fall back to the plain network request.
const safely = (request, handler) => handler().catch(() => fetch(request));

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin === location.origin) {
    if (req.mode === 'navigate') return event.respondWith(safely(req, () => networkFirst(req, './')));
    if (/\/vendor\/[^/]+-\d[^/]*\//.test(url.pathname)) return event.respondWith(safely(req, () => cacheFirst(req, VENDOR)));
    if (url.pathname.endsWith('/sw.js')) return; // always straight from the network
    return event.respondWith(safely(req, () => networkFirst(req)));
  }
  if (TILE_HOSTS.includes(url.hostname)) {
    const immutable = /\.(pbf|png|jpe?g|webp)$/i.test(url.pathname);
    return event.respondWith(safely(req, () => immutable ? cacheFirst(req, TILES, MAX_TILES) : staleWhileRevalidate(req, TILES)));
  }
  // Everything else (Photon, Valhalla, …) is not intercepted: straight to the network, never stored.
});
