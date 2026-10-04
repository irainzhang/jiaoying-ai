import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { loadFA, worldFrom } from './guardian/loader.mjs';

// The real browser alone creates isTrusted events. This class represents that
// boundary inside an isolated test VM; runtime code has no testing bypass.
class ClickFixture {
  constructor(trusted = false, type = 'click') { this.isTrusted = trusted; this.type = type; }
}
const human = () => new ClickFixture(true);
function setup(extra = {}) {
  const FA = loadFA(undefined, { Event: ClickFixture, ...extra });
  FA.store.applyScenario('rain-120');
  FA.store.patch({ plan: FA.optimizer.optimize(worldFrom(FA), {}) }, { silent: true });
  FA.tools.execute('create_dispatch_tasks', {});
  return FA;
}
function request(FA) { return FA.tools.execute('publish_dispatch_plan', {}).confirmRequest; }

test('a named actor, forged plain object, and synthetic click cannot approve', () => {
  const FA = setup(), req = request(FA);
  assert.equal(FA.confirm.approve(req.token, '张三').ok, false);
  assert.equal(FA.confirm.approve(req.token, '张三', { isTrusted: true, type: 'click' }).ok, false);
  assert.equal(FA.confirm.approve(req.token, '张三', new ClickFixture()).ok, false);
  assert.equal(FA.confirm.approve(req.token, '张三', new ClickFixture(true, 'message')).ok, false);
  assert.throws(() => { FA.confirm.allowAutoConfirm = true; }, TypeError);
  assert.equal(FA.store.get().publishedPlanId, null);
});

test('blank name uses the default actor; explicit human approval publishes once', () => {
  const FA = setup(), req = request(FA);
  assert.equal(FA.confirm.approve(req.token, ' \t\n ', human()).ok, true);
  const out = FA.tools.execute('publish_dispatch_plan', { _confirmToken: req.token });
  assert.equal(out.ok, true);
  assert.equal(out.data.confirmedBy, '演练值守');
  assert.ok(out.data.notifications.length);
  assert.equal(FA.tools.execute('publish_dispatch_plan', { _confirmToken: req.token }).needConfirm, true);
});

test('approval binds the exact reviewed arguments and cannot approve another tool', () => {
  const FA = setup();
  const req = FA.confirm.request('publish_dispatch_plan', { channel: '演练渠道' }, {});
  assert.equal(FA.confirm.approve(req.token, '张三', human()).ok, true);
  assert.equal(FA.confirm.verify('another_tool', { channel: '演练渠道', _confirmToken: req.token }).ok, false);
  assert.equal(FA.confirm.verify('publish_dispatch_plan', { channel: '其他渠道', _confirmToken: req.token }).ok, false);
  assert.equal(FA.confirm.verify('publish_dispatch_plan', { channel: '演练渠道', _confirmToken: req.token }).ok, true);
});

test('changed rain invalidates pending and approved requests, even without planId', () => {
  for (const approved of [false, true]) {
    const FA = setup(), req = request(FA);
    if (approved) assert.equal(FA.confirm.approve(req.token, '张三', human()).ok, true);
    FA.store.setRainfall(160, 'test');
    assert.equal(approved ? FA.confirm.verify('publish_dispatch_plan', { _confirmToken: req.token }).ok
      : FA.confirm.approve(req.token, '张三', human()).ok, false);
    assert.equal(FA.store.get().publishedPlanId, null);
  }
});

test('replacing a plan or changing execution tasks invalidates confirmation', () => {
  for (const change of [FA => FA.store.patch({ plan: { ...FA.store.get().plan, id: 'replacement' } }),
    FA => FA.store.updateTaskStage(FA.store.get().tasks[0].id, 'received', '受控的底层状态变化测试')]) {
    const FA = setup(), req = request(FA);
    change(FA);
    assert.equal(FA.confirm.approve(req.token, '张三', human()).ok, false);
  }
});

function humanPublish(FA) {
  const req = request(FA);
  assert.equal(FA.confirm.approve(req.token, '测试确认人', human()).ok, true);
  const result = FA.tools.execute('publish_dispatch_plan', { _confirmToken: req.token });
  assert.equal(result.ok, true);
  return result;
}

