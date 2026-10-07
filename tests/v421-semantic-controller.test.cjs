'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const {webcrypto}=require('node:crypto'),E=require('../exercise.cjs');
const plain=value=>JSON.parse(JSON.stringify(value));
const answer=(extra={})=>({rows:[{intent:'increment',villageName:'演示村 A',pickupName:'P-A1',people:6,assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown',evidence:'',...extra}],warnings:[]});
function fixture(){const store=E.create();store.action('generate');return {store,snapshot(){const data=store.data;return {session:'semantic-test-session',data,metrics:E.metrics(data),villageLedger:E.villageMetrics(data),blockedVehicles:[],capabilities:{villageReporting:true,commandIntake:true}};}};}
function harness(role='command',{events=false}={}){
  const listeners={},requests=[],calls=[],streams=[],storage=new Map(),classes={add(){},remove(){},toggle(){}};
  const element=()=>({textContent:'',innerHTML:'',classList:classes,addEventListener(){},close(){this.open=false;},focus(){}}),elements={toast:element(),dialog:element(),'dialog-content':element(),'assistant-dialog':element(),'operations-dialog':element(),'intake-field-errors':element()};
  const buttons=Object.fromEntries([['intake-parse','整理需求'],['quick-parse','整理补报'],['village-prepare','下一步：核对上报单']].map(([ac,label])=>[ac,{...element(),dataset:{ac},disabled:false,textContent:label}]));
  const context={document:{getElementById:id=>elements[id]||null,querySelector:selector=>buttons[selector.match(/^\[data-ac="([^"]+)"\]$/)?.[1]]||null,querySelectorAll:()=>[],addEventListener:(type,fn)=>(listeners[type]||=[]).push(fn),createElement:element,body:{classList:classes}},
    location:{hash:'#'+role,pathname:'/jiaoying-ai/'},history:{replaceState(_s,_t,hash){context.location.hash=hash;}},isSecureContext:true,addEventListener(){},scrollTo(){},requestAnimationFrame:fn=>fn(),
    localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null},JiaoyingVoice:{create(){return {active:()=>false,state:()=>({active:false}),start(){},stop(){},cancel(){}};}},
    crypto:webcrypto,AbortSignal,AbortController,Date,TextDecoder,Uint8Array,ArrayBuffer,DataView,Blob,setTimeout:()=>1,clearTimeout(){},setInterval(){},matchMedia:()=>({matches:true}),
    fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),
    JiaoyingSemanticIntake:{subscribe(){return ()=>{};},refreshStatus(){return Promise.resolve({configured:true});},interpret(kind,text,options){
      return new Promise((resolve,reject)=>{calls.push({kind,text,options,resolve:async response=>{
        // Deliberately ignore abort: even a transport unable to cancel must not
        // let an old successful response overwrite a newer operator decision.
        try{const parsed=await options.normalize(response.rows,response);resolve({...parsed,semantic:{mode:'online',provider:'deepseek',model:'test'}});}catch(error){reject(error);}
      }});});
    }}
  };
  if(events)context.EventSource=class {static CLOSED=2;constructor(url){this.url=url;this.handlers={};this.readyState=1;streams.push(this);}addEventListener(name,handler){this.handlers[name]=handler;}close(){this.readyState=2;}emit(snapshot){this.handlers.state({data:JSON.stringify(snapshot)});}};
  context.window=context;vm.createContext(context);
  for(const name of ['village-assistant.js','village-workspace.js','place-directory.js','command-intake.js','intake-file.js','entry-kit.js','resource-intake.js','quick-context.js','semantic-demand.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',name),'utf8'),context,{filename:name});
  const source=fs.readFileSync(path.join(__dirname,'../dist/workspace-app.js'),'utf8'),bootstrap='render();poll();setInterval(poll,1200);';assert.ok(source.includes(bootstrap));
  const bridge=`window.testSemantic={seed(next){state=next;connected=true;draftLoaded=true;},inspect(){return {state,connected,busy,identityEpoch,identityLoading,view,intake,quickText,quickDraft,quickSelection,fieldVehicle,form,messages,modal,assistantOpen,villagePrepared,villageReceipt,fieldPrepared,fieldReceipt,pending:[...semanticTasks.keys()]};},setModal(next){modal=next;},primePrivateMemory(){messages=[{text:'旧身份对话'}];modal={kind:'configure-resources'};assistantOpen=true;villagePrepared={private:true};villageReceipt='旧补报回执';fieldPrepared={private:true};fieldReceipt={private:true};},intakeAction,quickAction,readIntakeFile,acceptState,currentQuickScope,clickAction,poll,action,connectEvents,draftKey};`;
  vm.runInContext(source.replace(bootstrap,bridge),context,{filename:'workspace-app.js'});
  const controller=context.testSemantic;
  return {controller,calls,requests,elements,buttons,streams,storage,input(id,value,dataset={}){for(const fn of listeners.input||[])fn({target:{id,value,dataset}});},change(id,value){for(const fn of listeners.change||[])fn({target:{id,value,dataset:{}}});},
    async answer(index,response=answer()){await calls[index].resolve(response);},submit(id){return Promise.all((listeners.submit||[]).map(fn=>fn({target:{id},preventDefault(){}})));},start(){return controller.intakeAction('intake-parse');}};
}

test('semantic interpretation creates a reviewable preview and never writes or publishes by itself',async()=>{
  const h=harness(),f=fixture(),before=plain(f.store.data);h.controller.seed(f.snapshot());h.input('intake-text','演示村A新增六人');const pending=h.start();
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].kind,'demand');assert.equal(h.controller.inspect().intake.draft,null);assert.deepEqual(plain(h.controller.inspect().pending),['intake']);
  await h.answer(0);await pending;const draft=h.controller.inspect().intake.draft;assert.equal(draft.rows[0].people,6);assert.equal(draft.semantic.mode,'online');assert.equal(draft.session,'semantic-test-session');assert.equal(h.requests.length,0);assert.deepEqual(f.store.data,before);
});

test('editing away and back cancels the old response; it cannot replace a newer parsed draft',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.input('intake-text','新增六人');const old=h.start();h.input('intake-text','新增七人');h.input('intake-text','新增六人');
  assert.equal(h.calls[0].options.signal.aborted,true);const latest=h.start();await h.answer(1,answer({people:8}));await latest;await h.answer(0,answer({people:6}));await old;
  assert.equal(h.controller.inspect().intake.draft.rows[0].people,8);assert.equal(h.requests.length,0);
});

