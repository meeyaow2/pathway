// Journey Accessibility Summary + search reliability (no network): node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs'), path = require('path');
const Access = require('../public/access.js');
const P = require('../public/providers.js');

const route = {label: 'Wheelchair-profile route', profile: 'wheelchair', duration_s: 1200, distance_m: 1300, counts: {stairs: 0, elevator: 1, crossing: 2},
  geometry: [[1.3046, 103.8318], [1.3030, 103.8350], [1.3004, 103.8390]]};
const E = (use, len, extra = {}) => ({use, length_m: len, surface: 'paved', tunnel: false, bridge: false, indoor: false, sidewalk: '', ...extra});
const edges = [E('footway', 80, {tunnel: true}), E('footway', 60, {tunnel: true}), E('pedestrian_crossing', 4), E('pedestrian_crossing', 5), E('footway', 100),
  E('elevator', 3), E('steps', 12), E('footway', 50, {surface: 'compacted'}), E('road', 40), E('pedestrian_crossing', 6), E('footway', 30, {bridge: true})];

test('summary describes what map data records, with a confidence level on every item', () => {
  const s = Access.summarise(route, {edges, retrieved: '2026-11-27T00:00:00Z'}, {});
  const by = k => s.items.find(i => i.key === k);
  assert.strictEqual(by('stairs').text, '1 stair section recorded in map data (about 12 m)');
  assert.match(by('lifts').text, /1 lift on this route in map data\. Working status unknown/);
  assert.match(by('crossings').text, /^2 road crossings recorded/); // consecutive crossing edges count once
  assert.match(by('underpass').text, /About 140 m underground/);
  assert.match(by('roadside').text, /40 m along roads/);
  assert.match(by('surface').text, /50 m recorded as unpaved or compacted/);
  assert.match(by('bridges').text, /1 bridge section/);
  for (const i of s.items) assert.ok(['verified', 'community', 'report', 'unknown'].includes(i.confidence), i.key);
  for (const k of ['lift-status', 'kerbs', 'slopes', 'shelter', 'seating']) assert.strictEqual(by(k).confidence, 'unknown');
  assert.ok(!s.items.some(i => /step-free|accessible route|working lift|safe/i.test(i.text.replace(/Working status unknown|isn’t in open data/g, ''))), 'no overclaiming words');
  assert.ok(!('score' in s), 'no overall score');
});

test('no stairs is phrased as "none recorded", never "step-free"', () => {
  const s = Access.summarise(route, {edges: [E('footway', 300)]}, {});
  assert.strictEqual(s.items.find(i => i.key === 'stairs').text, 'No stairs recorded in map data');
  assert.strictEqual(Access.chip(s.headline[0]), 'No stairs recorded');
});

test('official MRT exit arrival is "verified" for location only; access stays unknown', () => {
  const s = Access.summarise(route, {edges}, {end: {name: 'Somerset MRT Station, Exit B', station: 'Somerset MRT Station', exit: 'Exit B'}, exitsMeta: {updated: '2026-10-16'}});
  const end = s.items.find(i => i.key === 'end-exit');
  assert.strictEqual(end.confidence, 'verified');
  assert.match(end.text, /official LTA data \(updated 2026-10-16\)\. Lift or step-free access at this exit isn’t in open data/);
  const plain = Access.summarise(route, {edges}, {end: {name: 'Paragon'}});
  assert.strictEqual(plain.items.find(i => i.key === 'end-entrance').confidence, 'unknown');
});

test('nearby demo reports appear as "report", far ones do not', () => {
  const reports = [{category: 'Lift not working', lat: 1.3030, lng: 103.8351}, {category: 'Blocked path', lat: 1.32, lng: 103.86}];
  const s = Access.summarise(route, {edges}, {reports});
  const r = s.items.find(i => i.key === 'reports');
  assert.strictEqual(r.confidence, 'report'); assert.match(r.text, /^1 demo report near this route: Lift not working\. Saved on this device only; not verified/);
});

