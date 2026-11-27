// Map/UI loading benchmark. Usage: PATHWAY_URL=https://meeyaow2.github.io/pathway/ node tests/perf.js [runs]
// Profiles: desktop (no throttling) and mobile (390px, DPR 3, 4x CPU slowdown, ~1.6 Mbps / 150 ms RTT "slow 4G").
const {chromium} = require('playwright');
const URL_ = process.env.PATHWAY_URL || 'http://127.0.0.1:8765/pathway/';
const RUNS = Number(process.argv[2] || 2);
const PROFILES = {
  desktop: {viewport: {width: 1440, height: 900}, deviceScaleFactor: 1, cpu: 1, net: null},
  mobile: {viewport: {width: 390, height: 844}, deviceScaleFactor: 3, isMobile: true, hasTouch: true, cpu: 4,
    net: {offline: false, latency: 150, downloadThroughput: 1.6e6 / 8, uploadThroughput: 0.75e6 / 8}},
};
const kind = u => /maplibre-gl\.js/.test(u) ? 'maplibre-js' : /\.pbf|\/tiles\/|\.mvt/.test(u) && !/fonts|glyph/.test(u) ? (/onemap/.test(u) ? 'raster-tiles' : 'vector-tiles') :
  /fonts|glyph/.test(u) ? 'glyphs' : /sprite/.test(u) ? 'sprites' : /styles\/|style\.json|planet|tilejson|\/planet$/.test(u) ? 'style+tilejson' :
  /\.png|\.webp|\.jpg/.test(u) ? 'raster/images' : /photon|valhalla/.test(u) ? 'api' : 'app';
async function run(name, p, warm) {
  const browser = await chromium.launch();
  // First visits block service workers so every request goes through the throttled network; repeat visits allow them.
  const ctx = await browser.newContext({viewport: p.viewport, deviceScaleFactor: p.deviceScaleFactor, isMobile: !!p.isMobile, hasTouch: !!p.hasTouch, serviceWorkers: warm ? 'allow' : 'block'});
  if (process.env.MAPSTYLE) await ctx.addInitScript(st => { try { localStorage.setItem('pathway-v3', JSON.stringify({prefs: {stepfree: true, lifts: true}, mapStyle: st, mapStyleChosen: true})); } catch {} }, process.env.MAPSTYLE);
  const page = await ctx.newPage(); const cdp = await ctx.newCDPSession(page);
  await cdp.send('Network.enable'); if (p.cpu > 1) await cdp.send('Emulation.setCPUThrottlingRate', {rate: p.cpu});
  if (p.net) await cdp.send('Network.emulateNetworkConditions', p.net);
  const reqs = new Map(), t0 = {};
  cdp.on('Network.requestWillBeSent', e => reqs.set(e.requestId, {url: e.request.url, start: e.timestamp, bytes: 0}));
  cdp.on('Network.loadingFinished', e => { const r = reqs.get(e.requestId); if (r) { r.bytes = e.encodedDataLength; r.end = e.timestamp; } });
  cdp.on('Network.requestServedFromCache', e => { const r = reqs.get(e.requestId); if (r) r.cache = true; });
  // Tiles are fetched from MapLibre's web workers, which the page-level CDP session doesn't see; Playwright does.
  const nav = {t: 0}; const timeline = [];
  page.on('requestfinished', async rq => { try { const sz = await rq.sizes(); const tm = rq.timing(); reqs.set(rq.url() + Math.random(), {url: rq.url(), bytes: sz.responseBodySize + sz.responseHeadersSize, at: Math.round(tm.startTime + tm.responseEnd - nav.t)}); } catch {} });
  if (warm) { await page.goto(URL_, {waitUntil: 'load'}); await page.waitForTimeout(8000); reqs.clear(); }
  cdp.removeAllListeners('Network.requestWillBeSent'); cdp.removeAllListeners('Network.loadingFinished');
  nav.t = Date.now();
  const start = Date.now();
  await page.goto(URL_, {waitUntil: 'commit'});
  const marks = await page.evaluate(() => new Promise(resolve => {
    const t = {}, s = performance.now(), mark = k => { if (!(k in t)) t[k] = Math.round(performance.now()); };
    const poll = () => {
      const inp = document.getElementById('start-search');
      if (inp && window.__pathway) mark('ui_interactive');
      const m = window.__pathway && window.__pathway.getMap && window.__pathway.getMap();
      if (m && m.isStyleLoaded && m.isStyleLoaded()) mark('style_loaded');
      if (m && m.loaded && m.loaded() && m.areTilesLoaded()) mark('map_complete');
      const fcp = performance.getEntriesByName('first-contentful-paint')[0]; if (fcp) t.fcp = Math.round(fcp.startTime);
      if (t.map_complete || performance.now() - s > 60000) { t.dcl = Math.round(performance.timing.domContentLoadedEventEnd - performance.timing.navigationStart); resolve(t); } else setTimeout(poll, 50);
    };
    poll();
  }));
  await page.waitForTimeout(1500);
  const by = {};
  for (const r of reqs.values()) { const k = kind(r.url); by[k] = by[k] || {n: 0, kb: 0, last_ms: 0}; by[k].n++; by[k].kb += r.bytes / 1024; by[k].last_ms = Math.max(by[k].last_ms, r.at || 0); }
  Object.values(by).forEach(v => { v.kb = Math.round(v.kb); });
  if (process.env.VERBOSE) for (const r of [...reqs.values()].sort((a, b) => a.at - b.at)) console.error(String(r.at).padStart(6), String(Math.round(r.bytes / 1024)).padStart(5) + 'KB', r.url.slice(0, 110));
  await browser.close();
  return {profile: name + (warm ? ' (repeat visit)' : ''), ...marks, requests: by, wall_ms: Date.now() - start};
}
(async () => {
  for (const [name, p] of Object.entries(PROFILES).filter(([n]) => !process.env.ONLY || n === process.env.ONLY)) for (const warm of [false, true]) {
    const results = []; for (let i = 0; i < (warm ? 1 : RUNS); i++) results.push(await run(name, p, warm));
    const med = k => { const v = results.map(r => r[k]).filter(x => x != null).sort((a, b) => a - b); return v.length ? v[Math.floor(v.length / 2)] : null; };
    console.log(JSON.stringify({profile: results[0].profile, runs: results.length, fcp: med('fcp'), ui_interactive: med('ui_interactive'), style_loaded: med('style_loaded'), map_complete: med('map_complete'), requests: results[0].requests}));
  }
})();
