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
factories["./resilience.cjs"]=function(module,exports,require){
'use strict';
// Data validation and transparent, deterministic explanations; no model service.
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const sum=(rows,fn)=>rows.reduce((n,row)=>n+fn(row),0);
const bounded=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
const integer=(n,min,max)=>Number.isInteger(n)&&bounded(n,min,max);
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(id)&&!['__proto__','prototype','constructor'].includes(id);
const catalog=[
  {id:'normal',name:'初始接送',description:'15 人、3 辆车、2 个安置点；先比较同一输入的两套方案。'},
  {id:'road-closure',name:'道路中断',description:'东桥核实受阻；重新计算绕行和转移安排。'},
  {id:'village-growth',name:'村级新增 12 人',description:'演示村 A 新增 12 人，其中 3 人需协助、含 1 名轮椅人员；核实后计算资源缺口。'},
  {id:'resource-shortage',name:'车辆故障',description:'1 号车不可用，轮椅接送受限；展示不能安排的对象及增援需求。'},
  {id:'shelter-loss',name:'安置点停用',description:'安置点 A 不可接收；剩余容量不足时明确待协调人员。'},
  {id:'ruian-roads',name:'瑞安真实路网',description:'使用公开 OSM 道路；接送用途、容量和速度仍为演练假设。'}
];

function inspectJSON(value){
  let entries=0;const seen=new Set();
  function walk(x,depth){
    assert(depth<=40,'恢复数据嵌套过深');assert(++entries<=400000,'恢复数据对象数量过大');
    if(x===null||typeof x==='boolean')return;
    if(typeof x==='number'){assert(Number.isFinite(x),'恢复数据包含非法数字');return;}
    if(typeof x==='string'){assert(x.length<=20000,'恢复数据文本过长');return;}
    assert(object(x)||Array.isArray(x),'恢复数据必须为 JSON 对象');assert(!seen.has(x),'恢复数据不能有循环引用');seen.add(x);
    for(const [key,item] of Object.entries(x)){assert(!['__proto__','prototype','constructor'].includes(key),'恢复数据含禁止的属性');walk(item,depth+1);}seen.delete(x);
  }
  walk(value,0);assert(JSON.stringify(value).length<=8*1024*1024,'恢复文件超过 8 MB 限额');
}
function checkPlan(p,s,label){
  if(p===null)return;
  assert(object(p)&&Array.isArray(p.routes)&&p.routes.length<=s.vehicles.length&&Array.isArray(p.servedIds)&&Array.isArray(p.unassigned),label+'结构无效');
  assert(p.id===undefined||validId(p.id),label+'编号无效');
  if(p.steps!==undefined)assert(Array.isArray(p.steps)&&p.steps.length<=20&&p.steps.every(step=>typeof step==='string'&&step.length<=500),label+'步骤结构无效');
  for(const key of ['servedPeople','totalPeople','urgentPeople','assistedPeople','onboardCount','wait','finish','drive','inputVersion','executionVersion'])assert(bounded(p[key],0,1e12),label+'统计无效');
  assert(p.servedIds.every(id=>s.households.some(h=>h.id===id)),label+'含未知人员');
  const vehicleIds=new Set();
  for(const r of p.routes){
    assert(object(r)&&s.vehicles.some(v=>v.id===r.vehicleId)&&!vehicleIds.has(r.vehicleId),label+'车辆无效或重复');vehicleIds.add(r.vehicleId);
    assert(s.nodes.some(n=>n.id===r.from)&&bounded(r.startMinute,0,1e7)&&bounded(r.finish,0,1e7)&&integer(r.people,0,500)&&typeof r.holding==='boolean',label+'路线数值无效');
    for(const key of ['onboard','passengerIds'])assert(Array.isArray(r[key])&&r[key].length<=200&&r[key].every(id=>s.households.some(h=>h.id===id)),label+'乘员关联无效');
    assert(Array.isArray(r.stops)&&r.stops.length<=200&&r.stops.every(st=>object(st)&&s.households.some(h=>h.id===st.id)&&s.nodes.some(n=>n.id===st.node)&&integer(st.people,1,500)&&bounded(st.arrival,0,1e7)&&bounded(st.depart,st.arrival,1e7)),label+'站点无效');
    assert(r.shelterId===null||s.shelters.some(sh=>sh.id===r.shelterId),label+'接收点无效');
    assert(Array.isArray(r.segments)&&r.segments.length<=201,label+'路段结构无效');
    for(const seg of r.segments){
      assert(object(seg)&&Array.isArray(seg.nodes)&&Array.isArray(seg.edges)&&seg.nodes.length<=2500&&seg.edges.length===seg.nodes.length-1&&seg.nodes[0]===seg.from&&seg.nodes.at(-1)===seg.to&&bounded(seg.minutes,0,1e7),label+'路径结构无效');
      let minutes=0;
      for(let k=0;k<seg.edges.length;k++){const e=s.edges.find(e=>e.id===seg.edges[k]);assert(e&&((e.from===seg.nodes[k]&&e.to===seg.nodes[k+1])||(!e.directed&&e.to===seg.nodes[k]&&e.from===seg.nodes[k+1])),label+'路径关联或方向无效');minutes+=e.minutes;}
      assert(Math.abs(minutes-seg.minutes)<1e-6,label+'路径时间不符');
    }
  }
  assert(p.unassigned.length<=2000&&p.unassigned.every(h=>object(h)&&typeof h.id==='string'&&integer(h.people,1,500)&&typeof h.reason==='string'),label+'待协调名单无效');
}
function validateState(d){
  inspectJSON(d);assert(object(d)&&d.schema==='jiaoying-v3','恢复数据必须为 jiaoying-v3 演练数据');const s=d.scenario;
  assert(object(s),'恢复数据缺少演练场景');
  const limits={nodes:2500,edges:8000,households:2000,vehicles:30,shelters:30};
  for(const [key,max] of Object.entries(limits)){assert(Array.isArray(s[key])&&s[key].length>0&&s[key].length<=max&&s[key].every(x=>object(x)&&validId(x.id)),'恢复数据'+key+'目录无效或超过限额');assert(new Set(s[key].map(x=>x.id)).size===s[key].length,'恢复数据存在重复对象');}
  const nodes=new Set(s.nodes.map(n=>n.id));
  assert(object(s.region)&&['synthetic-topology','osm-road-network'].includes(s.region.mapKind),'恢复地图模式无效');
  const geographic=s.region.mapKind==='osm-road-network';
  const coordinate=point=>Array.isArray(point)&&point.length===2&&bounded(point[0],-180,180)&&bounded(point[1],-90,90);
  if(s.region.bounds!==undefined){const b=s.region.bounds;assert(Array.isArray(b)&&b.length===4&&coordinate(b.slice(0,2))&&coordinate(b.slice(2))&&b[0]<b[2]&&b[1]<b[3],'恢复地图范围无效');}
  if(geographic)assert(s.region.coordinateSystem==='WGS84','真实道路演练坐标系无效');
  assert(s.nodes.every(n=>bounded(n.x,-1e7,1e7)&&bounded(n.y,-1e7,1e7)&&typeof n.label==='string'&&['home','shelter','depot','junction'].includes(n.kind)),'恢复点位坐标或类型无效');
  for(const n of s.nodes){if(geographic||n.longitude!==undefined&&n.longitude!==null||n.latitude!==undefined&&n.latitude!==null)assert(coordinate([n.longitude,n.latitude]),'恢复经纬度坐标无效');}
  assert(s.edges.every(e=>nodes.has(e.from)&&nodes.has(e.to)&&e.from!==e.to&&bounded(e.minutes,0.001,1440)&&typeof e.open==='boolean'&&(e.directed===undefined||typeof e.directed==='boolean')),'恢复道路端点、耗时或开闭状态无效');
  for(const e of s.edges){
    if(geographic||e.geometry!==undefined){assert(Array.isArray(e.geometry)&&e.geometry.length>=2&&e.geometry.length<=1000&&e.geometry.every(coordinate),'恢复道路几何无效');
      if(geographic){const from=s.nodes.find(n=>n.id===e.from),to=s.nodes.find(n=>n.id===e.to),start=e.geometry[0],end=e.geometry.at(-1);assert(Math.abs(start[0]-from.longitude)<1e-7&&Math.abs(start[1]-from.latitude)<1e-7&&Math.abs(end[0]-to.longitude)<1e-7&&Math.abs(end[1]-to.latitude)<1e-7,'恢复道路几何端点与路网不一致');}}
    if(e.osmWayIds!==undefined)assert(Array.isArray(e.osmWayIds)&&e.osmWayIds.length<=1000&&e.osmWayIds.every(id=>integer(id,1,Number.MAX_SAFE_INTEGER)),'恢复道路来源编号无效');
  }
  assert(s.vehicles.every(v=>nodes.has(v.start)&&integer(v.capacity,0,500)&&typeof v.available==='boolean'&&typeof v.wheelchair==='boolean'&&typeof v.name==='string'&&typeof v.color==='string'&&/^#[0-9a-f]{6}$/i.test(v.color)),'恢复车辆容量、类型或颜色无效');
  assert(s.shelters.every(sh=>nodes.has(sh.id)&&integer(sh.capacity,0,10000)&&typeof sh.available==='boolean'&&typeof sh.name==='string'),'恢复安置容量或状态无效');
  assert(s.households.every(h=>nodes.has(h.node)&&integer(h.people,1,500)&&integer(h.risk,1,3)&&integer(h.priority,1,3)&&bounded(h.service,0,1440)&&typeof h.assistance==='boolean'&&typeof h.wheelchair==='boolean'&&typeof h.name==='string'),'恢复人员数量、风险或服务时长无效');
  for(const h of s.households){const assisted=h.assistancePeople??(h.assistance?h.people:0),chairs=h.wheelchairPeople??Number(h.wheelchair);assert(integer(assisted,0,h.people)&&integer(chairs,0,assisted)&&Boolean(chairs)===h.wheelchair&&Boolean(assisted)===h.assistance,'恢复人员特殊需求人数无效');}
  assert(['revision','inputVersion','executionVersion'].every(k=>integer(d[k],1,Number.MAX_SAFE_INTEGER-2))&&integer(d.planCounter,0,Number.MAX_SAFE_INTEGER-2),'恢复数据版本无效');
  for(const resource of [...s.vehicles,...s.shelters])if(resource.resourceChangeVersion!==undefined)assert(integer(resource.resourceChangeVersion,1,d.inputVersion),'恢复资源变更版本无效');
  assert(['preparation','executing'].includes(d.phase)&&['stage','contacts','fleet','occupancy','weather'].every(k=>object(d[k])),'恢复数据状态结构无效');
  assert(integer(d.weather.level,1,3)&&bounded(d.weather.rainfall,0,10000),'恢复天气数据无效');
  const maxRows={reports:2000,history:20,log:150,fieldEvents:100,villageReports:2000};
  for(const [key,max] of Object.entries(maxRows))if(d[key]!==undefined)assert(Array.isArray(d[key])&&d[key].length<=max&&d[key].every(object),'恢复记录结构无效或超过限额：'+key);
  assert(['reports','history','log'].every(k=>Array.isArray(d[k])),'恢复数据记录缺失');
  if(d.villages!==undefined){
    assert(Array.isArray(d.villages)&&d.villages.length===3&&d.villages.every(v=>object(v)&&validId(v.id)&&typeof v.name==='string'&&v.name.length<=100&&typeof v.township==='string'&&v.township.length<=100&&Array.isArray(v.pickups)&&v.pickups.length>0&&v.pickups.length<=30),'恢复村庄或集合点目录无效');
    assert(new Set(d.villages.map(v=>v.id)).size===d.villages.length,'恢复村庄编号重复');
    const pickups=d.villages.flatMap(v=>v.pickups);
    assert(pickups.every(p=>object(p)&&validId(p.id)&&nodes.has(p.node)&&typeof p.name==='string'&&p.name.length<=100)&&new Set(pickups.map(p=>p.id)).size===pickups.length,'恢复集合点内容或编号无效');
  }
  if(d.villageReports!==undefined)assert(d.villageReports.every(r=>validId(r.id)&&Array.isArray(r.householdIds)&&r.householdIds.length<=200&&r.householdIds.every(validId)),'恢复村级批次编号或人员组目录无效');
  assert(s.households.every(h=>['waiting','boarded','arrived','verified','superseded'].includes(d.stage[h.id])&&object(d.contacts[h.id])&&typeof d.contacts[h.id].contacted==='boolean'&&typeof d.contacts[h.id].ack==='boolean'),'恢复人员阶段或联系记录无效');
  assert(Object.keys(d.stage).every(id=>s.households.some(h=>h.id===id))&&Object.keys(d.fleet).every(id=>s.vehicles.some(v=>v.id===id))&&Object.keys(d.occupancy).every(id=>s.shelters.some(sh=>sh.id===id)),'恢复台账含未知对象');
  const onboard=new Set(),delivered=new Set(),occupancy={};
  for(const v of s.vehicles){const f=d.fleet[v.id];assert(object(f)&&nodes.has(f.node)&&bounded(f.minute,0,1e7)&&typeof f.finished==='boolean','恢复车辆状态无效：位置或时间不合法');
    for(const key of ['onboard','delivered'])assert(Array.isArray(f[key])&&f[key].length<=200&&f[key].every(id=>s.households.some(h=>h.id===id)),'恢复车辆乘员不存在');
    for(const id of f.onboard){assert(d.stage[id]==='boarded'&&!onboard.has(id),'恢复已上车人员重复或阶段不符');onboard.add(id);}
    for(const id of f.delivered){assert(['arrived','verified'].includes(d.stage[id])&&!delivered.has(id),'恢复已到达人员重复或阶段不符');delivered.add(id);}
    const hs=f.onboard.map(id=>s.households.find(h=>h.id===id));assert(sum(hs,h=>h.people)<=v.capacity&&sum(hs,h=>h.wheelchairPeople??Number(h.wheelchair))<=Number(v.wheelchair),'恢复车载人数超载');
    assert(!f.finished||!f.onboard.length,'已结束车辆仍有在途人员');assert(!f.delivered.length||f.finished&&s.shelters.some(sh=>sh.id===f.node),'已送达记录缺少有效到达点');
    if(f.delivered.length)occupancy[f.node]=(occupancy[f.node]||0)+sum(f.delivered,id=>s.households.find(h=>h.id===id).people);
  }
  for(const h of s.households){assert((d.stage[h.id]==='boarded')===onboard.has(h.id),'恢复已上车人员守恒校验失败');assert(['arrived','verified'].includes(d.stage[h.id])===delivered.has(h.id),'恢复已到达人员守恒校验失败');}
  for(const sh of s.shelters)assert(integer(d.occupancy[sh.id],0,sh.capacity)&&d.occupancy[sh.id]===(occupancy[sh.id]||0),'恢复安置人数不守恒');
  // Legacy stores may have preparation + boarding records; external import checks
  // the stricter phase rule separately rather than breaking legacy hydration.
  for(const r of d.reports)assert(validId(r.id)&&['road','people','medical','hazard','progress','other'].includes(r.kind)&&['pending','accepted','rejected','coordination','resolved'].includes(r.status)&&(nodes.has(r.location)||s.edges.some(e=>e.id===r.location))&&typeof r.text==='string'&&integer(r.people,0,500),'恢复现场反馈无效');
  assert(d.taskAcks===undefined||object(d.taskAcks)&&Object.entries(d.taskAcks).every(([id,a])=>s.vehicles.some(v=>v.id===id)&&object(a)&&typeof a.planId==='string'),'恢复接令记录无效');
  assert(d.log.every(row=>integer(row.id,1,Number.MAX_SAFE_INTEGER)&&typeof row.message==='string'&&row.message.length<=5000&&typeof row.type==='string'&&typeof row.time==='string'&&Number.isFinite(Date.parse(row.time))),'恢复日志内容无效');
  assert(d.lastAnnouncement===undefined||typeof d.lastAnnouncement==='string','恢复播报内容无效');
  assert(d.exerciseId===undefined||typeof d.exerciseId==='string'&&d.exerciseId.length<=100,'恢复演练编号无效');
  assert(d.createdAt===undefined||typeof d.createdAt==='string'&&Number.isFinite(Date.parse(d.createdAt)),'恢复创建时间无效');
  if(d.lastDelta!==undefined){
    const delta=d.lastDelta,keys=['people','highRisk','capacity','shortage','closed','rainfall'];
    assert(object(delta)&&typeof delta.time==='string'&&Number.isFinite(Date.parse(delta.time))&&Array.isArray(delta.rows)&&delta.rows.length<=keys.length,'恢复指标变化结构无效');
    assert(delta.reason===undefined||typeof delta.reason==='string'&&delta.reason.length<=5000,'恢复指标变化说明无效');
    assert(delta.rows.every(r=>object(r)&&keys.includes(r.key)&&[r.before,r.after,r.delta].every(n=>bounded(n,-1e8,1e8))&&Math.abs(r.after-r.before-r.delta)<1e-6)&&new Set(delta.rows.map(r=>r.key)).size===delta.rows.length,'恢复指标变化数值或类型无效');
  }
  for(const row of [...s.households,...s.vehicles,...s.shelters,...d.reports,...(d.villageReports||[]),...(d.fieldEvents||[])]){
    for(const key of ['name','note','text','reporter','summary','reason','resolution','response','label','unavailableReason'])if(row[key]!==undefined)assert(typeof row[key]==='string'&&row[key].length<=5000,'恢复记录文本字段无效：'+key);
  }
  if(d.fieldEvents!==undefined)assert(d.fieldEvents.every(row=>validId(row.id)&&['report','progress','village'].includes(row.kind)&&typeof row.time==='string'&&Number.isFinite(Date.parse(row.time))),'恢复现场事件无效');
  if(d.followups!==undefined)assert(object(d.followups)&&Object.keys(d.followups).length<=500&&Object.entries(d.followups).every(([key,r])=>validId(key)&&object(r)&&['open','working','resolved'].includes(r.status)&&typeof r.owner==='string'&&r.owner.length<=40&&typeof r.note==='string'&&r.note.length<=500&&(r.dueAt===null||typeof r.dueAt==='string'&&Number.isFinite(Date.parse(r.dueAt)))),'恢复责任跟进记录无效');
  for(const key of ['plan','baseline','alternative','activePlan'])checkPlan(d[key],s,'恢复'+key);
  if(d.plan){
    assert(d.baseline!==null&&object(d.planSnapshot),'恢复草案缺少配套基线或快照');
    const i=d.planSnapshot;
    assert(object(i.scenario)&&['nodes','edges','households','vehicles','shelters'].every(key=>Array.isArray(i.scenario[key]))&&object(i.stage)&&object(i.fleet)&&object(i.occupancy)&&Array.isArray(i.unplannedRequests),'恢复草案快照结构无效');
  }else assert(d.baseline===null&&d.alternative===null&&(d.planSnapshot===null||d.planSnapshot===undefined),'恢复草案与配套结果不一致');
  for(const p of d.history)checkPlan(p,s,'历史方案');
  return d;
}

function explainUnassigned(i,h,E){
  if(h.id.startsWith('BATCH-'))return {...h,code:'information',next:'补齐集合点、特殊需求和分组信息后重新计算。'};
  const home=i.scenario.households.find(x=>x.id===h.id);if(!home)return {...h,code:'information',next:'核对人员编号。'};
  const s=i.scenario,chairs=home.wheelchairPeople??Number(home.wheelchair);
  const available=s.vehicles.filter(v=>v.available&&!i.fleet[v.id].finished);
  if(h.stage==='boarded'){const v=s.vehicles.find(v=>i.fleet[v.id].onboard.includes(h.id));return {...h,code:v&&!v.available?'vehicle-unavailable':'onboard-held',next:'原车人员保持锁定；人工协调维修、专业接驳或可达接收点，再核实重新计算。'};}
  if(!available.length)return {...h,code:'vehicle-unavailable',next:'登记增援可用车辆后重新计算。'};
  if(!available.some(v=>v.capacity>=home.people&&Number(v.wheelchair)>=chairs))return {...h,code:'vehicle-fit',next:chairs?'协调具备轮椅位且座位足够的车辆；不能自动拆分同行组。':'协调座位足够的车辆，或由现场明确允许分组后更正批次。'};
  const shelters=s.shelters.filter(sh=>sh.available&&sh.capacity-(i.occupancy[sh.id]||0)>=home.people);
  if(!shelters.length)return {...h,code:'shelter-capacity',next:'核实并登记可接收的安置资源；不自动提高容量。'};
  if(!available.some(v=>E.shortestPath(s,i.fleet[v.id].node,home.node))||!shelters.some(sh=>E.shortestPath(s,home.node,sh.id)))return {...h,code:'road-access',next:'核查封闭路段、开放替代道路或协调专业救援。'};
  return {...h,code:'joint-capacity',next:'本组单独可适配，但与其他人员竞争有限座位、轮椅位或接收容量；优先级策略选择后仍需增援。'};
}
function diagnostics(d,helpers){
  const {E,snapshot,validate,blockedRoute}=helpers,i=d.planSnapshot||snapshot(d),p=d.plan,b=d.baseline;
  const routeSummary=(plan,id)=>{const r=plan?.routes.find(x=>x.vehicleId===id);return r?{people:r.people,ids:r.passengerIds,stops:r.stops.map(x=>x.id),shelterId:r.shelterId,finish:r.finish,drive:r.drive,holding:r.holding}:null;};
  const changes=d.scenario.vehicles.map(v=>({vehicleId:v.id,vehicleName:v.name,before:routeSummary(d.activePlan,v.id),after:routeSummary(p,v.id)})).filter(x=>p&&d.activePlan&&JSON.stringify(x.before)!==JSON.stringify(x.after));
  const errors=p?validate(i,p):[];
  const rows=d.scenario.vehicles.map(v=>({vehicleId:v.id,vehicleName:v.name,baseline:routeSummary(b,v.id),optimized:routeSummary(p,v.id)}));
  const shelterRows=d.scenario.shelters.map(sh=>({id:sh.id,name:sh.name,capacity:sh.capacity,occupied:i.occupancy[sh.id]||0,baseline:sum(b?.routes.filter(r=>r.shelterId===sh.id)||[],r=>r.people),optimized:sum(p?.routes.filter(r=>r.shelterId===sh.id)||[],r=>r.people)}));
  const waiting=(plan,kind='priority')=>plan?sum(plan.routes,r=>sum(r.stops,st=>{const h=i.scenario.households.find(x=>x.id===st.id);if(!h)return 0;const assisted=h.assistancePeople??(h.assistance?h.people:0),people=kind==='assisted'?assisted:kind==='urgent'?(h.risk===3?h.people:0):h.risk===3?h.people:assisted;return Math.max(0,st.arrival-r.startMinute)*people;})):null;
  const coordination=[];
  for(const r of d.reports.filter(x=>['pending','coordination','accepted'].includes(x.status)))coordination.push({key:'report:'+r.id,type:'report',title:r.id+' '+(r.status==='pending'?'待核实':'待处置'),detail:r.text});
  for(const r of (d.villageReports||[]).filter(x=>x.status==='pending'||x.status==='accepted'&&x.needsInfo))coordination.push({key:'village:'+r.id,type:'village',title:r.id+(r.status==='pending'?' 村级上报待核实':' 待补调度信息'),detail:r.text});
  for(const h of p?.unassigned||[])coordination.push({key:'person:'+h.id,type:'person',title:h.name+' · '+h.people+' 人待协调',detail:h.reason});
  for(const v of d.scenario.vehicles.filter(x=>!x.available))coordination.push({key:'vehicle:'+v.id,type:'resource',title:v.name+' 不可用',detail:v.unavailableReason||'待核实恢复条件'});
  for(const sh of d.scenario.shelters.filter(x=>!x.available))coordination.push({key:'shelter:'+sh.id,type:'resource',title:sh.name+' 不可用',detail:sh.unavailableReason||'待核实接收能力'});
  for(const h of d.scenario.households.filter(h=>d.stage[h.id]==='waiting'&&!d.contacts[h.id]?.contacted))coordination.push({key:'contact:'+h.id,type:'contact',title:h.name+' 待联系',detail:'接收任务不等于联系成功，请登记实际联系结果。'});
  for(const r of d.activePlan?.routes||[])if(!d.fleet[r.vehicleId].finished&&blockedRoute?.(d,r))coordination.push({key:'blocked:'+r.vehicleId,type:'blocked',title:r.vehicleId+' 执行受阻',detail:'核查资源、路段和当前乘员；重新计算并确认后再推进。'});
  for(const item of coordination)item.followup=d.followups?.[item.key]||null;
  return {scenarioCatalog:catalog,currentScenario:d.scenarioPreset||'normal',constraints:{checked:Boolean(p),ok:Boolean(p)&&!errors.length,errors,inputVersion:i.inputVersion,executionVersion:i.executionVersion,algorithm:p?.algorithm||null,checks:['容量与轮椅位','路径连续与开放方向','已上车人员原车锁定','人员守恒与未安排名单','安置剩余容量'],scope:'仅校验演练输入的调度约束，不等于现场安全评估'},comparison:{sameSnapshot:!!p&&!!b&&p.inputVersion===b.inputVersion&&p.executionVersion===b.executionVersion,rows,shelters:shelterRows,baselineUnassigned:b?.unassigned||[],optimizedUnassigned:p?.unassigned||[],priorityWait:{baseline:waiting(b),optimized:waiting(p),unit:'人·分钟',definition:'已安排高风险人数与实际需协助人数的并集等待，同人不重复；须同时比较未安排人数'},assistedWait:{baseline:waiting(b,'assisted'),optimized:waiting(p,'assisted'),unit:'人·分钟'},urgentWait:{baseline:waiting(b,'urgent'),optimized:waiting(p,'urgent'),unit:'人·分钟'}},changes,unassigned:(p?.unassigned||[]).map(h=>explainUnassigned(i,h,E)),coordination,planB:{available:Boolean(d.alternative),scope:'同一输入下另一可行候选；资源失效后须登记变化并重算，旧备选不能直接视为有效',failureScenarios:['road-closure','resource-shortage','shelter-loss']}};
}
module.exports={validateState,diagnostics,catalog,inspectJSON};

};
factories["./geo-scenario.cjs"]=function(module,exports,require){
'use strict';
const network=require('./dist/assets/maps/ruian-routing.json');
const clone=value=>JSON.parse(JSON.stringify(value));

// Apply only to a fresh exercise. Scenario replacement belongs to the domain's
// explicit, confirmed scenario action; this helper must not erase live records.
function apply(d){
  if(!d?.scenario||d.phase!=='preparation'||d.plan||d.activePlan||d.baseline||d.alternative||
      ['reports','villageReports','fieldEvents','history'].some(key=>d[key]?.length)||
      Object.values(d.contacts||{}).some(c=>c.ack||c.contacted)||
      Object.values(d.fleet||{}).some(f=>f.onboard?.length||f.finished||f.minute>0)||
      Object.values(d.stage||{}).some(stage=>stage!=='waiting')||
      d.scenario.households.some(h=>!/^H[1-6]$/.test(h.id)))
    throw new Error('道路情景只能应用于新建演练，不能覆盖已有执行记录');
  const s=d.scenario;
  s.name=network.region.name;
  s.region=clone(network.region);
  s.nodes=clone(network.nodes);
  s.edges=clone(network.edges);
  s.geographicMetadata=clone(network.metadata);
  s.households.forEach(h=>{h.node=h.id;h.note=(h.note||'')+'；接人位置为公开道路节点上的演练集合点，非真实家庭地址';});
  s.vehicles.forEach(v=>{v.start='D';d.fleet[v.id].node='D';});
  s.shelters.forEach(sh=>{sh.name=s.nodes.find(n=>n.id===sh.id).label;sh.synthetic=true;});
  for(const village of d.villages||[])for(const pickup of village.pickups){
    const node=s.nodes.find(n=>n.id===pickup.node);
    if(!node)throw new Error('演练集合点与道路节点无法对应');
    Object.assign(pickup,{name:node.label,longitude:node.longitude,latitude:node.latitude,
      coordinateSystem:'WGS84',osmNodeId:node.osmNodeId,sourceUrl:node.sourceUrl,
      synthetic:true,coordinateSource:'OpenStreetMap 历史道路节点；集合点用途为演练设定'});
  }
  d.lastAnnouncement='瑞安城区道路演练已就绪。真实 OSM 道路几何与单行方向参与求解；集合点、接收点用途、车辆、容量与时间为演练设定。';
  return d;
}

module.exports={apply,metadata:clone(network.metadata)};

};
factories["./exercise.cjs"]=function(module,exports,require){
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

};
cache['./dist/assets/maps/ruian-routing.json']={exports:{
  "schema": "jiaoying-osm-roads-v1",
  "region": {
    "name": "浙江省瑞安市 · 城区道路演练片区",
    "mapKind": "osm-road-network",
    "coordinateSystem": "WGS84",
    "bounds": [
      120.633,
      27.777,
      120.652,
      27.791
    ],
    "longitude": 120.6425,
    "latitude": 27.784
  },
  "metadata": {
    "source": "OpenStreetMap contributors",
    "sourceTime": "2026-09-22T08:45:51Z",
    "license": "ODbL 1.0",
    "sourceUrl": "https://www.openstreetmap.org/copyright",
    "licenseUrl": "https://opendatacommons.org/licenses/odbl/1-0/",
    "originalFile": "ruian-osm-raw.json",
    "originalSha256": "f9064823d77b5f689984c34ac89a4bffeecd0ebed8d121968da9d7442f69a133",
    "builder": "scripts/build-road-network.py",
    "algorithm": "shared OSM IDs + largest SCC + same-way degree-2 compression v1",
    "rawConnectedNodes": 212,
    "nodeCount": 101,
    "edgeCount": 138,
    "onewayEdges": 73,
    "excluded": {},
    "assumptions": [
      "真实道路几何与单行标签来自公开历史快照；业务用途、人员、车辆、容量和通行时间均为演练设定。",
      "演练集合点与接收点绑定道路节点，不表示真实村委会、建筑入口或官方避难场所。",
      "只在共享 OSM 节点连接，不以几何交叉推断路口；仅保留可双向互达的有限片区。",
      "保留单行方向，排除明示禁止机动车/私人道路；未收录完整转向限制、车型限高、实时路况与临时交通管制。",
      "每路段 15 km/h 并向上取整分钟是可复现演练参数，不用于安全导航。",
      "OSM 来源与许可不等于比赛已审核地图来源，参赛资格仍待团队核实。"
    ]
  },
  "nodes": [
    {
      "id": "O3458135047",
      "longitude": 120.6488075,
      "latitude": 27.7807659,
      "osmNodeId": 3458135047,
      "x": 619.1,
      "y": 357.02,
      "kind": "junction",
      "label": "道路节点 3458135047",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458135047"
    },
    {
      "id": "O3458135061",
      "longitude": 120.6489153,
      "latitude": 27.7807531,
      "osmNodeId": 3458135061,
      "x": 622.85,
      "y": 357.41,
      "kind": "junction",
      "label": "道路节点 3458135061",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458135061"
    },
    {
      "id": "O3458135293",
      "longitude": 120.6483789,
      "latitude": 27.7774023,
      "osmNodeId": 3458135293,
      "x": 604.21,
      "y": 457.93,
      "kind": "junction",
      "label": "道路节点 3458135293",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458135293"
    },
    {
      "id": "O3458135305",
      "longitude": 120.6482716,
      "latitude": 27.7774402,
      "osmNodeId": 3458135305,
      "x": 600.49,
      "y": 456.79,
      "kind": "junction",
      "label": "道路节点 3458135305",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458135305"
    },
    {
      "id": "O3458145804",
      "longitude": 120.6487914,
      "latitude": 27.7806779,
      "osmNodeId": 3458145804,
      "x": 618.54,
      "y": 359.66,
      "kind": "junction",
      "label": "道路节点 3458145804",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458145804"
    },
    {
      "id": "O3458145812",
      "longitude": 120.6457878,
      "latitude": 27.7811648,
      "osmNodeId": 3458145812,
      "x": 514.21,
      "y": 345.06,
      "kind": "junction",
      "label": "道路节点 3458145812",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458145812"
    },
    {
      "id": "O3458145817",
      "longitude": 120.641301,
      "latitude": 27.7817032,
      "osmNodeId": 3458145817,
      "x": 358.35,
      "y": 328.9,
      "kind": "junction",
      "label": "道路节点 3458145817",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458145817"
    },
    {
      "id": "O3458145819",
      "longitude": 120.6413435,
      "latitude": 27.7818019,
      "osmNodeId": 3458145819,
      "x": 359.83,
      "y": 325.94,
      "kind": "junction",
      "label": "道路节点 3458145819",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458145819"
    },
    {
      "id": "O3458145822",
      "longitude": 120.6489009,
      "latitude": 27.7806627,
      "osmNodeId": 3458145822,
      "x": 622.35,
      "y": 360.12,
      "kind": "junction",
      "label": "道路节点 3458145822",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458145822"
    },
    {
      "id": "O3458151392",
      "longitude": 120.6452329,
      "latitude": 27.7817442,
      "osmNodeId": 3458151392,
      "x": 494.93,
      "y": 327.67,
      "kind": "junction",
      "label": "道路节点 3458151392",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458151392"
    },
    {
      "id": "O3458151823",
      "longitude": 120.6442015,
      "latitude": 27.7813972,
      "osmNodeId": 3458151823,
      "x": 459.1,
      "y": 338.08,
      "kind": "junction",
      "label": "道路节点 3458151823",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458151823"
    },
    {
      "id": "O3458151830",
      "longitude": 120.6441827,
      "latitude": 27.7806989,
      "osmNodeId": 3458151830,
      "x": 458.45,
      "y": 359.03,
      "kind": "junction",
      "label": "道路节点 3458151830",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458151830"
    },
    {
      "id": "O3458151831",
      "longitude": 120.6439867,
      "latitude": 27.7813207,
      "osmNodeId": 3458151831,
      "x": 451.64,
      "y": 340.38,
      "kind": "junction",
      "label": "道路节点 3458151831",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3458151831"
    },
    {
      "id": "O3461903671",
      "longitude": 120.6412224,
      "latitude": 27.777728,
      "osmNodeId": 3461903671,
      "x": 355.62,
      "y": 448.16,
      "kind": "junction",
      "label": "道路节点 3461903671",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3461903671"
    },
    {
      "id": "O3461903687",
      "longitude": 120.6464802,
      "latitude": 27.7789964,
      "osmNodeId": 3461903687,
      "x": 538.26,
      "y": 410.11,
      "kind": "junction",
      "label": "道路节点 3461903687",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3461903687"
    },
    {
      "id": "O3461903693",
      "longitude": 120.6359982,
      "latitude": 27.7799266,
      "osmNodeId": 3461903693,
      "x": 174.15,
      "y": 382.2,
      "kind": "junction",
      "label": "道路节点 3461903693",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3461903693"
    },
    {
      "id": "O3461903695",
      "longitude": 120.6388231,
      "latitude": 27.7788877,
      "osmNodeId": 3461903695,
      "x": 272.28,
      "y": 413.37,
      "kind": "junction",
      "label": "道路节点 3461903695",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/3461903695"
    },
    {
      "id": "O5306991165",
      "longitude": 120.6428953,
      "latitude": 27.7796414,
      "osmNodeId": 5306991165,
      "x": 413.73,
      "y": 390.76,
      "kind": "junction",
      "label": "道路节点 5306991165",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991165"
    },
    {
      "id": "O5306991169",
      "longitude": 120.6424241,
      "latitude": 27.7790792,
      "osmNodeId": 5306991169,
      "x": 397.36,
      "y": 407.62,
      "kind": "junction",
      "label": "道路节点 5306991169",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991169"
    },
    {
      "id": "O5306991170",
      "longitude": 120.6425857,
      "latitude": 27.7797275,
      "osmNodeId": 5306991170,
      "x": 402.98,
      "y": 388.18,
      "kind": "junction",
      "label": "道路节点 5306991170",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991170"
    },
    {
      "id": "H5",
      "longitude": 120.6456327,
      "latitude": 27.77919,
      "osmNodeId": 5306991173,
      "x": 508.82,
      "y": 404.3,
      "kind": "home",
      "label": "演练集合点 5",
      "businessUse": "synthetic",
      "sourceUrl": "https://www.openstreetmap.org/node/5306991173"
    },
    {
      "id": "O5306991174",
      "longitude": 120.6429153,
      "latitude": 27.7802924,
      "osmNodeId": 5306991174,
      "x": 414.43,
      "y": 371.23,
      "kind": "junction",
      "label": "道路节点 5306991174",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991174"
    },
    {
      "id": "O5306991178",
      "longitude": 120.6435661,
      "latitude": 27.7802211,
      "osmNodeId": 5306991178,
      "x": 437.03,
      "y": 373.37,
      "kind": "junction",
      "label": "道路节点 5306991178",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991178"
    },
    {
      "id": "O5306991179",
      "longitude": 120.6431893,
      "latitude": 27.7793727,
      "osmNodeId": 5306991179,
      "x": 423.94,
      "y": 398.82,
      "kind": "junction",
      "label": "道路节点 5306991179",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991179"
    },
    {
      "id": "O5306991181",
      "longitude": 120.6437498,
      "latitude": 27.7802579,
      "osmNodeId": 5306991181,
      "x": 443.41,
      "y": 372.26,
      "kind": "junction",
      "label": "道路节点 5306991181",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991181"
    },
    {
      "id": "O5306991182",
      "longitude": 120.6447905,
      "latitude": 27.7813127,
      "osmNodeId": 5306991182,
      "x": 479.56,
      "y": 340.62,
      "kind": "junction",
      "label": "道路节点 5306991182",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991182"
    },
    {
      "id": "O5306991183",
      "longitude": 120.6447047,
      "latitude": 27.781213,
      "osmNodeId": 5306991183,
      "x": 476.58,
      "y": 343.61,
      "kind": "junction",
      "label": "道路节点 5306991183",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991183"
    },
    {
      "id": "O5306991189",
      "longitude": 120.6450952,
      "latitude": 27.781264,
      "osmNodeId": 5306991189,
      "x": 490.15,
      "y": 342.08,
      "kind": "junction",
      "label": "道路节点 5306991189",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991189"
    },
    {
      "id": "O5306991190",
      "longitude": 120.644998,
      "latitude": 27.7811796,
      "osmNodeId": 5306991190,
      "x": 486.77,
      "y": 344.61,
      "kind": "junction",
      "label": "道路节点 5306991190",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991190"
    },
    {
      "id": "O5306991191",
      "longitude": 120.6439904,
      "latitude": 27.7801704,
      "osmNodeId": 5306991191,
      "x": 451.77,
      "y": 374.89,
      "kind": "junction",
      "label": "道路节点 5306991191",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991191"
    },
    {
      "id": "O5306991193",
      "longitude": 120.6414799,
      "latitude": 27.7776123,
      "osmNodeId": 5306991193,
      "x": 364.56,
      "y": 451.63,
      "kind": "junction",
      "label": "道路节点 5306991193",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991193"
    },
    {
      "id": "O5306991207",
      "longitude": 120.6440945,
      "latitude": 27.7812027,
      "osmNodeId": 5306991207,
      "x": 455.39,
      "y": 343.92,
      "kind": "junction",
      "label": "道路节点 5306991207",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991207"
    },
    {
      "id": "O5306991212",
      "longitude": 120.6436318,
      "latitude": 27.7803042,
      "osmNodeId": 5306991212,
      "x": 439.32,
      "y": 370.87,
      "kind": "junction",
      "label": "道路节点 5306991212",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991212"
    },
    {
      "id": "O5306991214",
      "longitude": 120.6429747,
      "latitude": 27.7796183,
      "osmNodeId": 5306991214,
      "x": 416.49,
      "y": 391.45,
      "kind": "junction",
      "label": "道路节点 5306991214",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991214"
    },
    {
      "id": "O5306991215",
      "longitude": 120.6417945,
      "latitude": 27.7784626,
      "osmNodeId": 5306991215,
      "x": 375.49,
      "y": 426.12,
      "kind": "junction",
      "label": "道路节点 5306991215",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991215"
    },
    {
      "id": "O5306991217",
      "longitude": 120.6430323,
      "latitude": 27.7795471,
      "osmNodeId": 5306991217,
      "x": 418.49,
      "y": 393.59,
      "kind": "junction",
      "label": "道路节点 5306991217",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991217"
    },
    {
      "id": "O5306991218",
      "longitude": 120.6481755,
      "latitude": 27.7793478,
      "osmNodeId": 5306991218,
      "x": 597.15,
      "y": 399.57,
      "kind": "junction",
      "label": "道路节点 5306991218",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991218"
    },
    {
      "id": "O5306991219",
      "longitude": 120.6448361,
      "latitude": 27.7799173,
      "osmNodeId": 5306991219,
      "x": 481.15,
      "y": 382.48,
      "kind": "junction",
      "label": "道路节点 5306991219",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991219"
    },
    {
      "id": "O5306991223",
      "longitude": 120.6378279,
      "latitude": 27.7812028,
      "osmNodeId": 5306991223,
      "x": 237.71,
      "y": 343.92,
      "kind": "junction",
      "label": "道路节点 5306991223",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991223"
    },
    {
      "id": "O5306991224",
      "longitude": 120.637726,
      "latitude": 27.7812273,
      "osmNodeId": 5306991224,
      "x": 234.17,
      "y": 343.18,
      "kind": "junction",
      "label": "道路节点 5306991224",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991224"
    },
    {
      "id": "O5306991225",
      "longitude": 120.6351909,
      "latitude": 27.7817351,
      "osmNodeId": 5306991225,
      "x": 146.1,
      "y": 327.95,
      "kind": "junction",
      "label": "道路节点 5306991225",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991225"
    },
    {
      "id": "O5306991227",
      "longitude": 120.6350751,
      "latitude": 27.7886232,
      "osmNodeId": 5306991227,
      "x": 142.08,
      "y": 121.3,
      "kind": "junction",
      "label": "道路节点 5306991227",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991227"
    },
    {
      "id": "O5306991279",
      "longitude": 120.6333559,
      "latitude": 27.7849793,
      "osmNodeId": 5306991279,
      "x": 82.36,
      "y": 230.62,
      "kind": "junction",
      "label": "道路节点 5306991279",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991279"
    },
    {
      "id": "O5306991280",
      "longitude": 120.6342516,
      "latitude": 27.7869558,
      "osmNodeId": 5306991280,
      "x": 113.48,
      "y": 171.33,
      "kind": "junction",
      "label": "道路节点 5306991280",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991280"
    },
    {
      "id": "H1",
      "longitude": 120.6350278,
      "latitude": 27.788427,
      "osmNodeId": 5306991281,
      "x": 140.44,
      "y": 127.19,
      "kind": "home",
      "label": "演练集合点 1",
      "businessUse": "synthetic",
      "sourceUrl": "https://www.openstreetmap.org/node/5306991281"
    },
    {
      "id": "O5306991287",
      "longitude": 120.6371785,
      "latitude": 27.7836468,
      "osmNodeId": 5306991287,
      "x": 215.15,
      "y": 270.6,
      "kind": "junction",
      "label": "道路节点 5306991287",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991287"
    },
    {
      "id": "O5306991290",
      "longitude": 120.6362953,
      "latitude": 27.7862985,
      "osmNodeId": 5306991290,
      "x": 184.47,
      "y": 191.04,
      "kind": "junction",
      "label": "道路节点 5306991290",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991290"
    },
    {
      "id": "O5306991292",
      "longitude": 120.6369826,
      "latitude": 27.7874009,
      "osmNodeId": 5306991292,
      "x": 208.34,
      "y": 157.97,
      "kind": "junction",
      "label": "道路节点 5306991292",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991292"
    },
    {
      "id": "O5306991293",
      "longitude": 120.6368127,
      "latitude": 27.7872833,
      "osmNodeId": 5306991293,
      "x": 202.44,
      "y": 161.5,
      "kind": "junction",
      "label": "道路节点 5306991293",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991293"
    },
    {
      "id": "O5306991296",
      "longitude": 120.6357954,
      "latitude": 27.7842245,
      "osmNodeId": 5306991296,
      "x": 167.1,
      "y": 253.27,
      "kind": "junction",
      "label": "道路节点 5306991296",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991296"
    },
    {
      "id": "O5306991298",
      "longitude": 120.6393113,
      "latitude": 27.7838592,
      "osmNodeId": 5306991298,
      "x": 289.23,
      "y": 264.22,
      "kind": "junction",
      "label": "道路节点 5306991298",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991298"
    },
    {
      "id": "O5306991299",
      "longitude": 120.6387095,
      "latitude": 27.7829825,
      "osmNodeId": 5306991299,
      "x": 268.33,
      "y": 290.53,
      "kind": "junction",
      "label": "道路节点 5306991299",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991299"
    },
    {
      "id": "O5306991300",
      "longitude": 120.638654,
      "latitude": 27.7828456,
      "osmNodeId": 5306991300,
      "x": 266.4,
      "y": 294.63,
      "kind": "junction",
      "label": "道路节点 5306991300",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991300"
    },
    {
      "id": "H6",
      "longitude": 120.6365059,
      "latitude": 27.7797536,
      "osmNodeId": 5306991307,
      "x": 191.78,
      "y": 387.39,
      "kind": "home",
      "label": "演练集合点 6",
      "businessUse": "synthetic",
      "sourceUrl": "https://www.openstreetmap.org/node/5306991307"
    },
    {
      "id": "O5306991318",
      "longitude": 120.633591,
      "latitude": 27.7788225,
      "osmNodeId": 5306991318,
      "x": 90.53,
      "y": 415.33,
      "kind": "junction",
      "label": "道路节点 5306991318",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991318"
    },
    {
      "id": "O5306991333",
      "longitude": 120.6337181,
      "latitude": 27.7770188,
      "osmNodeId": 5306991333,
      "x": 94.94,
      "y": 469.44,
      "kind": "junction",
      "label": "道路节点 5306991333",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991333"
    },
    {
      "id": "O5306991345",
      "longitude": 120.6345669,
      "latitude": 27.7785843,
      "osmNodeId": 5306991345,
      "x": 124.43,
      "y": 422.47,
      "kind": "junction",
      "label": "道路节点 5306991345",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991345"
    },
    {
      "id": "O5306991451",
      "longitude": 120.6387903,
      "latitude": 27.7827898,
      "osmNodeId": 5306991451,
      "x": 271.14,
      "y": 296.31,
      "kind": "junction",
      "label": "道路节点 5306991451",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991451"
    },
    {
      "id": "O5306991452",
      "longitude": 120.6388492,
      "latitude": 27.7829145,
      "osmNodeId": 5306991452,
      "x": 273.18,
      "y": 292.57,
      "kind": "junction",
      "label": "道路节点 5306991452",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991452"
    },
    {
      "id": "O5306991453",
      "longitude": 120.6394322,
      "latitude": 27.7837895,
      "osmNodeId": 5306991453,
      "x": 293.43,
      "y": 266.31,
      "kind": "junction",
      "label": "道路节点 5306991453",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991453"
    },
    {
      "id": "O5306991454",
      "longitude": 120.6396433,
      "latitude": 27.7838384,
      "osmNodeId": 5306991454,
      "x": 300.77,
      "y": 264.85,
      "kind": "junction",
      "label": "道路节点 5306991454",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991454"
    },
    {
      "id": "H3",
      "longitude": 120.6470796,
      "latitude": 27.7845579,
      "osmNodeId": 5306991457,
      "x": 559.08,
      "y": 243.26,
      "kind": "home",
      "label": "演练集合点 3",
      "businessUse": "synthetic",
      "sourceUrl": "https://www.openstreetmap.org/node/5306991457"
    },
    {
      "id": "O5306991460",
      "longitude": 120.639264,
      "latitude": 27.7840604,
      "osmNodeId": 5306991460,
      "x": 287.59,
      "y": 258.19,
      "kind": "junction",
      "label": "道路节点 5306991460",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991460"
    },
    {
      "id": "O5306991464",
      "longitude": 120.6475284,
      "latitude": 27.784372,
      "osmNodeId": 5306991464,
      "x": 574.67,
      "y": 248.84,
      "kind": "junction",
      "label": "道路节点 5306991464",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991464"
    },
    {
      "id": "D",
      "longitude": 120.6362826,
      "latitude": 27.7839373,
      "osmNodeId": 5306991466,
      "x": 184.03,
      "y": 261.88,
      "kind": "depot",
      "label": "演练车辆集结点",
      "businessUse": "synthetic",
      "sourceUrl": "https://www.openstreetmap.org/node/5306991466"
    },
    {
      "id": "O5306991467",
      "longitude": 120.6357723,
      "latitude": 27.7841332,
      "osmNodeId": 5306991467,
      "x": 166.3,
      "y": 256.0,
      "kind": "junction",
      "label": "道路节点 5306991467",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991467"
    },
    {
      "id": "O5306991469",
      "longitude": 120.6333053,
      "latitude": 27.784858,
      "osmNodeId": 5306991469,
      "x": 80.61,
      "y": 234.26,
      "kind": "junction",
      "label": "道路节点 5306991469",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991469"
    },
    {
      "id": "O5306991483",
      "longitude": 120.6394703,
      "latitude": 27.7841888,
      "osmNodeId": 5306991483,
      "x": 294.76,
      "y": 254.34,
      "kind": "junction",
      "label": "道路节点 5306991483",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/5306991483"
    },
    {
      "id": "H2",
      "longitude": 120.6384659,
      "latitude": 27.786315,
      "osmNodeId": 5306991484,
      "x": 259.87,
      "y": 190.55,
      "kind": "home",
      "label": "演练集合点 2",
      "businessUse": "synthetic",
      "sourceUrl": "https://www.openstreetmap.org/node/5306991484"
    },
    {
      "id": "H4",
      "longitude": 120.6475029,
      "latitude": 27.784154,
      "osmNodeId": 6233434069,
      "x": 573.78,
      "y": 255.38,
      "kind": "home",
      "label": "演练集合点 4",
      "businessUse": "synthetic",
      "sourceUrl": "https://www.openstreetmap.org/node/6233434069"
    },
    {
      "id": "S2",
      "longitude": 120.6473824,
      "latitude": 27.7845418,
      "osmNodeId": 6233434070,
      "x": 569.6,
      "y": 243.75,
      "kind": "shelter",
      "label": "演练接收点 B",
      "businessUse": "synthetic",
      "sourceUrl": "https://www.openstreetmap.org/node/6233434070"
    },
    {
      "id": "O8057904982",
      "longitude": 120.6354817,
      "latitude": 27.7798581,
      "osmNodeId": 8057904982,
      "x": 156.21,
      "y": 384.26,
      "kind": "junction",
      "label": "道路节点 8057904982",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/8057904982"
    },
    {
      "id": "O8057918190",
      "longitude": 120.6333241,
      "latitude": 27.7798918,
      "osmNodeId": 8057918190,
      "x": 81.26,
      "y": 383.25,
      "kind": "junction",
      "label": "道路节点 8057918190",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/8057918190"
    },
    {
      "id": "O8057918191",
      "longitude": 120.6338981,
      "latitude": 27.7797847,
      "osmNodeId": 8057918191,
      "x": 101.2,
      "y": 386.46,
      "kind": "junction",
      "label": "道路节点 8057918191",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/8057918191"
    },
    {
      "id": "O9187568600",
      "longitude": 120.648871,
      "latitude": 27.7807573,
      "osmNodeId": 9187568600,
      "x": 621.31,
      "y": 357.28,
      "kind": "junction",
      "label": "道路节点 9187568600",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568600"
    },
    {
      "id": "O9187568602",
      "longitude": 120.6509972,
      "latitude": 27.7831162,
      "osmNodeId": 9187568602,
      "x": 695.17,
      "y": 286.51,
      "kind": "junction",
      "label": "道路节点 9187568602",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568602"
    },
    {
      "id": "O9187568616",
      "longitude": 120.6377274,
      "latitude": 27.7809104,
      "osmNodeId": 9187568616,
      "x": 234.21,
      "y": 352.69,
      "kind": "junction",
      "label": "道路节点 9187568616",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568616"
    },
    {
      "id": "O9187568617",
      "longitude": 120.6376112,
      "latitude": 27.780924,
      "osmNodeId": 9187568617,
      "x": 230.18,
      "y": 352.28,
      "kind": "junction",
      "label": "道路节点 9187568617",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568617"
    },
    {
      "id": "O9187568620",
      "longitude": 120.6414163,
      "latitude": 27.780036,
      "osmNodeId": 9187568620,
      "x": 362.36,
      "y": 378.92,
      "kind": "junction",
      "label": "道路节点 9187568620",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568620"
    },
    {
      "id": "S1",
      "longitude": 120.6401557,
      "latitude": 27.7794356,
      "osmNodeId": 9187568622,
      "x": 318.57,
      "y": 396.93,
      "kind": "shelter",
      "label": "演练接收点 A",
      "businessUse": "synthetic",
      "sourceUrl": "https://www.openstreetmap.org/node/9187568622"
    },
    {
      "id": "O9187568625",
      "longitude": 120.6424045,
      "latitude": 27.7791831,
      "osmNodeId": 9187568625,
      "x": 396.68,
      "y": 404.51,
      "kind": "junction",
      "label": "道路节点 9187568625",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568625"
    },
    {
      "id": "O9187568631",
      "longitude": 120.6408289,
      "latitude": 27.7793881,
      "osmNodeId": 9187568631,
      "x": 341.95,
      "y": 398.36,
      "kind": "junction",
      "label": "道路节点 9187568631",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568631"
    },
    {
      "id": "O9187568633",
      "longitude": 120.6408799,
      "latitude": 27.7801641,
      "osmNodeId": 9187568633,
      "x": 343.72,
      "y": 375.08,
      "kind": "junction",
      "label": "道路节点 9187568633",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568633"
    },
    {
      "id": "O9187568634",
      "longitude": 120.6410093,
      "latitude": 27.7807211,
      "osmNodeId": 9187568634,
      "x": 348.22,
      "y": 358.37,
      "kind": "junction",
      "label": "道路节点 9187568634",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568634"
    },
    {
      "id": "O9187568868",
      "longitude": 120.6467244,
      "latitude": 27.7772595,
      "osmNodeId": 9187568868,
      "x": 546.74,
      "y": 462.22,
      "kind": "junction",
      "label": "道路节点 9187568868",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568868"
    },
    {
      "id": "O9187568871",
      "longitude": 120.6486099,
      "latitude": 27.7785603,
      "osmNodeId": 9187568871,
      "x": 612.24,
      "y": 423.19,
      "kind": "junction",
      "label": "道路节点 9187568871",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568871"
    },
    {
      "id": "O9187568872",
      "longitude": 120.6485044,
      "latitude": 27.7785745,
      "osmNodeId": 9187568872,
      "x": 608.57,
      "y": 422.76,
      "kind": "junction",
      "label": "道路节点 9187568872",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568872"
    },
    {
      "id": "O9187568873",
      "longitude": 120.6477061,
      "latitude": 27.7787284,
      "osmNodeId": 9187568873,
      "x": 580.84,
      "y": 418.15,
      "kind": "junction",
      "label": "道路节点 9187568873",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568873"
    },
    {
      "id": "O9187568878",
      "longitude": 120.6471589,
      "latitude": 27.7778599,
      "osmNodeId": 9187568878,
      "x": 561.84,
      "y": 444.2,
      "kind": "junction",
      "label": "道路节点 9187568878",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568878"
    },
    {
      "id": "O9187568880",
      "longitude": 120.645968,
      "latitude": 27.7783482,
      "osmNodeId": 9187568880,
      "x": 520.47,
      "y": 429.55,
      "kind": "junction",
      "label": "道路节点 9187568880",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/9187568880"
    },
    {
      "id": "O11936844070",
      "longitude": 120.645547,
      "latitude": 27.7811993,
      "osmNodeId": 11936844070,
      "x": 505.84,
      "y": 344.02,
      "kind": "junction",
      "label": "道路节点 11936844070",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11936844070"
    },
    {
      "id": "O11936844071",
      "longitude": 120.6457571,
      "latitude": 27.7810737,
      "osmNodeId": 11936844071,
      "x": 513.14,
      "y": 347.79,
      "kind": "junction",
      "label": "道路节点 11936844071",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11936844071"
    },
    {
      "id": "O11936844072",
      "longitude": 120.6455235,
      "latitude": 27.7811063,
      "osmNodeId": 11936844072,
      "x": 505.03,
      "y": 346.81,
      "kind": "junction",
      "label": "道路节点 11936844072",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11936844072"
    },
    {
      "id": "O11939960269",
      "longitude": 120.6453182,
      "latitude": 27.7798168,
      "osmNodeId": 11939960269,
      "x": 497.9,
      "y": 385.5,
      "kind": "junction",
      "label": "道路节点 11939960269",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11939960269"
    },
    {
      "id": "O11999276309",
      "longitude": 120.645218,
      "latitude": 27.7792537,
      "osmNodeId": 11999276309,
      "x": 494.41,
      "y": 402.39,
      "kind": "junction",
      "label": "道路节点 11999276309",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11999276309"
    },
    {
      "id": "O11999276310",
      "longitude": 120.6408889,
      "latitude": 27.7801933,
      "osmNodeId": 11999276310,
      "x": 344.04,
      "y": 374.2,
      "kind": "junction",
      "label": "道路节点 11999276310",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11999276310"
    },
    {
      "id": "O11999276311",
      "longitude": 120.6409623,
      "latitude": 27.7805384,
      "osmNodeId": 11999276311,
      "x": 346.59,
      "y": 363.85,
      "kind": "junction",
      "label": "道路节点 11999276311",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11999276311"
    },
    {
      "id": "O11999276312",
      "longitude": 120.6485192,
      "latitude": 27.7787022,
      "osmNodeId": 11999276312,
      "x": 609.09,
      "y": 418.93,
      "kind": "junction",
      "label": "道路节点 11999276312",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11999276312"
    },
    {
      "id": "O11999276313",
      "longitude": 120.6486227,
      "latitude": 27.7786816,
      "osmNodeId": 11999276313,
      "x": 612.68,
      "y": 419.55,
      "kind": "junction",
      "label": "道路节点 11999276313",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11999276313"
    },
    {
      "id": "O11999276314",
      "longitude": 120.6485853,
      "latitude": 27.7791329,
      "osmNodeId": 11999276314,
      "x": 611.38,
      "y": 406.01,
      "kind": "junction",
      "label": "道路节点 11999276314",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11999276314"
    },
    {
      "id": "O11999276315",
      "longitude": 120.6486996,
      "latitude": 27.7791194,
      "osmNodeId": 11999276315,
      "x": 615.35,
      "y": 406.42,
      "kind": "junction",
      "label": "道路节点 11999276315",
      "businessUse": null,
      "sourceUrl": "https://www.openstreetmap.org/node/11999276315"
    }
  ],
  "edges": [
    {
      "id": "osm-1287029335-0",
      "from": "O11936844072",
      "to": "O11936844071",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 23.27,
      "geometry": [
        [
          120.6455235,
          27.7811063
        ],
        [
          120.6457571,
          27.7810737
        ]
      ],
      "osmWayIds": [
        1287029335
      ],
      "osmNodeIds": [
        11936844072,
        11936844071
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029335",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029336-0",
      "from": "O5306991300",
      "to": "O5306991451",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 14.77,
      "geometry": [
        [
          120.638654,
          27.7828456
        ],
        [
          120.6387903,
          27.7827898
        ]
      ],
      "osmWayIds": [
        1287029336
      ],
      "osmNodeIds": [
        5306991300,
        5306991451
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029336",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029336-1",
      "from": "O5306991451",
      "to": "O3458145817",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 274.96,
      "geometry": [
        [
          120.6387903,
          27.7827898
        ],
        [
          120.6409733,
          27.7818447
        ],
        [
          120.641301,
          27.7817032
        ]
      ],
      "osmWayIds": [
        1287029336
      ],
      "osmNodeIds": [
        5306991451,
        3458145803,
        3458145817
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029336",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029336-3",
      "from": "O3458145817",
      "to": "O3458151831",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 267.62,
      "geometry": [
        [
          120.641301,
          27.7817032
        ],
        [
          120.6418402,
          27.7816202
        ],
        [
          120.6439867,
          27.7813207
        ]
      ],
      "osmWayIds": [
        1287029336
      ],
      "osmNodeIds": [
        3458145817,
        3458145814,
        3458151831
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029336",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029336-5",
      "from": "O3458151831",
      "to": "O5306991183",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 71.64,
      "geometry": [
        [
          120.6439867,
          27.7813207
        ],
        [
          120.6447047,
          27.781213
        ]
      ],
      "osmWayIds": [
        1287029336
      ],
      "osmNodeIds": [
        3458151831,
        5306991183
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029336",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029336-6",
      "from": "O5306991183",
      "to": "O5306991190",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 29.09,
      "geometry": [
        [
          120.6447047,
          27.781213
        ],
        [
          120.644998,
          27.7811796
        ]
      ],
      "osmWayIds": [
        1287029336
      ],
      "osmNodeIds": [
        5306991183,
        5306991190
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029336",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029336-7",
      "from": "O5306991190",
      "to": "O11936844072",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 52.34,
      "geometry": [
        [
          120.644998,
          27.7811796
        ],
        [
          120.6455235,
          27.7811063
        ]
      ],
      "osmWayIds": [
        1287029336
      ],
      "osmNodeIds": [
        5306991190,
        11936844072
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029336",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029337-0",
      "from": "O3458145812",
      "to": "O11936844070",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 24.0,
      "geometry": [
        [
          120.6457878,
          27.7811648
        ],
        [
          120.645547,
          27.7811993
        ]
      ],
      "osmWayIds": [
        1287029337
      ],
      "osmNodeIds": [
        3458145812,
        11936844070
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029337",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029338-0",
      "from": "O11936844070",
      "to": "O5306991189",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 45.03,
      "geometry": [
        [
          120.645547,
          27.7811993
        ],
        [
          120.6450952,
          27.781264
        ]
      ],
      "osmWayIds": [
        1287029338
      ],
      "osmNodeIds": [
        11936844070,
        5306991189
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029338",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029338-1",
      "from": "O5306991189",
      "to": "O5306991182",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 30.46,
      "geometry": [
        [
          120.6450952,
          27.781264
        ],
        [
          120.6447905,
          27.7813127
        ]
      ],
      "osmWayIds": [
        1287029338
      ],
      "osmNodeIds": [
        5306991189,
        5306991182
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029338",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029338-2",
      "from": "O5306991182",
      "to": "O3458151823",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 58.7,
      "geometry": [
        [
          120.6447905,
          27.7813127
        ],
        [
          120.6442015,
          27.7813972
        ]
      ],
      "osmWayIds": [
        1287029338
      ],
      "osmNodeIds": [
        5306991182,
        3458151823
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029338",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029338-3",
      "from": "O3458151823",
      "to": "O3458145819",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 284.76,
      "geometry": [
        [
          120.6442015,
          27.7813972
        ],
        [
          120.6440015,
          27.781427
        ],
        [
          120.641845,
          27.7817213
        ],
        [
          120.6413435,
          27.7818019
        ]
      ],
      "osmWayIds": [
        1287029338
      ],
      "osmNodeIds": [
        3458151823,
        3458145806,
        3458145808,
        3458145819
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029338",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029338-6",
      "from": "O3458145819",
      "to": "O5306991452",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 274.81,
      "geometry": [
        [
          120.6413435,
          27.7818019
        ],
        [
          120.6410189,
          27.7819539
        ],
        [
          120.6388492,
          27.7829145
        ]
      ],
      "osmWayIds": [
        1287029338
      ],
      "osmNodeIds": [
        3458145819,
        3458145811,
        5306991452
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029338",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287029338-8",
      "from": "O5306991452",
      "to": "O5306991299",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 15.69,
      "geometry": [
        [
          120.6388492,
          27.7829145
        ],
        [
          120.6387095,
          27.7829825
        ]
      ],
      "osmWayIds": [
        1287029338
      ],
      "osmNodeIds": [
        5306991452,
        5306991299
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287029338",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287425382-0",
      "from": "O5306991218",
      "to": "O11939960269",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 2,
      "lengthMeters": 285.9,
      "geometry": [
        [
          120.6481755,
          27.7793478
        ],
        [
          120.6453182,
          27.7798168
        ]
      ],
      "osmWayIds": [
        1287425382
      ],
      "osmNodeIds": [
        5306991218,
        11939960269
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287425382",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1287425383-0",
      "from": "O5306991219",
      "to": "O11939960269",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 48.73,
      "geometry": [
        [
          120.6448361,
          27.7799173
        ],
        [
          120.6453182,
          27.7798168
        ]
      ],
      "osmWayIds": [
        1287425383
      ],
      "osmNodeIds": [
        5306991219,
        11939960269
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1287425383",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774630-0",
      "from": "O11936844071",
      "to": "O3458145804",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 301.75,
      "geometry": [
        [
          120.6457571,
          27.7810737
        ],
        [
          120.6471022,
          27.780886
        ],
        [
          120.6487914,
          27.7806779
        ]
      ],
      "osmWayIds": [
        1294774630
      ],
      "osmNodeIds": [
        11936844071,
        3458145802,
        3458145804
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774630",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774630-2",
      "from": "O3458145804",
      "to": "O3458145822",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 10.9,
      "geometry": [
        [
          120.6487914,
          27.7806779
        ],
        [
          120.6489009,
          27.7806627
        ]
      ],
      "osmWayIds": [
        1294774630
      ],
      "osmNodeIds": [
        3458145804,
        3458145822
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774630",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774631-2",
      "from": "O3458135061",
      "to": "O9187568600",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 4.38,
      "geometry": [
        [
          120.6489153,
          27.7807531
        ],
        [
          120.648871,
          27.7807573
        ]
      ],
      "osmWayIds": [
        1294774631
      ],
      "osmNodeIds": [
        3458135061,
        9187568600
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774631",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774631-3",
      "from": "O9187568600",
      "to": "O3458135047",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 6.32,
      "geometry": [
        [
          120.648871,
          27.7807573
        ],
        [
          120.6488075,
          27.7807659
        ]
      ],
      "osmWayIds": [
        1294774631
      ],
      "osmNodeIds": [
        9187568600,
        3458135047
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774631",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774631-4",
      "from": "O3458135047",
      "to": "O3458145812",
      "label": "万松东路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 300.39,
      "geometry": [
        [
          120.6488075,
          27.7807659
        ],
        [
          120.6471129,
          27.7809714
        ],
        [
          120.6457878,
          27.7811648
        ]
      ],
      "osmWayIds": [
        1294774631
      ],
      "osmNodeIds": [
        3458135047,
        3458145809,
        3458145812
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774631",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774910-0",
      "from": "H5",
      "to": "O11999276309",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 41.41,
      "geometry": [
        [
          120.6456327,
          27.77919
        ],
        [
          120.645218,
          27.7792537
        ]
      ],
      "osmWayIds": [
        1294774910
      ],
      "osmNodeIds": [
        5306991173,
        11999276309
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774910",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774911-0",
      "from": "O5306991165",
      "to": "O11999276309",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 232.61,
      "geometry": [
        [
          120.6428953,
          27.7796414
        ],
        [
          120.6438115,
          27.7794641
        ],
        [
          120.6441253,
          27.7794214
        ],
        [
          120.645218,
          27.7792537
        ]
      ],
      "osmWayIds": [
        1294774911
      ],
      "osmNodeIds": [
        5306991165,
        5306991171,
        5306991172,
        11999276309
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774911",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774911-3",
      "from": "O5306991165",
      "to": "O5306991170",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 31.93,
      "geometry": [
        [
          120.6428953,
          27.7796414
        ],
        [
          120.6425857,
          27.7797275
        ]
      ],
      "osmWayIds": [
        1294774911
      ],
      "osmNodeIds": [
        5306991165,
        5306991170
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774911",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774912-0",
      "from": "O11999276310",
      "to": "O11999276311",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 39.05,
      "geometry": [
        [
          120.6408889,
          27.7801933
        ],
        [
          120.6409623,
          27.7805384
        ]
      ],
      "osmWayIds": [
        1294774912
      ],
      "osmNodeIds": [
        11999276310,
        11999276311
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774912",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774913-0",
      "from": "O9187568633",
      "to": "O11999276310",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 3.37,
      "geometry": [
        [
          120.6408799,
          27.7801641
        ],
        [
          120.6408889,
          27.7801933
        ]
      ],
      "osmWayIds": [
        1294774913
      ],
      "osmNodeIds": [
        9187568633,
        11999276310
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774913",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774913-1",
      "from": "O9187568631",
      "to": "O9187568633",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 86.46,
      "geometry": [
        [
          120.6408289,
          27.7793881
        ],
        [
          120.640845,
          27.7797845
        ],
        [
          120.6408799,
          27.7801641
        ]
      ],
      "osmWayIds": [
        1294774913
      ],
      "osmNodeIds": [
        9187568631,
        9187568632,
        9187568633
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774913",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774914-0",
      "from": "O11999276314",
      "to": "O11999276312",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 48.33,
      "geometry": [
        [
          120.6485853,
          27.7791329
        ],
        [
          120.6485192,
          27.7787022
        ]
      ],
      "osmWayIds": [
        1294774914
      ],
      "osmNodeIds": [
        11999276314,
        11999276312
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774914",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774915-0",
      "from": "O11999276313",
      "to": "O11999276315",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 49.27,
      "geometry": [
        [
          120.6486227,
          27.7786816
        ],
        [
          120.6486996,
          27.7791194
        ]
      ],
      "osmWayIds": [
        1294774915
      ],
      "osmNodeIds": [
        11999276313,
        11999276315
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774915",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774916-0",
      "from": "O3458135047",
      "to": "O3458145804",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 9.91,
      "geometry": [
        [
          120.6488075,
          27.7807659
        ],
        [
          120.6487914,
          27.7806779
        ]
      ],
      "osmWayIds": [
        1294774916
      ],
      "osmNodeIds": [
        3458135047,
        3458145804
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774916",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774916-1",
      "from": "O3458145804",
      "to": "O11999276314",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 172.99,
      "geometry": [
        [
          120.6487914,
          27.7806779
        ],
        [
          120.6485853,
          27.7791329
        ]
      ],
      "osmWayIds": [
        1294774916
      ],
      "osmNodeIds": [
        3458145804,
        11999276314
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774916",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774917-0",
      "from": "O11999276315",
      "to": "O3458145822",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 172.75,
      "geometry": [
        [
          120.6486996,
          27.7791194
        ],
        [
          120.6489009,
          27.7806627
        ]
      ],
      "osmWayIds": [
        1294774917
      ],
      "osmNodeIds": [
        11999276315,
        3458145822
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774917",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1294774917-1",
      "from": "O3458145822",
      "to": "O3458135061",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 10.15,
      "geometry": [
        [
          120.6489009,
          27.7806627
        ],
        [
          120.6489153,
          27.7807531
        ]
      ],
      "osmWayIds": [
        1294774917
      ],
      "osmNodeIds": [
        3458145822,
        3458135061
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1294774917",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-1318379204-0",
      "from": "O9187568634",
      "to": "O11999276311",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 20.83,
      "geometry": [
        [
          120.6410093,
          27.7807211
        ],
        [
          120.6409623,
          27.7805384
        ]
      ],
      "osmWayIds": [
        1318379204
      ],
      "osmNodeIds": [
        9187568634,
        11999276311
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/1318379204",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-277621411-0",
      "from": "O5306991483",
      "to": "H2",
      "label": "瑞湖路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 256.24,
      "geometry": [
        [
          120.6394703,
          27.7841888
        ],
        [
          120.6384659,
          27.786315
        ]
      ],
      "osmWayIds": [
        277621411
      ],
      "osmNodeIds": [
        5306991483,
        5306991484
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/277621411",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-277621411-1",
      "from": "H2",
      "to": "O5306991292",
      "label": "瑞湖路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 190.53,
      "geometry": [
        [
          120.6384659,
          27.786315
        ],
        [
          120.638144,
          27.7866567
        ],
        [
          120.6369826,
          27.7874009
        ]
      ],
      "osmWayIds": [
        277621411
      ],
      "osmNodeIds": [
        5306991484,
        5306991485,
        5306991292
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/277621411",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-277621411-3",
      "from": "O5306991292",
      "to": "O5306991227",
      "label": "瑞湖路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 231.7,
      "geometry": [
        [
          120.6369826,
          27.7874009
        ],
        [
          120.6350751,
          27.7886232
        ]
      ],
      "osmWayIds": [
        277621411
      ],
      "osmNodeIds": [
        5306991292,
        5306991227
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/277621411",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-338689106-0",
      "from": "O11999276312",
      "to": "O9187568872",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 14.27,
      "geometry": [
        [
          120.6485192,
          27.7787022
        ],
        [
          120.6485044,
          27.7785745
        ]
      ],
      "osmWayIds": [
        338689106
      ],
      "osmNodeIds": [
        11999276312,
        9187568872
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/338689106",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-338689106-1",
      "from": "O9187568872",
      "to": "O3458135305",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 128.19,
      "geometry": [
        [
          120.6485044,
          27.7785745
        ],
        [
          120.6482716,
          27.7774402
        ]
      ],
      "osmWayIds": [
        338689106
      ],
      "osmNodeIds": [
        9187568872,
        3458135305
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/338689106",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-338689110-20",
      "from": "O3458135293",
      "to": "O9187568871",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 130.75,
      "geometry": [
        [
          120.6483789,
          27.7774023
        ],
        [
          120.6486099,
          27.7785603
        ]
      ],
      "osmWayIds": [
        338689110
      ],
      "osmNodeIds": [
        3458135293,
        9187568871
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/338689110",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-338689110-21",
      "from": "O9187568871",
      "to": "O11999276313",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 13.55,
      "geometry": [
        [
          120.6486099,
          27.7785603
        ],
        [
          120.6486227,
          27.7786816
        ]
      ],
      "osmWayIds": [
        338689110
      ],
      "osmNodeIds": [
        9187568871,
        11999276313
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/338689110",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-338690183-0",
      "from": "O3458151831",
      "to": "O5306991207",
      "label": "未命名道路",
      "highway": "primary_link",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 16.87,
      "geometry": [
        [
          120.6439867,
          27.7813207
        ],
        [
          120.6440945,
          27.7812027
        ]
      ],
      "osmWayIds": [
        338690183
      ],
      "osmNodeIds": [
        3458151831,
        5306991207
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/338690183",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-338690183-1",
      "from": "O5306991207",
      "to": "O3458151830",
      "label": "未命名道路",
      "highway": "primary_link",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 59.29,
      "geometry": [
        [
          120.6440945,
          27.7812027
        ],
        [
          120.644141,
          27.7811517
        ],
        [
          120.6442161,
          27.7809809
        ],
        [
          120.6442161,
          27.7808765
        ],
        [
          120.6441827,
          27.7806989
        ]
      ],
      "osmWayIds": [
        338690183
      ],
      "osmNodeIds": [
        5306991207,
        3458151796,
        3458151825,
        3458151798,
        3458151830
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/338690183",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-338690185-0",
      "from": "O3458151392",
      "to": "O3458151823",
      "label": "未命名道路",
      "highway": "primary_link",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 110.89,
      "geometry": [
        [
          120.6452329,
          27.7817442
        ],
        [
          120.64487,
          27.7815319
        ],
        [
          120.6447204,
          27.781465
        ],
        [
          120.6445165,
          27.7814365
        ],
        [
          120.6442015,
          27.7813972
        ]
      ],
      "osmWayIds": [
        338690185
      ],
      "osmNodeIds": [
        3458151392,
        3458151810,
        3458151805,
        3458151820,
        3458151823
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/338690185",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-339005819-0",
      "from": "O3461903687",
      "to": "O9187568880",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 87.94,
      "geometry": [
        [
          120.6464802,
          27.7789964
        ],
        [
          120.645968,
          27.7783482
        ]
      ],
      "osmWayIds": [
        339005819
      ],
      "osmNodeIds": [
        3461903687,
        9187568880
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/339005819",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400199-0",
      "from": "O5306991169",
      "to": "O9187568625",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 11.71,
      "geometry": [
        [
          120.6424241,
          27.7790792
        ],
        [
          120.6424045,
          27.7791831
        ]
      ],
      "osmWayIds": [
        549400199
      ],
      "osmNodeIds": [
        5306991169,
        9187568625
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400199",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400199-1",
      "from": "O5306991165",
      "to": "O9187568625",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 70.8,
      "geometry": [
        [
          120.6428953,
          27.7796414
        ],
        [
          120.6427708,
          27.779502
        ],
        [
          120.6426394,
          27.7794237
        ],
        [
          120.6424356,
          27.7792291
        ],
        [
          120.6424045,
          27.7791831
        ]
      ],
      "osmWayIds": [
        549400199
      ],
      "osmNodeIds": [
        5306991165,
        5306991166,
        5306991167,
        5306991168,
        9187568625
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400199",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400200-0",
      "from": "O9187568871",
      "to": "O9187568872",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 10.5,
      "geometry": [
        [
          120.6486099,
          27.7785603
        ],
        [
          120.6485044,
          27.7785745
        ]
      ],
      "osmWayIds": [
        549400200
      ],
      "osmNodeIds": [
        9187568871,
        9187568872
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400200",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400200-1",
      "from": "O9187568872",
      "to": "O9187568873",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 80.38,
      "geometry": [
        [
          120.6485044,
          27.7785745
        ],
        [
          120.6477061,
          27.7787284
        ]
      ],
      "osmWayIds": [
        549400200
      ],
      "osmNodeIds": [
        9187568872,
        9187568873
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400200",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400200-2",
      "from": "O3461903687",
      "to": "O9187568873",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 124.23,
      "geometry": [
        [
          120.6464802,
          27.7789964
        ],
        [
          120.6477061,
          27.7787284
        ]
      ],
      "osmWayIds": [
        549400200
      ],
      "osmNodeIds": [
        3461903687,
        9187568873
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400200",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400200-3",
      "from": "O3461903687",
      "to": "H5",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 86.11,
      "geometry": [
        [
          120.6464802,
          27.7789964
        ],
        [
          120.6456327,
          27.77919
        ]
      ],
      "osmWayIds": [
        549400200
      ],
      "osmNodeIds": [
        3461903687,
        5306991173
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400200",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400201-0",
      "from": "O5306991174",
      "to": "O5306991212",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 70.64,
      "geometry": [
        [
          120.6429153,
          27.7802924
        ],
        [
          120.6431785,
          27.7803113
        ],
        [
          120.6433314,
          27.7802994
        ],
        [
          120.6436318,
          27.7803042
        ]
      ],
      "osmWayIds": [
        549400201
      ],
      "osmNodeIds": [
        5306991174,
        5306991175,
        5306991176,
        5306991212
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400201",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400203-0",
      "from": "O5306991178",
      "to": "O5306991214",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 88.8,
      "geometry": [
        [
          120.6435661,
          27.7802211
        ],
        [
          120.6431678,
          27.7797987
        ],
        [
          120.6429747,
          27.7796183
        ]
      ],
      "osmWayIds": [
        549400203
      ],
      "osmNodeIds": [
        5306991178,
        5306991213,
        5306991214
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400203",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400205-0",
      "from": "O5306991169",
      "to": "O5306991215",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 92.4,
      "geometry": [
        [
          120.6424241,
          27.7790792
        ],
        [
          120.6417945,
          27.7784626
        ]
      ],
      "osmWayIds": [
        549400205
      ],
      "osmNodeIds": [
        5306991169,
        5306991215
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400205",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400205-1",
      "from": "O5306991169",
      "to": "O5306991214",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 80.79,
      "geometry": [
        [
          120.6424241,
          27.7790792
        ],
        [
          120.6429747,
          27.7796183
        ]
      ],
      "osmWayIds": [
        549400205
      ],
      "osmNodeIds": [
        5306991169,
        5306991214
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400205",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400206-0",
      "from": "O5306991179",
      "to": "O5306991191",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 118.66,
      "geometry": [
        [
          120.6431893,
          27.7793727
        ],
        [
          120.6439904,
          27.7801704
        ]
      ],
      "osmWayIds": [
        549400206
      ],
      "osmNodeIds": [
        5306991179,
        5306991191
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400206",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400209-0",
      "from": "O5306991181",
      "to": "O5306991217",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 105.97,
      "geometry": [
        [
          120.6437498,
          27.7802579
        ],
        [
          120.6430323,
          27.7795471
        ]
      ],
      "osmWayIds": [
        549400209
      ],
      "osmNodeIds": [
        5306991181,
        5306991217
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400209",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400214-11",
      "from": "O5306991193",
      "to": "O5306991179",
      "label": "瑞祥大道",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 258.07,
      "geometry": [
        [
          120.6414799,
          27.7776123
        ],
        [
          120.642162,
          27.7783274
        ],
        [
          120.6431893,
          27.7793727
        ]
      ],
      "osmWayIds": [
        549400214
      ],
      "osmNodeIds": [
        5306991193,
        5306991192,
        5306991179
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400214",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400218-0",
      "from": "O5306991178",
      "to": "O5306991212",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 11.28,
      "geometry": [
        [
          120.6435661,
          27.7802211
        ],
        [
          120.6436318,
          27.7803042
        ]
      ],
      "osmWayIds": [
        549400218
      ],
      "osmNodeIds": [
        5306991178,
        5306991212
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400218",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400218-1",
      "from": "O5306991207",
      "to": "O5306991212",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 115.4,
      "geometry": [
        [
          120.6440945,
          27.7812027
        ],
        [
          120.6440395,
          27.7810778
        ],
        [
          120.6440207,
          27.7808761
        ],
        [
          120.6438893,
          27.7807313
        ],
        [
          120.6436157,
          27.7804418
        ],
        [
          120.6436318,
          27.7803042
        ]
      ],
      "osmWayIds": [
        549400218
      ],
      "osmNodeIds": [
        5306991207,
        5306991208,
        5306991209,
        5306991210,
        5306991211,
        5306991212
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400218",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400221-0",
      "from": "O5306991223",
      "to": "O5306991224",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 10.39,
      "geometry": [
        [
          120.6378279,
          27.7812028
        ],
        [
          120.637726,
          27.7812273
        ]
      ],
      "osmWayIds": [
        549400221
      ],
      "osmNodeIds": [
        5306991223,
        5306991224
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400221",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400221-1",
      "from": "O5306991223",
      "to": "O9187568634",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 2,
      "lengthMeters": 319.61,
      "geometry": [
        [
          120.6378279,
          27.7812028
        ],
        [
          120.6388521,
          27.7809757
        ],
        [
          120.638946,
          27.7810137
        ],
        [
          120.6410093,
          27.7807211
        ]
      ],
      "osmWayIds": [
        549400221
      ],
      "osmNodeIds": [
        5306991223,
        5306991222,
        9187568610,
        9187568634
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400221",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400221-4",
      "from": "O5306991174",
      "to": "O9187568634",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 193.59,
      "geometry": [
        [
          120.6429153,
          27.7802924
        ],
        [
          120.6420413,
          27.7805201
        ],
        [
          120.6410093,
          27.7807211
        ]
      ],
      "osmWayIds": [
        549400221
      ],
      "osmNodeIds": [
        5306991174,
        5306991221,
        9187568634
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400221",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400221-6",
      "from": "O5306991174",
      "to": "O5306991219",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 195.25,
      "geometry": [
        [
          120.6429153,
          27.7802924
        ],
        [
          120.6430578,
          27.7802306
        ],
        [
          120.6441065,
          27.7799506
        ],
        [
          120.6448361,
          27.7799173
        ]
      ],
      "osmWayIds": [
        549400221
      ],
      "osmNodeIds": [
        5306991174,
        5306991177,
        5306991220,
        5306991219
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400221",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400230-0",
      "from": "O5306991280",
      "to": "H1",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 180.53,
      "geometry": [
        [
          120.6342516,
          27.7869558
        ],
        [
          120.6350278,
          27.788427
        ]
      ],
      "osmWayIds": [
        549400230
      ],
      "osmNodeIds": [
        5306991280,
        5306991281
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400230",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400230-1",
      "from": "O5306991279",
      "to": "O5306991280",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 236.78,
      "geometry": [
        [
          120.6333559,
          27.7849793
        ],
        [
          120.6342516,
          27.7869558
        ]
      ],
      "osmWayIds": [
        549400230
      ],
      "osmNodeIds": [
        5306991279,
        5306991280
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400230",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400230-2",
      "from": "O5306991279",
      "to": "O5306991469",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 14.38,
      "geometry": [
        [
          120.6333559,
          27.7849793
        ],
        [
          120.6333053,
          27.784858
        ]
      ],
      "osmWayIds": [
        549400230
      ],
      "osmNodeIds": [
        5306991279,
        5306991469
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400230",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400231-6",
      "from": "O5306991280",
      "to": "O5306991290",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 213.94,
      "geometry": [
        [
          120.6342516,
          27.7869558
        ],
        [
          120.6347859,
          27.7867706
        ],
        [
          120.6362953,
          27.7862985
        ]
      ],
      "osmWayIds": [
        549400231
      ],
      "osmNodeIds": [
        5306991280,
        5306991291,
        5306991290
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400231",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400231-8",
      "from": "O5306991287",
      "to": "O5306991290",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 2,
      "lengthMeters": 352.41,
      "geometry": [
        [
          120.6371785,
          27.7836468
        ],
        [
          120.6374895,
          27.7842173
        ],
        [
          120.6370067,
          27.7860112
        ],
        [
          120.6362953,
          27.7862985
        ]
      ],
      "osmWayIds": [
        549400231
      ],
      "osmNodeIds": [
        5306991287,
        5306991288,
        5306991289,
        5306991290
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400231",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400232-0",
      "from": "O5306991225",
      "to": "O5306991467",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 2,
      "lengthMeters": 272.72,
      "geometry": [
        [
          120.6351909,
          27.7817351
        ],
        [
          120.6357723,
          27.7841332
        ]
      ],
      "osmWayIds": [
        549400232
      ],
      "osmNodeIds": [
        5306991225,
        5306991467
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400232",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400232-1",
      "from": "O5306991296",
      "to": "O5306991467",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 10.4,
      "geometry": [
        [
          120.6357954,
          27.7842245
        ],
        [
          120.6357723,
          27.7841332
        ]
      ],
      "osmWayIds": [
        549400232
      ],
      "osmNodeIds": [
        5306991296,
        5306991467
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400232",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400232-2",
      "from": "O5306991290",
      "to": "O5306991296",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 235.98,
      "geometry": [
        [
          120.6362953,
          27.7862985
        ],
        [
          120.6359339,
          27.7849861
        ],
        [
          120.6357954,
          27.7842245
        ]
      ],
      "osmWayIds": [
        549400232
      ],
      "osmNodeIds": [
        5306991290,
        5306991295,
        5306991296
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400232",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400232-4",
      "from": "O5306991290",
      "to": "O5306991293",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 123.29,
      "geometry": [
        [
          120.6362953,
          27.7862985
        ],
        [
          120.6364488,
          27.786856
        ],
        [
          120.6368127,
          27.7872833
        ]
      ],
      "osmWayIds": [
        549400232
      ],
      "osmNodeIds": [
        5306991290,
        5306991294,
        5306991293
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400232",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400232-6",
      "from": "O5306991292",
      "to": "O5306991293",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 21.22,
      "geometry": [
        [
          120.6369826,
          27.7874009
        ],
        [
          120.6368127,
          27.7872833
        ]
      ],
      "osmWayIds": [
        549400232
      ],
      "osmNodeIds": [
        5306991292,
        5306991293
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400232",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400233-0",
      "from": "O5306991298",
      "to": "O5306991299",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 114.05,
      "geometry": [
        [
          120.6393113,
          27.7838592
        ],
        [
          120.6387095,
          27.7829825
        ]
      ],
      "osmWayIds": [
        549400233
      ],
      "osmNodeIds": [
        5306991298,
        5306991299
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400233",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400233-1",
      "from": "O5306991299",
      "to": "O5306991300",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 16.17,
      "geometry": [
        [
          120.6387095,
          27.7829825
        ],
        [
          120.638654,
          27.7828456
        ]
      ],
      "osmWayIds": [
        549400233
      ],
      "osmNodeIds": [
        5306991299,
        5306991300
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400233",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400233-2",
      "from": "O5306991300",
      "to": "O5306991224",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 201.9,
      "geometry": [
        [
          120.638654,
          27.7828456
        ],
        [
          120.6380481,
          27.7818565
        ],
        [
          120.637726,
          27.7812273
        ]
      ],
      "osmWayIds": [
        549400233
      ],
      "osmNodeIds": [
        5306991300,
        5306991304,
        5306991224
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400233",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400233-4",
      "from": "O5306991224",
      "to": "O9187568617",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 35.57,
      "geometry": [
        [
          120.637726,
          27.7812273
        ],
        [
          120.6376112,
          27.780924
        ]
      ],
      "osmWayIds": [
        549400233
      ],
      "osmNodeIds": [
        5306991224,
        9187568617
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400233",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400233-5",
      "from": "O9187568617",
      "to": "O3461903693",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 211.32,
      "geometry": [
        [
          120.6376112,
          27.780924
        ],
        [
          120.6374761,
          27.7805676
        ],
        [
          120.637317,
          27.7803409
        ],
        [
          120.6368599,
          27.7800843
        ],
        [
          120.6366279,
          27.780033
        ],
        [
          120.6359982,
          27.7799266
        ]
      ],
      "osmWayIds": [
        549400233
      ],
      "osmNodeIds": [
        9187568617,
        9187568619,
        5306991303,
        5306991302,
        5306991301,
        3461903693
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400233",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400236-0",
      "from": "O8057904982",
      "to": "O8057918191",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 2,
      "lengthMeters": 279.66,
      "geometry": [
        [
          120.6354817,
          27.7798581
        ],
        [
          120.6353148,
          27.7801734
        ],
        [
          120.6352058,
          27.7803575
        ],
        [
          120.635128,
          27.7804615
        ],
        [
          120.6346933,
          27.780583
        ],
        [
          120.6346834,
          27.780499
        ],
        [
          120.634166,
          27.7806239
        ],
        [
          120.6338981,
          27.7797847
        ]
      ],
      "osmWayIds": [
        549400236
      ],
      "osmNodeIds": [
        8057904982,
        8057904981,
        8057904980,
        8057904979,
        8057904978,
        8057904977,
        5306991319,
        8057918191
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400236",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400236-7",
      "from": "O5306991318",
      "to": "O8057918191",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 111.18,
      "geometry": [
        [
          120.633591,
          27.7788225
        ],
        [
          120.6338981,
          27.7797847
        ]
      ],
      "osmWayIds": [
        549400236
      ],
      "osmNodeIds": [
        5306991318,
        8057918191
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400236",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400238-3",
      "from": "O5306991318",
      "to": "O5306991345",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 99.62,
      "geometry": [
        [
          120.633591,
          27.7788225
        ],
        [
          120.6342816,
          27.7786454
        ],
        [
          120.6345669,
          27.7785843
        ]
      ],
      "osmWayIds": [
        549400238
      ],
      "osmNodeIds": [
        5306991318,
        5306991346,
        5306991345
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400238",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400249-0",
      "from": "O5306991217",
      "to": "O3461903671",
      "label": "瑞祥大道",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 269.48,
      "geometry": [
        [
          120.6430323,
          27.7795471
        ],
        [
          120.6414407,
          27.7779504
        ],
        [
          120.6412224,
          27.777728
        ]
      ],
      "osmWayIds": [
        549400249
      ],
      "osmNodeIds": [
        5306991217,
        2173827651,
        3461903671
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400249",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400250-0",
      "from": "O5306991460",
      "to": "O5306991298",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 24.14,
      "geometry": [
        [
          120.639264,
          27.7840604
        ],
        [
          120.6392575,
          27.783923
        ],
        [
          120.6393113,
          27.7838592
        ]
      ],
      "osmWayIds": [
        549400250
      ],
      "osmNodeIds": [
        5306991460,
        5306991450,
        5306991298
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400250",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400250-1",
      "from": "O5306991298",
      "to": "O5306991453",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 14.2,
      "geometry": [
        [
          120.6393113,
          27.7838592
        ],
        [
          120.6394322,
          27.7837895
        ]
      ],
      "osmWayIds": [
        549400250
      ],
      "osmNodeIds": [
        5306991298,
        5306991453
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400250",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400250-2",
      "from": "O5306991453",
      "to": "O5306991454",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 22.34,
      "geometry": [
        [
          120.6394322,
          27.7837895
        ],
        [
          120.639502,
          27.7837793
        ],
        [
          120.6396433,
          27.7838384
        ]
      ],
      "osmWayIds": [
        549400250
      ],
      "osmNodeIds": [
        5306991453,
        5306991449,
        5306991454
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400250",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400250-4",
      "from": "O5306991454",
      "to": "O5306991483",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 53.23,
      "geometry": [
        [
          120.6396433,
          27.7838384
        ],
        [
          120.639711,
          27.7839943
        ],
        [
          120.6396357,
          27.7841352
        ],
        [
          120.6394703,
          27.7841888
        ]
      ],
      "osmWayIds": [
        549400250
      ],
      "osmNodeIds": [
        5306991454,
        5306991455,
        5306991448,
        5306991483
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400250",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400250-7",
      "from": "O5306991483",
      "to": "O5306991460",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 25.87,
      "geometry": [
        [
          120.6394703,
          27.7841888
        ],
        [
          120.6393457,
          27.7841515
        ],
        [
          120.639264,
          27.7840604
        ]
      ],
      "osmWayIds": [
        549400250
      ],
      "osmNodeIds": [
        5306991483,
        5306991447,
        5306991460
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400250",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400251-0",
      "from": "H6",
      "to": "O9187568616",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 185.75,
      "geometry": [
        [
          120.6365059,
          27.7797536
        ],
        [
          120.6366849,
          27.7799553
        ],
        [
          120.6368995,
          27.7800028
        ],
        [
          120.6374601,
          27.7803469
        ],
        [
          120.637621,
          27.7806008
        ],
        [
          120.6377274,
          27.7809104
        ]
      ],
      "osmWayIds": [
        549400251
      ],
      "osmNodeIds": [
        5306991307,
        5306991308,
        5306991309,
        5306991310,
        9187568618,
        9187568616
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400251",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400251-5",
      "from": "O9187568616",
      "to": "O5306991223",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 33.98,
      "geometry": [
        [
          120.6377274,
          27.7809104
        ],
        [
          120.6378279,
          27.7812028
        ]
      ],
      "osmWayIds": [
        549400251
      ],
      "osmNodeIds": [
        9187568616,
        5306991223
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400251",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400251-6",
      "from": "O5306991223",
      "to": "O5306991451",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 200.79,
      "geometry": [
        [
          120.6378279,
          27.7812028
        ],
        [
          120.6381117,
          27.7818033
        ],
        [
          120.6387903,
          27.7827898
        ]
      ],
      "osmWayIds": [
        549400251
      ],
      "osmNodeIds": [
        5306991223,
        5306991311,
        5306991451
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400251",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400251-8",
      "from": "O5306991451",
      "to": "O5306991452",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 15.03,
      "geometry": [
        [
          120.6387903,
          27.7827898
        ],
        [
          120.6388492,
          27.7829145
        ]
      ],
      "osmWayIds": [
        549400251
      ],
      "osmNodeIds": [
        5306991451,
        5306991452
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400251",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400251-9",
      "from": "O5306991452",
      "to": "O5306991453",
      "label": "商城大道",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 112.94,
      "geometry": [
        [
          120.6388492,
          27.7829145
        ],
        [
          120.6394322,
          27.7837895
        ]
      ],
      "osmWayIds": [
        549400251
      ],
      "osmNodeIds": [
        5306991452,
        5306991453
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400251",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400253-13",
      "from": "H1",
      "to": "O5306991293",
      "label": "瑞湖路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 216.8,
      "geometry": [
        [
          120.6350278,
          27.788427
        ],
        [
          120.6368127,
          27.7872833
        ]
      ],
      "osmWayIds": [
        549400253
      ],
      "osmNodeIds": [
        5306991281,
        5306991293
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400253",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400253-14",
      "from": "O5306991293",
      "to": "O5306991460",
      "label": "瑞湖路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 446.76,
      "geometry": [
        [
          120.6368127,
          27.7872833
        ],
        [
          120.6380013,
          27.7865216
        ],
        [
          120.6382873,
          27.786218
        ],
        [
          120.639264,
          27.7840604
        ]
      ],
      "osmWayIds": [
        549400253
      ],
      "osmNodeIds": [
        5306991293,
        5306991462,
        5306991461,
        5306991460
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400253",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400254-0",
      "from": "O5306991454",
      "to": "H3",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 3,
      "lengthMeters": 739.76,
      "geometry": [
        [
          120.6396433,
          27.7838384
        ],
        [
          120.6400305,
          27.7838336
        ],
        [
          120.6407866,
          27.7837565
        ],
        [
          120.6415401,
          27.7837329
        ],
        [
          120.6470796,
          27.7845579
        ]
      ],
      "osmWayIds": [
        549400254
      ],
      "osmNodeIds": [
        5306991454,
        5306991459,
        9127821630,
        5306991458,
        5306991457
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400254",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400254-4",
      "from": "H3",
      "to": "S2",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 30.69,
      "geometry": [
        [
          120.6470796,
          27.7845579
        ],
        [
          120.6472475,
          27.7845812
        ],
        [
          120.6473824,
          27.7845418
        ]
      ],
      "osmWayIds": [
        549400254
      ],
      "osmNodeIds": [
        5306991457,
        5306991456,
        6233434070
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400254",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-549400254-6",
      "from": "S2",
      "to": "O5306991464",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 23.72,
      "geometry": [
        [
          120.6473824,
          27.7845418
        ],
        [
          120.6475284,
          27.784372
        ]
      ],
      "osmWayIds": [
        549400254
      ],
      "osmNodeIds": [
        6233434070,
        5306991464
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/549400254",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-665889274-0",
      "from": "O5306991191",
      "to": "O5306991190",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 149.74,
      "geometry": [
        [
          120.6439904,
          27.7801704
        ],
        [
          120.644422,
          27.7806075
        ],
        [
          120.6448536,
          27.7810445
        ],
        [
          120.644998,
          27.7811796
        ]
      ],
      "osmWayIds": [
        665889274
      ],
      "osmNodeIds": [
        5306991191,
        6233434066,
        5306991180,
        5306991190
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/665889274",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-665889274-3",
      "from": "O5306991190",
      "to": "O5306991189",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 13.4,
      "geometry": [
        [
          120.644998,
          27.7811796
        ],
        [
          120.6450952,
          27.781264
        ]
      ],
      "osmWayIds": [
        665889274
      ],
      "osmNodeIds": [
        5306991190,
        5306991189
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/665889274",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-665889276-0",
      "from": "O5306991464",
      "to": "H4",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 24.37,
      "geometry": [
        [
          120.6475284,
          27.784372
        ],
        [
          120.6475029,
          27.784154
        ]
      ],
      "osmWayIds": [
        665889276
      ],
      "osmNodeIds": [
        5306991464,
        6233434069
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/665889276",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-665889276-1",
      "from": "H4",
      "to": "O3458151392",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 349.7,
      "geometry": [
        [
          120.6475029,
          27.784154
        ],
        [
          120.6474027,
          27.7839608
        ],
        [
          120.6463566,
          27.7828835
        ],
        [
          120.6452329,
          27.7817442
        ]
      ],
      "osmWayIds": [
        665889276
      ],
      "osmNodeIds": [
        6233434069,
        2173827596,
        2173827613,
        3458151392
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/665889276",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-665889276-4",
      "from": "O3458151392",
      "to": "O5306991182",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 64.78,
      "geometry": [
        [
          120.6452329,
          27.7817442
        ],
        [
          120.6449896,
          27.7815077
        ],
        [
          120.6447905,
          27.7813127
        ]
      ],
      "osmWayIds": [
        665889276
      ],
      "osmNodeIds": [
        3458151392,
        2173827645,
        5306991182
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/665889276",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-665889276-6",
      "from": "O5306991182",
      "to": "O5306991183",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 13.93,
      "geometry": [
        [
          120.6447905,
          27.7813127
        ],
        [
          120.6447047,
          27.781213
        ]
      ],
      "osmWayIds": [
        665889276
      ],
      "osmNodeIds": [
        5306991182,
        5306991183
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/665889276",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-665889276-7",
      "from": "O5306991183",
      "to": "O3458151830",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 76.84,
      "geometry": [
        [
          120.6447047,
          27.781213
        ],
        [
          120.6441827,
          27.7806989
        ]
      ],
      "osmWayIds": [
        665889276
      ],
      "osmNodeIds": [
        5306991183,
        3458151830
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/665889276",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-665889276-8",
      "from": "O3458151830",
      "to": "O5306991181",
      "label": "未命名道路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 64.95,
      "geometry": [
        [
          120.6441827,
          27.7806989
        ],
        [
          120.6437498,
          27.7802579
        ]
      ],
      "osmWayIds": [
        665889276
      ],
      "osmNodeIds": [
        3458151830,
        5306991181
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/665889276",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-863688850-2",
      "from": "O5306991227",
      "to": "H1",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 22.31,
      "geometry": [
        [
          120.6350751,
          27.7886232
        ],
        [
          120.6350278,
          27.788427
        ]
      ],
      "osmWayIds": [
        863688850
      ],
      "osmNodeIds": [
        5306991227,
        5306991281
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/863688850",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-864520302-1",
      "from": "O8057918190",
      "to": "O8057918191",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 57.71,
      "geometry": [
        [
          120.6333241,
          27.7798918
        ],
        [
          120.6338981,
          27.7797847
        ]
      ],
      "osmWayIds": [
        864520302
      ],
      "osmNodeIds": [
        8057918190,
        8057918191
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/864520302",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-904722544-3",
      "from": "O5306991469",
      "to": "O5306991467",
      "label": "万松路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 256.34,
      "geometry": [
        [
          120.6333053,
          27.784858
        ],
        [
          120.634861,
          27.784483
        ],
        [
          120.6357723,
          27.7841332
        ]
      ],
      "osmWayIds": [
        904722544
      ],
      "osmNodeIds": [
        5306991469,
        5306991468,
        5306991467
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/904722544",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-904722544-5",
      "from": "O5306991467",
      "to": "D",
      "label": "万松路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 54.72,
      "geometry": [
        [
          120.6357723,
          27.7841332
        ],
        [
          120.6362826,
          27.7839373
        ]
      ],
      "osmWayIds": [
        904722544
      ],
      "osmNodeIds": [
        5306991467,
        5306991466
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/904722544",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-904722544-6",
      "from": "D",
      "to": "O5306991300",
      "label": "万松路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 262.99,
      "geometry": [
        [
          120.6362826,
          27.7839373
        ],
        [
          120.6378861,
          27.7831925
        ],
        [
          120.638654,
          27.7828456
        ]
      ],
      "osmWayIds": [
        904722544
      ],
      "osmNodeIds": [
        5306991466,
        3458145816,
        5306991300
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/904722544",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-904722545-0",
      "from": "O5306991299",
      "to": "O5306991287",
      "label": "万松路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 167.75,
      "geometry": [
        [
          120.6387095,
          27.7829825
        ],
        [
          120.6379505,
          27.7833159
        ],
        [
          120.6371785,
          27.7836468
        ]
      ],
      "osmWayIds": [
        904722545
      ],
      "osmNodeIds": [
        5306991299,
        3458145807,
        5306991287
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/904722545",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-904722545-2",
      "from": "O5306991287",
      "to": "O5306991296",
      "label": "万松路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 1,
      "lengthMeters": 150.47,
      "geometry": [
        [
          120.6371785,
          27.7836468
        ],
        [
          120.6365561,
          27.7839135
        ],
        [
          120.6357954,
          27.7842245
        ]
      ],
      "osmWayIds": [
        904722545
      ],
      "osmNodeIds": [
        5306991287,
        5306991477,
        5306991296
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/904722545",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-904722545-4",
      "from": "O5306991296",
      "to": "O5306991279",
      "label": "万松路",
      "highway": "primary",
      "directed": true,
      "directionTag": "yes",
      "open": true,
      "minutes": 2,
      "lengthMeters": 255.07,
      "geometry": [
        [
          120.6357954,
          27.7842245
        ],
        [
          120.6348261,
          27.7846207
        ],
        [
          120.6333559,
          27.7849793
        ]
      ],
      "osmWayIds": [
        904722545
      ],
      "osmNodeIds": [
        5306991296,
        5306991475,
        5306991279
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/904722545",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-987512153-3",
      "from": "O5306991224",
      "to": "O5306991225",
      "label": "解放东路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 2,
      "lengthMeters": 255.71,
      "geometry": [
        [
          120.637726,
          27.7812273
        ],
        [
          120.6351909,
          27.7817351
        ]
      ],
      "osmWayIds": [
        987512153
      ],
      "osmNodeIds": [
        5306991224,
        5306991225
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/987512153",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940895-0",
      "from": "O9187568600",
      "to": "O9187568602",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 2,
      "lengthMeters": 353.65,
      "geometry": [
        [
          120.648871,
          27.7807573
        ],
        [
          120.6490123,
          27.7812296
        ],
        [
          120.6491947,
          27.7816995
        ],
        [
          120.6493825,
          27.7819558
        ],
        [
          120.6497472,
          27.7823853
        ],
        [
          120.6500772,
          27.7826701
        ],
        [
          120.6504366,
          27.7829335
        ],
        [
          120.6506994,
          27.7830498
        ],
        [
          120.6509972,
          27.7831162
        ]
      ],
      "osmWayIds": [
        994940895
      ],
      "osmNodeIds": [
        9187568600,
        9187568609,
        9187568608,
        9187568607,
        9187568606,
        9187568605,
        9187568604,
        9187568603,
        9187568602
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940895",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940896-0",
      "from": "O9187568616",
      "to": "O9187568617",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 11.53,
      "geometry": [
        [
          120.6377274,
          27.7809104
        ],
        [
          120.6376112,
          27.780924
        ]
      ],
      "osmWayIds": [
        994940896
      ],
      "osmNodeIds": [
        9187568616,
        9187568617
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940896",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940896-1",
      "from": "O9187568616",
      "to": "O9187568633",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 2,
      "lengthMeters": 321.99,
      "geometry": [
        [
          120.6377274,
          27.7809104
        ],
        [
          120.6382889,
          27.7807906
        ],
        [
          120.6385249,
          27.7807028
        ],
        [
          120.6387851,
          27.7806055
        ],
        [
          120.6392893,
          27.7804584
        ],
        [
          120.6399867,
          27.7803042
        ],
        [
          120.6408799,
          27.7801641
        ]
      ],
      "osmWayIds": [
        994940896
      ],
      "osmNodeIds": [
        9187568616,
        9187568615,
        9187568614,
        9187568613,
        9187568612,
        9187568611,
        9187568633
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940896",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940896-7",
      "from": "O9187568620",
      "to": "O9187568633",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 54.66,
      "geometry": [
        [
          120.6414163,
          27.780036
        ],
        [
          120.6408799,
          27.7801641
        ]
      ],
      "osmWayIds": [
        994940896
      ],
      "osmNodeIds": [
        9187568620,
        9187568633
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940896",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940896-8",
      "from": "O5306991170",
      "to": "O9187568620",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 120.05,
      "geometry": [
        [
          120.6425857,
          27.7797275
        ],
        [
          120.6414163,
          27.780036
        ]
      ],
      "osmWayIds": [
        994940896
      ],
      "osmNodeIds": [
        5306991170,
        9187568620
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940896",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940897-0",
      "from": "O3461903695",
      "to": "S1",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 191.64,
      "geometry": [
        [
          120.6388231,
          27.7788877
        ],
        [
          120.6391498,
          27.7796349
        ],
        [
          120.6396326,
          27.7794688
        ],
        [
          120.6401557,
          27.7794356
        ]
      ],
      "osmWayIds": [
        994940897
      ],
      "osmNodeIds": [
        3461903695,
        9187568624,
        9187568623,
        9187568622
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940897",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940897-3",
      "from": "S1",
      "to": "O9187568631",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 66.44,
      "geometry": [
        [
          120.6401557,
          27.7794356
        ],
        [
          120.6408289,
          27.7793881
        ]
      ],
      "osmWayIds": [
        994940897
      ],
      "osmNodeIds": [
        9187568622,
        9187568631
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940897",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940897-4",
      "from": "O9187568620",
      "to": "O9187568631",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 127.0,
      "geometry": [
        [
          120.6414163,
          27.780036
        ],
        [
          120.6413814,
          27.7793834
        ],
        [
          120.6408289,
          27.7793881
        ]
      ],
      "osmWayIds": [
        994940897
      ],
      "osmNodeIds": [
        9187568620,
        9187568621,
        9187568631
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940897",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940898-0",
      "from": "O9187568625",
      "to": "O9187568631",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 217.93,
      "geometry": [
        [
          120.6424045,
          27.7791831
        ],
        [
          120.6423202,
          27.7791841
        ],
        [
          120.6419447,
          27.7790749
        ],
        [
          120.6418186,
          27.7789966
        ],
        [
          120.6415129,
          27.7788827
        ],
        [
          120.6409577,
          27.7787925
        ],
        [
          120.6408289,
          27.7793881
        ]
      ],
      "osmWayIds": [
        994940898
      ],
      "osmNodeIds": [
        9187568625,
        9187568626,
        9187568627,
        9187568628,
        9187568629,
        9187568630,
        9187568631
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940898",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940899-0",
      "from": "O3458145817",
      "to": "O3458145819",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 11.74,
      "geometry": [
        [
          120.641301,
          27.7817032
        ],
        [
          120.6413435,
          27.7818019
        ]
      ],
      "osmWayIds": [
        994940899
      ],
      "osmNodeIds": [
        3458145817,
        3458145819
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940899",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940899-1",
      "from": "O3458145817",
      "to": "O9187568634",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 112.91,
      "geometry": [
        [
          120.641301,
          27.7817032
        ],
        [
          120.6411722,
          27.7812605
        ],
        [
          120.6410093,
          27.7807211
        ]
      ],
      "osmWayIds": [
        994940899
      ],
      "osmNodeIds": [
        3458145817,
        9187568635,
        9187568634
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940899",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940928-0",
      "from": "O9187568873",
      "to": "O9187568878",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 110.58,
      "geometry": [
        [
          120.6477061,
          27.7787284
        ],
        [
          120.6474298,
          27.7782752
        ],
        [
          120.6471589,
          27.7778599
        ]
      ],
      "osmWayIds": [
        994940928
      ],
      "osmNodeIds": [
        9187568873,
        9187568869,
        9187568878
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940928",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940928-2",
      "from": "O9187568868",
      "to": "O9187568878",
      "label": "未命名道路",
      "highway": "unclassified",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 79.27,
      "geometry": [
        [
          120.6467244,
          27.7772595
        ],
        [
          120.6471589,
          27.7778599
        ]
      ],
      "osmWayIds": [
        994940928
      ],
      "osmNodeIds": [
        9187568868,
        9187568878
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940928",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940929-0",
      "from": "O9187568878",
      "to": "O9187568880",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 129.15,
      "geometry": [
        [
          120.6471589,
          27.7778599
        ],
        [
          120.6462818,
          27.7782111
        ],
        [
          120.645968,
          27.7783482
        ]
      ],
      "osmWayIds": [
        994940929
      ],
      "osmNodeIds": [
        9187568878,
        9187568879,
        9187568880
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940929",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940929-2",
      "from": "O3458135305",
      "to": "O9187568878",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 119.0,
      "geometry": [
        [
          120.6482716,
          27.7774402
        ],
        [
          120.6471589,
          27.7778599
        ]
      ],
      "osmWayIds": [
        994940929
      ],
      "osmNodeIds": [
        3458135305,
        9187568878
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940929",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-994940929-3",
      "from": "O3458135293",
      "to": "O3458135305",
      "label": "未命名道路",
      "highway": "tertiary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 11.37,
      "geometry": [
        [
          120.6483789,
          27.7774023
        ],
        [
          120.6482716,
          27.7774402
        ]
      ],
      "osmWayIds": [
        994940929
      ],
      "osmNodeIds": [
        3458135293,
        3458135305
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/994940929",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-995611345-1",
      "from": "O5306991333",
      "to": "O5306991345",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 193.26,
      "geometry": [
        [
          120.6337181,
          27.7770188
        ],
        [
          120.6338893,
          27.7772711
        ],
        [
          120.6341206,
          27.7776959
        ],
        [
          120.6345422,
          27.7785293
        ],
        [
          120.6345669,
          27.7785843
        ]
      ],
      "osmWayIds": [
        995611345
      ],
      "osmNodeIds": [
        5306991333,
        5306991348,
        3461903698,
        3461903672,
        5306991345
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/995611345",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-995611345-10",
      "from": "O3461903693",
      "to": "O8057904982",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 52.7,
      "geometry": [
        [
          120.6359982,
          27.7799266
        ],
        [
          120.6357943,
          27.7799456
        ],
        [
          120.6355905,
          27.7799076
        ],
        [
          120.6354817,
          27.7798581
        ]
      ],
      "osmWayIds": [
        995611345
      ],
      "osmNodeIds": [
        3461903693,
        3461903691,
        3461903660,
        8057904982
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/995611345",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-995611345-13",
      "from": "O3461903693",
      "to": "H6",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 53.58,
      "geometry": [
        [
          120.6359982,
          27.7799266
        ],
        [
          120.6361698,
          27.7798791
        ],
        [
          120.6365059,
          27.7797536
        ]
      ],
      "osmWayIds": [
        995611345
      ],
      "osmNodeIds": [
        3461903693,
        3461903685,
        5306991307
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/995611345",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-995611345-15",
      "from": "O3461903695",
      "to": "H6",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 247.46,
      "geometry": [
        [
          120.6388231,
          27.7788877
        ],
        [
          120.6365059,
          27.7797536
        ]
      ],
      "osmWayIds": [
        995611345
      ],
      "osmNodeIds": [
        3461903695,
        5306991307
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/995611345",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-995611345-16",
      "from": "O3461903671",
      "to": "O3461903695",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 2,
      "lengthMeters": 268.97,
      "geometry": [
        [
          120.6412224,
          27.777728
        ],
        [
          120.6388231,
          27.7788877
        ]
      ],
      "osmWayIds": [
        995611345
      ],
      "osmNodeIds": [
        3461903671,
        3461903695
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/995611345",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-995611345-17",
      "from": "O3461903671",
      "to": "O5306991193",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 28.42,
      "geometry": [
        [
          120.6412224,
          27.777728
        ],
        [
          120.6412801,
          27.7777003
        ],
        [
          120.6414799,
          27.7776123
        ]
      ],
      "osmWayIds": [
        995611345
      ],
      "osmNodeIds": [
        3461903671,
        3458082009,
        5306991193
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/995611345",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    },
    {
      "id": "osm-995611345-5",
      "from": "O5306991345",
      "to": "O8057904982",
      "label": "未命名道路",
      "highway": "secondary",
      "directed": false,
      "directionTag": "no",
      "open": true,
      "minutes": 1,
      "lengthMeters": 172.85,
      "geometry": [
        [
          120.6345669,
          27.7785843
        ],
        [
          120.6348073,
          27.7791198
        ],
        [
          120.6350036,
          27.7794786
        ],
        [
          120.6351538,
          27.7796684
        ],
        [
          120.6353362,
          27.7797918
        ],
        [
          120.6354817,
          27.7798581
        ]
      ],
      "osmWayIds": [
        995611345
      ],
      "osmNodeIds": [
        5306991345,
        3461903665,
        3461903666,
        3461903697,
        3461903682,
        8057904982
      ],
      "source": "OpenStreetMap",
      "sourceUrl": "https://www.openstreetmap.org/way/995611345",
      "timeAssumption": "演练速度 15 km/h；每压缩路段向上取整到分钟，非实测通行时间",
      "statusAssumption": "初始开放为演练设定；不是当前可通行证明"
    }
  ]
}
};
function require(id){if(cache[id])return cache[id].exports;if(!factories[id])throw new Error('Unavailable browser module: '+id);const m={exports:{}};cache[id]=m;factories[id](m,m.exports,require);return m.exports;}window.JiaoyingExercise=require('./exercise.cjs');
window.JiaoyingPagesIntegrations={"integrationStatus":{"agent":{"mode":"prepared","connected":false,"provider":"DeepSeek（后续由 Agent 接入）","contract":"jiaoying-agent-v1"},"weather":{"mode":"prepared","connected":false,"provider":"彩云天气","apiVersion":"v2.6","unit":"metric:v2","coordinateOrder":"longitude,latitude"},"position":{"mode":"prepared","connected":false,"source":"当前为人工登记节点，不是 GPS"}},"agentContract":{"schema":"jiaoying-agent-v1","mode":"prepared","connected":false,"input":["requestId","utterance","snapshot","inputVersion","executionVersion"],"output":["requestId","summary","proposedActions","evidence","inputVersion","executionVersion"],"tools":[{"name":"read_state","mutates":false},{"name":"calculate_draft","mutates":true,"requiresHumanConfirmation":false},{"name":"prepare_report","mutates":false},{"name":"propose_scenario","mutates":false}],"rules":["Agent 返回建议，不直接调用确认、发布或安全核验操作","工具结果必须引用同一输入和执行版本","网页提交的动作由本地服务重新验证","不确定时澄清，不补造地点人数或预案条款"]}};})();
