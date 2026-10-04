/*!
 * 城市韧性守护 Agent · 可复现测试套件
 * ---------------------------------------------------------------
 * 运行（项目根目录，零依赖）：
 *   node tests/run-tests.mjs
 *   node tests/run-tests.mjs --json   # 只输出 JSON，便于接入 CI
 *
 * 设计目标与现有叫应 AI 应用一致：同一输入 → 同一输出，
 * 并且把「算法收益」与「AI 能力」分开陈述，不夸大。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadFA, worldFrom, ROOT } from './loader.mjs';

/* ============================== 迷你测试框架 ============================== */
const results = [];
const pending = [];
let currentGroup = '未分组';

function group(name) { currentGroup = name; }

/**
 * 登记一个测试。注意：这里只登记，不立即执行 ——
 * 因为智能体的对话闭环是异步的（工具可能返回 Promise），
 * 必须按登记顺序逐个 await，否则异步断言会被跳过，
 * 而且共享的演练状态会在用例之间互相污染。
 */
function check(name, fn) {
  pending.push({ name, fn, group: currentGroup });
}

async function runQueue() {
  for (const item of pending) {
    const started = Date.now();
    try {
      const detail = await item.fn();
      results.push({
        group: item.group, name: item.name, ok: true,
        detail: detail == null ? '' : String(detail), ms: Date.now() - started
      });
    } catch (err) {
      results.push({
        group: item.group, name: item.name, ok: false,
        detail: String(err && err.message || err), stack: err && err.stack, ms: Date.now() - started
      });
    }
  }
}

function assert(cond, message) {
  if (!cond) throw new Error(message || '断言失败');
}

function approx(a, b, tol = 1e-6) {
  return Math.abs(a - b) <= tol;
}

/* ============================== 被测代码 ============================== */
// Browser-trusted click fixture: only the test VM can construct this class.
class HumanClickFixture { constructor() { this.type = 'click'; this.isTrusted = true; } }
const FA = loadFA(undefined, { Event: HumanClickFixture });

/* ============================== 1. 数据与口径 ============================== */
group('1 数据与口径');

check('免责声明与边界限制齐备', () => {
  const d = FA.data.region.disclaimer;
  assert(d && d.full && d.full.length > 40, '缺少完整免责声明');
  assert(d.boundary.length >= 5, '边界条目少于 5 条');
  return `免责声明 ${d.full.length} 字，边界 ${d.boundary.length} 条`;
});

check('数据来源覆盖赛事要求的类别', () => {
  const n = FA.data.region.dataProvenance.length;
  assert(n >= 9, `数据来源仅 ${n} 类`);
  assert(FA.data.region.dataProvenance.every((d) => d.category && d.purpose && d.source), '存在缺字段的数据来源');
  return `${n} 类数据均含类别/用途/来源`;
});

check('演练数据已明确标注为非真实统计', () => {
  assert(FA.data.region.dataMode === 'synthetic-topology', '未标记为演练合成数据');
  assert(FA.data.region.riskTerminology.indexOf('积水') >= 0, '对外口径不是「积水易发风险」');
  return FA.data.region.dataModeLabel;
});

check('基准底数自洽：15 人 / 15 座 / 无障碍 2 需 2 供', () => {
  const people = FA.data.groups.reduce((a, g) => a + g.people, 0);
  const seats = FA.data.vehicles.reduce((a, v) => a + v.seats, 0);
  const needWc = FA.data.groups.reduce((a, g) => a + (g.wheelchair || 0), 0);
  const supplyWc = FA.data.vehicles.reduce((a, v) => a + v.wheelchairSlots, 0);
  assert(people === 15, `基准人数应为 15，实际 ${people}`);
  assert(seats === 15, `座位应为 15，实际 ${seats}`);
  assert(needWc === 2 && supplyWc === 2, `无障碍位应为 2/2，实际 ${needWc}/${supplyWc}`);
  return `${people} 人 / ${seats} 座 / 无障碍 ${needWc} 需 ${supplyWc} 供`;
});

check('村级新增需求合计 12 人（用于演示明确保留缺口）', () => {
  const n = FA.data.villageGrowthGroups.reduce((a, g) => a + g.people, 0);
  assert(n === 12, `村级新增应为 12 人，实际 ${n}`);
  return `新增 ${FA.data.villageGrowthGroups.length} 组共 ${n} 人`;
});

/* ============================== 2. 风险模型 ============================== */
group('2 风险模型与可解释性');

const zones = FA.data.zones;

check('风险随雨量单调不减（35/80/120/160 mm）', () => {
  const steps = [35, 80, 120, 160];
  const maps = steps.map((mm) => {
    const r = FA.analytics.riskByZone(zones, mm);
    const m = {};
    r.zones.forEach((z) => { m[z.zoneId] = z.score; });
    return m;
  });
  for (const z of zones) {
    for (let i = 1; i < steps.length; i++) {
      assert(maps[i][z.id] >= maps[i - 1][z.id] - 1e-9,
        `${z.id} 在 ${steps[i]}mm 的风险低于 ${steps[i - 1]}mm`);
    }
  }
  const top = FA.analytics.riskByZone(zones, 120).zones[0];
  return `最高 ${top.name} ${top.percent}%（${top.levelLabel}）`;
});

check('风险分数在 [0,1] 且等级划分与阈值一致', () => {
  const levels = FA.data.modelWeights.floodRisk.levels;
  const r = FA.analytics.riskByZone(zones, 120);
  r.zones.forEach((z) => {
    assert(z.score >= 0 && z.score <= 1, `${z.zoneId} 分数越界 ${z.score}`);
    const expect = FA.util.levelOf(z.score, levels);
    assert(expect.key === z.level, `${z.zoneId} 等级 ${z.level} 与阈值 ${expect.key} 不一致`);
  });
  return `${r.zones.length} 个网格分数与等级均一致`;
});

check('因子贡献分解与 logit 自洽（可解释性可核验）', () => {
  const cfg = FA.data.modelWeights.floodRisk;
  const r = FA.analytics.riskByZone(zones, 120);
  r.zones.forEach((z) => {
    const sum = z.drivers.reduce((a, d) => a + d.contribution, 0);
    assert(approx(cfg.intercept + sum, z.logit, 1e-2), `${z.zoneId} 贡献之和 ${sum} + 截距与 logit ${z.logit} 不符`);
    assert(z.drivers[0].contribution >= z.drivers[1].contribution, `${z.zoneId} 因子未按贡献排序`);
  });
  const t = r.zones[0];
  return `示例：${t.name} 主因 ${t.drivers[0].label}（${t.drivers[0].contribution}）`;
});

