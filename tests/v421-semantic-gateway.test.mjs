import test from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {createExerciseServer} from '../local-server.mjs';
import {readSemanticConfig,semanticConfigurationStatus,validateSemanticInput,validateSemanticOutput} from '../semantic-gateway.mjs';

const config={baseUrl:'https://api.deepseek.com',model:'fixture-model',apiKey:'fixture-private-key-do-not-echo'};
const utterance='玉海街道新增十人，其中两人需要协助';
const input=()=>({requestId:'semantic-test',kind:'demand',utterance,context:{villages:[{id:'V1',name:'玉海街道',pickups:[{id:'P1',name:'集合点'}]}],scope:{villageId:'V1',villageName:'玉海街道'},nodes:[{id:'N1',name:'集合点'}],staff:[{id:'D01',role:'driver',available:true}]}});
const output=()=>({rows:[{villageName:'玉海街道',people:10,assistancePeople:2,intent:'increment',evidence:utterance}],warnings:['轮椅人数尚未明确。']});
const completion=(body=output(),overrides={})=>Response.json({choices:[{finish_reason:'stop',message:{content:JSON.stringify(body)},...overrides}]});
async function host(t,{fetchImpl=async()=>completion(),semanticConfig=config,semanticOptions={},...options}={}){
  const instance=createExerciseServer({startMode:'blank',semanticConfig,semanticOptions:{fetchImpl,...semanticOptions},...options});
  instance.server.listen(0,'127.0.0.1');await once(instance.server,'listening');
  t.after(()=>new Promise(resolve=>{instance.server.closeAllConnections();instance.server.close(resolve);}));
  const base='http://127.0.0.1:'+instance.server.address().port;
  return {...instance,base,post:(body=input(),headers={})=>fetch(base+'/api/v3/semantic',{method:'POST',headers:{'Content-Type':'application/json',Origin:base,...headers},body:JSON.stringify(body)}),get:()=>fetch(base+'/api/v3/semantic/status').then(r=>r.json())};
}

test('server config reads only expected .env variables and environment overrides without exposing key',async t=>{
  const dir=await mkdtemp(fileURLToPath(new URL('../tmp/semantic-env-',import.meta.url)));
  t.after(()=>rm(dir,{recursive:true,force:true}));const file=join(dir,'.env');
  await writeFile(file,'JIAOYING_AI_BASE_URL=https://api.deepseek.com\nJIAOYING_AI_MODEL="file-model"\nJIAOYING_AI_KEY=fixture-file-key\nOTHER_SECRET=not-read\n');
  const read=readSemanticConfig({JIAOYING_AI_MODEL:'env-model'},{file});
  assert.deepEqual(read,{baseUrl:'https://api.deepseek.com',model:'env-model',apiKey:'fixture-file-key'});
  const status=semanticConfigurationStatus(read);assert.equal(status.configured,true);assert.equal(status.connected,false);
  assert.ok(!JSON.stringify(status).includes('fixture-file-key'));assert.ok(!JSON.stringify(status).includes('api.deepseek.com'));
  assert.equal(semanticConfigurationStatus({...read,baseUrl:'http://remote.invalid'}).configured,false);
  assert.equal(semanticConfigurationStatus({...read,baseUrl:'https://secret@example.org/?key=hidden'}).configured,false);
  assert.equal(semanticConfigurationStatus({...read,apiKey:'bad\nsecret'}).configured,false);
  assert.equal(readSemanticConfig({},{file:join(dir,'missing')}).apiKey,'');
});

test('input rejects endpoint overrides, full state, unknown roles and excessive context',()=>{
  const valid=validateSemanticInput(input());assert.equal(valid.kind,'demand');assert.equal(valid.context.nodes[0].id,'N1');
  for(const value of [{...input(),endpoint:'https://evil.invalid'},{...input(),kind:'publish'},{...input(),utterance:'x'.repeat(20001)},{...input(),context:{snapshot:{}}},{...input(),context:{staff:[{id:'D1',role:'admin'}]}},{...input(),context:{nodes:Array.from({length:301},(_,i)=>({id:'N'+i}))}}])assert.throws(()=>validateSemanticInput(value));
  assert.throws(()=>validateSemanticInput(JSON.parse('{"kind":"demand","utterance":"test","__proto__":{}}')));
});

test('normalized model output keeps missing numeric/boolean values unknown, and intent is never assumed incremental',()=>{
  const result=validateSemanticOutput(output(),validateSemanticInput(input()));
  assert.equal(result.rows[0].wheelchairPeople,null);assert.equal(result.rows[0].pickupName,null);assert.equal(result.rows[0].groupPolicy,'unknown');
  const missingIntent=output();delete missingIntent.rows[0].intent;assert.equal(validateSemanticOutput(missingIntent,input()).rows[0].intent,'other');
  const staff=validateSemanticOutput({rows:[{id:'D01',role:'driver',evidence:'D01'}],warnings:[]},{kind:'staff',utterance:'工作人员D01'});assert.equal(staff.rows[0].available,null);
});

