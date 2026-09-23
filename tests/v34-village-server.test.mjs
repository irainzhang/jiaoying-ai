import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {createExerciseServer} from '../local-server.mjs';

async function setup(t) {
  const instance=createExerciseServer();
  await new Promise(resolve=>instance.server.listen(0,'127.0.0.1',resolve));
  const base='http://127.0.0.1:'+instance.server.address().port;
  const clients=[];
  t.after(()=>new Promise(resolve=>{clients.forEach(client=>client.close());instance.server.close(resolve);instance.server.closeAllConnections();}));
  const api={...instance,base,clients,
    get:()=>fetch(base+'/api/v3/state').then(r=>r.json()),
    post:body=>fetch(base+'/api/v3/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};
  api.command=await subscribe(base);api.field=await subscribe(base);clients.push(api.command,api.field);
  api.current=(await api.command.next()).data;
  assert.deepEqual((await api.field.next()).data,api.current);
  api.change=async(action,payload,requestId=crypto.randomUUID())=>{
    const body={session:api.current.session,expectedRevision:api.current.data.revision,requestId,action,payload};
    const response=await api.post(body),json=await response.json();
    assert.equal(response.status,200,JSON.stringify(json));
    const [command,field]=await Promise.all([api.command.next(),api.field.next()]);
    assert.deepEqual(command,field);
    assert.deepEqual(command.data,json);
    assert.equal(json.data.revision,api.current.data.revision+1);
    api.current=json;
    return {body,state:json};
  };
  return api;
}

function subscribe(base) {
  return new Promise((resolve,reject)=>{
    const request=http.get(base+'/api/v3/events',response=>{
      let buffer='';const queue=[],waiters=[],messages=[];
      const stream={messages,close:()=>request.destroy(),next:()=>queue.length?Promise.resolve(queue.shift()):new Promise((resolveNext,rejectNext)=>{
        const waiter={resolve:resolveNext,timer:setTimeout(()=>{const index=waiters.indexOf(waiter);if(index>=0)waiters.splice(index,1);rejectNext(new Error('Village SSE update timed out'));},2500)};
        waiters.push(waiter);
      })};
      response.setEncoding('utf8');response.on('data',chunk=>{
        buffer+=chunk;let end;
        while((end=buffer.indexOf('\n\n'))>=0){
          const lines=buffer.slice(0,end).split('\n');buffer=buffer.slice(end+2);
          const data=lines.filter(line=>line.startsWith('data: ')).map(line=>line.slice(6)).join('\n');
          if(!data)continue;
          const message={id:lines.find(line=>line.startsWith('id: '))?.slice(4),data:JSON.parse(data)};
          messages.push(message);const next=waiters.shift();if(next){clearTimeout(next.timer);next.resolve(message);}else queue.push(message);
        }
      });
      resolve(stream);
    });request.on('error',reject);
  });
}
const report=(extra={})=>({villageId:'VA',mode:'increment',people:20,pickupId:'',assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown',source:'voice',reporter:'村级演练员',text:'演示村A新增20人，集合点和协助需求待核实',...extra});

test('both pages receive report, verified unplanned demand, and complete dispatch groups without double counting',async t=>{
  const api=await setup(t);
  assert.equal(api.current.capabilities.villageReporting,true);
  await api.change('confirm',{});
  const published=structuredClone(api.current.data.activePlan),initialPeople=api.current.metrics.people;
  await api.change('village-report',report());
  const id=api.current.data.villageReports[0].id;
  assert.equal(api.current.metrics.people,initialPeople);
  assert.equal(api.current.metrics.pendingVillagePeople,20);
  assert.equal(api.current.villageLedger.find(v=>v.villageId==='VA').pendingPeople,20);
  assert.equal(api.current.data.fieldEvents[0].villageReportId,id);
  assert.equal(api.current.data.fieldEvents[0].source,'voice');
  await api.change('village-review',{id,decision:'accept',note:'人数已电话复核，点位和需求仍待补充'});
  assert.equal(api.current.metrics.people,initialPeople+20);
  assert.equal(api.current.metrics.waiting,initialPeople+20);
  assert.equal(api.current.metrics.unplannedPeople,20);
  assert.equal(api.current.metrics.pendingVillagePeople,0);
  assert.equal(api.current.data.villageReports[0].householdIds.length,0);
  assert.ok(api.current.data.plan.unassigned.some(row=>row.batchId===id&&row.people===20));
  assert.deepEqual(api.current.data.activePlan,published);
  await api.change('village-complete',{id,pickupId:'P-A1',assistancePeople:3,wheelchairPeople:1,groupPolicy:'splittable',note:'村委会集合，确认3人协助含1名轮椅人员，独立人员可分车'});
  assert.equal(api.current.metrics.people,initialPeople+20);
  assert.equal(api.current.metrics.waiting,initialPeople+20);
  assert.equal(api.current.metrics.unplannedPeople,0);
  const groups=api.current.data.scenario.households.filter(h=>h.sourceBatchId===id);
  assert.equal(groups.reduce((n,h)=>n+h.people,0),20);
  assert.equal(groups.reduce((n,h)=>n+h.assistancePeople,0),3);
  assert.equal(groups.reduce((n,h)=>n+h.wheelchairPeople,0),1);
  assert.ok(groups.every(h=>h.people<=4&&api.current.data.stage[h.id]==='waiting'));
  assert.equal(api.current.data.plan.heuristic,true);
  assert.equal(api.current.data.plan.servedPeople+api.current.data.plan.unassigned.reduce((n,h)=>n+h.people,0),initialPeople+20);
  assert.deepEqual(api.current.data.activePlan,published);
  const late=await subscribe(api.base);api.clients.push(late);
  assert.deepEqual((await late.next()).data,api.current);
});

test('snapshot observations never add people, and retried request IDs are idempotent on both SSE pages',async t=>{
  const api=await setup(t),initial=api.current.metrics;
  const {body}=await api.change('village-report',report({mode:'snapshot',people:99,scope:'waiting',observedAt:'2026-09-22T10:00:00.000Z',text:'清点时本村当前还有99人待转移'}),'village-observation-once');
  const snapshotId=api.current.data.villageReports[0].id;
  await api.change('village-review',{id:snapshotId,decision:'accept',note:'记录当前清点口径，仍需核对具体批次'});
  assert.equal(api.current.metrics.people,initial.people);
  assert.equal(api.current.metrics.waiting,initial.waiting);
  assert.equal(api.current.metrics.pendingVillagePeople,0);
  assert.equal(api.current.villageLedger.find(v=>v.villageId==='VA').latestSnapshot.people,99);
  const before=api.current,commandCount=api.command.messages.length,fieldCount=api.field.messages.length;
  const retried=await api.post(body),result=await retried.json();
  assert.equal(retried.status,200);assert.equal(result.duplicate,true);
  assert.equal(result.data.revision,before.data.revision);
  assert.equal(result.data.villageReports.length,1);
  const changedBody=await api.post({...body,payload:{...body.payload,people:100}});
  assert.equal(changedBody.status,409);
  await delay(80);
  assert.equal(api.command.messages.length,commandCount);
  assert.equal(api.field.messages.length,fieldCount);
  assert.deepEqual((await api.get()).metrics,before.metrics);
});

test('unknown-point duplicate requires explicit acknowledgement and failed attempts broadcast no extra batch',async t=>{
  const api=await setup(t);
  await api.change('village-report',report({people:8}));
  const before=api.current,counts=[api.command.messages.length,api.field.messages.length];
  const attempt={session:before.session,expectedRevision:before.data.revision,requestId:'possible-duplicate',action:'village-report',payload:report({people:8})};
  const denied=await api.post(attempt),failure=await denied.json();
  assert.equal(denied.status,422);assert.match(failure.error,/疑似重复/);
  await delay(80);
  assert.deepEqual([api.command.messages.length,api.field.messages.length],counts);
  await api.change('village-report',report({people:8,duplicateAcknowledged:true,text:'已核对是另一批独立人员'}));
  assert.equal(api.current.data.villageReports.length,2);
  assert.equal(api.current.metrics.pendingVillagePeople,16);
  assert.equal(api.current.metrics.people,15);
  assert.equal(api.current.data.villageReports[0].possibleDuplicateOf,api.current.data.villageReports[1].id);
});