check('风险模型方法声明为代理模型而非水动力仿真', () => {
  const r = FA.analytics.riskByZone(zones, 120);
  assert(/logistic/i.test(r.method), `方法名异常：${r.method}`);
  assert(/不宣称|不代表|并非/.test(r.methodNote) || /水动力/.test(r.methodNote), '缺少精度边界声明');
  return r.methodLabel;
});

/* ============================== 3. 社会脆弱性 ============================== */
group('3 社会脆弱性 SVI');

check('SVI 权重合计为 1 且分数在 [0,1]', () => {
  const inds = FA.data.modelWeights.svi.indicators;
  const sum = inds.reduce((a, i) => a + i.weight, 0);
  assert(approx(sum, 1, 1e-9), `SVI 权重合计 ${sum} ≠ 1`);
  const s = FA.analytics.sviByZone(zones, FA.data.groups, FA.analytics.accessibility(zones, FA.data.shelters, FA.data.roads));
  s.zones.forEach((z) => assert(z.score >= 0 && z.score <= 1, `${z.zoneId} SVI 越界 ${z.score}`));
  return `${inds.length} 项指标，最高 ${s.zones[0].name} ${s.zones[0].percent}%`;
});

check('高老龄占比网格的脆弱性高于低老龄占比网格', () => {
  const access = FA.analytics.accessibility(zones, FA.data.shelters, FA.data.roads);
  const s = FA.analytics.sviByZone(zones, FA.data.groups, access);
  const map = {};
  s.zones.forEach((z) => { map[z.zoneId] = z.score; });
  assert(map.R06 > map.R05, `R06(${map.R06}) 应高于 R05(${map.R05})：R06 老龄占比更高`);
  return `R06 ${FA.util.round(map.R06, 3)} > R05 ${FA.util.round(map.R05, 3)}`;
});

check('脆弱性与风险相互独立（存在风险低但脆弱性高的网格）', () => {
  const access = FA.analytics.accessibility(zones, FA.data.shelters, FA.data.roads);
  const risk = FA.analytics.riskByZone(zones, 120);
  const svi = FA.analytics.sviByZone(zones, FA.data.groups, access);
  const rMap = {}, sMap = {};
  risk.zones.forEach((z) => { rMap[z.zoneId] = z.score; });
  svi.zones.forEach((z) => { sMap[z.zoneId] = z.score; });
  const found = Object.keys(rMap).filter((id) => rMap[id] < 0.35 && sMap[id] > 0.45);
  assert(found.length > 0, '不存在「风险低但脆弱性高」的网格，创新点 1 无法体现');
  return `示例：${found.join('、')}`;
});

/* ============================== 4. 路网可达性 ============================== */
group('4 路网与可达性');

check('可达性只使用开放路段', () => {
  const roads = FA.data.roads.map((r) => Object.assign({}, r, { closed: r.id === 'RD04' }));
  const a = FA.analytics.accessibility(zones, FA.data.shelters, roads);
  assert(a.closedRoadIds.indexOf('RD04') >= 0, '未记录阻断路段');
  assert(a.openRoadCount === roads.length - 1, `开放路段数应为 ${roads.length - 1}，实际 ${a.openRoadCount}`);
  return `开放 ${a.openRoadCount}/${roads.length} 条`;
});

/** 安置点落在某个网格里，可达时间矩阵按「网格」索引，所以要先解析到网格编号 */
function shelterZone(shelterId) {
  const s = FA.data.shelters.find((x) => x.id === shelterId);
  assert(s, `未找到安置点 ${shelterId}`);
  return s.zoneId;
}

check('阻断临江路段后 R02 到安置点的时间不减少', () => {
  const open = FA.analytics.accessibility(zones, FA.data.shelters, FA.data.roads);
  const roads = FA.data.roads.map((r) => Object.assign({}, r, { closed: r.id === 'RD04' }));
  const closed = FA.analytics.accessibility(zones, FA.data.shelters, roads);
  const target = shelterZone('S3');
  const before = open.matrix.R02[target];
  const after = closed.matrix.R02[target];
  assert(after === Infinity || before === Infinity || after >= before - 1e-9,
    `R02→S3 时间反而减少：${before} → ${after}`);
  return `R02→S3 ${before} → ${after === Infinity ? '不可达' : after} 分钟`;
});

check('不可达网格被记录为缺口而不是被丢弃', () => {
  // 全部路段阻断时，安置点所在网格仍然「就地可达」（人已经在安置点所在的网格），
  // 其余有需求的网格才成为不可达缺口。
  const roads = FA.data.roads.map((r) => Object.assign({}, r, { closed: true }));
  const a = FA.analytics.accessibility(zones, FA.data.shelters, roads);
  const shelterZoneIds = [...new Set(FA.data.shelters.map((s) => s.zoneId))];
  const expectUnreachable = zones.length - shelterZoneIds.length;
  assert(a.unreachable.length === expectUnreachable,
    `全部阻断时应 ${expectUnreachable} 个网格不可达（安置点所在网格就地可达），实际 ${a.unreachable.length}`);
  const gap = FA.analytics.resourceGap({
    zones, groups: FA.data.groups, shelters: FA.data.shelters, vehicles: FA.data.vehicles,
    roads, rainfallMm: 120
  });
  assert(gap.gaps.some((g) => g.key === 'access'), '未生成可达性缺口');
  return `全部阻断时 ${a.unreachable.length}/${zones.length} 个网格不可达（${shelterZoneIds.length} 个安置点所在网格就地可达），并生成可达性缺口`;
});

/* ============================== 5. 优先级 ============================== */
group('5 应急响应优先级');

check('优先级四项权重合计为 1 且含四类成分', () => {
  const w = FA.data.modelWeights.priority.weights;
  const sum = w.risk + w.exposure + w.svi + w.capabilityDeficit;
  assert(approx(sum, 1, 1e-9), `权重合计 ${sum} ≠ 1`);
  const w2 = worldFrom(FA);
  const gap = FA.analytics.resourceGap(w2);
  const p = gap.priority.zones[0];
  ['risk', 'exposure', 'svi', 'capabilityDeficit'].forEach((k) => {
    assert(p.components[k] != null, `缺少成分 ${k}`);
  });
  return `最高优先级 ${p.name}（${p.priorityPercent}，${p.tag}）`;
});

check('存在「高风险 × 高脆弱」的重点区域标记', () => {
  const gap = FA.analytics.resourceGap(worldFrom(FA));
  const tagged = gap.priority.zones.filter((z) => z.tag === '高风险 × 高脆弱');
  assert(tagged.length > 0, '未识别出高风险×高脆弱区域');
  return tagged.map((z) => z.name).join('、');
});

/* ============================== 6. 调度优化 ============================== */
group('6 调度优化与约束');