test('model output is rejected atomically for invented evidence, coordinates, invalid counts, action fields and duplicate crew',()=>{
  const variants=[
    {people:1,assistancePeople:2},{wheelchairPeople:3},{people:-1},{people:2.5},{people:'10'},
    {evidence:'不存在的原话'},{latitude:27.8},{action:'publish'},{groupPolicy:'split'},{intent:'automatic'}
  ];
  for(const fields of variants){const o=output();Object.assign(o.rows[0],fields);assert.throws(()=>validateSemanticOutput(o,input()));}
  assert.throws(()=>validateSemanticOutput({...output(),hidden:'instruction'},input()));
  assert.throws(()=>validateSemanticOutput({rows:[{id:'D901',role:['driver'],available:true,evidence:'D901'}],warnings:[]},{kind:'staff',utterance:'工作人员D901'}));
  assert.throws(()=>validateSemanticOutput({rows:[{vehicleType:['minibus'],evidence:'中巴'}],warnings:[]},{kind:'vehicle',utterance:'新增中巴'}));
  assert.throws(()=>validateSemanticOutput({rows:[{escortIds:['E01','E01'],evidence:'车辆'}],warnings:[]},{kind:'vehicle',utterance:'车辆'}));
  assert.deepEqual(validateSemanticOutput({rows:[],warnings:[]},input()).warnings,['未识别到可录入的信息，请补充地点、人数或资源情况。']);
});

test('unconfigured endpoint never calls upstream; model config and connection status remain distinct',async t=>{
  const api=await host(t,{semanticConfig:{},fetchImpl:()=>assert.fail('unexpected upstream')});
  assert.equal((await api.get()).configured,false);const response=await api.post();assert.equal(response.status,503);assert.equal((await response.json()).code,'NOT_CONFIGURED');
  assert.equal((await fetch(api.base+'/api/v3/agent')).status,501);
});

test('successful extraction uses only minimal user context and server credentials, while preserving all exercise state',async t=>{
  let seen;const api=await host(t,{fetchImpl:async(endpoint,options)=>{seen={endpoint,options};return completion();}});
  const before=api.store.data;assert.equal((await api.get()).connected,false);
  const response=await api.post(),result=await response.json();assert.equal(response.status,200);assert.equal(result.ok,true);assert.equal(result.provider,'deepseek');assert.equal(result.status,'online');assert.equal(result.requiresReview,true);
  assert.equal(result.rows[0].people,10);assert.equal(result.rows[0].wheelchairPeople,null);assert.deepEqual(api.store.data,before);
  assert.equal(seen.endpoint,'https://api.deepseek.com/chat/completions');assert.equal(seen.options.headers.Authorization,'Bearer '+config.apiKey);assert.equal(seen.options.redirect,'error');
  const request=JSON.parse(seen.options.body);assert.equal(request.response_format.type,'json_object');assert.equal(request.thinking.type,'disabled');assert.equal(request.messages.length,2);assert.equal(request.messages[0].role,'system');assert.match(request.messages[0].content,/没有执行、派车、发布/);assert.match(request.messages[0].content,/JSON Schema/);assert.match(request.messages[0].content,/绝不能返回数组/);assert.equal(request.messages[1].role,'user');assert.ok(!request.tools);assert.ok(!request.messages[1].content.includes('activePlan'));
  const status=await api.get();assert.equal(status.connected,true);assert.equal(status.lastResult,'success');assert.ok(status.lastSuccessAt);
  assert.ok(!JSON.stringify([result,status]).includes(config.apiKey));assert.ok(!JSON.stringify([result,status]).includes(config.baseUrl));
});

test('resource schemas retain per-kind fields and never invent model or availability',async t=>{
  for(const [kind,row,utterance] of [['staff',{id:'D01',role:'driver'},'工作人员D01，岗位司机'],['vehicle',{name:'增援一号',vehicleType:'minibus',totalCapacity:19,start:'集合点',driverId:'D01',escortIds:['E01']},'新增增援一号，19座中巴，起点集合点，司机D01，随车E01'],['shelter',{name:'临时接收点',nodeId:'集合点',capacity:80},'新增临时接收点，可接收80人，位置集合点']]){
    const api=await host(t,{fetchImpl:async()=>completion({rows:[{...row,evidence:utterance}],warnings:[]})});
    const response=await api.post({kind,utterance,context:{}});assert.equal(response.status,200);const result=await response.json();
    for(const [key,value] of Object.entries(row))assert.deepEqual(result.rows[0][key],value);
    assert.equal(result.rows[0].available,null);if(kind==='vehicle'){assert.equal(result.rows[0].model,null);assert.equal(result.rows[0].wheelchairSlots,null);}
  }
});

