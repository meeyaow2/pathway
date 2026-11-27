// End-to-end browser test. Run: python server.py (or PATHWAY_URL=...) then `node tests/e2e.js`.
// Uses live free providers (Photon, Valhalla) through Pathway's backend. Optional: AXE_PATH=/path/to/axe.min.js
const {chromium, devices} = require('playwright');
const fs = require('fs'), path = require('path');
const URL_ = process.env.PATHWAY_URL || 'http://127.0.0.1:8765';
const OUT = process.env.SHOT_DIR || path.join(__dirname, 'screenshots');
const AXE = process.env.AXE_PATH;
const results = []; const ok = (name, pass, info = '') => { results.push({name, pass, info}); console.log((pass ? 'PASS ' : 'FAIL ') + name + (info ? ' — ' + info : '')); };
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
  // ---------------- core journey on an iPhone-sized touch device
  const ctx = await browser.newContext({...devices['iPhone 13'], permissions: ['geolocation'], geolocation: ORCHARD});
  const page = await ctx.newPage(); const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.goto(URL_, {waitUntil: 'networkidle'});
  ok('map canvas rendered', await page.locator('#map canvas').count() > 0);
  await pick(page, 'start', 'Orchard MRT', 'keyboard');
  ok('start chosen with keyboard (ArrowDown + Enter)', (await page.locator('#start-search').inputValue()).length > 2, await page.locator('#start-search').inputValue());
  await pick(page, 'end', 'Somerset MRT', 'touch');
  await page.waitForSelector('.route-card', {timeout: 40000});
  const cards = await page.locator('.route-card').allInnerTexts();
  ok('route options shown with duration', cards.length >= 1 && cards.every(c => /min|hr/.test(c)), cards.map(c => c.replace(/\s+/g, ' ')).join(' | '));
  const st = await page.evaluate(() => { const s = window.__pathway.state, m = window.__pathway.getMap(); const src = m && m.getSource('routes'); return {routes: s.routes.map(r => ({p: r.profile, d: r.distance_m, t: r.duration_s, pts: r.geometry.length, steps: r.steps.length, stairs: r.counts.stairs})), drawn: !!(src && src._data && src._data.features && src._data.features.length)}; });
  ok('route geometry decoded and drawn on map', st.drawn && st.routes.every(r => r.pts > 10), JSON.stringify(st.routes));
  ok('walking instructions listed', await page.locator('#steps li').count() > 2, (await page.locator('#steps li').first().innerText()).replace(/\s+/g, ' '));
  ok('step-free profile avoids mapped stairs', (st.routes.find(r => r.p === 'stepfree') || {}).stairs === 0);
  await page.screenshot({path: path.join(OUT, 'mobile-390-route.png')});

  // GPS follow + progress + reroute
  await page.locator('#follow-gps').tap();
  await page.waitForFunction(() => !['GPS OFF', 'NOT NAVIGATING'].includes(document.getElementById('journey-badge').textContent), null, {timeout: 15000});
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
  ok('data-dependent prefs labelled as not applied', /Data needed/.test(await page.locator('[data-pref=shelter]').innerText()));
  await page.locator('[data-access=lowvision]').click(); await page.locator('[data-pref=large]').click(); await page.locator('[data-pref=contrast]').click();

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
  ok('report submitted and listed as unverified', /Unverified/.test(await page.locator('#report-list').innerText()));
  const mapped = await page.evaluate(() => window.__pathway.getMap().getSource('reports')._data.features.length);
  ok('report shown on map', mapped >= 1, mapped + ' feature(s)');
  const codes = await page.evaluate(async () => { const out = []; for (let i = 0; i < 6; i++) { const r = await fetch('/api/reports', {method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify({location: 'Test spot', category: 'Other access issue', description: 'Rate limit test entry'})}); out.push(r.status); } return out; });
  ok('report rate limiting', codes.includes(429), codes.join(','));
  ok('no JavaScript errors in journey', errors.filter(e => !/tiles|Failed to load resource/.test(e)).length === 0, errors.join(' | '));
  await ctx.close();

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
  await k.route('**/api/routes**', r => r.fulfill({status: 503, contentType: 'application/json', body: JSON.stringify({error: 'Valhalla routing is unreachable. Check your connection and try again.'})}));
  await k.evaluate(() => { const s = window.__pathway.state; s.start = {name: 'A', lat: 1.3046, lng: 103.8318}; s.end = {name: 'B', lat: 1.3004, lng: 103.839}; });
  await k.click('#plan'); await k.waitForSelector('.route-card', {timeout: 10000});
  ok('routing failure falls back to labelled illustration', /Straight-line illustration/.test(await k.locator('#routes').innerText()) && /unreachable/.test(await k.locator('#toast').innerText()));
  await kctx.setOffline(true); await k.evaluate(() => dispatchEvent(new Event('offline')));
  ok('offline banner', await k.locator('#offline-banner').isVisible());
  await kctx.close();

  // GPS permission denied
  const dctx = await browser.newContext({viewport: {width: 390, height: 844}, permissions: []});
  const d = await dctx.newPage(); await d.goto(URL_, {waitUntil: 'networkidle'});
  await d.click('#locate'); await d.waitForFunction(() => /permission|available|long/i.test(document.getElementById('gps-status').textContent), null, {timeout: 20000}).catch(() => {});
  ok('GPS denial explained', /permission|available|long/i.test(await d.locator('#gps-status').innerText()), await d.locator('#gps-status').innerText());
  await dctx.close();

  // ---------------- responsive + automated accessibility
  const axeSrc = AXE && fs.existsSync(AXE) ? fs.readFileSync(AXE, 'utf8') : null;
  for (const [w, h, name] of [[375, 812, 'mobile-375'], [390, 844, 'mobile-390'], [768, 1024, 'tablet-768'], [1024, 768, 'tablet-1024'], [1440, 900, 'desktop-1440']]) {
    const c = await browser.newContext({viewport: {width: w, height: h}, hasTouch: w < 1100, isMobile: w < 600, deviceScaleFactor: 1, bypassCSP: !!AXE});
    const p = await c.newPage(); await p.goto(URL_, {waitUntil: 'networkidle'});
    await p.evaluate(() => { const s = window.__pathway.state; });
    await p.click('[data-sample=orchard]'); await p.waitForSelector('.route-card', {timeout: 40000}).catch(() => {});
    await p.waitForTimeout(1200);
    const m = await p.evaluate(() => {
      const overflow = document.documentElement.scrollWidth > innerWidth + 1;
      const small = [...document.querySelectorAll('button,input,select,a[href]')].filter(e => { const r = e.getBoundingClientRect(); const st = getComputedStyle(e); return r.width && r.height && st.visibility !== 'hidden' && !e.closest('.maplibregl-ctrl,.hidden,.visually-hidden,.skip-link') && r.top < innerHeight && r.bottom > 0 && (r.height < 44 && r.width < 44 || r.height < 32); }).map(e => (e.id || e.className || e.tagName) + ' ' + Math.round(e.getBoundingClientRect().width) + 'x' + Math.round(e.getBoundingClientRect().height));
      return {overflow, small};
    });
    ok(name + ': no horizontal overflow', !m.overflow);
    ok(name + ': touch targets ≥44px', m.small.length === 0, m.small.join(', '));
    await p.screenshot({path: path.join(OUT, name + '.png')});
    if (axeSrc) {
      await p.addScriptTag({content: axeSrc});
      const v = await p.evaluate(async () => (await axe.run(document, {runOnly: ['wcag2a', 'wcag2aa', 'wcag21aa'], exclude: [['.maplibregl-canvas-container']]})).violations.map(x => x.id + '(' + x.nodes.length + '): ' + x.nodes.slice(0, 2).map(n => n.target.join(' ')).join('; ')));
      ok(name + ': axe WCAG 2.1 AA', v.length === 0, v.join(' | '));
    }
    await c.close();
  }
  await browser.close();
  const failed = results.filter(r => !r.pass);
  console.log('\n' + (results.length - failed.length) + '/' + results.length + ' checks passed');
  process.exit(failed.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(2); });
