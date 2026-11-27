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
// Grouped by what each preference actually does, so the status is stated once per group (not under every chip).
const PREF_GROUPS = [
 {id: 'route', status: 'applied', key: 'Changes routes', title: 'Route suggestions', desc: 'These change which route Pathway suggests.', items: [
  ['stepfree', 'Wheelchair-profile routing'], ['avoidstairs', 'Avoid stairs'], ['lifts', 'Prefer lifts'], ['shorter', 'Shorter distance'], ['simpler', 'Fewer turns']]},
 {id: 'display', status: 'display', key: 'Changes display', title: 'Display and alerts', desc: 'These change how information is shown or announced.', collapsed: true, items: [
  ['spoken', 'Spoken updates'], ['simple', 'Simpler instructions'], ['large', 'Larger text'], ['contrast', 'High contrast'], ['vibrate', 'Vibration'], ['visual', 'Visual-only alerts']]},
 {id: 'data', status: 'data', key: 'Not applied yet', title: 'Not available yet', desc: 'Pathway has no reliable Singapore data for these, so they can’t change routes yet. You can still mark them so the app reminds you they are unknown.', collapsed: true, items: [
  ['ramps', 'Ramps'], ['crossings', 'Accessible crossings'], ['slopes', 'Gentle slopes and kerbs'], ['shelter', 'Sheltered walkways'], ['rest', 'Rest stops and seating'], ['weather', 'Less weather exposure']]},
];
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
 prefs: {stepfree: true, lifts: true}, access: {}, saved: [], reports: [], mapStyle: 'onemap', mapStyleChosen: false, showReports: true, audioMode: false,
 start: null, end: null, routes: [], selected: 0, planning: false, status: null,
};
try {
 const v3 = JSON.parse(localStorage.getItem('pathway-v3') || 'null');
 // OneMap is the default (fastest in Singapore); an earlier saved style is only kept if the person picked it themselves.
 if (v3) Object.assign(state, {prefs: v3.prefs || state.prefs, access: v3.access || {}, saved: v3.saved || [], mapStyle: v3.mapStyleChosen && v3.mapStyle ? v3.mapStyle : 'onemap', mapStyleChosen: !!v3.mapStyleChosen, showReports: v3.showReports !== false, audioMode: !!v3.audioMode});
 else if (localStorage.getItem('pathway-v2')) {
  const v2 = JSON.parse(localStorage.getItem('pathway-v2') || '{}'); // migrate earlier version
  const p = v2.preferences || {}, a = v2.access || {};
  state.saved = v2.saved || [];
  state.prefs = {stepfree: p.stepfree ?? true, lifts: p.lifts ?? true, shelter: !!p.shelter, rest: !!p.rest, large: !!(v2.large || a.lowvision), contrast: !!v2.contrast, spoken: !!a.blind, simple: !!a.cognitive};
  state.access = {blind: !!a.blind, lowvision: !!a.lowvision, mobility: !!a.mobility, hearing: !!a.hearing, cognitive: !!a.cognitive};
 }
} catch { /* storage unavailable: defaults */ }
const save = () => { try { localStorage.setItem('pathway-v3', JSON.stringify({prefs: state.prefs, access: state.access, saved: state.saved, mapStyle: state.mapStyle, mapStyleChosen: state.mapStyleChosen, showReports: state.showReports, audioMode: state.audioMode})); } catch {} };

/* ------------------------------------------------------------ feedback */
let toastTimer;
function toast(text, silent = false) { const t = $('toast'); t.setAttribute('aria-live', silent ? 'off' : 'polite'); t.textContent = text; t.classList.add('show'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 4200); }
function alertSR(text) { const a = $('sr-alert'); a.textContent = ''; setTimeout(() => { a.textContent = text; }, 50); }
const A = window.PathwayAudio;
const guide = {active: false, paused: false, tracker: null, wake: null, resumeOnVisible: false, waitingAnnounced: false};
const autoSpeak = () => state.prefs.spoken ?? state.audioMode; // audio mode speaks by default unless switched off
const speaker = new A.Speaker({polite: $('guide-live'), assertive: $('sr-alert'), synth: 'speechSynthesis' in window ? window.speechSynthesis : null,
 settings: () => ({auto: !!autoSpeak(), target: state.prefs.voiceTarget || 'voice', rate: Number(state.prefs.rate || 1), paused: guide.paused})});