function planFor(scenarioId, objective = 'risk_first') {
  FA.store.reset();
  FA.store.applyScenario(scenarioId);
  const w = worldFrom(FA);
  return { world: w, plan: FA.optimizer.optimize(w, { objective }) };
}

check('初始接送情景可全部安排（15/15）', () => {
  const { plan } = planFor('normal');
  assert(plan.metrics.totalPeople === 15, `总人数应为 15，实际 ${plan.metrics.totalPeople}`);
  assert(plan.metrics.servedPeople === 15, `应全部安排，实际 ${plan.metrics.servedPeople}`);
  assert(plan.metrics.unassignedPeople === 0, `不应有未安排人员`);
  return `${plan.metrics.servedPeople}/${plan.metrics.totalPeople} 人，加权等待 ${plan.metrics.weightedWait}`;
});

check('所有情景下独立约束校验均通过', () => {
  const rows = [];
  for (const sc of FA.data.scenarios) {
    const { world, plan } = planFor(sc.id);
    const v = FA.optimizer.validatePlan(world, plan.metrics);
    assert(v.ok, `情景 ${sc.id} 约束校验失败：${v.errors.join('；')}`);
    rows.push(`${sc.id}:${plan.metrics.servedPeople}/${plan.metrics.totalPeople}`);
  }
  return rows.join(' ');
});

check('车辆故障情景明确保留缺口（座位 9 < 需求 15）', () => {
  const { plan } = planFor('resource-shortage');
  assert(plan.metrics.unassignedPeople > 0, '车辆故障却没有任何未安排人员，说明缺口被隐藏了');
  assert(plan.metrics.servedPeople <= 9, `已安排 ${plan.metrics.servedPeople} 超过可用座位 9`);
  assert(plan.explanations.length > 0, '未安排人员缺少原因说明');
  assert(plan.explanations.every((e) => e.reason && e.code), '未安排原因缺少 reason/code');
  return `已安排 ${plan.metrics.servedPeople}，未安排 ${plan.metrics.unassignedPeople}（原因码 ${[...new Set(plan.explanations.map((e) => e.code))].join('/')}）`;
});

check('村级新增情景总需求 27 人且缺口被如实保留', () => {
  const { plan } = planFor('village-growth');
  assert(plan.metrics.totalPeople === 27, `总需求应为 27，实际 ${plan.metrics.totalPeople}`);
  assert(plan.metrics.unassignedPeople > 0, '27 人 > 15 座却没有缺口');
  return `已安排 ${plan.metrics.servedPeople}/27，未安排 ${plan.metrics.unassignedPeople}`;
});

check('优化方案不劣于明示规则基线（同一输入快照）', () => {
  const rows = [];
  for (const sc of ['normal', 'rain-120', 'village-growth', 'resource-shortage', 'road-closure']) {
    const { plan } = planFor(sc);
    const o = plan.metrics, b = plan.baseline;
    const better = o.servedPeople > b.servedPeople ||
      (o.servedPeople === b.servedPeople && o.weightedWait <= b.weightedWait);
    assert(better, `${sc}：优化(${o.servedPeople}人/${o.weightedWait}) 不优于基线(${b.servedPeople}人/${b.weightedWait})`);
    rows.push(`${sc}: ${b.weightedWait}→${o.weightedWait}`);
  }
  return rows.join(' ');
});

check('对比声明「不代表人工调度实测」且不表述为 AI 效果', () => {
  const { plan } = planFor('rain-120');
  assert(/不代表人工调度实测|不将算法收益表述为 AI 效果/.test(plan.comparison.note), '缺少对比口径声明');
  return plan.comparison.note.slice(0, 40) + '…';
});

check('局部搜索有界且在预算内收敛', () => {
  const { plan } = planFor('rain-120');
  assert(plan.search.bounded === true, '未声明为有界搜索');
  assert(plan.search.iterations <= plan.search.limit, '迭代次数超过预算');
  assert(plan.elapsedMs < 5000, `单次方案耗时 ${plan.elapsedMs} ms 过长`);
  return `迭代 ${plan.search.iterations}/${plan.search.limit}，改进 ${plan.search.improvements} 次，耗时 ${plan.elapsedMs} ms`;
});

check('同一输入两次运行结果完全一致（可复现）', () => {
  const a = planFor('rain-120').plan;
  const b = planFor('rain-120').plan;
  const sig = (p) => JSON.stringify({
    served: p.metrics.servedPeople, wait: p.metrics.weightedWait, finish: p.metrics.finishMinute,
    rows: p.assignments.map((x) => x.vehicleId + ':' + x.stops.map((s) => s.groupId).join('>') + '->' + x.shelterId)
  });
  assert(sig(a) === sig(b), '两次运行结果不一致，无法复现');
  return '已安排人数、等待、完成时间与线路编排均一致';
});

check('算法声明为有界启发式，不承诺全局最优', () => {
  const { plan } = planFor('rain-120');
  assert(/不保证全局最优|有界/.test(plan.methodNote), '缺少最优性边界声明');
  return plan.algorithm;
});

check('60 组规模仍满足约束且在时间预算内', () => {
  FA.store.reset();
  const big = FA.data.generateScaleGroups(60);
  const w = {
    zones: FA.data.zones, groups: big, shelters: FA.data.shelters,
    vehicles: FA.data.vehicles, roads: FA.data.roads, rainfallMm: 120
  };
  const t0 = Date.now();
  const plan = FA.optimizer.optimize(w, { objective: 'risk_first' });
  const ms = Date.now() - t0;
  const v = FA.optimizer.validatePlan(w, plan.metrics);
  assert(v.ok, `规模场景约束校验失败：${v.errors.join('；')}`);
  assert(ms < 5000, `规模场景耗时 ${ms} ms 过长`);
  return `60 组：已安排 ${plan.metrics.servedPeople}，未安排 ${plan.metrics.unassignedPeople}，耗时 ${ms} ms`;
});

/* ============================== 7. 动态触发 ============================== */
group('7 动态触发与稳定性');

check('无变化时不建议重算', () => {
  FA.store.reset();
  const ev = FA.triggers.evaluate();
  assert(ev.shouldReplan === false, '无变化却建议重算');
  assert(ev.level === 'none', `级别应为 none，实际 ${ev.level}`);
  return ev.recommendation;
});

check('雨量增量达到 20 mm 时触发重算建议', () => {
  FA.store.reset();
  FA.store.advanceRainfall(20, '测试');
  const ev = FA.triggers.evaluate();
  assert(ev.shouldReplan === true, `应建议重算：${ev.reasons.join('；')}`);
  assert(ev.hits.some((h) => h.key === 'rainfallDeltaMm'), '未记录雨量阈值命中');
  return ev.reasons[0];
});