test('editing a pending utterance immediately restores the parse button and permits retry before the old request settles',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.input('intake-text','新增六人');const old=h.start(),button=h.buttons['intake-parse'];
  // Supply the pending state normally produced by the intake view; this harness
  // intentionally omits the full render tree so the cancellation path must
  // restore this existing control without depending on a later render.
  button.disabled=true;button.textContent='正在整理…';
  h.input('intake-text','新增七人');h.input('intake-text','新增六人');
  assert.equal(button.disabled,false);assert.equal(button.textContent,'整理需求');assert.equal(h.calls[0].options.signal.aborted,true);
  const retry=h.controller.clickAction(button);assert.equal(h.calls.length,2);
  await h.answer(0,answer({people:6}));await old;assert.equal(h.controller.inspect().intake.draft,null);
  await h.answer(1,answer({people:7}));await retry;assert.equal(h.controller.inspect().intake.draft.rows[0].people,7);assert.equal(h.requests.length,0);
});

test('switching input mode, clearing, or selecting Excel prevents a late semantic preview from replacing the chosen path',async()=>{
  for(const operation of ['mode','clear','file']){
    const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.input('intake-text','新增六人');const pending=h.start();
    if(operation==='mode')await h.controller.intakeAction('intake-method-quick');
    else if(operation==='clear')await h.controller.intakeAction('intake-clear');
    else {const bytes=new TextEncoder().encode('村庄,集合点,人数\n演示村 A,P-A1,9');await h.controller.readIntakeFile({name:'需求.csv',size:bytes.length,arrayBuffer:async()=>bytes.buffer});}
    assert.equal(h.calls[0].options.signal.aborted,true,operation);await h.answer(0);await pending;const current=h.controller.inspect().intake;
    if(operation==='file'){assert.equal(current.source,'file');assert.equal(current.draft.rows[0].people,9);}else assert.equal(current.draft,null,operation);
    assert.equal(h.requests.length,0);
  }
});

test('revision, session, and exercise changes reject old semantic results instead of restamping old facts',async()=>{
  for(const changed of ['revision','session','exercise']){
    const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.input('intake-text','新增六人');const pending=h.start(),next=plain(f.snapshot());
    if(changed==='revision')next.data.revision++;
    else if(changed==='session')next.session='new-semantic-session';
    else {next.data.exerciseId='new-exercise';next.data.revision++;}
    h.controller.acceptState(next);await h.answer(0);await pending;
    assert.equal(h.controller.inspect().intake.draft,null,changed);assert.equal(h.requests.length,0,changed);
  }
});