// notify: speak (if automatic speech is on) or, otherwise, hand the text to screen readers — never both.
function notify(text, opts = {}) { const r = speaker.say(text, opts); if (r === 'silent') speaker.announce(text, opts.priority === 'high'); return r; }
function speak(text, force = false) { return speaker.say(text, {force, key: force ? 'f' + Date.now() : text}); }
// Pathway's own voice only (screen-reader users already hear role=status updates for these).
function voiceOnly(text) { if (speaker.channel === 'voice' && autoSpeak() && !guide.paused) speaker.say(text, {key: text, gap: 3000}); }
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
let map = null, markerA = null, markerB = null, gpsMarker = null, mapInits = 0;
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
/* The map library (~210 KB compressed) is loaded lazily so search and planning never wait for it. */
const MAPLIBRE = 'vendor/maplibre-gl-4.7.1/maplibre-gl';
let mapLibPromise = null, mapRequested = false;
function loadMapLibrary() {
 if (window.maplibregl) return Promise.resolve();
 if (mapLibPromise) return mapLibPromise;
 mapLibPromise = new Promise((resolve, reject) => {
  const css = document.createElement('link'); css.rel = 'stylesheet'; css.href = MAPLIBRE + '.css'; document.head.appendChild(css);
  const js = document.createElement('script'); js.src = MAPLIBRE + '.js'; js.async = true;
  js.onload = () => window.maplibregl ? resolve() : reject(Error('Map library missing'));
  js.onerror = () => { mapLibPromise = null; js.remove(); reject(Error('Map library failed to download')); };
  document.head.appendChild(js);
 });
 return mapLibPromise;
}
async function ensureMap() {
 if (map || mapRequested) return; mapRequested = true;
 mapLoading('Loading map… You can search and plan routes now.');
 try { await loadMapLibrary(); setupMap(); }
 catch { mapRequested = false; mapLoading('The map couldn’t download. Search, routes and directions still work.', true); }
}
$('map-retry').addEventListener('click', () => {
 if (!map) return ensureMap();
 mapHasRendered = false;mapLoading('Retrying map tiles…');
 map.setStyle(STYLES[state.mapStyle], {diff: false});
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
  const mobile = matchMedia('(max-width: 700px)').matches; mapInits++;
  map = new maplibregl.Map({container: 'map', style: STYLES[state.mapStyle] || STYLES.liberty, center: [103.8318, 1.3046], zoom: mobile ? 12.5 : 13.5,
   minZoom: 10, maxZoom: 19, maxBounds: [[103.3, 1.0], [104.5, 1.7]], attributionControl: {compact: true}, dragRotate: false, pitchWithRotate: false,
   pixelRatio: Math.min(window.devicePixelRatio || 1, 2), // crisp route lines without 3x canvas cost
   fadeDuration: 0, renderWorldCopies: false, maxTileCacheSize: mobile ? 35 : 60});
 } catch (e) { clearTimeout(mapLoadTimer); $('map').innerHTML = '<div class="map-fallback"><p>This browser can’t display the interactive map (WebGL unavailable). Directions are still listed as text.</p></div>'; mapLoading('Map rendering is unavailable in this browser. Text directions remain available.', false); map = null; return; }
 map.touchZoomRotate.disableRotation();
 if (matchMedia('(min-width: 600px)').matches) map.addControl(new maplibregl.NavigationControl({showCompass: false}), 'top-right');
 map.addControl(new maplibregl.ScaleControl({unit: 'metric'}), 'bottom-left');
 map.on('style.load', addOverlays);
 map.on('load', () => { mapReady(); drawMarkers(); if (lastGPS) gpsUpdate({coords: {latitude: lastGPS.lat, longitude: lastGPS.lng, accuracy: lastGPS.accuracy}}); fitView(); });
 map.on('idle', () => { if (map && map.isStyleLoaded()) mapReady(); });
 map.on('error', e => { if (e && e.error) console.warn('Map:', e.error.message); });
 map.getCanvas().setAttribute('aria-label', 'Interactive map. Use arrow keys to pan and plus or minus to zoom.');
 map.on('click', 'reports-circle', e => {
  const f = e.features && e.features[0]; if (!f) return;
  const el = document.createElement('div');
  const h = document.createElement('strong'); h.textContent = f.properties.category;
  const flag = document.createElement('p'); flag.textContent = 'Local demo report (this device only)'; flag.className = 'popup-flag';
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
 state.mapStyle = style; state.mapStyleChosen = true; save();
 ['liberty', 'positron', 'onemap'].forEach(s => $('provider-' + s).setAttribute('aria-pressed', String(s === style)));
 if (map) { mapHasRendered = false; mapLoading('Loading '+(style === 'onemap' ? 'OneMap' : 'map')+' tiles…'); clearTimeout(mapLoadTimer);mapLoadTimer=setTimeout(mapTimeout,9000);map.setStyle(STYLES[style], {diff: false}); } // full reload fires style.load, which re-adds the route and report layers
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
  const seq = ++c.seq; input.setAttribute('aria-busy', 'true');
  try {
   const data = await P.search(q);
   if (seq !== c.seq) return;
   c.items = data.results || []; c.active = -1; render();
   $('address-status').textContent = c.items.length ? plural(c.items.length, 'suggestion', 'suggestions') + ' below the field. Use the down arrow key, or swipe right with a screen reader, to review them.' : 'No matches found. Try a six-digit postal code or a building name.';
  } catch (e) { if (seq !== c.seq) return; close(); $('address-status').textContent = 'Address search unavailable: ' + e.message; }
  finally { if (seq === c.seq) input.removeAttribute('aria-busy'); }
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
 voiceOnly($('address-status').textContent);
 updateSummary();
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
  notify(A.compareSummary(state.routes, state.selected, recommendIndex(state.routes))); buzz(60);
  if (!matchMedia('(min-width: 600px)').matches) setSheet('peek');
 } catch (e) {
  state.routes = [illustrative()]; state.selected = 0;
  toast('Routing unavailable: ' + e.message, true); notify('Routing unavailable. ' + e.message + ' A straight-line illustration is shown instead; it is not a walking route.', {priority: 'high', key: 'route-fail'});
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
  const tag = state.routes.length > 1 && i === rec ? '<span class="tag">' + (physical ? 'Best match' : 'Fastest') + '</span>' : '';
  const warn = (r.warnings || []).map(w => '<div class="warn">' + esc(w) + '</div>').join('');
  const name = A.routeSummary(r, i) + (tag ? ' ' + (physical ? 'Best match for your needs.' : 'Fastest.') : '') + ' ' + (r.warnings || []).join(' ') + (r.illustrative ? '' : ' Not verified as accessible.');
  return '<button type="button" class="route-card" data-route="' + i + '" aria-pressed="' + (i === state.selected) + '" aria-label="' + esc(name) + '">' +
   '<span class="top"><span class="label">' + esc(r.label) + '<span class="selected-mark" aria-hidden="true">✓ Selected</span></span><span class="time">' + (r.illustrative ? '—' : esc(fmtTime(r.duration_s))) + '</span></span>' +
   '<span class="meta">' + meta.map(m => '<span>' + esc(m) + '</span>').join('') + '</span>' +
   (r.illustrative ? '' : '<span class="meta note"><span>' + esc(r.note) + ' Stairs and lifts counted from map data.</span></span>') + tag + warn + '</button>';
 }).join('');
 qs('[data-route]', box).forEach(b => b.addEventListener('click', () => {
  state.selected = Number(b.dataset.route); refreshJourneyRoute(); renderRoutes(); drawRoutes();
  const r = state.routes[state.selected]; notify('Selected. ' + A.routeSummary(r), {key: 'sel' + Date.now()});
 }));
 renderDetails();
}
function renderCta() {
 const ready = state.routes.length && !state.routes[state.selected]?.illustrative;
 $('plan').classList.toggle('hidden', !!ready); $('cta-start').classList.toggle('hidden', !ready);
 $('cta-start').disabled = guide.active;
 // Nothing to plan until both places are chosen; keeps the collapsed sheet clean.
 $('plan').parentElement.classList.toggle('hidden', !ready && !(state.start && state.end));
 $('safety').classList.toggle('hidden', !state.routes.length); // the verification note belongs with a route
}
function renderDetails() {
 renderCta();
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
 speak(A.routeSummary(r) + ' Accessibility is not verified. ' + r.steps.map((s, i) => 'Step ' + (i + 1) + '. ' + A.stepText(s, !!state.prefs.simple)).join(' '), true);
});

