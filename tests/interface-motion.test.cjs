'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const source = fs.readFileSync(path.join(__dirname, '../dist/interface-motion.js'), 'utf8');

// A deliberately small DOM and deterministic clock. Tests execute the shipped
// module and inspect behavior rather than searching its implementation text.
function harness() {
  const tasks = new Map();
  let clock = 0, nextID = 1;
  const setTimeout = (fn, delay = 0) => {
    const id = nextID++;
    tasks.set(id, { at: clock + delay, fn });
    return id;
  };
  const clearTimeout = id => tasks.delete(id);
  function tick(ms) {
    const end = clock + ms;
    let count = 0;
    while (true) {
      const next = [...tasks].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at || a[0] - b[0])[0];
      if (!next) break;
      assert.ok(count++ < 10000, 'bounded timer execution');
      clock = next[1].at;
      tasks.delete(next[0]);
      next[1].fn();
    }
    clock = end;
  }
  function events(target = {}) {
    const listeners = new Map();
    target.addEventListener = (type, fn) => {
      if (!listeners.has(type)) listeners.set(type, []);
      listeners.get(type).push(fn);
    };
    target.emit = (type, event = {}) => {
      for (const fn of listeners.get(type) || []) fn(event);
    };
    return target;
  }
  class Element {
    constructor(tag = 'div') {
      this.tagName = tag.toLowerCase();
      this.parentNode = null;
      this.children = [];
      this.attrs = {};
      this.dataset = {};
      this.style = {};
      this.hidden = false;
      this.disabled = false;
      this.textContent = '';
      this.rect = { left: 10, top: 20, width: 100, height: 40 };
      const classes = new Set();
      this.classList = {
        add: (...names) => names.forEach(name => classes.add(name)),
        remove: (...names) => names.forEach(name => classes.delete(name)),
        contains: name => classes.has(name)
      };
      Object.defineProperty(this, 'className', {
        get: () => [...classes].join(' '),
        set: value => { classes.clear(); String(value).split(/\s+/).filter(Boolean).forEach(name => classes.add(name)); }
      });
    }
    appendChild(node) { node.remove(); node.parentNode = this; this.children.push(node); return node; }
    append(...nodes) { nodes.forEach(node => this.appendChild(node)); }
    remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(node => node !== this); this.parentNode = null; }
    setAttribute(name, value) { this.attrs[name] = String(value); }
    getAttribute(name) { return this.attrs[name] ?? null; }
    get isConnected() { return this === document.documentElement || Boolean(this.parentNode && this.parentNode.isConnected); }
    getBoundingClientRect() { return { ...this.rect }; }
    matches(selector) {
      return selector.split(',').some(part => {
        part = part.trim();
        if (part === ':disabled') {
          return this.tagName === 'button' && (this.disabled || Boolean(this.parentNode?.closest('fieldset[disabled]')));
        }
        if (part === '[inert]') return Object.hasOwn(this.attrs, 'inert');
        if (part === '[aria-disabled="true"]') return this.attrs['aria-disabled'] === 'true';
        if (part === '[role="button"]') return this.attrs.role === 'button';
        if (part === 'a.button') return this.tagName === 'a' && this.classList.contains('button');
        if (part === 'nav a') return this.tagName === 'a' && Boolean(this.parentNode?.closest('nav'));
        if (part === 'fieldset[disabled]') return this.tagName === 'fieldset' && this.disabled;
        return this.tagName === part;
      });
    }
    closest(selector) { for (let node = this; node; node = node.parentNode) if (node.matches(selector)) return node; return null; }
  }
  const document = events({ readyState: 'complete', hidden: false });
  document.documentElement = new Element('html');
  document.body = document.documentElement.appendChild(new Element('body'));
  document.createElement = tag => new Element(tag);
  const reduced = events({ matches: false });
  const window = events({ matchMedia: () => reduced });
  const context = vm.createContext({ window, document, Element, setTimeout, clearTimeout });
  vm.runInContext(source, context, { filename: 'interface-motion.js' });
  const find = className => document.body.children.find(node => node.classList.contains(className));
  const add = (tag = 'button', parent = document.body) => parent.appendChild(new Element(tag));
  const press = (target, extra = {}) => document.emit('pointerdown', { target, button: 0, clientX: 42, clientY: 66, ...extra });
  return {
    document, window, reduced, add, press, tick, tasks,
    api: window.JiaoyingMotion,
    layer: () => find('jy-motion-layer'),
    status: () => find('jy-motion-status'),
    label: () => find('jy-motion-status').children[1].children[0].textContent,
    count: className => document.body.children.filter(node => node.classList.contains(className)).length,
    reload: () => vm.runInContext(source, context)
  };
}

test('delegated pointer and keyboard input work; disabled, inert and secondary input are ignored', () => {
  const h = harness(), button = h.add(), nested = h.add('span', button);
  h.press(nested);
  assert.equal(h.layer().children.length, 1);
  assert.equal(h.layer().children[0].style.left, '42px');
  assert.equal(button.classList.contains('jy-press'), true);
  h.document.emit('click', { target: nested, detail: 1 });
  assert.equal(h.layer().children.length, 1, 'pointer click does not duplicate its pointerdown effect');
  h.document.emit('click', { target: nested, detail: 0 });
  assert.equal(h.layer().children.length, 2);
  assert.equal(h.layer().children[1].style.left, '60px', 'keyboard effect is centered on the control');
  h.tick(1000);
  const disabled = h.add(); disabled.disabled = true;
  const aria = h.add('div'); aria.setAttribute('aria-disabled', 'true');
  const inert = h.add('div'); inert.setAttribute('inert', '');
  const fieldset = h.add('fieldset'); fieldset.disabled = true;
  for (const target of [disabled, h.add('button', aria), h.add('button', inert), h.add('button', fieldset)]) {
    h.press(target);
    h.document.emit('click', { target, detail: 0 });
    assert.equal(target.classList.contains('jy-press'), false);
  }
  h.press(button, { button: 2 });
  assert.equal(h.layer().children.length, 0);
  assert.equal(h.tasks.size, 0);
});

