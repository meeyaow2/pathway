/* Pathway data providers — run entirely in the browser (GitHub Pages, no backend, no keys).
 *
 * Search:  Photon (komoot) — OpenStreetMap geocoder built for search-as-you-type. CORS: *.
 * Routing: Valhalla public server (FOSSGIS) — pedestrian costing, including the "wheelchair"
 *          pedestrian type, which avoids steps that are tagged in OpenStreetMap. CORS: *.
 *          Usage policy: max 1 request per second, no availability guarantee → requests are
 *          queued and spaced, and results cached.
 * Reports: LocalReportStore keeps demo reports in this browser only. A future backend can
 *          provide the same interface (list/add/remove) — see docs/future-backend.md.
 *
 * Nothing here certifies accessibility: every route carries accessibility_verified: false.
 */
(function (root) {
'use strict';
const SG = {latMin: 1.15, latMax: 1.48, lngMin: 103.59, lngMax: 104.1};
const CONFIG = {
 photon: 'https://photon.komoot.io/api/',
 nominatim: 'https://nominatim.openstreetmap.org/search', // backup: explicit searches only (policy: no autocomplete, max 1 req/s)
 valhalla: 'https://valhalla1.openstreetmap.de/route',
 trace: 'https://valhalla1.openstreetmap.de/trace_attributes',
 exits: 'data/mrt-exits.json', // official LTA MRT station exits (bundled snapshot)
 valhallaGapMs: 1100, // FOSSGIS policy: max 1 request/second
 timeoutMs: 20000,
};

class ProviderError extends Error {
 constructor(message, kind) { super(message); this.kind = kind || 'error'; }
}

async function getJSON(url, name, timeoutMs = CONFIG.timeoutMs, signal) {
 if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ProviderError('You’re offline. Reconnect to search and get routes.', 'offline');
 const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
 if (signal) { if (signal.aborted) ctrl.abort(); else signal.addEventListener('abort', () => ctrl.abort(), {once: true}); }
 let res;
 try { res = await fetch(url, {signal: ctrl.signal, headers: {Accept: 'application/json'}}); }
 catch (e) {
  if (signal && signal.aborted) throw new ProviderError('Cancelled.', 'aborted');
  throw new ProviderError(e.name === 'AbortError' ? name + ' took too long to respond. Please try again.' : name + ' is unreachable. Check your connection and try again.', 'network');
 }
 finally { clearTimeout(timer); }
 if (res.status === 429) throw new ProviderError(name + ' is busy (rate limit). Wait a few seconds and try again.', 'rate');
 let data = null;
 try { data = await res.json(); } catch { /* handled below */ }
 if (!res.ok) {
  if (res.status === 400 && data && /no.*(path|route)|unreachable|outside/i.test(JSON.stringify(data))) throw new ProviderError('No walking route was found between these points.', 'noroute');
  throw new ProviderError(name + ' returned an error (' + res.status + ').', 'http');
 }
 if (!data) throw new ProviderError(name + ' returned an unexpected response.', 'parse');
 return data;
}

const cache = new Map();
function cached(key, ttlMs, fn) {
 const hit = cache.get(key);
 if (hit && hit.expires > Date.now()) return hit.value;
 const value = fn().catch(e => { cache.delete(key); throw e; });
 cache.set(key, {value, expires: Date.now() + ttlMs});
 if (cache.size > 300) cache.delete(cache.keys().next().value);
 return value;
}

/* ---------------- search
 * 1. Local index of official MRT stations and exits (instant, works offline and when every service is down).
 * 2. Photon (OpenStreetMap) for as-you-type suggestions. After an error or rate limit it is paused with
 *    back-off (30 s, doubling to 5 min) so Pathway stops adding load to a struggling free service.
 * 3. Nominatim (OpenStreetMap Foundation) only when the person explicitly searches (Enter / Search key) and
 *    Photon failed or found nothing. Its usage policy forbids autocomplete and allows max 1 request/second.
 */
const APPROX_TYPES = /^(road|street|suburb|neighbourhood|quarter|city_district|district|city|county|state|locality|residential|place|highway)$/;
function normalisePhoton(data) {
 const out = [], seen = new Set();
 for (const f of (data && data.features) || []) {
  const p = f.properties || {};
  if (p.countrycode && p.countrycode !== 'SG') continue;
  const [lng, lat] = f.geometry.coordinates;
  if (!inSG({lat, lng})) continue;
  const street = [p.housenumber, p.street].filter(Boolean).join(' ');
  let postal = p.postcode || '', name = p.name || street || postal;
  if (/^\d{6}$/.test(name)) { postal = postal || name; name = 'Postal code ' + name; }
  const address = [street, p.district || p.city, ('Singapore ' + postal).trim()].filter(Boolean).join(', ');
  const key = name + '|' + lat.toFixed(4) + '|' + lng.toFixed(4);
  if (seen.has(key)) continue; seen.add(key);
  const approximate = !p.housenumber && !/^\d{6}$/.test(p.name || '') && (APPROX_TYPES.test(p.type || '') || APPROX_TYPES.test(p.osm_key || '') && p.osm_key !== 'railway');
  out.push({name, address, postal, lat, lng, approximate, source: 'photon'});
 }
 return out.slice(0, 8);
}
function normaliseNominatim(data) {
 const out = [];
 for (const d of Array.isArray(data) ? data : []) {
  const lat = Number(d.lat), lng = Number(d.lon), a = d.address || {};
  if (!inSG({lat, lng}) || (a.country_code && a.country_code !== 'sg')) continue;
  const street = [a.house_number, a.road].filter(Boolean).join(' ');
  const name = d.name || street || String(d.display_name || '').split(',')[0];
  const address = [street !== name ? street : '', a.suburb || a.city_district || a.neighbourhood, ('Singapore ' + (a.postcode || '')).trim()].filter(Boolean).join(', ');
  out.push({name, address, postal: a.postcode || '', lat, lng, approximate: APPROX_TYPES.test(d.addresstype || d.type || ''), source: 'nominatim'});
 }
 return out.slice(0, 8);
}

// Official MRT station exits (LTA). Loaded once, on first use.
let exitsPromise = null;
const exitNum = e => { const m = /(\d+)|([A-Z])$/i.exec(e); return m ? (m[1] ? Number(m[1]) : m[2].charCodeAt(0)) : 0; };
function loadExits() {
 if (!exitsPromise) exitsPromise = getJSON(CONFIG.exits, 'Station exit data', 15000).then(d => {
  const byStation = new Map();
  for (const [station, exit, lat, lng] of d.exits) {
   if (!byStation.has(station)) byStation.set(station, []);
   byStation.get(station).push({station, exit, lat, lng});
  }
  const stations = [...byStation].map(([name, exits]) => ({name, exits: exits.sort((a, b) => exitNum(a.exit) - exitNum(b.exit)),
   lat: exits.reduce((t, e) => t + e.lat, 0) / exits.length, lng: exits.reduce((t, e) => t + e.lng, 0) / exits.length}));
  return {meta: {source: d.source, licence: d.licence, updated: d.updated, note: d.note}, stations, byName: new Map(stations.map(s => [s.name.toLowerCase(), s]))};
 }).catch(e => { exitsPromise = null; throw e; });
 return exitsPromise;
}
const tokens = q => q.toLowerCase().replace(/\b(mrt|lrt|stn|station|exit)\b/g, ' ').replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(Boolean);
async function searchLocal(query) {
 const q = String(query || '').trim(); if (q.length < 3 || /^\d+$/.test(q)) return [];
 let data; try { data = await loadExits(); } catch { return []; }
 const words = tokens(q), exitWanted = /\bexit\s*([a-z]?\d+[a-z]?|[a-z])\b/i.exec(q);
 if (!words.length) return [];
 const hits = data.stations.filter(s => words.filter(w => !exitWanted || w !== exitWanted[1].toLowerCase()).every(w => s.name.toLowerCase().includes(w)))
  .sort((a, b) => a.name.length - b.name.length).slice(0, 3); // closest (shortest) name first: "Orchard MRT" before "Orchard Boulevard MRT"
 const out = [];
 for (const s of hits) {
  const ex = exitWanted && s.exits.find(e => e.exit.toLowerCase() === ('exit ' + exitWanted[1]).toLowerCase());
  if (ex) out.push({name: s.name + ', ' + ex.exit, address: 'Station exit · official LTA location', lat: ex.lat, lng: ex.lng, source: 'lta', station: s.name, exit: ex.exit});
  out.push({name: s.name, address: s.exits.length + ' exits · official LTA locations · you can pick an exit after choosing', lat: s.lat, lng: s.lng, source: 'lta', station: s.name});
 }
 return out;
}
function nearbyStations(point, radius = 250) {
 return loadExits().then(d => d.stations.filter(s => s.exits.some(e => metresApprox(point, e) <= radius))).catch(() => []);
}
function metresApprox(a, b) { const k = 111320, dx = (a.lng - b.lng) * k * Math.cos(a.lat * Math.PI / 180), dy = (a.lat - b.lat) * k; return Math.hypot(dx, dy); }

const photonState = {pausedUntil: 0, failures: 0};
const photonAvailable = () => Date.now() >= photonState.pausedUntil;
function photonFailed() { photonState.failures++; photonState.pausedUntil = Date.now() + Math.min(300000, 30000 * 2 ** (photonState.failures - 1)); }
function readSession(key) { try { const v = JSON.parse(sessionStorage.getItem(key) || 'null'); return v && v.exp > Date.now() ? v.data : null; } catch { return null; } }
function writeSession(key, data) { try { sessionStorage.setItem(key, JSON.stringify({exp: Date.now() + 30 * 60e3, data})); } catch {} }
function photon(q, signal) {
 const key = 'pw-s:' + q.toLowerCase(), hit = readSession(key);
 if (hit) return Promise.resolve(hit);
 const params = new URLSearchParams({q, limit: '10', lat: '1.3521', lon: '103.8198', lang: 'en', bbox: [SG.lngMin, SG.latMin, SG.lngMax, SG.latMax].join(',')});
 return cached('s:' + q.toLowerCase(), 10 * 60e3, async () => {
  const r = normalisePhoton(await getJSON(CONFIG.photon + '?' + params, 'Address search', 12000, signal));
  photonState.failures = 0; writeSession(key, r); return r;
 });
}
let lastNominatim = 0;
async function nominatim(q) {
 const key = 'pw-n:' + q.toLowerCase(), hit = readSession(key); if (hit) return hit;
 const wait = lastNominatim + 1100 - Date.now(); if (wait > 0) await new Promise(r => setTimeout(r, wait));
 lastNominatim = Date.now();
 const params = new URLSearchParams({q, format: 'jsonv2', addressdetails: '1', countrycodes: 'sg', limit: '8', 'accept-language': 'en',
  viewbox: [SG.lngMin, SG.latMax, SG.lngMax, SG.latMin].join(','), bounded: '1'});
 const r = normaliseNominatim(await getJSON(CONFIG.nominatim + '?' + params, 'Backup address search', 15000));
 writeSession(key, r); return r;
}
const merge = (a, b) => { const out = [...a]; for (const r of b) if (!out.some(o => metresApprox(o, r) < 30 && o.name.toLowerCase() === r.name.toLowerCase())) out.push(r); return out.slice(0, 8); };

/** mode 'suggest' (as you type) or 'submit' (explicit search). Never throws for provider failures: returns a status. */
async function search(query, {mode = 'suggest', signal} = {}) {
 const q = String(query || '').trim();
 if (q.length < 2 || q.length > 100) throw new ProviderError('Type at least 3 characters.', 'input');
 const local = await searchLocal(q);
 let primary = null, primaryError = null;
 if (photonAvailable()) {
  try { primary = await photon(q, signal); }
  catch (e) { if (e.kind === 'aborted') throw e; if (e.kind !== 'offline') photonFailed(); primaryError = e; }
 }
 if (primary && (primary.length || mode === 'suggest')) return {status: 'ok', provider: 'photon', results: merge(local, primary)};
 if (mode === 'suggest') return {status: 'degraded', provider: 'local', results: local,
  message: primaryError && primaryError.kind === 'offline' ? primaryError.message : 'Live suggestions are paused because the search service is busy. Press Enter to search with the backup service.'};
 try {
  const backup = await nominatim(q);
  return {status: backup.length || local.length ? 'fallback' : 'empty', provider: 'nominatim', results: merge(local, backup),
   message: primary ? '' : 'Results from the backup search (OpenStreetMap Nominatim).'};
 } catch (e) {
  return {status: local.length ? 'degraded' : 'unavailable', provider: 'local', results: local,
   message: e.kind === 'offline' ? e.message : 'Address search is temporarily unavailable. ' + (local.length ? 'Showing MRT stations only. ' : '') + 'Please try again in a minute, or search for an MRT station.'};
 }
}

/* Reverse geocoding for "Where am I?" — only on explicit request; the position is not stored. */
async function reverse(lat, lng) {
 if (!inSG({lat, lng})) throw new ProviderError('That position is outside Singapore.', 'input');
 const params = new URLSearchParams({lat: lat.toFixed(5), lon: lng.toFixed(5), lang: 'en', limit: '1'});
 const data = await getJSON(CONFIG.photon.replace(/api\/$/, 'reverse') + '?' + params, 'Place lookup', 12000);
 const p = (data.features && data.features[0] && data.features[0].properties) || {};
 const street = [p.housenumber, p.street].filter(Boolean).join(' ');
 return [p.name, street, p.district || p.locality].filter((x, i, a) => x && a.indexOf(x) === i).join(', ');
}

/* ---------------- routing */
function decodePolyline(str, precision = 5) {
 let index = 0, lat = 0, lng = 0; const points = [], factor = Math.pow(10, precision);
 while (index < str.length) {
  for (const axis of [0, 1]) {
   let b, shift = 0, result = 0;
   do { b = str.charCodeAt(index++) - 63; result |= (b & 31) << shift; shift += 5; } while (b >= 32);
   const delta = (result & 1) ? ~(result >> 1) : (result >> 1);
   if (axis === 0) lat += delta; else lng += delta;
  }
  points.push([lat / factor, lng / factor]);
 }
 return points;
}
const PROFILES = {
 wheelchair: {label: 'Wheelchair-profile route', note: 'Computed to avoid steps recorded in map data. Not verified as accessible.', costing: {type: 'wheelchair'}},
 standard: {label: 'Standard walking route', note: 'Conventional pedestrian route. May include stairs.', costing: {}},
};
function kindOf(m) {
 const t = m.type, text = String(m.instruction || '').toLowerCase();
 if (t === 39 || /elevator|\blift\b/.test(text)) return 'elevator';
 if (t === 41 || /escalator/.test(text)) return 'escalator';
 if (t === 40 || /stairs|steps/.test(text)) return 'stairs';
 if (/cross/.test(text)) return 'crossing';
 return 'walk';
}
function normaliseValhalla(data, profile) {
 const trip = data.trip; const geometry = [], steps = [], shapes = trip.legs.map(l => l.shape);
 for (const leg of trip.legs) {
  const offset = geometry.length;
  geometry.push(...decodePolyline(leg.shape, 6));
  for (const m of leg.maneuvers) steps.push({
   instruction: m.instruction || 'Continue',
   short: String(m.verbal_succinct_transition_instruction || m.instruction || '').split(' Then ')[0],
   distance_m: Math.round((m.length || 0) * 1000), duration_s: Math.round(m.time || 0), kind: kindOf(m),
   shape_index: offset + (m.begin_shape_index || 0),
  });
 }
 const counts = {stairs: 0, elevator: 0, escalator: 0, crossing: 0};
 steps.forEach(s => { if (s.kind in counts) counts[s.kind]++; });
 const warnings = [];
 if (profile === 'wheelchair' && counts.stairs) warnings.push('Map data shows stairs on this route even with the wheelchair profile.');
 return {profile, shapes, label: PROFILES[profile].label, note: PROFILES[profile].note, provider: 'valhalla',
  distance_m: Math.round(trip.summary.length * 1000), duration_s: Math.round(trip.summary.time), geometry, steps, counts, warnings,
  accessibility_verified: false,
  evidence: 'Based on OpenStreetMap community data. Kerb heights, slopes, ramps, lift status and crossing safety are not verified.'};
}
let lastValhalla = 0, queue = Promise.resolve();
function throttled(fn) {
 const run = queue.then(async () => {
  const wait = lastValhalla + CONFIG.valhallaGapMs - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  lastValhalla = Date.now();
  return fn();
 });
 queue = run.catch(() => {});
 return run;
}
function route(start, end, profile = 'standard', {preferLifts = false, exclude = []} = {}) {
 if (!inSG(start) || !inSG(end)) return Promise.reject(new ProviderError('Both points must be in Singapore.', 'input'));
 if (start.lat === end.lat && start.lng === end.lng) return Promise.reject(new ProviderError('Start and destination are the same place.', 'input'));
 const costing = Object.assign({}, PROFILES[profile].costing, preferLifts ? {elevator_penalty: 0} : {});
 const body = {locations: [{lat: +start.lat.toFixed(6), lon: +start.lng.toFixed(6)}, {lat: +end.lat.toFixed(6), lon: +end.lng.toFixed(6)}],
  costing: 'pedestrian', costing_options: {pedestrian: costing}, directions_options: {units: 'kilometers', language: 'en-US'}};
 // Points the person asked to avoid (e.g. a lift that's out of service). Valhalla routes around the nearest path.
 if (exclude.length) body.exclude_locations = exclude.slice(0, 10).map(p => ({lat: +p.lat.toFixed(6), lon: +p.lng.toFixed(6)}));
 const url = CONFIG.valhalla + '?json=' + encodeURIComponent(JSON.stringify(body)); // GET avoids a CORS preflight
 return cached('r:' + url, 5 * 60e3, () => throttled(async () => normaliseValhalla(await getJSON(url, 'The routing service', 25000), profile)));
}
async function compareRoutes(start, end, opts = {}) {
 const routes = [], errors = [];
 for (const profile of ['wheelchair', 'standard']) {
  try { routes.push(await route(start, end, profile, opts)); }
  catch (e) { if (e.kind === 'input') throw e; errors.push({profile, error: e.message, kind: e.kind}); }
 }
 if (!routes.length) throw new ProviderError(errors[0].error, errors[0].kind);
 return {routes, errors};
}

/* ---------------- route details for the Journey Accessibility Summary
 * Valhalla trace_attributes describes every segment of a computed route using OpenStreetMap data:
 * what it is (footway, steps, elevator, road crossing, road…), surface, tunnel and bridge flags.
 * Grade/slope values exist too but come from a coarse elevation model (we saw 56% "upward grade" on a level
 * Orchard Road segment), so Pathway deliberately ignores them.
 */
function normaliseEdges(data) {
 return ((data && data.edges) || []).map(e => ({use: e.use || 'other', length_m: Math.round((e.length || 0) * 1000), surface: e.surface || '',
  tunnel: !!e.tunnel, bridge: !!e.bridge, indoor: !!e.indoor, sidewalk: e.sidewalk || '', begin: e.begin_shape_index, end: e.end_shape_index}));
}
function routeDetails(route) {
 if (!route || !route.shapes || !route.shapes.length) return Promise.reject(new ProviderError('No route geometry.', 'input'));
 const body = {encoded_polyline: route.shapes[0], shape_match: 'edge_walk', costing: 'pedestrian',
  costing_options: {pedestrian: Object.assign({}, PROFILES[route.profile] ? PROFILES[route.profile].costing : {})},
  filters: {attributes: ['edge.use', 'edge.length', 'edge.surface', 'edge.tunnel', 'edge.bridge', 'edge.indoor', 'edge.sidewalk', 'edge.begin_shape_index', 'edge.end_shape_index'], action: 'include'}};
 const url = CONFIG.trace + '?json=' + encodeURIComponent(JSON.stringify(body));
 return cached('t:' + url, 10 * 60e3, () => throttled(async () => ({edges: normaliseEdges(await getJSON(url, 'Route details', 25000)), retrieved: new Date().toISOString()})));
}

/* ---------------- demo reports (this browser only) */
class LocalReportStore {
 constructor(key = 'pathway-demo-reports') { this.key = key; this.kind = 'local-demo'; this.shared = false; }
 read() { try { return JSON.parse(localStorage.getItem(this.key) || '[]'); } catch { return []; } }
 write(rows) { try { localStorage.setItem(this.key, JSON.stringify(rows.slice(0, 100))); return true; } catch { return false; } }
 async list() { return this.read(); }
 async add(input) {
  const location = String(input.location || '').trim().slice(0, 120), description = String(input.description || '').trim().slice(0, 1000);
  if (location.length < 3 || description.length < 10) throw new ProviderError('Enter a location and a description of at least 10 characters.', 'input');
  const recent = this.read().filter(r => r.created_at > Date.now() / 1000 - 60);
  if (recent.length >= 5) throw new ProviderError('That’s a lot of reports in a minute. Please wait a moment.', 'rate');
  const pos = inSG(input) ? {lat: +input.lat.toFixed(6), lng: +input.lng.toFixed(6)} : {lat: null, lng: null};
  const row = Object.assign({id: Math.random().toString(36).slice(2, 12), location, category: String(input.category || 'Other access issue').slice(0, 100),
   description, created_at: Math.floor(Date.now() / 1000), status: 'local_demo'}, pos);
  if (!this.write([row].concat(this.read()))) throw new ProviderError('This browser blocked local storage, so the demo report couldn’t be saved.', 'storage');
  return row;
 }
 async remove(id) { this.write(this.read().filter(r => r.id !== id)); }
}

function inSG(p) { return !!p && Number.isFinite(p.lat) && Number.isFinite(p.lng) && p.lat >= SG.latMin && p.lat <= SG.latMax && p.lng >= SG.lngMin && p.lng <= SG.lngMax; }

const api = {normaliseEdges, CONFIG, SG, PROFILES, ProviderError, search, searchLocal, loadExits, nearbyStations, metresApprox, photonState, normaliseNominatim, routeDetails, reverse, route, compareRoutes, decodePolyline, normalisePhoton, normaliseValhalla, LocalReportStore, inSG,
 attribution: 'Search: Photon by komoot · Routing: Valhalla (FOSSGIS) · Data © OpenStreetMap contributors'};
root.PathwayProviders = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