/* ------------------------------------------------------------ journey guidance (GPS + audio) */
let watchId = null, lastGPS = null;
function refreshJourneyRoute() {
 const r = state.routes[state.selected];
 guide.tracker = r && !r.illustrative && r.geometry.length > 1 ? new A.GuidanceTracker(r, {simple: !!state.prefs.simple}) : null;
 updateSummary(); updateJourney();
}
function updateSummary() {
 const r = state.routes[state.selected];
 $('sum-from').textContent = state.start ? state.start.name : 'Not chosen';
 $('sum-to').textContent = state.end ? state.end.name : 'Not chosen';
 $('sum-route').textContent = r ? (r.illustrative ? 'No walking route available' : r.label + ', about ' + fmtTime(r.duration_s) + ', ' + fmtDist(r.distance_m)) : 'None yet';
}
function highlightStep(i) { qs('#steps li').forEach(li => li.classList.toggle('current', Number(li.dataset.step) === i)); }
function updateJourney() {
 const badge = $('journey-badge'), t = guide.tracker;
 const set = (label, text, pct = 0, tone = '') => {
  badge.textContent = label; badge.className = 'flag ' + tone; $('journey-message').textContent = text;
  $('journey-progress').setAttribute('aria-valuenow', String(Math.round(pct))); $('journey-fill').style.width = pct + '%';
 };
 $('guide-start').disabled = guide.active; $('guide-stop').disabled = !guide.active; $('guide-pause').disabled = !guide.active; $('cta-start').disabled = guide.active;
 $('journey-recalculate').disabled = !(lastGPS && state.end);
 if (!t) {
  $('latest-instruction').textContent = state.routes[0]?.illustrative ? 'No walking route is available right now. Try again in a moment.' : 'Choose a start and destination to hear the route.';
  $('journey-distance').textContent = 'Remaining: —'; $('journey-accuracy').textContent = 'GPS accuracy: —';
  return set('NOT STARTED', 'Load a walking route, then choose Start guidance.');
 }
 if (!lastGPS || (!guide.active && watchId === null && !lastGPS)) {
  $('latest-instruction').textContent = 'First: ' + t.firstInstruction();
  $('journey-distance').textContent = 'Remaining: ' + fmtDist(t.length); $('journey-accuracy').textContent = 'GPS accuracy: —';
  return set(guide.active ? 'WAITING FOR GPS' : 'NOT STARTED', guide.active ? 'Waiting for your position. This can take a little while outdoors.' : 'Choose Start guidance to follow your approximate progress with GPS.');
 }
 const v = t.evaluate(lastGPS);
 $('latest-instruction').textContent = v.latest;
 $('journey-distance').textContent = 'Remaining: about ' + fmtDist(v.remaining);
 $('journey-accuracy').textContent = 'GPS accuracy: ±' + Math.round(v.accuracy) + ' m';
 set(v.badge, v.message, v.pct, v.tone);
 if (!guide.active) return;
 highlightStep(v.stepIdx);
 for (const e of v.events) { notify(e.text, {priority: e.priority || 'normal', key: e.key}); if (e.vibrate) buzz(e.vibrate); }
}
function gpsUpdate(p) {
 const lat = p.coords.latitude, lng = p.coords.longitude; if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
 lastGPS = {lat, lng, accuracy: Math.round(p.coords.accuracy || 0)}; guide.waitingAnnounced = false;
 if (map) {
  if (!gpsMarker) { const el = document.createElement('div'); el.className = 'gps-dot'; el.setAttribute('role', 'img'); el.setAttribute('aria-label', 'Your approximate location'); gpsMarker = new maplibregl.Marker({element: el}); }
  gpsMarker.setLngLat([lng, lat]).addTo(map);
  if (guide.active) map.easeTo({center: [lng, lat], duration: reducedMotion ? 0 : 400});
 }
 $('gps-status').textContent = (guide.active ? 'GPS on' : 'Last GPS fix') + ' · accuracy ±' + lastGPS.accuracy + ' m. Location is never stored or sent anywhere.';
 updateJourney();
}
async function keepAwake(on) {
 try {
  if (on && state.prefs.wake !== false && 'wakeLock' in navigator) guide.wake = await navigator.wakeLock.request('screen');
  else if (!on && guide.wake) { await guide.wake.release(); guide.wake = null; }
 } catch { guide.wake = null; }
}
function watchGPS() {
 watchId = navigator.geolocation.watchPosition(gpsUpdate, err => {
  const msg = gpsErrorText(err);
  $('gps-status').textContent = msg;
  // Only a refused permission ends guidance; "unavailable" and "timeout" are often temporary (indoors, under cover).
  if (err && err.code !== 1) { if (!guide.waitingAnnounced) { guide.waitingAnnounced = true; notify('GPS is unavailable right now. Pathway will keep trying. ' + msg, {key: 'gps-wait', gap: 60000}); } return; }
  stopGuidance('Guidance stopped. ' + msg);
 }, {enableHighAccuracy: true, maximumAge: 3000, timeout: 20000});
}
function setFollowButton(on) { const f = $('follow-gps'); f.setAttribute('aria-pressed', String(on)); f.setAttribute('aria-label', on ? 'Stop guidance' : 'Start guidance and follow my location'); }
function startGuidance() {
 if (!guide.tracker) { notify('Choose a start and a destination first, then start guidance.', {force: true}); (state.start ? $('end-search') : $('start-search')).focus(); return; }
 if (!navigator.geolocation || !window.isSecureContext) { const m = gpsErrorText(null); $('gps-status').textContent = m; notify(m, {force: true, priority: 'high'}); return; }
 const r = state.routes[state.selected];
 guide.active = true; guide.paused = false; guide.waitingAnnounced = false; guide.tracker.reset(); setPause(false);
 notify('Guidance started. ' + A.routeSummary(r) + ' First: ' + guide.tracker.firstInstruction() +
  ' Pathway uses approximate GPS and can’t detect crossings, obstacles or entrances.', {key: 'start' + Date.now()});
 watchGPS(); keepAwake(true); setFollowButton(true);
 $('gps-status').textContent = 'Asking for your location…';
 updateJourney();
}
function stopGuidance(message) {
 if (watchId !== null) navigator.geolocation.clearWatch(watchId);
 const was = guide.active; watchId = null; guide.active = false; guide.resumeOnVisible = false; guide.paused = false;
 keepAwake(false); speaker.stop(); setFollowButton(false); setPause(false); highlightStep(-1);
 $('gps-status').textContent = message || 'GPS is off. Location is never stored.';
 if (was) notify(message || 'Guidance stopped.', {force: true, key: 'stop' + Date.now()});
 updateJourney();
}
function setPause(on) {
 guide.paused = on; const b = $('guide-pause');
 b.setAttribute('aria-pressed', String(on)); b.querySelector('span').textContent = on ? 'Paused' : 'Pause'; // name stays "Pause voice"; aria-pressed carries the state
 b.querySelector('use').setAttribute('href', on ? '#i-play' : '#i-pause');
}
$('guide-start').addEventListener('click', startGuidance);
$('cta-start').addEventListener('click', () => { startGuidance(); if (!matchMedia('(min-width: 900px)').matches) setSheet('half'); $('journey-preview').scrollIntoView({block: 'start', behavior: reducedMotion ? 'auto' : 'smooth'}); });
$('guide-stop').addEventListener('click', () => stopGuidance());
$('guide-pause').addEventListener('click', () => {
 const on = !guide.paused; setPause(on);
 if (on) { speaker.stop(); speaker.announce('Voice paused. GPS guidance continues on screen.'); }
 else speaker.say('Voice resumed.', {force: true, key: 'resume' + Date.now()});
});
$('follow-gps').addEventListener('click', () => {
 if (guide.active) return stopGuidance();
 if (!guide.tracker) { toast('Load a route first. Showing your location.'); return $('locate').click(); }
 startGuidance();
});
$('locate').addEventListener('click', async () => {
 try { const p = await getPosition(); gpsUpdate(p); if (map) map.easeTo({center: [p.coords.longitude, p.coords.latitude], zoom: 16, duration: reducedMotion ? 0 : 500}); }
 catch (e) { const t = gpsErrorText(e); $('gps-status').textContent = t; toast(t); }
});
// Browsers suspend GPS in the background: pause cleanly and resume when Pathway is visible again.
document.addEventListener('visibilitychange', () => {
 if (document.hidden && guide.active && watchId !== null) { navigator.geolocation.clearWatch(watchId); watchId = null; guide.resumeOnVisible = true; }
 else if (!document.hidden && guide.resumeOnVisible) { guide.resumeOnVisible = false; watchGPS(); keepAwake(true); notify('Guidance resumed. Waiting for an updated GPS position.', {key: 'resumed' + Date.now()}); }
});
$('journey-announce').addEventListener('click', () => {
 const t = guide.tracker;
 if (!t) return speak('No route loaded yet. Choose a start and a destination.', true);
 const parts = [$('latest-instruction').textContent];
 if (lastGPS && guide.active) parts.push($('journey-distance').textContent.replace('Remaining:', 'Remaining') + '.', $('journey-badge').textContent.toLowerCase() === 'low gps accuracy' ? 'GPS accuracy is low.' : '');
 else parts.push('Total distance ' + A.spokenDistance(t.length) + '.');
 speak(parts.filter(Boolean).join(' '), true);
});
$('where-am-i').addEventListener('click', async () => {
 const b = $('where-am-i'); b.setAttribute('aria-busy', 'true');
 try {
  const p = await getPosition({maximumAge: 5000});
  gpsUpdate(p);
  const acc = Math.round(p.coords.accuracy || 0);
  let place = '';
  try { place = await P.reverse(p.coords.latitude, p.coords.longitude); } catch { place = ''; }
  speak((place ? 'Approximately near ' + place + '. ' : 'Your position was found, but no nearby place name is available. ') + 'GPS accuracy about ' + A.spokenDistance(acc) + '. Place names come from OpenStreetMap and may be imprecise.', true);
 } catch (e) { const t = gpsErrorText(e); $('gps-status').textContent = t; speak(t, true); }
 finally { b.removeAttribute('aria-busy'); }
});
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
  toast('Rerouted from your location. Accessibility is still unverified.', true);
  notify('Rerouted from your location. ' + A.routeSummary(state.routes[state.selected]) + ' Next: ' + guide.tracker.firstInstruction(), {key: 'reroute' + Date.now()});
 } catch (e) { Object.assign(state, {start: prev.start, routes: prev.routes, selected: prev.selected}); $('start-search').value = prev.value; toast('Rerouting failed: ' + e.message, true); notify('Rerouting failed. ' + e.message, {priority: 'high', key: 'reroute-fail'}); }
 finally { updateJourney(); }
});

