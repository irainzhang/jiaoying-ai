import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadFA, ROOT } from './guardian/loader.mjs';
import path from 'node:path';

class Element extends EventTarget {
  constructor(tag, attrs = {}, children = []) {
    super(); this.tag = tag; this.attrs = attrs; this.children = [];
    this.classList = { add() {} };
    children.filter(Boolean).forEach((child) => this.appendChild(child));
  }
  appendChild(child) { this.children.push(child); if (typeof child === 'object') child.parent = this; return child; }
  set innerHTML(value) { assert.equal(value, ''); this.children = []; }
  getAttribute(key) { return this.attrs[key]; }
  closest(selector) {
    assert.equal(selector, '[data-action-id]');
    return this.attrs['data-action-id'] ? this : this.parent && this.parent.closest(selector);
  }
}
const walk = (node, predicate) => [ ...(predicate(node) ? [node] : []), ...node.children.flatMap((child) => typeof child === 'object' ? walk(child, predicate) : []) ];
const element = (tag, attrs, children) => new Element(tag, attrs, children);

function view(FA) {
  FA.ui = { el: element };
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'agent/src/ui/planner.js'), 'utf8'), { window: { FA } });
  const host = element('div');
  const planner = FA.ui.planner.create({ plan: host });
  return { host, planner };
}

test('guardian scenario UI: 80 / 120 / 160 三行对比直接呈现真实工具结果及人数口径', () => {
  const FA = loadFA();
  const result = FA.tools.execute('simulate_rainfall_scenario', { steps: [80, 120, 160] });
  assert.equal(result.ok, true);
  const { host, planner } = view(FA);
  planner.renderPlan(null);
  const table = walk(host, (n) => n.tag === 'table')[0];
  assert.ok(table);
  const bodyRows = walk(table, (n) => n.tag === 'tr' && n.attrs['data-rainfall-mm'] !== undefined);
  assert.equal(bodyRows.length, 3);
  for (let i = 0; i < 3; i++) {
    const source = result.data.results[i];
    assert.deepEqual(Array.from(bodyRows[i].children, (n) => n.attrs.text), [
      String(source.rainfallMm), String(source.riskHighZoneCount), String(source.exposedPopulation), String(source.vulnerablePopulation),
      `${source.dispatch.servedPeople} / ${source.dispatch.totalPeople}`, String(source.dispatch.unassignedPeople), String(source.gapCount)
    ]);
  }
  const texts = walk(host, (n) => !!n.attrs.text).map((n) => n.attrs.text).join('\n');
  assert.match(texts, /演练设定值/);
  assert.match(texts, /不是天气预报/);
  assert.match(texts, /人口与待转移任务人数口径不同/);
  assert.ok(walk(host, (n) => n.attrs.role === 'region' && n.attrs.tabindex === '0').length);
});

test('guardian quick actions: 点击快捷按钮内部文字也派发真实动作，重绘后仍可点', () => {
  const FA = loadFA();
  view(FA);
  const quick = element('div');
  const log = element('div');
  const calls = [];
  const planner = FA.ui.planner.create({ quick, log }, { onAction: (action, button) => calls.push({ action, button }) });
  const action = FA.actions.factory.rag('人员转移');
  planner.quickActions([action]);
  function clickText() {
    const button = quick.children[0];
    const event = new Event('click', { bubbles: true });
    // Node has no DOM bubbling, so deliver the real Event to the delegated container
    // with the original nested text element as its target, as a browser does.
    Object.defineProperty(event, 'target', { value: button.children[0] });
    quick.dispatchEvent(event);
    return button;
  }
  const button = clickText();
  assert.equal(calls.length, 1);
  assert.equal(calls[0].action, action);
  assert.equal(calls[0].button, button);
  button.disabled = true;
  clickText();
  assert.equal(calls.length, 1);
  planner.quickActions([action]);
  clickText();
  assert.equal(calls.length, 2);
});

test('guardian scenario UI: 资源不足的真实未安排人数保留，不用零覆盖', () => {
  const FA = loadFA();
  FA.store.applyScenario('village-growth');
  const result = FA.tools.execute('simulate_rainfall_scenario', {});
  const { host, planner } = view(FA);
  planner.renderPlan(null);
  const rows = walk(host, (n) => n.tag === 'tr' && n.attrs['data-rainfall-mm'] !== undefined);
  rows.forEach((row, i) => {
    assert.ok(result.data.results[i].dispatch.unassignedPeople > 0);
    assert.equal(row.children[5].attrs.text, String(result.data.results[i].dispatch.unassignedPeople));
  });
});

test('guardian scenario UI: 尚未推演时不显示虚构对比，重绘不会叠加旧表', () => {
  const FA = loadFA();
  const { host, planner } = view(FA);
  planner.renderPlan(null);
  assert.equal(walk(host, (n) => n.tag === 'table').length, 0);
  FA.tools.execute('simulate_rainfall_scenario', {});
  planner.renderPlan(null);
  planner.renderPlan(null);
  assert.equal(walk(host, (n) => n.tag === 'table').length, 1);
  FA.store.reset();
  planner.renderPlan(null);
  assert.equal(walk(host, (n) => n.tag === 'table').length, 0);
});
