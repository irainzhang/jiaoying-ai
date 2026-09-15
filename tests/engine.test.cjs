const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../dist/engine.js');

function audit(s,p){
  assert.deepEqual(E.validatePlan(s,p),[]);
  const assigned=[],shelterLoads={};let served=0;
  for(const r of p.routes){
    const v=s.vehicles.find(v=>v.id===r.vehicleId);
    if(!r.stops.length)continue;
    assert.ok(v.available);
    const families=r.stops.map(st=>s.households.find(h=>h.id===st.id));
    const people=families.reduce((n,h)=>n+h.people,0);
    assert.ok(people<=v.capacity);
    assert.ok(families.filter(h=>h.wheelchair).length<=(v.wheelchair?1:0));
    assigned.push(...families.map(h=>h.id));served+=people;
    const sh=s.shelters.find(sh=>sh.id===r.shelterId);assert.ok(sh.available);
    shelterLoads[sh.id]=(shelterLoads[sh.id]||0)+people;
    let elapsed=0;
    r.segments.forEach((seg,i)=>{
      let travel=0;
      for(let j=1;j<seg.nodes.length;j++){
        const a=seg.nodes[j-1],b=seg.nodes[j];
        const road=s.edges.find(e=>e.open&&((e.from===a&&e.to===b)||(e.from===b&&e.to===a)));
        assert.ok(road,'each segment must traverse an open road');travel+=road.minutes;
      }
      assert.equal(travel,seg.minutes);elapsed+=travel;
      if(i<r.stops.length){assert.equal(elapsed,r.stops[i].arrival);elapsed+=families[i].service;}
    });
    assert.equal(elapsed,r.finish);
  }
  assert.equal(new Set(assigned).size,assigned.length);
  const all=[...assigned,...p.unassigned.map(h=>h.id)];
  assert.equal(new Set(all).size,all.length);
  assert.deepEqual([...all].sort(),s.households.map(h=>h.id).sort());
  assert.equal(served,p.servedPeople);
  for(const sh of s.shelters)assert.ok((shelterLoads[sh.id]||0)<=sh.capacity);
}