/* ------------------------------------------------------------ audio mode + voice settings */
function setAudioMode(on, {announce = true} = {}) {
 state.audioMode = on; save();
 app.classList.toggle('audio-mode', on); app.classList.remove('map-visible');
 $('audio-mode').setAttribute('aria-pressed', String(on));
 syncVoiceSettings();
 if (on) { setSheet('full'); if (announce) notify('Audio mode on. The map is hidden. Search for a start and destination, then choose Start guidance.', {key: 'am' + Date.now()}); }
 else { ensureMap(); setSheet(state.routes.length ? 'half' : 'peek'); if (map) setTimeout(() => map.resize(), 60); if (announce) speaker.announce('Audio mode off. Map view restored.'); }
}
$('audio-mode').addEventListener('click', () => setAudioMode(!state.audioMode));
$('show-map').addEventListener('click', () => {
 const on = !app.classList.contains('map-visible'); app.classList.toggle('map-visible', on);
 $('show-map').lastChild.textContent = on ? 'Hide map' : 'Show map';
 if (on) { ensureMap(); if (map) setTimeout(() => { map.resize(); fitView(); }, 60); }
});
function syncVoiceSettings() {
 $('set-auto').checked = !!autoSpeak();
 $('set-target-' + ((state.prefs.voiceTarget || 'voice') === 'voice' ? 'voice' : 'sr')).checked = true;
 $('set-rate').value = String(state.prefs.rate || 1);
 $('set-vibrate').checked = !!state.prefs.vibrate; $('set-wake').checked = state.prefs.wake !== false;
 if (!('speechSynthesis' in window)) { $('set-target-voice').disabled = true; $('set-target-sr').checked = true; }
}
$('set-auto').addEventListener('change', e => { togglePref('spoken', e.target.checked); });
qs('[name=voice-target]').forEach(r => r.addEventListener('change', () => { state.prefs.voiceTarget = r.value; speaker.stop(); save(); }));
$('set-rate').addEventListener('change', e => { state.prefs.rate = Number(e.target.value); save(); speak('This is the new speaking speed.', true); });
$('set-vibrate').addEventListener('change', e => { togglePref('vibrate', e.target.checked); if (e.target.checked) buzz(60); });
$('set-wake').addEventListener('change', e => { state.prefs.wake = e.target.checked; save(); if (guide.active) keepAwake(e.target.checked); });

