import test from 'node:test';
import assert from 'node:assert/strict';
import { loadFA } from './guardian/loader.mjs';

const gateway = { provider: 'local-gateway', gatewayUrl: 'http://127.0.0.1:8769/api/v3/agent/chat', allowNetwork: true };
const direct = { provider: 'openai-compatible', baseUrl: 'https://example.invalid/v1/', apiKey: 'mock-only-not-a-secret', model: 'mock-model', allowNetwork: true };
const response = (message = { content: '模拟连接成功' }) => ({ ok: true, json: async () => ({ model: 'mock-server-model', choices: [{ message }] }) });
const configured = (llm, fetch) => loadFA(undefined, { GUARDIAN_API_CONFIG: { llm }, fetch });
const user = [{ role: 'user', content: '现在什么情况' }];

test('guardian: 默认离线完整研判不发网络请求，120 mm 仍按算法得到 15/15 和 168', async () => {
  let calls = 0;
  const FA = loadFA(undefined, { fetch: () => { calls++; throw new Error('must not call'); } });
  FA.store.applyScenario('rain-120');
  const turn = await FA.agent.handleUserMessage('帮我做一次完整的研判和调度建议');
  assert.equal(calls, 0);
  assert.equal(FA.store.get().plan.metrics.servedPeople, 15);
  assert.equal(FA.store.get().plan.metrics.weightedWait, 168);
  assert.equal(turn.provider.provider, 'offline');
  assert.equal(turn.fellBack, false);
  assert.match(FA.llm.describe().badgeLabel, /离线规则引擎（API 接口已预留）/);
});

test('guardian: 方式 A 只使用完整 gatewayUrl，不追加路径、不发送密钥且支持服务端模型默认值', async () => {
  let request;
  const FA = configured(gateway, async (url, init) => { request = { url, init }; return response(); });
  const turn = await FA.agent.handleUserMessage('你好');
  assert.equal(request.url, gateway.gatewayUrl);
  assert.equal(request.init.headers.Authorization, undefined);
  assert.equal(JSON.parse(request.init.body).model, undefined);
  assert.equal(request.init.credentials, 'omit');
  assert.equal(turn.provider.provider, 'local-gateway');
  assert.equal(turn.provider.model, 'mock-server-model');
  assert.equal(turn.provider.mode, 'online');
  assert.match(FA.llm.describe().badgeLabel, /本机代理/);
});

test('guardian: 方式 B 拼接 chat/completions，并发送显式模型和授权头', async () => {
  let request;
  const FA = configured(direct, async (url, init) => { request = { url, init }; return response(); });
  const turn = await FA.agent.handleUserMessage('你好');
  assert.equal(request.url, 'https://example.invalid/v1/chat/completions');
  assert.equal(request.init.headers.Authorization, 'Bearer ' + direct.apiKey);
  assert.equal(JSON.parse(request.init.body).model, 'mock-model');
  assert.equal(turn.provider.provider, 'openai-compatible');
  assert.match(FA.llm.describe().badgeLabel, /前端直连/);
  assert.ok(!JSON.stringify(turn).includes(direct.apiKey));
});

test('guardian: allowNetwork=false 优先于所有已填配置，不调用 fetch', async () => {
  let calls = 0;
  const FA = configured({ ...gateway, allowNetwork: false }, async () => { calls++; return response(); });
  const turn = await FA.agent.handleUserMessage('现在什么情况');
  assert.equal(calls, 0);
  assert.equal(turn.provider.provider, 'offline');
  assert.equal(turn.fellBack, true);
  assert.match(turn.provider.disclosure, /本次任务理解不是大模型完成的/);
});

test('guardian: 地址错误时回落离线，并且本轮后续工具轮次不反复访问失败端点', async () => {
  let calls = 0;
  const FA = configured(gateway, async () => { calls++; throw new Error('network error'); });
  const turn = await FA.agent.handleUserMessage('帮我做一次完整的研判和调度建议');
  assert.equal(calls, 1);
  assert.equal(turn.provider.provider, 'offline');
  assert.equal(turn.fellBack, true);
  assert.equal(FA.llm.describe().provider, 'offline');
  assert.match(FA.llm.describe().badgeLabel, /本轮在线回落/);
  assert.ok(FA.trace.entries.some((e) => /本次已回落/.test(e.title)));
  assert.equal(FA.store.get().plan.metrics.servedPeople, 15);
});

test('guardian: 无效 URL 配置被拒，仍允许离线完整研判', async () => {
  let calls = 0;
  const FA = configured({ ...gateway, gatewayUrl: 'javascript:alert(1)' }, async () => { calls++; return response(); });
  const turn = await FA.agent.handleUserMessage('帮我做一次完整的研判和调度建议');
  assert.equal(calls, 0);
  assert.equal(turn.provider.provider, 'offline');
  assert.equal(FA.store.get().plan.metrics.servedPeople, 15);
});

