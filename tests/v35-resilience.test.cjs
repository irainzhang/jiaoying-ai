'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const X=require('../exercise.cjs');
function ready(){const x=X.create();x.action('generate');x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');return x;}
const valid=x=>assert.deepEqual(X.validate(X.snapshot(x.data),x.data.plan),[]);

test('named scenarios replace one exercise atomically, advance revision and use actual solver constraints',()=>{
  const x=X.create();let revision=x.data.revision,id=x.data.exerciseId;
  for(const scenario of ['normal','road-closure','village-growth','resource-shortage','shelter-loss']){
    x.action('scenario',{id:scenario});assert.equal(x.data.revision,++revision);assert.notEqual(x.data.exerciseId,id);id=x.data.exerciseId;
    assert.equal(x.data.scenarioPreset,scenario);assert.equal(x.data.activePlan,null);valid(x);
    if(scenario==='village-growth'){assert.equal(X.metrics(x.data).people,27);assert.equal(x.data.villageReports[0].assistancePeople,3);assert.equal(x.data.villageReports[0].wheelchairPeople,1);assert.ok(x.data.plan.unassigned.length);}
    if(scenario==='road-closure')assert.equal(x.data.scenario.edges.find(e=>e.id==='east').open,false);
    if(scenario==='resource-shortage')assert.ok(x.data.plan.unassigned.some(h=>h.id==='H2'));
    if(scenario==='shelter-loss')assert.ok(x.data.plan.servedPeople<=12);
  }
  const before=x.data;assert.throws(()=>x.action('scenario',{id:'unknown'}));assert.deepEqual(x.data,before);
});
test('vehicle failure blocks current execution and holds actual onboard passengers in the original vehicle',()=>{
  const x=ready();x.action('step',{vehicleId:'V1'});const old=x.data.activePlan,onboard=x.data.fleet.V1.onboard;
  x.action('resource-event',{kind:'vehicle',id:'V1',available:false,reason:'现场已核实发动机故障'});valid(x);
  assert.deepEqual(x.data.activePlan,old);assert.deepEqual(x.data.fleet.V1.onboard,onboard);
  assert.equal(x.data.plan.routes.find(r=>r.vehicleId==='V1').holding,true);
  assert.ok(onboard.every(id=>x.data.plan.unassigned.some(h=>h.id===id&&h.stage==='boarded')));
  assert.equal(X.blockedRoute(x.data,old.routes.find(r=>r.vehicleId==='V1')),true);
  assert.throws(()=>x.action('step',{vehicleId:'V1'}),/暂停推进/);
  assert.ok(X.diagnostics(x.data).coordination.some(r=>r.key==='blocked:V1'));
  x.action('resource-event',{kind:'vehicle',id:'V1',available:true,reason:'维修完成，经人工核实可用'});valid(x);
  assert.deepEqual(x.data.fleet.V1.onboard,onboard);assert.ok(onboard.every(id=>x.data.plan.routes.find(r=>r.vehicleId==='V1').passengerIds.includes(id)));
  assert.throws(()=>x.action('step',{vehicleId:'V1'}),/暂停推进/);x.action('confirm');assert.doesNotThrow(()=>x.action('step',{vehicleId:'V1'}));
});
test('shelter failure also blocks pickup on a now invalid route and never erases existing occupancy',()=>{
  const x=ready(),r=x.data.activePlan.routes.find(r=>r.people),shelterId=r.shelterId;
  x.action('resource-event',{kind:'shelter',id:shelterId,available:false,reason:'现场核实暂停接收'});
  assert.throws(()=>x.action('step',{vehicleId:r.vehicleId}),/暂停推进/);assert.equal(x.data.stage[r.stops[0].id],'waiting');valid(x);
  const y=ready();while(!y.data.fleet.V1.finished)y.action('step',{vehicleId:'V1'});const occupancy=y.data.occupancy,node=y.data.fleet.V1.node;
  y.action('resource-event',{kind:'shelter',id:node,available:false,reason:'暂停新接收，既有入住记录保留'});assert.deepEqual(y.data.occupancy,occupancy);assert.doesNotThrow(()=>X.create(y.data));
});
test('responsibility resolution is a separate record and cannot reopen roads or verify people',()=>{
  const x=X.create();x.action('scenario',{id:'road-closure'});const before=x.data;
  x.action('followup',{key:'report:R1',owner:'演练值班员',note:'正在核查替代线路，明日反馈',dueAt:'2026-09-24T08:00:00+08:00',status:'working'});
  x.action('followup',{key:'report:R1',owner:'演练值班员',note:'电话沟通完成，通行状态仍待现场核实',dueAt:null,status:'resolved'});
  assert.equal(x.data.followups['report:R1'].status,'resolved');assert.deepEqual(x.data.stage,before.stage);assert.deepEqual(x.data.scenario.edges,before.scenario.edges);assert.equal(x.data.inputVersion,before.inputVersion);
  const previous=x.data;assert.throws(()=>x.action('followup',{key:'report:missing',owner:'x',note:'x',status:'resolved'}));assert.deepEqual(x.data,previous);
});
test('external import retains execution locks, revokes all published plans and recomputes the actual remaining work',()=>{
  const source=ready();source.action('step',{vehicleId:'V1'});source.action('generate');const imported=source.data;
  const target=X.create();target.action('generate');const before=target.data.revision;
  target.action('restore',{data:{data:imported,metrics:{people:999}}});assert.equal(target.data.revision,before+1);assert.equal(target.data.activePlan,null);assert.deepEqual(target.data.taskAcks,{});
  assert.equal(target.data.exerciseId,imported.exerciseId);assert.deepEqual(target.data.fleet,imported.fleet);assert.deepEqual(target.data.stage,imported.stage);valid(target);
  assert.throws(()=>target.action('step',{vehicleId:'V1'}),/没有可推进任务/);target.action('confirm');assert.doesNotThrow(()=>target.action('step',{vehicleId:'V1'}));
});
test('import preserves arrived and verified counts without double reserving shelter capacity',()=>{
  const source=ready();while(!source.data.fleet.V1.finished)source.action('step',{vehicleId:'V1'});source.action('verify',{id:source.data.fleet.V1.delivered[0]});
  const x=X.create();x.action('restore',{data:source.data});assert.deepEqual(x.data.occupancy,source.data.occupancy);assert.equal(X.metrics(x.data).verified,X.metrics(source.data).verified);valid(x);
});
const corruptions={
  'negative travel time':d=>d.scenario.edges[0].minutes=-1,
  'unknown edge endpoint':d=>d.scenario.edges[0].from='missing',
  'duplicate node':d=>d.scenario.nodes.push({...d.scenario.nodes[0]}),
  'invalid node position':d=>d.scenario.nodes[0].x='1',
  'resource availability string':d=>d.scenario.vehicles[0].available='yes',
  'negative capacity':d=>d.scenario.shelters[0].capacity=-1,
  'injected vehicle color':d=>d.scenario.vehicles[0].color='#fff\" onload=\"alert(1)',
  'unknown map type':d=>d.scenario.region.mapKind='foreign',
  'unknown people enum':d=>d.stage.H1='safe',
  'unaccounted onboard':d=>d.stage.H1='boarded',
  'invented occupancy':d=>d.occupancy.S1=2,
  'invalid household count':d=>d.scenario.households[0].people=1.5,
  'unbounded counter':d=>d.inputVersion=Number.MAX_SAFE_INTEGER,
  'malformed log message':d=>d.log[0].message={html:'oops'},
  'malformed note':d=>d.scenario.households[0].note={x:1},
  'missing delta rows':d=>d.lastDelta={time:new Date().toISOString()},
  'delta numeric injection':d=>d.lastDelta={time:new Date().toISOString(),rows:[{key:'people',before:'<img src=x>',after:15,delta:0}]},
  'delta unknown key':d=>d.lastDelta={time:new Date().toISOString(),rows:[{key:'<img src=x>',before:15,after:15,delta:0}]},
  'delta inconsistent arithmetic':d=>d.lastDelta={time:new Date().toISOString(),rows:[{key:'people',before:15,after:20,delta:500}]},
  'malformed planning steps':d=>d.plan.steps='not-an-array',
  'missing baseline':d=>d.baseline=null,
  'malformed plan snapshot arrays':d=>d.planSnapshot.scenario.households={},
  'malformed village pickup array':d=>d.villages[0].pickups='not-an-array',
  'injected pickup identifier':d=>d.villages[0].pickups[0].id='x\" onclick=\"alert(1)',
  'invalid plan result':d=>d.plan.servedPeople=123,
  'wrong path direction':d=>{const seg=d.plan.routes.find(r=>r.people).segments[0];seg.nodes.reverse();},
  'malformed followup':d=>d.followups={bad:{owner:123,note:'bad',status:'resolved',dueAt:null}},
  'prototype injection':d=>Object.defineProperty(d.contacts,'__proto__',{value:{polluted:true},enumerable:true}),
  'overlong text':d=>d.lastAnnouncement='x'.repeat(20001)
};
for(const [name,mutate] of Object.entries(corruptions))test('bad import is rejected atomically: '+name,()=>{
  const target=X.create();target.action('generate');const before=target.data,bad=structuredClone(before);mutate(bad);assert.throws(()=>target.action('restore',{data:bad}));assert.deepEqual(target.data,before);
});
test('legacy identity is stable across independent hydrations and new scenes get distinct IDs',()=>{
  const d=X.initial();delete d.exerciseId;delete d.createdAt;delete d.followups;
  assert.equal(X.create(d).data.exerciseId,X.create(d).data.exerciseId);assert.equal(X.create(d).data.createdAt,X.create(d).data.createdAt);
});
test('geographic imports validate coordinate ranges, bounds, geometry endpoints and renderable array types',()=>{
  const source=X.create();source.action('scenario',{id:'ruian-roads'});const target=X.create(),before=target.data;
  const mutations=[
    d=>{d.scenario.nodes[0].latitude=100;},
    d=>{d.scenario.nodes[0].longitude=null;},
    d=>{d.scenario.region.bounds='not-an-array';},
    d=>{d.scenario.edges[0].geometry=[['x',27],[120,27]];},
    d=>{d.scenario.edges[0].geometry[0][0]+=.01;},
    d=>{d.scenario.edges[0].osmWayIds={join:'fake'};},
    d=>{d.scenario.region.coordinateSystem='unknown';}
  ];
  for(const mutate of mutations){const bad=source.data;mutate(bad);assert.throws(()=>target.action('restore',{data:bad}));assert.deepEqual(target.data,before);}
  assert.doesNotThrow(()=>target.action('restore',{data:source.data}));valid(target);
});
test('diagnostics compare the same snapshot and explain resource shortfalls without making up safe outcomes',()=>{
  const x=X.create();x.action('scenario',{id:'resource-shortage'});const d=X.diagnostics(x.data);
  assert.equal(d.constraints.ok,true);assert.equal(d.comparison.sameSnapshot,true);assert.equal(d.comparison.rows.length,3);assert.ok(d.unassigned.some(h=>h.code==='vehicle-fit'&&h.next.includes('轮椅')));assert.ok(d.coordination.some(t=>t.key==='contact:H1'));
  assert.ok(d.comparison.assistedWait.baseline>=0);assert.ok(d.planB.scope.includes('重算'));
});
