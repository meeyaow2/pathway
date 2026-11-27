/* Pathway Journey Accessibility Summary — what is known about a route, and how confident we can be.
 *
 * Every item carries one confidence level:
 *   verified  — authoritative / official source (e.g. LTA MRT exit locations)
 *   community — recorded in OpenStreetMap (community-mapped, may be incomplete or outdated)
 *   report    — a user's observation (in this prototype: local demo reports on this device only)
 *   unknown   — no usable data; never presented as safe
 * Wording rule: describe what the data records ("No stairs recorded in map data"), never certainty
 * ("step-free", "lift working", "sheltered route"). No overall score: there's no validated methodology.
 */
(function (root) {
'use strict';
const CONFIDENCE = {
  verified: {label: 'Official', long: 'Official data'},
  community: {label: 'Map data', long: 'Community-mapped (OpenStreetMap)'},
  report: {label: 'Report', long: 'User report (local demo, unverified)'},
  unknown: {label: 'Unknown', long: 'No usable data'},
};
const UNPAVED = /^(compacted|gravel|dirt|path|unpaved|grass|sand|wood|impassable)$/;
const ROADLIKE = /^(road|turn_channel|service_road|living_street|driveway|alley|parking_aisle|track)$/;
const n = (k, one, many) => k + ' ' + (k === 1 ? one : many);
const m = v => (v >= 1000 ? (v / 1000).toFixed(1) + ' km' : Math.round(v) + ' m');

// Consecutive edges of the same kind are one feature (a crossing is often split into several edges).
function groups(edges, test) {
  let count = 0, length = 0, inRun = false;
  for (const e of edges) { const hit = test(e); if (hit) { length += e.length_m; if (!inRun) count++; } inRun = hit; }
  return {count, length};
}
function distToRoute(p, pts) {
  let best = Infinity; const k = 111320, cos = Math.cos(p.lat * Math.PI / 180);
  for (let i = 1; i < pts.length; i++) {
    const ax = (pts[i - 1][1] - p.lng) * k * cos, ay = (pts[i - 1][0] - p.lat) * k, bx = (pts[i][1] - p.lng) * k * cos, by = (pts[i][0] - p.lat) * k;
    const vx = bx - ax, vy = by - ay, len2 = vx * vx + vy * vy;
    const t = len2 ? Math.max(0, Math.min(1, -(ax * vx + ay * vy) / len2)) : 0;
    best = Math.min(best, Math.hypot(ax + t * vx, ay + t * vy));
  }
  return best;
}

/**
 * @param route   normalised route (counts, geometry, profile)
 * @param details {edges, retrieved} from PathwayProviders.routeDetails, or null if unavailable
 * @param ctx     {start, end, reports, exitsMeta}
 */
function summarise(route, details, ctx = {}) {
  const items = [], edges = details && details.edges;
  const add = (key, label, text, confidence, extra = {}) => items.push({key, label, text, confidence, ...extra});
  if (edges && edges.length) {
    const steps = groups(edges, e => e.use === 'steps');
    add('stairs', 'Stairs', steps.count ? n(steps.count, 'stair section', 'stair sections') + ' recorded in map data (about ' + m(steps.length) + ')' : 'No stairs recorded in map data', 'community', {value: steps.count, flag: steps.count > 0});
    const lifts = groups(edges, e => e.use === 'elevator'), esc = groups(edges, e => e.use === 'escalator');
    add('lifts', 'Lifts', lifts.count ? n(lifts.count, 'lift', 'lifts') + ' on this route in map data. Working status unknown' : 'No lifts on this route in map data', 'community', {value: lifts.count, statusUnknown: lifts.count > 0});
    if (esc.count) add('escalators', 'Escalators', n(esc.count, 'escalator', 'escalators') + ' recorded in map data', 'community', {value: esc.count, flag: true});
    const cross = groups(edges, e => e.use === 'pedestrian_crossing');
    add('crossings', 'Road crossings', cross.count ? n(cross.count, 'road crossing', 'road crossings') + ' recorded. Signals, kerbs and tactile paving not known' : 'No road crossings recorded in map data', 'community', {value: cross.count});
    const road = groups(edges, e => ROADLIKE.test(e.use) && !/left|right|both|yes/.test(e.sidewalk));
    if (road.length >= 10) add('roadside', 'Walking along roads', 'About ' + m(road.length) + ' along roads with no separate footway mapped', 'community', {value: road.length, flag: true});
    const tunnel = groups(edges, e => e.tunnel || e.indoor);
    add('underpass', 'Underground or indoor', tunnel.length >= 10 ? 'About ' + m(tunnel.length) + ' underground, indoors or in underpasses (likely sheltered)' : 'No underground or indoor sections recorded', 'community', {value: tunnel.length});
    const bridge = groups(edges, e => e.bridge && !ROADLIKE.test(e.use));
    if (bridge.count) add('bridges', 'Overhead bridges', n(bridge.count, 'bridge section', 'bridge sections') + ' (may involve stairs or lifts)', 'community', {value: bridge.count});
    const rough = groups(edges, e => UNPAVED.test(e.surface));
    if (rough.length >= 10) add('surface', 'Surface', 'About ' + m(rough.length) + ' recorded as unpaved or compacted (may be uneven)', 'community', {value: rough.length, flag: true});
  } else {
    const c = route.counts || {};
    add('stairs', 'Stairs', c.stairs ? n(c.stairs, 'stair section', 'stair sections') + ' in the directions' : 'No stairs in the directions', 'community', {value: c.stairs || 0, flag: c.stairs > 0});
    add('lifts', 'Lifts', c.elevator ? n(c.elevator, 'lift', 'lifts') + ' in the directions. Working status unknown' : 'No lifts in the directions', 'community', {value: c.elevator || 0, statusUnknown: c.elevator > 0});
    add('crossings', 'Road crossings', n(c.crossing || 0, 'crossing', 'crossings') + ' in the directions. Signals and kerbs not known', 'community', {value: c.crossing || 0});
    add('details', 'Detailed route data', 'Couldn’t load segment details; showing what the directions mention', 'unknown');
  }
  // Destination / start entrances
  for (const [which, p] of [['end', ctx.end], ['start', ctx.start]]) {
    if (!p) continue;
    const word = which === 'end' ? 'Ends' : 'Starts';
    if (p.exit) add(which + '-exit', which === 'end' ? 'Arrival point' : 'Starting point', word + ' at ' + p.station + ' ' + p.exit + '. Exit location is official LTA data' +
      (ctx.exitsMeta && ctx.exitsMeta.updated ? ' (updated ' + ctx.exitsMeta.updated + ')' : '') + '. Lift or step-free access at this exit isn’t in open data', 'verified', {accessUnknown: true});
    else if (which === 'end') add('end-entrance', 'Arrival point', p.station ? 'Ends at the station centre. Choose an exit for a more precise arrival point' : 'Ends at the address point, not a specific entrance. Entrance data isn’t available', 'unknown');
  }
  // Local demo reports near the route
  const near = (ctx.reports || []).filter(r => Number.isFinite(r.lat) && Number.isFinite(r.lng) && distToRoute(r, route.geometry || []) <= 30);
  if (near.length) add('reports', 'Barrier reports', n(near.length, 'demo report', 'demo reports') + ' near this route: ' + near.slice(0, 3).map(r => r.category).join(', ') + '. Saved on this device only; not verified', 'report', {value: near.length, flag: true});
  // Things Pathway cannot know yet — listed so absence of a warning is never read as "fine".
  add('lift-status', 'Lift status', 'Live lift maintenance isn’t connected (official data needs a server)', 'unknown');
  add('kerbs', 'Kerbs and ramps', 'Kerb heights and ramps not known', 'unknown');
  add('slopes', 'Slopes', 'Slope data too coarse to use', 'unknown');
  add('shelter', 'Covered walkways', 'Covered linkways aren’t in this data', 'unknown');
  add('seating', 'Seating and rest points', 'Not known', 'unknown');
  const headline = ['stairs', 'lifts', 'crossings', 'underpass', 'reports'].map(k => items.find(i => i.key === k)).filter(Boolean).slice(0, 4);
  return {items, headline, metrics: Object.fromEntries(items.filter(i => typeof i.value === 'number').map(i => [i.key, i.value])),
    source: edges && edges.length ? 'Map data © OpenStreetMap contributors via Valhalla (FOSSGIS)' + (details.retrieved ? ', checked ' + details.retrieved.slice(0, 10) : '') : 'Directions from Valhalla (FOSSGIS); segment details unavailable',
    complete: !!(edges && edges.length)};
}

// Short chip text for route cards.
function chip(item) {
  const v = item.value || 0;
  switch (item.key) {
    case 'stairs': return v ? n(v, 'stair section', 'stair sections') : 'No stairs recorded';
    case 'lifts': return v ? n(v, 'lift', 'lifts') + ' (status unknown)' : 'No lifts';
    case 'crossings': return n(v, 'crossing', 'crossings');
    case 'underpass': return v >= 10 ? m(v) + ' underground or indoor' : '';
    case 'reports': return n(v, 'report', 'reports') + ' nearby';
    default: return item.text;
  }
}

// Trade-offs between the selected route and another one, in plain words (e.g. for people weighing comfort vs time).
function compare(a, b, ra, rb) {
  if (!a || !b || !a.metrics || !b.metrics) return '';
  const parts = [], dt = Math.round((ra.duration_s - rb.duration_s) / 60), dd = Math.round(ra.distance_m - rb.distance_m);
  if (dt) parts.push(Math.abs(dt) + ' min ' + (dt > 0 ? 'longer' : 'shorter'));
  if (Math.abs(dd) >= 50) parts.push(m(Math.abs(dd)) + ' ' + (dd > 0 ? 'more' : 'less') + ' walking');
  const diff = (k, one, many) => { const d = (a.metrics[k] || 0) - (b.metrics[k] || 0); if (d) parts.push(Math.abs(d) + ' ' + (d > 0 ? 'more ' : 'fewer ') + (Math.abs(d) === 1 ? one : many)); };
  diff('stairs', 'stair section', 'stair sections'); diff('crossings', 'road crossing', 'road crossings'); diff('lifts', 'lift', 'lifts');
  const u = (a.metrics.underpass || 0) - (b.metrics.underpass || 0); if (Math.abs(u) >= 30) parts.push(m(Math.abs(u)) + (u > 0 ? ' more' : ' less') + ' underground or indoor');
  return parts.length ? 'Compared with ' + rb.label.toLowerCase() + ': ' + parts.join(', ') + '.' : '';
}

// Spoken summary: concise by default (headline + arrival + what is unknown); full on request.
function spoken(summary, label, {full = false} = {}) {
  const pick = full ? summary.items : summary.items.filter(i => summary.headline.includes(i) || /exit|entrance|roadside|reports/.test(i.key));
  const known = pick.filter(i => i.confidence !== 'unknown').map(i => i.text.replace(/\.$/, ''));
  const unknown = summary.items.filter(i => i.confidence === 'unknown' && !['details', 'end-entrance'].includes(i.key)).map(i => i.label.toLowerCase());
  const arrival = summary.items.find(i => i.key === 'end-entrance');
  return (label ? label + ': ' : '') + known.join('. ') + '. ' + (arrival ? arrival.text + '. ' : '') + 'Unknown: ' + unknown.join(', ') + '.';
}

const api = {summarise, chip, spoken, compare, CONFIDENCE, groups, distToRoute};
root.PathwayAccess = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
