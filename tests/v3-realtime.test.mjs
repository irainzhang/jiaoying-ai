import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import {setTimeout as delay} from 'node:timers/promises';
import {createExerciseServer} from '../local-server.mjs';

async function setup(t,options){
  const instance=createExerciseServer(options),{server}=instance;
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  return {...instance,base,get:()=>fetch(base+'/api/v3/state').then(r=>r.json()),post:body=>fetch(base+'/api/v3/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};
}

function subscribe(base,headers={}){
  return new Promise((resolve,reject)=>{
    const request=http.get(base+'/api/v3/events',{headers},response=>{
      let buffer='',ended=false;const messages=[],queue=[],waiters=[];
      const finish=()=>{ended=true;for(const waiter of waiters.splice(0)){clearTimeout(waiter.timer);waiter.reject(new Error('SSE connection ended'));}};
      const stream={status:response.statusCode,headers:response.headers,messages,close:()=>request.destroy(),
        next(timeoutMs=2000){if(queue.length)return Promise.resolve(queue.shift());if(ended)return Promise.reject(new Error('SSE connection ended'));
          return new Promise((resolveNext,rejectNext)=>{const waiter={resolve:resolveNext,reject:rejectNext,timer:null};waiter.timer=setTimeout(()=>{const index=waiters.indexOf(waiter);if(index>=0)waiters.splice(index,1);rejectNext(new Error('Timed out waiting for SSE event'));},timeoutMs);waiters.push(waiter);});}};
      response.setEncoding('utf8');response.on('data',chunk=>{
        buffer+=chunk;let end;
        while((end=buffer.indexOf('\n\n'))>=0){const frame=buffer.slice(0,end);buffer=buffer.slice(end+2);const lines=frame.split('\n'),data=lines.filter(x=>x.startsWith('data: ')).map(x=>x.slice(6)).join('\n');if(!data)continue;
          const message={event:lines.find(x=>x.startsWith('event: '))?.slice(7),id:lines.find(x=>x.startsWith('id: '))?.slice(4),data:JSON.parse(data)};
          messages.push(message);const waiter=waiters.shift();if(waiter){clearTimeout(waiter.timer);waiter.resolve(message);}else queue.push(message);
        }
      });
      response.on('end',finish);response.on('close',finish);response.on('error',finish);resolve(stream);
    });request.on('error',reject);
  });
}

test('SSE immediately sends a complete snapshot and broadcasts the committed feedback to both pages',async t=>{
  const api=await setup(t),command=await subscribe(api.base),field=await subscribe(api.base);
  t.after(()=>{command.close();field.close();});
  assert.equal(command.status,200);assert.match(command.headers['content-type'],/text\/event-stream/);
  const first=(await command.next()).data,fieldFirst=await field.next();
  assert.equal(fieldFirst.event,'state');assert.equal(fieldFirst.id,`${first.session}:${first.data.revision}`);
  assert.equal(first.transport.eventsUrl,'/api/v3/events');assert.equal(first.capabilities.realtimeEvents,true);
  const response=await api.post({session:first.session,expectedRevision:first.data.revision,requestId:'live-report-1',action:'report',payload:{kind:'road',location:'east',text:'现场网页语音确认：东侧演练道路有倒树'}});
  assert.equal(response.status,200);
  const [commandUpdate,fieldUpdate]=await Promise.all([command.next(),field.next()]);
  assert.deepEqual(commandUpdate,fieldUpdate);assert.equal(commandUpdate.data.data.revision,first.data.revision+1);
  assert.equal(commandUpdate.data.data.reports[0].text,'现场网页语音确认：东侧演练道路有倒树');
  assert.equal(commandUpdate.data.data.reports[0].status,'pending');
  assert.equal(commandUpdate.data.data.scenario.edges.find(e=>e.id==='east').open,true);
  const later=await subscribe(api.base,{'Last-Event-ID':fieldFirst.id});t.after(()=>later.close());
  assert.deepEqual((await later.next()).data,commandUpdate.data);
});

test('failed and duplicated actions do not produce an extra SSE update',async t=>{
  const api=await setup(t),client=await subscribe(api.base);t.after(()=>client.close());const first=(await client.next()).data;
  const input={session:first.session,expectedRevision:first.data.revision,requestId:'live-dedupe',action:'report',payload:{kind:'road',location:'east',text:'重复提交测试'}};
  assert.equal((await api.post(input)).status,200);const committed=(await client.next()).data;
  const duplicate=await api.post(input);assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
  assert.equal((await api.post({...input,requestId:'stale'})).status,409);
  assert.equal((await api.post({...input,payload:{...input.payload,text:'不同内容'}})).status,409);
  assert.equal((await api.post({...input,expectedRevision:committed.data.revision,requestId:'bad-action',action:'does-not-exist'})).status,422);
  await delay(100);assert.equal(client.messages.length,2);assert.equal((await api.get()).data.revision,committed.data.revision);
});

test('SSE validates origin and host, bounds live connections, and frees disconnected slots',async t=>{
  const api=await setup(t);
  const forbiddenOrigin=await subscribe(api.base,{Origin:'https://unrelated.example'});assert.equal(forbiddenOrigin.status,403);forbiddenOrigin.close();
  const forbiddenHost=await subscribe(api.base,{Host:'unrelated.example'});assert.equal(forbiddenHost.status,403);forbiddenHost.close();
  const clients=[];t.after(()=>clients.forEach(client=>client.close()));
  for(let i=0;i<24;i++){const client=await subscribe(api.base);clients.push(client);assert.equal(client.status,200);await client.next();}
  const overflow=await subscribe(api.base);assert.equal(overflow.status,503);overflow.close();
  clients[0].close();await delay(30);
  const replacement=await subscribe(api.base);clients.push(replacement);assert.equal(replacement.status,200);await replacement.next();
});

test('closing the service ends SSE responses without waiting forever for open pages',async t=>{
  const api=await setup(t),client=await subscribe(api.base);t.after(()=>client.close());await client.next();
  let timeout;
  try{await Promise.race([new Promise((resolve,reject)=>api.server.close(error=>error?reject(error):resolve())),new Promise((_,reject)=>{timeout=setTimeout(()=>reject(new Error('server.close was blocked by SSE')),1000);})]);}
  finally{clearTimeout(timeout);}
  assert.equal(api.server.listening,false);
});

test('restored state keeps the exact data and revision without auto-generating a replacement plan',async t=>{
  const previous=await setup(t);previous.store.action('report',{kind:'road',location:'east',text:'升级前尚未核实的反馈'});
  const initialData=previous.store.data,restored=await setup(t,{initialData}),snapshot=await restored.get();
  assert.deepEqual(snapshot.data,initialData);assert.notEqual(snapshot.session,previous.session);
  const events=await subscribe(restored.base);t.after(()=>events.close());assert.deepEqual((await events.next()).data.data,initialData);
});
