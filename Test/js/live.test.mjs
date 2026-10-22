import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// live.js is a browser script; load it with a document that has no #chicane-config, so its page boot
// finds nothing to do, and test the pure polling and storage helpers.
const src = readFileSync(new URL('../../Assets/js/live.js', import.meta.url), 'utf8');
const win = {};
new Function('window', 'document', src)(win, { readyState: 'complete', getElementById: () => null });
const L = win.ChicaneLive;

// A localStorage stand-in backed by a Map.
function memoryStorage() {
  const m = new Map();
  return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => { m.set(k, String(v)); } };
}

test('nextDelay polls at the configured interval while visible and not at all while hidden', () => {
  assert.equal(L.nextDelay({ visible: true, pollMs: 20000 }), 20000);
  assert.equal(L.nextDelay({ visible: false, pollMs: 20000 }), null);
});

test('onResponse maps 200, 304, 404 and anything else to update, same, expired and retry', () => {
  assert.equal(L.onResponse(200), 'update');
  assert.equal(L.onResponse(304), 'same');
  assert.equal(L.onResponse(404), 'expired');
  assert.equal(L.onResponse(500), 'retry');
});

test('storeKey is per URL', () => {
  assert.equal(L.storeKey('/race/abc/state.json'), 'chicane:last:/race/abc/state.json');
});

test('loadLast returns null without throwing when storage throws', () => {
  const broken = { getItem() { throw new Error('SecurityError'); }, setItem() { throw new Error('QuotaExceededError'); } };
  assert.equal(L.loadLast(broken, 'k'), null);
  assert.doesNotThrow(() => L.saveLast(broken, 'k', { etag: '"a"', state: {} }));
  assert.equal(L.loadLast(null, 'k'), null);
  assert.doesNotThrow(() => L.saveLast(null, 'k', {}));
});

test('loadLast returns null for an unreadable entry', () => {
  const s = memoryStorage();
  s.setItem('k', '{not json');
  assert.equal(L.loadLast(s, 'k'), null);
});

test('saveLast then loadLast round-trips', () => {
  const s = memoryStorage(), entry = { etag: '"abc"', state: { generated: 1, tasks: [{ id: 7, title: 'x' }] } };
  L.saveLast(s, 'k', entry);
  assert.deepEqual(L.loadLast(s, 'k'), entry);
  assert.equal(L.loadLast(s, 'other'), null);
});

// Drives start() with a scripted fetch and a manual timer queue.
function harness(responses, page) {
  const timers = [], calls = [], errors = [], w = Object.assign({}, page && page.globals);
  const doc = { readyState: 'complete', getElementById: id => (page && page.els[id]) || null, visibilityState: 'visible', addEventListener() {} };
  w.setTimeout = (fn, ms) => { timers.push({ fn, ms }); return timers.length; };
  w.clearTimeout = () => {};
  w.fetch = (url, init) => {
    calls.push({ url, inm: (init.headers || {})['If-None-Match'] || null });
    const r = responses.shift();
    return Promise.resolve({ status: r.status, headers: { get: k => (k.toLowerCase() === 'etag' ? r.etag || null : null) }, json: () => Promise.resolve(r.body) });
  };
  new Function('window', 'document', 'console', src)(w, doc, { error: (...a) => errors.push(a.join(' ')) });
  return { L: w.ChicaneLive, timers, calls, errors };
}
const tick = () => new Promise(r => setTimeout(r, 0));

test('start fetches, revalidates with If-None-Match, and stops polling on 404', async () => {
  const h = harness([
    { status: 200, etag: '"a"', body: { n: 1 } },
    { status: 304 },
    { status: 500 },
    { status: 200, etag: '"b"', body: { n: 2 } },
    { status: 404 }
  ]);
  const seen = []; let expired = 0;
  h.L.start({ stateUrl: '/s.json', pollMs: 20000, onState: (prev, next) => seen.push([prev && prev.etag, next.etag, next.state.n]), onExpired: () => expired++ });
  await tick();
  assert.deepEqual(seen, [[null, '"a"', 1]]);
  assert.equal(h.timers.length, 1);
  assert.equal(h.timers[0].ms, 20000);
  for (let i = 0; i < 4; i++) { h.timers[h.timers.length - 1].fn(); await tick(); }
  assert.deepEqual(h.calls.map(c => c.inm), [null, '"a"', '"a"', '"a"', '"b"']);
  assert.deepEqual(seen, [[null, '"a"', 1], ['"a"', '"b"', 2]]);
  assert.equal(expired, 1);
  assert.equal(h.timers.length, 4, 'no poll is scheduled after the link expires');
});

test('a failed onState does not keep the ETag, so the next poll refetches the state', async () => {
  const h = harness([
    { status: 200, etag: '"a"', body: { n: 1 } },
    { status: 200, etag: '"a"', body: { n: 1 } },
    { status: 304 }
  ]);
  const seen = []; let fail = true;
  h.L.start({ stateUrl: '/s.json', pollMs: 20000, onState: (prev, next) => { if (fail) { fail = false; throw new Error('build failed'); } seen.push([prev, next.etag]); }, onExpired() {} });
  await tick();
  assert.deepEqual(seen, []);
  assert.equal(h.errors.length, 1);
  h.timers[h.timers.length - 1].fn(); await tick();
  assert.deepEqual(seen, [[null, '"a"']], 'the refetch is treated as the first state');
  h.timers[h.timers.length - 1].fn(); await tick();
  assert.deepEqual(h.calls.map(c => c.inm), [null, null, '"a"']);
});

test('the page boot builds every model in the configured units mode and polls at the configured interval', async () => {
  const builds = [], mounts = [], hud = [];
  const cfg = { stateUrl: '/race/t/state.json', mapOnly: true, pollMs: 5000, units: 'complexity' };
  const page = {
    els: { 'chicane-config': { textContent: JSON.stringify(cfg) }, stage: {}, hud: {} },
    globals: {
      Chicane: { build: (state, opts) => { builds.push(opts); return { n: state.n }; } },
      ChicaneRace: { setMapOnly() {}, mount: (el, m) => { mounts.push(m.n); return Promise.resolve(); }, transition() {} },
      ChicaneHud: { mount: (el, m, o) => hud.push(['mount', o.mapOnly]), update: m => hud.push(['update', m.n]), expired() {} }
    }
  };
  const h = harness([{ status: 200, etag: '"a"', body: { n: 1 } }, { status: 200, etag: '"b"', body: { n: 2 } }], page);
  await tick(); await tick();
  assert.equal(h.timers[0].ms, 5000);
  h.timers[0].fn(); await tick(); await tick();
  assert.deepEqual(builds, [{ mode: 'complexity' }, { mode: 'complexity' }]);
  assert.deepEqual(mounts, [1]);
  assert.deepEqual(hud, [['mount', true], ['update', 2]]);
});