test('rapid clicks stay bounded and an app content repaint does not remove the body-owned effect', () => {
  const h = harness(), main = h.add('main'), button = h.add('button', main);
  for (let i = 0; i < 50; i++) h.press(button);
  assert.equal(h.layer().children.length, 6);
  assert.equal(h.tasks.size, 7, 'six ring timers and one press cleanup timer');
  main.remove();
  h.api.refresh();
  assert.equal(h.layer().parentNode, h.document.body);
  assert.equal(h.layer().children.length, 6);
  h.tick(240);
  assert.equal(button.classList.contains('jy-press'), false);
  h.tick(380);
  assert.equal(h.layer().children.length, 0);
  assert.equal(h.tasks.size, 0);
});

test('begin and finish replace obsolete dismissals without hiding a newer operation', () => {
  const h = harness();
  h.api.begin('操作 A');
  assert.equal(h.status().dataset.state, 'pending');
  assert.equal(h.tasks.size, 0, 'waiting is not a fake time-based progress result');
  h.api.finish('操作 A 完成');
  h.tick(2500);
  h.api.begin('操作 B');
  h.tick(1000);
  assert.equal(h.status().hidden, false);
  assert.equal(h.status().dataset.state, 'pending');
  assert.equal(h.label(), '操作 B');
  h.api.finish('操作 B 完成');
  h.tick(2600);
  assert.equal(h.status().classList.contains('is-leaving'), true);
  h.api.begin('操作 C');
  h.tick(1000);
  assert.equal(h.status().hidden, false);
  assert.equal(h.status().classList.contains('is-leaving'), false);
  h.api.finish('操作 C 失败', 'error');
  assert.equal(h.status().dataset.state, 'error');
  h.tick(4599);
  assert.equal(h.status().hidden, false);
  h.tick(181);
  assert.equal(h.status().hidden, true);
  assert.equal(h.tasks.size, 0);
});

test('hidden pages and pagehide clear visual nodes, pressed controls and every scheduled dismissal', () => {
  const h = harness(), button = h.add();
  h.press(button);
  h.api.finish('完成');
  h.document.hidden = true;
  h.document.emit('visibilitychange');
  assert.equal(h.status().hidden, true);
  assert.equal(h.layer().children.length, 0);
  assert.equal(button.classList.contains('jy-press'), false);
  assert.equal(h.tasks.size, 0);
  h.press(button);
  h.api.begin('隐藏时操作');
  h.api.finish('隐藏时完成');
  assert.equal(h.status().hidden, true);
  assert.equal(h.tasks.size, 0);
  h.document.hidden = false;
  h.press(button);
  h.api.begin('新操作');
  h.window.emit('pagehide');
  assert.equal(h.layer().children.length, 0);
  assert.equal(h.status().hidden, true);
  assert.equal(h.tasks.size, 0);
});

test('reduced motion clears ongoing motion and retains static button and result feedback', () => {
  const h = harness(), button = h.add();
  h.press(button);
  h.api.finish('完成');
  h.reduced.matches = true;
  h.reduced.emit('change');
  assert.equal(h.layer().children.length, 0);
  assert.equal(h.tasks.size, 0);
  h.press(button);
  assert.equal(button.classList.contains('jy-press'), true);
  assert.equal(h.layer().children.length, 0, 'no ring is created in reduced-motion mode');
  h.api.finish('静态完成提示');
  assert.equal(h.status().hidden, false);
  assert.equal(h.label(), '静态完成提示');
  h.tick(2600);
  assert.equal(h.status().hidden, true, 'no extra exit-animation delay');
  assert.equal(h.tasks.size, 0);
});

test('refresh and repeat script initialization do not duplicate layers or handlers', () => {
  const h = harness(), button = h.add();
  for (let i = 0; i < 10; i++) h.api.refresh();
  h.reload();
  assert.equal(h.count('jy-motion-layer'), 1);
  assert.equal(h.count('jy-motion-status'), 1);
  h.press(button);
  assert.equal(h.layer().children.length, 1);
  h.api.finish('旧提示');
  h.layer().remove();
  h.api.refresh();
  assert.equal(h.count('jy-motion-layer'), 1);
  assert.equal(h.count('jy-motion-status'), 1);
  assert.equal(h.tasks.size, 0);
});

test('modal buttons receive their own pressed feedback without reparenting modal content', () => {
  const h = harness(), dialog = h.add('dialog'), button = h.add('button', dialog);
  dialog.setAttribute('open', '');
  h.press(button);
  assert.equal(button.classList.contains('jy-press'), true, 'button-local feedback is available inside the browser top layer');
  assert.equal(button.parentNode, dialog);
  assert.equal(dialog.children.length, 1, 'decorative body effects are never injected over modal controls');
  assert.equal(h.layer().parentNode, h.document.body);
  h.tick(240);
  assert.equal(button.classList.contains('jy-press'), false);
});
