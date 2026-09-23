'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const E=require('../exercise.cjs');

// Run the shipped controller and rule/file adapters. The intentionally absent
// content element skips only visual rendering; handlers and HTTP bodies are real.
function harness(role='command'){
  const listeners={},requests=[],storage=new Map(),classes={add(){},remove(){},toggle(){}};
  const element=()=>({textContent:'',innerHTML:'',classList:classes,addEventListener(){},close(){},focus(){}});
  const elements={toast:element(),dialog:element()};let voiceOptions,voiceActive=false;
  const context={document:{getElementById:id=>elements[id]||null,querySelector:()=>null,querySelectorAll:()=>[],
    addEventListener:(type,fn)=>(listeners[type]||=[]).push(fn),createElement:element,body:{classList:classes}},
    location:{hash:'#'+role,pathname:'/jiaoying-ai/'},history:{replaceState(_s,_t,hash){context.location.hash=hash;}},
    isSecureContext:true,addEventListener(){},scrollTo(){},requestAnimationFrame:fn=>fn(),
    localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null},
    JiaoyingVoice:{create(options){voiceOptions=options;return {active:()=>voiceActive,state:()=>({active:voiceActive}),
      start(){voiceActive=true;},stop(){voiceActive=false;options.onChange();},cancel(){voiceActive=false;}};}},
    crypto:webcrypto,AbortSignal,Date,TextDecoder,Uint8Array,ArrayBuffer,DataView,Blob,
    setTimeout:()=>1,clearTimeout(){},setInterval(){},matchMedia:()=>({matches:true}),
    fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))};
  context.window=context;vm.createContext(context);
  for(const name of ['village-assistant.js','village-workspace.js','command-intake.js','intake-file.js','quick-context.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',name),'utf8'),context,{filename:name});
  const bootstrap='render();poll();setInterval(poll,1200);';
  const bridge=`window.testIntake={seed(next){state=next;connected=true;draftLoaded=true;},
    inspect(){return {intake,quickText,quickSource,quickDraft,quickReceipt,quickSelection,commandSection,fieldSection,busy,revision:d().revision};},
    intakeAction,quickAction,readIntakeFile,acceptState,clickAction,navigate,currentQuickScope};`;
  const source=fs.readFileSync(path.join(__dirname,'../dist/workspace-app.js'),'utf8');assert.ok(source.includes(bootstrap));
  vm.runInContext(source.replace(bootstrap,bridge),context,{filename:'workspace-app.js'});
  const controller=context.testIntake;
  return {controller,requests,storage,
    input(id,value){for(const fn of listeners.input||[])fn({target:{id,value,dataset:{}}});},
    change(id,value,checked=false){for(const fn of listeners.change||[])fn({target:{id,value,checked,dataset:{}}});},
    click(ac,extra={}){return controller.clickAction({dataset:{ac,...extra},disabled:false});},
    async voice(target,text){await controller.clickAction({dataset:{ac:'voice',target},disabled:false});voiceOptions.onText(text);voiceActive=false;voiceOptions.onChange();},
    async complete(index,fixture){const request=requests[index],body=JSON.parse(request.options.body);fixture.store.action(body.action,body.payload);request.resolve({ok:true,json:async()=>fixture.snapshot()});return body;}
  };
}
function fixture(capabilities={}){
  const store=E.create();store.action('generate');
  return {store,snapshot(){const data=store.data;return {session:'intake-controller-test',data,metrics:E.metrics(data),villageLedger:E.villageMetrics(data),blockedVehicles:[],capabilities:{realtimeEvents:true,villageReporting:true,commandIntake:true,...capabilities}};}};
}
const csv='村庄,集合点,人数,需协助人数,轮椅人数,同行关系,备注\n演示村 A,P-A1,3,1,0,可分组,第一批\n演示村 B,P-B1,2,0,0,可分组,第二批';
const text='演示村 A，在村委会集合点，新增三人，其中一人需要协助，无轮椅，可以分组。';
function file(content=csv){const bytes=new TextEncoder().encode(content);return {name:'演练名单.csv',size:bytes.length,arrayBuffer:async()=>bytes.buffer};}

test('a CSV upload only prepares rows; one confirmation sends one atomic intake and opens planning',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());const before=f.store.data;
  await h.controller.readIntakeFile(file());const preview=h.controller.inspect().intake;
  assert.equal(preview.draft.errors.length,0);assert.equal(preview.draft.rows.length,2);assert.equal(preview.source,'file');assert.equal(h.requests.length,0);assert.deepEqual(f.store.data,before);
  const pending=h.controller.intakeAction('intake-submit');assert.equal(h.requests.length,1);
  const body=JSON.parse(h.requests[0].options.body);assert.equal(body.action,'command-intake');assert.equal(body.payload.source,'file');assert.equal(body.payload.rows.length,2);assert.equal(body.expectedRevision,before.revision);assert.equal(body.session,'intake-controller-test');
  assert.equal(body.payload.rows.reduce((n,row)=>n+row.people,0),5);assert.ok(body.payload.rows.every(row=>!('filename' in row)&&!('sourceText' in row)));
  await h.complete(0,f);await pending;
  assert.equal(f.store.data.villageReports.length,2);assert.ok(f.store.data.villageReports.every(row=>row.status==='accepted'));assert.equal(f.store.data.activePlan,null);assert.equal(f.store.data.planCounter,before.planCounter+1);
  assert.equal(h.controller.inspect().commandSection,'plan');assert.equal(h.controller.inspect().intake.draft,null);
});