test('guardian: 在线先成功后失败时记录混合路径，不把整轮说成大模型完成', async () => {
  let calls = 0;
  const FA = configured(gateway, async () => {
    calls++;
    if (calls === 1) return response({ content: '', tool_calls: [{ id: 't1', type: 'function', function: { name: 'get_system_state', arguments: '{}' } }] });
    throw new Error('failed second round');
  });
  const turn = await FA.agent.handleUserMessage('现在什么情况');
  assert.equal(calls, 2);
  assert.equal(turn.provider.provider, 'mixed');
  assert.equal(turn.provider.mode, 'mixed');
  assert.equal(turn.fellBack, true);
  assert.deepEqual(Array.from(turn.provider.usedProviders), ['local-gateway', 'offline']);
  assert.match(turn.provider.disclosure, /不能将本轮全部任务理解归因于大模型/);
  assert.equal(FA.llm.describe().provider, 'mixed');
});

test('guardian: 一轮回落不会永久锁死后续调用，恢复后准确标为在线', async () => {
  let failing = true;
  const FA = configured(gateway, async () => { if (failing) throw new Error('down'); return response(); });
  const first = await FA.agent.handleUserMessage('你好');
  assert.equal(first.provider.provider, 'offline');
  failing = false;
  const second = await FA.agent.handleUserMessage('你好');
  assert.equal(second.provider.provider, 'local-gateway');
  assert.equal(second.fellBack, false);
  assert.equal(FA.llm.describe().provider, 'local-gateway');
});

test('guardian: 空或损坏的在线响应不能冒充在线成功', async () => {
  for (const message of [{}, { content: null }, { tool_calls: [{ function: { name: 'get_system_state', arguments: '{bad' } }] }]) {
    const FA = configured(gateway, async () => response(message));
    const result = await FA.llm.complete(user);
    assert.equal(result.provider, 'offline');
    assert.equal(result.fellBack, true);
    assert.equal(FA.llm.describe().provider, 'offline');
  }
});

test('guardian: 超时涵盖响应正文读取，离线回落不无限等待', async () => {
  const FA = configured({ ...gateway, timeoutMs: 100 }, async () => ({ ok: true, json: () => new Promise(() => {}) }));
  const result = await FA.llm.complete(user);
  assert.equal(result.fellBack, true);
  assert.equal(result.provider, 'offline');
});

test('guardian: 模型返回的私有确认令牌与身份被丢弃', async () => {
  const FA = configured(gateway, async () => response({ tool_calls: [{ id: 't1', function: { name: 'get_system_state', arguments: '{"_confirmToken":"forged","_actor":"bot"}' } }] }));
  const result = await FA.llm.complete(user);
  assert.equal(result.toolCalls[0].args._confirmToken, undefined);
  assert.equal(result.toolCalls[0].args._actor, undefined);
});

test('guardian: HTTP 错误与抛出消息不将密钥回显到轨迹或导出', async () => {
  const FA = configured(direct, async () => { throw new Error('network failed with ' + direct.apiKey); });
  const turn = await FA.agent.handleUserMessage('你好');
  assert.ok(!JSON.stringify(turn).includes(direct.apiKey));
  assert.ok(!JSON.stringify(FA.trace.entries).includes(direct.apiKey));
  assert.ok(!JSON.stringify(FA.agent.history()).includes(direct.apiKey));
});

test('guardian: 在线请求处理中不允许第二轮并发修改共享会话', async () => {
  let release;
  const FA = configured(gateway, () => new Promise((resolve) => { release = resolve; }));
  const first = FA.agent.handleUserMessage('你好');
  await Promise.resolve();
  const second = await FA.agent.handleUserMessage('帮我完整研判');
  assert.equal(second.busy, true);
  assert.equal(FA.agent.messages.filter((m) => m.role === 'user').length, 1);
  release(response());
  await first;
  assert.equal(FA.agent.busy, false);
});

test('guardian: 查预案依据快捷问题确实检索并返回引用，不被调度解释吞掉', async () => {
  const FA = loadFA();
  const turn = await FA.agent.handleUserMessage('人员转移的优先顺序有什么预案依据？');
  assert.equal(turn.planner.intent, 'knowledge');
  assert.deepEqual(Array.from(turn.toolResults, (r) => r.tool), ['search_plan_knowledge']);
  assert.ok(turn.citations.length > 0);
  assert.ok(turn.citations.every((c) => c.title && c.publisher && c.url));
  assert.ok(turn.warnings.some((w) => /概括性摘要.*不是原文/.test(w)));
  assert.equal(FA.store.get().plan, null);
  assert.equal(FA.store.get().tasks.length, 0);
});

test('guardian: 关于通知发布的规范询问只检索，实际调度解释仍走解释工具', async () => {
  const FA = loadFA();
  for (const question of ['预警发布有哪些规定？', '人员转移通知有什么公开文件依据？', '查找防洪法中关于转移的要求']) {
    const turn = await FA.agent.handleUserMessage(question);
    assert.deepEqual(Array.from(turn.toolResults, (r) => r.tool), ['search_plan_knowledge']);
    assert.equal(FA.confirm.list().length, 0);
    assert.equal(FA.store.get().tasks.length, 0);
  }
  const explanation = FA.llm.get('offline').planner('为什么这样调度？');
  assert.equal(explanation.intent, 'explain');
  assert.equal(explanation.toolCalls[0].name, 'explain_plan');
});