/* ------------------------------------------------------------ experimental: read a sign (on-device OCR) */
let visionLib = null, visionRun = 0;
function loadVision() {
 if (window.PathwayVision) return Promise.resolve();
 return visionLib || (visionLib = new Promise((res, rej) => { const s = document.createElement('script'); s.src = 'vision.js'; s.onload = res; s.onerror = () => { visionLib = null; rej(Error('The camera reader could not be downloaded.')); }; document.head.appendChild(s); }));
}
$('vision-take').addEventListener('click', () => { $('vision-input').value = ''; $('vision-input').click(); });
$('vision-cancel').addEventListener('click', async () => {
 visionRun++; $('vision-cancel').hidden = true; $('vision-take').disabled = false;
 if (window.PathwayVision) await PathwayVision.stop();
 $('vision-status').textContent = 'Stopped. Nothing was saved.';
});
$('vision-input').addEventListener('change', async e => {
 const file = e.target.files && e.target.files[0]; e.target.value = '';
 if (!file) return;
 const run = ++visionRun, status = $('vision-status'), out = $('vision-result');
 $('vision-take').disabled = true; $('vision-cancel').hidden = false; out.hidden = true;
 status.textContent = 'Reading text on this device…';
 let lastPct = -1;
 const progress = m => {
  if (run !== visionRun || !m || typeof m.progress !== 'number') return;
  const pct = Math.floor(m.progress * 4) * 25; // announce in 25% steps only
  if (pct === lastPct) return; lastPct = pct;
  status.textContent = (/recogniz/.test(m.status) ? 'Reading text' : 'Preparing the text reader (first use downloads about 6 MB)') + '… ' + pct + '%';
 };
 try {
  await loadVision();
  // A stalled download or an engine error inside the worker must never leave the person waiting forever.
  const r = await Promise.race([PathwayVision.readText(file, progress), new Promise((_, rej) => setTimeout(() => rej(Error('Reading took too long.')), 120000))]);
  if (run !== visionRun) return;
  const msg = r.text ? 'Text found. This may be incomplete or wrong: ' + r.text + (r.confidence < 60 ? '. Low confidence; try again closer, steadier, or with more light.' : '.')
   : 'No readable text found. Try moving closer, holding the phone steady, and making sure there is enough light.';
  out.textContent = msg; out.hidden = false; status.textContent = 'Done. The photo was not saved.';
  out.focus(); speak(msg, true);
 } catch (err) {
  if (run !== visionRun) return;
  status.textContent = 'The text reader isn’t available: ' + (err.message || 'unknown error') + ' It needs a recent browser with WebAssembly SIMD (for example iOS 16.4+ or Chrome 91+).';
 } finally { if (run === visionRun) { $('vision-take').disabled = false; $('vision-cancel').hidden = true; } }
});
addEventListener('pagehide', () => { if (window.PathwayVision) PathwayVision.stop(); });