test('initial plan covers every household exactly once',()=>{
  const s=E.createScenario(),p=E.solve(s);audit(s,p);assert.equal(p.servedPeople,15);assert.equal(p.complete,true);assert.equal(p.unassigned.length,0);
});
test('shortest-path times match an independent Floyd-Warshall calculation',()=>{
  const s=E.createScenario(),ids=s.nodes.map(n=>n.id),d=ids.map((_,i)=>ids.map((_,j)=>i===j?0:Infinity));
  s.edges.find(e=>e.id==='east').open=false;
  for(const e of s.edges.filter(e=>e.open)){const a=ids.indexOf(e.from),b=ids.indexOf(e.to);d[a][b]=e.minutes;d[b][a]=e.minutes;}
  for(let k=0;k<ids.length;k++)for(let i=0;i<ids.length;i++)for(let j=0;j<ids.length;j++)d[i][j]=Math.min(d[i][j],d[i][k]+d[k][j]);
  for(let i=0;i<ids.length;i++)for(let j=0;j<ids.length;j++)assert.equal(E.shortestPath(s,ids[i],ids[j])?.minutes??Infinity,d[i][j]);
});
test('east bridge closure invalidates affected old routes and new plan uses north bridge',()=>{
  const s=E.createScenario(),old=E.solve(s);s.edges.find(e=>e.id==='east').open=false;
  assert.ok(E.validatePlan(s,old).includes('路径包含封闭道路'));
  const p=E.solve(s);audit(s,p);assert.ok(p.complete);assert.ok(p.routes.some(r=>r.segments.some(seg=>seg.edges.includes('north'))));
  assert.ok(p.routes.every(r=>r.segments.every(seg=>!seg.edges.includes('east'))));
});
test('all eight visible event combinations retain household and capacity invariants',()=>{
  for(let mask=0;mask<8;mask++){
    const s=E.createScenario();s.edges.find(e=>e.id==='east').open=!(mask&1);s.shelters[1].available=!(mask&2);s.vehicles[1].available=!(mask&4);
    const p=E.solve(s);audit(s,p);if(mask&6)assert.ok(!p.complete);if(mask&2)assert.ok(p.servedPeople<=10);if(mask&4)assert.ok(p.servedPeople<=10);
  }
});
test('both crossings closed leaves eastern households visibly unassigned',()=>{
  const s=E.createScenario();for(const e of s.edges)if(['east','north'].includes(e.id))e.open=false;
  const p=E.solve(s);audit(s,p);assert.deepEqual(p.unassigned.map(h=>h.id).sort(),['H3','H4','H5']);
  assert.ok(p.unassigned.every(h=>h.reason.includes('通行')));
});
test('zero resources returns an explicit empty plan without impossible routes',()=>{
  for(const kind of ['vehicles','shelters']){
    const s=E.createScenario();s[kind].forEach(item=>item.available=false);const p=E.solve(s);audit(s,p);
    assert.equal(p.servedPeople,0);assert.equal(p.unassigned.length,6);assert.equal(p.complete,false);
  }
});
test('wheelchair household is unassigned when no suitable vehicle exists',()=>{
  const s=E.createScenario();s.vehicles.forEach(v=>v.wheelchair=false);const p=E.solve(s);audit(s,p);
  assert.ok(p.unassigned.some(h=>h.id==='H2'&&h.reason.includes('适配')));
});
test('one wheelchair place cannot serve two wheelchair households on the same single trip',()=>{
  const s=E.createScenario();Object.assign(s.households.find(h=>h.id==='H5'),{wheelchair:true,assistance:true,priority:2,service:6});
  const p=E.solve(s);audit(s,p);assert.ok(!p.complete);assert.equal(p.unassigned.filter(h=>h.wheelchair).length,1);
});
test('repeated planning does not consume shelter capacity or change the scenario',()=>{
  const s=E.createScenario(),before=JSON.stringify(s),p=E.solve(s),again=E.solve(s);audit(s,again);
  assert.equal(JSON.stringify(s),before);assert.deepEqual(p.routes,again.routes);assert.equal(p.finish,again.finish);
});
test('additional assistance affects the model but never changes declared people',()=>{
  const s=E.createScenario();const h=s.households.find(h=>h.id==='H5');h.assistance=true;h.priority=2;h.service=5;
  const p=E.solve(s);audit(s,p);assert.ok(p.complete);assert.equal(p.totalPeople,15);
});
test('receipt demo separates acknowledgement, notification, and unverified arrival',()=>{
  assert.equal(E.parseReceipt('收到。').status,'已收到，行动未确认');
  const pending=E.parseReceipt('已通知，但家属还没到，需要人员陪同接送。');assert.equal(pending.needsAssistance,true);assert.equal(pending.unresolved,true);assert.equal(pending.completionConfirmed,false);
  const chair=E.parseReceipt('已通知，需要轮椅车辆接送。');assert.equal(chair.needsWheelchair,true);
  const arrived=E.parseReceipt('已到达安置点。');assert.ok(arrived.status.includes('待核验'));assert.equal(arrived.completionConfirmed,false);
  assert.equal(E.parseReceipt('无需轮椅接送。').needsWheelchair,false);
  assert.throws(()=>E.parseReceipt(''),/填写/);
});
test('invalid road weights and household sizes fail clearly',()=>{
  let s=E.createScenario();s.edges[0].minutes=-1;assert.throws(()=>E.solve(s),/道路数据/);
  s=E.createScenario();s.households[0].people=0;assert.throws(()=>E.solve(s),/家庭数据/);
});
test('baseline is independently feasible for every visible event combination',()=>{
  for(let mask=0;mask<16;mask++){
    const s=E.createScenario();s.edges.find(e=>e.id==='east').open=!(mask&1);s.edges.find(e=>e.id==='north').open=!(mask&2);s.vehicles[1].available=!(mask&4);s.shelters[1].available=!(mask&8);
    const before=JSON.stringify(s),p=E.baseline(s);audit(s,p);assert.equal(JSON.stringify(s),before);
    if(mask&1)assert.ok(p.routes.every(r=>r.segments.every(seg=>!seg.edges.includes('east'))));
    if(mask&2)assert.ok(p.routes.every(r=>r.segments.every(seg=>!seg.edges.includes('north'))));
  }
});
test('baseline respects edited sizes, zero capacity and wheelchair requirements',()=>{
  const fixtures=[s=>s.households[0].people=20,s=>s.vehicles.forEach(v=>v.capacity=0),s=>s.shelters.forEach(a=>a.capacity=0),s=>s.households.forEach(h=>h.wheelchair=true)];
  for(const mutate of fixtures){const s=E.createScenario();mutate(s);const p=E.baseline(s);audit(s,p);assert.ok(!p.complete);}
});
test('edited resources reject duplicate IDs and nonboolean availability',()=>{
  let s=E.createScenario();s.vehicles[1].id=s.vehicles[0].id;assert.throws(()=>E.solve(s),/唯一/);
  s=E.createScenario();s.shelters[0].available='yes';assert.throws(()=>E.baseline(s),/安置点/);
});