test('voice and typed command descriptions remain reviewable drafts until an explicit submit',async()=>{
  for(const source of ['voice','text']){
    const h=harness(),f=fixture();h.controller.seed(f.snapshot());
    if(source==='voice')await h.voice('command-intake',text);else{h.input('intake-text',text);await h.controller.intakeAction('intake-parse');}
    const draft=h.controller.inspect().intake;assert.equal(draft.source,source);assert.equal(draft.draft.errors.length,0);assert.equal(draft.draft.rows[0].people,3);assert.equal(h.requests.length,0);
    const pending=h.controller.intakeAction('intake-submit');assert.equal(JSON.parse(h.requests[0].options.body).payload.source,source);await h.complete(0,f);await pending;
    assert.equal(f.store.data.villageReports[0].intakeSource,source);assert.equal(f.store.data.activePlan,null);
  }
});

test('new state revisions invalidate command and quick confirmation cards without submitting stale facts',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());await h.controller.readIntakeFile(file());
  f.store.action('weather',{preset:'small'});h.controller.acceptState(f.snapshot());await assert.rejects(h.controller.intakeAction('intake-submit'),/数据已变化/);assert.equal(h.requests.length,0);
  await h.controller.intakeAction('intake-refresh');assert.equal(h.controller.inspect().intake.draft.revision,f.store.data.revision);
  const field=harness('field');field.controller.seed(f.snapshot());field.change('quick-village','VA');field.input('quick-text','新增三人');await field.controller.quickAction('quick-parse');
  f.store.action('weather',{preset:'small'});field.controller.acceptState(f.snapshot());await assert.rejects(field.controller.quickAction('quick-submit'),/任务已更新/);assert.equal(field.requests.length,0);
});

test('similar command batches require a separate human acknowledgement and retain their provenance',async()=>{
  const h=harness(),f=fixture();f.store.action('command-intake',{source:'text',rows:[{villageId:'VA',pickupId:'P-A1',people:3,assistancePeople:1,wheelchairPeople:0,groupPolicy:'splittable'}]});h.controller.seed(f.snapshot());await h.controller.readIntakeFile(file());
  await assert.rejects(h.controller.intakeAction('intake-submit'),/相似批次/);assert.equal(h.requests.length,0);
  const priorKey=h.controller.inspect().intake.draft.requestId;h.change('intake-duplicate','',true);assert.notEqual(h.controller.inspect().intake.draft.requestId,priorKey);
  const pending=h.controller.intakeAction('intake-submit');assert.equal(JSON.parse(h.requests[0].options.body).payload.duplicateAcknowledged,true);await h.complete(0,f);await pending;
  assert.equal(f.store.data.villageReports.find(r=>r.people===3&&r.intakeSource==='file').possibleDuplicateOf,'VR1');
});

test('one voice confirmation adds a pending field supplement with unknown needs instead of publishing or adding verified heads',async()=>{
  const h=harness('field'),f=fixture();f.store.action('confirm');h.controller.seed(f.snapshot());h.change('field-vehicle','V1');const scope=h.controller.currentQuickScope();assert.ok(scope.villageId);
  await h.voice('quick','新增三人');const draft=h.controller.inspect().quickDraft;assert.ok(draft.proposal);assert.equal(draft.proposal.payload.villageId,scope.villageId);assert.equal(draft.proposal.payload.assistancePeople,null);assert.equal(draft.proposal.payload.wheelchairPeople,null);assert.equal(h.requests.length,0);
  const old=f.store.data.activePlan,pending=h.controller.quickAction('quick-submit');assert.equal(h.requests.length,1);const body=JSON.parse(h.requests[0].options.body);assert.equal(body.action,'village-report');assert.equal(body.payload.source,'voice');await h.complete(0,f);await pending;
  assert.equal(f.store.data.villageReports[0].status,'pending');assert.equal(E.metrics(f.store.data).people,15);assert.equal(E.metrics(f.store.data).pendingVillagePeople,3);assert.deepEqual(f.store.data.activePlan,old);assert.equal(h.controller.inspect().quickDraft,null);assert.match(h.controller.inspect().quickReceipt,/VR1.*3/);
});

test('editing input or changing task location invalidates a prepared card without submitting it',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());await h.controller.readIntakeFile(file());h.input('intake-text',text);assert.equal(h.controller.inspect().intake.draft,null);await assert.rejects(h.controller.intakeAction('intake-submit'),/请修正/);
  await h.controller.intakeAction('intake-parse');h.controller.navigate('execution');assert.equal(h.requests.length,0);assert.ok(h.controller.inspect().intake.draft);
  const field=harness('field');field.controller.seed(f.snapshot());field.change('quick-village','VA');field.input('quick-text','新增三人');await field.controller.quickAction('quick-parse');field.change('quick-village','VB');assert.equal(field.controller.inspect().quickDraft,null);await assert.rejects(field.controller.quickAction('quick-submit'),/请先补充/);assert.equal(field.requests.length,0);
});

