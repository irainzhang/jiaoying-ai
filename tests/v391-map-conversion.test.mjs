import test from 'node:test';
import assert from 'node:assert/strict';
import {webcrypto} from 'node:crypto';
import {createRequire} from 'node:module';
import {createExerciseServer} from '../local-server.mjs';
const require=createRequire(import.meta.url),X=require('../exercise.cjs'),G=require('../geo-scenario.cjs');
const {createRuntime}=require('../dist/pages-runtime.js');
const clone=value=>structuredClone(value);

test('map conversion is available for an unpublished draft and retains its demand ledger',()=>{
  const x=X.create();x.action('generate');
  x.action('command-intake',{source:'text',rows:[{villageId:'VA',pickupId:'P-A1',people:6,assistancePeople:1,wheelchairPeople:0,groupPolicy:'splittable',text:'演示村新增6人'}]});
  const before=x.data;
  assert.deepEqual(G.conversionStatus(before),{allowed:true,alreadyRoads:false,reasons:[]});
  x.action('enable-road-map');
  assert.equal(x.data.exerciseId,before.exerciseId);assert.equal(X.metrics(x.data).people,21);assert.equal(x.data.villageReports.length,before.villageReports.length);assert.equal(x.data.activePlan,null);
  assert.equal(X.mapConversionStatus(x.data).alreadyRoads,true);assert.equal(X.mapConversionStatus(x.data).allowed,false);
});

test('published task exposes its actual plan and progress instead of relying on newly uploaded files',()=>{
  const x=X.create();x.action('generate');x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');
  x.action('step',{vehicleId:x.data.activePlan.routes.find(r=>r.people).vehicleId});
  const before=x.data,status=G.conversionStatus(before),messages=status.reasons.map(r=>r.message).join('；');
  assert.equal(status.allowed,false);assert.match(messages,new RegExp(before.activePlan.id));assert.match(messages,new RegExp('已上车 '+X.metrics(before).boarded+' 人'));assert.match(messages,/已有联系或接收登记 6 组、15 人/);
  assert.ok(status.reasons.some(r=>r.code==='vehicle-progress'));assert.throws(()=>x.action('enable-road-map'),/已有发布或执行进度/);assert.deepEqual(x.data,before);
});

test('all verified people do not silently erase their published plan or allow route replacement',()=>{
  const x=X.create();x.action('generate');x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');
  for(const r of x.data.activePlan.routes.filter(r=>r.people))while(!x.data.fleet[r.vehicleId].finished)x.action('step',{vehicleId:r.vehicleId});
  x.action('verify-arrivals',{ids:x.data.scenario.households.map(h=>h.id)});
  assert.equal(X.taskSummary(x.data).canComplete,true);assert.equal(G.conversionStatus(x.data).allowed,false);assert.ok(G.conversionStatus(x.data).reasons.some(r=>r.code==='published-plan'));
  assert.match(G.conversionStatus(x.data).reasons.find(r=>r.code==='person-progress').message,/已核验 15 人/);
});

test('displayed conversion blockers and conversion enforcement share every original constraint',()=>{
  const fixtures=[
    ['published-history',d=>d.history.push({id:'old-plan'})],
    ['execution-phase',d=>d.phase='executing'],
    ['person-progress',d=>d.stage.H1='arrived'],
    ['contacts',d=>d.contacts.H1.ack=true],
    ['vehicle-progress',d=>d.fleet[d.scenario.vehicles[0].id].minute=1],
    ['road-changes',d=>d.scenario.edges[0].open=false],
    ['road-changes',d=>d.reports.push({kind:'road',location:'H1'})],
    ['report-location',d=>d.reports.push({kind:'people',location:'missing'})],
    ['demand-location',d=>d.scenario.households[0].node='missing'],
    ['demand-location',d=>d.villages[0].pickups[0].node='missing'],
    ['demand-location',d=>d.scenario.vehicles[0].start='missing'],
    ['demand-location',d=>d.fleet[d.scenario.vehicles[0].id].node='missing'],
    ['demand-location',d=>d.scenario.shelters[0].id='missing']
  ];
  for(const [code,mutate] of fixtures){
    const d=X.initial();mutate(d);const before=clone(d),status=G.conversionStatus(d);
    assert.equal(status.allowed,false,code);assert.ok(status.reasons.some(r=>r.code===code),code);assert.throws(()=>G.convert(d));assert.deepEqual(d,before,code);
  }
});

