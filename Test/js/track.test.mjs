import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const src = readFileSync(new URL('../../Assets/js/track.js', import.meta.url), 'utf8');
const win = {};
new Function('window', src)(win);
const C = win.Chicane;

const small = () => JSON.parse(readFileSync(new URL('../fixtures/state-small.json', import.meta.url), 'utf8'));
const NOW = 1761100000, DAY = 86400;

// A deterministic board with no hazards: closed tasks finished every subtask, in-progress work moved today.
function generate(nTasks, nLanes = 2, seed = 1) {
  let x = seed;
  const rnd = () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
  const columns = ['Backlog', 'Ready', 'In progress', 'Done'].map((title, i) => ({ id: i + 1, title, position: i + 1 }));
  const swimlanes = Array.from({ length: nLanes }, (_, i) => ({ id: i + 1, name: 'Lane ' + (i + 1), position: i + 1 }));
  const users = [1, 2, 3].map(id => ({ id, name: 'User ' + id, username: 'u' + id, online: null, xp: null, level: null }));
  const tasks = [];
  for (let i = 0; i < nTasks; i++) {
    const open = rnd() < 0.6, n = Math.floor(rnd() * 5);
    const column_id = open ? 1 + Math.floor(rnd() * 3) : 4;
    const subtasks = Array.from({ length: n }, (_, k) => ({ status: open ? (rnd() < 0.4 ? 2 : 0) : 2, position: k + 1, user_id: 1 }));
    tasks.push({ id: 1000 + i, title: '', open, column_id, swimlane_id: 1 + (i % nLanes), owner_id: 1 + (i % 3), position: i,
      score: 0, date_moved: NOW, date_completed: open ? null : NOW - (nTasks - i) * 60, tags: [], blocked_by: [], subtasks, comments: [] });
  }
  return { generated: NOW, window_days: 30, project_id: 1, swimlanes, columns, users, agent_uids: [], reopened: [], tasks };
}

const hazardsOf = (m, type) => m.hazards.filter(h => h.type === type);
const minRadius = m => 1 / Math.max(...m.path.points.map(p => Math.abs(p.curv)));

test('deterministic', () => {
  assert.deepEqual(C.build(small()).path.points, C.build(small()).path.points);
});

test('completing a subtask moves no road', () => {
  const before = C.build(small()), s = small();
  s.tasks.find(t => t.id === 102).subtasks[2].status = 2;
  const after = C.build(s);
  assert.equal(after.path.points.length, before.path.points.length);
  const moved = Math.max(...after.path.points.map((p, i) => Math.hypot(p.x - before.path.points[i].x, p.y - before.path.points[i].y)));
  assert.equal(moved, 0);
  assert.equal(after.doneUnits, before.doneUnits + 1);
});

test('paving', () => {
  const m = C.build(small()), pts = m.path.points;
  assert.ok(pts.some(p => p.done) && pts.some(p => !p.done));
  assert.equal(m.progressS, pts.find(p => !p.done).s);
});

test('min radius stays above 1.15 x half the road', () => {
  for (const [name, state] of [['small', small()], ['700 tasks', generate(700)], ['8 lanes', generate(200, 8)]]) {
    const m = C.build(state);
    assert.ok(minRadius(m) >= 1.15 * m.roadWidth / 2, `${name}: radius ${minRadius(m)} < ${1.15 * m.roadWidth / 2}`);
  }
});

test('hazards: potholes for open subtasks on a closed task', () => {
  const s = generate(10), t = s.tasks.find(t => !t.open);
  t.subtasks = [{ status: 2, position: 1, user_id: 1 }, { status: 0, position: 2, user_id: 1 }, { status: 0, position: 3, user_id: 1 }];
  assert.equal(hazardsOf(C.build(s), 'pothole').filter(h => h.taskId === t.id).length, 2);
});

test('hazards: debris on in-progress work idle for a week', () => {
  const s = generate(10), t = s.tasks[0];
  Object.assign(t, { open: true, column_id: 3, date_moved: NOW - 7 * DAY });
  const debris = hazardsOf(C.build(s), 'debris');
  assert.equal(debris.length, 1);
  assert.equal(debris[0].level, 3);
});

test('hazards: wreck for wontfix, as a map-only boolean or a full-mode tag', () => {
  const s = generate(10);
  s.tasks[0].wontfix = true;
  assert.equal(hazardsOf(C.build(s), 'wreck').length, 1);
  const f = generate(10);
  f.tasks[0].tags = ['wontfix'];
  assert.equal(hazardsOf(C.build(f), 'wreck').length, 1);
});

test('hazards: slick on a reopened open task', () => {
  const s = generate(10), t = s.tasks.find(t => t.open);
  s.reopened = [t.id];
  assert.deepEqual(hazardsOf(C.build(s), 'slick').map(h => h.taskId), [t.id]);
});

test('hazards: none on a clean board', () => {
  assert.deepEqual(C.build(generate(60)).hazards, []);
});

