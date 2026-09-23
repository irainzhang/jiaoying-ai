'use strict';
// Server-owned synthetic exercise. No weather/model/notification service is called.
const E=require('./dist/engine.js');
const V=require('./village-ledger.cjs');
const R=require('./resilience.cjs');
const clone=E.clone;
const ALGORITHM='ruian-candidate-search-3.0';
const BASELINE='risk-nearest-feasible-3.0';
const sum=(xs,f)=>xs.reduce((n,x)=>n+f(x),0);
const cmp=(a,b)=>{for(let i=0;i<a.length;i++)if(a[i]!==b[i])return a[i]<b[i]?-1:1;return 0;};
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const integer=(value,min,max,label)=>{assert(Number.isInteger(value)&&value>=min&&value<=max,`${label}须为 ${min}–${max} 的整数`);return value;};
const text=(value,max,label)=>{assert(typeof value==='string'&&value.trim()&&value.length<=max,`${label}不能为空且不能超过 ${max} 字`);return value.trim();};
const now=()=>new Date().toISOString();

function initial(){
  const scenario=E.createScenario();
  scenario.name='浙江省瑞安市 · 合成演练片区';
  scenario.region={name:'浙江省瑞安市',context:'飞云江沿岸情景背景',mapKind:'synthetic-topology',longitude:null,latitude:null,coordinateSystem:null};
  scenario.shelters[0].name='演练安置点 A';scenario.shelters[1].name='演练安置点 B';
  scenario.nodes.find(n=>n.id==='S1').label='安置点 A';scenario.nodes.find(n=>n.id==='S2').label='安置点 B';
  scenario.households.forEach(h=>{h.node=h.id;h.risk=h.priority;h.riskBase=h.risk;h.name='演练家庭 '+h.id.slice(1).padStart(2,'0');h.response='待联系';});
  scenario.nodes.filter(n=>n.kind==='home').forEach(n=>n.label=scenario.households.find(h=>h.id===n.id).name);
  const d={schema:'jiaoying-v3',exerciseId:'EX-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,8),createdAt:now(),scenarioPreset:'normal',followups:{},revision:1,inputVersion:1,executionVersion:1,algorithm:ALGORITHM,phase:'preparation',scenario,stage:{},contacts:{},fleet:{},occupancy:{S1:0,S2:0},reports:[],fieldEvents:[],taskAcks:{},history:[],log:[],plan:null,baseline:null,alternative:null,activePlan:null,planSnapshot:null,planCounter:0,weather:{sourceMode:'simulation',level:1,rainfall:20,unit:'mm',window:'演练最近1小时累计',updatedAt:now(),trigger:'初始演练条件'},lastAnnouncement:'瑞安合成演练已就绪。6 户 15 人，3 辆车，2 个安置点。'};
  for(const h of scenario.households){d.stage[h.id]='waiting';d.contacts[h.id]={ack:false,contacted:false};}
  for(const v of scenario.vehicles)d.fleet[v.id]={node:v.start,minute:0,onboard:[],delivered:[],finished:false};
  d.log.push({id:1,time:now(),type:'init',message:d.lastAnnouncement});return V.ensure(d);
}
function snapshot(d){return clone({scenario:d.scenario,stage:d.stage,fleet:d.fleet,occupancy:d.occupancy,inputVersion:d.inputVersion,executionVersion:d.executionVersion,unplannedRequests:V.unplannedRequests(d)});}
function routeBuilder(i){
  const cache=new Map(),s=i.scenario,homes=Object.fromEntries(s.households.map(h=>[h.id,h]));
  const path=(a,b)=>{const k=a+':'+b;if(!cache.has(k))cache.set(k,E.shortestPath(s,a,b));return cache.get(k);};
  function route(v,order,sh){
    const f=i.fleet[v.id],ids=[...f.onboard,...order.map(h=>h.id)],people=sum(ids,id=>homes[id].people);
    if(!v.available||f.finished||!sh?.available||!ids.length||people>v.capacity||people+(i.occupancy[sh.id]||0)>sh.capacity||sum(ids,id=>homes[id].wheelchairPeople??Number(homes[id].wheelchair))>Number(v.wheelchair))return null;
    let node=f.node,minute=f.minute,wait=0,drive=0;const stops=[],segments=[];
    for(const h of order){const p=path(node,h.node);if(!p)return null;minute+=p.minutes;drive+=p.minutes;wait+=Math.max(0,minute-f.minute)*h.people*(h.risk===3?3:h.assistance?2:1);stops.push({id:h.id,node:h.node,people:h.people,arrival:minute,depart:minute+h.service});segments.push({from:node,to:h.node,...p});minute+=h.service;node=h.node;}
    const tail=path(node,sh.id);if(!tail)return null;segments.push({from:node,to:sh.id,...tail});minute+=tail.minutes;drive+=tail.minutes;
    return {vehicleId:v.id,from:f.node,startMinute:f.minute,onboard:[...f.onboard],stops,segments,shelterId:sh.id,people,passengerIds:ids,finish:minute,wait,drive,holding:false};
  }
  const idle=v=>({vehicleId:v.id,from:i.fleet[v.id].node,startMinute:i.fleet[v.id].minute,onboard:[...i.fleet[v.id].onboard],stops:[],segments:[],shelterId:null,people:0,passengerIds:[],finish:i.fleet[v.id].minute,wait:0,drive:0,holding:i.fleet[v.id].onboard.length>0});
  return {route,path,idle};
}
function summarize(i,routes,algorithm){
  const pendingInfo=i.unplannedRequests||[];
  const remaining=i.scenario.households.filter(h=>['waiting','boarded'].includes(i.stage[h.id]));
  const ids=routes.flatMap(r=>r.passengerIds),covered=new Set(ids),selected=remaining.filter(h=>covered.has(h.id));
  const onboardCount=sum(routes,r=>r.holding?0:sum(r.onboard,id=>i.scenario.households.find(h=>h.id===id).people));
  return {algorithm,routes:clone(routes),servedPeople:sum(selected,h=>h.people),totalPeople:sum(remaining,h=>h.people)+sum(pendingInfo,h=>h.people),servedIds:[...covered].sort(),urgentPeople:sum(selected.filter(h=>h.risk===3),h=>h.people),assistedPeople:sum(selected,h=>h.assistancePeople??(h.assistance?h.people:0)),onboardCount,wait:sum(routes,r=>r.wait),finish:Math.max(0,...routes.filter(r=>r.people).map(r=>r.finish)),drive:sum(routes,r=>r.drive),unassigned:remaining.filter(h=>!covered.has(h.id)).map(h=>({id:h.id,name:h.name,people:h.people,stage:i.stage[h.id],reason:i.stage[h.id]==='boarded'?'已上车人员留在原车，当前无可用送达安排，待人工协调':'当前车辆适配、座位、安置容量或开放路网不能同时满足'})).concat(clone(pendingInfo)),complete:selected.length===remaining.length&&!pendingInfo.length,inputVersion:i.inputVersion,executionVersion:i.executionVersion};
}
const score=p=>[-p.onboardCount,-p.urgentPeople,-p.assistedPeople,-p.servedPeople,p.wait,p.finish,p.drive];
function signature(p){return p.routes.map(r=>r.vehicleId+':'+r.stops.map(h=>h.id).join(',')+'>'+r.shelterId).join('|');}
function solve(i){
  const started=Date.now(),s=i.scenario,waiting=s.households.filter(h=>i.stage[h.id]==='waiting'),b=routeBuilder(i);
  if(waiting.length>8)return require('./dispatch-large.cjs').solve(i,{routeBuilder,summarize,validate,baseline});
  const options=s.vehicles.map(v=>{
    const best=new Map(),f=i.fleet[v.id],manifest=s.households.filter(h=>f.onboard.includes(h.id));
    if(!v.available||f.finished)return [b.idle(v)];
    function walk(order,mask,people,chairs){
      if(order.length||manifest.length)for(const sh of s.shelters){const r=b.route(v,order,sh);if(!r)continue;r.mask=mask;const key=mask+':'+sh.id,old=best.get(key);if(!old||cmp([r.wait,r.finish,r.drive],[old.wait,old.finish,old.drive])<0)best.set(key,r);}
      for(let j=0;j<waiting.length;j++){if(mask&(1<<j))continue;const h=waiting[j];if(people+h.people>v.capacity||chairs+(h.wheelchairPeople??Number(h.wheelchair))>Number(v.wheelchair))continue;if(!b.path(order.at(-1)?.node||f.node,h.node))continue;walk([...order,h],mask|(1<<j),people+h.people,chairs+(h.wheelchairPeople??Number(h.wheelchair)));}
    }
    walk([],0,sum(manifest,h=>h.people),sum(manifest,h=>h.wheelchairPeople??Number(h.wheelchair)));
    return [{...b.idle(v),mask:0},...best.values()];
  });
  let top=[],combinations=0;
  function combine(vi,mask,loads,routes){
    if(vi===options.length){combinations++;const p=summarize(i,routes,ALGORITHM);if(top.some(x=>signature(x)===signature(p)))return;top.push(p);top.sort((a,b)=>cmp(score(a),score(b))||signature(a).localeCompare(signature(b)));top=top.slice(0,2);return;}
    for(const r of options[vi]){if((r.mask||0)&mask)continue;const sh=s.shelters.find(x=>x.id===r.shelterId);if(sh&&(loads[sh.id]||0)+r.people+(i.occupancy[sh.id]||0)>sh.capacity)continue;if(sh)loads[sh.id]=(loads[sh.id]||0)+r.people;routes.push(r);combine(vi+1,mask|(r.mask||0),loads,routes);routes.pop();if(sh)loads[sh.id]-=r.people;}
  }
  combine(0,0,{},[]);
  for(const p of top){p.combinations=combinations;p.elapsedMs=Date.now()-started;const errors=validate(i,p);assert(!errors.length,'求解校验失败：'+errors.join('；'));}
  return {plan:top[0],alternative:top[1]||null};
}
function baseline(i){
  const s=i.scenario,b=routeBuilder(i),routes=s.vehicles.map(b.idle),loads={};
  // Locked on-board passengers get a destination first; never swap them between cars.
  s.vehicles.forEach((v,vi)=>{if(!i.fleet[v.id].onboard.length)return;const choices=s.shelters.map(sh=>b.route(v,[],sh)).filter(r=>r&&(loads[r.shelterId]||0)+r.people+(i.occupancy[r.shelterId]||0)<=s.shelters.find(sh=>sh.id===r.shelterId).capacity).sort((a,c)=>a.finish-c.finish||a.shelterId.localeCompare(c.shelterId));if(choices.length){routes[vi]=choices[0];loads[choices[0].shelterId]=(loads[choices[0].shelterId]||0)+choices[0].people;}});
  const waiting=s.households.filter(h=>i.stage[h.id]==='waiting').sort((a,c)=>c.risk-a.risk||Number(c.assistance)-Number(a.assistance)||a.id.localeCompare(c.id));
  for(const h of waiting){let best=null;for(let vi=0;vi<s.vehicles.length;vi++){const old=routes[vi],v=s.vehicles[vi],order=old.stops.map(st=>s.households.find(x=>x.id===st.id));for(const sh of s.shelters){if(old.shelterId&&old.shelterId!==sh.id)continue;const r=b.route(v,[...order,h],sh);if(!r)continue;if((loads[sh.id]||0)-(old.shelterId===sh.id?old.people:0)+r.people+(i.occupancy[sh.id]||0)>sh.capacity)continue;const key=[b.path(h.node,sh.id).minutes,r.stops.at(-1).arrival,r.finish,vi,s.shelters.indexOf(sh)];if(!best||cmp(key,best.key)<0)best={vi,r,key};}}if(best){const old=routes[best.vi];if(old.shelterId)loads[old.shelterId]-=old.people;routes[best.vi]=best.r;loads[best.r.shelterId]=(loads[best.r.shelterId]||0)+best.r.people;}}
  const p=summarize(i,routes,BASELINE);const errors=validate(i,p);assert(!errors.length,'基线校验失败：'+errors.join('；'));return p;
}
function validate(i,p){
  const errors=[],seen=new Set(),loads={},vehicles=new Set(),s=i.scenario;
  function bad(condition,msg){if(!condition)errors.push(msg);}
  for(const r of p.routes){const v=s.vehicles.find(v=>v.id===r.vehicleId),f=i.fleet[r.vehicleId];if(!v||!f){errors.push('车辆不存在');continue;}bad(!vehicles.has(v.id),'车辆重复');vehicles.add(v.id);bad(r.from===f.node&&r.startMinute===f.minute,'车辆起点或时间不一致');bad(JSON.stringify([...r.onboard].sort())===JSON.stringify([...f.onboard].sort()),'已上车人员必须留原车');if(!r.people){bad(!r.stops.length&&!r.passengerIds.length&&!r.shelterId&&!r.segments.length,'空闲或暂停路线不能携带隐含任务');bad(r.holding===Boolean(f.onboard.length),'车上人员未明确待协调');continue;}
    bad(v.available&&!f.finished,'车辆不可用');const sh=s.shelters.find(x=>x.id===r.shelterId);bad(sh?.available,'安置点不可用');let node=f.node,minute=f.minute;const ids=[...f.onboard];
    for(let k=0;k<r.stops.length;k++){const st=r.stops[k],h=s.households.find(x=>x.id===st.id);if(!h){errors.push('接人对象不存在');continue;}bad(i.stage[h.id]==='waiting','重复接已上车或已完成人员');ids.push(h.id);const seg=r.segments[k];bad(seg?.from===node&&seg?.to===h.node,'接人路段次序不符');minute+=seg?.minutes||0;bad(st.arrival===minute&&st.people===h.people,'到户时间或人数不符');minute+=h.service;bad(st.depart===minute,'接人用时不符');node=h.node;}
    const tail=r.segments.at(-1);bad(r.segments.length===r.stops.length+1&&tail?.from===node&&tail?.to===r.shelterId,'送达尾程缺失');minute+=tail?.minutes||0;bad(minute===r.finish,'送达时间不符');
    for(const seg of r.segments){bad(seg.nodes?.[0]===seg.from&&seg.nodes?.at(-1)===seg.to&&seg.edges?.length===seg.nodes.length-1,'路径结构无效');let minutes=0;for(let k=0;k<(seg.edges||[]).length;k++){const edge=s.edges.find(e=>e.id===seg.edges[k]);bad(edge?.open,'包含封闭道路');if(edge){bad((edge.from===seg.nodes[k]&&edge.to===seg.nodes[k+1])||(!edge.directed&&edge.to===seg.nodes[k]&&edge.from===seg.nodes[k+1]),'路径不连续');minutes+=edge.minutes;}}bad(minutes===seg.minutes,'路段时间无效');}
    bad(JSON.stringify(ids)===JSON.stringify(r.passengerIds),'乘员清单不符');let people=0,chairs=0;for(const id of ids){const h=s.households.find(x=>x.id===id);bad(Boolean(h),'人员不存在');if(!h)continue;bad(!seen.has(id),'人员重复分配');seen.add(id);people+=h.people;chairs+=h.wheelchairPeople??Number(h.wheelchair);}
    bad(people===r.people&&people<=v.capacity,'座位人数不符或超载');bad(chairs<=Number(v.wheelchair),'轮椅位超限');loads[r.shelterId]=(loads[r.shelterId]||0)+people;
  }
  for(const sh of s.shelters)bad((loads[sh.id]||0)+(i.occupancy[sh.id]||0)<=sh.capacity,'安置容量超限');
  for(const h of s.households.filter(h=>['waiting','boarded'].includes(i.stage[h.id])))bad(Number(seen.has(h.id))+p.unassigned.filter(x=>x.id===h.id).length===1,'人员遗漏或重复列为待协调');
  for(const held of i.unplannedRequests||[]){const rows=p.unassigned.filter(x=>x.id===held.id);bad(rows.length===1&&rows[0]?.people===held.people,'待补信息批次遗漏或人数不符');}
  bad(p.servedPeople+sum(p.unassigned,h=>h.people)===p.totalPeople,'待转移总人数不守恒');
  bad(sum([...seen],id=>s.households.find(h=>h.id===id).people)===p.servedPeople,'服务人数不一致');bad(vehicles.size===s.vehicles.length,'缺少车辆状态');return [...new Set(errors)];
}
function metrics(d){const hs=d.scenario.households.filter(h=>d.stage[h.id]!=='superseded'),held=sum(V.unplannedRequests(d),h=>h.people);return {people:sum(hs,h=>h.people)+held,waiting:sum(hs.filter(h=>d.stage[h.id]==='waiting'),h=>h.people)+held,unplannedPeople:held,pendingVillagePeople:sum(V.villageMetrics(d),v=>v.pendingPeople),boarded:sum(hs.filter(h=>d.stage[h.id]==='boarded'),h=>h.people),arrived:sum(hs.filter(h=>d.stage[h.id]==='arrived'),h=>h.people),verified:sum(hs.filter(h=>d.stage[h.id]==='verified'),h=>h.people),highRisk:sum(hs.filter(h=>h.risk===3),h=>h.people),capacity:sum(d.scenario.shelters.filter(s=>s.available),s=>Math.max(0,s.capacity-(d.occupancy[s.id]||0))),pendingReports:d.reports.filter(r=>r.status==='pending').length+(d.villageReports||[]).filter(r=>r.status==='pending').length};}
function blockedRoute(d,r){
  if(!r||r.holding)return true;
  const f=d.fleet[r.vehicleId],v=d.scenario.vehicles.find(v=>v.id===r.vehicleId);
  if(!f||!v)return true;if(f.finished)return false;
  if(r.people&&(!v.available||!d.scenario.shelters.find(sh=>sh.id===r.shelterId)?.available))return true;
  const sh=d.scenario.shelters.find(sh=>sh.id===r.shelterId);
  if(r.people&&d.activePlan&&(v.resourceChangeVersion>d.activePlan.inputVersion||sh?.resourceChangeVersion>d.activePlan.inputVersion))return true;
  if(r.passengerIds.some(id=>d.stage[id]==='superseded'))return true;
  const pending=r.stops.filter(st=>d.stage[st.id]==='waiting');const first=pending.length?r.stops.indexOf(pending[0]):r.stops.length;
  return r.segments.slice(first).some(seg=>seg.edges.some(id=>!d.scenario.edges.find(e=>e.id===id)?.open));
}
function restore(initialData,{external=false}={}){
  R.validateState(initialData);const d=clone(initialData);
  if(d.fieldEvents===undefined)d.fieldEvents=[];
  if(d.taskAcks===undefined)d.taskAcks={};
  if(d.followups===undefined)d.followups={};
  if(d.createdAt===undefined)d.createdAt=d.log.find(x=>x.type==='init')?.time||d.log.at(-1)?.time||'2026-09-23T00:00:00.000Z';
  if(d.exerciseId===undefined)d.exerciseId='EX-legacy-'+String(d.createdAt).replace(/[^0-9]/g,'').slice(0,17);
  V.ensure(d);V.checkLimits(d,0);
  if(external&&d.plan){
    assert(d.planSnapshot&&d.plan.inputVersion===d.inputVersion&&d.plan.executionVersion===d.executionVersion,'恢复草案输入版本不符');
    assert(JSON.stringify(d.planSnapshot.scenario)===JSON.stringify(d.scenario)&&JSON.stringify(d.planSnapshot.stage)===JSON.stringify(d.stage)&&JSON.stringify(d.planSnapshot.fleet)===JSON.stringify(d.fleet)&&JSON.stringify(d.planSnapshot.occupancy)===JSON.stringify(d.occupancy),'恢复草案与输入快照不符');
    for(const p of [d.plan,d.baseline,d.alternative].filter(Boolean))assert(!validate(snapshot(d),p).length,'恢复草案约束校验失败');
  }
  return d;
}
function diagnostics(d){return R.diagnostics(d,{E,snapshot,validate,blockedRoute});}
function create(initialData=null){
  let d=initialData===null?initial():restore(initialData);
  function log(message,type='action'){d.log.unshift({id:(d.log[0]?.id||0)+1,time:now(),type,message});d.log=d.log.slice(0,150);}
  function fieldEvent(event){const base='F'+(d.revision+1);let id=base,n=1;while(d.fieldEvents.some(e=>e.id===id))id=base+'-'+(++n);const record={id,time:now(),...event};d.fieldEvents.unshift(record);d.fieldEvents=d.fieldEvents.slice(0,100);return record;}
  function inputSource(value,fallback){const source=value===undefined?fallback:value;assert(['quick','voice','text','manual'].includes(source),'现场输入来源无效');return source;}
  function invalidate(reason){d.inputVersion++;d.plan=null;d.baseline=null;d.alternative=null;d.planSnapshot=null;log(reason,'input');}
  function generate(reason='人工重新计算'){
    const i=snapshot(d),result=solve(i);d.plan=result.plan;d.alternative=result.alternative;d.baseline=baseline(i);d.planSnapshot=i;d.planCounter++;for(const p of [d.plan,d.alternative,d.baseline].filter(Boolean))p.id='P'+d.planCounter+'-'+(p===d.baseline?'B':p===d.alternative?'ALT':'A');
    d.plan.createdAt=now();d.plan.trigger=reason;d.plan.steps=['读取输入 v'+d.inputVersion+' / 执行记录 '+d.executionVersion,'按开放路网和车辆登记位置搜索路线','校验座位、轮椅位、安置容量和人员守恒','草案已生成，等待人工确认'];
    d.lastAnnouncement=reason+'。新草案可安排 '+d.plan.servedPeople+' 人，'+sum(d.plan.unassigned,h=>h.people)+' 人待协调。尚未替换执行方案。';log(d.lastAnnouncement,'plan');
  }
  function fresh(){return !!d.plan&&d.plan.inputVersion===d.inputVersion&&d.plan.executionVersion===d.executionVersion;}
  function advanceVehicle(vehicleId,expectedStage=null,householdId=null){
    assert(d.phase==='executing','请先开始模拟执行');const r=d.activePlan?.routes.find(r=>r.vehicleId===vehicleId),f=d.fleet[vehicleId];assert(r&&f&&!f.finished&&r.people,'该车辆没有可推进任务');assert(!r.passengerIds.some(id=>d.stage[id]==='superseded'),'本路线的人员批次已更正，请重新计算并确认方案后继续');assert(!blockedRoute(d,r),'车辆、安置点或剩余道路已不可用，暂停推进；请先协调资源、重规划并确认');
    const st=r.stops.find(st=>d.stage[st.id]==='waiting');
    if(expectedStage==='board')assert(st&&st.id===householdId,'上车登记必须对应本车下一待接家庭，不可跳站或重复登记');
    if(expectedStage==='arrive')assert(!st,'仍有待接家庭，不能提前登记到达');
    let result;
    if(st){assert(d.contacts[st.id]?.contacted,'该家庭尚未联系，不能登记上车');const h=d.scenario.households.find(h=>h.id===st.id);assert(st.people===h.people,'人员输入已变化，请重规划');f.node=h.node;f.minute=st.depart;f.onboard.push(h.id);d.stage[h.id]='boarded';log(vehicleId+' 在 '+h.name+' 登记接人 '+h.people+' 人。','execution');result={stage:'board',householdId:h.id,people:h.people};}
    else {const sh=d.scenario.shelters.find(sh=>sh.id===r.shelterId);assert(sh?.available,'安置点不可用');const people=sum(f.onboard,id=>d.scenario.households.find(h=>h.id===id).people);assert((d.occupancy[sh.id]||0)+people<=sh.capacity,'安置容量不足');d.occupancy[sh.id]+=people;for(const id of f.onboard){d.stage[id]='arrived';f.delivered.push(id);}f.node=sh.id;f.minute=r.finish;f.onboard=[];f.finished=true;log(vehicleId+' 上报到达 '+sh.name+'，'+people+' 人等待人工核验。','execution');result={stage:'arrive',householdId:null,people};}
    d.executionVersion++;d.plan=null;d.baseline=null;d.alternative=null;d.planSnapshot=null;d.lastAnnouncement=d.log[0].message;
    return {...result,summary:d.lastAnnouncement};
  }
  function action(name,p={}){
    const before=clone(d);
    try{
      if(name==='reset'){const revision=d.revision;d=initial();d.revision=revision;log('人工重置演练，两个网页同步恢复初始数据。');}
      else if(name==='scenario'){
        assert(R.catalog.some(x=>x.id===p.id),'示范情景不存在');const revision=d.revision;d=initial();d.revision=revision;d.scenarioPreset=p.id;
        if(p.id==='ruian-roads')require('./geo-scenario.cjs').apply(d);
        if(p.id==='road-closure'){d.scenario.edges.find(e=>e.id==='east').open=false;d.reports.unshift({id:'R1',kind:'road',location:'east',text:'标准情景：东桥经演练核实中断',people:0,status:'accepted',reporter:'情景演示',inputSource:'manual',createdAt:now(),reviewedAt:now(),note:'标准情景条件，不代表实时路况'});}
        if(p.id==='resource-shortage'){d.scenario.vehicles[0].available=false;d.scenario.vehicles[0].unavailableReason='标准情景：车辆故障，等待维修或增援';}
        if(p.id==='shelter-loss'){d.scenario.shelters[0].available=false;d.scenario.shelters[0].unavailableReason='标准情景：安置点暂停接收，需协调其他容量';}
        if(p.id==='village-growth'){
          const ctx={now,log,invalidate,generate,fieldEvent};
          V.handle(d,'village-report',{villageId:'VA',mode:'increment',people:12,pickupId:'P-A1',assistancePeople:3,wheelchairPeople:1,groupPolicy:'splittable',text:'演示村 A 新增 12 人，其中 3 人需要协助，包含 1 名轮椅人员；允许分组接送。',reporter:'情景演示',source:'manual'},ctx);
          V.handle(d,'village-review',{id:d.villageReports[0].id,decision:'accept',note:'标准演练情景已核对人数、集合点和分组要求'},ctx);
        }else generate('加载示范情景：'+R.catalog.find(x=>x.id===p.id).name);
        log('已创建新的独立演练 '+d.exerciseId+'；原演练只在先前导出文件中保留。','scenario');
      }
      else if(name==='restore'){
        const imported=p.data?.schema?p.data:p.data?.data;assert(imported,'请选择完整的演练 JSON 导出文件');
        const restored=restore(imported,{external:true}),revision=d.revision;
        assert(restored.phase==='executing'||Object.values(restored.stage).every(st=>!['boarded','arrived','verified'].includes(st)),'准备阶段不能包含已上车或到达执行记录');
        // External imports never authorize an imported route for execution.
        // Boarding/delivery ledgers stay intact and the new candidate is computed locally.
        d=restored;d.revision=revision;d.plan=null;d.baseline=null;d.alternative=null;d.activePlan=null;d.planSnapshot=null;d.history=[];d.taskAcks={};d.inputVersion++;d.executionVersion++;
        d.importedAt=now();d.importedRevision=imported.revision;generate('导入校验通过；已撤销导入文件中的发布状态，保留车载与到达记录');
        log('文件恢复完成：保留人员执行台账，所有剩余安排须重新人工确认。','restore');
      }
      else if(name==='resource-event'){
        assert(['vehicle','shelter'].includes(p.kind),'资源事件类型无效');assert(typeof p.available==='boolean','请明确资源是否可用');
        const item=d.scenario[p.kind==='vehicle'?'vehicles':'shelters'].find(x=>x.id===p.id);assert(item,'资源不存在');const reason=text(p.reason,300,'核实依据');
        assert(item.available!==p.available,'资源状态没有变化，无需重复提交');item.available=p.available;item.unavailableReason=p.available?'':reason;item.availabilityUpdatedAt=now();
        invalidate(item.name+(p.available?'已核实恢复可用':'已核实不可用')+'：'+reason);item.resourceChangeVersion=d.inputVersion;generate('资源状态变化：'+item.name);
        const key=p.kind+':'+item.id;d.followups=d.followups||{};if(!p.available)d.followups[key]={key,owner:'待指派',note:reason,dueAt:null,status:'open',updatedAt:now()};
      }
      else if(name==='followup'){
        const key=text(p.key,80,'跟进对象');assert(/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(key)&&!['__proto__','constructor','prototype'].includes(key),'跟进对象编号无效');
        d.followups=d.followups||{};assert(diagnostics(d).coordination.some(x=>x.key===key)||d.followups[key],'当前没有此待办对象');
        assert(['open','working','resolved'].includes(p.status),'跟进状态无效');const owner=text(p.owner,40,'责任人'),note=text(p.note,500,'处理说明');
        const dueAt=p.dueAt===null||p.dueAt===''||p.dueAt===undefined?null:p.dueAt;assert(dueAt===null||typeof dueAt==='string'&&Number.isFinite(Date.parse(dueAt)),'请填写有效的跟进时间');
        assert(d.followups[key]||Object.keys(d.followups).length<500,'跟进事项达到演示上限');d.followups[key]={key,owner,note,dueAt:dueAt?new Date(dueAt).toISOString():null,status:p.status,updatedAt:now()};
        log(owner+' 更新 '+key+' 跟进：'+note+'；未自动改变道路、转移或安全核验状态。','followup');d.lastAnnouncement=d.log[0].message;
      }
      else if(name==='command-intake'){
        assert(Array.isArray(p.rows)&&p.rows.length>0&&p.rows.length<=100,'请上传或整理 1–100 行人员任务');
        assert(['file','voice','text'].includes(p.source),'指挥录入来源无效');
        assert(p.duplicateAcknowledged===undefined||typeof p.duplicateAcknowledged==='boolean','重复批次确认必须明确勾选');
        const reporter=text(p.reporter===undefined?'指挥值守':p.reporter,40,'录入人');
        const note=p.note===undefined?'指挥端已核对名单与人数':text(p.note,220,'核对说明');
        const source=p.source==='file'?'manual':p.source,intakeId='CI'+(d.revision+1),batchIds=[];
        const origin={origin:'command',intakeSource:p.source,commandIntakeId:intakeId};
        V.ensure(d);
        // The enclosing action transaction rolls back every row on any failure.
        // Defer recalculation until the entire reviewed intake has materialized.
        const context={now,log,invalidate:()=>{},generate:()=>{},fieldEvent:event=>{
          if(event.stage==='village-review')fieldEvent({...event,...origin,stage:'command-intake'});
        }};
        for(let index=0;index<p.rows.length;index++){
          const row=p.rows[index];
          try{
            assert(row&&typeof row==='object'&&!Array.isArray(row),'人员任务行无效');
            assert(row.mode===undefined||row.mode==='increment','快捷建任务仅新增人员；总量与更正请使用村级核对');
            const fields=Object.fromEntries(['villageId','pickupId','people','assistancePeople','wheelchairPeople','groupPolicy','text','reporter'].filter(key=>row[key]!==undefined).map(key=>[key,row[key]]));
            V.handle(d,'village-report',{...fields,mode:'increment',source,reporter:row.reporter===undefined?reporter:row.reporter,duplicateAcknowledged:p.duplicateAcknowledged===true},context);
            const record=d.villageReports[0];Object.assign(record,origin);
            V.handle(d,'village-review',{id:record.id,decision:'accept',note:'指挥端批量核对：'+note},context);
            batchIds.push(record.id);
          }catch(error){throw new Error('第 '+(index+1)+' 行：'+error.message);}
        }
        const people=sum(p.rows,row=>row.people),held=sum(d.villageReports.filter(row=>batchIds.includes(row.id)&&row.needsInfo),row=>row.people);
        invalidate('指挥端确认录入 '+p.rows.length+' 批、'+people+' 人；来源：'+{file:'名单上传',voice:'语音整理',text:'文字整理'}[p.source]);
        generate('指挥端批量建立转移任务');
        d.lastAnnouncement='已录入 '+p.rows.length+' 批、'+people+' 人'+(held?'，其中 '+held+' 人待补调度信息':'')+'；转移草案已计算，请核对后发布。';
        log(d.lastAnnouncement,'command-intake');
      }
      else if(V.handle(d,name,p,{now,log,invalidate,generate,fieldEvent})){}
      else if(name==='generate')generate();
      else if(name==='weather'){
        assert(['small','strong','extreme','normal'].includes(p.preset),'天气情景无效');const table={normal:[20,1],small:[25,1],strong:[60,2],extreme:[100,3]},[rain,level]=table[p.preset],old=d.weather.level;
        d.weather={...d.weather,rainfall:rain,level,updatedAt:now(),trigger:level===old?'同级小幅变化，维持当前方案':'演练等级变化，触发复核'};
        if(level!==old){invalidate('演练天气等级 '+old+' → '+level+'；仅触发评估，不推断道路积水或自动封路');generate('天气演练等级变化');}else{d.lastAnnouncement='演练一小时累计雨量更新为 '+rain+' 毫米，未跨演练等级，维持当前方案。';log(d.lastAnnouncement,'weather');}
      }
      else if(name==='report'){
        assert(['road','people','medical','hazard','progress','other'].includes(p.kind),'反馈类型无效');const location=text(p.location,40,'位置');assert(d.scenario.nodes.some(n=>n.id===location)||d.scenario.edges.some(e=>e.id===location),'请选择演练地图内的位置');if(p.kind==='road')assert(d.scenario.edges.some(e=>e.id===location),'道路反馈须选择具体道路');if(p.kind==='people')assert(d.scenario.nodes.some(n=>n.id===location),'新增人员须选择点位');
        const source=inputSource(p.source,'manual');const r={id:'R'+(d.reports.length+1),kind:p.kind,location,text:text(p.text,2000,'现场说明'),people:p.kind==='people'?integer(p.people,1,30,'新增人数'):0,wheelchair:p.wheelchair===true,assistance:p.assistance===true||p.wheelchair===true,reporter:text(p.reporter||'现场演示员',40,'上报人'),status:'pending',createdAt:now(),source:'现场网页人工提交',inputSource:source,note:'',inputVersion:d.inputVersion};d.reports.unshift(r);d.lastAnnouncement='收到现场反馈 '+r.id+'，'+{road:'道路受阻',people:'新增转移人员',medical:'医疗协助',hazard:'险情变化',progress:'任务进展',other:'其他情况'}[r.kind]+'，等待指挥端核实。';log(d.lastAnnouncement,'report');
        fieldEvent({kind:'report',stage:'report',reportId:r.id,reportKind:r.kind,location:r.location,vehicleId:null,householdId:null,people:r.people,planId:d.activePlan?.id||null,reporter:r.reporter,source,text:r.text,summary:d.lastAnnouncement});
      }
      else if(name==='review'){
        const r=d.reports.find(r=>r.id===p.id);assert(r&&r.status==='pending','反馈不存在或已经处理');assert(['accept','reject'].includes(p.decision),'核实操作无效');const note=text(p.note,300,'核实说明');r.reviewedAt=now();r.note=note;
        if(p.decision==='reject'){r.status='rejected';log(r.id+' 核实后未采纳：'+note,'review');}
        else if(r.kind==='road'){d.scenario.edges.find(e=>e.id===r.location).open=false;r.status='accepted';invalidate(r.id+' 核实道路受阻：'+note);generate(r.id+' 道路中断反馈');}
        else if(r.kind==='people'){
          V.checkLimits(d,r.people,1);let n=Math.max(0,...d.scenario.households.filter(h=>/^H[0-9]+$/.test(h.id)).map(h=>Number(h.id.slice(1))))+1;const id='H'+n;d.scenario.households.push({id,node:r.location,name:'新增家庭 '+id.slice(1).padStart(2,'0'),people:r.people,priority:r.assistance?2:1,risk:2,riskBase:2,assistance:r.assistance,wheelchair:r.wheelchair,service:r.wheelchair?6:r.assistance?5:2,note:'来源 '+r.id,response:'新增待联系'});d.stage[id]='waiting';d.contacts[id]={ack:false,contacted:false};V.ensure(d);r.householdId=id;r.status='accepted';invalidate(r.id+' 新增 '+r.people+' 人，原有车载人数不变');generate(r.id+' 新增转移人员');
        }else if(r.kind==='medical'||r.kind==='hazard'){r.status='coordination';d.lastAnnouncement=r.id+' 已核实，转人工协调。'+note;log(d.lastAnnouncement,'review');}
        else {r.status='resolved';d.lastAnnouncement=r.id+' 已登记反馈，未自动改变上车或安全核验状态。';log(d.lastAnnouncement,'review');}
      }
      else if(name==='resolve'){
        const r=d.reports.find(r=>r.id===p.id);assert(r&&['accepted','coordination'].includes(r.status),'没有可处理的协调事项');const note=text(p.note,300,'处理结果');
        if(r.kind==='road'){assert(p.reopen===true,'道路恢复需明确勾选本条障碍已排除');const others=d.reports.filter(x=>x.id!==r.id&&x.kind==='road'&&x.location===r.location&&x.status==='accepted');r.status='resolved';r.resolution=note;r.resolvedAt=now();if(others.length){d.lastAnnouncement=r.id+' 已处理；同路段还有未解决反馈，道路保持封闭。';log(d.lastAnnouncement,'review');}else{d.scenario.edges.find(e=>e.id===r.location).open=true;invalidate(r.id+' 经核实恢复通行');generate('道路恢复，重新评估剩余任务');}}
        else {r.status='resolved';r.resolution=note;r.resolvedAt=now();log(r.id+' 协调完成：'+note,'review');}
      }
      else if(name==='confirm'){
        assert(fresh(),'草案依据已变化，请重新计算');const selected=p.alternative?d.alternative:d.plan;assert(selected,'没有备选方案');assert(selected.servedPeople>0,'没有可执行安排，请先协调资源');assert(!validate(snapshot(d),selected).length,'方案校验未通过');if(!selected.complete)assert(text(p.note,300,'未安排人员协调措施').length>=5,'请填写至少 5 字的协调措施');
        if(d.activePlan)d.history.unshift(clone(d.activePlan));d.history=d.history.slice(0,20);d.activePlan={...clone(selected),publishedAt:now(),note:p.note||'',confirmedRevision:d.revision+1};d.lastAnnouncement='方案 '+selected.id+' 已人工确认并模拟发布，安排 '+selected.servedPeople+' 人。';log(d.lastAnnouncement,'publish');
      }
      else if(name==='contact'){
        assert(Array.isArray(p.ids)&&p.ids.length>0&&p.ids.length<=V.MAX_GROUPS,'请选择联系对象');for(const id of p.ids){assert(d.contacts[id],'家庭不存在');d.contacts[id]={ack:true,contacted:true};}log('人工登记演练任务已接收、家庭已联系：'+p.ids.join('、'),'contact');
      }
      else if(name==='field-progress'){
        assert(['ack','contact','board','arrive'].includes(p.stage),'现场执行环节无效');const planId=text(p.planId,60,'执行方案编号');assert(d.activePlan?.id===planId,'现场任务方案已过期，请刷新当前已发布方案后再确认');
        const vehicleId=text(p.vehicleId,40,'车辆编号'),r=d.activePlan.routes.find(r=>r.vehicleId===vehicleId),f=d.fleet[vehicleId];assert(r&&f&&r.people&&!r.holding&&!f.finished,'该车辆没有可回报的当前执行任务');
        const reporter=text(p.reporter||'现场演示员',40,'上报人'),source=inputSource(p.source,'quick'),original=p.text===undefined||p.text===''?'':text(p.text,2000,'现场原话');let result;
        assert(['preparation','executing'].includes(d.phase),'当前阶段不能登记现场执行');
        if(p.stage==='ack'){
          assert(d.taskAcks[vehicleId]?.planId!==planId,'本车已接收当前任务，请继续后续环节');d.taskAcks[vehicleId]={planId,time:now(),reporter,source};
          result={stage:'ack',householdId:null,people:r.people,summary:vehicleId+' 已接收方案 '+planId+' 的转移任务，共 '+r.people+' 人；家庭联系状态尚未改变。'};
          log(result.summary,'field');d.lastAnnouncement=result.summary;
        }else{
          assert(d.taskAcks[vehicleId]?.planId===planId,'请先确认本车已接收当前任务');
          if(p.stage==='contact'){
            const householdId=text(p.householdId,40,'联系家庭编号'),next=r.stops.find(st=>d.stage[st.id]==='waiting'&&!d.contacts[st.id]?.contacted);
            assert(next?.id===householdId,'联系登记必须对应本车下一待联系家庭，不可跳过、跨车或重复登记');const h=d.scenario.households.find(h=>h.id===householdId);d.contacts[householdId]={ack:true,contacted:true};
            result={stage:'contact',householdId,people:h.people,summary:vehicleId+' 已联系 '+h.name+'，'+h.people+' 人的联系结果已登记，尚未登记上车。'};log(result.summary,'field');d.lastAnnouncement=result.summary;
          }else result=advanceVehicle(vehicleId,p.stage,p.stage==='board'?text(p.householdId,40,'上车家庭编号'):null);
        }
        fieldEvent({kind:'progress',vehicleId,planId,reporter,source,text:original,...result});
      }
      else if(name==='start'){
        assert(d.phase==='preparation'&&d.activePlan,'请先确认并发布草案');assert(d.activePlan.inputVersion===d.inputVersion,'发布后条件已变化，请重新计算并确认');assert(d.activePlan.servedIds.every(id=>d.contacts[id]?.contacted),'已安排家庭仍未完成联系登记');d.phase='executing';log('开始模拟执行；车辆位置按逐站登记更新，不是真实 GPS。','execution');d.lastAnnouncement='已开始模拟执行。';
      }
      else if(name==='step'){
        advanceVehicle(p.vehicleId);
      }
      else if(name==='verify'){
        assert(d.stage[p.id]==='arrived','请先有到达登记');d.stage[p.id]='verified';d.executionVersion++;d.plan=null;d.baseline=null;d.alternative=null;d.planSnapshot=null;log(p.id+' 到达记录已经人工核验。','verify');d.lastAnnouncement=d.log[0].message;
      }
      else if(name==='edit'){
        assert(d.phase==='preparation','执行中请通过现场反馈处理变化');const kind=p.kind;assert(['households','vehicles','shelters'].includes(kind),'编辑对象无效');const item=d.scenario[kind].find(x=>x.id===p.id);assert(item,'对象不存在');
        if(kind==='households'){assert(!item.sourceBatchId,'村级人员组请通过村级批次更正，不能直接改写分组人数');item.people=integer(p.people,1,30,'人数');item.risk=integer(p.risk,1,3,'演练风险等级');item.assistance=p.assistance===true||p.wheelchair===true;item.wheelchair=p.wheelchair===true;item.service=item.wheelchair?6:item.assistance?5:2;item.priority=item.risk;V.checkLimits(d,0);}
        else {item.capacity=integer(p.capacity,0,100,'容量');item.available=p.available===true;if(kind==='vehicles')item.wheelchair=p.wheelchair===true;}
        invalidate('人工修改 '+item.name);generate('人员或资源条件变化');
      }
      else throw new Error('不支持的演练操作');
      if(name!=='reset'){
        const impact=x=>{const m=metrics(x);return {people:m.people,highRisk:m.highRisk,capacity:m.capacity,shortage:Math.max(0,m.waiting+m.boarded-m.capacity),closed:x.scenario.edges.filter(e=>!e.open).length,rainfall:x.weather.rainfall};};
        const old=impact(before),current=impact(d),rows=Object.keys(current).filter(key=>current[key]!==old[key]).map(key=>({key,before:old[key],after:current[key],delta:current[key]-old[key]}));
        if(rows.length)d.lastDelta={time:now(),reason:d.log[0]?.message,rows};
      }
      d.revision++;return clone(d);
    }catch(error){d=before;throw error;}
  }
  return {get data(){return clone(d);},action,fresh};
}
module.exports={create,initial,snapshot,solve,baseline,validate,metrics,diagnostics,restore,scenarioCatalog:R.catalog,villageMetrics:V.villageMetrics,blockedRoute,ALGORITHM,BASELINE};