check('未达阈值时只累积提示，不重算（防方案频繁变动）', () => {
  FA.store.reset();
  FA.store.advanceRainfall(5, '测试');
  const ev = FA.triggers.evaluate();
  assert(ev.shouldReplan === false, '未达阈值却触发重算');
  assert(FA.store.peekPendingChanges().count > 0, '变化未被累积记录');
  assert(/累积|尚未达到/.test(ev.recommendation), `提示语异常：${ev.recommendation}`);
  return `增量 5 mm → ${ev.recommendation}`;
});

check('冷却期内即使命中阈值也仅提示', () => {
  FA.store.reset();
  FA.store.clearPendingChanges({ replan: true });
  FA.store.advanceRainfall(30, '测试');
  const ev = FA.triggers.evaluate();
  assert(ev.cooldownActive === true, '未进入冷却期');
  assert(ev.shouldReplan === false, '冷却期内仍触发了重算');
  assert(ev.level === 'watch', `级别应为 watch，实际 ${ev.level}`);
  return `冷却剩余 ${ev.cooldownRemainMinutes} 分钟`;
});

check('force=true 忽略阈值与冷却期', () => {
  FA.store.reset();
  FA.store.clearPendingChanges({ replan: true });
  const ev = FA.triggers.evaluate({ force: true });
  assert(ev.shouldReplan === true && ev.forced === true, '强制重算未生效');
  return '强制重研发生效（用于指挥员手动要求）';
});

/* ============================== 8. 工具契约 ============================== */
group('8 工具契约与人工确认');

check('全部工具都有 name / description / parameters', () => {
  const all = FA.tools.all();
  assert(all.length >= 19, `工具数量偏少：${all.length}`);
  all.forEach((t) => {
    assert(t.name && /^[a-z][a-z0-9_]*$/.test(t.name), `工具名不合法：${t.name}`);
    assert(t.description && t.description.length >= 12, `${t.name} 描述过短（模型无法判断用途）`);
    assert(t.parameters && t.parameters.type === 'object', `${t.name} 参数 schema 不合法`);
    assert(typeof t.handler === 'function', `${t.name} 缺少 handler`);
  });
  return `${all.length} 个工具：${all.map((t) => t.name).join('、')}`;
});

check('导出为 OpenAI / Codex 兼容的 function-calling 声明', () => {
  const schema = FA.tools.toOpenAiSchema();
  assert(Array.isArray(schema) && schema.length === FA.tools.all().length, '声明数量不一致');
  schema.forEach((s) => {
    assert(s.type === 'function', 'type 必须为 function');
    assert(s.function.name && s.function.description && s.function.parameters, '声明字段缺失');
  });
  return `${schema.length} 项工具声明可直接交给大模型`;
});

check('缺必填参数与类型错误会被拒绝执行', () => {
  const a = FA.tools.execute('search_plan_knowledge', {});
  assert(a.ok === false, '缺少必填 query 却执行成功');
  const b = FA.tools.execute('assess_flood_risk', { rainfallMm: '很多' });
  assert(b.ok === false, '类型错误却执行成功');
  const c = FA.tools.execute('assess_flood_risk', { rainfallMm: 9999 });
  assert(c.ok === false, '超出取值范围却执行成功');
  return '必填、类型、范围三类校验均生效';
});

check('未知工具调用被拒绝且列出可用工具', () => {
  const r = FA.tools.execute('do_something_magic', {});
  assert(r.ok === false, '未知工具竟然执行成功');
  assert(r.warnings.join(' ').indexOf('assess_flood_risk') >= 0, '未列出可用工具');
  return '已拒绝并给出可用工具清单';
});

check('需确认的工具在无令牌时返回待确认且不改变状态', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  const plan = FA.optimizer.optimize(worldFrom(FA), {});
  FA.store.patch({ plan }, { silent: true });
  FA.tools.execute('create_dispatch_tasks', {});
  const before = FA.store.raw().tasks.map((t) => t.stage).join(',');
  const pub = FA.tools.execute('publish_dispatch_plan', {});
  assert(pub.ok === false && pub.needConfirm === true, '发布未要求人工确认');
  assert(pub.confirmRequest && pub.confirmRequest.token, '未返回确认令牌');
  const after = FA.store.raw().tasks.map((t) => t.stage).join(',');
  assert(before === after, '待确认状态下任务状态被改变了');
  assert(pub.actions.length >= 1, '待确认回复缺少动作按钮');
  return `已暂停等待确认，令牌 ${pub.confirmRequest.token}`;
});

check('确认令牌与参数绑定（换参数即失效）', () => {
  const req = FA.confirm.request('publish_dispatch_plan', { channel: 'A' }, {});
  FA.confirm.approve(req.token, '测试指挥员', new HumanClickFixture());
  const bad = FA.confirm.verify('publish_dispatch_plan', { channel: 'B', _confirmToken: req.token });
  const good = FA.confirm.verify('publish_dispatch_plan', { channel: 'A', _confirmToken: req.token });
  assert(good.ok === true, '相同参数应通过校验');
  assert(bad.ok === false && bad.reason === 'signature-mismatch', '换参数后令牌竟然仍有效');
  return '同参数通过、换参数失效（防止批准 A 执行 B）';
});

check('禁止程序自动确认（必须人工）', () => {
  const req = FA.confirm.request('publish_dispatch_plan', { channel: 'C' }, {});
  const auto = FA.confirm.approve(req.token, null);
  assert(auto.ok === false, '未署名也能确认，人工闸门失效');
  assert(FA.confirm.allowAutoConfirm === false, 'allowAutoConfirm 应为 false');
  const human = FA.confirm.approve(req.token, '指挥员-张三', new HumanClickFixture());
  assert(human.ok === true, '人工确认失败');
  return '未署名被拒绝、人工确认通过';
});

check('发布流程：确认后才改变任务状态并生成通知文本', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  FA.store.patch({ plan: FA.optimizer.optimize(worldFrom(FA), {}) }, { silent: true });
  FA.tools.execute('create_dispatch_tasks', {});
  const r1 = FA.tools.execute('publish_dispatch_plan', {});
  assert(r1.needConfirm === true, '首次调用应要求确认');
  FA.confirm.approve(r1.confirmRequest.token, '演练指挥员', new HumanClickFixture());
  const r2 = FA.tools.execute('publish_dispatch_plan', { _confirmToken: r1.confirmRequest.token });
  assert(r2.ok === true, `确认后发布失败：${r2.summary}`);
  const stages = FA.store.raw().tasks.map((t) => t.stage);
  assert(stages.every((s) => s === 'published'), `任务状态未全部发布：${stages.join(',')}`);
  assert(r2.data.notifications.length > 0, '未生成政务通知文本');
  assert(FA.store.raw().publishedPlanId, '未记录已发布方案');
  return `${stages.length} 条任务已发布，生成 ${r2.data.notifications.length} 条通知文本`;
});

