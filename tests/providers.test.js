// Unit tests for the browser providers (no network): node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const P = require('../public/providers.js');

const PHOTON = {features: [
  {geometry: {coordinates: [103.8319, 1.30395]}, properties: {name: 'ION Orchard', housenumber: '2', street: 'Orchard Turn', postcode: '238801', countrycode: 'SG'}},
  {geometry: {coordinates: [103.8322, 1.3039]}, properties: {name: '238801', countrycode: 'SG'}},
  {geometry: {coordinates: [101.0, 3.0]}, properties: {name: 'Kuala Lumpur', countrycode: 'MY'}}]};
const VALHALLA = {trip: {summary: {length: 1.25, time: 1441}, legs: [{shape: '_ibE_seK_seK_seK', maneuvers: [
  {type: 1, instruction: 'Walk southeast on the walkway.', verbal_succinct_transition_instruction: 'Walk southeast. Then Turn left.', length: .5, time: 400, begin_shape_index: 0},
  {type: 39, instruction: 'Take the elevator.', length: 0, time: 60, begin_shape_index: 1},
  {type: 40, instruction: 'Take the stairs.', length: .01, time: 20, begin_shape_index: 1}]}]}};

test('decodes polylines at precision 5 and 6', () => {
  assert.deepStrictEqual(P.decodePolyline('_p~iF~ps|U_ulLnnqC'), [[38.5, -120.2], [40.7, -120.95]]);
  assert.strictEqual(P.decodePolyline('_ibE_seK', 6).length, 1);
});

test('Photon results are limited to Singapore and postal codes are labelled', () => {
  const r = P.normalisePhoton(PHOTON);
  assert.strictEqual(r.length, 2);
  assert.strictEqual(r[0].address, '2 Orchard Turn, Singapore 238801');
  assert.strictEqual(r[1].name, 'Postal code 238801');
  assert.strictEqual(r[1].postal, '238801');
});

test('Valhalla routes are normalised, counted and never marked verified', () => {
  const r = P.normaliseValhalla(VALHALLA, 'wheelchair');
  assert.strictEqual(r.distance_m, 1250);
  assert.strictEqual(r.duration_s, 1441);
  assert.deepStrictEqual(r.counts, {stairs: 1, elevator: 1, escalator: 0, crossing: 0});
  assert.strictEqual(r.accessibility_verified, false);
  assert.match(r.label, /Wheelchair-profile/);
  assert.match(r.warnings[0], /stairs/);
  assert.strictEqual(r.steps[0].short, 'Walk southeast.');
});

test('routes outside Singapore are rejected before any request', async () => {
  await assert.rejects(P.route({lat: 51.5, lng: 0.1}, {lat: 1.3, lng: 103.8}), /Singapore/);
});

test('routing requests are spaced at least 1.1 s apart (FOSSGIS policy)', async () => {
  const times = [];
  global.fetch = async () => { times.push(Date.now()); return {ok: true, status: 200, json: async () => VALHALLA}; };
  const out = await P.compareRoutes({lat: 1.3046, lng: 103.8318}, {lat: 1.3004, lng: 103.839});
  assert.strictEqual(out.routes.length, 2);
  assert.ok(times[1] - times[0] >= 1050, 'gap was ' + (times[1] - times[0]));
  assert.deepStrictEqual(out.routes.map(r => r.profile), ['wheelchair', 'standard']);
});

test('failed routing reports a helpful error', async () => {
  global.fetch = async () => ({ok: false, status: 503, json: async () => ({})});
  await assert.rejects(P.compareRoutes({lat: 1.31, lng: 103.83}, {lat: 1.30, lng: 103.84}), /routing service returned an error/i);
});

test('demo reports stay in local storage and are rate limited', async () => {
  const mem = {};
  global.localStorage = {getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = v; }};
  const store = new P.LocalReportStore('t');
  assert.strictEqual(store.shared, false);
  await assert.rejects(store.add({location: 'x', description: 'short'}), /description/);
  const row = await store.add({location: 'Exit B', category: 'Lift not working', description: 'Lift out of service today', lat: 1.3, lng: 103.83});
  assert.strictEqual(row.status, 'local_demo');
  for (let i = 0; i < 4; i++) await store.add({location: 'Exit B', description: 'Another demo report'});
  await assert.rejects(store.add({location: 'Exit B', description: 'One too many reports'}), /wait/);
  await store.remove(row.id);
  assert.strictEqual((await store.list()).length, 4);
});