test('every execution stage rejects unpublished tasks by ID, group, and ALL without mutations', () => {
  const FA = setup();
  const snapshot = JSON.stringify(FA.store.get().tasks);
  const first = FA.store.get().tasks[0];
  for (const taskId of [first.id, first.groupId, 'ALL']) {
    for (const stage of ['published', 'notified', 'received', 'contacted', 'boarded', 'arrived', 'held', 'cancelled']) {
      const out = FA.tools.execute('update_task_state', { taskId, stage, actor: '执行人员' });
      assert.equal(out.ok, false, `${taskId}/${stage} must not bypass publication`);
      assert.equal(JSON.stringify(FA.store.get().tasks), snapshot);
    }
  }
  assert.equal(FA.store.get().publishedPlanId, null);
});

test('human-published current tasks can progress while the update tool cannot publish again', () => {
  const FA = setup();
  humanPublish(FA);
  for (const stage of ['notified', 'received', 'contacted', 'boarded', 'arrived']) {
    const out = FA.tools.execute('update_task_state', { taskId: 'ALL', stage, actor: '执行人员' });
    assert.equal(out.ok, true, stage);
    assert.ok(FA.store.get().tasks.every(t => t.stage === stage));
  }
  const before = JSON.stringify(FA.store.get().tasks);
  assert.equal(FA.tools.execute('update_task_state', { taskId: 'ALL', stage: 'published' }).ok, false);
  assert.equal(FA.tools.get('update_task_state').handler({ taskId: 'ALL', stage: 'published' }).ok, false);
  assert.equal(JSON.stringify(FA.store.get().tasks), before);
});

test('a new plan cannot use the previous plan publication or update its historical tasks', () => {
  const FA = setup();
  humanPublish(FA);
  const historicalTask = FA.store.get().tasks[0].id;
  FA.store.patch({ plan: { ...FA.store.get().plan, id: 'new-plan' } });
  const before = JSON.stringify(FA.store.get().tasks);
  assert.equal(FA.tools.execute('update_task_state', { taskId: historicalTask, stage: 'arrived' }).ok, false);
  assert.equal(JSON.stringify(FA.store.get().tasks), before);
  FA.tools.execute('create_dispatch_tasks', {});
  assert.equal(FA.tools.execute('update_task_state', { taskId: 'ALL', stage: 'arrived' }).ok, false);
});

test('regenerated tasks on the same plan need fresh human publication', () => {
  const FA = setup();
  humanPublish(FA);
  FA.tools.execute('create_dispatch_tasks', {});
  const before = JSON.stringify(FA.store.get().tasks);
  assert.equal(FA.tools.execute('update_task_state', { taskId: 'ALL', stage: 'arrived' }).ok, false);
  assert.equal(JSON.stringify(FA.store.get().tasks), before);
  humanPublish(FA);
  assert.equal(FA.tools.execute('update_task_state', { taskId: 'ALL', stage: 'arrived' }).ok, true);
});

test('mixed valid and historical targets are rejected atomically', () => {
  const FA = setup();
  humanPublish(FA);
  const first = FA.store.get().tasks[0];
  FA.store.raw().tasks.push({ ...JSON.parse(JSON.stringify(first)), id: 'historical-task', planId: 'old-plan' });
  const before = JSON.stringify(FA.store.get().tasks);
  assert.equal(FA.tools.execute('update_task_state', { taskId: first.groupId, stage: 'arrived' }).ok, false);
  assert.equal(JSON.stringify(FA.store.get().tasks), before);
});

test('public request copies cannot mutate the private confirmation binding', () => {
  const FA = setup(), req = request(FA);
  req.args.channel = 'tampered';
  FA.confirm.list()[0].args.channel = 'tampered again';
  assert.equal(FA.confirm.approve(req.token, '张三', human()).ok, true);
  assert.equal(FA.confirm.verify('publish_dispatch_plan', { channel: 'tampered', _confirmToken: req.token }).ok, false);
  assert.equal(FA.confirm.verify('publish_dispatch_plan', { _confirmToken: req.token }).ok, true);
});

