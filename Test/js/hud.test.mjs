import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// hud.js is a browser script; run it against a minimal fake DOM that records every element created, so the
// tests can prove text goes in as text (no markup parsing) and inspect what the HUD shows.
const trackSrc = readFileSync(new URL('../../Assets/js/track.js', import.meta.url), 'utf8');
const hudSrc = readFileSync(new URL('../../Assets/js/hud.js', import.meta.url), 'utf8');
const small = () => JSON.parse(readFileSync(new URL('../fixtures/state-small.json', import.meta.url), 'utf8'));

function fakeDom() {
  const created = [];
  function el(tag) {
    const node = {
      tagName: tag.toUpperCase(), children: [], className: '', style: {}, attrs: {}, _text: '', hidden: false,
      appendChild(c) { this.children.push(c); return c; },
      setAttribute(k, v) { this.attrs[k] = String(v); },
      get textContent() { return this._text + this.children.map(c => c.textContent).join(''); },
      set textContent(v) { this.children = []; this._text = String(v); },
      set innerHTML(v) { throw new Error('innerHTML used: ' + v); }
    };
    return node;
  }
  const document = { createElement(tag) { const n = el(tag); created.push(n); return n; } };
  return { document, created, root: el('div') };
}

function load() {
  const dom = fakeDom(), win = {};
  new Function('window', trackSrc)(win);
  new Function('window', 'document', hudSrc)(win, dom.document);
  return { C: win.Chicane, H: win.ChicaneHud, ...dom };
}

test('a hostile title lands in textContent and creates no img element', () => {
  const { C, H, root, created } = load();
  H.mount(root, C.build(small()), { mapOnly: false });
  assert.match(root.textContent, /<img src=x onerror=alert\(1\)>/);
  assert.equal(created.filter(n => n.tagName === 'IMG').length, 0);
});

test('the meter reads done / total units, turns ahead and units to the flag', () => {
  const { C, H, root } = load(), m = C.build(small());
  H.mount(root, m, { mapOnly: false });
  assert.match(root.textContent, new RegExp(m.doneUnits + ' / ' + m.totalUnits + ' units · ' + m.turns + ' turns ahead · \\d+ units to the flag'));
  assert.match(root.textContent, /Carmelo Santana/);
});

test('the hazard legend counts each hazard type', () => {
  const { C, H, root } = load(), m = C.build(small());
  H.mount(root, m, { mapOnly: false });
  const n = t => m.hazards.filter(h => h.type === t).length;
  assert.ok(n('pothole') > 0 && n('wreck') > 0, 'fixture has potholes and wrecks');
  assert.match(root.textContent, new RegExp('Potholes' + n('pothole')));
  assert.match(root.textContent, new RegExp('Wrecks' + n('wreck')));
  assert.match(root.textContent, /Oil slicks0/);
});

test('an empty race reads No laps yet', () => {
  const { C, H, root } = load(), s = small();
  s.tasks = [];
  H.mount(root, C.build(s), { mapOnly: false });
  assert.match(root.textContent, /No laps yet/);
  assert.doesNotMatch(root.textContent, /NaN/);
});

test('update replaces the shown model', () => {
  const { C, H, root } = load(), s = small();
  H.mount(root, C.build(s), { mapOnly: false });
  s.tasks = [];
  H.update(C.build(s));
  assert.match(root.textContent, /No laps yet/);
  assert.doesNotMatch(root.textContent, /onerror/);
});

test('expired shows This race link has expired.', () => {
  const { C, H, root } = load();
  H.mount(root, C.build(small()), { mapOnly: true });
  H.expired();
  assert.match(root.textContent, /This race link has expired\./);
});

test('map-only shows initials and no task line', () => {
  const { C, H, root } = load();
  H.mount(root, C.build(small()), { mapOnly: true });
  assert.match(root.textContent, /CS/);
  assert.doesNotMatch(root.textContent, /Carmelo|Santana|onerror|in the pits/);
});
