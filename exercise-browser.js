/* Generated from the same audited exercise modules as the local server. */
(()=>{'use strict';const factories=Object.create(null),cache={'./dist/engine.js':{exports:window.JiaoyingEngine}};
factories["./village-ledger.cjs"]=function(module,exports,require){
'use strict';
// These villages and pickup points belong only to the synthetic exercise graph.
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const sum=(xs,f)=>xs.reduce((n,x)=>n+f(x),0);
const number=(v,min,max,label)=>{assert(Number.isInteger(v)&&v>=min&&v<=max,`${label}须为 ${min}–${max} 的整数`);return v;};
const clean=(v,max,label,fallback='')=>{const s=v===undefined?fallback:v;assert(typeof s==='string'&&s.trim()&&s.length<=max,`${label}不能为空且不能超过 ${max} 字`);return s.trim();};
const MAX_PEOPLE=500,MAX_GROUPS=200;
function catalog(){return ['A','B','C'].map((letter,i)=>({id:'V'+letter,name:`演示村 ${letter}`,township:'演示乡镇',synthetic:true,pickups:[1,2].map((n)=>({id:`P-${letter}${n}`,name:n===1?'村委会集合点（演示）':'备用集合点（演示）',node:'H'+(i*2+n),synthetic:true,longitude:null,latitude:null}))}));}
function ensure(d){
  if(d.villages===undefined)d.villages=catalog();
  if(d.villageReports===undefined)d.villageReports=[];
  assert(Array.isArray(d.villages)&&d.villages.length===3&&d.villages.every(v=>typeof v.id==='string'&&Array.isArray(v.pickups)&&v.pickups.every(p=>d.scenario.nodes.some(n=>n.id===p.node))),'村级台账示范目录无效');
  assert(Array.isArray(d.villageReports)&&d.villageReports.every(r=>r&&typeof r.id==='string'&&d.villages.some(v=>v.id===r.villageId)&&Number.isInteger(r.people)&&r.people>=0&&r.people<=500&&['increment','snapshot','correction'].includes(r.mode)&&['pending','accepted','rejected','superseded'].includes(r.status)&&Array.isArray(r.householdIds)),'村级上报恢复数据无效');
  assert(new Set(d.villageReports.map(r=>r.id)).size===d.villageReports.length,'村级批次编号重复');
  for(const r of d.villageReports){
    assert(['unknown','splittable','together'].includes(r.groupPolicy)&&[r.assistancePeople,r.wheelchairPeople].every(n=>n===null||(Number.isInteger(n)&&n>=0&&n<=r.people))&&(r.assistancePeople===null||r.wheelchairPeople===null||r.wheelchairPeople<=r.assistancePeople),'村级批次特殊需求人数无效');
    assert(new Set(r.householdIds).size===r.householdIds.length&&r.householdIds.every(id=>d.scenario.households.some(h=>h.id===id&&h.sourceBatchId===r.id&&h.villageId===r.villageId)),'村级批次人员组关联无效');
    if(r.householdIds.length){const groups=d.scenario.households.filter(h=>r.householdIds.includes(h.id));assert(sum(groups,h=>h.people)===r.people&&sum(groups,h=>h.assistancePeople)===r.assistancePeople&&sum(groups,h=>h.wheelchairPeople)===r.wheelchairPeople,'村级批次人数或特殊需求不守恒');}
    if(r.status==='superseded')assert(r.supersededBy&&d.villageReports.some(x=>x.id===r.supersededBy&&x.targetId===r.id)&&r.householdIds.every(id=>d.stage[id]==='superseded'),'已更正批次归档关系无效');
    if(effective(r))assert(r.householdIds.every(id=>d.stage[id]!=='superseded')&&(r.people===0||r.householdIds.length>0||r.needsInfo===true),'有效批次人员组状态无效');
  }
  assert(d.scenario.households.filter(h=>h.sourceBatchId).every(h=>d.villageReports.some(r=>r.id===h.sourceBatchId&&r.householdIds.includes(h.id))),'村级人员组缺少原始批次');
  for(const h of d.scenario.households){if(!h.villageId){const point=d.villages.flatMap(v=>v.pickups.map(p=>({...p,villageId:v.id}))).find(p=>p.node===h.node);if(point){h.villageId=point.villageId;h.pickupId=point.id;}}}
  const reportMax=Math.max(0,...d.villageReports.map(r=>Number(r.id.replace(/^VR/,''))||0));
  d.villageReportCounter=Math.max(d.villageReportCounter||0,reportMax);
  const groupMax=Math.max(0,...d.scenario.households.map(h=>Number(h.id.replace(/^VG/,''))||0));
  d.villageGroupCounter=Math.max(d.villageGroupCounter||0,groupMax);
  return d;
}
const effective=r=>r.status==='accepted'&&r.mode!=='snapshot'&&!r.supersededBy;
function unplanned(d){return d.villageReports.filter(r=>effective(r)&&r.people>0&&!r.householdIds.length);}
function unplannedRequests(d){return unplanned(d).map(r=>({id:'BATCH-'+r.id,batchId:r.id,villageId:r.villageId,name:(d.villages.find(v=>v.id===r.villageId)?.name||r.villageId)+' · '+r.id,people:r.people,stage:'waiting',reason:'已核实，待补接人点、协助人数或分组信息；暂不生成接人路线'}));}
function villageMetrics(d){return (d.villages||[]).map(v=>{
  const hs=d.scenario.households.filter(h=>h.villageId===v.id&&d.stage[h.id]!=='superseded'),reports=d.villageReports.filter(r=>r.villageId===v.id),unplannedPeople=sum(unplanned(d).filter(r=>r.villageId===v.id),r=>r.people),count=stage=>sum(hs.filter(h=>d.stage[h.id]===stage),h=>h.people),latest=reports.filter(r=>r.mode==='snapshot'&&r.status==='accepted').sort((a,b)=>Date.parse(b.observedAt)-Date.parse(a.observedAt))[0];
  const waiting=count('waiting')+unplannedPeople;
  return {villageId:v.id,villageName:v.name,township:v.township,pendingPeople:sum(reports.filter(r=>r.status==='pending'&&r.mode==='increment'),r=>r.people),pendingReports:reports.filter(r=>r.status==='pending').length,pendingCorrections:reports.filter(r=>r.status==='pending'&&r.mode==='correction').length,pendingSnapshots:reports.filter(r=>r.status==='pending'&&r.mode==='snapshot').length,waiting,boarded:count('boarded'),arrived:count('arrived'),verified:count('verified'),people:sum(hs,h=>h.people)+unplannedPeople,unplannedPeople,unplannedBatches:reports.filter(r=>effective(r)&&r.needsInfo).length,latestSnapshot:latest?{id:latest.id,people:latest.people,observedAt:latest.observedAt,scope:latest.scope,difference:latest.people-waiting}:null};
});}
function details(d,p,people){
  const v=d.villages.find(v=>v.id===p.villageId);assert(v,'请选择有效的演示村庄');
  const pickupId=p.pickupId||null;assert(pickupId===null||v.pickups.some(x=>x.id===pickupId),'接人点必须属于当前村庄');
  const assistancePeople=p.assistancePeople===undefined?null:p.assistancePeople,wheelchairPeople=p.wheelchairPeople===undefined?null:p.wheelchairPeople;
  if(assistancePeople!==null)number(assistancePeople,0,people,'需协助人数');if(wheelchairPeople!==null)number(wheelchairPeople,0,people,'轮椅人数');
  if(assistancePeople!==null&&wheelchairPeople!==null)assert(wheelchairPeople<=assistancePeople,'轮椅人数包含在需协助人数内，不能超过需协助人数');
  const groupPolicy=p.groupPolicy||'unknown';assert(['unknown','splittable','together'].includes(groupPolicy),'分组方式无效');
  return {pickupId,assistancePeople,wheelchairPeople,groupPolicy};
}
function needsInfo(r){return r.people>0&&(!r.pickupId||r.assistancePeople===null||r.wheelchairPeople===null||r.groupPolicy==='unknown');}
function targetFor(d,r){
  const target=d.villageReports.find(x=>x.id===r.targetId);assert(target&&target.villageId===r.villageId&&target.mode!=='snapshot'&&['pending','accepted'].includes(target.status)&&!target.supersededBy,'更正目标已失效，请刷新并选择当前有效批次');
  assert(target.householdIds.every(id=>d.stage[id]==='waiting'),'目标批次已有人员上车、到达或完成，不能通过人数更正覆盖执行记录');return target;
}
function checkLimits(d,people,groups=0,replace=null){
  const replaced=new Set(replace?.householdIds||[]),hs=d.scenario.households.filter(h=>d.stage[h.id]!=='superseded'&&!replaced.has(h.id));
  const held=sum(unplanned(d).filter(r=>r.id!==replace?.id),r=>r.people);
  assert(sum(hs,h=>h.people)+held+people<=MAX_PEOPLE,`当前演示最多管理 ${MAX_PEOPLE} 名有效人员；请拆分演练或协调处理`);
  assert(hs.length+groups<=MAX_GROUPS,`当前演示最多管理 ${MAX_GROUPS} 个有效人员组；请调整分组或协调处理`);
}
function split(r){
  if(!r.people)return [];
  if(r.groupPolicy==='together')return [{people:r.people,assistancePeople:r.assistancePeople,wheelchairPeople:r.wheelchairPeople}];
  const groups=[];for(let n=0;n<r.wheelchairPeople;n++)groups.push({people:1,assistancePeople:1,wheelchairPeople:1});
  const add=(count,assisted)=>{for(let n=count;n>0;n-=4){const people=Math.min(n,4);groups.push({people,assistancePeople:assisted?people:0,wheelchairPeople:0});}};
  add(r.assistancePeople-r.wheelchairPeople,true);add(r.people-r.assistancePeople,false);return groups;
}
function materialize(d,r,replace=null){
  r.needsInfo=needsInfo(r);const groups=r.needsInfo?[]:split(r);checkLimits(d,r.people,groups.length,replace);
  if(replace){replace.status='superseded';replace.supersededBy=r.id;replace.supersededAt=r.reviewedAt;for(const id of replace.householdIds)d.stage[id]='superseded';}
  const pickup=d.villages.find(v=>v.id===r.villageId).pickups.find(p=>p.id===r.pickupId),village=d.villages.find(v=>v.id===r.villageId);
  for(const group of groups){let id;do{id='VG'+(++d.villageGroupCounter);}while(d.scenario.households.some(h=>h.id===id));const assistance=group.assistancePeople>0,wheelchair=group.wheelchairPeople>0;
    d.scenario.households.push({id,node:pickup.node,name:`${village.name} · ${r.id} 第 ${r.householdIds.length+1} 组`,...group,priority:assistance?2:1,risk:2,riskBase:2,assistance,wheelchair,service:wheelchair?6:assistance?5:2,note:`村级批次 ${r.id}；${r.groupPolicy==='together'?'整组同行':'允许分车'}`,response:'新增待联系',villageId:r.villageId,pickupId:r.pickupId,sourceBatchId:r.id,groupPolicy:r.groupPolicy});d.stage[id]='waiting';d.contacts[id]={ack:false,contacted:false};r.householdIds.push(id);
  }
}
function handle(d,name,p,c){
  if(!['village-report','village-review','village-complete'].includes(name))return false;
  ensure(d);let r;
  if(name==='village-report'){
    assert(['increment','snapshot','correction'].includes(p.mode),'请选择新增、待转移总量或更正口径');const people=number(p.people,p.mode==='increment'?1:0,500,'本次人数');const extra=details(d,p,people);
    const source=p.source||'manual';assert(['quick','voice','text','manual'].includes(source),'现场输入来源无效');
    r={id:'VR'+(d.villageReportCounter+1),villageId:p.villageId,mode:p.mode,people,...extra,targetId:p.mode==='correction'?clean(p.targetId,40,'更正目标'):null,scope:p.mode==='snapshot'?p.scope:null,observedAt:p.mode==='snapshot'?p.observedAt:null,text:clean(p.text,2000,'现场原话',`${p.mode==='increment'?'新增':p.mode==='correction'?'更正为':'当前待转移共'} ${people} 人`),reporter:clean(p.reporter,40,'上报人','现场演示员'),source,inputSource:source,status:'pending',householdIds:[],needsInfo:needsInfo({people,...extra}),createdAt:c.now(),note:'',inputVersion:d.inputVersion,duplicateAcknowledged:p.duplicateAcknowledged===true};
    if(r.mode==='snapshot'){assert(r.scope==='waiting','总量口径只能是当前待转移人数，不包含已上车或已到达人员');assert(typeof r.observedAt==='string'&&Number.isFinite(Date.parse(r.observedAt)),'总量上报须填写有效的统计时间');r.observedAt=new Date(r.observedAt).toISOString();}
    if(r.mode==='correction'){targetFor(d,r);assert(!d.villageReports.some(x=>x.mode==='correction'&&x.targetId===r.targetId&&x.status==='pending'),'该批次已有待核实更正，请等待处理后再更正');}
    if(r.mode==='increment'){const duplicate=d.villageReports.find(x=>x.mode==='increment'&&['pending','accepted'].includes(x.status)&&x.villageId===r.villageId&&x.pickupId===r.pickupId&&x.people===r.people&&Date.parse(r.createdAt)-Date.parse(x.createdAt)<30*60*1000);assert(!duplicate||r.duplicateAcknowledged,`疑似重复上报：${duplicate?.id||''} 在近 30 分钟内同村、同接人点、同人数；请核对是否为另一批人员并明确确认`);if(duplicate)r.possibleDuplicateOf=duplicate.id;}
    d.villageReportCounter++;d.villageReports.unshift(r);d.lastAnnouncement=`收到 ${d.villages.find(v=>v.id===r.villageId).name} ${r.id}：${r.mode==='increment'?'新增 '+people+' 人待核实':r.mode==='snapshot'?'待转移总量观测 '+people+' 人，未重复累计':'更正为 '+people+' 人，原批次保持有效直到核实'}。`;c.log(d.lastAnnouncement,'village');
  }else{
    r=d.villageReports.find(x=>x.id===p.id);assert(r,'村级上报不存在');const note=clean(p.note,300,'核实说明');
    if(name==='village-review'){
      assert(r.status==='pending','该村级上报已处理，请刷新台账');assert(['accept','reject'].includes(p.decision),'核实操作无效');
      const target=r.mode==='correction'&&p.decision==='accept'?targetFor(d,r):null;r.note=note;r.reviewedAt=c.now();
      if(p.decision==='reject'){r.status='rejected';d.lastAnnouncement=r.id+' 未采纳：'+note;c.log(d.lastAnnouncement,'village');}
      else if(r.mode==='snapshot'){r.status='accepted';r.needsInfo=false;d.lastAnnouncement=r.id+' 待转移总量 '+r.people+' 人已记录为观测，未新增或删除人员；差异请通过批次补报或更正核对。';c.log(d.lastAnnouncement,'village');}
      else{
        Object.assign(r,details(d,{...r,...Object.fromEntries(['pickupId','assistancePeople','wheelchairPeople','groupPolicy'].filter(k=>p[k]!==undefined).map(k=>[k,p[k]]))},r.people));
        materialize(d,r,target);r.status='accepted';c.invalidate(r.id+' 核实'+(r.mode==='correction'?'更正':'新增')+' '+r.people+' 人');c.generate(r.id+' 村级需求更新');d.lastAnnouncement=r.id+' 已核实'+(r.needsInfo?'，'+r.people+' 人待补接人点、协助人数或分组信息，暂未生成接人路线':'，'+r.people+' 人已整理为 '+r.householdIds.length+' 个待转移组')+'；新草案仍需人工确认。';c.log(d.lastAnnouncement,'village');
      }
    }else{
      assert(effective(r)&&r.needsInfo&&!r.householdIds.length,'仅可补齐已核实、尚未分组的有效批次');
      Object.assign(r,details(d,{...r,...p},r.people));assert(!needsInfo(r),'请补齐接人点、需协助人数、轮椅人数和分组方式');
      // Exclude this held batch from the capacity check before materializing it.
      r.status='pending';materialize(d,r);r.status='accepted';r.completedAt=c.now();r.completionNote=note;c.invalidate(r.id+' 已补齐调度信息');c.generate(r.id+' 补齐接人信息');d.lastAnnouncement=r.id+' 已补齐信息，'+r.people+' 人已整理为 '+r.householdIds.length+' 个待转移组；新草案仍需人工确认。';c.log(d.lastAnnouncement,'village');
    }
  }
  c.fieldEvent({kind:'village',stage:name,villageReportId:r.id,villageId:r.villageId,people:r.people,reporter:r.reporter,source:r.source,text:r.text,summary:d.lastAnnouncement,planId:d.activePlan?.id||null});return true;
}
module.exports={ensure,handle,villageMetrics,unplannedRequests,checkLimits,MAX_PEOPLE,MAX_GROUPS};

};
factories["./dispatch-large.cjs"]=function(module,exports,require){
'use strict';

// Bounded heuristic for the larger village ledger. All route feasibility and
// conservation checks use the same helpers as the small exact candidate search.
const ALGORITHM = 'ruian-bounded-insertion-heuristic-3.4';
const compare = (a, b) => {
  for (let k = 0; k < a.length; k++) if (a[k] !== b[k]) return a[k] < b[k] ? -1 : 1;
  return 0;
};
const planScore = p => [-p.onboardCount, -p.urgentPeople, -p.assistedPeople, -p.servedPeople, p.wait, p.finish, p.drive];
const signature = p => p.routes.map(r => r.vehicleId + ':' + r.stops.map(h => h.id).join(',') + '>' + r.shelterId).join('|');
const total = (items, fn) => items.reduce((n, x) => n + fn(x), 0);

// Long routes try evenly spaced insertion positions, including both ends.
// This bound is independent of village group count and avoids permutation search.
function insertionPositions(length) {
  if (length <= 8) return Array.from({length: length + 1}, (_, k) => k);
  return [...new Set(Array.from({length: 9}, (_, k) => Math.round(k * length / 8)))];
}

function solve(snapshot, {routeBuilder, summarize, validate, baseline}) {
  const started = Date.now(), s = snapshot.scenario, builder = routeBuilder(snapshot);
  const homes = new Map(s.households.map(h => [h.id, h]));
  const waiting = s.households.filter(h => snapshot.stage[h.id] === 'waiting');
  const shelters = new Map(s.shelters.map(sh => [sh.id, sh]));
  const options = new Map(waiting.map(h => [h.id,
    total(s.vehicles, v => total(s.shelters, sh => builder.route(v, [h], sh) ? 1 : 0))
  ]));
  const seeds = [
    {order:'large', allocation:'time', onboard:'scarce'},
    {order:'small', allocation:'time', onboard:'scarce'},
    {order:'scarce', allocation:'time', onboard:'scarce'},
    {order:'id', allocation:'time', onboard:'large'},
    {order:'large', allocation:'compact', onboard:'scarce'},
    {order:'small', allocation:'compact', onboard:'large'},
    {order:'scarce', allocation:'compact', onboard:'large'},
    {order:'large', allocation:'time', onboard:'reverse'}
  ];
  const candidates = [];
  let routeEvaluations = 0;

  function build(seed) {
    const routes = s.vehicles.map(builder.idle), loads = {};
    const fits = (route, old) => route &&
      (loads[route.shelterId] || 0) - (old.shelterId === route.shelterId ? old.people : 0) +
      route.people + (snapshot.occupancy[route.shelterId] || 0) <= shelters.get(route.shelterId).capacity;
    const replace = (vi, next) => {
      const old = routes[vi];
      if (old.shelterId) loads[old.shelterId] -= old.people;
      routes[vi] = next;
      loads[next.shelterId] = (loads[next.shelterId] || 0) + next.people;
    };
    const onboard = s.vehicles.map((v, vi) => ({v, vi,
      people: total(snapshot.fleet[v.id].onboard, id => homes.get(id).people),
      choices: s.shelters.map(sh => builder.route(v, [], sh)).filter(Boolean)
    })).filter(x => snapshot.fleet[x.v.id].onboard.length);
    onboard.sort((a, b) => seed.onboard === 'reverse' ? b.vi - a.vi :
      seed.onboard === 'large' ? b.people - a.people || a.vi - b.vi :
      a.choices.length - b.choices.length || b.people - a.people || a.vi - b.vi);

    // Reserve feasible destinations for passengers already on their original car.
    // If no feasible destination exists, idle() exposes an explicit holding state.
    for (const item of onboard) {
      const choices = item.choices.filter(r => fits(r, routes[item.vi]));
      choices.sort((a, b) => compare([a.finish, a.drive], [b.finish, b.drive]) || a.shelterId.localeCompare(b.shelterId));
      if (choices.length) replace(item.vi, choices[0]);
    }
    const order = [...waiting].sort((a, b) => {
      const priority = Number(b.risk === 3) - Number(a.risk === 3) || Number(b.assistance) - Number(a.assistance);
      if (priority) return priority;
      const variant = seed.order === 'large' ? b.people - a.people : seed.order === 'small' ? a.people - b.people :
        seed.order === 'scarce' ? (options.get(a.id) || Infinity) - (options.get(b.id) || Infinity) || b.people - a.people : 0;
      return variant || a.id.localeCompare(b.id);
    });
    for (const home of order) {
      let best = null;
      for (let vi = 0; vi < s.vehicles.length; vi++) {
        const vehicle = s.vehicles[vi], old = routes[vi], fleet = snapshot.fleet[vehicle.id];
        if (!vehicle.available || fleet.finished) continue;
        const manifest = [...fleet.onboard, ...old.stops.map(st => st.id)].map(id => homes.get(id));
        const people = total(manifest, h => h.people) + home.people;
        if (people > vehicle.capacity || total(manifest, h => Number(h.wheelchair)) + Number(home.wheelchair) > Number(vehicle.wheelchair)) continue;
        const existing = old.stops.map(st => homes.get(st.id));
        const otherFinish = Math.max(0, ...routes.filter((r, index) => index !== vi && r.people).map(r => r.finish));
        for (const at of insertionPositions(existing.length)) {
          const nextOrder = [...existing.slice(0, at), home, ...existing.slice(at)];
          for (let si = 0; si < s.shelters.length; si++) {
            routeEvaluations++;
            const route = builder.route(vehicle, nextOrder, s.shelters[si]);
            if (!fits(route, old)) continue;
            // Added passengers are identical for every placement of this group;
            // compare route costs, or available seat fit in the compact variants.
            const cost = [route.wait - old.wait, Math.max(otherFinish, route.finish), route.drive - old.drive];
            const key = seed.allocation === 'compact' ? [vehicle.capacity - people, ...cost, vi, si, at] : [...cost, vehicle.capacity - people, vi, si, at];
            if (!best || compare(key, best.key) < 0) best = {vi, route, key};
          }
        }
      }
      if (best) replace(best.vi, best.route);
    }
    const plan = summarize(snapshot, routes, ALGORITHM);
    plan.selectedCandidate = `${seed.order}/${seed.allocation}/${seed.onboard}`;
    return plan;
  }

  // Retaining the baseline as a candidate prevents a heuristic regression under
  // the existing lexicographic objective; it does not imply global optimality.
  const base = baseline(snapshot);
  candidates.push({...base, algorithm:ALGORITHM, selectedCandidate:'retained-baseline'});
  for (const seed of seeds) candidates.push(build(seed));
  const distinct = new Map();
  for (const candidate of candidates) {
    const errors = validate(snapshot, candidate);
    if (errors.length) throw new Error('大规模调度校验失败：' + errors.join('；'));
    const key = signature(candidate);
    if (!distinct.has(key)) distinct.set(key, candidate);
  }
  const ranked = [...distinct.values()].sort((a, b) => compare(planScore(a), planScore(b)) || signature(a).localeCompare(signature(b)));
  const top = ranked.slice(0, 2);
  for (const plan of top) Object.assign(plan, {
    heuristic:true,
    optimality:'not-proven',
    searchMethod:'有界多起点贪心插入；不保证全局最优',
    combinations:candidates.length,
    evaluatedCandidates:candidates.length,
    distinctCandidates:distinct.size,
    routeEvaluations,
    elapsedMs:Date.now() - started
  });
  return {plan:top[0], alternative:top[1] || null};
}

module.exports = {solve, ALGORITHM};

};
factories["./exercise.cjs"]=function(module,exports,require){
'use strict';
// Server-owned synthetic exercise. No weather/model/notification service is called.
const E=require('./dist/engine.js');
const V=require('./village-ledger.cjs');
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
  const d={schema:'jiaoying-v3',revision:1,inputVersion:1,executionVersion:1,algorithm:ALGORITHM,phase:'preparation',scenario,stage:{},contacts:{},fleet:{},occupancy:{S1:0,S2:0},reports:[],fieldEvents:[],taskAcks:{},history:[],log:[],plan:null,baseline:null,alternative:null,activePlan:null,planSnapshot:null,planCounter:0,weather:{sourceMode:'simulation',level:1,rainfall:20,unit:'mm',window:'演练最近1小时累计',updatedAt:now(),trigger:'初始演练条件'},lastAnnouncement:'瑞安合成演练已就绪。6 户 15 人，3 辆车，2 个安置点。'};
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
    for(const seg of r.segments){bad(seg.nodes?.[0]===seg.from&&seg.nodes?.at(-1)===seg.to&&seg.edges?.length===seg.nodes.length-1,'路径结构无效');let minutes=0;for(let k=0;k<(seg.edges||[]).length;k++){const edge=s.edges.find(e=>e.id===seg.edges[k]);bad(edge?.open,'包含封闭道路');if(edge){bad((edge.from===seg.nodes[k]&&edge.to===seg.nodes[k+1])||(edge.to===seg.nodes[k]&&edge.from===seg.nodes[k+1]),'路径不连续');minutes+=edge.minutes;}}bad(minutes===seg.minutes,'路段时间无效');}
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
function blockedRoute(d,r){if(!r||r.holding)return true;const f=d.fleet[r.vehicleId];if(f.finished)return false;if(r.passengerIds.some(id=>d.stage[id]==='superseded'))return true;const pending=r.stops.filter(st=>d.stage[st.id]==='waiting');const first=pending.length?r.stops.indexOf(pending[0]):r.stops.length;return r.segments.slice(first).some(seg=>seg.edges.some(id=>!d.scenario.edges.find(e=>e.id===id)?.open));}
function restore(initialData){
  const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
  assert(object(initialData)&&initialData.schema==='jiaoying-v3','恢复数据必须为 jiaoying-v3 演练数据');
  const d=clone(initialData),s=d.scenario;
  assert(object(s)&&['nodes','edges','households','vehicles','shelters'].every(k=>Array.isArray(s[k])&&s[k].length&&s[k].every(x=>object(x)&&typeof x.id==='string')),'恢复数据缺少有效的演练对象');
  for(const key of ['nodes','edges','households','vehicles','shelters'])assert(new Set(s[key].map(x=>x.id)).size===s[key].length,'恢复数据存在重复对象');
  assert(['revision','inputVersion','executionVersion'].every(k=>Number.isInteger(d[k])&&d[k]>=1)&&Number.isInteger(d.planCounter)&&d.planCounter>=0,'恢复数据版本无效');
  assert(['preparation','executing'].includes(d.phase)&&['stage','contacts','fleet','occupancy','weather'].every(k=>object(d[k]))&&['reports','history','log'].every(k=>Array.isArray(d[k])),'恢复数据状态结构无效');
  assert(s.households.every(h=>['waiting','boarded','arrived','verified','superseded'].includes(d.stage[h.id])&&object(d.contacts[h.id])&&typeof d.contacts[h.id].contacted==='boolean'&&Number.isInteger(h.people)&&h.people>0),'恢复数据人员状态无效');
  assert(s.vehicles.every(v=>object(d.fleet[v.id])&&Array.isArray(d.fleet[v.id].onboard)&&Array.isArray(d.fleet[v.id].delivered)&&typeof d.fleet[v.id].finished==='boolean'&&s.nodes.some(n=>n.id===d.fleet[v.id].node)&&Number.isFinite(d.fleet[v.id].minute)&&d.fleet[v.id].minute>=0),'恢复数据车辆状态无效');
  assert(s.shelters.every(sh=>Number.isInteger(d.occupancy[sh.id])&&d.occupancy[sh.id]>=0),'恢复数据安置人数无效');
  assert(['plan','baseline','alternative','activePlan'].every(k=>d[k]===null||(object(d[k])&&Array.isArray(d[k].routes)&&Array.isArray(d[k].servedIds))),'恢复数据方案结构无效');
  if(d.fieldEvents===undefined)d.fieldEvents=[];
  if(d.taskAcks===undefined)d.taskAcks={};
  assert(Array.isArray(d.fieldEvents)&&d.fieldEvents.every(e=>object(e)&&typeof e.id==='string')&&object(d.taskAcks),'恢复数据现场记录无效');
  d.fieldEvents=d.fieldEvents.slice(0,100);
  return V.ensure(d);
}
function create(initialData=null){
  let d=initialData===null?initial():restore(initialData);
  function log(message,type='action'){d.log.unshift({id:(d.log[0]?.id||0)+1,time:now(),type,message});d.log=d.log.slice(0,150);}
  function fieldEvent(event){const record={id:'F'+(d.revision+1),time:now(),...event};d.fieldEvents.unshift(record);d.fieldEvents=d.fieldEvents.slice(0,100);return record;}
  function inputSource(value,fallback){const source=value===undefined?fallback:value;assert(['quick','voice','text','manual'].includes(source),'现场输入来源无效');return source;}
  function invalidate(reason){d.inputVersion++;d.plan=null;d.baseline=null;d.alternative=null;d.planSnapshot=null;log(reason,'input');}
  function generate(reason='人工重新计算'){
    const i=snapshot(d),result=solve(i);d.plan=result.plan;d.alternative=result.alternative;d.baseline=baseline(i);d.planSnapshot=i;d.planCounter++;for(const p of [d.plan,d.alternative,d.baseline].filter(Boolean))p.id='P'+d.planCounter+'-'+(p===d.baseline?'B':p===d.alternative?'ALT':'A');
    d.plan.createdAt=now();d.plan.trigger=reason;d.plan.steps=['读取输入 v'+d.inputVersion+' / 执行记录 '+d.executionVersion,'按开放路网和车辆登记位置搜索路线','校验座位、轮椅位、安置容量和人员守恒','草案已生成，等待人工确认'];
    d.lastAnnouncement=reason+'。新草案可安排 '+d.plan.servedPeople+' 人，'+sum(d.plan.unassigned,h=>h.people)+' 人待协调。尚未替换执行方案。';log(d.lastAnnouncement,'plan');
  }
  function fresh(){return !!d.plan&&d.plan.inputVersion===d.inputVersion&&d.plan.executionVersion===d.executionVersion;}
  function advanceVehicle(vehicleId,expectedStage=null,householdId=null){
    assert(d.phase==='executing','请先开始模拟执行');const r=d.activePlan?.routes.find(r=>r.vehicleId===vehicleId),f=d.fleet[vehicleId];assert(r&&f&&!f.finished&&r.people,'该车辆没有可推进任务');assert(!r.passengerIds.some(id=>d.stage[id]==='superseded'),'本路线的人员批次已更正，请重新计算并确认方案后继续');assert(!blockedRoute(d,r),'剩余路线包含已确认封闭道路，暂停推进；请先重规划并确认');
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
module.exports={create,initial,snapshot,solve,baseline,validate,metrics,villageMetrics:V.villageMetrics,blockedRoute,ALGORITHM,BASELINE};

};
function require(id){if(cache[id])return cache[id].exports;if(!factories[id])throw new Error('Unavailable browser module: '+id);const m={exports:{}};cache[id]=m;factories[id](m,m.exports,require);return m.exports;}window.JiaoyingExercise=require('./exercise.cjs');
window.JiaoyingPagesIntegrations={"integrationStatus":{"agent":{"mode":"prepared","connected":false,"provider":"DeepSeek（后续由 Agent 接入）","contract":"jiaoying-agent-v1"},"weather":{"mode":"prepared","connected":false,"provider":"彩云天气","apiVersion":"v2.6","unit":"metric:v2","coordinateOrder":"longitude,latitude"},"position":{"mode":"prepared","connected":false,"source":"当前为人工登记节点，不是 GPS"}},"agentContract":{"schema":"jiaoying-agent-v1","mode":"prepared","connected":false,"input":["requestId","utterance","snapshot","inputVersion","executionVersion"],"output":["requestId","summary","proposedActions","evidence","inputVersion","executionVersion"],"tools":[{"name":"read_state","mutates":false},{"name":"calculate_draft","mutates":true,"requiresHumanConfirmation":false},{"name":"prepare_report","mutates":false},{"name":"propose_scenario","mutates":false}],"rules":["Agent 返回建议，不直接调用确认、发布或安全核验操作","工具结果必须引用同一输入和执行版本","网页提交的动作由本地服务重新验证","不确定时澄清，不补造地点人数或预案条款"]}};})();