test('without segment details, the summary says so instead of guessing', () => {
  const s = Access.summarise(route, null, {});
  assert.strictEqual(s.items.find(i => i.key === 'details').confidence, 'unknown');
  assert.ok(!s.complete);
});

test('trade-offs and spoken summary separate recorded facts from unknowns', () => {
  const a = Access.summarise(route, {edges}, {}), b = Access.summarise({...route, duration_s: 900, distance_m: 1000}, {edges: [E('steps', 10), E('steps', 1, {}), E('footway', 5), E('steps', 8)]}, {});
  const line = Access.compare(a, b, route, {label: 'Standard walking route', duration_s: 900, distance_m: 1000});
  assert.match(line, /^Compared with standard walking route: 5 min longer, 300 m more walking, 1 fewer stair section/);
  const sp = Access.spoken(a, 'Option 1');
  assert.match(sp, /^Option 1: 1 stair section recorded/); assert.match(sp, /Unknown: lift status, kerbs and ramps, slopes, covered walkways, seating and rest points\.$/);
});

// ---- search reliability
const EXITS = fs.readFileSync(path.join(__dirname, '..', 'public', 'data', 'mrt-exits.json'), 'utf8');
function mockFetch(handlers) {
  const calls = [];
  global.fetch = async url => { calls.push(String(url)); for (const [re, fn] of handlers) if (re.test(url)) return fn(url); throw new TypeError('no route'); };
  return calls;
}
const ok = body => ({ok: true, status: 200, json: async () => (typeof body === 'string' ? JSON.parse(body) : body)});
const NOM = [{lat: '1.3035', lon: '103.8355', name: 'Paragon', addresstype: 'building', address: {road: 'Orchard Road', house_number: '290', postcode: '238859', country_code: 'sg'}},
  {lat: '48.85', lon: '2.35', name: 'Paris', address: {country_code: 'fr'}}];

test('official MRT stations are found locally, closest name first, with exits', async () => {
  mockFetch([[/mrt-exits/, () => ok(EXITS)]]);
  const r = await P.searchLocal('orchard mrt');
  assert.strictEqual(r[0].name, 'Orchard MRT Station'); assert.strictEqual(r[0].source, 'lta');
  const ex = await P.searchLocal('somerset exit b');
  assert.ok(ex.length >= 1);
});

test('Photon failure pauses suggestions; explicit search uses Nominatim; everything down still finds stations', async () => {
  global.sessionStorage = {getItem: () => null, setItem: () => {}};
  const calls = mockFetch([[/mrt-exits/, () => ok(EXITS)], [/photon/, () => ({ok: false, status: 429, json: async () => ({})})], [/nominatim/, () => ok(NOM)]]);
  P.photonState.pausedUntil = 0; P.photonState.failures = 0;
  const s1 = await P.search('paragon orchard', {mode: 'suggest'});
  assert.strictEqual(s1.status, 'degraded'); assert.match(s1.message, /Press Enter/);
  assert.ok(P.photonState.pausedUntil > Date.now() + 20000, 'backs off');
  const before = calls.filter(u => /photon/.test(u)).length;
  await P.search('paragon', {mode: 'suggest'});
  assert.strictEqual(calls.filter(u => /photon/.test(u)).length, before, 'no Photon calls while paused');
  assert.ok(!calls.some(u => /nominatim/.test(u)), 'never autocompletes with Nominatim');
  const s2 = await P.search('paragon', {mode: 'submit'});
  assert.strictEqual(s2.status, 'fallback'); assert.strictEqual(s2.results.length, 1, 'non-Singapore result dropped');
  assert.match(calls.find(u => /nominatim/.test(u)), /countrycodes=sg/);
  mockFetch([[/mrt-exits/, () => ok(EXITS)], [/photon|nominatim/, () => { throw new TypeError('down'); }]]);
  const s3 = await P.search('somerset mrt', {mode: 'submit'});
  assert.strictEqual(s3.status, 'degraded'); assert.ok(s3.results.some(r => r.name === 'Somerset MRT Station'));
});
