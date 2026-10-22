// Chicane HUD: the progress meter, the driver list and the hazard legend with counts over the race canvas.
// Every string goes in through textContent, never markup, so hostile titles show as text. Map-only shows
// initials and no task lines, whatever the model carries.
// Classic script: defines window.ChicaneHud.
(function () {
  'use strict';
  var HAZARDS = [['pothole', 'Potholes', 'closed early'], ['debris', 'Debris', 'stalled 3+ days'], ['wreck', 'Wrecks', 'abandoned'], ['slick', 'Oil slicks', 'reopened']];
  var H = null; // { root, mapOnly, fill, label, drivers, hazards, expired, failed }

  function make(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function meterText(m) {
    if (!m.totalUnits) return 'No laps yet';
    // units to the flag = units left, the same as the summary's distance_to_finish
    return m.doneUnits + ' / ' + m.totalUnits + ' units · ' + m.turns + ' turns ahead · ' + (m.totalUnits - m.doneUnits) + ' units to the flag';
  }

  function driver(c, parent) {
    var row = make('div', 'driver' + (c.online === true ? ' on' : c.online === false ? ' off' : ''), undefined, parent);
    make('span', 'dot', undefined, row);
    make('b', null, H.mapOnly ? c.initials : c.name, row);
    if (c.isAgent) make('i', 'agent', 'AGENT', row);
    if (c.level !== null && c.level !== undefined) make('span', 'lvl', 'L' + c.level + (c.xp !== null && c.xp !== undefined ? ' · ' + c.xp + ' xp' : ''), row);
    if (!H.mapOnly) make('div', 'task', c.inPits ? 'in the pits' : (c.taskTitle || ''), row);
  }

  function update(m) {
    if (!H || !m) return;
    H.fill.style.width = (m.totalUnits ? (m.progress * 100).toFixed(1) : '0') + '%';
    H.label.textContent = meterText(m);
    H.drivers.textContent = '';
    m.cars.forEach(function (c) { driver(c, H.drivers); });
    var n = {}; m.hazards.forEach(function (h) { n[h.type] = (n[h.type] || 0) + 1; });
    H.hazards.textContent = '';
    HAZARDS.forEach(function (t) {
      var row = make('div', 'hz hz-' + t[0] + (n[t[0]] ? '' : ' none'), undefined, H.hazards);
      make('i', 'swatch', undefined, row); make('span', 'name', t[1], row); make('span', 'hint', ' · ' + t[2], row);
      make('b', null, String(n[t[0]] || 0), row);
    });
  }

  // model may be null (nothing loaded yet): the panels stay empty until update().
  function mount(el, model, opts) {
    el.textContent = '';
    var top = make('div', 'hud-top', undefined, el), side = make('div', 'hud-side', undefined, el);
    var meter = make('div', 'meter', undefined, top);
    H = { root: el, mapOnly: !!(opts && opts.mapOnly), fill: make('div', 'meter-fill', undefined, meter), label: make('div', 'meter-label', undefined, top),
      drivers: make('div', 'drivers', undefined, side), hazards: make('div', 'hazards', undefined, side), expired: null, failed: null };
    make('div', 'meter-flag', undefined, meter);
    update(model);
  }

  // A centred alert line, shown once per kind.
  function alertLine(kind, text) {
    if (!H || H[kind]) return;
    H.root.className = (H.root.className ? H.root.className + ' ' : '') + kind;
    H[kind] = make('div', 'hud-' + kind, text, H.root);
    H[kind].setAttribute('role', 'alert');
  }
  function expired() { alertLine('expired', 'This race link has expired.'); }
  function failed() { alertLine('failed', 'Could not start the renderer.'); }

  window.ChicaneHud = { mount: mount, update: update, expired: expired, failed: failed };
})();