test('quick semantic total/correction and multiple batches cannot be submitted as one increment',async()=>{
  for(const response of [answer({intent:'total'}),answer({intent:'correction'}),{rows:[...answer().rows,...answer({villageName:'演示村 B',people:2}).rows],warnings:[]}]){
    const h=harness('field'),f=fixture();h.controller.seed(f.snapshot());h.change('quick-village','VA');h.input('quick-text','目前共有六人');const pending=h.controller.quickAction('quick-parse');await h.answer(0,response);await pending;
    assert.equal(h.controller.inspect().quickDraft.proposal,null);assert.ok(h.controller.inspect().quickDraft.questions.length);await assert.rejects(h.controller.quickAction('quick-submit'),/补充村庄和新增人数/);assert.equal(h.requests.length,0);
  }
});

test('quick selection and vehicle ABA changes cancel a pending result despite returning to the original location',async()=>{
  for(const change of ['village','vehicle']){
    const h=harness('field'),f=fixture();f.store.action('confirm');h.controller.seed(f.snapshot());
    if(change==='village')h.change('quick-village','VA');else h.change('field-vehicle','V1');
    h.input('quick-text','新增六人');const pending=h.controller.quickAction('quick-parse');
    if(change==='village'){h.change('quick-village','VB');h.change('quick-village','VA');}else{h.change('field-vehicle','V2');h.change('field-vehicle','V1');}
    assert.equal(h.calls[0].options.signal.aborted,true,change);await h.answer(0);await pending;assert.equal(h.controller.inspect().quickDraft,null,change);assert.equal(h.requests.length,0);
  }
});

function roomSnapshot(f,{role='field',staffId='D1',vehicleId='V1',revision,events=false}={}){
  const next=plain(f.snapshot());if(revision!==undefined)next.data.revision=revision;
  next.connection={mode:'lan-room',shared:true,roomId:'room-test',role,staffId:role==='field'?staffId:null,vehicleId:role==='field'?vehicleId:null,permissions:{command:role==='commander',fieldProgress:true}};
  if(role==='field')next.data.scenario.vehicles=next.data.scenario.vehicles.filter(v=>v.id===vehicleId);
  if(events)next.capabilities.realtimeEvents=true;return next;
}
const settle=()=>new Promise(resolve=>setImmediate(resolve));
function respond(request,body,status=200){request.resolve({ok:status<400,status,json:async()=>plain(body)});}

test('an unchanged task under a different shared-cookie identity clears drafts then fetches the new permission projection',async()=>{
  const h=harness(),f=fixture(),old=roomSnapshot(f,{role:'commander'}),next=roomSnapshot(f,{staffId:'D2',vehicleId:'V2'});h.controller.seed(old);
  h.input('intake-text','旧身份新增六人');const semanticPending=h.start();h.controller.primePrivateMemory();
  for(const id of ['dialog','assistant-dialog','operations-dialog']){h.elements[id].open=true;h.elements[id].innerHTML='旧身份的私有内容';}
  const oldKey=h.controller.draftKey(),savedBefore=h.storage.get(oldKey),polling=h.controller.poll(true);
  respond(h.requests[0],{unchanged:true,session:next.session,revision:next.data.revision,connection:next.connection});await settle();
  const cleared=h.controller.inspect();assert.equal(cleared.state,null);assert.equal(cleared.identityLoading,true);assert.equal(cleared.connected,false);
  assert.equal(cleared.intake.text,'');assert.equal(cleared.intake.draft,null);assert.equal(cleared.modal,null);assert.equal(cleared.assistantOpen,false);assert.equal(cleared.messages.length,0);assert.equal(cleared.villagePrepared,null);assert.equal(cleared.villageReceipt,'');assert.equal(cleared.fieldPrepared,null);assert.equal(cleared.fieldReceipt,null);
  assert.equal(h.calls[0].options.signal.aborted,true);for(const id of ['dialog','assistant-dialog','operations-dialog'])assert.equal(h.elements[id].open,false);
  assert.equal(h.requests.length,2);assert.equal(h.requests[1].url,'/api/v3/state');assert.match(h.requests[0].url,/after=/);
  respond(h.requests[1],next);await polling;await h.answer(0);await semanticPending;
  const current=h.controller.inspect();assert.equal(current.state.connection.staffId,'D2');assert.equal(current.fieldVehicle,'V2');assert.equal(current.form.reporter,'D2');assert.equal(current.view,'field');assert.equal(current.intake.draft,null);assert.equal(current.identityLoading,false);
  assert.deepEqual(current.state.data.scenario.vehicles.map(v=>v.id),['V2']);assert.equal(h.storage.get(oldKey),savedBefore);assert.equal(h.storage.has(h.controller.draftKey()),false);
});

