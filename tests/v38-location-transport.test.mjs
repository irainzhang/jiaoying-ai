import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { createRequire } from 'node:module';
import { createExerciseServer } from '../local-server.mjs';
const require=createRequire(import.meta.url),Exercise=require('../exercise.cjs');
const {createRuntime}=require('../dist/pages-runtime.js');
const row={villageName:'上传待定位村',pickupName:'礼堂',people:2,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'测试上传待定位2人'};

async function verifyFlow(get,post){
  let state=await get();
  assert.equal(state.capabilities.mapDemandLocation,true);assert.equal(state.capabilities.roadMapConversion,true);assert.equal(state.capabilities.numericRainfall,true);
  const before=state;
  let response=await post(state,'enable-road-map',{});assert.equal(response.status,200);state=await response.json();
  assert.equal(state.data.exerciseId,before.data.exerciseId);assert.equal(state.data.scenario.region.mapKind,'osm-road-network');
  response=await post(state,'command-intake',{rows:[row],source:'file'});assert.equal(response.status,200);state=await response.json();
  const unlocated=state,id=state.data.villageReports[0].id;
  response=await post(state,'map-demand-locate',{id,nodeId:'H1'});assert.equal(response.status,200);state=await response.json();
  assert.equal(state.data.villageReports[0].locationNodeId,'H1');assert.equal(state.data.activePlan,null);assert.equal(state.metrics.people,17);
  assert.equal((await post(unlocated,'map-demand-locate',{id,nodeId:'H2'})).status,409);
  response=await post(state,'weather',{rainfall:50});assert.equal(response.status,200);state=await response.json();assert.equal(state.data.weather.rainfall,50);
  assert.equal((await post(state,'unsupported-location-action',{})).status,422);
}

test('local HTTP accepts road conversion, locating and numeric weather through normal versioned actions',async t=>{
  const {server}=createExerciseServer();await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>{server.closeAllConnections();server.close();});
  const base='http://127.0.0.1:'+server.address().port;
  const get=()=>fetch(base+'/api/v3/state').then(r=>r.json());
  const post=(s,action,payload)=>fetch(base+'/api/v3/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:s.session,expectedRevision:s.data.revision,requestId:webcrypto.randomUUID(),action,payload})});
  await verifyFlow(get,post);
});

test('Pages runtime accepts the same new actions while retaining stale-revision conflicts',async t=>{
  const sample=Exercise.create();sample.action('generate');
  let saved={format:1,session:webcrypto.randomUUID(),data:sample.data,savedAt:new Date().toISOString(),seen:[]},tail=Promise.resolve();
  const storage={transact(update){const run=tail.then(()=>{const next=update(saved&&structuredClone(saved));if(next.changed)saved=structuredClone(next.record);return structuredClone(next.value);});tail=run.catch(()=>{});return run;}};
  const environment={location:{href:'https://example.github.io/jiaoying-ai/'},crypto:webcrypto,Response,Headers,fetch(){throw new Error('No real network expected');},setInterval,clearInterval};
  const runtime=createRuntime({Exercise,storage,environment});t.after(()=>runtime.close());
  const get=()=>runtime.fetch('/api/v3/state').then(r=>r.json());
  const post=(s,action,payload)=>runtime.fetch('/api/v3/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:s.session,expectedRevision:s.data.revision,requestId:webcrypto.randomUUID(),action,payload})});
  await verifyFlow(get,post);
});
