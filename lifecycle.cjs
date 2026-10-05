'use strict';
// Whole-task closure is separate from individual transport stages. Closing a
// task never marks a person as arrived/verified or a report as resolved.
const V=require('./village-ledger.cjs');
const clone=value=>JSON.parse(JSON.stringify(value));
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const sum=(rows,fn)=>rows.reduce((n,row)=>n+fn(row),0);
const MAX_ARCHIVES=10,MAX_ARCHIVE_BYTES=4*1024*1024;
const isClosed=d=>['completed','stopped'].includes(d.taskLifecycle?.status);
function ensure(d){
  if(d.taskLifecycle===undefined)d.taskLifecycle={status:'active',endedAt:null,note:'',summary:null};
  if(d.taskArchives===undefined)d.taskArchives=[];
  return d;
}
function summary(d){
  const homes=d.scenario.households.filter(h=>d.stage[h.id]!=='superseded');
  const unplanned=V.unplannedRequests(d),villages=d.villageReports||[];
  const pending=d.reports.filter(r=>r.status==='pending'),pendingVillage=villages.filter(r=>r.status==='pending');
  const count=stage=>sum(homes.filter(h=>d.stage[h.id]===stage),h=>h.people);
  const result={people:sum(homes,h=>h.people)+sum(unplanned,r=>r.people),waiting:count('waiting')+sum(unplanned,r=>r.people),boarded:count('boarded'),arrived:count('arrived'),verified:count('verified'),unplannedPeople:sum(unplanned,r=>r.people),pendingVillagePeople:sum(pendingVillage.filter(r=>r.mode==='increment'),r=>r.people),pendingReports:pending.length+pendingVillage.length,pendingReviewPeople:sum(pending.filter(r=>r.kind==='people'),r=>r.people)+sum(pendingVillage.filter(r=>r.mode==='increment'),r=>r.people),unlocatedPeople:sum(villages.filter(r=>r.status==='accepted'&&r.mode!=='snapshot'&&!r.supersededBy&&!r.householdIds.length&&r.locationStatus==='pending'),r=>r.people),unresolvedReports:d.reports.filter(r=>r.status==='coordination').length};
  result.canComplete=result.waiting===0&&result.boarded===0&&result.arrived===0&&result.pendingReports===0&&result.unresolvedReports===0&&result.verified===result.people;
  return result;
}
function close(d,{mode,note}={},time=new Date().toISOString()){
  ensure(d);assert(!isClosed(d),'当前任务已经结束，请查看记录或新建下一场任务');
  assert(['completed','stopped'].includes(mode),'请选择正常完成或提前结束');
  assert(note===undefined||typeof note==='string'&&note.length<=500,'结束说明须为不超过 500 字的文字');
  const result=summary(d);
  assert(mode!=='completed'||result.canComplete,'仍有未完成、待核实或待协调事项，不能标记全部完成；可选择提前结束并保留原记录');
  d.taskLifecycle={status:mode,endedAt:time,note:note?.trim()||(mode==='completed'?'全部有效转移对象均已核验，人工结束本场任务':'人工提前结束本场任务；未完成、待核实和待协调记录按原状态保留'),summary:result};
  return d.taskLifecycle;
}
function archive(d){
  assert(isClosed(d),'请先结束当前任务，再新建下一场');
  const data=clone(d);delete data.taskArchives;
  return {exerciseId:d.exerciseId,createdAt:d.createdAt,endedAt:d.taskLifecycle.endedAt,status:d.taskLifecycle.status,summary:clone(d.taskLifecycle.summary),data};
}
function boundedArchives(rows){
  assert(rows.length<=MAX_ARCHIVES,`本地最多保存 ${MAX_ARCHIVES} 场任务历史；为保护记录，暂不继续新建。请先导出全部任务备份；导出不会自动清理历史或释放容量`);
  assert(new TextEncoder().encode(JSON.stringify(rows)).length<=MAX_ARCHIVE_BYTES,'任务历史已达 4 MB 保存上限；为保护记录，暂不继续新建。请先导出全部任务备份；导出不会自动清理历史或释放容量');
  return rows;
}
function mergeArchives(...collections){
  const ids=new Set(),rows=[];
  for(const collection of collections)for(const row of collection){if(ids.has(row.exerciseId))continue;ids.add(row.exerciseId);rows.push(clone(row));}
  return boundedArchives(rows);
}
function validate(d,validateSnapshot){
  if(d.taskLifecycle!==undefined){
    const t=d.taskLifecycle;
    assert(object(t)&&['active','completed','stopped'].includes(t.status)&&typeof t.note==='string'&&t.note.length<=500,'任务结束状态无效');
    if(t.status==='active')assert(t.endedAt===null&&t.summary===null,'进行中的任务不能带结束摘要');
    else{
      assert(typeof t.endedAt==='string'&&Number.isFinite(Date.parse(t.endedAt))&&object(t.summary),'任务结束时间或摘要无效');
      const expected=summary(d);
      assert(Object.keys(expected).length===Object.keys(t.summary).length&&Object.entries(expected).every(([key,value])=>t.summary[key]===value),'任务结束摘要与原始台账不一致');
      assert(t.status!=='completed'||expected.canComplete,'未完成任务不能恢复为全部完成');
    }
  }
  if(d.taskArchives!==undefined){
    assert(Array.isArray(d.taskArchives),'任务历史结构无效');boundedArchives(d.taskArchives);
    const ids=new Set();
    for(const row of d.taskArchives){
      assert(object(row)&&typeof row.exerciseId==='string'&&!ids.has(row.exerciseId)&&row.exerciseId!==d.exerciseId&&object(row.data)&&row.data.taskArchives===undefined,'任务历史必须平铺保存且编号不能重复');ids.add(row.exerciseId);
      assert(isClosed(row.data)&&row.exerciseId===row.data.exerciseId&&row.createdAt===row.data.createdAt&&row.endedAt===row.data.taskLifecycle.endedAt&&row.status===row.data.taskLifecycle.status&&JSON.stringify(row.summary)===JSON.stringify(row.data.taskLifecycle.summary),'任务历史索引与原始记录不一致');
      validateSnapshot(row.data);
    }
  }
  return d;
}
module.exports={ensure,isClosed,summary,close,archive,mergeArchives,validate,MAX_ARCHIVES,MAX_ARCHIVE_BYTES};
