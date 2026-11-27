// End-to-end browser test of the static site (as on GitHub Pages, under /pathway/).
// Serve it:  mkdir -p /tmp/site && ln -sfn "$PWD/public" /tmp/site/pathway && python3 -m http.server 8765 -d /tmp/site
// Then:      node tests/e2e.js      (or PATHWAY_URL=https://meeyaow2.github.io/pathway/ node tests/e2e.js)
// Calls the live free providers (Photon, Valhalla) directly from the browser. Optional: AXE_PATH=/path/to/axe.min.js
const {chromium, devices} = require('playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.env.PATHWAY_URL || 'http://127.0.0.1:8765/pathway/';
const OUT = process.env.SHOT_DIR || path.join(__dirname, 'screenshots');
const AXE = process.env.AXE_PATH;
const results = []; const ok = (name, pass, info = '') => { results.push({name, pass, info}); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
const PLACES = [
  ['Orchard MRT Station', 'Orchard Road', '238872', 1.30425, 103.83206], ['Orchard', '', '', 1.3048, 103.8318],
  ['Somerset MRT Station', 'Orchard Road', '238885', 1.30062, 103.83864], ['Paragon', 'Orchard Road', '238859', 1.3035, 103.8355], ['Paragon Medical Suites', 'Orchard Road', '238859', 1.3037, 103.8357],
];
async function photonFixture(route) {
  const u = new URL(route.request().url()), q = (u.searchParams.get('q') || '').toLowerCase();
  const words = q.split(/\s+/).filter(w => w.length > 2), score = n => words.filter(w => n.toLowerCase().includes(w)).length;
  const pick = u.pathname.includes('reverse') ? [PLACES[0]] : PLACES.filter(([n]) => score(n) > 0).sort((a, b) => score(b[0]) - score(a[0]));
  const features = pick.map(([name, street, postcode, lat, lon]) => ({type: 'Feature', geometry: {type: 'Point', coordinates: [lon, lat]},
    properties: {name, street, postcode, district: 'Orchard', city: 'Singapore', countrycode: 'SG', osm_key: 'railway'}}));
  await route.fulfill({status: 200, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: JSON.stringify({type: 'FeatureCollection', features})});
}
// Pairs of regions that must never overlap on screen.
function overlaps() {
  const box = sel => { const e = document.querySelector(sel); if (!e) return null; const st = getComputedStyle(e); if (st.display === 'none' || st.visibility === 'hidden') return null; const r = e.getBoundingClientRect(); return r.width && r.height ? r : null; };
  const hit = (a, b) => a && b && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1;
  const pairs = [['.map-fabs', '#search-card'], ['.map-fabs', '#sheet'], ['.map-fabs', '.maplibregl-ctrl-attrib'], ['.map-fabs', '.tabbar'], ['#search-card', '#sheet'], ['.quick-picks', '.map-fabs']];
  return pairs.filter(([a, b]) => hit(box(a), box(b))).map(p => p.join(' × '));
}
const ORCHARD = {latitude: 1.3045, longitude: 103.8320, accuracy: 12};

async function pick(page, which, query, how = 'keyboard') {
  const input = page.locator('#' + which + '-search');
  await input.click(); await input.fill(query);
  await page.waitForSelector('#' + which + '-suggestions [role=option]', {timeout: 20000});
  if (how === 'keyboard') { await input.press('ArrowDown'); await input.press('Enter'); }
  else await page.locator('#' + which + '-suggestions [role=option]').first().tap();
}

(async () => {
  fs.mkdirSync(OUT, {recursive: true});
  const browser = await chromium.launch();
  // Search uses recorded Photon-format responses by default (deterministic, and polite to a free volunteer-run
  // service). LIVE_SEARCH=1 calls the real Photon API instead. Routing (Valhalla) is always live.
  if (!process.env.LIVE_SEARCH) {
    const newContext = browser.newContext.bind(browser);
    browser.newContext = async opts => { const c = await newContext(opts); await c.route(/photon\.komoot\.io/, photonFixture); return c; };
  }
  // ---------------- core journey on an iPhone-sized touch device
  const ctx = await browser.newContext({...devices['iPhone 13'], permissions: ['geolocation'], geolocation: ORCHARD});
  const page = await ctx.newPage(); const errors = [], apiCalls = [];
  page.on('request', r => { if (/\/api\//.test(new URL(r.url()).pathname) && new URL(r.url()).origin === new URL(URL_).origin) apiCalls.push(r.url()); });
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL_, {waitUntil: 'networkidle'});
  ok('search usable before the map finishes', await page.locator('#start-search').isEditable());
  await page.waitForSelector('#map canvas', {timeout: 30000});
  ok('map canvas rendered (lazy-loaded)', await page.locator('#map canvas').count() > 0);
  await pick(page, 'start', 'Orchard MRT', 'keyboard');
  ok('start chosen with keyboard (ArrowDown + Enter)', (await page.locator('#start-search').inputValue()).length > 2, await page.locator('#start-search').inputValue());
  await pick(page, 'end', 'Somerset MRT', 'touch');
  await page.waitForSelector('.route-card', {timeout: 40000});
  const cards = await page.locator('.route-card').allInnerTexts();
  ok('route options shown with duration', cards.length >= 1 && cards.every(c => /min|hr/.test(c)), cards.map(c => c.replace(/\s+/g, ' ')).join(' | '));
  const st = await page.evaluate(() => { const s = window.__pathway.state, m = window.__pathway.getMap(); const src = m && m.getSource('routes'); return {routes: s.routes.map(r => ({p: r.profile, d: r.distance_m, t: r.duration_s, pts: r.geometry.length, steps: r.steps.length, stairs: r.counts.stairs})), drawn: !!(src && src._data && src._data.features && src._data.features.length)}; });
  ok('route geometry decoded and drawn on map', st.drawn && st.routes.every(r => r.pts > 10), JSON.stringify(st.routes));
  for (const style of ['liberty', 'onemap']) {
    await page.evaluate(st => document.getElementById('provider-' + st).click(), style);
    await page.waitForFunction(() => { const m = window.__pathway.getMap(); return m.isStyleLoaded() && m.getSource('routes'); }, null, {timeout: 30000}).catch(() => {});
  }
  ok('switching map style keeps one map instance and redraws the route', await page.evaluate(() => { const m = window.__pathway.getMap(), src = m.getSource('routes'); return window.__pathway.mapInits() === 1 && !!src && src._data.features.length > 0; }));
  ok('walking instructions listed', await page.locator('#steps li').count() > 2, (await page.locator('#steps li').first().innerText()).replace(/\s+/g, ' '));
  ok('wheelchair profile avoids mapped stairs', (st.routes.find(r => r.p === 'wheelchair') || {}).stairs === 0);
  await page.screenshot({path: path.join(OUT, 'mobile-390-route.png')});

  // GPS follow + progress + reroute
  await page.locator('#follow-gps').tap();
  await page.waitForFunction(() => !['NOT STARTED', 'WAITING FOR GPS'].includes(document.getElementById('journey-badge').textContent), null, {timeout: 15000});
  ok('GPS progress shown', true, await page.locator('#journey-badge').innerText() + ' / ' + await page.locator('#journey-distance').innerText());
  await ctx.setGeolocation({latitude: 1.3150, longitude: 103.8450, accuracy: 12});
  await page.waitForFunction(() => document.getElementById('journey-badge').textContent === 'POSSIBLY OFF ROUTE', null, {timeout: 15000}).catch(() => {});
  ok('off-route warning', await page.locator('#journey-badge').innerText() === 'POSSIBLY OFF ROUTE');
  await page.locator('#journey-recalculate').click();
  await page.waitForFunction(() => /Rerouted|failed/.test(document.getElementById('toast').textContent), null, {timeout: 40000});
  ok('reroute from current GPS position', /Rerouted/.test(await page.locator('#toast').innerText()), await page.locator('#toast').innerText());
  await page.locator('#follow-gps').tap();

  // Preferences
  await page.locator('#sheet-handle').click(); await page.locator('#sheet-handle').click();
  await page.locator('[data-access=wheelchair]').click();
  ok('multi-select needs: wheelchair preset sets step-free prefs', await page.locator('[data-pref=stepfree]').getAttribute('aria-pressed') === 'true' && await page.locator('[data-pref=lifts]').getAttribute('aria-pressed') === 'true');
  await page.locator('[data-access=lowvision]').click();
  ok('low-vision preset enlarges text', await page.evaluate(() => getComputedStyle(document.documentElement).fontSize) === '19px');
  ok('data-dependent prefs grouped and labelled as not applied', /Not available yet/.test(await page.locator('details[data-group=data] summary').innerText()) && /Not applied yet/.test(await page.locator('details[data-group=data] summary').innerText()) && await page.locator('[data-pref=shelter]').count() === 1);
  ok('route-changing prefs visible; display/data groups collapsed by default', await page.locator('[data-pref=stepfree]').isVisible() && !(await page.locator('details[data-group=display]').evaluate(d => d.open)));
  await page.locator('[data-access=lowvision]').click(); await page.locator('details[data-group=display] summary').click(); await page.locator('[data-pref=large]').click(); await page.locator('[data-pref=contrast]').click();

  // Save + saved page + plan again
  await page.locator('#save').click();
  await page.locator('.tabbar [data-page=saved]').tap();
  ok('saved journey listed', await page.locator('#saved-list .item').count() >= 1);
  await page.locator('[data-open]').first().click();
  await page.waitForSelector('.route-card', {timeout: 40000});
  ok('plan again from saved journey', await page.locator('.route-card').count() >= 1);

  // Report submission with map position, then on map
  await page.locator('#report').tap();
  ok('report dialog opens with focus in first field', await page.evaluate(() => document.activeElement.id) === 'where');
  await page.locator('#submit-report').click();
  ok('blur-first validation shows errors', await page.locator('#where').getAttribute('aria-invalid') === 'true');
  await page.fill('#where', 'Lift at Exit B, Orchard MRT'); await page.selectOption('#report-pin', 'end');
  await page.fill('#description', 'Lift out of service, sign says repair this week');
  await page.locator('#submit-report').click();
  await page.waitForSelector('#report-list .item', {timeout: 15000});
  ok('demo report saved and labelled local', /Local demo/.test(await page.locator('#report-list').innerText()) && /only in this browser/.test(await page.locator('#storage-note').innerText()));
  const mapped = await page.evaluate(() => window.__pathway.getMap().getSource('reports')._data.features.length);
  ok('report shown on map', mapped >= 1, mapped + ' feature(s)');
  await page.reload({waitUntil: 'networkidle'}); await page.locator('.tabbar [data-page=reports]').tap();
  await page.waitForSelector('#report-list .item', {timeout: 10000});
  ok('demo report persists on this device after reload', await page.locator('#report-list .item').count() === 1);
  await page.locator('[data-delete]').first().click();
  ok('demo report can be deleted', await page.locator('#report-list .item').count() === 0);
  ok('no calls to a backend /api', apiCalls.length === 0, apiCalls.join(' '));
  ok('no JavaScript errors in journey', errors.filter(e => !/tiles|Failed to load resource/.test(e)).length === 0, errors.join(' | '));
  await ctx.close();

  // ---------------- audio mode: plan and follow a journey without the map
  {
    const actx = await browser.newContext({...devices['iPhone 13'], permissions: ['geolocation'], geolocation: ORCHARD});
    await actx.addInitScript(() => {
      window.__spoken = [];
      const fake = {speaking: false, pending: false, paused: false, cancel() { this.speaking = false; }, getVoices: () => [],
        speak(u) { window.__spoken.push(u.text); this.speaking = true; setTimeout(() => { this.speaking = false; u.onend && u.onend(); }, 30); }};
      Object.defineProperty(window, 'speechSynthesis', {value: fake, configurable: true});
    });
    const a = await actx.newPage(); const aerr = []; a.on('pageerror', e => aerr.push(e.message));
    const tileReqs = []; a.on('request', r => { if (/onemap\.gov\.sg\/maps|openfreemap|maplibre-gl\.js/.test(r.url())) tileReqs.push(r.url()); });
    await a.goto(URL_ + '?mode=audio', {waitUntil: 'networkidle'});
    ok('audio mode: map not downloaded', !(await a.evaluate(() => !!window.maplibregl)) && tileReqs.filter(u => !/maplibre-gl\.js/.test(u)).length === 0, tileReqs.length + ' map requests');
    ok('audio mode: guidance controls visible without map', await a.locator('#guide-start').isVisible() && !(await a.locator('#map').isVisible()));
    await pick(a, 'start', 'Orchard MRT', 'keyboard'); await pick(a, 'end', 'Somerset MRT', 'keyboard');
    await a.waitForSelector('.route-card', {timeout: 40000});
    const label = await a.locator('.route-card').first().getAttribute('aria-label');
    ok('route card has a concise spoken label', /minutes/.test(label) && /Not verified/.test(label), label);
    await a.waitForFunction(() => window.__spoken.some(t => /routes? found/.test(t)), null, {timeout: 5000}).catch(() => {});
    ok('route comparison spoken', (await a.evaluate(() => window.__spoken.join(' | '))).includes('Option 1'));
    await a.locator('#guide-start').click();
    await a.waitForFunction(() => window.__spoken.some(t => t.startsWith('Guidance started')), null, {timeout: 5000});
    ok('guidance start summary includes limits', /can’t detect crossings, obstacles or entrances/.test(await a.evaluate(() => window.__spoken.find(t => t.startsWith('Guidance started')))));
    const pts = await a.evaluate(() => { const r = window.__pathway.state.routes[window.__pathway.state.selected]; const s = r.steps.find((x, i) => i > 1 && x.shape_index > 2); return {p: r.geometry[Math.max(0, s.shape_index - 1)], all: r.geometry}; });
    await actx.setGeolocation({latitude: pts.p[0], longitude: pts.p[1], accuracy: 8});
    await a.waitForFunction(() => window.__spoken.some(t => /^In about/.test(t)), null, {timeout: 15000}).catch(() => {});
    ok('upcoming instruction spoken near the maneuver', await a.evaluate(() => window.__spoken.some(t => /^In about/.test(t))), (await a.evaluate(() => window.__spoken.slice(-2).join(' | '))));
    await a.locator('#guide-pause').click();
    const before = await a.evaluate(() => window.__spoken.length);
    await actx.setGeolocation({latitude: 1.3150, longitude: 103.8450, accuracy: 8});
    await a.waitForFunction(() => document.getElementById('journey-badge').textContent === 'POSSIBLY OFF ROUTE', null, {timeout: 15000}).catch(() => {});
    ok('paused voice stays silent but screen shows off-route', (await a.evaluate(() => window.__spoken.length)) === before && await a.locator('#journey-badge').innerText() === 'POSSIBLY OFF ROUTE',
      await a.locator('#journey-badge').innerText() + ' / ' + await a.locator('#gps-status').innerText() + ' / ' + await a.evaluate(n => window.__spoken.slice(n).join(' | '), before));
    await a.locator('#journey-announce').click();
    ok('repeat speaks the latest instruction even when paused', (await a.evaluate(() => window.__spoken.length)) === before + 1);
    await a.locator('#guide-pause').click();
    await a.locator('#where-am-i').click();
    await a.waitForFunction(() => window.__spoken.some(t => /Approximately near|no nearby place/.test(t)), null, {timeout: 15000}).catch(() => {});
    ok('"Where am I?" speaks an approximate place', await a.evaluate(() => window.__spoken.some(t => /Approximately near|no nearby place/.test(t))), await a.evaluate(() => window.__spoken.slice(-1)[0]));
    await a.locator('#voice-settings summary').click(); await a.locator('#set-target-sr').check();
    const spokenBefore = await a.evaluate(() => window.__spoken.length);
    await actx.setGeolocation({latitude: pts.all[3][0], longitude: pts.all[3][1], accuracy: 8});
    await a.waitForFunction(() => /near the route|Back/.test(document.getElementById('guide-live').textContent + document.getElementById('sr-alert').textContent), null, {timeout: 15000}).catch(() => {});
    ok('screen-reader channel: live region instead of a second voice', (await a.evaluate(() => window.__spoken.length)) === spokenBefore && (await a.evaluate(() => document.getElementById('guide-live').textContent + document.getElementById('sr-alert').textContent)).length > 0, await a.evaluate(() => document.getElementById('guide-live').textContent));
    await a.locator('#guide-stop').click();
    ok('stop ends guidance', await a.locator('#guide-start').isEnabled() && await a.locator('#follow-gps').getAttribute('aria-pressed') === 'false');
    const all = await a.evaluate(() => window.__spoken.join(' '));
    ok('no confident safety commands spoken', !/cross now|path (ahead )?is clear|it is safe to/i.test(all));
    ok('audio mode: no JavaScript errors', aerr.length === 0, aerr.join(' | '));
    await a.locator('#show-map').click(); await a.waitForSelector('#map canvas', {timeout: 30000});
    ok('audio mode: map available on request', await a.locator('#map canvas').isVisible());
    await actx.close();
  }

  // ---------------- keyboard + focus management (desktop)
  const kctx = await browser.newContext({viewport: {width: 1440, height: 900}});
  const k = await kctx.newPage(); await k.goto(URL_, {waitUntil: 'networkidle'});
  await k.keyboard.press('Tab'); ok('skip link is first tab stop', await k.evaluate(() => document.activeElement.className) === 'skip-link');
  await k.focus('#report'); await k.keyboard.press('Enter');
  const seen = new Set(); for (let i = 0; i < 12; i++) { await k.keyboard.press('Tab'); seen.add(await k.evaluate(() => !!document.activeElement.closest('#modal'))); }
  ok('focus trapped in dialog', !seen.has(false));
  await k.keyboard.press('Escape'); ok('focus returns to opener on close', await k.evaluate(() => document.activeElement.id) === 'report');
  await k.fill('#start-search', 'Paragon'); await k.waitForSelector('#start-suggestions [role=option]', {timeout: 20000});
  await k.keyboard.press('ArrowDown'); await k.keyboard.press('ArrowDown');
  ok('aria-activedescendant tracks arrow keys', (await k.getAttribute('#start-search', 'aria-activedescendant')) === 'start-opt-1');
  await k.keyboard.press('Escape'); ok('Escape closes suggestions', await k.getAttribute('#start-search', 'aria-expanded') === 'false');
  // API failure handling
  await k.route('**/valhalla1.openstreetmap.de/**', r => r.fulfill({status: 503, contentType: 'application/json', headers: {'access-control-allow-origin': '*'}, body: '{}'}));
  await k.evaluate(() => { const s = window.__pathway.state; s.start = {name: 'A', lat: 1.3046, lng: 103.8318}; s.end = {name: 'B', lat: 1.3004, lng: 103.839}; });
  await k.evaluate(() => document.getElementById('plan').click()); await k.waitForSelector('.route-card', {timeout: 10000});
  ok('routing failure falls back to labelled illustration', /Straight-line illustration/.test(await k.locator('#routes').innerText()) && /routing service/i.test(await k.locator('#toast').innerText()));
  await kctx.setOffline(true); await k.evaluate(() => dispatchEvent(new Event('offline')));
  ok('offline banner', await k.locator('#offline-banner').isVisible());
  await kctx.close();

  // Experimental on-device text reading (a photo of a sign; no camera stream, nothing uploaded)
  {
    const vctx = await browser.newContext({viewport: {width: 390, height: 844}, isMobile: true, hasTouch: true});
    const v = await vctx.newPage(); const uploads = [];
    const allowed = [new URL(URL_).host, 'www.onemap.gov.sg', 'tiles.openfreemap.org', 'photon.komoot.io', 'valhalla1.openstreetmap.de'];
    v.on('request', r => { const u = new URL(r.url()); if (r.method() !== 'GET' || (u.protocol.startsWith('http') && !allowed.includes(u.host))) uploads.push(r.method() + ' ' + r.url()); });
    await v.goto(URL_, {waitUntil: 'networkidle'});
    ok('camera reader not loaded until asked', !(await v.evaluate(() => !!window.PathwayVision || !!window.Tesseract)));
    await v.locator('#sheet-handle').click(); await v.locator('#sheet-handle').click();
    await v.locator('#vision-details summary').click();
    await v.setInputFiles('#vision-input', path.join(__dirname, 'fixtures', 'sign-exit-b.jpg'));
    await v.waitForFunction(() => !document.getElementById('vision-result').hidden || /isn’t available/.test(document.getElementById('vision-status').textContent), null, {timeout: 120000});
    const res = await v.locator('#vision-result').innerText().catch(() => '');
    ok('on-device text reading of a sign photo', /EXIT B/i.test(res) && /Orchard Road/i.test(res) && /may be incomplete or wrong/.test(res), res || await v.locator('#vision-status').innerText());
    ok('no photo upload or non-GET requests', uploads.length === 0, uploads.join(' '));
    await vctx.close();
  }

  // GPS permission denied
  const dctx = await browser.newContext({viewport: {width: 390, height: 844}, permissions: []});
  const d = await dctx.newPage(); await d.goto(URL_, {waitUntil: 'networkidle'});
  await d.click('#locate'); await d.waitForFunction(() => /permission|available|long/i.test(document.getElementById('gps-status').textContent), null, {timeout: 20000}).catch(() => {});
  ok('GPS denial explained', /permission|available|long/i.test(await d.locator('#gps-status').innerText()), await d.locator('#gps-status').innerText());
  await dctx.close();

  // ---------------- zoom / reflow: 320 CSS px (= 1280 px at 400% zoom) with Larger text on
  {
    const c = await browser.newContext({viewport: {width: 320, height: 640}, hasTouch: true, isMobile: true});
    await c.addInitScript(() => localStorage.setItem('pathway-v3', JSON.stringify({prefs: {stepfree: true, lifts: true, large: true}})));
    const p = await c.newPage(); await p.goto(URL_, {waitUntil: 'networkidle'});
    await p.click('[data-sample=orchard]'); await p.waitForSelector('.route-card', {timeout: 40000}).catch(() => {}); await p.waitForTimeout(800);
    const r = await p.evaluate(() => ({overflow: document.documentElement.scrollWidth > innerWidth + 1, font: getComputedStyle(document.documentElement).fontSize}));
    ok('320px + larger text: no horizontal overflow', !r.overflow && r.font === '19px', JSON.stringify(r));
    const ov = await p.evaluate(overlaps);
    ok('320px + larger text: no overlapping controls', ov.length === 0, ov.join(', '));
    await p.screenshot({path: path.join(OUT, 'reflow-320-large-text.png')});
    await c.close();
  }

  // ---------------- responsive + automated accessibility
  const axeSrc = AXE && fs.existsSync(AXE) ? fs.readFileSync(AXE, 'utf8') : null;
  for (const [w, h, name] of [[375, 812, 'mobile-375'], [390, 844, 'mobile-390'], [768, 1024, 'tablet-768'], [1024, 768, 'tablet-1024'], [1440, 900, 'desktop-1440']]) {
    const c = await browser.newContext({viewport: {width: w, height: h}, hasTouch: w < 1100, isMobile: w < 600, deviceScaleFactor: 1, bypassCSP: !!AXE});
    const p = await c.newPage(); await p.goto(URL_, {waitUntil: 'networkidle'});
    if (w < 600) ok(name + ': collapsed sheet shows no empty action before places are chosen', await p.locator('#plan').isHidden());
    if (w === 390) ok('service worker registered under /pathway/', /\/pathway\/$/.test(await p.evaluate(() => Promise.race([navigator.serviceWorker.ready.then(r => r.scope), new Promise(r => setTimeout(() => r('none'), 8000))]))));
    await p.click('[data-sample=orchard]'); await p.waitForSelector('.route-card', {timeout: 40000}).catch(() => {});
    await p.waitForTimeout(1200);
    const m = await p.evaluate(() => {
      const overflow = document.documentElement.scrollWidth > innerWidth + 1;
      const small = [...document.querySelectorAll('button,input,select,a[href]')].filter(e => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width && r.height && st.visibility !== 'hidden' && !e.closest('.maplibregl-ctrl,.hidden,.visually-hidden,.skip-link') && r.top < innerHeight && r.bottom > 0 && (r.height < 44 && r.width < 44 || r.height < 32); }).map(e => (e.id || e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
      return {overflow, small};
    });
    ok(name + ': no horizontal overflow', !m.overflow);
    const ov = await p.evaluate(overlaps);
    ok(name + ': map controls clear of search card, sheet and attribution', ov.length === 0, ov.join(', '));
    ok(name + ': touch targets ≥44px', m.small.length === 0, m.small.join(', '));
    await p.screenshot({path: path.join(OUT, name + '.png')});
    if (axeSrc) {
      await p.addScriptTag({content: axeSrc});
      const v = await p.evaluate(async () => (await axe.run(document, {runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'], exclude: [['.maplibregl-canvas-container']]})).violations.map(x => x.id + '(' + x.nodes.length + '): ' + x.nodes.slice(0, 2).map(n => n.target.join(' ')).join('; ')));
      ok(name + ': axe WCAG 2.2 AA', v.length === 0, v.join(' | '));
    }
    await c.close();
  }
  // Audio mode and the camera panel pass automated checks too
  if (axeSrc) for (const [w, h] of [[390, 844], [1024, 768]]) {
    const c = await browser.newContext({viewport: {width: w, height: h}, hasTouch: true, isMobile: w < 600, bypassCSP: true});
    const p = await c.newPage(); await p.goto(URL_ + '?mode=audio', {waitUntil: 'networkidle'});
    await p.locator('#vision-details summary').click(); await p.locator('#voice-settings summary').click();
    const m = await p.evaluate(() => [...document.querySelectorAll('button,input,select,summary')].filter(e => { const r = e.getBoundingClientRect(); return r.width && r.height && !e.closest('.visually-hidden,.skip-link') && getComputedStyle(e).visibility !== 'hidden' && (r.height < 24 || r.width < 24); }).map(e => e.id || e.tagName));
    ok('audio mode ' + w + 'px: targets ≥24px', m.length === 0, m.join(', '));
    await p.screenshot({path: path.join(OUT, 'audio-mode-' + w + '.png'), fullPage: false});
    await p.addScriptTag({content: axeSrc});
    const v = await p.evaluate(async () => (await axe.run(document, {runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa']})).violations.map(x => x.id + ': ' + x.nodes.slice(0, 2).map(n => n.target.join(' ')).join('; ')));
    ok('audio mode ' + w + 'px: axe WCAG 2.2 AA', v.length === 0, v.join(' | '));
    await c.close();
  }
  // High-contrast mode still works and passes automated checks
  if (axeSrc) {
    const c = await browser.newContext({viewport: {width: 390, height: 844}, hasTouch: true, isMobile: true, bypassCSP: true});
    const p = await c.newPage(); await p.goto(URL_, {waitUntil: 'networkidle'});
    await p.locator('#sheet-handle').click(); await p.locator('#sheet-handle').click();
    await p.locator('details[data-group=display] summary').click(); await p.locator('[data-pref=contrast]').click();
    ok('high-contrast mode applies', await p.evaluate(() => document.documentElement.classList.contains('pw-contrast')));
    await p.screenshot({path: path.join(OUT, 'mobile-390-high-contrast.png')});
    await p.addScriptTag({content: axeSrc});
    const v = await p.evaluate(async () => (await axe.run(document, {runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa', 'wcag22aa'], exclude: [['.maplibregl-canvas-container']]})).violations.map(x => x.id));
    ok('high contrast: axe WCAG 2.2 AA', v.length === 0, v.join(', '));
    await c.close();
  }
  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
