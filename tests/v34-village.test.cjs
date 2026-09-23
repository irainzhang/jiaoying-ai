'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../exercise.cjs');
function submit(x,changes={}){x.action('village-report',{villageId:'VA',mode:'increment',people:7,pickupId:'P-A1',assistancePeople:2,wheelchairPeople:1,groupPolicy:'splittable',text:'新增七人，其中两人需要协助，一人用轮椅',reporter:'演示村联络员',source:'voice',...changes});return x.data.villageReports[0].id;}
function accept(x,id,changes={}){return x.action('village-review',{id,decision:'accept',note:'现场逐项核实',...changes});}
function metric(x){return E.villageMetrics(x.data).find(v=>v.villageId==='VA');}
function row(x,id){return x.data.villageReports.find(r=>r.id===id);}
function valid(x){assert.deepEqual(E.validate(E.snapshot(x.data),x.data.plan),[]);}

test('initial demo villages restore into old V3 state without changing execution or published plan',()=>{
  const x=E.create();x.action('generate');x.action('confirm');x.action('contact',{ids:x.data.scenario.households.map(h=>h.id)});x.action('start');x.action('step',{vehicleId:'V1'});
  const old=x.data;delete old.villages;delete old.villageReports;delete old.villageReportCounter;delete old.villageGroupCounter;old.scenario.households.forEach(h=>{delete h.villageId;delete h.pickupId;});
  const restored=E.create(old).data;assert.equal(restored.villages.length,3);assert.ok(restored.villages.every(v=>v.synthetic&&v.township==='演示乡镇'));assert.deepEqual(restored.activePlan,old.activePlan);assert.deepEqual(restored.fleet,old.fleet);assert.deepEqual(restored.stage,old.stage);assert.equal(restored.revision,old.revision);assert.equal(E.metrics(restored).people,15);
});
test('pending increments are separate from verified people; acceptance conserves support subsets and assigns groups',()=>{
  const x=E.create(),id=submit(x);assert.equal(E.metrics(x.data).people,15);assert.equal(metric(x).pendingPeople,7);accept(x,id);
  const r=row(x,id),groups=x.data.scenario.households.filter(h=>h.sourceBatchId===id);assert.equal(r.status,'accepted');assert.equal(r.needsInfo,false);assert.equal(metric(x).pendingPeople,0);assert.equal(E.metrics(x.data).people,22);assert.ok(groups.every(h=>h.people<=4));assert.equal(groups.reduce((n,h)=>n+h.people,0),7);assert.equal(groups.reduce((n,h)=>n+h.assistancePeople,0),2);assert.equal(groups.reduce((n,h)=>n+h.wheelchairPeople,0),1);assert.equal(x.data.fieldEvents[0].villageReportId,id);valid(x);
});
test('snapshot is a timestamped observation and never double adds waiting or deletes completed people',()=>{
  const x=E.create(),before=E.metrics(x.data),id=submit(x,{mode:'snapshot',people:20,scope:'waiting',observedAt:'2026-09-22T09:00:00Z'});assert.equal(metric(x).pendingPeople,0);accept(x,id);assert.deepEqual(E.metrics(x.data),before);assert.equal(metric(x).latestSnapshot.people,20);assert.equal(metric(x).latestSnapshot.observedAt,'2026-09-22T09:00:00.000Z');assert.equal(x.data.scenario.households.length,6);
  assert.throws(()=>submit(x,{mode:'snapshot',people:20,scope:'all',observedAt:'2026-09-22T09:00:00Z'}),/口径/);assert.throws(()=>submit(x,{mode:'snapshot',people:20,scope:'waiting',observedAt:''}),/统计时间/);
});
test('unknown pickup and special needs can be accepted into waiting ledger without fabricated routes, then completed once',()=>{
  const x=E.create(),id=submit(x,{people:3,pickupId:null,assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown'});accept(x,id);
  assert.equal(row(x,id).needsInfo,true);assert.deepEqual(row(x,id).householdIds,[]);assert.equal(E.metrics(x.data).people,18);assert.equal(metric(x).unplannedPeople,3);assert.equal(x.data.plan.totalPeople,18);assert.equal(x.data.plan.complete,false);assert.ok(x.data.plan.unassigned.some(h=>h.id==='BATCH-'+id&&h.people===3));valid(x);
  const before=x.data;assert.throws(()=>x.action('village-complete',{id,pickupId:'P-B1',assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',note:'补齐'}),/当前村庄/);assert.deepEqual(x.data,before);
  x.action('village-complete',{id,pickupId:'P-A2',assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',note:'已核对接人点和人数'});assert.equal(row(x,id).needsInfo,false);assert.equal(metric(x).unplannedPeople,0);assert.equal(E.metrics(x.data).people,18);assert.equal(row(x,id).householdIds.length,1);assert.throws(()=>x.action('village-complete',{id,pickupId:'P-A2',assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',note:'重复'}),/仅可补齐/);valid(x);
});
test('correction does not add pending heads; accepted correction archives old unexecuted groups with traceable IDs',()=>{
  const x=E.create(),a=submit(x);accept(x,a);const ids=row(x,a).householdIds;const b=submit(x,{mode:'correction',targetId:a,people:5,assistancePeople:1,wheelchairPeople:0});assert.equal(E.metrics(x.data).people,22);assert.equal(metric(x).pendingPeople,0);assert.equal(metric(x).pendingCorrections,1);accept(x,b);assert.equal(row(x,a).status,'superseded');assert.equal(row(x,a).supersededBy,b);assert.ok(ids.every(id=>x.data.stage[id]==='superseded'));assert.equal(E.metrics(x.data).people,20);assert.ok(row(x,b).householdIds.every(id=>!ids.includes(id)));assert.throws(()=>submit(x,{mode:'correction',targetId:a,people:1,assistancePeople:0,wheelchairPeople:0}),/目标已失效/);valid(x);
});
test('zero correction cancels only the unexecuted batch, remains auditable, and rejected correction preserves original',()=>{
  const x=E.create(),a=submit(x,{people:2,assistancePeople:0,wheelchairPeople:0});accept(x,a);const rejected=submit(x,{mode:'correction',targetId:a,people:0,assistancePeople:0,wheelchairPeople:0});x.action('village-review',{id:rejected,decision:'reject',note:'核实后保持原人数'});assert.equal(E.metrics(x.data).people,17);assert.equal(row(x,a).status,'accepted');
  const b=submit(x,{mode:'correction',targetId:a,people:0,assistancePeople:0,wheelchairPeople:0});accept(x,b);assert.equal(E.metrics(x.data).people,15);assert.equal(row(x,b).needsInfo,false);assert.deepEqual(row(x,b).householdIds,[]);valid(x);
});
test('correction is blocked both before submission and at review when batch has boarded',()=>{
  const x=E.create(),a=submit(x,{people:1,assistancePeople:0,wheelchairPeople:0});accept(x,a);const b=submit(x,{mode:'correction',targetId:a,people:2,assistancePeople:0,wheelchairPeople:0});
  const state=x.data,id=row(x,a).householdIds[0];state.stage[id]='boarded';state.fleet.V1.onboard.push(id);const y=E.create(state),before=y.data;
  assert.throws(()=>accept(y,b),/已有人员上车/);assert.deepEqual(y.data,before);assert.throws(()=>submit(y,{mode:'correction',targetId:a,people:3,assistancePeople:0,wheelchairPeople:0}),/已有人员上车/);
});
test('duplicate increments require explicit second-batch acknowledgement while retries do not silently alter old rows',()=>{
  const x=E.create(),a=submit(x),before=x.data;assert.throws(()=>submit(x),/疑似重复/);assert.deepEqual(x.data,before);const b=submit(x,{duplicateAcknowledged:true});assert.equal(row(x,b).possibleDuplicateOf,a);assert.equal(metric(x).pendingPeople,14);assert.equal(x.data.villageReports.length,2);
});
test('support counts enforce wheelchair subset and do not grant two wheelchairs one seat in together mode',()=>{
  const x=E.create();assert.throws(()=>submit(x,{people:2,assistancePeople:1,wheelchairPeople:2}),/包含在/);assert.throws(()=>submit(x,{people:2,assistancePeople:3,wheelchairPeople:0}),/需协助人数/);
  const id=submit(x,{people:2,assistancePeople:2,wheelchairPeople:2,groupPolicy:'together'});accept(x,id);const group=row(x,id).householdIds[0];assert.ok(x.data.plan.unassigned.some(h=>h.id===group));assert.ok(!x.data.plan.servedIds.includes(group));valid(x);
});
test('village groups cannot be edited outside traceable batch correction; 500-person scale guard rolls back approval',()=>{
  const x=E.create(),id=submit(x,{people:1,assistancePeople:0,wheelchairPeople:0});accept(x,id);assert.throws(()=>x.action('edit',{kind:'households',id:row(x,id).householdIds[0],people:2,risk:2}),/批次更正/);
  const big=submit(x,{people:500,pickupId:null,assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown'}),before=x.data;assert.throws(()=>accept(x,big),/最多管理 500/);assert.deepEqual(x.data,before);
});
test('corrected group still referenced by an old published route cannot execute until a new plan is confirmed',()=>{
  const x=E.create(),a=submit(x,{people:1,assistancePeople:1,wheelchairPeople:0});accept(x,a);const group=row(x,a).householdIds[0];assert.ok(x.data.plan.servedIds.includes(group));x.action('confirm',{note:'暂未安排人员留守等待增援'});x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');const old=x.data.activePlan,route=old.routes.find(r=>r.passengerIds.includes(group));
  const b=submit(x,{mode:'correction',targetId:a,people:2,assistancePeople:1,wheelchairPeople:0});accept(x,b);assert.deepEqual(x.data.activePlan,old);assert.throws(()=>x.action('step',{vehicleId:route.vehicleId}),/批次已更正/);assert.equal(x.data.stage[group],'superseded');assert.equal(E.create(x.data).data.villageReports.length,2);valid(x);
});
test('restoration rejects mismatched batch headcounts and multiple-source group references',()=>{
  const x=E.create(),id=submit(x,{people:1,assistancePeople:0,wheelchairPeople:0});accept(x,id);const mismatched=x.data;mismatched.scenario.households.find(h=>h.sourceBatchId===id).people=2;assert.throws(()=>E.create(mismatched),/不守恒/);const dangling=x.data;dangling.villageReports=[];assert.throws(()=>E.create(dangling),/缺少原始批次/);
});
test('solver validation detects a missing verified but ungrouped batch and 200-group approval limit is atomic',()=>{
  const x=E.create(),id=submit(x,{people:3,pickupId:null,assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown'});accept(x,id);const malformed=x.data.plan;malformed.unassigned=[];assert.ok(E.validate(E.snapshot(x.data),malformed).some(e=>e.includes('待补信息')));
  const y=E.create(),many=submit(y,{people:195,assistancePeople:195,wheelchairPeople:195}),before=y.data;assert.throws(()=>accept(y,many),/最多管理 200 个/);assert.deepEqual(y.data,before);
});
