import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';
import {createExerciseServer} from '../local-server.mjs';
import {createRoomAccess} from '../room-access.mjs';
const require=createRequire(import.meta.url),E=require('../exercise.cjs'),G=require('../dist/resource-registry.js');
const commanderToken='test-commander-private-token-01234567890123456789';
async function setup(t){
  const e=E.create();const s=e.data.scenario,registry=G.demoStaffAndAssignments(s.vehicles);
  e.action('configure-resources',{resourceRegistryVersion:1,...registry,shelters:s.shelters});e.action('confirm');
  const instance=createExerciseServer({initialData:e.data,semanticConfig:{configured:false},sharedRoom:{roomId:'role-test',token:commanderToken,allowedHosts:['192.168.1.10']}});
  await new Promise(r=>instance.server.listen(0,'127.0.0.1',r));t.after(()=>new Promise(r=>{instance.server.close(r);instance.server.closeAllConnections();}));
  const base='http://127.0.0.1:'+instance.server.address().port;
  const request=(path,cookie,body)=>fetch(base+path,{headers:{...(cookie?{cookie}:{}),...(body?{Origin:base,'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});
  const login=async token=>{const response=await request('/api/v3/room/join',null,{token});return {response,cookie:response.headers.get('set-cookie')?.split(';')[0],body:await response.json()};};
  const commander=await login(commanderToken);assert.equal(commander.response.status,200);
  const read=async cookie=>{const res=await request('/api/v3/state',cookie);assert.equal(res.status,200);return res.json();};
  const act=async(cookie,state,action,payload={},requestId=randomUUID())=>request('/api/v3/action',cookie,{session:state.session,expectedRevision:state.data.revision,requestId,action,payload});
  const full=await read(commander.cookie),route=full.data.activePlan.routes.find(r=>r.people>0),vehicle=full.data.scenario.vehicles.find(v=>v.id===route.vehicleId);
  const invitationResponse=await request('/api/v3/room/invitations',commander.cookie,{vehicleId:vehicle.id,staffId:vehicle.driverId});assert.equal(invitationResponse.status,200);const invitation=await invitationResponse.json(),field=await login(invitation.joinPath.split('#')[1]);assert.equal(field.response.status,200);
  return {base,instance,request,login,read,act,commander,field,invitation,full,vehicle,route};
}
test('computer issues distinct bound field links; field cannot list, create or elevate invitations',async t=>{
  const x=await setup(t);assert.equal(x.commander.body.connection.role,'commander');assert.equal(x.field.body.connection.role,'field');assert.equal(x.field.body.connection.vehicleId,x.vehicle.id);assert.equal(x.field.body.connection.staffId,x.vehicle.driverId);
  assert.ok(!x.invitation.joinPath.includes(commanderToken));
  const managed=await x.request('/room/manage',x.commander.cookie);assert.equal(managed.status,200);assert.match(await managed.text(),/生成现场端链接/);
  for(const path of ['/room/manage','/api/v3/room/invitations'])assert.equal((await x.request(path,x.field.cookie)).status,403);
  assert.equal((await x.request('/api/v3/room/invitations',x.field.cookie,{vehicleId:x.vehicle.id,staffId:x.vehicle.driverId,role:'commander'})).status,403);
  const forged=await x.request('/api/v3/room/join',null,{token:x.invitation.joinPath.split('#')[1],role:'commander',vehicleId:'V2'});assert.equal((await forged.json()).connection.role,'field');
  const listing=await (await x.request('/api/v3/room/invitations',x.commander.cookie)).json();assert.equal(listing.invitations.length,1);assert.ok(!JSON.stringify(listing).includes(x.invitation.joinPath.split('#')[1]));assert.ok(!JSON.stringify(listing).includes('tokenHash'));
});
test('field snapshots expose only own vehicle, crew and assigned passengers; no plans, archives or secrets leak',async t=>{
  const x=await setup(t),s=await x.read(x.field.cookie);assert.equal(s.connection.permissions.command,false);assert.equal(s.connection.permissions.fieldProgress,true);assert.match(s.connection.scopeLabel,/本车/);
  assert.deepEqual(s.data.scenario.vehicles.map(v=>v.id),[x.vehicle.id]);assert.deepEqual(s.data.activePlan.routes.map(r=>r.vehicleId),[x.vehicle.id]);
  const ids=new Set(x.route.passengerIds);assert.ok(s.data.scenario.households.length>0);assert.ok(s.data.scenario.households.length<x.full.data.scenario.households.length);assert.ok(s.data.scenario.households.every(h=>ids.has(h.id)));
  assert.ok(Object.keys(s.data.stage).every(id=>ids.has(id)));assert.equal(s.data.history.length,0);assert.equal(s.data.taskArchives.length,0);assert.equal(s.data.plan,null);assert.equal(s.data.baseline,null);
  assert.ok(!JSON.stringify(s).includes(commanderToken));assert.ok(!JSON.stringify(s).includes(x.invitation.joinPath.split('#')[1]));assert.equal(s.metrics.people,x.route.people);
});
test('server denies every command mutation and cross-vehicle progress despite crafted payloads',async t=>{
  const x=await setup(t),s=await x.read(x.field.cookie),before=(await x.read(x.commander.cookie)).data;
  for(const action of ['confirm','generate','weather','end-task','configure-resources','resource-event','verify','verify-arrivals','restore','reset','new-task','command-intake','start','step','contact','start-next-trip','village-review']){
    const r=await x.act(x.field.cookie,s,action,{});assert.equal(r.status,403,action);
  }
  const other=x.full.data.scenario.vehicles.find(v=>v.id!==x.vehicle.id);
  for(const action of ['field-progress','field-contact-batch','start-vehicle'])assert.equal((await x.act(x.field.cookie,s,action,{vehicleId:other.id,planId:x.route.id,stage:'ack'})).status,403);
  assert.deepEqual((await x.read(x.commander.cookie)).data,before);
  const ack=await x.act(x.field.cookie,s,'field-progress',{stage:'ack',vehicleId:x.vehicle.id,planId:x.full.data.activePlan.id,reporter:'伪造指挥员'});assert.equal(ack.status,200);const state=await ack.json();assert.equal(state.data.taskAcks[x.vehicle.id].reporter,x.vehicle.driverId);
  const conflict=await x.act(x.field.cookie,s,'field-progress',{stage:'contact',vehicleId:x.vehicle.id,planId:x.full.data.activePlan.id,householdId:x.route.stops[0].id});assert.equal(conflict.status,409);assert.deepEqual((await conflict.json()).data.scenario.vehicles.map(v=>v.id),[x.vehicle.id]);
});
test('own incremental reports sync to commander, keep bound reporter, and remain invisible to another field crew',async t=>{
  const x=await setup(t),s=await x.read(x.field.cookie),other=x.full.data.scenario.vehicles.find(v=>v.id!==x.vehicle.id);
  const invite=await (await x.request('/api/v3/room/invitations',x.commander.cookie,{vehicleId:other.id,staffId:other.driverId})).json(),second=await x.login(invite.joinPath.split('#')[1]);
  const payload={villageId:'VA',pickupId:'P-A1',mode:'increment',people:2,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'新发现两名人员',reporter:'fake',source:'manual'};
  const result=await x.act(x.field.cookie,s,'village-report',payload,'same-report');assert.equal(result.status,200);const own=await result.json();assert.equal(own.data.villageReports.length,1);assert.equal(own.data.villageReports[0].reporter,x.vehicle.driverId);
  assert.equal((await x.read(x.commander.cookie)).data.villageReports.length,1);assert.equal((await x.read(second.cookie)).data.villageReports.length,0);
  const duplicate=await x.act(x.field.cookie,s,'village-report',payload,'same-report');assert.equal(duplicate.status,200);assert.equal((await duplicate.json()).duplicate,true);
  assert.equal((await x.act(x.field.cookie,own,'village-report',{...payload,mode:'correction',targetId:'VR1'})).status,403);
});
test('SSE projects field state individually and revoking invitation closes existing streams and cookies',async t=>{
  const x=await setup(t),abort=new AbortController();t.after(()=>abort.abort());const response=await fetch(x.base+'/api/v3/events',{headers:{cookie:x.field.cookie},signal:abort.signal}),reader=response.body.getReader(),decoder=new TextDecoder();
  let text=decoder.decode((await reader.read()).value);while(!text.includes('data: '))text+=decoder.decode((await reader.read()).value);
  const frame=JSON.parse(/data: ([^\n]+)/.exec(text)[1]);assert.equal(frame.connection.role,'field');assert.deepEqual(frame.data.scenario.vehicles.map(v=>v.id),[x.vehicle.id]);
  assert.equal((await x.request('/api/v3/room/revoke',x.commander.cookie,{invitationId:x.invitation.invitationId})).status,200);
  const end=await reader.read();assert.equal(end.done,true);assert.equal((await x.request('/api/v3/state',x.field.cookie)).status,401);assert.equal((await x.login(x.invitation.joinPath.split('#')[1])).response.status,401);
});
test('staff absence, changed crew assignment and new-task identity invalidate existing field authority',async t=>{
  const x=await setup(t),before=await x.read(x.commander.cookie);const changed=await x.act(x.commander.cookie,before,'resource-event',{kind:'staff',id:x.vehicle.driverId,available:false,reason:'临时离岗'});assert.equal(changed.status,200);
  assert.equal((await x.request('/api/v3/state',x.field.cookie)).status,403);assert.equal((await x.act(x.field.cookie,before,'field-progress',{stage:'ack',vehicleId:x.vehicle.id,planId:before.data.activePlan.id})).status,403);
  const access=createRoomAccess({roomId:'unit-room',token:commanderToken,allowedHosts:[]}),data=before.data,invite=access.createInvitation(data,{vehicleId:x.vehicle.id,staffId:x.vehicle.driverId});
  const req={headers:{},socket:{remoteAddress:'127.0.0.1'}},joined=access.join(req,invite.joinPath.split('#')[1],data);req.headers.cookie=joined.cookie.split(';')[0];const principal=access.principal(req);assert.equal(access.active(principal,data),true);
  const reassigned=structuredClone(data);reassigned.scenario.vehicles.find(v=>v.id===x.vehicle.id).driverId='replacement';assert.equal(access.active(principal,reassigned),false);
  assert.equal(access.active(principal,{...data,exerciseId:'new-task'}),false);
});
test('joining another identity invalidates the previous cookie and live authority in that browser',async t=>{
  const x=await setup(t);
  const response=await x.request('/api/v3/room/join',x.commander.cookie,{token:x.invitation.joinPath.split('#')[1]});assert.equal(response.status,200);assert.equal((await response.json()).connection.role,'field');
  assert.equal((await x.request('/api/v3/state',x.commander.cookie)).status,401);
  const cookie=response.headers.get('set-cookie').split(';')[0];assert.equal((await x.read(cookie)).connection.role,'field');
});
test('field village UI removes forbidden correction paths and identifies scoped counts',()=>{
  const window={};vm.runInNewContext(readFileSync(new URL('../dist/village-workspace.js',import.meta.url),'utf8'),{window,Date});
  const helper={head:(...x)=>x.join(' '),badge:x=>x,btn:(label,action)=>`<button data-ac="${action}">${label}</button>`,voiceHTML:()=>''};
  const data=E.create().data;data.villageReports=[{id:'VR1',villageId:'VA',pickupId:'P-A1',mode:'increment',status:'accepted',people:1,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',householdIds:[],needsInfo:false,createdAt:new Date().toISOString(),reporter:'D01',text:'新增一人'}];
  const state={data,connection:{role:'field'},villageLedger:[{villageId:'VA',villageName:'测试地区',people:1,waiting:1,pendingReports:0},{villageId:'VB',villageName:'无关地区',people:0,pendingReports:0}]};
  const composer=window.JiaoyingVillageUI.composer(state,{form:{mode:'correction',villageId:'VA',text:''},voiceActive:false},helper);assert.doesNotMatch(composer,/id="village-mode"|id="village-target"/);assert.match(composer,/联系指挥员/);
  assert.doesNotMatch(window.JiaoyingVillageUI.reports(state,{view:'field'},helper),/data-ac="village-correct"/);
  const ledger=window.JiaoyingVillageUI.ledger(state,{},helper);assert.match(ledger,/不代表全村总数/);assert.doesNotMatch(ledger,/无关地区/);
});