test('an uncertain command submit retry preserves its idempotency key and review card',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());await h.controller.readIntakeFile(file());let pending=h.controller.intakeAction('intake-submit');h.requests[0].reject(new Error('network failed'));await assert.rejects(pending,/network failed/);assert.ok(h.controller.inspect().intake.draft);
  pending=h.controller.intakeAction('intake-submit');assert.equal(JSON.parse(h.requests[0].options.body).requestId,JSON.parse(h.requests[1].options.body).requestId);h.requests[1].reject(new Error('network failed'));await assert.rejects(pending,/network failed/);
});

test('unsupported old-service capabilities block both command intake and quick supplementation before fetch',async()=>{
  const h=harness(),f=fixture({commandIntake:false,villageReporting:false});h.controller.seed(f.snapshot());await h.controller.readIntakeFile(file());await assert.rejects(h.controller.intakeAction('intake-submit'),/V3.7|新版/);assert.equal(h.requests.length,0);
  h.change('quick-village','VA');h.input('quick-text','新增三人');await h.controller.quickAction('quick-parse');const pending=h.controller.quickAction('quick-submit');
  if(h.requests.length)h.requests[0].reject(new Error('unexpected old-service request'));
  await assert.rejects(pending,/旧版|新版|V3\./);assert.equal(h.requests.length,0);
});

test('a late file read never replaces text entered after the upload began',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());const bytes=new TextEncoder().encode(csv);let finish;
  const reading=h.controller.readIntakeFile({name:'慢名单.csv',size:bytes.length,arrayBuffer:()=>new Promise(resolve=>{finish=resolve;})});
  h.input('intake-text',text);finish(bytes.buffer);await reading;
  assert.equal(h.controller.inspect().intake.text,text);assert.equal(h.controller.inspect().intake.source,'text');assert.equal(h.controller.inspect().intake.draft,null);assert.equal(h.requests.length,0);
});

test('late supplement success preserves a newly selected village and unsubmitted text',async()=>{
  const h=harness('field'),f=fixture();h.controller.seed(f.snapshot());h.change('quick-village','VA');h.input('quick-text','新增三人');await h.controller.quickAction('quick-parse');const pending=h.controller.quickAction('quick-submit');
  h.change('quick-village','VB');h.input('quick-text','新增五人');await h.complete(0,f);await pending;
  const current=h.controller.inspect();assert.equal(current.quickSelection.villageId,'VB');assert.equal(current.quickText,'新增五人');assert.equal(current.quickDraft,null);assert.equal(f.store.data.villageReports[0].villageId,'VA');
});

test('a task-derived supplement keeps following the next pickup after boarding instead of pinning the old point',async()=>{
  const h=harness('field'),f=fixture();f.store.action('confirm');f.store.action('contact',{ids:f.store.data.activePlan.servedIds});f.store.action('start');h.controller.seed(f.snapshot());h.change('field-vehicle','V1');
  const initialScope=h.controller.currentQuickScope();assert.equal(initialScope.source,'task');assert.equal(initialScope.pickupId,'P-A2');
  h.input('quick-text','新增三人');await h.controller.quickAction('quick-parse');assert.equal(h.controller.inspect().quickDraft.scopeAtPrepare.pickupId,initialScope.pickupId);
  const pending=h.controller.quickAction('quick-submit');await h.complete(0,f);await pending;assert.equal(h.controller.inspect().quickSelection.villageId,'');assert.equal(h.controller.inspect().quickSelection.pickupId,'');
  f.store.action('step',{vehicleId:'V1'});h.controller.acceptState(f.snapshot());const nextScope=h.controller.currentQuickScope();assert.equal(nextScope.source,'task');assert.equal(nextScope.pickupId,'P-C2');
  h.input('quick-text','这里又发现二人');await h.controller.quickAction('quick-parse');const payload=h.controller.inspect().quickDraft.proposal.payload;assert.equal(payload.villageId,'VC');assert.equal(payload.pickupId,'P-C2');assert.equal(f.store.data.villageReports[0].pickupId,'P-A2');
});

test('explicitly selected or spoken replacement locations remain selected after a successful supplement',async()=>{
  for(const spoken of [false,true]){
    const h=harness('field'),f=fixture();f.store.action('confirm');h.controller.seed(f.snapshot());h.change('field-vehicle','V1');
    if(!spoken){h.change('quick-village','VB');h.change('quick-pickup','P-B1');}
    h.input('quick-text',spoken?'演示村 B 在村委会集合点新增三人':'新增三人');await h.controller.quickAction('quick-parse');assert.equal(h.controller.inspect().quickDraft.proposal.payload.pickupId,'P-B1');
    const pending=h.controller.quickAction('quick-submit');await h.complete(0,f);await pending;const after=h.controller.currentQuickScope();assert.equal(after.source,'selection');assert.equal(after.villageId,'VB');assert.equal(after.pickupId,'P-B1');
  }
});
