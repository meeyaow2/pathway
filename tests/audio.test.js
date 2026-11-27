// Unit tests for audio guidance logic (no browser): node --test tests/
const test = require('node:test');
const assert = require('node:assert');
const A = require('../public/audio.js');

// A straight east-west route ~1.1 km along latitude 1.3, with 3 maneuvers.
const pts = []; for (let i = 0; i <= 100; i++) pts.push([1.3, 103.83 + i * 0.0001]);
const route = {label: 'Wheelchair-profile route', duration_s: 900, distance_m: 1113, counts: {stairs: 0, elevator: 1, crossing: 1}, geometry: pts, steps: [
  {instruction: 'Walk east on the walkway.', short: 'Walk east.', kind: 'walk', shape_index: 0},
  {instruction: 'Cross Orchard Road.', short: 'Cross.', kind: 'crossing', shape_index: 50},
  {instruction: 'Take the elevator.', short: 'Take the lift.', kind: 'elevator', shape_index: 80},
  {instruction: 'You have arrived.', short: 'Arrived.', kind: 'walk', shape_index: 100}]};
const at = (i, accuracy = 10, offset = 0) => ({lat: 1.3 + offset, lng: 103.83 + i * 0.0001, accuracy});

test('distances are rounded for speech', () => {
  assert.strictEqual(A.spokenDistance(23), '20 metres');
  assert.strictEqual(A.spokenDistance(260), '250 metres');
  assert.strictEqual(A.spokenDistance(1260), '1.3 kilometres');
  assert.strictEqual(A.spokenDuration(61 * 60), '1 hour 1 minutes');
});

test('crossings, stairs and lifts carry uncertainty, never a command to cross', () => {
  const t = A.stepText(route.steps[1]);
  assert.match(t, /can’t tell whether it is safe/);
  assert.doesNotMatch(t, /cross now|is clear|safe to cross\./i);
  assert.match(A.stepText(route.steps[2]), /doesn’t know whether it is working/);
});

test('route summaries are concise and honest', () => {
  const s = A.compareSummary([route, {...route, label: 'Standard walking route', counts: {stairs: 2, elevator: 0}}], 0, 0);
  assert.match(s, /^2 routes found\. Option 1: Wheelchair-profile route, about 15 minutes/);
  assert.match(s, /no stair sections and 1 lift recorded in map data/);
  assert.match(s, /Accessibility is not verified\.$/);
});

test('tracker announces the next instruction once, about 40 m ahead', () => {
  const t = new A.GuidanceTracker(route);
  assert.deepStrictEqual(t.evaluate(at(5)).events.map(e => e.key), []);
  const near = t.evaluate(at(47));
  const step = near.events.find(e => e.key === 'step1');
  assert.ok(step, JSON.stringify(near.events));
  assert.match(step.text, /^In about 30 metres: Cross Orchard Road\. Map data shows a road crossing/);
  assert.strictEqual(t.evaluate(at(48)).events.filter(e => e.key === 'step1').length, 0, 'not repeated');
});

test('off-route, recovery, low accuracy and arrival are reported on change only', () => {
  const t = new A.GuidanceTracker(route);
  t.evaluate(at(10));
  const off = t.evaluate(at(12, 10, 0.0008));
  assert.strictEqual(off.status, 'off_route');
  assert.strictEqual(off.events[0].priority, 'high');
  assert.strictEqual(t.evaluate(at(12, 10, 0.0009)).events.length, 0, 'no repeat while still off route');
  assert.match(t.evaluate(at(13)).events.map(e => e.text).join(' '), /Back near the route/);
  assert.strictEqual(t.evaluate(at(14, 90)).status, 'low_accuracy');
  const arrive = t.evaluate(at(99.9));
  assert.strictEqual(arrive.status, 'arrived');
  assert.match(arrive.events.map(e => e.text).join(' '), /can’t confirm the entrance/);
});

test('steps already passed are not announced when guidance starts mid-route', () => {
  const t = new A.GuidanceTracker(route);
  const v = t.evaluate(at(60));
  assert.ok(!v.events.some(e => e.key === 'step1'));
});

function fakeSynth() {
  const spoken = []; let current = null;
  return {spoken, speaking: false, cancel() { current = null; this.speaking = false; },
    speak(u) { spoken.push(u.text); current = u; this.speaking = true; setTimeout(() => { if (current === u) { this.speaking = false; u.onend && u.onend(); } }, 5); }};
}
global.SpeechSynthesisUtterance = function (text) { this.text = text; };

test('speaker uses one channel, deduplicates and respects pause and auto settings', async () => {
  const synth = fakeSynth(), polite = {textContent: ''}, assertive = {textContent: ''};
  const settings = {auto: true, target: 'voice', rate: 1, paused: false};
  const sp = new A.Speaker({polite, assertive, synth, settings: () => settings});
  sp.say('One'); sp.say('One'); sp.say('Two');
  await new Promise(r => setTimeout(r, 40));
  assert.deepStrictEqual(synth.spoken, ['One', 'Two']);
  settings.paused = true;
  assert.strictEqual(sp.say('Three'), 'silent');
  assert.ok(sp.repeat(), 'repeat works even when paused');
  settings.paused = false; settings.target = 'screenreader';
  sp.say('Off route', {priority: 'high'});
  await new Promise(r => setTimeout(r, 80));
  assert.strictEqual(assertive.textContent, 'Off route');
  assert.ok(!synth.spoken.includes('Off route'), 'never both channels');
});