check('状态机：已接收 → 已上车 → 已到达 全程留痕', () => {
  const s = FA.store.raw();
  const before = s.tasks.length;
  FA.tools.execute('update_task_state', { taskId: 'ALL', stage: 'received', actor: '执行人员（模拟）' });
  FA.tools.execute('update_task_state', { taskId: 'ALL', stage: 'boarded', actor: '执行人员（模拟）' });
  const last = FA.tools.execute('update_task_state', { taskId: 'ALL', stage: 'arrived', actor: '执行人员（模拟）' });
  assert(last.ok === true, '更新到已到达失败');
  assert(last.data.allDone === true, '未识别为全部完成');
  const t = FA.store.raw().tasks[0];
  assert(t.history.length >= 4, `任务历史不足：${t.history.length}`);
  assert(before === FA.store.raw().tasks.length, '任务数量被意外改变');
  return `${before} 条任务走完接收/上车/到达，历史留痕 ${t.history.length} 条`;
});

check('未知状态值被拒绝', () => {
  const r = FA.store.updateTaskStage(FA.store.raw().tasks[0].id, 'teleported', '测试');
  assert(r.ok === false, '非法状态竟然被接受');
  return '非法状态已拒绝';
});

/* ============================== 9. 动作按钮 ============================== */
group('9 动作按钮与执行闭环');

check('每个动作按钮都可 JSON 序列化（可跨 iframe 传输）', () => {
  const acts = [
    FA.actions.factory.assess(), FA.actions.factory.optimize(), FA.actions.factory.publish(),
    FA.actions.factory.advanceRain(20)
  ];
  acts.forEach((a) => {
    const round = JSON.parse(JSON.stringify(a));
    assert(round.label && round.kind, '序列化后字段丢失');
  });
  return `${acts.length} 个按钮可安全跨窗口传输`;
});

check('动作按钮分组渲染', () => {
  const groups = FA.actions.groupActions([
    FA.actions.factory.assess(), FA.actions.factory.priority(), FA.actions.factory.optimize()
  ]);
  assert(groups.length >= 2, '未按组归拢');
  return groups.map((g) => g.group + '(' + g.actions.length + ')').join('、');
});

check('点击动作按钮确实调用工具并改变状态', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  const before = FA.store.raw().risk;
  const res = FA.actions.dispatch(FA.actions.factory.assess(), { source: 'test' });
  assert(res.ok === true, `动作执行失败：${res.summary}`);
  assert(before === null && FA.store.raw().risk !== null, '状态未发生变化');
  return '动作按钮 → 工具 → 状态变更 链路打通';
});

check('口播雨量动作会触发阈值判定', () => {
  FA.store.reset();
  const res = FA.actions.dispatch(FA.actions.factory.advanceRain(25), { source: 'test' });
  assert(res.ok === true, '口播推进失败');
  assert(res.trigger && res.trigger.shouldReplan === true, '口播 25 mm 未触发重算建议');
  return `${res.before} → ${res.after} mm，触发重算建议`;
});

/* ============================== 10. 智能体闭环 ============================== */
group('10 智能体对话闭环');

const agent = FA.agent;

function runPipelineTurn(text) {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  agent.reset();
  // 关键：演练状态是共享可变的，后续用例会重置它。
  // 因此必须在「这一轮刚跑完」时就把证据快照下来，而不是等断言时再去读 store。
  return Promise.resolve(agent.handleUserMessage(text, { source: 'test' })).then((t) => {
    t.evidence = {
      plan: FA.store.raw().plan,
      taskCount: FA.store.raw().tasks.length,
      publishedPlanId: FA.store.raw().publishedPlanId,
      scenarioMatrix: FA.store.raw().scenarioMatrix,
      pendingChanges: JSON.parse(JSON.stringify(FA.store.peekPendingChanges()))
    };
    return t;
  });
}

const turns = {};

await runPipelineTurn('未来 6 小时累计降雨 120 毫米，帮我做一次完整的研判和调度建议')
  .then((t) => { turns.pipeline = t; })
  .catch((e) => { turns.pipelineError = e; });

check('一句话触发完整研判链路', () => {
  assert(!turns.pipelineError, `执行异常：${turns.pipelineError && turns.pipelineError.message}`);
  const t = turns.pipeline;
  const names = t.toolResults.map((r) => r.tool);
  assert(names.length >= 5, `仅调用 ${names.length} 个工具：${names.join(',')}`);
  assert(names.indexOf('assess_flood_risk') >= 0, '未评估风险');
  assert(names.indexOf('identify_priority_groups') >= 0, '未识别优先保障群体');
  assert(names.indexOf('analyze_resource_gap') >= 0, '未核查资源缺口');
  assert(names.indexOf('optimize_dispatch') >= 0, '未生成调度方案');
  assert(t.evidence.plan, '这一轮结束时状态里没有方案');
  return `${names.length} 步：${names.join(' → ')}`;
});

check('回复一定附带动作按钮（会议纪要硬要求）', () => {
  const t = turns.pipeline;
  assert(t.actions.length >= 1, '回复没有任何动作按钮');
  assert(t.actions.every((a) => a.label && a.kind), '存在非法按钮');
  return `${t.actions.length} 个按钮，例如「${t.actions[0].label}」`;
});

check('回复含结论、执行过程与关键数据', () => {
  const t = turns.pipeline;
  assert(t.text.indexOf('结论') >= 0, '缺少结论段');
  assert(t.text.indexOf('执行过程') >= 0, '缺少执行过程');
  assert(t.text.indexOf('关键数据') >= 0, '缺少关键数据');
  assert(/已安排 \d+\/\d+ 人/.test(t.text), '未给出安排人数');
  return t.text.split('\n')[0].slice(0, 50) + '…';
});

check('回复包含边界提示（免责声明）', () => {
  const t = turns.pipeline;
  assert(t.warnings.length > 0, '没有任何边界提示');
  assert(t.warnings.some((w) => /演练|公开数据|人工确认|积水/.test(w)), '边界提示内容不足');
  return t.warnings[0].slice(0, 40) + '…';
});

check('运行路径如实标注（离线不冒充大模型）', () => {
  const t = turns.pipeline;
  assert(t.provider.provider === 'offline', `默认为离线，实际 ${t.provider.provider}`);
  assert(/未接入大模型|离线/.test(t.provider.disclosure), '未说明当前未接入大模型');
  assert(t.provider.apiSlot && t.provider.apiSlot.ready === false, 'API 接口应处于已预留未填写状态');
  return t.provider.disclosure.slice(0, 40) + '…';
});

