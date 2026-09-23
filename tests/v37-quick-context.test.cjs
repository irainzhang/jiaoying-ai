'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const Q=require('../dist/quick-context.js');
const E=require('../exercise.cjs');

function data(){
  const d=E.initial();
  d.activePlan={id:'P1-A',routes:[{vehicleId:'V1',stops:[{id:'H2'},{id:'H3'}]},{vehicleId:'V2',stops:[{id:'H5'}]}]};
  return d;
}
const draft=(text,extra={})=>Q.prepare(text,{data:data(),scope:{villageId:'VA',pickupId:'P-A1'},reporter:'现场乙',source:'voice',...extra});

test('quick context uses explicit selection before task and can infer a village from a unique selected pickup',()=>{
  const d=data();
  const explicit=Q.scope(d,{vehicleId:'V1',villageId:'VC',pickupId:'P-C1'});
  assert.deepEqual(explicit,{villageId:'VC',pickupId:'P-C1',label:'演示村 C · 村委会集合点（演示）',source:'selection'});
  assert.equal(Q.scope(d,{vehicleId:'V1',villageId:'VB'}).pickupId,'');
  assert.equal(Q.scope(d,{pickupId:'P-B2'}).villageId,'VB');
});

test('task context follows the first still-waiting assigned household and does not reuse boarded locations',()=>{
  const d=data();
  assert.deepEqual(Q.scope(d,{vehicleId:'V1'}),{villageId:'VA',pickupId:'P-A2',label:'演示村 A · 备用集合点（演示）',source:'task'});
  d.stage.H2='boarded';assert.equal(Q.scope(d,{vehicleId:'V1'}).pickupId,'P-B1');
  d.stage.H3='arrived';assert.equal(Q.scope(d,{vehicleId:'V1'}).source,'none');
});

test('legacy task locations require a unique exact registered node match',()=>{
  const d=data(),home=d.scenario.households.find(h=>h.id==='H2');delete home.villageId;delete home.pickupId;
  assert.equal(Q.scope(d,{vehicleId:'V1'}).pickupId,'P-A2');
  home.node='unregistered';assert.equal(Q.scope(d,{vehicleId:'V1'}).villageId,'');
  home.node='H2';d.villages[1].pickups[0].node='H2';assert.equal(Q.scope(d,{vehicleId:'V1'}).source,'none');
});

test('no selected location, unpublished plan or unknown vehicle never defaults to the first village',()=>{
  const d=data();
  for(const options of [{},{vehicleId:'missing'}])assert.equal(Q.scope(d,options).villageId,'');
  d.activePlan=null;assert.equal(Q.scope(d,{vehicleId:'V1'}).source,'none');
  assert.equal(Q.scope({},{vehicleId:'V1'}).pickupId,'');
});

test('invalid explicit selection remains blocked rather than being silently replaced by a task location',()=>{
  const d=data(),scope=Q.scope(d,{vehicleId:'V1',villageId:'VA',pickupId:'P-B1'});
  assert.equal(scope.source,'selection');assert.equal(scope.pickupId,'P-B1');
  assert.equal(draft('新增三人',{data:d,scope}).proposal,null);
  assert.equal(draft('新增三人',{scope:Q.scope(d,{vehicleId:'V1',villageId:'missing'})}).proposal,null);
});

test('spoken village changes clear the previous pickup and can resolve its own common pickup name',()=>{
  const village=draft('演示村 B 新增三人');
  assert.deepEqual(village.questions,[]);assert.equal(village.proposal.payload.villageId,'VB');assert.equal(village.proposal.payload.pickupId,'');
  const point=draft('演示村 B 新增三人，在村委会集合点');
  assert.deepEqual(point.questions,[]);assert.equal(point.proposal.payload.pickupId,'P-B1');
});

test('a uniquely spoken foreign pickup overrides stale task scope while shared names stay local',()=>{
  assert.equal(draft('新增三人，在 P-B1').proposal.payload.villageId,'VB');
  assert.equal(draft('新增三人，在 P-B1').proposal.payload.pickupId,'P-B1');
  assert.equal(draft('新增三人，在备用集合点').proposal.payload.pickupId,'P-A2');
  assert.equal(draft('新增三人，在村委会集合点',{scope:{}}).proposal,null);
});

test('explicit contradictory villages or pickup IDs still require clarification',()=>{
  for(const text of ['演示村 A 新增三人，在 P-B1','演示村 A 和演示村 B 新增三人','新增三人，在 P-B1 和 P-C1','新增三人，在 P-A1 和 P-A2'])assert.equal(draft(text).proposal,null,text);
});

test('unregistered places and uncertain or conflicting counts retain parser blocking',()=>{
  for(const text of ['塘下镇幸福村新增三人','新增三人，在学校门口集合','大约新增三人','新增三人，总计五人','不要新增三人','新增三人？'])assert.equal(draft(text).proposal,null,text);
});

test('unmentioned needs remain unknown and a spoken undecided point clears stale task location',()=>{
  const out=draft('新增三人，集合点待定');
  assert.equal(out.proposal.payload.pickupId,'');assert.equal(out.proposal.payload.assistancePeople,null);assert.equal(out.proposal.payload.wheelchairPeople,null);assert.equal(out.proposal.payload.groupPolicy,'unknown');
  assert.equal(out.proposal.payload.source,'voice');assert.equal(out.proposal.payload.reporter,'现场乙');
  const known=draft('新增三人，无需协助，无轮椅，都是独立人员');assert.equal(known.proposal.payload.assistancePeople,0);assert.equal(known.proposal.payload.wheelchairPeople,0);
});

test('quick add never creates corrections, waiting snapshots or execution progress even when numbers are present',()=>{
  const d=data();d.villageReports=[{id:'VR1',villageId:'VA',mode:'increment',status:'accepted',people:3,householdIds:[]}];
  for(const text of ['更正 VR1，改为二人','目前待转移三人','还有三人需要转移','已上车三人','已联系三人','收到任务三人','新增三人，道路受阻']){
    const out=draft(text,{data:d});assert.equal(out.proposal,null,text);assert.ok(out.questions.length,text);
  }
});

test('quick context functions are pure and expose the same API as browser UMD',()=>{
  const d=data(),selected={vehicleId:'V1'},before=JSON.stringify({d,selected});Q.scope(d,selected);Q.prepare('新增三人',{data:d,scope:Q.scope(d,selected),source:'text'});assert.equal(JSON.stringify({d,selected}),before);
  const context={};vm.createContext(context);
  for(const name of ['village-assistant.js','quick-context.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',name),'utf8'),context);
  const out=context.JiaoyingQuickContext.prepare('演示村 B 新增三人',{data:d});assert.equal(out.proposal.payload.villageId,'VB');assert.equal(typeof context.JiaoyingQuickContext.scope,'function');
});
