import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createExerciseServer} from '../local-server.mjs';

async function setup(t){
  const {server}=createExerciseServer({startMode:'blank'});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(()=>new Promise(resolve=>{server.close(resolve);server.closeAllConnections();}));
  const base='http://127.0.0.1:'+server.address().port;
  return {get:()=>fetch(base+'/api/v3/state').then(r=>r.json()),post:body=>fetch(base+'/api/v3/action',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})};
}
const request=(state,action,payload)=>({session:state.session,expectedRevision:state.data.revision,requestId:randomUUID(),action,payload});
function registration(){
  const staff=Array.from({length:150},(_,i)=>({id:'S'+String(i+1).padStart(3,'0'),role:i<30?'driver':i<120?'escort':'reserve',available:true}));
  const vehicles=Array.from({length:30},(_,i)=>({id:'V'+(i+1),name:'资源车 '+(i+1),model:'中型无障碍接送车（演练登记）',vehicleType:'accessible',totalCapacity:10,wheelchairSlots:2,driverId:staff[i].id,escortIds:staff.slice(30+i*3,33+i*3).map(s=>s.id),notes:'本次车辆容量已按当前布局登记，工作人员使用编号。'.repeat(7),start:'D',available:true}));
  return {resourceRegistryVersion:1,staff,vehicles,shelters:[{id:'S1',name:'演练接收点',capacity:500,available:true}]};
}

test('HTTP accepts a complete 150-worker 30-vehicle registry above 16 KiB and exposes staff events to another state reader',async t=>{
  const api=await setup(t),initial=await api.get(),payload=registration(),body=request(initial,'configure-resources',payload);
  const bytes=Buffer.byteLength(JSON.stringify(body));assert.ok(bytes>16384,'fixture must exercise the former request limit');assert.ok(bytes<262144);
  const savedResponse=await api.post(body),saved=await savedResponse.json();assert.equal(savedResponse.status,200,JSON.stringify(saved));
  assert.equal(saved.data.revision,initial.data.revision+1);assert.equal(saved.capabilities.resourceRegistry,true);
  assert.deepEqual(saved.data.scenario.staff,payload.staff);assert.equal(saved.data.scenario.vehicles.length,30);
  assert.ok(saved.data.scenario.vehicles.every(v=>v.capacity===6&&v.wheelchairSlots===2));
  const secondClient=await api.get();assert.deepEqual(secondClient.data.scenario,saved.data.scenario);
  const changeResponse=await api.post(request(secondClient,'resource-event',{kind:'staff',id:'S001',available:false,reason:'演练登记司机临时离岗'}));
  const changed=await changeResponse.json();assert.equal(changeResponse.status,200,JSON.stringify(changed));assert.equal(changed.data.revision,saved.data.revision+1);
  const member=changed.data.scenario.staff.find(s=>s.id==='S001');assert.equal(member.available,false);assert.match(member.unavailableReason,/临时离岗/);
  assert.equal(changed.data.scenario.vehicles.find(v=>v.id==='V1').resourceChangeVersion,changed.data.inputVersion);
  assert.equal(changed.data.scenario.staff.filter(s=>s.available).length,149);assert.deepEqual((await api.get()).data,changed.data);
  const resumeResponse=await api.post(request(changed,'resource-event',{kind:'staff',id:'S001',available:true})),resumed=await resumeResponse.json();assert.equal(resumeResponse.status,200);assert.equal(resumed.data.scenario.staff.find(s=>s.id==='S001').available,true);assert.deepEqual((await api.get()).data.scenario.staff,resumed.data.scenario.staff);
});

test('HTTP keeps the expanded registry bounded and ordinary resource events within the smaller request limit',async t=>{
  const api=await setup(t),initial=await api.get();
  const oversized=request(initial,'configure-resources',{...registration(),padding:'x'.repeat(262144)});assert.ok(Buffer.byteLength(JSON.stringify(oversized))>262144);
  const registryResponse=await api.post(oversized);assert.equal(registryResponse.status,413);assert.deepEqual((await api.get()).data,initial.data);
  const event=request(initial,'resource-event',{kind:'vehicle',id:'V1',available:false,reason:'x'.repeat(16384)});assert.ok(Buffer.byteLength(JSON.stringify(event))>16384);
  const eventResponse=await api.post(event);assert.equal(eventResponse.status,413);assert.deepEqual((await api.get()).data,initial.data);
});
