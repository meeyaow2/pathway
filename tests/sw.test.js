// Service-worker strategy tests: runs public/sw.js in a sandbox with fake caches and network. node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path'), vm = require('vm');
const SRC = fs.readFileSync(path.join(__dirname, '..', 'public', 'sw.js'), 'utf8');
const ORIGIN = 'https://meeyaow2.github.io', SCOPE = ORIGIN + '/pathway/';

function harness({online = true, brokenCaches = false} = {}) {
  const store = new Map(), listeners = {}, net = {calls: [], online, files: {}};
  const keyOf = r => typeof r === 'string' ? new URL(r, SCOPE).href : r.url;
  const strip = u => u.split('?')[0];
  class Res { constructor(body, ok = true) { this.body = body; this.ok = ok; } clone() { return new Res(this.body, this.ok); } }
  const cacheApi = name => {
    if (!store.has(name)) store.set(name, new Map());
    const m = store.get(name);
    return {
      match: async (r, o = {}) => { const k = keyOf(r); return m.get(k) || (o.ignoreSearch ? [...m].find(([kk]) => strip(kk) === strip(k))?.[1] : undefined); },
      put: async (r, res) => { m.set(keyOf(r), res); }, add: async r => { m.set(keyOf(r), await sandbox.fetch({url: keyOf(r)})); },
      keys: async () => [...m.keys()].map(url => ({url})), delete: async r => m.delete(keyOf(r)),
    };
  };
  const sandbox = {
    URL, setTimeout, clearTimeout, Promise, console,
    location: new URL(SCOPE + 'sw.js'),
    caches: {open: async n => { if (brokenCaches) throw new Error('storage blocked'); return cacheApi(n); }, keys: async () => [...store.keys()], delete: async n => store.delete(n)},
    fetch: async r => { net.calls.push(keyOf(r)); if (!net.online) throw new TypeError('offline'); return new Res(net.files[strip(keyOf(r))] || 'net:' + keyOf(r)); },
    self: {addEventListener: (t, fn) => { listeners[t] = fn; }, skipWaiting: () => {}, clients: {claim: () => {}}},
  };
  sandbox.addEventListener = sandbox.self.addEventListener;
  vm.runInNewContext(SRC, sandbox);
  const dispatch = async (url, {mode = 'cors', method = 'GET'} = {}) => {
    let p = null;
    listeners.fetch({request: {url: new URL(url, SCOPE).href, mode, method}, respondWith: x => { p = x; }});
    return p ? await p : 'not-intercepted';
  };
  return {store, net, dispatch, cache: cacheApi};
}

test('a new deploy is served immediately: app files are network-first, never a stale mix', async () => {
  const h = harness();
  await h.cache('pathway-shell-__BUILD__').put(SCOPE + 'app.js', {body: 'OLD app.js', ok: true, clone() { return this; }});
  h.net.files[SCOPE + 'app.js'] = 'NEW app.js';
  assert.strictEqual((await h.dispatch('app.js')).body, 'NEW app.js');
  h.net.files[SCOPE] = 'NEW index';
  assert.strictEqual((await h.dispatch(SCOPE, {mode: 'navigate'})).body, 'NEW index');
});

test('offline: the cached page and app files are used', async () => {
  const h = harness();
  h.net.files[SCOPE] = 'index v1'; await h.dispatch(SCOPE, {mode: 'navigate'}); await h.dispatch('app.js');
  h.net.online = false;
  assert.strictEqual((await h.dispatch(SCOPE + '?mode=audio', {mode: 'navigate'})).body, 'index v1');
  assert.match((await h.dispatch('app.js')).body, /app\.js/);
});

test('search, routing and place lookups are never intercepted or stored', async () => {
  const h = harness();
  for (const u of ['https://photon.komoot.io/api/?q=paragon', 'https://photon.komoot.io/reverse?lat=1.3&lon=103.8', 'https://valhalla1.openstreetmap.de/route?json=%7B%7D'])
    assert.strictEqual(await h.dispatch(u), 'not-intercepted');
  assert.strictEqual(await h.dispatch(SCOPE + 'anything', {method: 'POST'}), 'not-intercepted');
  const all = [...h.store.values()].flatMap(m => [...m.keys()]);
  assert.ok(!all.some(k => /photon|valhalla/.test(k)));
});

test('versioned vendor files and map tiles are cache-first; tile cache is capped', async () => {
  const h = harness();
  await h.dispatch('vendor/maplibre-gl-4.7.1/maplibre-gl.js'); await h.dispatch('vendor/maplibre-gl-4.7.1/maplibre-gl.js');
  assert.strictEqual(h.net.calls.filter(u => /maplibre-gl\.js/.test(u)).length, 1);
  for (let i = 0; i < 605; i++) await h.dispatch('https://www.onemap.gov.sg/maps/tiles/Default/16/' + i + '/1.png');
  await new Promise(r => setTimeout(r, 20));
  assert.ok(h.store.get('pathway-tiles-v1').size <= 600);
});

test('a storage failure falls back to the network instead of breaking the site', async () => {
  const h = harness({brokenCaches: true});
  assert.match((await h.dispatch(SCOPE, {mode: 'navigate'})).body, /net:/);
  assert.match((await h.dispatch('app.js')).body, /net:/);
});

test('the service worker script itself is never served from cache', async () => {
  const h = harness();
  assert.strictEqual(await h.dispatch('sw.js'), 'not-intercepted');
});
