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
