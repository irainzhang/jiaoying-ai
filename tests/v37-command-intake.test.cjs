'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../exercise.cjs');

const row=(changes={})=>({villageId:'VA',pickupId:'P-A1',people:3,assistancePeople:1,wheelchairPeople:0,groupPolicy:'splittable',text:'演示村 A 新增 3 人，其中 1 人需要协助，允许分车。',...changes});
const intake=(x,rows,changes={})=>x.action('command-intake',{rows,source:'file',reporter:'指挥值守',note:'已核对每批人员及集合点',...changes});
const valid=x=>assert.deepEqual(E.validate(E.snapshot(x.data),x.data.plan),[]);
const unchanged=(x,fn,pattern)=>{const before=x.data;assert.throws(fn,pattern);assert.deepEqual(x.data,before);};

test('command intake accepts reviewed rows in one revision and one calculation without publishing',()=>{
  const x=E.create(),before=x.data;
  intake(x,[row(),row({villageId:'VB',pickupId:'P-B1',people:2,assistancePeople:0,text:'演示村 B 新增 2 人，无需特殊协助。'})]);
  const d=x.data;
  assert.equal(d.revision,before.revision+1);assert.equal(d.inputVersion,before.inputVersion+1);assert.equal(d.planCounter,before.planCounter+1);
  assert.equal(d.executionVersion,before.executionVersion);assert.equal(d.activePlan,null);assert.equal(E.metrics(d).people,20);assert.equal(E.metrics(d).pendingVillagePeople,0);
  assert.equal(d.villageReports.length,2);assert.ok(d.villageReports.every(r=>r.status==='accepted'&&r.mode==='increment'&&!r.needsInfo&&r.origin==='command'&&r.intakeSource==='file'&&r.source==='manual'&&r.inputSource==='manual'));
  assert.equal(new Set(d.villageReports.map(r=>r.commandIntakeId)).size,1);assert.equal(d.fieldEvents.length,2);assert.ok(d.fieldEvents.every(e=>e.stage==='command-intake'&&e.origin==='command'));
  assert.deepEqual(d.scenario.households.slice(0,6),before.scenario.households);assert.match(d.lastAnnouncement,/核对后发布/);valid(x);
});

test('a malformed later row rolls back all earlier accepted rows, IDs, logs, and plan state',()=>{
  const x=E.create();x.action('generate');x.action('confirm');
  unchanged(x,()=>intake(x,[row(),row({villageId:'VB',pickupId:'P-A1'})]),/第 2 行.*当前村庄/);
  unchanged(x,()=>intake(x,[row(),null]),/第 2 行.*任务行无效/);
  unchanged(x,()=>intake(x,[row({people:1.5})]),/人数须为/);
  unchanged(x,()=>intake(x,[row({mode:'correction'})]),/仅新增/);
  unchanged(x,()=>intake(x,[row({people:2,assistancePeople:1,wheelchairPeople:2})]),/包含在/);
});

test('unknown needs stay explicitly unplanned while known rows retain exact special-needs counts',()=>{
  const x=E.create();
  intake(x,[row({pickupId:null,people:4,assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown'}),row({villageId:'VC',pickupId:'P-C1',people:3,assistancePeople:2,wheelchairPeople:1})],{source:'voice'});
  const unknown=x.data.villageReports.find(r=>r.villageId==='VA'),known=x.data.villageReports.find(r=>r.villageId==='VC');
  assert.equal(unknown.status,'accepted');assert.equal(unknown.needsInfo,true);assert.deepEqual(unknown.householdIds,[]);assert.equal(unknown.assistancePeople,null);assert.equal(unknown.wheelchairPeople,null);
  assert.equal(E.metrics(x.data).people,22);assert.equal(E.metrics(x.data).unplannedPeople,4);assert.ok(x.data.plan.unassigned.some(h=>h.id==='BATCH-'+unknown.id&&h.people===4));
  const groups=x.data.scenario.households.filter(h=>known.householdIds.includes(h.id));assert.equal(groups.reduce((n,h)=>n+h.assistancePeople,0),2);assert.equal(groups.reduce((n,h)=>n+h.wheelchairPeople,0),1);
  assert.ok(x.data.villageReports.every(r=>r.source==='voice'&&r.intakeSource==='voice'));valid(x);
});

test('same-batch duplicates and repeated uploads require an explicit second-batch acknowledgement',()=>{
  const x=E.create();
  unchanged(x,()=>intake(x,[row(),row()]),/第 2 行.*疑似重复/);
  intake(x,[row()]);const original=x.data.villageReports[0].id;
  unchanged(x,()=>intake(x,[row()]),/疑似重复/);
  unchanged(x,()=>intake(x,[row()],{duplicateAcknowledged:'true'}),/必须明确勾选/);
  intake(x,[row()],{duplicateAcknowledged:true});
  assert.equal(x.data.villageReports[0].possibleDuplicateOf,original);assert.equal(x.data.villageReports[0].duplicateAcknowledged,true);assert.equal(E.metrics(x.data).people,21);valid(x);
});

test('row, person and resulting-group limits reject the entire intake atomically',()=>{
  const x=E.create();
  unchanged(x,()=>intake(x,[]),/1–100/);unchanged(x,()=>intake(x,Array.from({length:101},()=>row())),/1–100/);
  unchanged(x,()=>intake(x,[row({people:3}),row({villageId:'VB',pickupId:'P-B1',people:483,assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown'})]),/最多管理 500/);
  unchanged(x,()=>intake(x,[row({people:195,assistancePeople:195,wheelchairPeople:195})]),/最多管理 200 个/);
  unchanged(x,()=>intake(x,[row()],{source:'arbitrary'}),/录入来源/);
  unchanged(x,()=>intake(x,[row()],{note:'x'.repeat(221)}),/220/);
});

test('new command rows cannot change ongoing execution, onboard manifests or the published plan',()=>{
  const x=E.create();x.action('generate');x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');x.action('step',{vehicleId:'V1'});
  const before=x.data,onboard=before.fleet.V1.onboard;
  assert.ok(onboard.length);
  intake(x,[row({people:2,assistancePeople:0})],{source:'text'});
  const d=x.data;
  assert.deepEqual(d.activePlan,before.activePlan);assert.deepEqual(d.fleet,before.fleet);assert.deepEqual(d.occupancy,before.occupancy);assert.equal(d.phase,'executing');assert.equal(d.executionVersion,before.executionVersion);
  for(const [id,stage] of Object.entries(before.stage))assert.equal(d.stage[id],stage);
  assert.deepEqual(d.plan.routes.find(r=>r.vehicleId==='V1').onboard,onboard);assert.ok(d.villageReports[0].householdIds.every(id=>d.stage[id]==='waiting'&&!d.contacts[id].contacted));valid(x);
});

test('command provenance survives disk restoration and external JSON import without authorizing a plan',()=>{
  const x=E.create();intake(x,[row()]);const saved=x.data;
  const restored=E.create(JSON.parse(JSON.stringify(saved)));assert.deepEqual(restored.data.villageReports,saved.villageReports);assert.deepEqual(restored.data.fieldEvents,saved.fieldEvents);valid(restored);
  const imported=E.create();imported.action('restore',{data:saved});assert.deepEqual(imported.data.villageReports,saved.villageReports);assert.equal(imported.data.activePlan,null);assert.equal(E.metrics(imported.data).people,18);valid(imported);
});
