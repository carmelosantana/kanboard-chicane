// Chicane HUD: the progress meter, the driver list and the hazard counts over the race canvas.
// Every string goes in through textContent, never markup, so hostile titles show as text. Map-only shows
// initials and no task lines, whatever the model carries.
// Classic script: defines window.ChicaneHud.
(function () {
  'use strict';
  var HAZARDS = [['pothole', 'Potholes'], ['debris', 'Debris'], ['wreck', 'Wrecks'], ['slick', 'Oil slicks']];
  var H = null; // { root, mapOnly, fill, label, drivers, hazards, banner }

  function make(tag, cls, text, parent) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    if (parent) parent.appendChild(n);
    return n;
  }

  function meterText(m) {
    if (!m.totalUnits) return 'No laps yet';
    var UNIT = (window.Chicane && window.Chicane.UNIT) || 60, toFlag = Math.max(0, Math.round((m.finishS - m.progressS) / UNIT));
    return m.doneUnits + ' / ' + m.totalUnits + ' units · ' + m.turns + ' turns ahead · ' + toFlag + ' units to the flag';
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
      make('span', null, t[1], row); make('b', null, String(n[t[0]] || 0), row);
    });
  }

  // model may be null (nothing loaded yet): the panels stay empty until update().
  function mount(el, model, opts) {
    el.textContent = '';
    var top = make('div', 'hud-top', undefined, el), side = make('div', 'hud-side', undefined, el);
    var meter = make('div', 'meter', undefined, top);
    H = { root: el, mapOnly: !!(opts && opts.mapOnly), fill: make('div', 'meter-fill', undefined, meter), label: make('div', 'meter-label', undefined, top),
      drivers: make('div', 'drivers', undefined, side), hazards: make('div', 'hazards', undefined, side), banner: null };
    make('div', 'meter-flag', undefined, meter);
    update(model);
  }

  function expired() {
    if (!H || H.banner) return;
    H.root.className = (H.root.className ? H.root.className + ' ' : '') + 'expired';
    H.banner = make('div', 'hud-expired', 'This race link has expired.', H.root);
    H.banner.setAttribute('role', 'alert');
  }

  window.ChicaneHud = { mount: mount, update: update, expired: expired };
})();
