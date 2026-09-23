'use strict';
// Reproducible fixture benchmark. Run with Node; no network or model required.
const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const crypto=require('node:crypto');
const {performance}=require('node:perf_hooks');
const X=require('../exercise.cjs');
const repetitions=3;
const sum=(rows,fn)=>rows.reduce((n,x)=>n+fn(x),0);
const round=n=>Math.round(n*100)/100;
function timed(fn){const times=[];let value;for(let n=0;n<repetitions;n++){const start=performance.now();value=fn();times.push(performance.now()-start);}times.sort((a,b)=>a-b);return {value,timing:{minMs:round(times[0]),medianMs:round(times[Math.floor(times.length/2)]),maxMs:round(times.at(-1)),repetitions}};}
function metrics(i,p){return {algorithm:p.algorithm,servedPeople:p.servedPeople,totalPeople:p.totalPeople,unassignedPeople:sum(p.unassigned,h=>h.people),urgentPeople:p.urgentPeople,assistedPeople:p.assistedPeople,weightedWait:p.wait,finishMinute:p.finish,driveMinutes:p.drive,complete:p.complete,unassigned:p.unassigned.map(h=>({id:h.id,name:h.name,people:h.people,reason:h.reason})),validationErrors:X.validate(i,p)};}
function evaluate(id,name,data){
  const input=X.snapshot(data),optimized=timed(()=>X.solve(input)),baseline=timed(()=>X.baseline(input));
  const context={...data,plan:optimized.value.plan,alternative:optimized.value.alternative,baseline:baseline.value,planSnapshot:input};
  const diagnostics=X.diagnostics(context);
  return {id,name,inputHash:crypto.createHash('sha256').update(JSON.stringify(input)).digest('hex'),groups:input.scenario.households.length,people:optimized.value.plan.totalPeople,sourceMode:input.scenario.region.mapKind,optimized:{...metrics(input,optimized.value.plan),timing:optimized.timing},baseline:{...metrics(input,baseline.value),timing:baseline.timing},comparison:diagnostics.comparison,explanations:diagnostics.unassigned,interpretation:optimized.value.plan.complete?'本情景全部可安排；仅反映所列演练输入。':'本情景仍有未安排人员；保留缺口，不把部分方案宣称为全部解决。'};
}
function scaleData(count){
  const data=X.initial();data.stage={};data.contacts={};
  data.scenario.households=Array.from({length:count},(_,n)=>{const assisted=n%7===0,wheelchair=n%17===0,id='LOAD'+(n+1),risk=n%5===0?3:1;data.stage[id]='waiting';data.contacts[id]={ack:false,contacted:false};return {id,node:'H'+(n%6+1),name:'规模演练组 '+(n+1),people:1,priority:risk,risk,riskBase:risk,assistance:assisted||wheelchair,wheelchair,assistancePeople:Number(assisted||wheelchair),wheelchairPeople:Number(wheelchair),service:wheelchair?6:assisted?5:2,note:'固定规则生成的规模样例，不是真实居民数据',response:'待联系'};});
  return data;
}
function run(){
  const cases=[];for(const item of X.scenarioCatalog){const exercise=X.create();exercise.action('scenario',{id:item.id});cases.push(evaluate(item.id,item.name,exercise.data));}
  const scale=[20,60].map(count=>evaluate('scale-'+count,count+' 组规模演练',scaleData(count)));
  const result={version:'3.5-evaluation',generatedAt:new Date().toISOString(),reproduce:'node scripts/evaluate-scenarios.cjs',method:'每个场景从同一输入快照分别运行优化算法与风险优先最近可行基线，各重复 3 次。所有结果调用约束校验；模型与 Agent 未接入，结果不是 AI 理解能力或真实防汛效益评测。',environment:{node:process.version,platform:process.platform,arch:process.arch,cpu:os.cpus()[0]?.model||'unavailable'},limits:['业务人员、容量、道路速度均为演练设定；真实路网场景只代表道路几何快照，不代表实时通行。','基线为明示规则的模拟策略，不代表人工调度实测。','等待指标只计已安排人员，必须与覆盖人数、未安排人员并列阅读。','规模超过 8 组采用有界启发式，不保证全局最优；单次调度每车一趟，未安排人员需增援或另行组织。','耗时受机器、浏览器、后台负载影响；这里是 Node 环境的本次测量。'],cases,scale,passedConstraintChecks:[...cases,...scale].every(row=>!row.optimized.validationErrors.length&&!row.baseline.validationErrors.length),unresolvedCases:cases.filter(row=>!row.optimized.complete).map(row=>({id:row.id,name:row.name,unassignedPeople:row.optimized.unassignedPeople}))};
  const target=path.resolve(__dirname,'../dist/assets/evaluation.json');fs.writeFileSync(target,JSON.stringify(result,null,2)+'\n','utf8');return result;
}
if(require.main===module){const result=run();console.log(JSON.stringify({cases:result.cases.map(row=>({id:row.id,baseline:row.baseline.servedPeople,optimized:row.optimized.servedPeople,unassigned:row.optimized.unassignedPeople,ms:row.optimized.timing.medianMs})),scale:result.scale.map(row=>({groups:row.groups,ms:row.optimized.timing.medianMs})),passedConstraintChecks:result.passedConstraintChecks}));}
module.exports={run,evaluate,scaleData};
