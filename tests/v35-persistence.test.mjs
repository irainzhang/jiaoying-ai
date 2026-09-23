import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm,rmdir,access} from 'node:fs/promises';
import {dirname,join,resolve,basename} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createExerciseServer} from '../local-server.mjs';
import Exercise from '../exercise.cjs';

const temporaryRoot=fileURLToPath(new URL('../tmp/',import.meta.url));

async function fixture(t){
  await mkdir(temporaryRoot,{recursive:true});
  const directory=await mkdtemp(join(temporaryRoot,'v35-persistence-test-'));
  const persistenceFile=join(directory,'exercise.json');
  const running=new Set();
  async function close(api){
    if(!running.delete(api))return;
    await new Promise((resolveClose,reject)=>{
      api.server.close(error=>error?reject(error):resolveClose());
      api.server.closeAllConnections();
    });
  }
  t.after(async()=>{
    await Promise.all([...running].map(close));
    // Cleanup is restricted to this test's newly-created repository temp folder.
    assert.equal(dirname(resolve(directory)),resolve(temporaryRoot));
    assert.match(basename(directory),/^v35-persistence-test-/);
    await rm(directory,{recursive:true,force:true});
  });
  async function open(){
    const instance=createExerciseServer({persistenceFile});
    await new Promise((resolveListen,reject)=>{
      instance.server.once('error',reject);
      instance.server.listen(0,'127.0.0.1',resolveListen);
    });
    const base='http://127.0.0.1:'+instance.server.address().port;
    const api={...instance,base,
      get:()=>fetch(base+'/api/v3/state').then(r=>r.json()),
      post:input=>fetch(base+'/api/v3/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input)})};
    running.add(api);return api;
  }
  return {directory,persistenceFile,open,close,read:()=>readFile(persistenceFile,'utf8').then(JSON.parse)};
}

const command=(state,action,payload,requestId)=>({session:state.session,expectedRevision:state.data.revision,requestId,action,payload});
const roadReport={kind:'road',location:'east',text:'持久化演练：现场报告倒树，尚待核实'};

test('a successful submitted feedback is durably stored with the returned state',async t=>{
  const f=await fixture(t),api=await f.open(),initial=await api.get();
  assert.equal(initial.capabilities.persistentStorage,true);
  const response=await api.post(command(initial,'report',roadReport,'save-feedback'));
  assert.equal(response.status,200);
  const committed=await response.json(),stored=await f.read();
  assert.equal(stored.format,1);
  assert.deepEqual(stored.data,committed.data);
  assert.equal(stored.savedAt,committed.savedAt);
  assert.ok(Number.isFinite(Date.parse(stored.savedAt)));
  assert.equal(stored.data.reports[0].text,roadReport.text);
  assert.equal(stored.data.reports[0].status,'pending');
  assert.equal(stored.data.scenario.edges.find(e=>e.id==='east').open,true);
  assert.deepEqual((await api.get()).data,committed.data);
  await assert.rejects(access(f.persistenceFile+'.writing'),{code:'ENOENT'});
});

test('closing and reopening restores committed content with a new session and rejects stale tabs',async t=>{
  const f=await fixture(t),first=await f.open(),initial=await first.get();
  const response=await first.post(command(initial,'report',roadReport,'restart-feedback'));
  assert.equal(response.status,200);
  const before=await response.json();
  await f.close(first);
  const second=await f.open(),after=await second.get();
  assert.notEqual(after.session,before.session);
  assert.deepEqual(after.data,before.data);
  assert.deepEqual((await f.read()).data,before.data);
  const stale=await second.post(command(before,'generate',{},'old-session-tab'));
  assert.equal(stale.status,409);
  assert.deepEqual((await second.get()).data,before.data);
});

test('malformed, unsupported and inconsistent saved files fail startup without being overwritten',async t=>{
  const f=await fixture(t);
  const inconsistent=Exercise.initial();
  inconsistent.occupancy.S1=1; // Nobody has arrived; a nonzero occupancy is contradictory.
  const cases=[
    ['malformed','{"format":1,"data":'],
    ['unsupported',JSON.stringify({format:999,savedAt:'2026-09-23T00:00:00.000Z',data:Exercise.initial()})],
    ['inconsistent',JSON.stringify({format:1,savedAt:'2026-09-23T00:00:00.000Z',data:inconsistent})]
  ];
  for(const [label,original] of cases){
    await writeFile(f.persistenceFile,original,'utf8');
    assert.throws(()=>createExerciseServer({persistenceFile:f.persistenceFile}),undefined,label);
    assert.equal(await readFile(f.persistenceFile,'utf8'),original,label+' file must remain unchanged');
    await assert.rejects(access(f.persistenceFile+'.writing'),{code:'ENOENT'});
  }
});

test('a real disk write failure returns 503 without committing, and the identical request can be retried',async t=>{
  const f=await fixture(t),api=await f.open(),before=await api.get();
  const storedBefore=await readFile(f.persistenceFile,'utf8');
  // A directory at the atomic-save target reliably causes a real filesystem error,
  // including on Windows where chmod-based permission tests are not reliable.
  const blockedPath=f.persistenceFile+'.writing';
  await mkdir(blockedPath);
  const input=command(before,'report',roadReport,'retry-after-disk-recovery');
  const failed=await api.post(input);
  assert.equal(failed.status,503);
  assert.match((await failed.json()).error,/未提交/);
  const afterFailure=await api.get();
  assert.deepEqual(afterFailure.data,before.data);
  assert.equal(afterFailure.savedAt,before.savedAt);
  assert.equal(await readFile(f.persistenceFile,'utf8'),storedBefore);
  await rmdir(blockedPath);
  const retried=await api.post(input);
  assert.equal(retried.status,200);
  const committed=await retried.json();
  assert.equal(committed.data.revision,before.data.revision+1);
  assert.equal(committed.data.reports.length,before.data.reports.length+1);
  assert.deepEqual((await f.read()).data,committed.data);
  const duplicate=await api.post(input);
  assert.equal(duplicate.status,200);
  assert.equal((await duplicate.json()).duplicate,true);
  assert.deepEqual((await api.get()).data,committed.data);
});

test('ordinary oversized actions are rejected while a complete export larger than 16 KB can restore',async t=>{
  const f=await fixture(t),api=await f.open(),before=await api.get();
  const oversized=command(before,'report',{...roadReport,text:'x'.repeat(17000)},'oversized-ordinary');
  assert.ok(Buffer.byteLength(JSON.stringify(oversized))>16384);
  assert.equal((await api.post(oversized)).status,413);
  assert.deepEqual((await api.get()).data,before.data);
  assert.deepEqual((await f.read()).data,before.data);

  const donor=Exercise.create();
  donor.action('generate');
  donor.action('report',{...roadReport,text:'导入场景：现场报告仍然等待核实'});
  const exported=donor.data;
  const importedInput=command(before,'restore',{data:exported},'restore-full-export');
  assert.ok(Buffer.byteLength(JSON.stringify(importedInput))>16384,'use a genuine full exercise export, not padding');
  const response=await api.post(importedInput);
  assert.equal(response.status,200,await response.clone().text());
  const after=await response.json();
  assert.equal(after.data.exerciseId,exported.exerciseId);
  assert.equal(after.data.revision,before.data.revision+1);
  assert.equal(after.data.reports[0].text,exported.reports[0].text);
  assert.equal(after.data.reports[0].status,'pending');
  assert.equal(after.data.activePlan,null,'importing must not publish an execution plan');
  assert.ok(after.data.plan,'remaining work is computed as an unconfirmed draft');
  assert.deepEqual((await f.read()).data,after.data);
});
