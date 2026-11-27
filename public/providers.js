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
 valhalla: 'https://valhalla1.openstreetmap.de/route',
 valhallaGapMs: 1100, // FOSSGIS policy: max 1 request/second
 timeoutMs: 20000,
};

class ProviderError extends Error {
 constructor(message, kind) { super(message); this.kind = kind || 'error'; }
}

async function getJSON(url, name, timeoutMs = CONFIG.timeoutMs) {
 if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new ProviderError('You’re offline. Reconnect to search and get routes.', 'offline');
 const ctrl = new AbortController(); const timer = setTimeout(() => ctrl.abort(), timeoutMs);
 let res;
 try { res = await fetch(url, {signal: ctrl.signal, headers: {Accept: 'application/json'}}); }
 catch (e) { throw new ProviderError(e.name === 'AbortError' ? name + ' took too long to respond. Please try again.' : name + ' is unreachable. Check your connection and try again.', 'network'); }
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

/* ---------------- search */
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
  out.push({name, address, postal, lat, lng});
 }
 return out.slice(0, 8);
}
function search(query) {
 const q = String(query || '').trim();
 if (q.length < 2 || q.length > 100) return Promise.reject(new ProviderError('Type at least 2 characters.', 'input'));
 const params = new URLSearchParams({q, limit: '10', lat: '1.3521', lon: '103.8198', lang: 'en', bbox: [SG.lngMin, SG.latMin, SG.lngMax, SG.latMax].join(',')});
 return cached('s:' + q.toLowerCase(), 10 * 60e3, async () => ({provider: 'photon', results: normalisePhoton(await getJSON(CONFIG.photon + '?' + params, 'Address search'))}));
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
 const trip = data.trip; const geometry = [], steps = [];
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
 return {profile, label: PROFILES[profile].label, note: PROFILES[profile].note, provider: 'valhalla',
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
function route(start, end, profile = 'standard', {preferLifts = false} = {}) {
 if (!inSG(start) || !inSG(end)) return Promise.reject(new ProviderError('Both points must be in Singapore.', 'input'));
 if (start.lat === end.lat && start.lng === end.lng) return Promise.reject(new ProviderError('Start and destination are the same place.', 'input'));
 const costing = Object.assign({}, PROFILES[profile].costing, preferLifts ? {elevator_penalty: 0} : {});
 const body = {locations: [{lat: +start.lat.toFixed(6), lon: +start.lng.toFixed(6)}, {lat: +end.lat.toFixed(6), lon: +end.lng.toFixed(6)}],
  costing: 'pedestrian', costing_options: {pedestrian: costing}, directions_options: {units: 'kilometers', language: 'en-US'}};
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

const api = {CONFIG, SG, PROFILES, ProviderError, search, reverse, route, compareRoutes, decodePolyline, normalisePhoton, normaliseValhalla, LocalReportStore, inSG,
 attribution: 'Search: Photon by komoot · Routing: Valhalla (FOSSGIS) · Data © OpenStreetMap contributors'};
root.PathwayProviders = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