test('cars', () => {
  const s = small();
  s.users.push({ id: 3, name: 'Idle Ida', username: 'ida', online: true, xp: 40, level: 2 });
  s.tasks.push({ ...s.tasks[1], id: 105, owner_id: 99, subtasks: [], comments: [] }); // orphan owner, not a member
  const m = C.build(s), seg = m.segments.find(g => g.taskId === 102);
  const carmelo = m.cars.find(c => c.userId === 1), ida = m.cars.find(c => c.userId === 3);
  assert.equal(carmelo.taskId, 102);
  assert.ok(carmelo.s >= seg.s0 && carmelo.s <= seg.s1);
  assert.equal(carmelo.inPits, false);
  assert.equal(carmelo.online, null);
  assert.equal(carmelo.level, null);
  assert.equal(ida.inPits, true);
  assert.equal(ida.online, true);
  assert.equal(ida.level, 2);
  assert.equal(m.cars.some(c => c.userId === 99), false);
  assert.equal(m.cars.length, 3);
});

test('recent spectators', () => {
  const s = generate(4);
  s.tasks[0].comments = [{ user_id: 1, date: NOW - 47 * 3600 }, { user_id: 1, date: NOW - 49 * 3600 }];
  const sp = C.build(s).spectators.filter(x => x.taskId === s.tasks[0].id);
  assert.deepEqual(sp.map(x => x.recent), [true, false]);
});

test('speedAt', () => {
  assert.equal(C.speedAt(0), 520);
  assert.ok(Math.abs(C.speedAt(0.01) - 520 / 2.6) < 1e-9);
});

test('morph by task: appending a task leaves the road before it untouched at t=0', () => {
  const s = small(), from = C.build(s);
  s.tasks.push({ ...s.tasks[2], id: 106, tags: [], blocked_by: [], position: 2,
    subtasks: [{ status: 0, position: 1, user_id: 2 }, { status: 0, position: 2, user_id: 2 }] });
  const to = C.build(s);
  assert.equal(to.segments[to.segments.length - 1].taskId, 106);
  const out = C.morph(from, to, 0);
  // Every segment ahead of the last shared one is laid out identically in both models; the last shared
  // segment's tail bends toward the new task (the spline's end condition changes), so it is checked on-road.
  const lastShared = to.segments.length - 2;
  const exact = from.path.points.filter(p => p.seg < lastShared);
  assert.ok(exact.length > 0);
  exact.forEach((p, i) => {
    assert.equal(out.points[i].x, p.x);
    assert.equal(out.points[i].y, p.y);
  });
  // The new task starts as a zero-length point and is full length at t=1.
  const grown = out.points.filter(p => p.seg === to.segments.length - 1);
  assert.ok(grown.every(p => p.x === grown[0].x && p.y === grown[0].y));
  const end = C.morph(from, to, 1);
  assert.equal(end.points.length, to.path.points.length);
  end.points.forEach((p, i) => { assert.ok(Math.hypot(p.x - to.path.points[i].x, p.y - to.path.points[i].y) < 1e-9); });
  assert.ok(Math.abs(end.length / to.path.points.at(-1).s - 1) < 1e-3); // s is re-measured along chords
});

test('morph by task: a removed task shrinks to a point', () => {
  const s = small(), from = C.build(s);
  s.tasks = s.tasks.filter(t => t.id !== 102);
  const to = C.build(s), out = C.morph(from, to, 1);
  const lens = [];
  for (let i = 1; i < out.points.length; i++) lens.push(out.points[i].s - out.points[i - 1].s);
  assert.ok(lens.every(d => d >= 0));
  assert.ok(Math.abs(out.length / to.path.points.at(-1).s - 1) < 1e-3);
});

test('buildEmptyState', () => {
  for (const s of [{ ...small(), tasks: [] }, { ...small(), tasks: [], swimlanes: [], columns: [], users: [] }]) {
    const m = C.build(s);
    assert.equal(m.totalUnits, 0);
    assert.equal(m.progress, 0);
    assert.ok(m.path.points.length >= 1);
    assert.equal(JSON.stringify(m).includes('NaN'), false);
    assert.equal(JSON.stringify(C.sample(m.path, 10)).includes('null'), false);
  }
});

test('a task in a disabled swimlane goes in lane 0', () => {
  const s = small();
  s.tasks[2].swimlane_id = 77;
  assert.equal(C.build(s).segments.find(g => g.taskId === 103).lane, 0);
});

test('perf: 3000 tasks build in under 500 ms', () => {
  const s = generate(3000);
  const t0 = performance.now();
  C.build(s);
  const ms = performance.now() - t0;
  assert.ok(ms < 500, `${ms.toFixed(0)} ms`);
});

test('progress matches the PHP RaceSummary frozen total', () => {
  assert.equal(Math.round(C.build(small()).progress * 1000) / 10, 42.9);
  assert.equal(C.build(small()).totalUnits - C.build(small()).doneUnits, 4);
});