/* ------------------------------------------------------------ needs & display */
function renderPrefs() {
 const openState = Object.fromEntries(qs('.pref-more').map(d => [d.dataset.group, d.open]));
 const unsupported = {vibrate: !navigator.vibrate && 'This browser can’t vibrate (iPhone browsers don’t support it).'};
 const chip = ([k, label]) => unsupported[k]
  ? '<button type="button" class="chip" data-pref="' + k + '" aria-disabled="true" aria-pressed="false" aria-describedby="pref-' + k + '-why">' + esc(label) + '</button><span class="visually-hidden" id="pref-' + k + '-why">' + esc(unsupported[k]) + '</span>'
  : '<button type="button" class="chip" data-pref="' + k + '" aria-pressed="' + !!state.prefs[k] + '">' + esc(label) + '</button>';
 const group = g => '<div class="pref-group" role="group" aria-labelledby="pg-' + g.id + ' pgd-' + g.id + '">' +
  (g.collapsed ? '' : '<h4 id="pg-' + g.id + '">' + esc(g.title) + ' <span class="status-key ' + g.status + '">' + esc(g.key) + '</span></h4>') +
  '<p class="group-desc" id="pgd-' + g.id + '">' + esc(g.desc) + '</p><div class="chips">' + g.items.map(chip).join('') + '</div></div>';
 $('pref-groups').innerHTML = PREF_GROUPS.map(g => !g.collapsed ? group(g) :
  '<details class="pref-more" data-group="' + g.id + '"' + (openState[g.id] ? ' open' : '') + '><summary><span id="pg-' + g.id + '">' + esc(g.title) +
  ' <span class="status-key ' + g.status + '">' + esc(g.key) + '</span></span></summary>' + group(g) + '</details>').join('');
 qs('[data-pref]').forEach(b => b.addEventListener('click', () => {
  if (b.getAttribute('aria-disabled') === 'true') return toast(unsupported[b.dataset.pref]);
  togglePref(b.dataset.pref);
 }));
 applyDisplay();
}
function togglePref(k, value) {
 state.prefs[k] = value ?? !state.prefs[k]; save();
 qs('[data-pref="' + k + '"]').forEach(b => b.setAttribute('aria-pressed', String(!!state.prefs[k])));
 applyDisplay();
 if (state.routes.length > 1 && ['stepfree', 'avoidstairs', 'shorter', 'simpler'].includes(k)) { state.selected = recommendIndex(state.routes); refreshJourneyRoute(); renderRoutes(); drawRoutes(false); }
 else if (k === 'simple') { renderDetails(); refreshJourneyRoute(); }
 syncVoiceSettings();
 if (k === 'lifts' && state.routes.length && !state.routes[0].illustrative) planRoutes();
}
function applyDisplay() {
 document.documentElement.classList.toggle('pw-large', !!state.prefs.large);
 document.documentElement.classList.toggle('pw-contrast', !!state.prefs.contrast);
 restyleMap();
 qs('[data-access]').forEach(b => b.setAttribute('aria-pressed', String(!!state.access[b.dataset.access])));
 const missing = PREF_GROUPS.find(g => g.id === 'data').items.filter(([k]) => state.prefs[k]).map(([, l]) => l.toLowerCase());
 $('accessibility-note').textContent = (missing.length ? 'Not applied yet, because reliable Singapore data isn’t connected: ' + missing.join(', ') + '. ' : '') +
  'Preferences never make a route verified-safe.' + (state.prefs.vibrate && !navigator.vibrate ? ' Vibration isn’t supported in this browser.' : '');
 if (map) setTimeout(() => map.resize(), 50);
}
qs('[data-access]').forEach(b => b.addEventListener('click', () => {
 const k = b.dataset.access; state.access[k] = !state.access[k];
 if (state.access[k]) PRESETS[k].forEach(p => { state.prefs[p] = true; });
 if (k === 'blind' && state.access[k] && !state.audioMode) setAudioMode(true, {announce: false});
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
 } catch (err) { toast(err.message, true); alertSR('Demo report not saved. ' + err.message); }
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
 if (state.audioMode || new URLSearchParams(location.search).get('mode') === 'audio') { state.audioMode = true; app.classList.add('audio-mode'); $('audio-mode').setAttribute('aria-pressed', 'true'); }
 connectivity(); renderPrefs(); syncVoiceSettings(); renderRoutes(); refreshJourneyRoute(); setSheet(state.audioMode ? 'full' : 'peek');
 // The planner is usable now; the map follows (skipped entirely in audio mode unless asked for).
 if (!state.audioMode) requestAnimationFrame(() => setTimeout(ensureMap, 0));
 registerServiceWorker();
 loadReports();
}
function registerServiceWorker() {
 if (!('serviceWorker' in navigator) || location.protocol !== 'https:' && location.hostname !== '127.0.0.1' && location.hostname !== 'localhost') return;
 // updateViaCache 'none': always check sw.js itself on the network, so a new deploy is picked up on the next visit.
 addEventListener('load', () => navigator.serviceWorker.register('sw.js', {updateViaCache: 'none'}).catch(() => {}));
}
window.__pathway = {state, getMap: () => map, mapInits: () => mapInits}; // read-only hook for automated tests
startup();
})();
