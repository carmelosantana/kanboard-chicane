// Chicane live updates: polls state.json every config.pollMs (20 s) while the tab is visible (ETag revalidation), replays
// the morph from this viewer's last visit, and boots the page. The last seen state is a per-viewer, per-URL
// convenience in localStorage (the newest 3 boards only); any storage failure just skips the replay.
// Classic script: defines window.ChicaneLive and boots the page (the only boot path).
(function () {
  'use strict';
  var REPLAY_S = 3.2, UPDATE_S = 1.6;

  function nextDelay(o) { return o.visible ? o.pollMs : null; }
  function onResponse(status) {
    return status === 200 ? 'update' : status === 304 ? 'same' : status === 404 ? 'expired' : 'retry';
  }
  var PREFIX = 'chicane:last:', KEEP = 3;
  function storeKey(stateUrl) { return PREFIX + stateUrl; }
  function loadLast(storage, key) {
    try { var v = storage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
  }
  // Saves {saved, etag, state}, then keeps only the KEEP most recently saved chicane:last entries (one per
  // board link), so links opened once do not pile up. Entries without a readable time go first.
  function saveLast(storage, key, entry, now) {
    try {
      storage.setItem(key, JSON.stringify({ saved: now === undefined ? Date.now() : now, etag: entry.etag, state: entry.state }));
    } catch (e) { return; /* full, blocked or private: no replay */ }
    prune(storage);
  }
  function prune(storage) {
    try {
      var entries = [];
      for (var i = 0; i < storage.length; i++) {
        var k = storage.key(i);
        if (typeof k === 'string' && k.indexOf(PREFIX) === 0) {
          var v = loadLast(storage, k);
          entries.push({ key: k, saved: v && typeof v.saved === 'number' ? v.saved : 0 });
        }
      }
      entries.sort(function (a, b) { return b.saved - a.saved; });
      entries.slice(KEEP).forEach(function (x) { storage.removeItem(x.key); });
    } catch (e) { /* storage refused: leave it as it is */ }
  }
  function visible() { return document.visibilityState !== 'hidden'; }

  // Fetches now, then every nextDelay() while visible. onState(prev, next) gets {etag, state} entries
  // (prev null on the first); a 404 stops polling and calls onExpired(); errors and other statuses retry.
  // The ETag is kept only once onState has taken the state, so a failed build refetches rather than 304s.
  function start(o) {
    var cur = null, timer = null, busy = false, stopped = false;
    function schedule() {
      if (stopped) return;
      var ms = nextDelay({ visible: visible(), pollMs: o.pollMs });
      if (ms !== null) timer = window.setTimeout(poll, ms);
    }
    function poll() {
      timer = null;
      if (stopped || busy) return;
      busy = true;
      var headers = { Accept: 'application/json' };
      if (cur && cur.etag) headers['If-None-Match'] = cur.etag;
      window.fetch(o.stateUrl, { credentials: 'same-origin', cache: 'no-store', headers: headers })
        .then(function (res) {
          var what = onResponse(res.status);
          if (what === 'expired') { stopped = true; o.onExpired(); return; }
          if (what !== 'update') return;
          return res.json().then(function (state) {
            var next = { etag: res.headers.get('ETag'), state: state };
            o.onState(cur, next);
            cur = next;
          });
        })
        .catch(function (err) { console.error('chicane: poll failed', err); })
        .then(function () { busy = false; schedule(); });
    }
    if (document.addEventListener) document.addEventListener('visibilitychange', function () {
      if (stopped) return;
      if (!visible()) { if (timer) { window.clearTimeout(timer); timer = null; } }
      else if (!timer && !busy) poll(); // catch up on return, then resume the interval
    });
    poll();
  }

  window.ChicaneLive = { nextDelay: nextDelay, onResponse: onResponse, storeKey: storeKey, loadLast: loadLast, saveLast: saveLast, start: start };

  // ---------- page boot ----------
  function storage() { try { return window.localStorage; } catch (e) { return null; } }
  function boot() {
    var cfgEl = document.getElementById('chicane-config'), stage = document.getElementById('stage'), hudEl = document.getElementById('hud');
    if (!cfgEl || !stage || !hudEl) return;
    var R = window.ChicaneRace, H = window.ChicaneHud, C = window.Chicane;
    var cfg = JSON.parse(cfgEl.textContent), key = storeKey(cfg.stateUrl), store = storage();
    var reduced = !!(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
    var mode = { mode: cfg.units }, model = null, ready = Promise.resolve(); // renderer calls run in order, each after the last settles
    R.setMapOnly(cfg.mapOnly);
    function run(step) { ready = ready.then(step).catch(function (err) { console.error('chicane: could not draw the race', err); }); }
    start({
      stateUrl: cfg.stateUrl,
      pollMs: cfg.pollMs,
      onState: function (prev, next) {
        var to = C.build(next.state, mode);
        if (!prev) {
          var last = loadLast(store, key), from = null;
          if (last && last.etag !== next.etag && last.state) {
            try { from = C.build(last.state, mode); } catch (e) { from = null; } // a stale or corrupt entry: no replay
          }
          run(function () {
            return R.mount(stage, from || to, { reducedMotion: reduced }).then(function () {
              H.mount(hudEl, from || to, { mapOnly: cfg.mapOnly });
              if (from) { R.transition(from, to, { duration: REPLAY_S }); H.update(to); } // since your last visit
            });
          });
        } else {
          var was = model;
          run(function () { R.transition(was, to, { duration: UPDATE_S }); H.update(to); });
        }
        model = to;
        saveLast(store, key, next);
      },
      onExpired: function () {
        run(function () { if (!model) H.mount(hudEl, null, { mapOnly: cfg.mapOnly }); H.expired(); });
      }
    });
  }
  // Kanboard's asset helper emits `defer` scripts: they run in order while readyState is 'interactive', all
  // before DOMContentLoaded, so waiting for it puts hud.js (loaded after this file) in place.
  if (document.readyState === 'complete') boot(); else document.addEventListener('DOMContentLoaded', boot);
})();