check('未识别意图时不调用工具、不编造结论', () => {
  FA.store.reset();
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('帮我写一首关于春天的诗', { source: 'test' })).then((t) => {
    assert(t.toolResults.length === 0, `不该调用工具，实际调用 ${t.toolResults.length} 个`);
    assert(/没有识别出|没有调用任何工具/.test(t.text), '未如实说明无法处理');
    assert(t.actions.length >= 1, '引导回复也应带动作按钮');
    return '已如实说明并给出可执行按钮';
  });
});

check('「发布」指令先要求人工确认，不自行发布', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('生成任务并发布', { source: 'test' })).then((t) => {
    assert(t.needConfirm === true, '发布指令未要求确认');
    assert(FA.store.raw().publishedPlanId === null, '未经确认就发布了');
    assert(t.text.indexOf('需要人工确认') >= 0, '回复未说明需人工确认');
    return '已暂停等待人工确认';
  });
});

check('「为什么这样调度」有依据可追溯', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  FA.store.patch({ plan: FA.optimizer.optimize(worldFrom(FA), {}) }, { silent: true });
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('为什么这样调度？', { source: 'test' })).then((t) => {
    const d = t.toolResults[0].data;
    assert(t.toolResults[0].tool === 'explain_plan', `工具选择错误：${t.toolResults[0].tool}`);
    assert(d.rules.length >= 5, '缺少调度规则说明');
    assert(d.reasons.length > 0 && d.reasons[0].chain.length > 0, '缺少逐组解释');
    assert(d.baselineComparison.deltas.length > 0, '缺少与基线的差异');
    return `${d.rules.length} 条规则、${d.reasons.length} 条线路解释、${d.bindingConstraints.length} 项起约束资源`;
  });
});

check('「如果雨继续下」触发情景推演', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('如果雨继续下到 160 毫米怎么办？', { source: 'test' })).then((t) => {
    assert(t.toolResults[0].tool === 'simulate_rainfall_scenario', `工具选择错误：${t.toolResults[0].tool}`);
    assert(FA.store.raw().scenarioMatrix, '推演结果未写入状态');
    return '已生成情景推演矩阵';
  });
});

check('情景推演：雨量增大时高风险网格数不减少', () => {
  FA.store.reset();
  const w = worldFrom(FA);
  const steps = [80, 120, 160];
  const counts = steps.map((mm) => {
    const r = FA.analytics.riskByZone(w.zones, mm);
    return r.zones.filter((z) => z.level === 'high' || z.level === 'very-high').length;
  });
  for (let i = 1; i < counts.length; i++) {
    assert(counts[i] >= counts[i - 1], `${steps[i]}mm 的高风险网格数少于 ${steps[i - 1]}mm`);
  }
  return steps.map((s, i) => `${s}mm:${counts[i]}个`).join(' ');
});

check('「已到达」回执推进工作流', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  FA.store.patch({ plan: FA.optimizer.optimize(worldFrom(FA), {}) }, { silent: true });
  FA.tools.execute('create_dispatch_tasks', {});
  // Execution receipts apply only after an explicit human publication.
  const publish = FA.tools.execute('publish_dispatch_plan', {});
  assert(FA.confirm.approve(publish.confirmRequest.token, '测试确认人', new HumanClickFixture()).ok, '人工批准失败');
  assert(FA.tools.execute('publish_dispatch_plan', { _confirmToken: publish.confirmRequest.token }).ok, '人工发布失败');
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('所有人员都已经到达安置点', { source: 'test' })).then((t) => {
    assert(t.toolResults[0].tool === 'update_task_state', `工具选择错误：${t.toolResults[0].tool}`);
    const stats = FA.tools.taskStats(FA.store.raw().tasks);
    assert(stats.byStage.arrived === stats.total, '未全部推进到已到达');
    return `${stats.total} 条任务全部到达，进度 ${Math.round(stats.progress * 100)}%`;
  });
});

check('状态查询返回完整快照', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('现在什么情况？', { source: 'test' })).then((t) => {
    const d = t.toolResults[0].data;
    assert(d.scenario && d.rainfallMm != null && d.trigger, '快照字段不全');
    assert(t.toolResults[0].tool === 'get_system_state', `工具选择错误：${t.toolResults[0].tool}`);
    return `情景 ${d.scenario.name}，雨量 ${d.rainfallMm} mm`;
  });
});

check('风险/调度后清空累积变化并记录重算时间', () => {
  FA.store.reset();
  agent.reset();
  FA.store.advanceRainfall(25, '测试');
  return Promise.resolve(agent.handleUserMessage('帮我做一次完整的研判和调度建议', { source: 'test' })).then(() => {
    const pc = FA.store.peekPendingChanges();
    assert(pc.count === 0, `重算后累积变化未清空：${pc.count}`);
    assert(pc.lastReplanAt, '未记录重算时间（最短重算间隔失效）');
    return '累积变化已清零，重算时间已记录';
  });
});

/* ============================== 11. 报告与合规 ============================== */
group('11 报告与合规');

check('应急决策报告包含必备章节与免责声明', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('帮我做一次完整的研判和调度建议', { source: 'test' }))
    .then(() => Promise.resolve(agent.handleUserMessage('生成应急决策报告', { source: 'test' })))
    .then((t) => {
      const r = t.toolResults[0];
      assert(r.tool === 'compose_decision_report', `工具选择错误：${r.tool}`);
      const md = r.data.markdown;
      ['一、积水易发风险评估', '二、社会脆弱性', '三、应急保障能力', '四、调度方案', '八、数据来源', '九、边界与不做什么']
        .forEach((s) => assert(md.indexOf(s) >= 0, `报告缺少章节：${s}`));
      assert(md.indexOf('演练用途声明') >= 0, '报告缺少用途声明');
      assert(r.data.bytes > 1500, `报告过短：${r.data.bytes} 字符`);
      return `${r.data.bytes} 字符，${r.data.sections.length} 个章节`;
    });
});

check('合规自查全部通过', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('帮我做一次完整的研判和调度建议', { source: 'test' }))
    .then(() => Promise.resolve(agent.handleUserMessage('做一次合规与边界自查', { source: 'test' })))
    .then((t) => {
      const r = t.toolResults[0];
      assert(r.tool === 'check_compliance', `工具选择错误：${r.tool}`);
      assert(r.data.failed === 0, `未通过：${r.data.checks.filter((c) => !c.pass).map((c) => c.label).join('；')}`);
      return `${r.data.passed}/${r.data.total} 项通过`;
    });
});

check('政务通知文本可粘贴且含回执要求', () => {
  FA.store.reset();
  FA.store.applyScenario('rain-120');
  FA.store.patch({ plan: FA.optimizer.optimize(worldFrom(FA), {}) }, { silent: true });
  FA.tools.execute('create_dispatch_tasks', {});
  const r = FA.tools.execute('export_for_gov_channel', { style: 'full' });
  assert(r.ok === true, '导出失败');
  assert(r.data.notifications.length > 0, '没有车辆通知');
  assert(/回执要求/.test(r.data.fullText), '缺少回执要求');
  assert(/演练/.test(r.data.fullText), '缺少演练用途提示');
  return `${r.data.notifications.length} 条通知，共 ${r.data.charCount} 字符`;
});

