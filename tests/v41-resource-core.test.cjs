'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const X=require('../exercise.cjs');
function registered(vehicle={},staff){
  const x=X.create(X.createBlank({mapMode:'same'}));
  x.action('configure-resources',{resourceRegistryVersion:1,staff:staff||[{id:'D01',role:'driver',available:true},{id:'E01',role:'escort',available:true},{id:'R01',role:'reserve',available:true}],vehicles:[{id:'V1',name:'登记接送车',model:'示例中型客车',vehicleType:'accessible',totalCapacity:8,wheelchairSlots:2,driverId:'D01',escortIds:['E01'],notes:'演练核定布局',start:'D',available:true,...vehicle}],shelters:[{id:'S1',name:'接收点',capacity:40,available:true}]});
  return x;
}
function add(x,people=3,assistancePeople=0,wheelchairPeople=0){x.action('command-intake',{source:'text',rows:[{villageId:'VA',pickupId:'P-A1',people,assistancePeople,wheelchairPeople,groupPolicy:'together',text:'登记接送需求'}]});}
function publish(x){if(!x.fresh())x.action('generate');x.action('confirm');return x.data.activePlan;}
function ready(x){const p=publish(x),route=p.routes.find(r=>r.people),vehicleId=route.vehicleId,planId=p.id;x.action('field-progress',{stage:'ack',planId,vehicleId});x.action('field-contact-batch',{planId,vehicleId,householdIds:route.stops.map(st=>st.id)});x.action('start-vehicle',{planId,vehicleId});return route;}

test('registered total load deducts all crew and snapshots exact identifiers and special passenger counts',()=>{
  const staff=[{id:'D01',role:'driver',available:true},{id:'E01',role:'escort',available:true},{id:'E02',role:'escort',available:true}],x=registered({escortIds:['E01','E02']},staff);
  assert.equal(x.data.scenario.vehicles[0].capacity,5);add(x,5,2,2);
  assert.equal(x.data.plan.servedPeople,5);assert.equal(x.data.baseline.servedPeople,5);
  assert.deepEqual(x.data.plan.routes[0].resourceAssignment,{vehicleType:'accessible',model:'示例中型客车',totalCapacity:8,passengerCapacity:5,wheelchairSlots:2,driverId:'D01',escortIds:['E01','E02'],staffCount:3,assistancePeople:2,wheelchairPeople:2});
  assert.deepEqual(X.validate(X.snapshot(x.data),x.data.plan),[]);assert.doesNotThrow(()=>X.restore(x.data,{external:true}));
});

test('missing driver remains a registrable shortage and is not automatically filled by reserve staff',()=>{
  const x=registered({driverId:''});add(x);assert.equal(x.data.plan.servedPeople,0);assert.match(x.data.plan.unassigned[0].reason,/未分配司机/);assert.equal(X.diagnostics(x.data).unassigned[0].code,'staff-shortage');assert.equal(x.data.scenario.staff.find(s=>s.id==='R01').role,'reserve');assert.doesNotThrow(()=>X.restore(x.data));
});

test('assistance requires a present assigned escort and available seats include the escort occupancy',()=>{
  const x=registered({escortIds:[]});add(x,3,1,0);assert.equal(x.data.plan.servedPeople,0);assert.match(x.data.plan.unassigned[0].reason,/随车协助员/);
  const y=registered({totalCapacity:4,wheelchairSlots:0});add(y,3);assert.equal(y.data.scenario.vehicles[0].capacity,2);assert.equal(y.data.plan.servedPeople,0);assert.match(y.data.plan.unassigned[0].reason,/扣除司机/);
});

test('explicit wheelchair count is enforced in both exact solver and large insertion solver',()=>{
  const x=registered({wheelchairSlots:1});add(x,2,2,2);assert.equal(x.data.plan.servedPeople,0);assert.match(x.data.plan.unassigned[0].reason,/轮椅位不足/);
  const y=registered({totalCapacity:11,wheelchairSlots:2});y.action('command-intake',{source:'text',duplicateAcknowledged:true,rows:Array.from({length:9},(_,n)=>({villageId:'VA',pickupId:'P-A1',people:1,assistancePeople:Number(n<2),wheelchairPeople:Number(n<2),groupPolicy:'together',text:'第'+(n+1)+'组'}))});
  assert.match(y.data.plan.algorithm,/bounded/);assert.equal(y.data.plan.servedPeople,9);assert.equal(y.data.plan.routes[0].resourceAssignment.wheelchairPeople,2);assert.deepEqual(X.validate(X.snapshot(y.data),y.data.plan),[]);assert.doesNotThrow(()=>X.restore(y.data,{external:true}));
});

