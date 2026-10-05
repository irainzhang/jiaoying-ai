const test=require('node:test');
const assert=require('node:assert/strict');
const {webcrypto}=require('node:crypto');
const Exercise=require('../exercise.cjs');
const {createRuntime,createIndexedDBStorage}=require('../dist/pages-runtime.js');
const clone=x=>x===undefined?undefined:structuredClone(x);
// A serial, rollback-capable storage contract controls commit failures and races.
// Production IndexedDB behavior is additionally checked in browser QA.
function database(initial){
  let saved=clone(initial),tail=Promise.resolve();
  return {fail:false,get saved(){return clone(saved);},
    transact(update,signal){
      const work=tail.then(()=>{
        if(signal?.aborted)throw signal.reason;
        const next=update(clone(saved));if(this.fail)throw new Error('QuotaExceededError');
        if(next.changed)saved=clone(next.record);return clone(next.value);
      });tail=work.catch(()=>{});return work;
    }};
}
function setup(storage=database(),channels=null){
  const intervals=new Set();
  const env={location:{href:'https://example.github.io/jiaoying-ai/'},crypto:webcrypto,Response,Headers,
    fetch(){throw new Error('Unexpected network request');},setInterval(fn){intervals.add(fn);return fn;},clearInterval(fn){intervals.delete(fn);}};
  if(channels)env.BroadcastChannel=class {
    constructor(name){this.name=name;channels.add(this);}
    postMessage(data){for(const channel of channels)if(channel!==this&&channel.name===this.name)queueMicrotask(()=>channel.onmessage?.({data}));}
    close(){channels.delete(this);}
  };
  const api=createRuntime({Exercise,storage,environment:env});
  const get=()=>api.fetch('/api/v3/state').then(r=>r.json());
  const post=(state,action,payload={},requestId=webcrypto.randomUUID())=>api.fetch('/api/v3/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({session:state.session,expectedRevision:state.data.revision,action,payload,requestId})});
  return {api,storage,get,post,intervals};
}
const tick=()=>new Promise(resolve=>setImmediate(resolve));
const report={villageId:'VA',mode:'increment',people:7,pickupId:'P-A1',assistancePeople:2,wheelchairPeople:1,groupPolicy:'splittable',text:'演示村新增7人，2人协助，其中1人轮椅',reporter:'演示员',source:'voice'};

test('closing a task notifies both Pages tabs and rejects stale or closed writes without losing pending work',async()=>{
  const channels=new Set(),storage=database(),a=setup(storage,channels),b=setup(storage,channels),initial=await a.get();
  assert.equal(initial.capabilities.taskLifecycle,true);assert.equal(initial.taskSummary.canComplete,false);
  const pending=await (await a.post(initial,'village-report',report)).json(),received=[];
  const stream=new b.api.EventSource('/api/v3/events');stream.addEventListener('state',event=>received.push(JSON.parse(event.data)));await tick();
  const ended=await (await a.post(pending,'end-task',{mode:'stopped'},'close-task')).json();await tick();
  assert.equal(ended.data.taskLifecycle.status,'stopped');assert.equal(received.at(-1).data.taskLifecycle.status,'stopped');assert.equal(ended.taskSummary.pendingVillagePeople,7);
  assert.equal((await b.post(pending,'weather',{rainfall:80})).status,409);
  const refused=await b.post(ended,'field-progress',{stage:'ack'});assert.equal(refused.status,422);assert.match((await refused.json()).error,/已结束/);
  assert.equal((await a.post(pending,'end-task',{mode:'stopped'},'close-task')).status,200);assert.deepEqual((await a.get()).data,ended.data);
  const reopened=setup(storage);assert.equal((await reopened.get()).data.taskLifecycle.status,'stopped');await reopened.api.close();await a.api.close();await b.api.close();
});

test('new task is an atomic same-session revision and retry never creates an extra archive',async()=>{
  const a=setup(),initial=await a.get(),closed=await (await a.post(initial,'end-task',{mode:'stopped'})).json();
  a.storage.fail=true;assert.equal((await a.post(closed,'new-task',{},'new-task-once')).status,503);assert.equal(a.storage.saved.data.exerciseId,closed.data.exerciseId);a.storage.fail=false;
  const next=await (await a.post(closed,'new-task',{},'new-task-once')).json();assert.equal(next.session,closed.session);assert.equal(next.data.revision,closed.data.revision+1);assert.notEqual(next.data.exerciseId,closed.data.exerciseId);assert.equal(next.data.taskArchives.length,1);
  const reopened=setup(a.storage),duplicate=await reopened.post(closed,'new-task',{},'new-task-once');assert.equal((await duplicate.json()).duplicate,true);assert.equal((await reopened.get()).data.taskArchives.length,1);
  // Replaying the old closure also stays idempotent instead of closing this new task.
  assert.equal(next.data.taskLifecycle.status,'active');await reopened.api.close();await a.api.close();
});

test('fresh Pages visitors receive a zero-person road task; same store restores and separate visitors are isolated',async()=>{
  const a=setup(),initial=await a.get();
  assert.equal(initial.metrics.people,0);assert.equal(initial.metrics.waiting,0);assert.equal(initial.metrics.arrived,0);
  assert.equal(initial.data.plan,null);assert.equal(initial.data.seedMode,'blank');assert.equal(initial.data.scenario.region.mapKind,'osm-road-network');assert.equal(initial.capabilities.browserOnly,true);assert.equal(initial.capabilities.crossDeviceSync,false);
  const accepted=await (await a.post(initial,'weather',{preset:'strong'})).json();
  const reopened=await setup(a.storage).get();assert.deepEqual(reopened,accepted);
  const another=await setup().get();assert.notEqual(another.session,initial.session);assert.equal(another.data.weather.level,1);
});

test('a saved legacy sample is preserved instead of replaced by the new blank startup',async()=>{
  const old=Exercise.create();old.action('generate');old.action('confirm');const saved={format:1,session:'legacy-session',data:old.data,savedAt:'2026-10-04T01:00:00.000Z',seen:[]};
  const a=setup(database(saved)),current=await a.get();assert.deepEqual(current.data,saved.data);assert.equal(current.metrics.people,15);assert.equal(current.session,saved.session);assert.equal(current.connection.mode,'browser');
});

test('concurrent tabs cannot both commit against the same revision',async()=>{
  const storage=database(),a=setup(storage),b=setup(storage),initial=await a.get();
  const results=await Promise.all([a.post(initial,'weather',{preset:'strong'}),b.post(initial,'weather',{preset:'extreme'})]);
  assert.deepEqual(results.map(r=>r.status),[200,409]);
  const conflict=await results[1].json();assert.equal(conflict.data.revision,initial.data.revision+1);assert.equal(conflict.data.weather.level,2);
  assert.equal((await a.get()).data.revision,initial.data.revision+1);
});

test('idempotency survives reload and rejects changed bodies or stale sessions',async()=>{
  const a=setup(),initial=await a.get();
  assert.equal((await a.post(initial,'village-report',report,'same-request')).status,200);
  const reopened=setup(a.storage),duplicate=await reopened.post(initial,'village-report',report,'same-request');
  assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
  assert.equal((await reopened.get()).data.villageReports.length,1);
  assert.equal((await reopened.post(initial,'village-report',{...report,people:8},'same-request')).status,409);
  const current=await reopened.get();assert.equal((await reopened.post({...current,session:'old-session'},'reset')).status,409);
});

test('failed storage commit never reports success and retry with same request applies exactly once',async()=>{
  const a=setup(),initial=await a.get();a.storage.fail=true;
  const failed=await a.post(initial,'village-report',report,'quota-request');assert.equal(failed.status,503);
  assert.match((await failed.json()).error,/未确认保存/);assert.equal(a.storage.saved.data.revision,initial.data.revision);
  a.storage.fail=false;
  assert.equal((await a.post(initial,'village-report',report,'quota-request')).status,200);
  const current=await a.get();assert.equal(current.data.villageReports.length,1);assert.equal(current.data.revision,initial.data.revision+1);
});

test('village submission remains pending until review, then enters real solver without double counting',async()=>{
  const a=setup(),initial=await a.get();
  const pending=await (await a.post(initial,'village-report',report)).json();
  assert.equal(pending.metrics.people,0);assert.equal(pending.metrics.pendingVillagePeople,7);
  const id=pending.data.villageReports[0].id;
  const reviewed=await (await a.post(pending,'village-review',{id,decision:'accept',note:'演练核对通过，集合点和人数已确认'})).json();
  assert.equal(reviewed.metrics.people,7);assert.equal(reviewed.metrics.pendingVillagePeople,0);
  assert.deepEqual(Exercise.validate(Exercise.snapshot(reviewed.data),reviewed.data.plan),[]);
  assert.equal((await a.get()).metrics.people,7);
});

test('channel notification refreshes the other tab and fallback polling recovers missed messages',async()=>{
  const channels=new Set(),storage=database(),a=setup(storage,channels),b=setup(storage,channels),initial=await a.get();
  const received=[],stream=new b.api.EventSource('/api/v3/events');stream.addEventListener('state',e=>received.push(JSON.parse(e.data)));
  await tick();assert.equal(received.at(-1).data.revision,initial.data.revision);
  await a.post(initial,'village-report',report);await tick();
  assert.equal(received.at(-1).data.villageReports.length,1);
  for(const channel of channels)channel.onmessage=null;
  const current=await a.get();await a.post(current,'weather',{preset:'strong'});
  for(const fn of b.intervals)await fn();assert.equal(received.at(-1).data.weather.level,2);
  await b.api.close();assert.equal(b.intervals.size,0);await a.api.close();
});

test('invalid operations, malformed requests and corrupted persisted records do not overwrite data',async()=>{
  const a=setup(),initial=await a.get();
  assert.equal((await a.post(initial,'step',{vehicleId:'V1'})).status,422);assert.equal((await a.get()).data.revision,initial.data.revision);
  const malformed=await a.api.fetch('/api/v3/action',{method:'POST',headers:{'content-type':'application/json'},body:'{'});assert.equal(malformed.status,400);
  const bad=setup(database({format:0,data:{}})),unavailable=await bad.api.fetch('/api/v3/state');assert.equal(unavailable.status,503);assert.equal(bad.storage.saved.format,0);
});

test('unavailable IndexedDB fails explicitly; configured integrations do not invent model access',async()=>{
  await assert.rejects(createIndexedDBStorage(undefined,'test').transact(()=>{}),/存储不可用/);
  const a=setup();assert.equal((await a.api.fetch('/api/v3/agent')).status,501);
  const status=await (await a.api.fetch('/api/ai/status')).json();assert.equal(status.configured,false);
  const signal=AbortSignal.abort(new Error('cancelled'));await assert.rejects(a.api.fetch('/api/v3/state',{signal}),/cancelled/);
});
