'use strict';
// Reproducible fixture benchmark. Run with Node; no network or model required.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const X=require('../exercise.cjs');
const RELEASE='4.0.0';
const repetitions=3;
const sum=(rows,fn)=>rows.reduce((n,x)=>n+fn(x),0);
const round=n=>Math.round(n*100)/100;
function timed(fn){const times=[];let value;for(let n=0;n<repetitions;n++){const start=performance.now();value=fn();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {value,timing:{minMs:round(times[0]),medianMs:round(times[Math.floor(times.length/2)]),maxMs:round(times.at(-1)),repetitions}};}
function metrics(i,p){return {algorithm:p.algorithm,servedPeople:p.servedPeople,totalPeople:p.totalPeople,unassignedPeople:sum(p.unassigned,h=>h.people),urgentPeople:p.urgentPeople,assistedPeople:p.assistedPeople,weightedWait:p.wait,finishMinute:p.finish,driveMinutes:p.drive,complete:p.complete,unassigned:p.unassigned.map(h=>({id:h.id,name:h.name,people:h.people,reason:h.reason})),validationErrors:X.validate(i,p)};}
function evaluate(id,name,data){
  const input=X.snapshot(data),optimized=timed(()=>X.solve(input)),baseline=timed(()=>X.baseline(input));
  const context={...data,plan:optimized.value.plan,alternative:optimized.value.alternative,baseline:baseline.value,planSnapshot:input};
  const diagnostics=X.diagnostics(context);
  return {id,name,inputHash:crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'),inputSnapshot:input,groups:input.scenario.households.length,people:optimized.value.plan.totalPeople,sourceMode:input.scenario.region.mapKind,optimized:{...metrics(input,optimized.value.plan),timing:optimized.timing},baseline:{...metrics(input,baseline.value),timing:baseline.timing},comparison:diagnostics.comparison,explanations:diagnostics.unassigned,interpretation:optimized.value.plan.complete?'本轮草案全部可安排；仅反映所列演练输入，不等于已接送或已核验。':'本轮草案仍有未安排人员；保留缺口，不把部分方案宣称为全部解决。'};
}
function scaleData(count){
  const data=X.initial();data.stage={};data.contacts={};
  data.scenario.households=Array.from({length:count},(_,n)=>{const assisted=n%7===0,wheelchair=n%17===0,id='LOAD'+(n+1),risk=n%5===0?3:1;data.stage[id]='waiting';data.contacts[id]={ack:false,contacted:false};return {id,node:'H'+(n%6+1),name:'规模演练组 '+(n+1),people:1,priority:risk,risk,riskBase:risk,assistance:assisted||wheelchair,wheelchair,assistancePeople:Number(assisted||wheelchair),wheelchairPeople:Number(wheelchair),service:wheelchair?6:assisted?5:2,note:'固定规则生成的规模样例，不是真实居民数据',response:'待联系'};});
  return data;
}
const demand=(people,villageId='VA')=>({source:'text',rows:[{villageId,pickupId:villageId==='VA'?'P-A1':'P-B1',people,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'评估脚本合成新增 '+people+' 人，协助0，轮椅0，可分组'}]});
function intakeJourney(){
  const exercise=X.create(X.createBlank({mapMode:'ruian-roads'}));
  const initialPeople=X.metrics(exercise.data).people;
  exercise.action('command-intake',demand(20));
  const uploaded=evaluate('upload20','空白道路任务上传20人',exercise.data);
  exercise.action('confirm');
  exercise.action('village-report',{...demand(3,'VB').rows[0],mode:'increment',reporter:'合成评估脚本',source:'voice'});
  const pending={effectivePeople:X.metrics(exercise.data).people,pendingReviewPeople:X.taskSummary(exercise.data).pendingReviewPeople,activePlanId:exercise.data.activePlan.id};
  exercise.action('village-review',{id:exercise.data.villageReports[0].id,decision:'accept',note:'评估脚本模拟人工核对，非现场实测'});
  const reviewed=evaluate('upload20-review3','20人加已核实补报3人',exercise.data);
  return {id:'upload20-plus3',name:'空白创建→上传20人→补报3人→核实',initialPeople,uploaded,pending,reviewed,passed:initialPeople===0&&uploaded.people===20&&pending.effectivePeople===20&&pending.pendingReviewPeople===3&&reviewed.people===23&&reviewed.optimized.servedPeople+reviewed.optimized.unassignedPeople===23,interpretation:'待核实3人不提前计入有效需求；采纳后才变为23人。此处只评估输入守恒与方案缺口，没有模拟实际交通或语音识别成功率。'};
}
function multiTripJourney(shelterCapacity=20){
  const exercise=X.create(X.createBlank({mapMode:'same'}));
  exercise.action('configure-resources',{vehicles:[{id:'V1',name:'4座演练车',start:'D',capacity:4,wheelchair:false,available:true}],shelters:[{id:'S1',name:'演练接收点',capacity:shelterCapacity,available:true}]});
  exercise.action('command-intake',demand(8));
  const input=X.snapshot(exercise.data),rounds=[];
  for(let round=1;round<=3;round++){
    if(!exercise.fresh())exercise.action('generate');
    const before=exercise.data,plan=before.plan,check=X.validate(X.snapshot(before),plan);
    if(!plan.servedPeople){rounds.push({round,plannedPeople:0,unassignedPeople:sum(plan.unassigned,h=>h.people),unassigned:plan.unassigned,validationErrors:check});break;}
    exercise.action('confirm');const route=exercise.data.activePlan.routes.find(r=>r.vehicleId==='V1'),planId=exercise.data.activePlan.id;
    exercise.action('field-progress',{stage:'ack',planId,vehicleId:'V1',reporter:'合成评估脚本'});
    const ids=route.stops.filter(st=>exercise.data.stage[st.id]==='waiting'&&!exercise.data.contacts[st.id]?.contacted).map(st=>st.id);
    if(ids.length)exercise.action('field-contact-batch',{planId,vehicleId:'V1',householdIds:ids});
    exercise.action('start-vehicle',{planId,vehicleId:'V1'});
    let steps=0;while(!exercise.data.fleet.V1.finished&&steps++<20)exercise.action('step',{vehicleId:'V1'});
    if(!exercise.data.fleet.V1.finished)throw new Error('多趟评估推进次数异常');
    const arrivedIds=exercise.data.scenario.households.filter(h=>exercise.data.stage[h.id]==='arrived').map(h=>h.id);
    if(arrivedIds.length)exercise.action('verify-arrivals',{ids:arrivedIds});
    const after=exercise.data,m=X.metrics(after);
    rounds.push({round,plannedPeople:plan.servedPeople,unassignedPeople:sum(plan.unassigned,h=>h.people),fromNode:route.from,destination:route.shelterId,finishMinute:after.fleet.V1.minute,verifiedPeople:m.verified,waitingPeople:m.waiting,occupancy:{...after.occupancy},validationErrors:check});
    if(!m.waiting)break;
    exercise.action('start-next-trip',{vehicleId:'V1'});
  }
  const final=exercise.data,m=X.metrics(final),complete=m.verified===8&&m.waiting===0&&m.boarded===0&&m.arrived===0;
  return {id:'multi-trip-capacity-'+shelterCapacity,name:'一辆4座车 / 接收容量'+shelterCapacity+'人 / 8人需求',inputHash:crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'),inputSnapshot:input,rounds,final:{people:m.people,verifiedPeople:m.verified,waitingPeople:m.waiting,boardedPeople:m.boarded,arrivedPeople:m.arrived,totalOccupancy:sum(Object.values(final.occupancy),n=>n),vehicleTripCount:final.fleet.V1.deliveries?.length||0,finishMinute:final.fleet.V1.minute,complete},passed:rounds.every(row=>!row.validationErrors.length)&&m.people===8&&m.verified+m.waiting+m.boarded+m.arrived===8&&sum(Object.values(final.occupancy),n=>n)===m.verified+m.arrived,interpretation:'脚本逐次模拟人工发布、接令、联系、发车、到达及核验；每趟重新生成草案，车辆从上次接收点继续，已接收占用不清零。不代表多趟全局最优、真实运输耗时或自动发布。'};
}
function sourceFingerprint(){const names=['exercise.cjs','dispatch-large.cjs','intake-location.cjs','village-ledger.cjs','lifecycle.cjs','geo-scenario.cjs','scripts/evaluate-scenarios.cjs'];return Object.fromEntries(names.map(name=>[name,crypto.createHash('sha256').update(fs.readFileSync(path.resolve(__dirname,'..',name))).digest('hex')]));}
function markdown(result){
  const w=result.workflows,cell=value=>String(value).replace(/\|/g,'\\|');
  return `# V${RELEASE} 可复现评估

生成时间：${result.generatedAt}（UTC）。此文由 \`node scripts/evaluate-scenarios.cjs\` 与 [完整结果 JSON](../dist/assets/evaluation.json) 同时生成。输入均为合成演练，数值来自本轮实际运行，非人工填入的宣传指标。

## 固定情景

同一快照分别运行风险优先最近可行基线与约束调度算法；每个算法执行 ${repetitions} 次，记录毫秒中位数。两者都检查人数、座位、轮椅适配、接收容量及道路可行性。基线是明确规则的模拟方法，不代表实际指挥员。

| 情景 | 总需求 | 基线安排 | 优化安排 | 优化未安排 | 基线加权等待 | 优化加权等待 | 优化耗时中位数 |
|---|---:|---:|---:|---:|---:|---:|---:|
${result.cases.map(r=>`| ${cell(r.name)} | ${r.people} | ${r.baseline.servedPeople} | ${r.optimized.servedPeople} | ${r.optimized.unassignedPeople} | ${r.baseline.weightedWait} | ${r.optimized.weightedWait} | ${r.optimized.timing.medianMs} ms |`).join('\n')}

加权等待只计算本轮已安排人员。优化覆盖更多人时，总加权等待可能上升；它不等于全体人员平均等待，也不能单独用来宣传提速。所有情景的未安排清单与原因保留在 JSON 中。上述“安排”是草案覆盖，不是实际送达或人工核验。

## 20 人上传与 3 人补报

| 阶段 | 有效需求 | 待核实新增 | 当前草案安排 | 当前草案未安排 |
|---|---:|---:|---:|---:|
| 空白任务 | ${w.intake.initialPeople} | 0 | — | — |
| 上传20人后 | ${w.intake.uploaded.people} | 0 | ${w.intake.uploaded.optimized.servedPeople} | ${w.intake.uploaded.optimized.unassignedPeople} |
| 现场补报3人，尚未核实 | ${w.intake.pending.effectivePeople} | ${w.intake.pending.pendingReviewPeople} | 保持此前发布结果 | 等待核实 |
| 人工核实采纳后 | ${w.intake.reviewed.people} | 0 | ${w.intake.reviewed.optimized.servedPeople} | ${w.intake.reviewed.optimized.unassignedPeople} |

这证明没有混入15人示例，未核实补报没有提前计数。默认资源与既有分组条件下，23人并未在首轮全部安排；需要后续车辆周转、资源调整或人工协调。本测试用字段为合成的“语音来源”记录，不调用麦克风，不构成语音识别效果测试。

## 多趟与容量反例

两组试验均为8人、一辆4座车；先按当前分组接第一趟，送达并模拟人工核验，再准备下一趟、发布、执行。原接收占用保持。唯一改变的是接收容量，输出如下：

| 条件 | 实际完成趟数 | 累计已核验 | 仍待接 | 接收占用 | 演练终点分钟 | 全部完成 |
|---|---:|---:|---:|---:|---:|---|
${w.multiTrip.map(r=>`| ${cell(r.name)} | ${r.final.vehicleTripCount} | ${r.final.verifiedPeople} | ${r.final.waitingPeople} | ${r.final.totalOccupancy} | ${r.final.finishMinute} | ${r.final.complete?'是':'否'} |`).join('\n')}

有限容量的例子保留了缺口：现有接送组不会为填满余量而自动重新拆分。逐趟重算不是全局多趟最优，演练分钟来自设定路段时间，不是实车测量。脚本模拟每次人工确认，只验证合法业务路径，产品没有因此开放自动发布。

## 规模、复现与验证范围

| 规模 | 优化算法 | 优化耗时中位数 | 安排 / 总人数 | 未安排 |
|---|---|---:|---:|---:|
${result.scale.map(r=>`| ${r.groups}组 | ${r.optimized.algorithm} | ${r.optimized.timing.medianMs} ms | ${r.optimized.servedPeople} / ${r.people} | ${r.optimized.unassignedPeople} |`).join('\n')}

- 约束与守恒检查：**${result.passedConstraintChecks?'全部通过':'存在未通过项，不能用于发布材料'}**。
- 每个固定情景和流程样例保存完整 \`inputSnapshot\` 与 SHA-256；结果另含核心源码文件哈希、生成时间、Node版本、系统与CPU信息。
- 可用 \`X.solve(inputSnapshot)\` 和 \`X.baseline(inputSnapshot)\` 重新计算；计时会随机器和负载波动，不要求每次毫秒数相同。
- 环境：${result.environment.node} / ${result.environment.platform} ${result.environment.arch} / ${result.environment.cpu}。
- 大模型调用次数为0。本评估没有真人受试者，不证明AI独立增益、真实指挥效率、实际减灾效果或跨区域推广效果。真人上手记录另按 [操作与验收清单](V4.0操作与验收清单.md) 实施。

提交材料应引用此版本的结果与输入，不再沿用V3.5文件。最终源码改变后应重新运行本脚本，再冻结图表与演示视频。
`;
}
function run(){
  const cases=[];for(const item of X.scenarioCatalog){const exercise=X.create();exercise.action('scenario',{id:item.id});cases.push(evaluate(item.id,item.name,exercise.data));}
  const scale=[20,60].map(count=>evaluate('scale-'+count,count+' 组规模演练',scaleData(count)));
  const workflows={intake:intakeJourney(),multiTrip:[multiTripJourney(20),multiTripJourney(6)]};
  const result={version:RELEASE+'-evaluation',productVersion:RELEASE,generatedAt:new Date().toISOString(),reproduce:'node scripts/evaluate-scenarios.cjs',sourceHashes:sourceFingerprint(),method:'每个场景从同一输入快照分别运行优化算法与风险优先最近可行基线，各重复 3 次。方案均调用约束校验；多趟流程逐步模拟人工操作并检查人数与接收占用守恒。没有调用大模型，不是 AI 理解能力、真实人工效率或真实防汛效益评测。',environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model||'unavailable'},limits:['业务人员、容量、道路速度均为演练设定；真实路网场景只代表道路几何快照，不代表实时通行。','基线为明示规则的模拟策略，不代表人工调度实测。','等待指标只计已安排人员，必须与覆盖人数、未安排人员并列阅读。','规模超过 8 组采用有界启发式，不保证全局最优；每次草案安排当前一趟，送达后可人工准备下一趟，但没有全局多趟最优化。','接收点容量不会因车辆空车返回而释放；接收容量不足仍保留未安排人员。','耗时受机器、浏览器、后台负载影响；这里是 Node 环境的本次测量。'],cases,scale,workflows,passedConstraintChecks:[...cases,...scale,workflows.intake.uploaded,workflows.intake.reviewed].every(row=>!row.optimized.validationErrors.length&&!row.baseline.validationErrors.length)&&workflows.intake.passed&&workflows.multiTrip.every(row=>row.passed),unresolvedCases:cases.filter(row=>!row.optimized.complete).map(row=>({id:row.id,name:row.name,unassignedPeople:row.optimized.unassignedPeople}))};
  const target=path.resolve(__dirname,'../dist/assets/evaluation.json');fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n','utf8');fs.writeFileSync(path.resolve(__dirname,'../docs/V4.0可复现评估.md'),markdown(result),'utf8');return result;
}
if(require.main===module){const result=run();console.log(JSON.stringify({version:result.version,cases:result.cases.map(row=>({id:row.id,baseline:row.baseline.servedPeople,optimized:row.optimized.servedPeople,unassigned:row.optimized.unassignedPeople,ms:row.optimized.timing.medianMs})),scale:result.scale.map(row=>({groups:row.groups,ms:row.optimized.timing.medianMs})),intake:{uploaded:result.workflows.intake.uploaded.people,pending:result.workflows.intake.pending,reviewed:result.workflows.intake.reviewed.people,unassigned:result.workflows.intake.reviewed.optimized.unassignedPeople},multiTrip:result.workflows.multiTrip.map(row=>({id:row.id,...row.final})),passedConstraintChecks:result.passedConstraintChecks}));}
module.exports={run,evaluate,scaleData,intakeJourney,multiTripJourney};