test('driver or escort absence pauses published work while preserving onboard passengers and assignment snapshots',()=>{
  for(const staffId of ['D01','E01']){
    const x=registered();add(x,3,1,0);const route=ready(x);x.action('step',{vehicleId:'V1'});const before=x.data,onboard=before.fleet.V1.onboard;
    x.action('resource-event',{kind:'staff',id:staffId,available:false,reason:'现场核实暂离岗'});
    assert.deepEqual(x.data.activePlan,before.activePlan);assert.deepEqual(x.data.fleet.V1.onboard,onboard);assert.equal(x.data.plan.routes[0].holding,true);assert.equal(X.blockedRoute(x.data,route),true);assert.throws(()=>x.action('step',{vehicleId:'V1'}),/暂停推进/);
    assert.ok(X.diagnostics(x.data).coordination.some(row=>row.key==='staff:'+staffId));assert.doesNotThrow(()=>X.restore(x.data,{external:true}));
    x.action('resource-event',{kind:'staff',id:staffId,available:true});assert.equal(X.blockedRoute(x.data,route),true);assert.throws(()=>x.action('step',{vehicleId:'V1'}),/暂停推进/);x.action('confirm');assert.deepEqual(x.data.fleet.V1.onboard,onboard);assert.doesNotThrow(()=>X.restore(x.data));
  }
});

test('reserve absence keeps unrelated active routes operational and cannot impersonate an assigned worker',()=>{
  const x=registered();add(x);const route=ready(x);x.action('resource-event',{kind:'staff',id:'R01',available:false});assert.equal(X.blockedRoute(x.data,route),false);assert.doesNotThrow(()=>x.action('step',{vehicleId:'V1'}));
  const before=x.data;assert.throws(()=>x.action('resource-event',{kind:'staff',id:'missing',available:false}),/不存在/);assert.deepEqual(x.data,before);
});

test('duplicate or wrong-role worker assignments reject atomically, and a full registry cannot downgrade to the old form',()=>{
  const x=registered(),before=x.data,base={resourceRegistryVersion:1,staff:before.scenario.staff,vehicles:before.scenario.vehicles,shelters:before.scenario.shelters};
  assert.throws(()=>x.action('configure-resources',{...base,vehicles:[base.vehicles[0],{...base.vehicles[0],id:'V2'}]}),/重复编组/);assert.deepEqual(x.data,before);
  assert.throws(()=>x.action('configure-resources',{...base,vehicles:[{...base.vehicles[0],driverId:'R01'}]}),/角色/);assert.deepEqual(x.data,before);
  assert.throws(()=>x.action('configure-resources',{vehicles:base.vehicles,shelters:base.shelters}),/旧配置覆盖/);assert.deepEqual(x.data,before);
  assert.throws(()=>x.action('edit',{kind:'vehicles',id:'V1',capacity:50,available:true,wheelchair:true}),/资源登记库/);assert.deepEqual(x.data,before);
});

test('published registry cannot be reassigned and new map task inherits staff without overwriting the archive',()=>{
  const x=registered();add(x);publish(x);const before=x.data;
  assert.throws(()=>x.action('configure-resources',{resourceRegistryVersion:1,staff:[],vehicles:before.scenario.vehicles,shelters:before.scenario.shelters}),/未发布/);assert.deepEqual(x.data,before);
  x.action('end-task',{mode:'stopped'});x.action('new-task',{seedMode:'blank',mapMode:'ruian-roads'});assert.equal(x.data.scenario.resourceRegistryVersion,1);assert.deepEqual(x.data.scenario.staff,before.scenario.staff);assert.deepEqual(x.data.scenario.vehicles,before.scenario.vehicles);assert.deepEqual(x.data.taskArchives[0].data.scenario.staff,before.scenario.staff);assert.doesNotThrow(()=>X.restore(x.data,{external:true}));
});

test('restore rejects modified derived capacities, assignment snapshots and duplicated worker identities',()=>{
  const x=registered();add(x,3,1,0);
  for(const mutate of [d=>d.scenario.vehicles[0].capacity++,d=>d.scenario.staff[1].id='D01',d=>d.plan.routes[0].resourceAssignment.driverId='R01',d=>d.plan.routes[0].resourceAssignment.wheelchairPeople=8,d=>d.planSnapshot.scenario.vehicles[0].capacity++]){
    const bad=x.data;mutate(bad);assert.throws(()=>X.restore(bad,{external:true}));
  }
});

test('legacy saved tasks preserve prior passenger capacity and are not silently assigned staff',()=>{
  const x=X.create();x.action('generate');assert.equal(x.data.scenario.resourceRegistryVersion,undefined);assert.equal(x.data.scenario.staff,undefined);assert.equal(x.data.plan.servedPeople,15);assert.ok(x.data.plan.routes.every(r=>r.resourceAssignment===undefined));assert.doesNotThrow(()=>X.restore(x.data,{external:true}));
});