test('a full snapshot with a new role or vehicle is accepted at the same revision and draft keys include the binding',()=>{
  const h=harness('field'),f=fixture(),old=roomSnapshot(f),next=roomSnapshot(f,{vehicleId:'V2'});h.controller.seed(old);h.input('quick-text','旧车补报六人');const oldKey=h.controller.draftKey();
  h.controller.acceptState(next);const current=h.controller.inspect();assert.equal(current.state.connection.vehicleId,'V2');assert.equal(current.fieldVehicle,'V2');assert.equal(current.quickText,'');assert.notEqual(h.controller.draftKey(),oldKey);assert.equal(h.storage.has(h.controller.draftKey()),false);
  const command=roomSnapshot(f,{role:'commander'});h.controller.acceptState(command);assert.equal(h.controller.inspect().view,'command');assert.equal(h.controller.inspect().state.connection.permissions.command,true);assert.equal(h.controller.inspect().form.reporter,'现场演示员');
});

test('a late pre-switch poll cannot replace the new identity or restore its old projection',async()=>{
  const h=harness(),f=fixture(),old=roomSnapshot(f,{role:'commander'}),next=roomSnapshot(f,{staffId:'D2',vehicleId:'V2'});h.controller.seed(old);
  const first=h.controller.poll(true),late=h.controller.poll(true);
  respond(h.requests[0],{unchanged:true,session:next.session,revision:next.data.revision,connection:next.connection});await settle();assert.equal(h.requests.length,3);
  respond(h.requests[2],next);await first;old.data.revision+=100;respond(h.requests[1],old);await late;
  assert.equal(h.controller.inspect().state.connection.staffId,'D2');assert.equal(h.controller.inspect().state.data.revision,next.data.revision);assert.equal(h.controller.inspect().identityEpoch,1);
});

test('an unchanged task with the same identity preserves the current draft and does not refetch',async()=>{
  const h=harness('field'),f=fixture(),current=roomSnapshot(f);h.controller.seed(current);h.input('quick-text','本车尚未提交的补报');const polling=h.controller.poll(true);
  respond(h.requests[0],{unchanged:true,session:current.session,revision:current.data.revision,connection:current.connection});await polling;
  assert.equal(h.requests.length,1);assert.equal(h.controller.inspect().quickText,'本车尚未提交的补报');assert.equal(h.controller.inspect().identityEpoch,0);
});

test('an old action response cannot restore old identity, continue submission callbacks, or unlock a new pending action',async()=>{
  const h=harness('field'),f=fixture(),old=roomSnapshot(f),next=roomSnapshot(f,{staffId:'D2',vehicleId:'V2'});h.controller.seed(old);
  const previous=h.controller.action('report',{}),rejected=assert.rejects(previous,/身份已变化/);h.controller.acceptState(next);const current=h.controller.action('report',{});
  old.data.revision+=10;respond(h.requests[0],old);await rejected;assert.equal(h.controller.inspect().busy,true);assert.equal(h.controller.inspect().state.connection.staffId,'D2');
  next.data.revision++;respond(h.requests[1],next);await current;assert.equal(h.controller.inspect().busy,false);assert.equal(h.controller.inspect().state.connection.staffId,'D2');
});

test('a replaced SSE stream cannot deliver its old projection or force stale reconnect work',()=>{
  const h=harness('field',{events:true}),f=fixture(),old=roomSnapshot(f,{events:true}),next=roomSnapshot(f,{staffId:'D2',vehicleId:'V2',events:true});h.controller.seed(old);h.controller.connectEvents();const first=h.streams[0];
  h.controller.acceptState(next);assert.equal(first.readyState,2);assert.equal(h.streams.length,2);
  old.data.revision+=100;first.emit(old);first.onerror();assert.equal(h.controller.inspect().state.connection.staffId,'D2');assert.equal(h.requests.length,0);
  next.data.revision++;h.streams[1].emit(next);assert.equal(h.controller.inspect().state.data.revision,next.data.revision);
});

test('an in-flight modal submit handles identity replacement after its dialog error element is removed',async()=>{
  const h=harness(),f=fixture(),old=roomSnapshot(f,{role:'commander'}),next=roomSnapshot(f);h.controller.seed(old);h.controller.setModal({kind:'confirm',revision:old.data.revision,session:old.session});
  const submitting=h.submit('modal-form');assert.equal(h.requests.length,1);h.controller.acceptState(next);assert.equal(h.elements['modal-error'],undefined);
  respond(h.requests[0],old);await submitting;assert.match(h.elements.toast.textContent,/身份已变化/);assert.equal(h.controller.inspect().modal,null);assert.equal(h.controller.inspect().state.connection.role,'field');
});