test('confirmation expires after ten minutes and an expired approval is unusable', () => {
  let time = Date.now();
  class Clock extends Date { static now() { return time; } }
  const FA = setup({ Date: Clock }), req = request(FA);
  assert.equal(FA.confirm.approve(req.token, '张三', human()).ok, true);
  time += 10 * 60 * 1000 + 1;
  assert.equal(FA.confirm.verify('publish_dispatch_plan', { _confirmToken: req.token }).reason, 'expired-or-state-changed');
  const second = request(FA);
  time += 10 * 60 * 1000 + 1;
  assert.equal(FA.confirm.approve(second.token, '张三', human()).ok, false);
});

test('the actual modal accepts an optional blank name but still rejects synthetic confirmation clicks', async () => {
  const nodes = [];
  function node(tag) {
    const n = { tag, value: '', style: {}, children: [], handlers: {},
      appendChild(child) { this.children.push(child); },
      insertBefore(child) { this.children.push(child); },
      setAttribute(k, v) { this[k] = v; },
      addEventListener(k, fn) { this.handlers[k] = fn; },
      querySelector() { return null; }, remove() {}, focus() {} };
    nodes.push(n); return n;
  }
  const document = { body: node('body'), createElement: node, querySelector() { return null; },
    addEventListener() {}, removeEventListener() {}, createTextNode: text => ({ textContent: text }) };
  const window = { FA: {} };
  vm.runInNewContext(fs.readFileSync(new URL('../dist/guardian/agent/src/ui/render.js', import.meta.url), 'utf8'),
    { window, document, Event: ClickFixture, setTimeout: () => 1 });
  let resolved = false;
  const result = window.FA.ui.modal({ requireHuman: true, fields: [{ key: 'actor', label: '操作人（选填）', value: '', required: false }] });
  result.then(() => resolved = true);
  const input = nodes.find(n => n.tag === 'input');
  const button = nodes.find(n => n.tag === 'button' && n.textContent === '确认');
  input.value = '   ';
  button.handlers.click(new ClickFixture());
  await Promise.resolve(); assert.equal(resolved, false);
  const event = human(); button.handlers.click(event);
  const values = await result;
  assert.equal(values.actor, '');
  assert.equal(values._humanEvent, event);
  assert.deepEqual(Object.keys(values), ['actor']);
});

function bridgeHarness(base = 'https://example.test/jiaoying-ai/') {
  const listeners = {}, posts = [], child = { postMessage: (...args) => posts.push(args) };
  const host = { appendChild(n) { n.parentNode = this; }, removeChild() {} };
  const document = { baseURI: base, querySelector: () => host,
    createElement: () => ({ style: {}, contentWindow: child, setAttribute() {} }) };
  const window = { location: { href: base }, addEventListener: (n, fn) => listeners[n] = fn,
    removeEventListener() {} };
  vm.runInNewContext(fs.readFileSync(new URL('../dist/guardian/bridge/flood-agent-bridge.js', import.meta.url), 'utf8'),
    { window, document, URL, setTimeout, clearTimeout });
  const api = window.FloodAgent.mount({ container: '#slot', agentUrl: 'guardian/agent/embed.html' });
  const origin = new URL(base).origin;
  function deliver(overrides = {}) {
    listeners.message({ source: child, origin,
      data: { source: 'flood-agent', protocol: '3.7.0-guardian', type: 'ready', payload: { capabilities: { tools: [] } } }, ...overrides });
  }
  return { api, posts, child, deliver, origin };
}

test('host bridge rejects other windows, wrong origins, and wrong protocols', () => {
  const h = bridgeHarness();
  h.deliver({ source: {} }); assert.equal(h.api.isReady(), false);
  h.deliver({ origin: 'https://evil.test' }); assert.equal(h.api.isReady(), false);
  h.deliver({ data: { source: 'flood-agent', protocol: 'wrong', type: 'ready' } }); assert.equal(h.api.isReady(), false);
  h.deliver(); assert.equal(h.api.isReady(), true);
  h.api.confirm('CF123', '代填人', 'publish_dispatch_plan', { channel: '替换参数' });
  const [message, target] = h.posts.at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(message.command)), { kind: 'confirm', token: 'CF123' });
  assert.equal(target, h.origin);
});

