import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import http from 'node:http';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createExerciseServer} from '../local-server.mjs';
import {isPrivateAddress} from '../room-access.mjs';

const token='test-only-room-token-01234567890123456789';
const rawStatus=(url,headers)=>new Promise((resolve,reject)=>{const req=http.get(url,{headers},res=>{res.resume();res.on('end',()=>resolve(res.statusCode));});req.on('error',reject);});
async function room(t,options={}){
  const instance=createExerciseServer({startMode:'blank',sharedRoom:{roomId:'test-room',token,allowedHosts:['192.168.1.10']},...options});
  instance.server.listen(0,'127.0.0.1');await once(instance.server,'listening');
  t.after(()=>new Promise(resolve=>{instance.server.close(resolve);instance.server.closeAllConnections?.();}));
  return {...instance,url:'http://127.0.0.1:'+instance.server.address().port};
}
async function login(base,provided=token){
  const response=await fetch(base+'/api/v3/room/join',{method:'POST',headers:{Origin:base,'Content-Type':'application/json'},body:JSON.stringify({token:provided})});
  return {response,cookie:response.headers.get('set-cookie')?.split(';')[0]};
}
async function read(base,cookie){const response=await fetch(base+'/api/v3/state',{headers:{cookie}});return response.json();}
async function act(base,cookie,state,action,payload={},requestId='req-'+Math.random()){
  return fetch(base+'/api/v3/action',{method:'POST',headers:{cookie,Origin:base,'Content-Type':'application/json'},body:JSON.stringify({action,payload,requestId,session:state.session,expectedRevision:state.data.revision})});
}

test('LAN mode is opt-in; normal server rejects LAN Host and creates explicit blank only on request',async t=>{
  const instance=createExerciseServer({startMode:'blank'});instance.server.listen(0,'127.0.0.1');await once(instance.server,'listening');
  t.after(()=>new Promise(resolve=>instance.server.close(resolve)));
  const base='http://127.0.0.1:'+instance.server.address().port;
  assert.equal(await rawStatus(base+'/api/v3/state',{Host:'192.168.1.10'}),403);
  const state=await (await fetch(base+'/api/v3/state')).json();
  assert.equal(state.connection.mode,'local');assert.equal(state.capabilities.crossDeviceSync,false);
  assert.equal(state.data.scenario.households.length,0);assert.equal(state.data.scenario.region.mapKind,'osm-road-network');
});

test('LAN authentication guards state, events and static files, without exposing secret in join page',async t=>{
  const {url}=await room(t);
  assert.equal((await fetch(url+'/api/v3/state')).status,401);
  assert.equal((await fetch(url+'/api/v3/events')).status,401);
  const redirect=await fetch(url+'/',{redirect:'manual'});assert.equal(redirect.status,303);assert.equal(redirect.headers.get('location'),'/join');
  const page=await (await fetch(url+'/join')).text();assert.match(page,/type="password"/);assert.ok(!page.includes(token));assert.match(page,/history.replaceState/);
  assert.equal((await login(url,'bad')).response.status,401);
  const {response,cookie}=await login(url);assert.equal(response.status,200);
  assert.match(response.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const state=await read(url,cookie);assert.equal(state.connection.mode,'lan-room');assert.equal(state.connection.roomId,'test-room');assert.equal(state.capabilities.crossDeviceSync,true);
  assert.equal(state.data.scenario.households.length,0);assert.ok(!JSON.stringify(state).includes(token));
});

test('LAN state is isolated by per-process session cookies and rejects foreign/missing Origin and Host',async t=>{
  const first=await room(t),second=await room(t);const {cookie}=await login(first.url);
  assert.equal((await fetch(second.url+'/api/v3/state',{headers:{cookie}})).status,401);
  assert.equal(await rawStatus(first.url+'/api/v3/state',{cookie,Host:'attacker.test'}),403);
  assert.equal((await fetch(first.url+'/api/v3/state',{headers:{cookie,Origin:'https://irainzhang.github.io'}})).status,403);
  assert.equal((await fetch(first.url+'/api/v3/state',{headers:{cookie,'Sec-Fetch-Site':'cross-site'}})).status,401);
  assert.equal((await fetch(first.url+'/api/v3/room/join',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({token})})).status,403);
  assert.equal(isPrivateAddress('192.168.1.9'),true);assert.equal(isPrivateAddress('172.31.2.9'),true);assert.equal(isPrivateAddress('172.32.2.9'),false);assert.equal(isPrivateAddress('8.8.8.8'),false);
});

test('two joined clients share versioned actions over SSE; stale second-device action does not commit',async t=>{
  const {url}=await room(t),a=await login(url),b=await login(url);const before=await read(url,a.cookie);
  const abort=new AbortController();t.after(()=>abort.abort());
  const response=await fetch(url+'/api/v3/events',{headers:{cookie:b.cookie},signal:abort.signal});assert.equal(response.status,200);
  const reader=response.body.getReader(),decoder=new TextDecoder();let text=decoder.decode((await reader.read()).value);assert.match(text,/event: state/);
  const changed=await act(url,a.cookie,before,'weather',{rainfall:80});assert.equal(changed.status,200);const next=await changed.json();
  for(let tries=0;tries<5&&!text.includes(`id: ${next.session}:${next.data.revision}`);tries++)text+=decoder.decode((await reader.read()).value);
  assert.match(text,new RegExp(`id: ${next.session}:${next.data.revision}`));
  const observed=await read(url,b.cookie);assert.equal(observed.data.revision,next.data.revision);assert.deepEqual(observed.data.weather,next.data.weather);
  const conflict=await act(url,b.cookie,before,'weather',{rainfall:120});assert.equal(conflict.status,409);assert.equal((await read(url,a.cookie)).data.revision,next.data.revision);
  await reader.cancel();
});

test('LAN uses supplied independent persistence and restarts retain uploaded task state',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'jiaoying-room-'));t.after(()=>rm(dir,{recursive:true,force:true}));
  const file=join(dir,'room.json'),first=await room(t,{persistenceFile:file});const a=await login(first.url),before=await read(first.url,a.cookie);
  const changed=await act(first.url,a.cookie,before,'weather',{rainfall:160});assert.equal(changed.status,200);const after=await changed.json();
  const persisted=JSON.parse(await readFile(file,'utf8'));assert.equal(persisted.data.revision,after.data.revision);
  const second=await room(t,{persistenceFile:file});const b=await login(second.url),restored=await read(second.url,b.cookie);assert.equal(restored.data.revision,after.data.revision);assert.deepEqual(restored.data.weather,after.data.weather);assert.notEqual(restored.session,after.session);
});

test('LAN request size limits reject payloads before actions, preserving the current task',async t=>{
  const {url}=await room(t),{cookie}=await login(url);const before=await read(url,cookie);
  const oversized=await fetch(url+'/api/v3/room/join',{method:'POST',headers:{Origin:url,'Content-Type':'application/json'},body:JSON.stringify({token:'x'.repeat(2050)})});assert.equal(oversized.status,413);
  const action=await act(url,cookie,before,'weather',{rainfall:80,padding:'x'.repeat(17000)});assert.equal(action.status,413);assert.equal((await read(url,cookie)).data.revision,before.data.revision);
});