test('explicit new real-road task archives the complete old task and keeps the known synthetic seed',()=>{
  const x=X.create();x.action('generate');x.action('confirm');
  assert.throws(()=>x.action('new-task',{mapMode:'ruian-roads'}),/先结束/);
  x.action('end-task',{mode:'stopped'});const closed=x.data;
  assert.ok(G.conversionStatus(closed).reasons.some(r=>r.code==='task-closed'));
  assert.throws(()=>x.action('new-task',{mapMode:'erase'}),/新任务地图/);assert.deepEqual(x.data,closed);
  x.action('new-task',{mapMode:'ruian-roads'});const next=x.data,archived=clone(closed);delete archived.taskArchives;
  assert.equal(next.scenario.region.mapKind,'osm-road-network');assert.equal(next.scenarioPreset,'ruian-roads');assert.equal(next.activePlan,null);assert.equal(X.metrics(next).people,15);assert.equal(X.metrics(next).waiting,15);
  assert.deepEqual(next.taskArchives[0].data,archived);assert.equal(next.taskLifecycle.status,'active');assert.doesNotThrow(()=>X.restore(next));
});

test('new-task same/default retains original map choice without silently converting it',()=>{
  for(const payload of [{},{mapMode:'same'}]){
    const x=X.create();x.action('end-task',{mode:'stopped'});x.action('new-task',payload);assert.equal(x.data.scenario.region.mapKind,'synthetic-topology');
  }
});

async function verifyTransport(get,post){
  let state=await get();assert.equal(state.mapConversion.allowed,true);
  state=await (await post(state,'confirm',{})).json();assert.equal(state.mapConversion.allowed,false);assert.ok(state.mapConversion.reasons.some(r=>r.code==='published-plan'));
  const blocked=await post(state,'enable-road-map',{});assert.equal(blocked.status,422);assert.deepEqual((await get()).data,state.data);
  const old=state;state=await (await post(state,'end-task',{mode:'stopped'})).json();assert.ok(state.mapConversion.reasons.some(r=>r.code==='task-closed'));
  assert.equal((await post(old,'new-task',{mapMode:'ruian-roads'})).status,409);
  const closed=state;state=await (await post(state,'new-task',{mapMode:'ruian-roads'})).json();assert.equal(state.mapConversion.alreadyRoads,true);assert.equal(state.data.taskArchives[0].exerciseId,closed.data.exerciseId);assert.equal(state.data.activePlan,null);
}

test('HTTP exposes precise conversion reasons and preserves revision checks on new road tasks',async t=>{
  const {server}=createExerciseServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port,get=()=>fetch(base+'/api/v3/state').then(r=>r.json());
  const post=(s,action,payload)=>fetch(base+'/api/v3/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:s.session,expectedRevision:s.data.revision,requestId:webcrypto.randomUUID(),action,payload})});
  await verifyTransport(get,post);
});

test('Pages exposes the same map conversion and archive behavior without a backend',async t=>{
  const sample=X.create();sample.action('generate');
  let saved={format:1,session:webcrypto.randomUUID(),data:sample.data,savedAt:new Date().toISOString(),seen:[]},tail=Promise.resolve();const storage={transact(update){const run=tail.then(()=>{const next=update(saved&&clone(saved));if(next.changed)saved=clone(next.record);return clone(next.value);});tail=run.catch(()=>{});return run;}};
  const environment={location:{href:'https://example.github.io/jiaoying-ai/'},crypto:webcrypto,Response,Headers,fetch(){throw new Error('Unexpected network');},setInterval,clearInterval};
  const runtime=createRuntime({Exercise:X,storage,environment});t.after(()=>runtime.close());
  const get=()=>runtime.fetch('/api/v3/state').then(r=>r.json());
  const post=(s,action,payload)=>runtime.fetch('/api/v3/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:s.session,expectedRevision:s.data.revision,requestId:webcrypto.randomUUID(),action,payload})});
  await verifyTransport(get,post);
});
