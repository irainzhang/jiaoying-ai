import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadFA } from './guardian/loader.mjs';

// Real map.js runs against a small DOM/event surface and a deterministic clock.
// These tests exercise its actual timer and delegated SVG event handlers;
// they do not claim touch-device or browser gesture compatibility.
function harness() {
  let now = 0, sequence = 0;
  const timers = new Map();
  const clock = {
    setTimeout(fn, delay) { const id = ++sequence; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
    advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers].filter(([, t]) => t.at <= target).sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at; timers.delete(next[0]); next[1].fn();
      }
      now = target;
    },
    pending() { return timers.size; }
  };
  class Element {
    constructor(tag) { this.tag = tag; this.attrs = {}; this.children = []; this.style = {}; this.events = {}; this.classes = new Set();
      this.classList = { add: v => this.classes.add(v), remove: v => this.classes.delete(v) }; }
    setAttribute(key, value) { this.attrs[key] = String(value); }
    getAttribute(key) { return this.attrs[key] ?? null; }
    appendChild(child) { child.parentNode = this; this.children.push(child); return child; }
    removeChild(child) { this.children.splice(this.children.indexOf(child), 1); child.parentNode = null; return child; }
    get firstChild() { return this.children[0] || null; }
    addEventListener(type, fn) { this.events[type] = fn; }
    getBoundingClientRect() { return { left: 10, top: 20, width: 460, height: 470 }; }
    find(predicate) { if (predicate(this)) return this; for (const child of this.children) { const match = child.find(predicate); if (match) return match; } return null; }
  }
  const FA = loadFA();
  FA.ui = {
    el: (tag, attrs = {}) => { const node = new Element(tag); Object.entries(attrs).forEach(([key, value]) => node.setAttribute(key, value)); return node; },
    escapeHtml: s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]))
  };
  const document = { createElementNS: (_, tag) => new Element(tag) };
  vm.runInNewContext(fs.readFileSync(new URL('../dist/guardian/agent/src/ui/map.js', import.meta.url), 'utf8'),
    { window: { FA }, document, setTimeout: clock.setTimeout, clearTimeout: clock.clearTimeout });
  const container = new Element('div'), hazards = [], selections = [];
  const map = FA.ui.map.create(container, { onLongPress: id => hazards.push(id), onSelect: id => selections.push(id) });
  map.render(FA.store.get());
  const svg = container.firstChild;
  const zoneTarget = id => svg.find(node => node.getAttribute('data-zone') === id).firstChild;
  function dispatch(type, target = zoneTarget('R01')) {
    const event = { target, clientX: 100, clientY: 120, defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; } };
    svg.events[type](event); return event;
  }
  return { map, clock, svg, zoneTarget, hazards, selections, dispatch };
}

test('pointerdown waits a full 600 ms, reports the nested SVG grid once, and suppresses short-click selection', () => {
  const h = harness();
  assert.equal(h.map.LONG_PRESS_MS, 600);
  assert.equal(h.dispatch('pointerdown').defaultPrevented, true);
  h.clock.advance(599);
  assert.deepEqual(h.hazards, []);
  h.clock.advance(1);
  assert.deepEqual(h.hazards, ['R01']);
  h.dispatch('pointerup');
  h.clock.advance(1200);
  assert.deepEqual(h.hazards, ['R01']);
  assert.deepEqual(h.selections, []);
  assert.equal(h.clock.pending(), 0);
});

test('pointerup before 600 ms cancels hazard reporting and retains ordinary grid selection', () => {
  const h = harness();
  h.dispatch('pointerdown'); h.clock.advance(599); h.dispatch('pointerup');
  h.clock.advance(2000);
  assert.deepEqual(h.hazards, []);
  assert.deepEqual(h.selections, ['R01']);
  assert.equal(h.map.selectedZone(), 'R01');
  assert.equal(h.clock.pending(), 0);
});

for (const type of ['pointercancel', 'pointerleave', 'pointermove']) {
  test(`${type} cancels a held grid without selecting or reporting it`, () => {
    const h = harness();
    h.dispatch('pointerdown'); h.clock.advance(300);
    h.dispatch(type, type === 'pointermove' ? h.zoneTarget('R02') : h.zoneTarget('R01'));
    h.clock.advance(1000);
    assert.deepEqual(h.hazards, []);
    assert.deepEqual(h.selections, []);
    assert.equal(h.clock.pending(), 0);
  });
}

test('contextmenu reaches the same hazard callback and grid ID as a completed long press', () => {
  const h = harness();
  h.dispatch('pointerdown', h.zoneTarget('R02')); h.clock.advance(600); h.dispatch('pointerup');
  const rightClick = h.dispatch('contextmenu', h.zoneTarget('R02'));
  assert.equal(rightClick.defaultPrevented, true);
  assert.deepEqual(h.hazards, ['R02', 'R02']);
  assert.deepEqual(h.selections, []);
  assert.equal(h.clock.pending(), 0);
});

test('pressing or right-clicking map background cannot submit an unidentified grid', () => {
  const h = harness();
  assert.equal(h.dispatch('pointerdown', h.svg).defaultPrevented, false);
  assert.equal(h.dispatch('contextmenu', h.svg).defaultPrevented, false);
  h.clock.advance(1000);
  assert.deepEqual(h.hazards, []);
  assert.equal(h.clock.pending(), 0);
});
