/*! 早期冒烟检查：核心分析链路能否跑通（不依赖 UI） */
import { loadFA, CORE_SCRIPTS, worldFrom } from './loader.mjs';

const FA = loadFA(CORE_SCRIPTS);
console.log('加载成功：模块 =', Object.keys(FA).join(', '));

FA.store.applyScenario('rain-120');
const w = worldFrom(FA);
console.log('\n情景 rain-120：雨量', w.rainfallMm, 'mm / 人员组', w.groups.length, '/ 车辆', w.vehicles.length, '/ 安置点', w.shelters.length);

const access = FA.analytics.accessibility(w.zones, w.shelters, w.roads);
console.log('开放路段', access.openRoadCount, '条；避难点可达时间(R01) =', access.shelterMinutes.R01, '分钟');

for (const mm of [35, 80, 120, 160]) {
  const risk = FA.analytics.riskByZone(w.zones, mm);
  const top = risk.zones.slice(0, 3).map(z => `${z.zoneId}:${z.percent}%(${z.levelLabel})`).join(' ');
  console.log(`  雨量 ${String(mm).padStart(3)} mm → 最高风险 ${top}`);
}

const svi = FA.analytics.sviByZone(w.zones, w.groups, access);
console.log('SVI 最高：', svi.zones.slice(0, 3).map(z => `${z.zoneId}:${z.percent}%`).join(' '));

const plan = FA.optimizer.optimize(w, { objective: 'risk_first' });
console.log('\n方案指标：已安排', plan.metrics.servedPeople, '/', plan.metrics.totalPeople,
  '| 未安排', plan.metrics.unassignedPeople,
  '| 加权等待', plan.metrics.weightedWait,
  '| 完成', plan.metrics.finishMinute, '分钟',
  '| 约束校验', plan.validation.ok ? '通过' : '失败 ' + plan.validation.errors.join('; '));
console.log('基线对比：加权等待', plan.comparison.metrics.weightedWait.baseline, '→', plan.comparison.metrics.weightedWait.optimized,
  '| 未安排', plan.comparison.metrics.unassignedPeople.baseline, '→', plan.comparison.metrics.unassignedPeople.optimized);
console.log('局部搜索：', JSON.stringify(plan.search));
console.log('车辆安排：');
plan.assignments.forEach(a => {
  console.log(`  ${a.vehicleName} → ${a.stops.map(s => s.groupName + '(' + s.zoneId + ',' + s.people + '人)').join(' → ')} → ${a.shelterName}  [${a.finishMinute}min]`);
});
if (plan.unassigned.length) console.log('未安排：', plan.unassigned.map(u => u.name).join('、'));
