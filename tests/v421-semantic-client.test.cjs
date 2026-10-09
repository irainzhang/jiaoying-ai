'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createClient}=require('../dist/semantic-intake.js');
const response=(data,status=200)=>({ok:status>=200&&status<300,status,text:async()=>JSON.stringify(data)});
const status={configured:true,connected:false,model:'test-model'};
const normalize=rows=>({rows,warnings:[]});
function fixture(handler,extra={}){const calls=[],env={location:{protocol:'http:',hostname:'127.0.0.1'},AbortController,setTimeout,clearTimeout,fetch:async(path,options)=>{calls.push({path,options});return handler(path,options);},...extra};return {api:createClient(env),calls,env};}
function online(options,rows=[{id:'D01',role:'driver',available:false}]){const input=JSON.parse(options.body);return response({ok:true,requestId:input.requestId,kind:input.kind,provider:'deepseek',status:'online',model:'test-model',rows,warnings:[],requiresReview:true});}

test('public Pages and file protocol never probe or send utterances',async()=>{
  for(const location of [{protocol:'https:',hostname:'irainzhang.github.io'},{protocol:'file:',hostname:''}]){
    const f=fixture(()=>{throw Error('must not fetch');},{location});
    const result=await f.api.interpret('staff','工作人员 D01',{fallback:()=>({rows:[{id:'D01'}]}),normalize});
    assert.equal(f.calls.length,0);assert.equal(result.semantic.provider,'offline');assert.equal(result.semantic.sent,false);
    assert.match(f.api.sourceHTML(result.semantic),/本次来源：本地规则整理/);assert.match(f.api.statusHTML(),/本地规则/);
  }
});
test('configuration status alone is not represented as a successful model call',async()=>{
  const f=fixture(()=>response(status));await f.api.refreshStatus();
  assert.equal(f.api.getStatus().configured,true);assert.equal(f.api.getStatus().connected,false);assert.equal(f.api.getStatus().lastResult,null);
  assert.match(f.api.statusHTML(),/是否成功以本次结果为准/);assert.match(f.api.statusHTML(),/data-ac="semantic-refresh"/);
  assert.match(f.api.statusHTML(),/Excel 原文件不发送/);
});
test('configured backend receives only utterance and minimal candidates through same-origin endpoint',async()=>{
  const f=fixture((path,o)=>path.endsWith('/status')?response(status):online(o));let fallback=false;
  const result=await f.api.interpret('staff','工作人员 D01，目前未到岗',{context:{apiKey:'never-send',fullWorkbook:['private'],staff:[{id:'D01',role:'driver',available:false,name:'private-name',phone:'secret'}],nodes:[{id:'P1',label:'集合点',people:['private']}],villages:[{id:'V1',name:'村庄',pickups:[{id:'P1',name:'集合点',phone:'private'}]}],scope:{villageId:'V1',villageName:'村庄',extra:'private'}},normalize,fallback:()=>{fallback=true;}});
  assert.equal(fallback,false);assert.equal(result.rows[0].available,false);assert.equal(result.semantic.mode,'online');assert.equal(f.api.getStatus().connected,true);
  assert.equal(f.calls[1].path,'/api/v3/semantic');assert.equal(f.calls[1].options.credentials,'same-origin');assert.equal(f.calls[1].options.redirect,'error');
  const sent=JSON.parse(f.calls[1].options.body);assert.doesNotMatch(JSON.stringify(sent),/never-send|private|secret|fullWorkbook/);
  assert.deepEqual(sent.context.staff,[{id:'D01',role:'driver',available:false}]);
  assert.match(f.api.sourceHTML(result.semantic),/DeepSeek 语义识别/);assert.equal(f.api.getHistory().length,1);
});
test('offline unconfigured status never attempts chargeable call and refresh can enable it',async()=>{
  let configured=false;const f=fixture((path,o)=>path.endsWith('/status')?response({...status,configured}):online(o));
  const opts={normalize,fallback:()=>({rows:[{id:'local'}]})};const a=await f.api.interpret('staff','编号 D01',opts);assert.equal(a.semantic.sent,false);assert.equal(f.calls.length,1);
  configured=true;await f.api.refreshStatus();const b=await f.api.interpret('staff','编号 D01',opts);assert.equal(b.semantic.mode,'online');assert.equal(f.calls.length,3);
});
test('HTTP failure falls back with explicit provenance and does not expose raw upstream errors',async()=>{
  const f=fixture(path=>path.endsWith('/status')?response(status):response({error:'secret authorization bearer key'},502));
  const result=await f.api.interpret('staff','工作人员 D01',{normalize,fallback:()=>({rows:[{id:'local'}]})});
  assert.equal(result.semantic.mode,'offline');assert.equal(result.semantic.sent,true);assert.match(result.semantic.reason,/502/);
  assert.doesNotMatch(JSON.stringify(result),/bearer|authorization|secret/);assert.match(f.api.sourceHTML(result.semantic),/失败后回落/);
});
test('invalid contract, mismatched request and local normalization failure never claim online success',async()=>{
  for(const bad of ['contract','request','normalization']){
    const f=fixture((path,o)=>{if(path.endsWith('/status'))return response(status);const data=JSON.parse(o.body);return response({ok:true,requestId:bad==='request'?'wrong':data.requestId,kind:data.kind,provider:'deepseek',status:'online',rows:[],requiresReview:bad!=='contract'});});
    const result=await f.api.interpret('staff','工作人员 D01',{normalize:()=>{if(bad==='normalization')throw Error('arbitrary sensitive detail');return {rows:[]};},fallback:()=>({rows:[{id:'fallback'}]})});
    assert.equal(result.semantic.mode,'offline');assert.equal(result.rows[0].id,'fallback');assert.doesNotMatch(JSON.stringify(result),/sensitive/);
  }
});
test('intentional cancellation aborts request without a fallback or stale result',async()=>{
  let started,fallbacks=0;const ready=new Promise(r=>started=r),controller=new AbortController();
  const f=fixture((path,o)=>path.endsWith('/status')?response(status):new Promise((_,reject)=>{started();o.signal.addEventListener('abort',()=>reject(Object.assign(Error('aborted'),{name:'AbortError'})));}));
  const promise=f.api.interpret('staff','工作人员 D01',{signal:controller.signal,normalize,fallback:()=>{fallbacks++;return {rows:[]};}});await ready;controller.abort();
  await assert.rejects(promise,{name:'AbortError'});assert.equal(fallbacks,0);assert.equal(f.api.getHistory().length,0);
});
test('request timeout produces a local result and an explicit timeout reason',async()=>{
  let call=0;const f=fixture((path,o)=>path.endsWith('/status')?response(status):new Promise((_,reject)=>o.signal.addEventListener('abort',()=>reject(Object.assign(Error('abort'),{name:'AbortError'})))),{setTimeout:(fn,ms)=>setTimeout(fn,++call===1?1000:5)});
  const result=await f.api.interpret('staff','工作人员 D01',{normalize,fallback:()=>({rows:[]})});assert.equal(result.semantic.mode,'offline');assert.match(result.semantic.reason,/超时/);
});
test('status subscribers are isolated and interpretation does not reset a view through a notification',async()=>{
  const f=fixture((path,o)=>path.endsWith('/status')?response(status):online(o));let count=0;f.api.subscribe(()=>{throw Error('view');});const unsubscribe=f.api.subscribe(()=>count++);
  await f.api.refreshStatus();await f.api.interpret('staff','工作人员 D01',{normalize,fallback:()=>({rows:[]})});assert.equal(count,1);unsubscribe();await f.api.refreshStatus();assert.equal(count,1);
});
test('model metadata, evidence and reasons are escaped in visible source labels',()=>{
  const f=fixture(()=>response(status));const html=f.api.sourceHTML({mode:'online',model:'<script>',reason:'<img>',evidence:['<svg onload=x>']});assert.doesNotMatch(html,/<script>|<img>|<svg /);assert.match(html,/&lt;script&gt;/);
});
test('resource semantic adapter whitelists model fields and preserves unresolved local choices',async()=>{
  const workbench=require('../dist/task-workbench.js'),old=global.JiaoyingSemanticIntake;
  try{
    global.JiaoyingSemanticIntake={interpret:async(kind,text,options)=>{
      assert.deepEqual(Object.keys(options.context).sort(),['nodes','shelters','staff','vehicles']);
      return options.normalize([{name:'中巴',model:'测试车型',vehicleType:'minibus',totalCapacity:19,wheelchairSlots:null,start:'不存在的地点',driverId:'UNKNOWN',escortIds:['E01'],available:null,publish:true,capacity:200,evidence:'原话'}],{warnings:['需核对']});
    }};
    const result=await workbench.parseResourceSpeech('vehicle','十九座中巴',{context:{nodes:[{id:'P1',label:'集合点'}],staff:[{id:'E01',role:'escort',available:true}],vehicles:[{id:'V1'}]}});
    assert.equal(result.rows[0].totalCapacity,19);assert.equal(result.rows[0].wheelchairSlots,'');assert.equal(result.rows[0].available,null);assert.equal(result.rows[0].start,'');assert.equal(result.rows[0].driverId,'UNKNOWN');
    assert.equal(result.rows[0].publish,undefined);assert.equal(result.rows[0].capacity,undefined);assert.ok(result.warnings.length>1);
  }finally{global.JiaoyingSemanticIntake=old;}
});
test('resource adapter uses existing local parser without a semantic module',()=>{
  const workbench=require('../dist/task-workbench.js'),old=global.JiaoyingSemanticIntake;
  try{delete global.JiaoyingSemanticIntake;const result=workbench.parseResourceSpeech('staff','工作人员 D01，岗位司机，未到岗');assert.equal(result.rows[0].id,'D01');assert.equal(result.rows[0].available,false);}finally{global.JiaoyingSemanticIntake=old;}
});