test('file:// bridge retains source/protocol checks and null origin support', () => {
  const h = bridgeHarness('file:///D:/demo/host.html');
  h.deliver({ source: {} }); assert.equal(h.api.isReady(), false);
  h.deliver(); assert.equal(h.api.isReady(), true);
  h.api.send('当前状态');
  assert.equal(h.posts.at(-1)[1], '*');
});

function element() {
  return { value: '', disabled: false, innerHTML: '', textContent: '', className: '', style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
    appendChild() {}, addEventListener() {}, focus() {}, scrollIntoView() {} };
}
function appHarness(runtime = {}) {
  const FA = setup(), listeners = {}, dialogs = [], turns = [], messages = [];
  const refs = new Map();
  const parent = { postMessage() {} };
  const document = { referrer: 'https://example.test/jiaoying-ai/', readyState: 'complete', body: element(),
    getElementById(id) { if (!refs.has(id)) refs.set(id, element()); return refs.get(id); } };
  FA.ui = { el: element, toast() {}, escapeHtml: String,
    modal(opts) { dialogs.push(opts); return Promise.resolve(null); },
    map: { create: () => ({ render() {}, setLayers() {} }) },
    monitor: { create: () => ({ renderAll() {}, renderTrace() {} }) },
    planner: { create: () => ({ pushSystem() {}, pushUser() {}, clearBusy() {}, pushBusy() {},
      pushTurn(t) { turns.push(t); }, renderPlan() {}, renderReport() {}, renderDoc() {}, quickActions() {} }) } };
  FA.agent.handleUserMessage = text => { messages.push(text); return Promise.resolve({ text, provider: { mode: 'offline' } }); };
  const window = { FA, parent, GUARDIAN_API_CONFIG: { runtime }, addEventListener: (n, fn) => listeners[n] = fn };
  vm.runInNewContext(fs.readFileSync(new URL('../dist/guardian/agent/src/ui/app.js', import.meta.url), 'utf8'),
    { window, document, location: { origin: 'https://example.test', search: '?embed=1' }, URL, Event: ClickFixture, console });
  function command(cmd, overrides = {}) {
    return listeners.message({ source: parent, origin: 'https://example.test',
      data: { source: 'jiaoying-host', protocol: '3.7.0-guardian', type: 'command', command: cmd }, ...overrides });
  }
  return { FA, dialogs, refs, turns, messages, command };
}

test('child ignores forged commands and host confirmation only requests an optional-name human dialog', async () => {
  const h = appHarness(), req = request(h.FA), cmd = { kind: 'confirm', token: req.token, actor: '宿主代填', tool: 'wrong' };
  await h.command(cmd, { source: {} });
  await h.command(cmd, { origin: 'https://evil.test' });
  await h.command(cmd, { data: { source: 'jiaoying-host', protocol: 'wrong', type: 'command', command: cmd } });
  assert.equal(h.dialogs.length, 0);
  await h.command(cmd);
  assert.equal(h.dialogs.length, 1);
  assert.equal(h.dialogs[0].requireHuman, true);
  assert.equal(h.dialogs[0].fields[0].value, '演练值守');
  assert.equal(h.dialogs[0].fields[0].required, false);
  assert.equal(h.FA.store.get().publishedPlanId, null);
});

test('runtime applies the selected scenario and autorun while the provider badge stays visible', async () => {
  const h = appHarness({ defaultScenarioId: 'rain-160', autoRunOnBoot: true, showProviderBadge: false });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(h.FA.store.get().scenarioId, 'rain-160');
  assert.ok(h.messages.some(t => /160.*完整的研判/.test(t)));
  assert.match(h.refs.get('provider-badge').textContent, /运行路径/);
  assert.doesNotMatch(h.refs.get('provider-badge').className, /hidden/);
});

test('both classic-script pages load API configuration between data and business scripts', () => {
  for (const name of ['index.html', 'embed.html']) {
    const html = fs.readFileSync(new URL(`../dist/guardian/agent/${name}`, import.meta.url), 'utf8');
    assert.ok(html.indexOf('src="api-config.js"') > html.indexOf('src="assets/kb-bundle.js"'));
    assert.ok(html.indexOf('src="api-config.js"') < html.indexOf('src="src/core/bus.js"'));
    assert.doesNotMatch(html, /type="module"/);
  }
});