test('semantic endpoint rejects missing/foreign Origin, unexpected methods, oversized bodies and malformed JSON before calling model',async t=>{
  const api=await host(t,{fetchImpl:()=>assert.fail('unexpected upstream')});
  assert.equal((await api.post(input(),{Origin:'https://other.invalid'})).status,403);
  assert.equal((await fetch(api.base+'/api/v3/semantic',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(input())})).status,403);
  assert.equal((await api.post(input(),{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await fetch(api.base+'/api/v3/semantic')).status,405);
  assert.equal((await api.post(input(),{'Content-Type':'text/plain'})).status,415);
  assert.equal((await api.post({...input(),padding:'x'.repeat(128*1024)})).status,413);
  const malformed=await fetch(api.base+'/api/v3/semantic',{method:'POST',headers:{Origin:api.base,'Content-Type':'application/json'},body:'not json'});assert.equal(malformed.status,400);
  assert.equal((await api.post({...input(),context:{snapshot:{}}})).status,400);
});

test('provider failures, invalid JSON and truncated completions are safe failures, never successful empty model results',async t=>{
  for(const fetchImpl of [async()=>new Response(config.apiKey,{status:401}),async()=>completion(output(),{finish_reason:'length'}),async()=>Response.json({choices:[{finish_reason:'stop',message:{content:config.apiKey}}]}),async()=>completion({rows:[{people:9,evidence:'invented'}],warnings:[]})]){
    const api=await host(t,{fetchImpl});const response=await api.post();assert.equal(response.status,502);const result=await response.json();assert.equal(result.ok,false);assert.equal(result.status,'unavailable');assert.ok(!JSON.stringify(result).includes(config.apiKey));assert.equal((await api.get()).connected,false);assert.equal((await api.get()).lastResult,'failed');
  }
});

test('bounded provider body rejects excessive declared or streamed responses without exposing content',async t=>{
  for(const fetchImpl of [async()=>new Response(config.apiKey,{headers:{'Content-Length':String(300*1024)}}),async()=>new Response('x'.repeat(300*1024))]){
    const api=await host(t,{fetchImpl});const response=await api.post();assert.equal(response.status,502);assert.ok(!(await response.text()).includes(config.apiKey));
  }
});

test('model timeout aborts upstream, frees the slot and preserves task data',async t=>{
  let calls=0,aborted=false;
  const api=await host(t,{semanticOptions:{timeoutMs:25,maxConcurrent:1},fetchImpl:async(_,options)=>{
    if(++calls>1)return completion();
    return new Promise((_,reject)=>options.signal.addEventListener('abort',()=>{aborted=true;reject(new Error(config.apiKey));},{once:true}));
  }});
  const before=api.store.data;const response=await api.post();assert.equal(response.status,502);const error=await response.json();assert.equal(error.code,'TIMEOUT');assert.ok(!JSON.stringify(error).includes(config.apiKey));assert.equal(aborted,true);assert.deepEqual(api.store.data,before);assert.equal((await api.post()).status,200);
});

test('concurrent requests have bounded upstream capacity and release after success',async t=>{
  let calls=0,release,started;const start=new Promise(r=>started=r),hold=new Promise(r=>release=r);
  const api=await host(t,{semanticOptions:{maxConcurrent:1},fetchImpl:async()=>{calls++;started();await hold;return completion();}});
  const first=api.post();await start;const second=await api.post();assert.equal(second.status,429);assert.equal(calls,1);release();assert.equal((await first).status,200);assert.equal((await api.post()).status,200);assert.equal(calls,2);
});

test('LAN semantic endpoint requires the existing room cookie as well as matching Origin',async t=>{
  let calls=0;const token='semantic-room-fixture-token-1234567890';
  const api=await host(t,{sharedRoom:{roomId:'semantic-room',token,allowedHosts:['192.168.1.10']},fetchImpl:async()=>{calls++;return completion();}});
  assert.equal((await api.post()).status,401);assert.equal((await fetch(api.base+'/api/v3/semantic/status')).status,401);
  const joined=await fetch(api.base+'/api/v3/room/join',{method:'POST',headers:{Origin:api.base,'Content-Type':'application/json'},body:JSON.stringify({token})});
  const cookie=joined.headers.get('set-cookie').split(';')[0];assert.equal(joined.status,200);
  assert.equal((await api.post(input(),{Cookie:cookie,Origin:'http://different.invalid'})).status,403);assert.equal(calls,0);
  assert.equal((await api.post(input(),{Cookie:cookie})).status,200);assert.equal(calls,1);
  const result=await fetch(api.base+'/api/v3/semantic/status',{headers:{Cookie:cookie}}).then(r=>r.json());assert.equal(result.connected,true);
});