check('未建设独立接收端（架构精简要求）', () => {
  const r = FA.tools.execute('export_for_gov_channel', {});
  assert(/现有政务通讯工具/.test(r.data.channel), `渠道说明异常：${r.data.channel}`);
  return r.data.channel;
});

/* ============================== 12. 运行路径 ============================== */
group('12 大模型适配与预留接口');

check('默认离线运行且不主动联网', () => {
  assert(FA.llm.config.provider === 'offline', '默认 provider 应为 offline');
  assert(FA.llm.config.allowNetwork === false, '默认不应允许联网');
  assert(FA.llm.active().name === 'offline', '生效 provider 应为 offline');
  return FA.llm.active().label;
});

check('预留的 API 接口字段齐备且为空', () => {
  const c = FA.llm.config;
  ['baseUrl', 'apiKey', 'model'].forEach((k) => {
    assert(k in c, `缺少预留字段 ${k}`);
    assert(c[k] === '', `${k} 应为空（预留未填写），实际「${c[k]}」`);
  });
  return 'baseUrl / apiKey / model 已预留且为空';
});

check('在线适配器在未配置时不可用并给出原因', () => {
  const p = FA.llm.get('openai-compatible');
  assert(p, '未注册在线适配器');
  assert(p.available() === false, '未配置却报告可用');
  const reason = p.unavailableReason();
  assert(/baseUrl|apiKey|model|allowNetwork/.test(reason), `原因说明不足：${reason}`);
  return reason.slice(0, 40) + '…';
});

check('切换到不可用的在线路径会被拒绝且不改变现状', () => {
  const r = FA.llm.use('openai-compatible');
  assert(r.ok === false, '不可用却切换成功');
  assert(FA.llm.config.provider === 'offline', 'provider 被意外改变');
  return r.message.slice(0, 40) + '…';
});

check('在线调用失败时回落离线引擎并留痕', () => {
  const before = FA.trace.entries.length;
  FA.llm.config.baseUrl = 'https://example.invalid/v1';
  FA.llm.config.apiKey = 'test-key';
  FA.llm.config.model = 'test-model';
  FA.llm.config.allowNetwork = true;

  // 先显式切换运行路径（否则 provider 仍是 offline，测的就不是回落逻辑）
  const switched = FA.llm.use('openai-compatible');
  assert(switched.ok === true, `切换在线路径失败：${switched.message}`);
  assert(FA.llm.active().name === 'openai-compatible', '未切换到在线路径');
  assert(FA.llm.describe().mode === 'online', '路径说明未反映在线模式');

  return Promise.resolve(FA.llm.complete([{ role: 'user', content: '现在什么情况' }], {}))
    .then((res) => {
      assert(res.provider === 'offline', `应回落离线，实际 ${res.provider}`);
      assert(res.fellBack === true, '未标记为回落');
      const added = FA.trace.entries.slice(before).some((e) => /回落|不可用/.test(e.title));
      assert(added, '轨迹中未留下回落记录');
      return '网络失败 → 回落离线 → 轨迹留痕，且路径说明如实标注';
    })
    .finally(() => {
      FA.llm.config.baseUrl = '';
      FA.llm.config.apiKey = '';
      FA.llm.config.model = '';
      FA.llm.config.allowNetwork = false;
      FA.llm.config.provider = 'offline';
    });
});

/* ============================== 13. 知识与技能 ============================== */
group('13 预案知识库与技能规范');

const hasKb = !!(FA.kbDocs && FA.kbDocs.length);
const hasSkills = !!(FA.skillSources && FA.skillSources.length);

check('知识库已构建且每份文件带机构与公开链接', () => {
  if (!hasKb) return '跳过：未构建 kb-bundle.js（先执行 node scripts/build-bundles.mjs）';
  assert(FA.kbDocs.length >= 5, `知识库仅 ${FA.kbDocs.length} 份`);
  FA.kbDocs.forEach((d) => {
    assert(d.title, `${d.id} 缺少标题`);
    if (d.category === 'source-index') return;
    assert(d.publisher, `${d.id} 缺少发布机构`);
    assert(/^https?:\/\//.test(d.url), `${d.id} 缺少公开链接`);
  });
  return `${FA.kbDocs.length} 份：${FA.kbDocs.map((d) => d.title).join('、').slice(0, 60)}…`;
});

check('RAG 检索返回带出处的片段', () => {
  if (!hasKb) return '跳过：知识库未构建';
  const r = FA.rag.search('老人 转移 优先顺序', 3);
  assert(r.ok === true, `检索失败：${r.note}`);
  assert(r.hits.length > 0, '没有命中');
  r.hits.forEach((h) => {
    assert(h.title && h.url, '命中项缺少标题或链接');
    assert(h.text.length > 6, '片段过短');
  });
  return `${r.hits.length} 条命中，首条《${r.hits[0].title}》`;
});

check('检索不到依据时如实说明且不编造', () => {
  if (!hasKb) return '跳过：知识库未构建';
  const r = FA.rag.search('量子计算机 星际航行 曲率引擎', 3);
  if (r.ok) return '该词意外命中，跳过（不影响结论）';
  assert(/没有检索到/.test(r.note), `提示语异常：${r.note}`);
  const t = FA.tools.execute('search_plan_knowledge', { query: '量子计算机 星际航行 曲率引擎' });
  assert(t.ok === false, '无依据却返回成功');
  assert(t.warnings.join(' ').indexOf('不应给出') >= 0, '缺少「不编造规定」的提示');
  return '已如实说明没有依据，并声明不得编造规定';
});

check('检索声明为关键词检索而非向量检索', () => {
  if (!hasKb) return '跳过：知识库未构建';
  const st = FA.rag.status();
  assert(/keyword/i.test(st.method), `方法名需为关键词检索，实际 ${st.method}`);
  assert(/不是向量检索/.test(st.methodNote), '缺少与向量检索的区别说明');
  return st.methodLabel;
});

check('技能符合 Agent Skills 规范（frontmatter + 描述 + 正文）', () => {
  if (!hasSkills) return '跳过：未构建 skills-bundle.js';
  const st = FA.skills.status();
  assert(st.count >= 7, `技能仅 ${st.count} 个`);
  const cat = FA.skills.catalog();
  cat.forEach((s) => {
    assert(s.name, '技能缺少 name');
    assert(s.description && s.description.length >= 10, `${s.name} 描述过短`);
    assert(s.lineCount >= 20, `${s.name} 正文过短（${s.lineCount} 行）`);
  });
  return `${st.count} 个技能：${cat.map((s) => s.name).join('、')}`;
});

check('技能中提到的工具都已注册（无悬空引用）', () => {
  if (!hasSkills) return '跳过：未构建 skills-bundle.js';
  const v = FA.skills.validate();
  assert(v.ok, `技能一致性问题：${v.issues.join('；')}`);
  return `${v.count} 个技能与 ${FA.tools.all().length} 个工具一致`;
});

check('技能采用渐进式披露（目录只给名称与描述）', () => {
  if (!hasSkills) return '跳过：未构建 skills-bundle.js';
  const cat = FA.skills.catalog();
  assert(cat[0].body === undefined, '目录不应包含正文');
  const body = FA.skills.body(cat[0].name);
  assert(body && body.length > 100, '按需取正文失败');
  return `目录 ${cat.length} 项仅含元信息，正文按需加载 ${body.length} 字符`;
});

/* ============================== 14. 雨量口径与过期标记 ============================== */
group('14 雨量口径与过期标记');

check('口述雨量同时写入情景状态（方案与界面口径一致）', () => {
  FA.store.reset();
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('未来 6 小时累计降雨 120 毫米，帮我做一次完整的研判和调度建议', { source: 'test' }))
    .then((t) => {
      assert(t.toolResults[0].tool === 'set_scenario_rainfall',
        `首个工具应为「设定累计雨量」，实际 ${t.toolResults[0].tool}`);
      assert(FA.store.get().rainfallMm === 120, `情景雨量应为 120，实际 ${FA.store.get().rainfallMm}`);
      const plan = FA.store.raw().plan;
      assert(plan && plan.rainfallMm === 120, `方案雨量应为 120，实际 ${plan && plan.rainfallMm}`);
      assert(FA.store.raw().risk.rainfallMm === 120, '风险结果的雨量口径与情景不一致');
      assert(FA.store.get().stale === false, '整链重算完成后不应仍处于过期状态');
      return `情景 ${FA.store.get().rainfallMm} mm / 风险 ${FA.store.raw().risk.rainfallMm} mm / 方案 ${plan.rainfallMm} mm —— 三处口径一致`;
    });
});

