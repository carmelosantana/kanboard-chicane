import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// race.js is a browser script; load it with just enough PIXI/gsap/document stubs for its load-time code
// and test its pure helpers.
const src = readFileSync(new URL('../../Assets/js/race.js', import.meta.url), 'utf8');
const win = { PIXI: { extensions: { add() {} } }, gsap: { ticker: { lagSmoothing() {} } }, Chicane: {} };
new Function('window', 'document', src)(win, { readyState: 'complete', getElementById: () => null });
const { lru, track } = win.ChicaneRace._internals;

// A stand-in for a GSAP tween: eventCallback(name) gets, eventCallback(name, fn) sets.
function fakeTween() {
  const cb = {};
  return { eventCallback(name, fn) { if (arguments.length === 1) return cb[name]; cb[name] = fn; return this; }, fire(name) { if (cb[name]) cb[name](); } };
}

test('lru keeps only the most recently used keys and builds each value once', () => {
  const cache = lru(2); let builds = 0;
  const make = k => () => { builds++; return 'v' + k; };
  assert.equal(cache.get('a', make('a')), 'va');
  assert.equal(cache.get('b', make('b')), 'vb');
  assert.equal(cache.get('a', make('a')), 'va'); // hit: a becomes most recent
  assert.equal(builds, 2);
  cache.get('c', make('c'));                     // evicts b, the least recent
  assert.equal(cache.size(), 2);
  cache.get('a', make('a'));
  assert.equal(builds, 3);
  cache.get('b', make('b'));
  assert.equal(builds, 4);
  cache.clear();
  assert.equal(cache.size(), 0);
});

test('track drops a tween from the set when it completes or is interrupted, keeping its own callbacks', () => {
  const set = new Set(), done = [];
  const a = fakeTween(), b = fakeTween(), c = fakeTween();
  a.eventCallback('onComplete', () => done.push('a'));
  [a, b, c].forEach(t => track(set, t));
  assert.equal(set.size, 3);
  a.fire('onComplete');
  b.fire('onInterrupt');
  assert.deepEqual([...set], [c]);
  assert.deepEqual(done, ['a']);
});

test('tracked tweens stay bounded over many completed zooms', () => {
  const set = new Set();
  for (let i = 0; i < 1000; i++) { const t = fakeTween(); track(set, t); t.fire(i % 2 ? 'onComplete' : 'onInterrupt'); }
  assert.equal(set.size, 0);
});

// Pixi 8 falls back to its canvas renderer when there is no WebGL; that renderer has no mesh pipe, so the
// road would throw on every frame and the page would stay blank. mount() rejects instead, so live.js can
// show "Could not start the renderer".
test('mount rejects when Pixi falls back to the canvas renderer', async () => {
  let destroyed = false;
  class Application {
    init() { this.renderer = { type: 4, name: 'canvas' }; return Promise.resolve(); }
    destroy() { destroyed = true; }
  }
  const pixi = { extensions: { add() {} }, Application, RendererType: { WEBGL: 1, WEBGPU: 2, CANVAS: 4 } };
  const w = { PIXI: pixi, gsap: { ticker: { lagSmoothing() {} } }, Chicane: {}, devicePixelRatio: 1 };
  new Function('window', 'document', src)(w, { readyState: 'complete', getElementById: () => null });
  const pt = (x) => ({ x, y: 0, seg: 0, kind: 'straight', done: true });
  const model = { roadWidth: 38, laneWidth: 26, lanes: [], path: { points: [pt(0), pt(4), pt(8)], length: 8 }, progressS: 0, cars: [], spectators: [] };
  const appended = [];
  await assert.rejects(w.ChicaneRace.mount({ appendChild: (c) => appended.push(c) }, model, {}), /WebGL/);
  assert.equal(destroyed, true);
  assert.deepEqual(appended, []);
});
