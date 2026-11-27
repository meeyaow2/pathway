/* Pathway audio guidance — speech queue, safe phrasing and a GPS guidance tracker.
 *
 * Design rules (see docs/audio-navigation.md):
 * - One channel at a time: either Pathway's own voice (speechSynthesis) OR the person's screen reader
 *   (an ARIA live region). Never both, so announcements don't talk over VoiceOver/TalkBack.
 * - Messages are short, deduplicated and only sent when something changes.
 * - Pathway never gives safety-critical commands ("cross now", "path is clear"). Crossings, stairs and lifts
 *   are described as what map data shows, with the uncertainty stated.
 */
(function (root) {
'use strict';

/* ---------------- spoken numbers */
function roundMetres(m) {
  m = Math.max(0, Number(m) || 0);
  if (m < 20) return 10;
  if (m < 100) return Math.round(m / 10) * 10;
  if (m < 500) return Math.round(m / 50) * 50;
  return Math.round(m / 100) * 100;
}
function spokenDistance(m) {
  const r = roundMetres(m);
  if (r >= 1000) { const km = (r / 1000).toFixed(r % 1000 ? 1 : 0); return km + (km === '1' ? ' kilometre' : ' kilometres'); }
  return r + ' metres';
}
function spokenDuration(s) {
  const min = Math.max(1, Math.round((Number(s) || 0) / 60));
  if (min < 60) return min + (min === 1 ? ' minute' : ' minutes');
  const h = Math.floor(min / 60), rest = min % 60;
  return h + (h === 1 ? ' hour' : ' hours') + (rest ? ' ' + rest + ' minutes' : '');
}
const count = (n, one, many) => (n === 0 ? 'no ' + many : n + ' ' + (n === 1 ? one : many));

/* ---------------- safe phrasing */
// Appended to instructions whose safety Pathway cannot know.
const CAUTION = {
  crossing: 'Map data shows a road crossing here. Pathway can’t tell whether it is safe or when to cross. Use the signals, listen for traffic, or ask for help.',
  stairs: 'Map data shows stairs here.',
  elevator: 'Map data shows a lift here. Pathway doesn’t know whether it is working.',
  escalator: 'Map data shows an escalator here.',
};
function stepText(step, simple) {
  const base = String((simple ? step.short : step.instruction) || step.instruction || 'Continue').trim().replace(/\s+/g, ' ');
  const caution = CAUTION[step.kind];
  return caution ? base.replace(/\.?$/, '.') + ' ' + caution : base;
}
function routeSummary(r, i) {
  if (r.illustrative) return 'No walking route available. Only a straight-line illustration is shown.';
  const parts = [(i != null ? 'Option ' + (i + 1) + ': ' : '') + r.label, 'about ' + spokenDuration(r.duration_s), spokenDistance(r.distance_m)];
  if (r.counts) parts.push(count(r.counts.stairs, 'stair section', 'stair sections') + ' and ' + count(r.counts.elevator, 'lift', 'lifts') + ' recorded in map data');
  return parts.join(', ') + '.';
}
function compareSummary(routes, selected, recommended) {
  if (!routes.length) return 'No routes found.';
  const intro = routes.length === 1 ? 'One route found.' : routes.length + ' routes found.';
  const list = routes.map((r, i) => routeSummary(r, i)).join(' ');
  const pick = routes.length > 1 ? ' Option ' + (selected + 1) + ' is selected' + (selected === recommended ? ' as the best match for your needs.' : '.') : '';
  return intro + ' ' + list + pick + ' Accessibility is not verified.';
}

/* ---------------- geometry */
const EARTH = 6371000;
function metres(a, b) {
  const r = Math.PI / 180, dp = (b[0] - a[0]) * r, dl = (b[1] - a[1]) * r;
  const v = Math.sin(dp / 2) ** 2 + Math.cos(a[0] * r) * Math.cos(b[0] * r) * Math.sin(dl / 2) ** 2;
  return 2 * EARTH * Math.atan2(Math.sqrt(v), Math.sqrt(Math.max(0, 1 - v)));
}
function cumulative(points) { const c = [0]; for (let i = 1; i < points.length; i++) c.push(c[i - 1] + metres(points[i - 1], points[i])); return c; }
function project(pos, pts) {
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

/* ---------------- guidance tracker (pure: position in, view + events out) */
const STATUS = {
  low_accuracy: {badge: 'LOW GPS ACCURACY', tone: ''},
  off_route: {badge: 'POSSIBLY OFF ROUTE', tone: 'alert'},
  approaching: {badge: 'APPROACHING', tone: 'ok'},
  arrived: {badge: 'NEAR DESTINATION', tone: 'ok'},
  on_route: {badge: 'ON ROUTE', tone: 'ok'},
};
class GuidanceTracker {
  constructor(route, {simple = false} = {}) {
    this.route = route; this.simple = simple;
    this.points = route.geometry; this.cum = cumulative(this.points); this.length = this.cum[this.cum.length - 1] || 0;
    this.steps = route.steps || [];
    this.stepAt = this.steps.map(s => (s.shape_index == null ? null : this.cum[Math.min(s.shape_index, this.cum.length - 1)]));
    this.reset();
  }
  reset() { this.status = null; this.announced = new Set(); this.milestones = new Set(); this.lastAccuracyWarn = -Infinity; }
  firstInstruction() { return this.steps[0] ? stepText(this.steps[0], this.simple) : 'Follow the route.'; }
  evaluate(pos, now = Date.now()) {
    const events = [], acc = Number.isFinite(pos.accuracy) && pos.accuracy > 0 ? pos.accuracy : 999;
    const m = project([pos.lat, pos.lng], this.points);
    const remaining = Math.max(0, this.length - m.along), pct = this.length ? Math.max(0, Math.min(100, 100 * m.along / this.length)) : 0;
    // Steps already behind us are never announced.
    let stepIdx = 0;
    this.stepAt.forEach((d, i) => { if (d != null && d <= m.along + 5) { stepIdx = i; this.announced.add(i); } });
    const nextIdx = this.stepAt.findIndex((d, i) => i > stepIdx && d != null);
    const next = nextIdx > 0 ? this.steps[nextIdx] : null, toNext = next ? this.stepAt[nextIdx] - m.along : remaining;
    let status = acc > 50 ? 'low_accuracy' : m.distance > Math.max(35, acc * 2) ? 'off_route' : remaining <= 25 ? 'arrived' : remaining <= 80 ? 'approaching' : 'on_route';
    const prev = this.status;
    if (status !== prev) {
      if (status === 'off_route') events.push({priority: 'high', vibrate: [200, 100, 200], key: 'off', text: 'You may be off the route, about ' + spokenDistance(m.distance) + ' from it. Check your surroundings. You can choose Reroute from here.'});
      else if (status === 'low_accuracy' && now - this.lastAccuracyWarn > 60000) { this.lastAccuracyWarn = now; events.push({key: 'acc', text: 'GPS is imprecise, about ' + spokenDistance(acc) + '. Your position on the route may be wrong until it improves.'}); }
      else if (status === 'approaching') events.push({key: 'approach', text: 'About ' + spokenDistance(remaining) + ' to the destination area. Pathway can’t locate the exact entrance.'});
      else if (status === 'arrived') events.push({key: 'arrived', vibrate: [80, 60, 80, 60, 80], text: 'You may be near the destination. Pathway can’t confirm the entrance. Ask for help if you need it.'});
      else if (status === 'on_route' && (prev === 'off_route' || prev === 'low_accuracy')) events.push({key: 'back', text: 'Back near the route.'});
      this.status = status;
    }
    if (next && (status === 'on_route' || status === 'approaching') && toNext <= 40 && !this.announced.has(nextIdx)) {
      this.announced.add(nextIdx);
      events.push({key: 'step' + nextIdx, vibrate: [60], text: 'In about ' + spokenDistance(toNext) + ': ' + stepText(next, this.simple)});
    }
    if (status === 'on_route') for (const t of [2000, 1000, 500, 250]) {
      if (remaining < t && remaining > 80 && this.length > t + 50 && !this.milestones.has(t)) { this.milestones.add(t); events.push({key: 'ms' + t, priority: 'low', text: 'About ' + spokenDistance(t) + ' to go.'}); break; }
    }
    const latest = next ? 'Next, in about ' + spokenDistance(toNext) + ': ' + stepText(next, this.simple) : 'Continue towards the destination.';
    const message = {
      low_accuracy: 'GPS accuracy is about ' + Math.round(acc) + ' m, too low to place you on the route.',
      off_route: 'You seem to be about ' + Math.round(m.distance) + ' m from the route. Check your surroundings, or choose Reroute from here.',
      approaching: 'Close to the destination area. Pathway can’t locate the exact entrance.',
      arrived: 'You may be near the destination. Confirm the entrance yourself.',
      on_route: 'Approximate position along the route. This isn’t safety-verified navigation.',
    }[status];
    return {status, ...STATUS[status], message, latest, remaining, pct, stepIdx, accuracy: acc, offBy: m.distance, events};
  }
}

/* ---------------- speaker: one channel, queued, deduplicated */
class Speaker {
  constructor({polite, assertive, synth, settings}) {
    this.polite = polite; this.assertive = assertive; this.synth = synth || null; this.settings = settings;
    this.queue = []; this.recent = new Map(); this.last = ''; this.speaking = false;
  }
  get channel() { return this.settings().target === 'screenreader' || !this.synth ? 'screenreader' : 'voice'; }
  say(text, {priority = 'normal', key = text, gap = 20000, force = false} = {}) {
    if (!text) return false;
    const now = Date.now(), s = this.settings();
    if (!force && now - (this.recent.get(key) || -Infinity) < gap) return false;
    this.recent.set(key, now);
    if (priority !== 'low') this.last = text;
    if (!force && (!s.auto || s.paused)) return 'silent'; // automatic speech off: the caller may hand it to screen readers
    if (this.channel === 'screenreader') { this.announce(text, priority === 'high'); return true; }
    if (priority === 'high' || force) { this.synth.cancel(); this.queue = []; this.speaking = false; this.speakNow(text); }
    else if (this.speaking || this.synth.speaking) { this.queue.push(text); if (this.queue.length > 2) this.queue.shift(); }
    else this.speakNow(text);
    return true;
  }
  speakNow(text) {
    const u = new root.SpeechSynthesisUtterance(text); u.lang = 'en-SG'; u.rate = this.settings().rate || 1;
    u.onend = u.onerror = () => { if (this.current !== u) return; this.speaking = false; const nextText = this.queue.shift(); if (nextText) this.speakNow(nextText); };
    this.current = u; this.speaking = true; this.synth.speak(u);
  }
  announce(text, assertive) {
    const region = assertive ? this.assertive : this.polite; if (!region) return;
    region.textContent = ''; setTimeout(() => { region.textContent = text; }, 60);
  }
  repeat() { return this.last ? this.say(this.last, {force: true, key: 'repeat' + Date.now()}) : false; }
  stop() { this.queue = []; this.speaking = false; if (this.synth) this.synth.cancel(); }
}

const api = {Speaker, GuidanceTracker, stepText, routeSummary, compareSummary, spokenDistance, spokenDuration, roundMetres, metres, cumulative, project, CAUTION};
root.PathwayAudio = api;
if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
