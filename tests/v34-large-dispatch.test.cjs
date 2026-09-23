const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Module = require('node:module');
const Large = require('../dispatch-large.cjs');

// Load the actual production feasibility helpers without adding test-only exports
// to the exercise module or replacing them with a permissive mock.
const filename = path.join(__dirname, '..', 'exercise.cjs');
const helperModule = new Module(filename, module);
helperModule.filename = filename;
helperModule.paths = Module._nodeModulePaths(path.dirname(filename));
helperModule._compile(fs.readFileSync(filename, 'utf8') + '\nmodule.exports.routeBuilder=routeBuilder;module.exports.summarize=summarize;', filename);
const E = helperModule.exports;
const run = snapshot => Large.solve(snapshot, E);
const score = p => [-p.onboardCount, -p.urgentPeople, -p.assistedPeople, -p.servedPeople, p.wait, p.finish, p.drive];
const compare = (a, b) => {for (let k=0;k<a.length;k++) if(a[k]!==b[k]) return a[k]<b[k]?-1:1;return 0;};
function many(count=24) {
  const i = E.snapshot(E.initial());
  i.scenario.households = Array.from({length:count}, (_, k) => ({
    id:'G' + String(k+1).padStart(3, '0'), node:'H' + (k%6+1), name:'演练村组 ' + (k+1),
    people:1, risk:1, priority:1, assistance:false, wheelchair:false, service:2
  }));
  i.stage = Object.fromEntries(i.scenario.households.map(h => [h.id, 'waiting']));
  return i;
}
function valid(i, result) {
  for(const p of [result.plan,result.alternative].filter(Boolean)) {
    assert.deepEqual(E.validate(i,p), []);
    assert.equal(p.algorithm, Large.ALGORITHM);
    assert.equal(p.heuristic,true);
    assert.equal(p.optimality,'not-proven');
    assert.equal(p.servedPeople + p.unassigned.reduce((n,h)=>n+h.people,0), p.totalPeople);
    assert.equal(new Set(p.servedIds).size,p.servedIds.length);
  }
}

test('200 groups use a bounded search, conserve all people, and do not modify the input', () => {
  const i=many(200);
  i.scenario.vehicles.forEach(v=>v.capacity=100);
  i.scenario.shelters.forEach(sh=>sh.capacity=100);
  const before=structuredClone(i), result=run(i);
  valid(i,result);
  assert.equal(result.plan.totalPeople,200);
  assert.equal(result.plan.servedPeople,200);
  assert.equal(result.plan.complete,true);
  assert.equal(result.plan.evaluatedCandidates,9);
  assert.ok(result.plan.routeEvaluations<150000);
  assert.deepEqual(i,before);
});

test('deterministic routes are no worse than the same-snapshot retained baseline', () => {
  const i=many(40);
  i.scenario.households.forEach((h,k)=>{h.people=k%4+1;h.risk=k%3+1;h.assistance=k%5===0;});
  const first=run(i), second=run(i);
  valid(i,first);
  assert.deepEqual(first.plan.routes,second.plan.routes);
  assert.deepEqual(first.plan.unassigned,second.plan.unassigned);
  assert.equal(first.plan.selectedCandidate,second.plan.selectedCandidate);
  assert.ok(compare(score(first.plan),score(E.baseline(i)))<=0);
  if(first.alternative)assert.notDeepEqual(first.alternative.routes,first.plan.routes);
});

test('oversized together group stays unassigned and wheelchair capacity is never exceeded', () => {
  const i=many();
  i.scenario.households[0].people=30;
  for(const h of i.scenario.households.slice(1,5)){h.wheelchair=true;h.assistance=true;h.risk=3;}
  const result=run(i);valid(i,result);
  assert.ok(result.plan.unassigned.some(h=>h.id==='G001'&&h.people===30));
  assert.equal(result.plan.routes.filter(r=>r.passengerIds.some(id=>i.scenario.households.find(h=>h.id===id).wheelchair)).length,1);
  const servedChairs=result.plan.servedIds.filter(id=>i.scenario.households.find(h=>h.id===id).wheelchair);
  assert.equal(servedChairs.length,1);
});

test('boarded groups stay on their original vehicle and superseded/completed records remain excluded', () => {
  const i=many();
  i.stage.G001='boarded';i.stage.G002='superseded';i.stage.G003='verified';
  i.fleet.V2={node:'H1',minute:7,onboard:['G001'],delivered:[],finished:false};
  const result=run(i);valid(i,result);
  const locked=result.plan.routes.find(r=>r.vehicleId==='V2');
  assert.deepEqual(locked.onboard,['G001']);
  assert.ok(locked.passengerIds.includes('G001'));
  assert.ok(!locked.stops.some(st=>st.id==='G001'));
  assert.ok(!result.plan.routes.filter(r=>r.vehicleId!=='V2').some(r=>r.passengerIds.includes('G001')));
  assert.ok(!result.plan.servedIds.includes('G002')&&!result.plan.servedIds.includes('G003'));
  assert.equal(result.plan.totalPeople,22);
});

test('an isolated onboard vehicle is explicitly held and closed roads never enter a route', () => {
  const i=many();
  i.stage.G001='boarded';
  i.fleet.V1={node:'H1',minute:7,onboard:['G001'],delivered:[],finished:false};
  i.scenario.edges.filter(e=>e.from==='H1'||e.to==='H1').forEach(e=>e.open=false);
  const result=run(i);valid(i,result);
  const locked=result.plan.routes.find(r=>r.vehicleId==='V1');
  assert.equal(locked.holding,true);
  assert.deepEqual(locked.onboard,['G001']);
  assert.deepEqual(locked.passengerIds,[]);
  assert.ok(result.plan.unassigned.some(h=>h.id==='G001'&&h.stage==='boarded'));
  const closed=new Set(i.scenario.edges.filter(e=>!e.open).map(e=>e.id));
  assert.ok(result.plan.routes.every(r=>r.segments.every(seg=>seg.edges.every(id=>!closed.has(id)))));
});

test('shared shelter capacity includes previous arrivals and exhausted vehicles stay idle', () => {
  const i=many(40);
  i.scenario.shelters[0].capacity=10;i.occupancy.S1=8;
  i.scenario.shelters[1].capacity=12;i.occupancy.S2=11;
  i.scenario.vehicles[2].available=false;
  i.fleet.V2.finished=true;
  const result=run(i);valid(i,result);
  assert.ok(result.plan.servedPeople<=3);
  assert.equal(result.plan.routes.find(r=>r.vehicleId==='V2').people,0);
  assert.equal(result.plan.routes.find(r=>r.vehicleId==='V3').people,0);
  for(const sh of i.scenario.shelters) {
    const planned=result.plan.routes.filter(r=>r.shelterId===sh.id).reduce((n,r)=>n+r.people,0);
    assert.ok(planned+i.occupancy[sh.id]<=sh.capacity);
  }
});

test('no available destination preserves all demand as unassigned instead of claiming completion', () => {
  const i=many();i.scenario.shelters.forEach(sh=>sh.available=false);
  const result=run(i);valid(i,result);
  assert.equal(result.plan.servedPeople,0);
  assert.equal(result.plan.unassigned.length,24);
  assert.equal(result.plan.complete,false);
});
