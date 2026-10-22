// Chicane track model, engine-agnostic: turns a race state into a course.
// Every task is a corner reached by a short straight; a task with subtasks is a chicane of one turn per
// subtask. Turns are permanent: finishing work paves the road (point.done) instead of straightening it, so
// done work keeps the shape of the effort it took. Work stopped mid-flight leaves hazards: potholes, debris,
// wrecks, oil slicks. The global layout is a serpentine so the course stays bounded.
// Classic script, no dependencies: defines window.Chicane.
(function (root) {
  'use strict';
  var UNIT = 60, STEP = 4, ARC_STEP = 8, ROW_W = 2600, ROW_H = 700, LANE_W = 26, ROAD_MARGIN = 12;
  // Turn radius target, × half the road. The floor is 1.15 (edges never fold); the extra 0.05 absorbs the
  // spline's sampling error, which measures up to ~2% tighter than the arc it follows.
  var MIN_RADIUS = 1.2;
  var IN_PROGRESS = 'In progress', DONE_COL = 'Done', SUBTASK_DONE = 2;
  var COL_ORDER = { 'Done': 0, 'In progress': 1, 'Ready': 2, 'Backlog': 3, 'Ideas': 4 };

  function rng(seed) { return function () { seed |= 0; seed = seed + 0x6D2B79F5 | 0; var t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; }
  function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
  function lerp(a, b, t) { return a + (b - a) * t; }
  function initials(n) { // "Claude 2" → C2, single word → first two letters
    var w = String(n || '?').split(/[\s._-]+/).filter(Boolean);
    if (!w.length) return '?';
    return (w.length > 1 ? w[0][0] + w[1][0] : w[0].slice(0, 2)).toUpperCase();
  }
  // map-only states carry `blocked` as a boolean (tags are redacted); full states carry the tags
  function isBlocked(t) {
    return t.blocked === true || t.blocked_by.length > 0 || (t.tags || []).some(function (x) { return x === 'blocked' || x === 'needs-info'; });
  }
  function isWontfix(t) { return t.wontfix === true || (t.tags || []).indexOf('wontfix') >= 0; }

  // Ordered list of {task, column, lane, units:[{done}]}: closed by completion, then open by column, lane,
  // position. Unknown column titles sort after the known ones, by board position; a task in a swimlane that
  // is not listed (disabled) goes in lane 0.
  function orderTasks(state, mode) {
    var colTitle = {}, colRank = {};
    state.columns.forEach(function (c, i) {
      colTitle[c.id] = c.title;
      colRank[c.id] = COL_ORDER.hasOwnProperty(c.title) ? COL_ORDER[c.title] : 5 + i;
    });
    var lanePos = {}; state.swimlanes.forEach(function (l, i) { lanePos[l.id] = i; });
    function lane(t) { return lanePos.hasOwnProperty(t.swimlane_id) ? lanePos[t.swimlane_id] : 0; }
    function rank(t) { return colRank.hasOwnProperty(t.column_id) ? colRank[t.column_id] : 5 + state.columns.length; }
    var closed = state.tasks.filter(function (t) { return !t.open; }).sort(function (a, b) {
      return ((a.date_completed || 0) - (b.date_completed || 0)) || (a.id - b.id);
    });
    var open = state.tasks.filter(function (t) { return t.open; }).sort(function (a, b) {
      return (rank(a) - rank(b)) || (lane(a) - lane(b)) || (a.position - b.position) || (a.id - b.id);
    });
    return closed.concat(open).map(function (t) {
      var subs = t.subtasks.slice().sort(function (a, b) { return a.position - b.position; });
      var units;
      if (mode === 'complexity') {
        var n = Math.max(1, t.score || 0, subs.length);
        var openN = t.open ? (subs.length ? subs.filter(function (s) { return s.status !== SUBTASK_DONE; }).length : 1) : 0;
        units = [];
        for (var i = 0; i < n; i++) units.push({ done: i < n - openN });
      } else if (!subs.length) {
        units = [{ done: !t.open, sweeper: true }];
      } else {
        // done first (behind you), then open (the turns ahead). A closed task's unfinished subtasks stay
        // undone but paved: they are the potholes.
        units = subs.map(function (s) { return { done: s.status === SUBTASK_DONE, paved: !t.open }; })
          .sort(function (a, b) { return b.done - a.done; });
      }
      return { task: t, column: colTitle[t.column_id], lane: lane(t), units: units };
    });
  }

  // Turtle walk: each step is a circular arc laid down as control points every ARC_STEP px, then centripetal
  // Catmull-Rom resampled every STEP px. A step of length len turning by dh has radius len/|dh|; lengths are
  // chosen so that radius is ≥ MIN_RADIUS × half the road, so the offset road edges never fold. Geometry
  // depends only on task id and unit count, never on done-ness: finishing work never moves the road.
  function layout(ordered, roadW) {
    var x = 0, y = 0, h = 0, dir = 1, phase = 'run', rowY = 0, half = roadW / 2;
    var ctrl = [{ x: x, y: y, seg: 0, kind: 'straight', done: true }];
    function desired() { return phase === 'run' ? (dir > 0 ? 0 : Math.PI) : Math.PI / 2; }
    function arcLen(minLen, dh) { return Math.max(minLen, MIN_RADIUS * half * Math.abs(dh)); }
    function advance(len, dh, seg, kind, done) {
      var n = Math.max(1, Math.ceil(len / ARC_STEP));
      for (var k = 0; k < n; k++) {
        h += dh / (2 * n); x += Math.cos(h) * len / n; y += Math.sin(h) * len / n; h += dh / (2 * n);
        ctrl.push({ x: x, y: y, seg: seg, kind: kind, done: done });
      }
      if (phase === 'run' && ((dir > 0 && x > ROW_W) || (dir < 0 && x < 0))) { phase = 'drop'; rowY = y; }
      else if (phase === 'drop' && y > rowY + ROW_H) { phase = 'run'; dir = -dir; }
    }
    ordered.forEach(function (o, si) {
      var r = rng(o.task.id * 7919 + 13), alt = r() < 0.5 ? 1 : -1;
      var tDone = o.units.every(function (u) { return u.done || u.paved; });
      // the lead-in straight relaxes toward the row direction
      var lead = Math.max(-0.21, Math.min(0.21, wrap(desired() - h)));
      advance(arcLen(UNIT * 0.4, lead), lead, si, 'straight', tDone);
      o.units.forEach(function (u) {
        var mag = u.sweeper ? 0.25 + r() * 0.3 : 0.4 + r() * 0.6, d2 = wrap(desired() - h), sgn;
        sgn = Math.abs(d2) > 0.35 ? Math.sign(d2) : alt; alt = -alt; // chicane: alternate
        if (Math.abs(wrap(h + sgn * mag - desired())) > 1.75) sgn = -sgn; // never loop back on the row
        var dh = sgn * mag / 4, len = arcLen(UNIT * 0.35, dh);
        for (var q = 0; q < 4; q++) advance(len, dh, si, 'turn', u.done || !!u.paved);
      });
    });
    return resample(ctrl);
  }

  function cr(p0, p1, p2, p3, t) { // centripetal Catmull-Rom (alpha .5)
    function tj(ti, a, b) { return ti + Math.pow(Math.hypot(b.x - a.x, b.y - a.y), 0.5) || ti + 1e-4; }
    var t0 = 0, t1 = tj(t0, p0, p1), t2 = tj(t1, p1, p2), t3 = tj(t2, p2, p3), tt = t1 + (t2 - t1) * t;
    function L(a, b, ta, tb) { var k = (tt - ta) / (tb - ta || 1e-4); return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; }
    var A1 = L(p0, p1, t0, t1), A2 = L(p1, p2, t1, t2), A3 = L(p2, p3, t2, t3), B1 = L(A1, A2, t0, t2), B2 = L(A2, A3, t1, t3);
    return L(B1, B2, t1, t2);
  }

  function resample(ctrl) {
    var last = ctrl[ctrl.length - 1];
    if (ctrl.length < 2) {
      return { points: [{ x: last.x, y: last.y, s: 0, seg: last.seg, kind: 'straight', done: last.done, heading: 0, curv: 0 }], length: 0, step: STEP };
    }
    var dense = [], i;
    for (i = 0; i < ctrl.length - 1; i++) {
      var p0 = ctrl[Math.max(0, i - 1)], p1 = ctrl[i], p2 = ctrl[i + 1], p3 = ctrl[Math.min(ctrl.length - 1, i + 2)];
      for (var k = 0; k < 8; k++) { var q = cr(p0, p1, p2, p3, k / 8); q.seg = p2.seg; q.kind = p2.kind; q.done = p2.done; dense.push(q); }
    }
    dense.push({ x: last.x, y: last.y, seg: last.seg, kind: 'straight', done: last.done });
    var cum = [0]; for (i = 1; i < dense.length; i++) cum.push(cum[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
    var len = cum[cum.length - 1], pts = [], j = 0;
    for (var s = 0; s <= len; s += STEP) {
      while (j < cum.length - 2 && cum[j + 1] < s) j++;
      var f = (s - cum[j]) / ((cum[j + 1] - cum[j]) || 1), a = dense[j], b = dense[j + 1];
      pts.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, s: s, seg: b.seg, kind: b.kind, done: b.done });
    }
    headings(pts);
    return { points: pts, length: len, step: STEP };
  }

  // Heading from neighbours; curvature in rad per px, smoothed over ±3 samples.
  function headings(pts) {
    var i, n = pts.length;
    for (i = 0; i < n; i++) {
      var pa = pts[Math.max(0, i - 1)], pb = pts[Math.min(n - 1, i + 1)];
      pts[i].heading = n > 1 ? Math.atan2(pb.y - pa.y, pb.x - pa.x) : 0;
    }
    for (i = 0; i < n; i++) {
      var i0 = Math.max(0, i - 3), i1 = Math.min(n - 1, i + 3), ds = pts[i1].s - pts[i0].s;
      pts[i].curv = ds > 0 ? wrap(pts[i1].heading - pts[i0].heading) / ds : 0;
    }
  }

  // Point at arc length s; binary search so it works on a morphed path whose points are not evenly spaced.
  function sample(path, s) {
    var p = path.points;
    if (p.length < 2) return { x: p[0].x, y: p[0].y, heading: p[0].heading, curv: p[0].curv, kind: p[0].kind, seg: p[0].seg, done: p[0].done };
    var lo = 0, hi = p.length - 2;
    while (lo < hi) { var mid = (lo + hi + 1) >> 1; if (p[mid].s <= s) lo = mid; else hi = mid - 1; }
    var a = p[lo], b = p[lo + 1], f = Math.max(0, Math.min(1, (s - a.s) / ((b.s - a.s) || 1)));
    return { x: lerp(a.x, b.x, f), y: lerp(a.y, b.y, f), heading: a.heading + wrap(b.heading - a.heading) * f, curv: a.curv, kind: a.kind, seg: a.seg, done: a.done };
  }
  function offset(pt, d) { return { x: pt.x - Math.sin(pt.heading) * d, y: pt.y + Math.cos(pt.heading) * d }; }

  function build(state, opts) {
    opts = opts || {};
    var mode = opts.mode || 'subtask', now = state.generated;
    var nLanes = Math.max(1, state.swimlanes.length), roadW = nLanes * LANE_W + ROAD_MARGIN;
    var ordered = orderTasks(state, mode), path = layout(ordered, roadW);
    var lanes = state.swimlanes.map(function (l, i) { return { id: l.id, name: l.name, offset: (i - (nLanes - 1) / 2) * LANE_W }; });
    var segs = ordered.map(function (o, i) {
      var t = o.task;
      return { index: i, taskId: t.id, title: t.title, column: o.column, open: t.open, lane: o.lane,
        units: o.units.length, doneUnits: o.units.filter(function (u) { return u.done; }).length, s0: Infinity, s1: 0,
        blocked: isBlocked(t),
        comments: t.comments, ownerId: t.owner_id };
    });
    path.points.forEach(function (p) { var g = segs[p.seg]; if (g) { g.s0 = Math.min(g.s0, p.s); g.s1 = Math.max(g.s1, p.s); } });
    var laid = function (g) { return isFinite(g.s0); };
    var total = 0, done = 0; segs.forEach(function (g) { total += g.units; done += g.doneUnits; });
    var agents = state.agent_uids || [];

    // cars: one per member with an in-progress task, parked at the front of that task's open part
    var cars = state.users.map(function (u, ui) {
      var mine = segs.filter(function (g) { return g.open && g.column === IN_PROGRESS && g.ownerId === u.id && laid(g); });
      var g = mine.sort(function (a, b) { return (b.doneUnits / b.units - a.doneUnits / a.units) || (a.index - b.index); })[0];
      return { userId: u.id, name: u.name, initials: initials(u.name), isAgent: agents.indexOf(u.id) >= 0,
        online: u.online === undefined ? null : u.online, level: u.level === undefined ? null : u.level, xp: u.xp === undefined ? null : u.xp,
        lane: g ? g.lane : ui % nLanes, s: g ? Math.min(g.s1, g.s0 + (g.s1 - g.s0) * (g.doneUnits / g.units) + 6) : 0,
        inPits: !g, taskId: g ? g.taskId : null, taskTitle: g ? g.title : null, color: ui };
    });

    // spectators: one per comment, in a grandstand on the outside of the turn beside its segment
    var spectators = [];
    segs.forEach(function (g) {
      if (!laid(g)) return;
      var side = sample(path, (g.s0 + g.s1) / 2).curv > 0 ? -1 : 1;
      g.comments.forEach(function (c, k) {
        spectators.push({ taskId: g.taskId, s: g.s0 + (g.s1 - g.s0) * ((k % 12) + 0.5) / 12, side: side, row: Math.floor(k / 12),
          recent: now - c.date < 48 * 3600 });
      });
    });

    // hazards: work stopped mid-flight
    var hazards = [], reopened = state.reopened || [];
    segs.forEach(function (g, i) {
      if (!laid(g)) return;
      var t = ordered[i].task, r = rng(t.id * 31 + 7), len = g.s1 - g.s0, mid = (g.s0 + g.s1) / 2;
      var lane = function () { return Math.floor(r() * nLanes); };
      var openSubs = t.subtasks.filter(function (x) { return x.status !== SUBTASK_DONE; }).length;
      // potholes: closed (or parked in Done) with subtasks still open, one per unfinished subtask
      var holes = !t.open || g.column === DONE_COL ? openSubs : 0;
      for (var k = 0; k < holes; k++) hazards.push({ type: 'pothole', taskId: t.id, s: g.s0 + len * (k + 0.5) / holes, lane: lane() });
      // debris: in progress but not moved for 3+ days, more tyres the longer it sits
      var idle = Math.floor((now - t.date_moved) / 86400);
      if (t.open && g.column === IN_PROGRESS && idle >= 3)
        hazards.push({ type: 'debris', taskId: t.id, s: g.s0 + len * (g.doneUnits / g.units), lane: g.lane, days: idle, level: Math.min(5, Math.ceil(idle / 3)) });
      // wreck: abandoned (wontfix, or closed without finishing any of its subtasks)
      if (isWontfix(t) || (!t.open && t.subtasks.length && !t.subtasks.some(function (x) { return x.status === SUBTASK_DONE; })))
        hazards.push({ type: 'wreck', taskId: t.id, s: mid, side: r() < 0.5 ? -1 : 1 });
      // oil slick: reopened after being closed
      if (t.open && reopened.indexOf(t.id) >= 0) hazards.push({ type: 'slick', taskId: t.id, s: mid, lane: lane(), radius: 40 });
    });
    var barriers = segs.filter(function (g) { return g.blocked && g.open && laid(g); })
      .map(function (g) { return { taskId: g.taskId, s: (g.s0 + g.s1) / 2, lane: g.lane }; });

    // progress frontier: the first unpaved point; road behind it is paved, ahead is raw
    var front = null;
    for (var p = 0; p < path.points.length && !front; p++) if (!path.points[p].done) front = path.points[p];
    return { mode: mode, path: path, segments: segs, lanes: lanes, roadWidth: roadW, laneWidth: LANE_W, cars: cars, spectators: spectators,
      barriers: barriers, hazards: hazards, totalUnits: total, doneUnits: done, progress: total ? done / total : 0,
      progressS: front ? front.s : path.length, finishS: path.length,
      turns: segs.reduce(function (n, g) { return n + g.units - g.doneUnits; }, 0) };
  }

  // [first, end) point index per segment, computed once per path: a segment's points are contiguous.
  var rangeCache = typeof WeakMap === 'function' ? new WeakMap() : null;
  function segRanges(path) {
    var ranges = rangeCache && rangeCache.get(path);
    if (ranges) return ranges;
    ranges = [];
    path.points.forEach(function (p, i) { var r = ranges[p.seg]; if (r) r[1] = i + 1; else ranges[p.seg] = [i, i + 1]; });
    if (rangeCache) rangeCache.set(path, ranges);
    return ranges;
  }

  // Morph aligned by task: each task's points interpolate by fraction within its own segment, so adding,
  // removing or reshaping one task leaves the rest of the road in place. A task only in `to` grows from a
  // point at its predecessor's end; a task only in `from` shrinks to one. `t` should already be eased.
  function morph(from, to, t) {
    var fromSegs = {}, out = [];
    from.segments.forEach(function (g) { fromSegs[g.taskId] = g; });
    function segPoints(model, g) { var r = segRanges(model.path)[g.index]; return r ? model.path.points.slice(r[0], r[1]) : []; }
    // s in `from` of a `to` point at the same fraction of its segment (exact when the segment is unchanged)
    function fromS(q, g, fg) { return fg.s0 + (q.s - g.s0) * (g.s1 > g.s0 ? (fg.s1 - fg.s0) / (g.s1 - g.s0) : 0); }
    function point(a, b, k, toSeg, kindDone) {
      return { x: lerp(a.x, b.x, k), y: lerp(a.y, b.y, k), heading: a.heading + wrap(b.heading - a.heading) * k,
        curv: lerp(a.curv, b.curv, k), kind: kindDone.kind, seg: toSeg, done: kindDone.done };
    }
    var fromAnchor = from.path.points[0], toAnchor = to.path.points[0], toIdx = {};
    to.segments.forEach(function (g) { toIdx[g.taskId] = g; });
    // removed tasks wait in `from` order and are emitted after the shared/new task that preceded them
    var pendingRemoved = {}, lastKept = null;
    from.segments.forEach(function (g) {
      if (toIdx.hasOwnProperty(g.taskId)) lastKept = g.taskId;
      else (pendingRemoved[lastKept] = pendingRemoved[lastKept] || []).push(g);
    });
    function emitRemoved(key, seg) {
      (pendingRemoved[key] || []).forEach(function (g) {
        segPoints(from, g).forEach(function (p) { out.push(point(p, toAnchor, t, seg, p)); });
        fromAnchor = sample(from.path, g.s1);
      });
    }
    emitRemoved(null, 0);
    to.segments.forEach(function (g) {
      var fg = fromSegs[g.taskId], pts = segPoints(to, g);
      pts.forEach(function (q) {
        var a = fg ? sample(from.path, fromS(q, g, fg)) : fromAnchor;
        out.push(point(a, q, t, g.index, t < 0.5 && fg ? a : q));
      });
      if (fg) fromAnchor = sample(from.path, fg.s1);
      if (pts.length) toAnchor = pts[pts.length - 1];
      emitRemoved(g.taskId, g.index);
    });
    if (!out.length) out = to.path.points.map(function (p) { return point(p, p, 0, p.seg, p); });
    out[0].s = 0;
    for (var i = 1; i < out.length; i++) out[i].s = out[i - 1].s + Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y);
    var len = out[out.length - 1].s;
    return { points: out, length: len, step: out.length > 1 ? len / (out.length - 1) : STEP };
  }

  // Speed profile: fast on straights, slow in turns (px per second).
  function speedAt(curv) { return 520 / (1 + Math.abs(curv) * 160); }

  root.Chicane = { build: build, sample: sample, offset: offset, morph: morph, speedAt: speedAt, UNIT: UNIT };
})(window);
