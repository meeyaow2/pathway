(() => {
'use strict';
const $ = id => document.getElementById(id);
const qs = (s, root = document) => [...root.querySelectorAll(s)];
const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const SG = {latMin: 1.15, latMax: 1.48, lngMin: 103.59, lngMax: 104.1};
const inSG = p => p && p.lat >= SG.latMin && p.lat <= SG.latMax && p.lng >= SG.lngMin && p.lng <= SG.lngMax;
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
// Colours come from the design tokens in styles.css (so high-contrast mode restyles the map too).
const token = name => getComputedStyle(document.documentElement).getPropertyValue(name).trim();

/* ------------------------------------------------------------ preferences */
// status: 'applied' changes routing/ranking, 'display' changes presentation, 'data' needs datasets Pathway doesn't have yet.
const PREF_GROUPS = [
 {title: 'Physical access', items: [
  ['stepfree', 'Wheelchair-profile routing', 'applied'], ['avoidstairs', 'Avoid stairs', 'applied'], ['lifts', 'Prefer lifts', 'applied'],
  ['ramps', 'Accessible ramps', 'data'], ['crossings', 'Accessible crossings', 'data'], ['slopes', 'Gentle slopes and kerbs', 'data']]},
 {title: 'Comfort', items: [
  ['shorter', 'Shorter walking distance', 'applied'], ['simpler', 'Fewer turns', 'applied'],
  ['shelter', 'Sheltered walkways', 'data'], ['rest', 'Rest stops and seating', 'data'], ['weather', 'Less weather exposure', 'data']]},
 {title: 'Seeing, hearing and understanding', items: [
  ['spoken', 'Spoken updates', 'display'], ['simple', 'Simplified instructions', 'display'], ['large', 'Larger text', 'display'],
  ['contrast', 'High contrast', 'display'], ['vibrate', 'Vibration alerts', 'display'], ['visual', 'Visual-only alerts', 'display']]},
];
const STATUS_TEXT = {applied: 'Changes routes', display: 'Changes display', data: 'Data needed, not applied yet'};
const PRESETS = {
 wheelchair: ['stepfree', 'avoidstairs', 'lifts'], mobility: ['avoidstairs', 'lifts', 'shorter'], blind: ['spoken', 'simple'],
 lowvision: ['large', 'contrast'], hearing: ['visual', 'vibrate'], elderly: ['avoidstairs', 'lifts', 'shorter', 'large'],
 fatigue: ['shorter', 'lifts', 'rest'], cognitive: ['simple', 'simpler'],
};
const SAMPLES = {
 orchard: [{name: 'Orchard MRT Station', address: 'Orchard Road', lat: 1.3046, lng: 103.8318}, {name: 'Somerset MRT Station', address: 'Orchard Road', lat: 1.3004, lng: 103.839}],
 ion: [{name: 'ION Orchard', address: '2 Orchard Turn, Singapore 238801', lat: 1.30395, lng: 103.83191}, {name: 'Paragon', address: '290 Orchard Road, Singapore 238859', lat: 1.3035, lng: 103.8355}],
};

const state = {
 prefs: {stepfree: true, lifts: true}, access: {}, saved: [], reports: [], mapStyle: 'liberty', showReports: true,
 start: null, end: null, routes: [], selected: 0, planning: false, status: null,
};
try {
 const v3 = JSON.parse(localStorage.getItem('pathway-v3') || 'null');
 if (v3) Object.assign(state, {prefs: v3.prefs || state.prefs, access: v3.access || {}, saved: v3.saved || [], mapStyle: v3.mapStyle || 'liberty', showReports: v3.showReports !== false});
 else {
  const v2 = JSON.parse(localStorage.getItem('pathway-v2') || '{}'); // migrate earlier version
  const p = v2.preferences || {}, a = v2.access || {};
  state.saved = v2.saved || [];
  state.prefs = {stepfree: p.stepfree ?? true, lifts: p.lifts ?? true, shelter: !!p.shelter, rest: !!p.rest, large: !!(v2.large || a.lowvision), contrast: !!v2.contrast, spoken: !!a.blind, simple: !!a.cognitive};
  state.access = {blind: !!a.blind, lowvision: !!a.lowvision, mobility: !!a.mobility, hearing: !!a.hearing, cognitive: !!a.cognitive};
 }
} catch { /* storage unavailable: defaults */ }
const save = () => { try { localStorage.setItem('pathway-v3', JSON.stringify({prefs: state.prefs, access: state.access, saved: state.saved, mapStyle: state.mapStyle, showReports: state.showReports})); } catch {} };

/* ------------------------------------------------------------ feedback */
let toastTimer;
function toast(text) { const t = $('toast'); t.textContent = text; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200); }
function alertSR(text) { const a = $('sr-alert'); a.textContent = ''; setTimeout(() => { a.textContent = text; }, 50); }
function speak(text, force = false) {
 if (!(force || state.prefs.spoken)) return;
 if (!('speechSynthesis' in window)) { if (force) toast('Speech isn’t supported in this browser.'); return; }
 speechSynthesis.cancel(); const u = new SpeechSynthesisUtterance(text); u.lang = 'en-SG'; u.rate = .95; speechSynthesis.speak(u);
}
function buzz(pattern) { if (state.prefs.vibrate && navigator.vibrate) try { navigator.vibrate(pattern); } catch {} }

const P = window.PathwayProviders;
const reportStore = new P.LocalReportStore(); // swap for a backend store later; same list/add/remove interface
const fmtDist = m => { const n = Number(m); return !Number.isFinite(n) ? '—' : n >= 1000 ? (n / 1000).toFixed(1) + ' km' : Math.round(n) + ' m'; };
const fmtTime = s => { const n = Number(s); if (!Number.isFinite(n) || n <= 0) return '—'; const m = Math.max(1, Math.round(n / 60)); return m >= 60 ? Math.floor(m / 60) + ' hr ' + (m % 60) + ' min' : m + ' min'; };
const plural = (n, one, many) => n + ' ' + (n === 1 ? one : many);

/* ------------------------------------------------------------ map */
const ONEMAP_ATTR = '<img src="https://www.onemap.gov.sg/web-assets/images/logo/om_logo.png" alt="" style="height:20px;width:20px;vertical-align:middle"> <a href="https://www.onemap.gov.sg/" target="_blank" rel="noopener noreferrer">OneMap</a> © contributors | <a href="https://www.sla.gov.sg/" target="_blank" rel="noopener noreferrer">Singapore Land Authority</a>';
const STYLES = {
 liberty: 'https://tiles.openfreemap.org/styles/liberty',
 positron: 'https://tiles.openfreemap.org/styles/positron',
 onemap: {version: 8, sources: {onemap: {type: 'raster', tiles: ['https://www.onemap.gov.sg/maps/tiles/Default/{z}/{x}/{y}.png'], tileSize: 256, minzoom: 11, maxzoom: 19, bounds: [103.596, 1.1443, 104.1, 1.4835], attribution: ONEMAP_ATTR}},
  layers: [{id: 'bg', type: 'background', paint: {'background-color': '#ECE8F2'}}, {id: 'onemap', type: 'raster', source: 'onemap'}]},
};
let map = null, markerA = null, markerB = null, gpsMarker = null;
let mapLoadTimer = null;
let mapHasRendered = false;
function mapLoading(message, actionable = false) {
 const panel = $('map-load-status');
 if (!panel) return;
 panel.hidden = false;
 $('map-load-message').textContent = message;
 $('map-retry').hidden = !actionable;
 $('map-try-onemap').hidden = !actionable || state.mapStyle === 'onemap';
}
function mapReady() {
 mapHasRendered = true;
 clearTimeout(mapLoadTimer);
 const panel = $('map-load-status'); if (panel) panel.hidden = true;
}
function mapTimeout() {
 if (!mapHasRendered) mapLoading('The map is taking longer than expected. You can retry or use Singapore OneMap. Search and route information remain available.', true);
}
$('map-retry').addEventListener('click', () => {
 if (!map) return setupMap();
 mapHasRendered = false;mapLoading('Retrying map tiles…');
 map.setStyle(STYLES[state.mapStyle]);
 clearTimeout(mapLoadTimer);mapLoadTimer = setTimeout(mapTimeout, 9000);
});
$('map-try-onemap').addEventListener('click', () => { selectStyle('onemap'); });


function setupMap() {
 if (!window.maplibregl) { $('map').innerHTML = '<div class="map-fallback"><p>The map couldn’t load. Directions are still listed as text in the journey panel.</p></div>'; return; }
 $('map').innerHTML = '';
 mapHasRendered = false;
 mapLoading('Loading Singapore map…');
 clearTimeout(mapLoadTimer);
 mapLoadTimer = setTimeout(mapTimeout, 9000);
 try {
  const mobile = matchMedia('(max-width: 700px)').matches;
  map = new maplibregl.Map({container: 'map', style: STYLES[state.mapStyle] || STYLES.liberty, center: [103.8318, 1.3046], zoom: mobile ? 12.5 : 13.5,
   minZoom: 10, maxZoom: 19, maxBounds: [[103.3, 1.0], [104.5, 1.7]], attributionControl: {compact: true}, dragRotate: false, pitchWithRotate: false,
   pixelRatio: Math.min(window.devicePixelRatio || 1, mobile ? 1.25 : 1.75),
   fadeDuration: 0, renderWorldCopies: false, maxTileCacheSize: mobile ? 35 : 60});
 } catch (e) { clearTimeout(mapLoadTimer); $('map').innerHTML = '<div class="map-fallback"><p>This browser can’t display the interactive map (WebGL unavailable). Directions are still listed as text.</p></div>'; mapLoading('Map rendering is unavailable in this browser. Text directions remain available.', false); map = null; return; }
 map.touchZoomRotate.disableRotation();
 if (matchMedia('(min-width: 600px)').matches) map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
 map.addControl(new maplibregl.ScaleControl({unit: 'metric'}), 'bottom-left');
 map.on('style.load', addOverlays);
 map.on('load', mapReady);
 map.on('idle', () => { if (map && map.isStyleLoaded()) mapReady(); });
 map.on('error', e => { if (e && e.error) console.warn('Map:', e.error.message); });
 map.getCanvas().setAttribute('aria-label', 'Interactive map. Use arrow keys to pan and plus or minus to zoom.');
 map.on('click', 'reports-circle', e => {
  const f = e.features && e.features[0]; if (!f) return;
  const el = document.createElement('div');
  const h = document.createElement('strong'); h.textContent = f.properties.category;
  const flag = document.createElement('p'); flag.textContent = 'Local demo report (this device only)'; flag.style.cssText = 'margin:4px 0;color:#6b3a00;font-weight:700';
  const d = document.createElement('p'); d.textContent = f.properties.location + ' — ' + f.properties.description; d.style.margin = '0';
  el.append(h, flag, d);
  new maplibregl.Popup({offset: 12}).setLngLat(e.lngLat).setDOMContent(el).addTo(map);
 });
 map.on('mouseenter', 'reports-circle', () => { map.getCanvas().style.cursor = 'pointer'; });
 map.on('mouseleave', 'reports-circle', () => { map.getCanvas().style.cursor = ''; });
}
function addOverlays() {
 if (!map) return;
 const empty = {type: 'FeatureCollection', features: []};
 if (!map.getSource('routes')) map.addSource('routes', {type: 'geojson', data: empty});
 if (!map.getSource('reports')) map.addSource('reports', {type: 'geojson', data: empty});
 const add = layer => { if (!map.getLayer(layer.id)) map.addLayer(layer); };
 // Alternative = thinner, dashed, grey-violet; selected = solid purple with a white casing (pattern + width, not colour alone).
 add({id: 'route-alt', type: 'line', source: 'routes', filter: ['==', ['get', 'selected'], false], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': token('--map-route-alt'), 'line-width': 4, 'line-dasharray': [1.5, 1.5]}});
 add({id: 'route-casing', type: 'line', source: 'routes', filter: ['==', ['get', 'selected'], true], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': token('--map-route-casing'), 'line-width': 10}});
 add({id: 'route-main', type: 'line', source: 'routes', filter: ['all', ['==', ['get', 'selected'], true], ['!', ['get', 'illustrative']]], layout: {'line-cap': 'round', 'line-join': 'round'}, paint: {'line-color': token('--map-route'), 'line-width': 6}});
 add({id: 'route-illustrative', type: 'line', source: 'routes', filter: ['all', ['==', ['get', 'selected'], true], ['get', 'illustrative']], layout: {'line-cap': 'round'}, paint: {'line-color': token('--map-route'), 'line-width': 5, 'line-dasharray': [1, 2]}});
 add({id: 'reports-circle', type: 'circle', source: 'reports', paint: {'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 5, 16, 9], 'circle-color': token('--map-report'), 'circle-stroke-color': token('--map-pin-border'), 'circle-stroke-width': 2.5}});
 drawRoutes(false); drawReports();
}
function restyleMap() { // re-read tokens, e.g. after high-contrast mode changes
 if (!map || !map.getLayer('route-main')) return;
 map.setPaintProperty('route-alt', 'line-color', token('--map-route-alt'));
 map.setPaintProperty('route-main', 'line-color', token('--map-route'));
 map.setPaintProperty('route-illustrative', 'line-color', token('--map-route'));
}
function drawRoutes(fit = true) {
 if (!map || !map.getSource('routes')) return;
 const features = state.routes.map((r, i) => ({type: 'Feature', properties: {selected: i === state.selected, illustrative: !!r.illustrative},
  geometry: {type: 'LineString', coordinates: r.geometry.map(([lat, lng]) => [lng, lat])}}));
 features.sort((a, b) => a.properties.selected - b.properties.selected);
 map.getSource('routes').setData({type: 'FeatureCollection', features});
 if (fit) setTimeout(fitView, 320); // wait for the bottom sheet to settle
}
function drawReports() {
 if (!map || !map.getSource('reports')) return;
 const features = state.showReports ? state.reports.filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng)).map(r => ({type: 'Feature',
  properties: {category: r.category, location: r.location, description: r.description}, geometry: {type: 'Point', coordinates: [r.lng, r.lat]}})) : [];
 map.getSource('reports').setData({type: 'FeatureCollection', features});
}
function pin(label, cls, aria) { const el = document.createElement('div'); el.className = 'pin-wrap'; el.innerHTML = '<div class="pin ' + cls + '"><span>' + label + '</span></div>'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', aria); return el; }
function drawMarkers() {
 if (!map) return;
 for (const [which, label, cls] of [['start', 'A', 'pin-a'], ['end', 'B', 'pin-b']]) {
  const p = state[which]; let m = which === 'start' ? markerA : markerB;
  if (!p) { if (m) m.remove(); m = null; }
  else {
   const aria = (which === 'start' ? 'Start: ' : 'Destination: ') + p.name;
   if (!m) m = new maplibregl.Marker({element: pin(label, cls, aria), anchor: which === 'start' ? 'center' : 'bottom'});
   m.getElement().setAttribute('aria-label', aria);
   m.setLngLat([p.lng, p.lat]).setPopup(new maplibregl.Popup({offset: 24}).setText(aria)).addTo(map);
  }
  if (which === 'start') markerA = m; else markerB = m;
 }
}
function mapPadding() {
 const wide = matchMedia('(min-width: 900px)').matches, mid = matchMedia('(min-width: 600px)').matches;
 if (wide) return {top: 60, bottom: 60, left: 60, right: 80};
 const top = ($('search-card').getBoundingClientRect().bottom || 160) + 20;
 const sheetTop = $('sheet').getBoundingClientRect().top || innerHeight * .5;
 if (mid) return {top: 40, bottom: 40, left: 460, right: 80};
 return {top: Math.min(top, innerHeight * .4), bottom: Math.max(40, innerHeight - sheetTop + 20), left: 30, right: 74};
}
function fitView() {
 if (!map) return;
 const pts = state.routes[state.selected]?.geometry?.map(([lat, lng]) => [lng, lat]) || [state.start, state.end].filter(Boolean).map(p => [p.lng, p.lat]);
 if (!pts.length) return;
 if (pts.length === 1) return map.easeTo({center: pts[0], zoom: 16, duration: reducedMotion ? 0 : 500});
 const b = new maplibregl.LngLatBounds(pts[0], pts[0]); pts.forEach(p => b.extend(p));
 try { map.fitBounds(b, {padding: mapPadding(), maxZoom: 17, duration: reducedMotion ? 0 : 600}); } catch { map.fitBounds(b, {padding: 30, maxZoom: 17}); }
}
function selectStyle(style) {
 if (!STYLES[style]) return;
 state.mapStyle = style; save();
 ['liberty', 'positron', 'onemap'].forEach(s => $('provider-' + s).setAttribute('aria-pressed', String(s === style)));
 if (map) { mapHasRendered = false; mapLoading('Loading '+(style === 'onemap' ? 'OneMap' : 'map')+' tiles…'); clearTimeout(mapLoadTimer);mapLoadTimer=setTimeout(mapTimeout,9000);map.setStyle(STYLES[style]); }
}

/* ------------------------------------------------------------ bottom sheet + pages */
const app = $('app');
const SHEET_ORDER = ['peek', 'half', 'full'];
function setSheet(s) {
 app.dataset.sheet = s;
 const h = $('sheet-handle'); h.setAttribute('aria-expanded', String(s !== 'peek'));
 $('sheet-handle-label').textContent = s === 'full' ? 'Collapse journey panel' : 'Expand journey panel';
 if (map) setTimeout(() => map.resize(), 280);
}
$('sheet-handle').addEventListener('click', () => { if (dragMoved) return; const i = SHEET_ORDER.indexOf(app.dataset.sheet); setSheet(i === 2 ? 'peek' : SHEET_ORDER[i + 1]); });
let dragStart = null, dragMoved = false;
$('sheet-handle').addEventListener('pointerdown', e => { dragStart = {y: e.clientY, h: $('sheet').getBoundingClientRect().height}; dragMoved = false; $('sheet-handle').setPointerCapture(e.pointerId); });
$('sheet-handle').addEventListener('pointermove', e => {
 if (!dragStart) return; const dy = dragStart.y - e.clientY; if (Math.abs(dy) > 6) dragMoved = true; if (!dragMoved) return;
 $('sheet').classList.add('dragging'); $('sheet').style.height = Math.max(120, Math.min(innerHeight - 80, dragStart.h + dy)) + 'px';
});
$('sheet-handle').addEventListener('pointerup', () => {
 if (!dragStart) return; const sheet = $('sheet'); const h = sheet.getBoundingClientRect().height;
 sheet.classList.remove('dragging'); sheet.style.height = ''; dragStart = null;
 if (dragMoved) { const r = h / innerHeight; setSheet(r < .36 ? 'peek' : r < .72 ? 'half' : 'full'); setTimeout(() => { dragMoved = false; }, 50); }
});

const PAGES = ['planner', 'reports', 'saved', 'about'];
function changePage(page, focus = true) {
 PAGES.forEach(p => $(p).classList.toggle('hidden', p !== page));
 qs('[data-page]').forEach(b => b.dataset.page === page ? b.setAttribute('aria-current', 'page') : b.removeAttribute('aria-current'));
 app.dataset.page = page;
 if (page === 'reports') loadReports();
 if (page === 'saved') renderSaved();
 setSheet(page === 'planner' ? (state.routes.length ? 'half' : 'peek') : 'full');
 $('sheet-content').scrollTop = 0;
 if (focus) { const h = $(page).querySelector('h2'); if (h) { h.setAttribute('tabindex', '-1'); h.focus({preventScroll: true}); } }
}
qs('.tabbar [data-page]').forEach(b => b.addEventListener('click', () => changePage(b.dataset.page)));

/* ------------------------------------------------------------ address search (ARIA combobox) */
const combos = {};
function setupCombo(which) {
 const input = $(which + '-search'), list = $(which + '-suggestions');
 const c = combos[which] = {items: [], active: -1, timer: null, seq: 0};
 const open = () => { list.classList.remove('hidden'); input.setAttribute('aria-expanded', 'true'); };
 const close = () => { list.classList.add('hidden'); input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); c.active = -1; };
 c.close = close;
 const render = () => {
  list.innerHTML = c.items.length ? c.items.map((r, i) => '<div role="option" id="' + which + '-opt-' + i + '" data-i="' + i + '" aria-selected="' + (i === c.active) + '"><strong>' + esc(r.name) + '</strong><small>' + esc(r.address) + '</small></div>').join('')
   : '<div class="empty">No matches. Try a six-digit postal code, a building name or a street.</div>';
  if (c.active >= 0) { input.setAttribute('aria-activedescendant', which + '-opt-' + c.active); $(which + '-opt-' + c.active)?.scrollIntoView({block: 'nearest'}); }
  else input.removeAttribute('aria-activedescendant');
  open();
 };
 const choose = r => { close(); selectPlace(which, r); };
 const run = async () => {
  const q = input.value.trim(); if (q.length < 3) { close(); return; }
  const seq = ++c.seq; $('address-status').textContent = 'Searching…';
  try {
   const data = await P.search(q);
   if (seq !== c.seq) return;
   c.items = data.results || []; c.active = -1; render();
   $('address-status').textContent = c.items.length ? plural(c.items.length, 'suggestion', 'suggestions') + '. Use the up and down arrows or tap one to choose.' : 'No matches found.';
  } catch (e) { if (seq !== c.seq) return; close(); $('address-status').textContent = 'Address search unavailable: ' + e.message; }
 };
 c.run = run;
 input.addEventListener('input', () => {
  if (state[which]) { state[which] = null; clearRoutes(); drawMarkers(); }
  clearTimeout(c.timer); c.seq++;
  if (input.value.trim().length >= 3) c.timer = setTimeout(run, 350); else { close(); $('address-status').textContent = ''; }
 });
 input.addEventListener('keydown', e => {
  const isOpen = !list.classList.contains('hidden') && c.items.length;
  if (e.key === 'ArrowDown') { e.preventDefault(); if (!c.items.length) return; c.active = Math.min(c.active + 1, c.items.length - 1); render(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (!isOpen) return; c.active = Math.max(c.active - 1, -1); render(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (isOpen) choose(c.items[Math.max(c.active, 0)]); else { clearTimeout(c.timer); run(); } }
  else if (e.key === 'Escape') { if (!list.classList.contains('hidden')) { e.stopPropagation(); close(); } }
 });
 input.addEventListener('blur', () => setTimeout(close, 160));
 list.addEventListener('mousedown', e => e.preventDefault()); // keep focus in the input while tapping/clicking an option
 list.addEventListener('click', e => { const o = e.target.closest('[role=option]'); if (o) choose(c.items[Number(o.dataset.i)]); });
}
setupCombo('start'); setupCombo('end');

function selectPlace(which, r, {plan = true} = {}) {
 const p = {name: r.name || r.address || 'Selected place', address: r.address || '', lat: Number(r.lat), lng: Number(r.lng)};
 if (!inSG(p)) { toast('That place is outside Singapore.'); return; }
 state[which] = p; $(which + '-search').value = p.name;
 clearRoutes(); drawMarkers();
 $('address-status').textContent = (which === 'start' ? 'Start' : 'Destination') + ': ' + p.name + (p.address ? ', ' + p.address : '') + '.';
 if (state.start && state.end && plan) planRoutes();
 else { fitView(); if (!state.end) $('end-search').focus(); }
}

$('swap-address').addEventListener('click', () => {
 [state.start, state.end] = [state.end, state.start];
 $('start-search').value = state.start?.name || ''; $('end-search').value = state.end?.name || '';
 clearRoutes(); drawMarkers();
 $('address-status').textContent = 'Start and destination swapped.';
 if (state.start && state.end) planRoutes();
});
qs('[data-sample]').forEach(b => b.addEventListener('click', () => {
 const [a, z] = SAMPLES[b.dataset.sample]; selectPlace('start', a, {plan: false}); selectPlace('end', z);
}));

/* ------------------------------------------------------------ GPS helpers */
function gpsErrorText(err) {
 if (!window.isSecureContext) return 'Location needs a secure (https) connection.';
 if (!err) return 'Location isn’t available in this browser.';
 if (err.code === 1) return 'Location permission is off. Allow location for this site in your browser settings (iPhone: Settings → Privacy & Security → Location Services → Safari Websites).';
 if (err.code === 2) return 'Your position isn’t available right now. Check that Location Services is on, or move somewhere with a clearer sky view.';
 if (err.code === 3) return 'Finding your position took too long. Please try again.';
 return 'Your location couldn’t be found.';
}
function getPosition(opts = {}) {
 return new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(null);
  navigator.geolocation.getCurrentPosition(resolve, reject, {enableHighAccuracy: true, timeout: 15000, maximumAge: 10000, ...opts});
 });
}
$('gps-start').addEventListener('click', async () => {
 $('address-status').textContent = 'Asking for your current location…'; $('gps-start').setAttribute('aria-busy', 'true');
 try {
  const pos = await getPosition();
  const p = {name: 'My location', address: 'GPS ±' + Math.round(pos.coords.accuracy || 0) + ' m', lat: pos.coords.latitude, lng: pos.coords.longitude};
  if (!inSG(p)) { $('address-status').textContent = 'Your location appears to be outside Singapore, so it can’t be used as a start.'; return; }
  lastGPS = {lat: p.lat, lng: p.lng, accuracy: Math.round(pos.coords.accuracy || 0)};
  selectPlace('start', p);
  $('address-status').textContent = 'Start set to your location (accuracy ±' + lastGPS.accuracy + ' m). GPS may not match an accessible entrance.';
 } catch (e) { $('address-status').textContent = gpsErrorText(e); }
 finally { $('gps-start').removeAttribute('aria-busy'); }
});

/* ------------------------------------------------------------ routing */
function clearRoutes() {
 state.routes = []; state.selected = 0; app.classList.remove('has-route');
 refreshJourneyRoute(); renderRoutes(); drawRoutes(false);
}
function recommendIndex(routes) {
 const p = state.prefs, physical = p.stepfree || p.avoidstairs;
 const score = r => (p.stepfree && r.profile !== 'wheelchair' ? 1e6 : 0) + (physical ? r.counts.stairs * 1e4 : 0) +
  (p.shorter ? r.distance_m : 0) + (p.simpler ? r.steps.length * 60 : 0) + r.duration_s / 10;
 let best = 0; routes.forEach((r, i) => { if (score(r) < score(routes[best])) best = i; }); return best;
}
async function planRoutes() {
 if (!state.start || !state.end) { toast('Choose a start and a destination first.'); (state.start ? $('end-search') : $('start-search')).focus(); return; }
 if (state.start.lat === state.end.lat && state.start.lng === state.end.lng) { toast('Start and destination are the same place.'); return; }
 const btn = $('plan'); state.planning = true;
 btn.disabled = true; btn.setAttribute('aria-busy', 'true'); btn.textContent = 'Finding routes…';
 $('routes').setAttribute('aria-busy', 'true'); $('routes').innerHTML = '<div class="skeleton"></div><div class="skeleton"></div>';
 setSheet('half');
 try {
  const data = await P.compareRoutes(state.start, state.end, {preferLifts: !!state.prefs.lifts});
  state.routes = data.routes; state.selected = recommendIndex(state.routes);
  app.classList.add('has-route');
  const r = state.routes[state.selected];
  const msg = plural(state.routes.length, 'route', 'routes') + ' found. Suggested: ' + r.label + ', ' + fmtTime(r.duration_s) + ', ' + fmtDist(r.distance_m) + '. Accessibility not verified.';
  alertSR(msg); speak(msg); buzz(60);
  if (!matchMedia('(min-width: 600px)').matches) setSheet('peek');
 } catch (e) {
  state.routes = [illustrative()]; state.selected = 0;
  toast('Routing unavailable: ' + e.message); alertSR('Routing unavailable. ' + e.message);
 } finally {
  state.planning = false; btn.disabled = false; btn.removeAttribute('aria-busy'); btn.textContent = 'Get walking directions';
  $('routes').removeAttribute('aria-busy');
  refreshJourneyRoute(); renderRoutes(); drawRoutes();
 }
}
function illustrative() {
 const a = state.start, b = state.end, R = 6371000, rad = Math.PI / 180;
 const d = 2 * R * Math.asin(Math.sqrt(Math.sin((b.lat - a.lat) * rad / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin((b.lng - a.lng) * rad / 2) ** 2));
 return {illustrative: true, label: 'Straight-line illustration', profile: 'none', distance_m: d, duration_s: 0, geometry: [[a.lat, a.lng], [b.lat, b.lng]], steps: [], counts: {stairs: 0, elevator: 0, escalator: 0, crossing: 0}, warnings: ['Not a walking route. The routing service couldn’t be reached.'], provider: 'none', attribution: ''};
}
$('plan').addEventListener('click', planRoutes);

function renderRoutes() {
 const box = $('routes');
 const rec = state.routes.length > 1 ? recommendIndex(state.routes) : 0;
 const physical = state.prefs.stepfree || state.prefs.avoidstairs || state.prefs.shorter || state.prefs.simpler;
 if (!state.routes.length) {
  box.innerHTML = state.planning ? box.innerHTML : '<p class="notice">' + (state.start || state.end ? 'Choose both a start and a destination.' : 'Search for a start and a destination above, or try a sample journey.') + '</p>';
  $('route-source').textContent = 'Awaiting addresses';
  renderDetails(); return;
 }
 const first = state.routes[0];
 $('route-source').textContent = first.illustrative ? 'Offline illustration' : first.provider === 'onemap' ? 'OneMap' : 'OpenStreetMap data';
 box.innerHTML = state.routes.map((r, i) => {
  const c = r.counts, meta = r.illustrative ? ['Straight line ' + fmtDist(r.distance_m)] :
   [fmtDist(r.distance_m), plural(c.stairs, 'stair section', 'stair sections'), plural(c.elevator, 'lift', 'lifts'), plural(c.crossing, 'crossing', 'crossings')];
  const tag = state.routes.length > 1 && i === rec ? '<span class="tag">' + (physical ? 'Best match for your needs' : 'Fastest') + '</span>' : '';
  const warn = (r.warnings || []).map(w => '<div class="warn">' + esc(w) + '</div>').join('');
  return '<button type="button" class="route-card" data-route="' + i + '" aria-pressed="' + (i === state.selected) + '">' +
   '<span class="top"><span class="label">' + esc(r.label) + '<span class="selected-mark" aria-hidden="true">✓ Selected</span></span><span class="time">' + (r.illustrative ? '—' : esc(fmtTime(r.duration_s))) + '</span></span>' +
   '<span class="meta">' + meta.map(m => '<span>' + esc(m) + '</span>').join('') + '</span>' +
   (r.illustrative ? '' : '<span class="meta"><span>' + esc(r.note) + ' Stairs and lifts counted from map data.</span></span>') + tag + warn + '</button>';
 }).join('');
 qs('[data-route]', box).forEach(b => b.addEventListener('click', () => {
  state.selected = Number(b.dataset.route); refreshJourneyRoute(); renderRoutes(); drawRoutes();
  const r = state.routes[state.selected]; alertSR('Selected ' + r.label + ', ' + fmtTime(r.duration_s) + '.');
 }));
 renderDetails();
}
function renderDetails() {
 const r = state.routes[state.selected];
 const simple = !!state.prefs.simple; $('steps').classList.toggle('simple', simple); $('needs').closest('.page').classList.toggle('simple', simple);
 if (!r) { $('details-title').textContent = 'Walking directions'; $('route-detail').textContent = 'Choose a start and destination to see step-by-step directions.'; $('steps').innerHTML = ''; return; }
 $('details-title').textContent = r.illustrative ? 'No directions available' : 'Directions: ' + r.label;
 $('route-detail').textContent = r.illustrative ? 'The dashed line only connects the two points. It is not a path you can follow.' :
  fmtTime(r.duration_s) + ' · ' + fmtDist(r.distance_m) + '. ' + r.evidence;
 const KIND = {stairs: 'Stairs', elevator: 'Lift', escalator: 'Escalator', crossing: 'Crossing'};
 $('steps').innerHTML = r.steps.map((s, i) => '<li data-step="' + i + '"><span>' + esc(simple ? (s.short || s.instruction) : s.instruction) +
  (KIND[s.kind] ? '<span class="kind ' + s.kind + '">' + KIND[s.kind] + '</span>' : '') + '</span><span class="dist">' + (s.distance_m ? esc(fmtDist(s.distance_m)) : '') + '</span></li>').join('');
}
$('read-summary').addEventListener('click', () => {
 const r = state.routes[state.selected];
 if (!r) return speak('No route loaded yet. Choose a start and a destination.', true);
 speak(r.label + '. ' + fmtTime(r.duration_s) + ', ' + fmtDist(r.distance_m) + '. Accessibility is not verified. ' + r.steps.map((s, i) => 'Step ' + (i + 1) + '. ' + (state.prefs.simple ? s.short : s.instruction)).join(' '), true);
});

/* ------------------------------------------------------------ journey progress (GPS) */
let watchId = null, lastGPS = null, journey = null, lastBadge = '', currentStep = -1;
const EARTH = 6371000;
function metres(a, b) { const r = Math.PI / 180, dp = (b[0] - a[0]) * r, dl = (b[1] - a[1]) * r; const v = Math.sin(dp / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dl / 2) ** 2; return 2 * EARTH * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v))); }
function routeProjection(pos, pts) {
 const cos = Math.cos(pos[0] * Math.PI / 180), toXY = p => [(p[1] - pos[1]) * Math.PI / 180 * EARTH * cos, (p[0] - pos[0]) * Math.PI / 180 * EARTH];
 let total = 0, best = {distance: Infinity, along: 0, index: 0};
 for (let i = 1; i < pts.length; i++) {
  const a = toXY(pts[i - 1]), b = toXY(pts[i]), vx = b[0] - a[0], vy = b[1] - a[1], len = Math.hypot(vx, vy);
  if (len < .01) continue;
  const t = Math.max(0, Math.min(1, -(a[0] * vx + a[1] * vy) / (len * len))), d = Math.hypot(a[0] + t * vx, a[1] + t * vy);
  if (d < best.distance) best = {distance: d, along: total + t * len, index: i - 1};
  total += len;
 }
 return best;
}
function refreshJourneyRoute() {
 journey = null; currentStep = -1;
 const r = state.routes[state.selected];
 if (r && !r.illustrative && r.geometry.length > 1) {
  let len = 0; for (let i = 1; i < r.geometry.length; i++) len += metres(r.geometry[i - 1], r.geometry[i]);
  journey = {points: r.geometry, length: len, steps: r.steps};
 }
 updateJourney();
}
function setStep(i) {
 if (i === currentStep) return; currentStep = i;
 qs('#steps li').forEach(li => li.classList.toggle('current', Number(li.dataset.step) === i));
 const s = journey?.steps[i]; if (s) { speak('Next: ' + (state.prefs.simple ? s.short : s.instruction)); buzz(40); }
}
function updateJourney() {
 const badge = $('journey-badge');
 const set = (label, text, pct = 0, tone = '') => {
  badge.textContent = label; badge.className = 'flag ' + tone; $('journey-message').textContent = text;
  $('journey-progress').setAttribute('aria-valuenow', String(Math.round(pct))); $('journey-fill').style.width = pct + '%';
  if (label !== lastBadge && lastBadge && watchId !== null) {
   if (tone === 'alert') { alertSR(text); buzz([120, 80, 120]); }
   speak(label.toLowerCase() + '. ' + text);
  }
  lastBadge = label;
 };
 $('journey-recalculate').disabled = !(lastGPS && state.end);
 if (!journey) { $('journey-distance').textContent = 'Remaining: —'; $('journey-accuracy').textContent = 'GPS accuracy: —'; return set('NOT NAVIGATING', 'Load a walking route, then choose Follow to see approximate progress.'); }
 if (!lastGPS) { $('journey-distance').textContent = 'Remaining: ' + fmtDist(journey.length); $('journey-accuracy').textContent = 'GPS accuracy: —'; return set('GPS OFF', 'Choose Follow (the arrow button on the map) to see approximate progress along this route.'); }
 const acc = lastGPS.accuracy || Infinity, m = routeProjection([lastGPS.lat, lastGPS.lng], journey.points);
 const remaining = Math.max(0, journey.length - m.along), pct = journey.length ? Math.max(0, Math.min(100, 100 * m.along / journey.length)) : 0;
 $('journey-distance').textContent = 'Remaining: about ' + fmtDist(remaining);
 $('journey-accuracy').textContent = 'GPS accuracy: ' + (Number.isFinite(acc) ? '±' + Math.round(acc) + ' m' : 'unknown');
 if (journey.steps.length && journey.steps[0].shape_index !== null) {
  let idx = 0; journey.steps.forEach((s, i) => { if (s.shape_index <= m.index) idx = i; }); if (watchId !== null) setStep(idx);
 }
 if (acc > 50) return set('LOW ACCURACY', 'GPS accuracy is too low to estimate where you are on the route.', pct);
 if (m.distance > Math.max(35, acc * 2)) return set('POSSIBLY OFF ROUTE', 'You seem to be about ' + Math.round(m.distance) + ' m from the route. Check your surroundings, or choose Reroute from here.', pct, 'alert');
 if (remaining <= 25) return set('NEAR DESTINATION', 'You may be near the destination. Confirm the accessible entrance yourself.', pct, 'ok');
 set('ON ROUTE', 'Approximate position along the route. This isn’t safety-verified navigation.', pct, 'ok');
}
function gpsUpdate(p) {
 const lat = p.coords.latitude, lng = p.coords.longitude; if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
 lastGPS = {lat, lng, accuracy: Math.round(p.coords.accuracy || 0)};
 if (map) {
  if (!gpsMarker) { const el = document.createElement('div'); el.className = 'gps-dot'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'Your approximate location'); gpsMarker = new maplibregl.Marker({element: el}); }
  gpsMarker.setLngLat([lng, lat]).addTo(map);
  if (watchId !== null) map.easeTo({center: [lng, lat], duration: reducedMotion ? 0 : 400});
 }
 $('gps-status').textContent = 'GPS on · accuracy ±' + lastGPS.accuracy + ' m. Location is never stored.';
 updateJourney();
}
function stopGPS(message) {
 if (watchId !== null) navigator.geolocation.clearWatch(watchId); watchId = null; lastBadge = ''; setStep(-1);
 const f = $('follow-gps'); f.setAttribute('aria-pressed', 'false'); f.setAttribute('aria-label', 'Follow my location along the route');
 $('gps-status').textContent = message || 'GPS is off. Location is never stored.'; updateJourney();
}
$('follow-gps').addEventListener('click', () => {
 if (watchId !== null) return stopGPS();
 if (!navigator.geolocation || !window.isSecureContext) { $('gps-status').textContent = gpsErrorText(null); toast(gpsErrorText(null)); return; }
 $('gps-status').textContent = 'Asking for your location…';
 watchId = navigator.geolocation.watchPosition(gpsUpdate, err => { const t = gpsErrorText(err); stopGPS(t); toast(t); }, {enableHighAccuracy: true, maximumAge: 3000, timeout: 20000});
 const f = $('follow-gps'); f.setAttribute('aria-pressed', 'true'); f.setAttribute('aria-label', 'Stop following my location');
 if (!state.routes.length) toast('Following your location. Load a route to see progress.');
});
$('locate').addEventListener('click', async () => {
 try { const p = await getPosition(); gpsUpdate(p); if (map) map.easeTo({center: [p.coords.longitude, p.coords.latitude], zoom: 16, duration: reducedMotion ? 0 : 500}); }
 catch (e) { const t = gpsErrorText(e); $('gps-status').textContent = t; toast(t); }
});
document.addEventListener('visibilitychange', () => { if (document.hidden && watchId !== null) stopGPS('GPS paused while Pathway was in the background. Choose Follow to resume.'); });
$('journey-announce').addEventListener('click', () => speak($('journey-badge').textContent + '. ' + $('journey-message').textContent + ' ' + $('journey-distance').textContent + '. ' + $('journey-accuracy').textContent, true));
$('journey-recalculate').addEventListener('click', async () => {
 if (!lastGPS || !state.end) return;
 const prev = {start: state.start, routes: state.routes, selected: state.selected, value: $('start-search').value};
 const here = {name: 'My location', address: 'GPS', lat: lastGPS.lat, lng: lastGPS.lng};
 if (!inSG(here)) return toast('Your location appears to be outside Singapore.');
 $('journey-recalculate').disabled = true;
 try {
  const data = await P.compareRoutes(here, state.end, {preferLifts: !!state.prefs.lifts});
  const profile = state.routes[state.selected]?.profile;
  state.start = here; $('start-search').value = here.name; state.routes = data.routes;
  state.selected = Math.max(0, state.routes.findIndex(r => r.profile === profile));
  drawMarkers(); refreshJourneyRoute(); renderRoutes(); drawRoutes();
  toast('Rerouted from your location. Accessibility is still unverified.'); speak('Rerouted from your location.');
 } catch (e) { Object.assign(state, {start: prev.start, routes: prev.routes, selected: prev.selected}); $('start-search').value = prev.value; toast('Rerouting failed: ' + e.message); }
 finally { updateJourney(); }
});

/* ------------------------------------------------------------ needs & display */
function renderPrefs() {
 $('pref-groups').innerHTML = PREF_GROUPS.map(g => '<div class="pref-group"><h4>' + esc(g.title) + '</h4><div class="chips">' + g.items.map(([k, label, st]) =>
  '<button type="button" class="chip" data-pref="' + k + '" aria-pressed="' + !!state.prefs[k] + '">' + esc(label) + '<small>' + STATUS_TEXT[st] + '</small></button>').join('') + '</div></div>').join('');
 qs('[data-pref]').forEach(b => b.addEventListener('click', () => { togglePref(b.dataset.pref); }));
 applyDisplay();
}
function togglePref(k, value) {
 state.prefs[k] = value ?? !state.prefs[k]; save();
 qs('[data-pref="' + k + '"]').forEach(b => b.setAttribute('aria-pressed', String(!!state.prefs[k])));
 applyDisplay();
 if (state.routes.length > 1 && ['stepfree', 'avoidstairs', 'shorter', 'simpler'].includes(k)) { state.selected = recommendIndex(state.routes); refreshJourneyRoute(); renderRoutes(); drawRoutes(false); }
 else if (k === 'simple') renderDetails();
 if (k === 'lifts' && state.routes.length && !state.routes[0].illustrative) planRoutes();
}
function applyDisplay() {
 document.documentElement.classList.toggle('pw-large', !!state.prefs.large);
 document.documentElement.classList.toggle('pw-contrast', !!state.prefs.contrast);
 restyleMap();
 qs('[data-access]').forEach(b => b.setAttribute('aria-pressed', String(!!state.access[b.dataset.access])));
 const missing = PREF_GROUPS.flatMap(g => g.items).filter(([k, , st]) => st === 'data' && state.prefs[k]).map(([, l]) => l.toLowerCase());
 $('accessibility-note').textContent = (missing.length ? 'Not applied yet, because reliable Singapore data isn’t connected: ' + missing.join(', ') + '. ' : '') +
  'Preferences never make a route verified-safe.' + (state.prefs.vibrate && !navigator.vibrate ? ' Vibration isn’t supported in this browser.' : '');
 if (map) setTimeout(() => map.resize(), 50);
}
qs('[data-access]').forEach(b => b.addEventListener('click', () => {
 const k = b.dataset.access; state.access[k] = !state.access[k];
 if (state.access[k]) PRESETS[k].forEach(p => { state.prefs[p] = true; });
 save(); renderPrefs();
 if (state.routes.length > 1) { state.selected = recommendIndex(state.routes); refreshJourneyRoute(); renderRoutes(); drawRoutes(false); }
 alertSR(b.textContent + (state.access[k] ? ' selected. Related preferences turned on.' : ' deselected.'));
}));

/* ------------------------------------------------------------ saved journeys */
$('save').addEventListener('click', () => {
 if (!state.start || !state.end) return toast('Choose a start and destination before saving.');
 const r = state.routes[state.selected];
 state.saved.unshift({id: Date.now(), from: state.start, to: state.end, profile: r?.profile || null, created: new Date().toLocaleDateString('en-SG')});
 state.saved = state.saved.slice(0, 40); save(); toast('Journey saved on this device.');
});
function renderSaved() {
 const name = p => typeof p === 'string' ? p : p?.name || 'Unknown';
 $('saved-list').innerHTML = state.saved.length ? state.saved.map(x => {
  const label = name(x.from) + ' to ' + name(x.to), canPlan = typeof x.from === 'object' && typeof x.to === 'object';
  return '<div class="item"><div><strong>' + esc(name(x.from)) + ' → ' + esc(name(x.to)) + '</strong><p class="small muted">Saved ' + esc(x.created) + ' · Not a verified route</p></div><div class="actions">' +
   (canPlan ? '<button type="button" class="btn primary" data-open="' + x.id + '" aria-label="Plan again: ' + esc(label) + '">Plan again</button>' : '') +
   '<button type="button" class="btn" data-remove="' + x.id + '" aria-label="Remove saved journey ' + esc(label) + '">Remove</button></div></div>';
 }).join('') : '<p class="notice">No saved journeys yet. Plan a route and press the heart button to save it.</p>';
 qs('[data-remove]').forEach(b => b.addEventListener('click', () => { state.saved = state.saved.filter(x => String(x.id) !== b.dataset.remove); save(); renderSaved(); toast('Saved journey removed.'); $('saved-heading').focus(); }));
 qs('[data-open]').forEach(b => b.addEventListener('click', () => {
  const x = state.saved.find(s => String(s.id) === b.dataset.open); if (!x) return;
  changePage('planner', false); selectPlace('start', x.from, {plan: false}); selectPlace('end', x.to);
 }));
}

/* ------------------------------------------------------------ reports */
let lastFocus = null;
function openModal() {
 lastFocus = document.activeElement; $('modal').classList.remove('hidden');
 const pin = $('report-pin');
 pin.querySelector('[value=gps]').disabled = !lastGPS; pin.querySelector('[value=end]').disabled = !state.end; pin.querySelector('[value=start]').disabled = !state.start;
 if (pin.selectedOptions[0]?.disabled) pin.value = map ? 'center' : 'none';
 $('where').focus();
}
function closeModal() { if ($('modal').classList.contains('hidden')) return; $('modal').classList.add('hidden'); lastFocus?.focus(); }
$('modal').addEventListener('keydown', e => {
 if (e.key === 'Escape') { e.preventDefault(); closeModal(); return; }
 if (e.key !== 'Tab') return;
 const f = qs('button,input,select,textarea', $('modal')).filter(x => !x.disabled && x.offsetParent !== null); if (!f.length) return;
 const first = f[0], last = f[f.length - 1];
 if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
 else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
});
$('report').addEventListener('click', openModal); $('new-report').addEventListener('click', openModal);
$('close-modal').addEventListener('click', closeModal); $('cancel-report').addEventListener('click', closeModal);
$('modal').addEventListener('click', e => { if (e.target === $('modal')) closeModal(); });
function fieldError(el, msg) {
 el.setAttribute('aria-invalid', msg ? 'true' : 'false');
 if (el.id === 'description') { $('description-error').textContent = msg || ''; $('description-error').classList.toggle('hidden', !msg); }
 return !msg;
}
const validators = {
 where: v => v.trim().length >= 3 ? '' : 'Enter where the obstacle is (at least 3 characters).',
 description: v => v.trim().length >= 10 ? '' : 'Describe what you noticed in at least 10 characters.',
};
Object.keys(validators).forEach(id => {
 $(id).addEventListener('blur', () => fieldError($(id), validators[id]($(id).value)));
 $(id).addEventListener('input', () => { if ($(id).getAttribute('aria-invalid') === 'true' && !validators[id]($(id).value)) fieldError($(id), ''); });
});
function reportPosition() {
 const v = $('report-pin').value;
 const p = v === 'center' && map ? (c => ({lat: c.lat, lng: c.lng}))(map.getCenter()) : v === 'gps' ? lastGPS : v === 'end' ? state.end : v === 'start' ? state.start : null;
 return p && inSG(p) ? {lat: Number(p.lat.toFixed(6)), lng: Number(p.lng.toFixed(6))} : null;
}
$('report-form').addEventListener('submit', async e => {
 e.preventDefault();
 const bad = Object.keys(validators).filter(id => !fieldError($(id), validators[id]($(id).value)));
 if (bad.length) { $(bad[0]).focus(); if (bad.includes('where')) toast(validators.where('')); return; }
 const pos = reportPosition();
 if ($('report-pin').value !== 'none' && !pos) toast('Map position is outside Singapore, so it wasn’t attached.');
 const payload = {location: $('where').value.trim(), category: $('category').value, description: $('description').value.trim(), ...(pos || {})};
 const btn = $('submit-report'); btn.disabled = true; btn.setAttribute('aria-busy', 'true');
 try {
  await reportStore.add(payload);
  $('report-form').reset(); closeModal(); changePage('reports', false); toast('Demo report saved on this device only. It isn’t shared with anyone.');
 } catch (err) { toast(err.message); alertSR('Demo report not saved. ' + err.message); }
 finally { btn.disabled = false; btn.removeAttribute('aria-busy'); }
});
async function loadReports() {
 const list = $('report-list');
 if (!list.children.length) list.innerHTML = '<div class="skeleton"></div>';
 try {
  state.reports = await reportStore.list();
  $('report-count').textContent = state.reports.length;
  const STATUS = {local_demo: 'Local demo', unverified: 'Unverified', under_review: 'Under review', resolved: 'Reported resolved'};
  list.innerHTML = state.reports.length ? state.reports.map(x => '<div class="item"><div><strong>' + esc(x.category) + '</strong><p>' + esc(x.location) + ' · ' + esc(new Date(x.created_at * 1000).toLocaleDateString('en-SG')) + '</p><p class="muted">' + esc(x.description) + '</p></div><div class="actions"><span class="flag">' + esc(STATUS[x.status] || 'Unverified') + '</span>' +
   (Number.isFinite(x.lat) ? '<button type="button" class="btn" data-show="' + esc(x.id) + '" aria-label="Show ' + esc(x.category) + ' demo report on the map">Map</button>' : '') +
   '<button type="button" class="btn" data-delete="' + esc(x.id) + '" aria-label="Delete ' + esc(x.category) + ' demo report">Delete</button></div></div>').join('')
   : '<p class="notice">No demo reports yet. Use the warning button on the map to try reporting an obstacle. Reports stay on this device.</p>';
  qs('[data-delete]', list).forEach(b => b.addEventListener('click', async () => { await reportStore.remove(b.dataset.delete); toast('Demo report deleted.'); await loadReports(); $('reports-heading').focus(); }));
  qs('[data-show]', list).forEach(b => b.addEventListener('click', () => {
   const r = state.reports.find(x => x.id === b.dataset.show); if (!r || !map) return;
   setSheet('peek'); map.easeTo({center: [r.lng, r.lat], zoom: 17, duration: reducedMotion ? 0 : 500});
  }));
  drawReports();
 } catch (e) { list.innerHTML = '<p class="callout">Couldn’t load reports: ' + esc(e.message) + ' <button type="button" class="btn" id="retry-reports">Try again</button></p>'; $('retry-reports').addEventListener('click', loadReports); }
}

/* ------------------------------------------------------------ layers menu, keyboard, connectivity */
$('layers').addEventListener('click', () => { const m = $('layer-menu'), open = m.classList.toggle('hidden'); $('layers').setAttribute('aria-expanded', String(!open)); if (!open) $('provider-' + state.mapStyle).focus(); });
['liberty', 'positron', 'onemap'].forEach(s => $('provider-' + s).addEventListener('click', () => selectStyle(s)));
$('show-reports').checked = state.showReports;
$('show-reports').addEventListener('change', e => { state.showReports = e.target.checked; save(); drawReports(); });
document.addEventListener('keydown', e => {
 if (e.key === 'Escape' && !$('layer-menu').classList.contains('hidden')) { $('layer-menu').classList.add('hidden'); $('layers').setAttribute('aria-expanded', 'false'); $('layers').focus(); }
});
document.addEventListener('click', e => { if (!e.target.closest('#layer-menu,#layers')) { $('layer-menu').classList.add('hidden'); $('layers').setAttribute('aria-expanded', 'false'); } });
function connectivity() { $('offline-banner').classList.toggle('hidden', navigator.onLine); }
addEventListener('online', () => { connectivity(); toast('Back online.'); }); addEventListener('offline', connectivity);

/* ------------------------------------------------------------ start */
async function startup() {
 ['liberty', 'positron', 'onemap'].forEach(s => $('provider-' + s).setAttribute('aria-pressed', String(s === state.mapStyle)));
 connectivity(); renderPrefs(); setupMap(); renderRoutes(); refreshJourneyRoute(); setSheet('peek');
 loadReports();
}
window.__pathway = {state, getMap: () => map}; // read-only hook for automated tests
startup();
})();