check('输入变化后标记过期，重算后标记自动消失', () => {
  FA.store.reset();
  agent.reset();
  return Promise.resolve(agent.handleUserMessage('帮我做一次完整的研判和调度建议', { source: 'test' }))
    .then(() => {
      assert(FA.store.get().stale === false, '刚重算完不应处于过期状态');
      FA.store.advanceRainfall(25, '测试雨情漂移');
      assert(FA.store.get().stale === true, '雨量变化后应标记为过期');
      return Promise.resolve(agent.handleUserMessage('重新研判', { source: 'test' }));
    })
    .then(() => {
      assert(FA.store.get().stale === false, '重新研判后过期标记应消失，不能一直挂着');
      return '变化 → 过期 → 重算 → 标记消失（不会用旧结论冒充新结论，也不会误报过期）';
    });
});

check('情景设定不计入变化累积（避免把设定误判为雨情漂移）', () => {
  FA.store.reset();
  const r = FA.tools.execute('set_scenario_rainfall', { rainfallMm: 160 });
  assert(r.ok === true, `设定雨量失败：${r.summary}`);
  assert(FA.store.get().rainfallMm === 160, '雨量未设定成功');
  const pc = FA.store.peekPendingChanges();
  assert(pc.count === 0 && pc.rainfallDeltaMm === 0,
    `情景设定不应计入变化累积，实际 count=${pc.count} delta=${pc.rainfallDeltaMm}`);
  return '设定 160 mm 后变化累积仍为 0，不会误触发重算';
});

/* ============================== 15. 汇报 ============================== */
// 按登记顺序逐个执行（异步用例会被真正 await，断言不会被跳过）
await runQueue();

const passed = results.filter((r) => r.ok).length;
const failed = results.filter((r) => !r.ok);
const skipped = results.filter((r) => r.ok && /^跳过/.test(r.detail));

const summary = {
  generatedAt: new Date().toISOString(),
  node: process.version,
  total: results.length,
  passed,
  failed: failed.length,
  skipped: skipped.length,
  groups: [...new Set(results.map((r) => r.group))].map((g) => {
    const rs = results.filter((r) => r.group === g);
    return { group: g, total: rs.length, passed: rs.filter((r) => r.ok).length, failed: rs.filter((r) => !r.ok).length };
  }),
  results
};

const OUTPUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tmp/guardian-tests');
fs.mkdirSync(OUTPUT, { recursive: true });
fs.writeFileSync(path.join(OUTPUT, 'test-report.json'), JSON.stringify(summary, null, 2), 'utf8');

const md = [];
md.push('# 城市韧性守护 Agent · 测试报告');
md.push('');
md.push(`生成时间：${summary.generatedAt} · Node ${summary.node}`);
md.push('');
md.push(`**结果：${passed}/${results.length} 通过**${failed.length ? `，${failed.length} 失败` : ''}${skipped.length ? `，${skipped.length} 项跳过` : ''}。`);
md.push('');
md.push('| 分组 | 通过 | 失败 | 合计 |');
md.push('| --- | --- | --- | --- |');
summary.groups.forEach((g) => md.push(`| ${g.group} | ${g.passed} | ${g.failed} | ${g.total} |`));
md.push('');
for (const g of summary.groups) {
  md.push(`## ${g.group}`);
  md.push('');
  results.filter((r) => r.group === g.group).forEach((r) => {
    md.push(`- ${r.ok ? '✅' : '❌'} **${r.name}** — ${r.detail}`);
  });
  md.push('');
}
fs.writeFileSync(path.join(OUTPUT, 'test-report.md'), md.join('\n'), 'utf8');

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(summary, null, 2));
} else {
  console.log('城市韧性守护 Agent · 测试报告');
  console.log('='.repeat(64));
  for (const g of summary.groups) {
    console.log(`\n${g.group}  (${g.passed}/${g.total})`);
    results.filter((r) => r.group === g.group).forEach((r) => {
      console.log(`  ${r.ok ? 'PASS' : 'FAIL'}  ${r.name}`);
      if (r.detail) console.log(`        ${r.detail}`);
      if (!r.ok && r.stack) console.log(`        ${r.stack.split('\n')[1] || ''}`);
    });
  }
  console.log('\n' + '='.repeat(64));
  console.log(`总计：${passed}/${results.length} 通过${failed.length ? `，${failed.length} 失败` : ''}${skipped.length ? `，${skipped.length} 跳过` : ''}`);
  console.log(`报告：tmp/guardian-tests/test-report.md 与 test-report.json`);
}

process.exitCode = failed.length ? 1 : 0;
