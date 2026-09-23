'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const Exercise=require('../exercise.cjs');

// Exercise the shipped event handlers with destinations absent from the DOM.
// Browser QA checks visual rendering; these tests enforce navigation/state
// contracts that must hold when only one workspace section is mounted.
function harness(role='command'){
  const listeners={},windowListeners={},requests=[],storage=new Map(),cancelled=[];
  const classes={add(){},remove(){},toggle(){}};
  const element=()=>({open:false,innerHTML:'',textContent:'',classList:classes,
    addEventListener(){},showModal(){this.open=true;},close(){this.open=false;},focus(){}});
  const elements={toast:element(),dialog:element()};
  let voiceActive=false;
  const context={
    document:{getElementById:id=>elements[id]||null,querySelector:()=>null,querySelectorAll:()=>[],
      addEventListener:(name,fn)=>(listeners[name]||=[]).push(fn),createElement:element,
      body:{classList:classes,append(node){elements[node.id]=node;}}},
    location:{hash:'#'+role,pathname:'/jiaoying-ai/'},
    history:{replaceState(_state,_title,hash){context.location.hash=hash;}},
    isSecureContext:true,addEventListener:(name,fn)=>(windowListeners[name]||=[]).push(fn),
    localStorage:{setItem:(key,value)=>storage.set(key,value),getItem:key=>storage.get(key)||null},
    JiaoyingVoice:{create:()=>({active:()=>voiceActive,state:()=>({active:voiceActive}),
      cancel(...args){voiceActive=false;cancelled.push(args);}})},
    JiaoyingVillageUI:{duplicate:()=>null},
    crypto:webcrypto,AbortSignal,Date,setTimeout:()=>1,clearTimeout(){},setInterval(){},
    matchMedia:()=>({matches:true}),requestAnimationFrame:fn=>fn(),scrollTo(){},
    fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject}))
  };
  context.window=context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist/operations-ui.js'),'utf8'),context);
  const bootstrap='render();poll();setInterval(poll,1200);';
  const bridge=`window.testNavigation={
    seed(next){state=next;connected=true;draftLoaded=true;},
    inspect(){return {view,commandSection,fieldSection,fieldWorkspace,tab,assistantOpen,
      fieldUtterance,fieldPrepared,fieldConfirmed,villagePrepared,villageText:villageForm.text,
      form:{...form},showAlternative,revision:d().revision};},
    message(action,sourceText='现场新增情况',revision=d().revision){
      messages.push({id:'suggestion',action,sourceText,revision,view});assistantOpen=true;
    },
    prepare(){
      fieldUtterance='演练东桥有倒树';form.text='保留尚未提交的现场文字';
      fieldConfirmed=true;fieldPrepared={origin:'assistant',session:state.session,
        revision:d().revision,requestId:'retained-field-request',
        proposal:{action:'report',payload:{kind:'road',location:'east',text:fieldUtterance}}};
      villageForm.text='新增4人，集合点待补';
      villagePrepared={session:state.session,revision:d().revision,requestId:'retained-village-request',
        proposal:{action:'village-report',payload:{villageId:'VA',mode:'increment',people:4,
          pickupId:'',assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown',
          reporter:'演练员',text:villageForm.text,source:'text',duplicateAcknowledged:false}}};
    },
    clickAction,navigate,reveal,acceptState,submitFieldPrepared,villageClick
  };`;
  const source=fs.readFileSync(path.join(__dirname,'../dist/workspace-app.js'),'utf8');
  assert.ok(source.includes(bootstrap),'test bridge requires the shipped bootstrap');
  vm.runInContext(source.replace(bootstrap,bridge),context,{filename:'workspace-app.js'});
  return {controller:context.testNavigation,operations:context.JiaoyingOperations,requests,storage,cancelled,
    voice(active){voiceActive=active;},
    click(ac,id='',extra={}){return context.testNavigation.clickAction({dataset:{ac,id,...extra},disabled:false});},
    async operation(op,id=''){
      const el={dataset:{op,id},disabled:false};
      const event={preventDefault(){},target:{closest:selector=>selector==='[data-op]'?el:null}};
      for(const listener of listeners.click||[])await listener(event);
    }
  };
}

function fixture(){
  const store=Exercise.create();store.action('generate');
  return {store,snapshot(){const data=store.data;return {session:'navigation-test',data,
    metrics:Exercise.metrics(data),villageLedger:Exercise.villageMetrics(data),
    blockedVehicles:[],capabilities:{realtimeEvents:true,villageReporting:true,operations:true}};}};
}

test('a field assistant suggestion opens the report form from task history without requiring its DOM',async()=>{
  const h=harness('field'),f=fixture();h.controller.seed(f.snapshot());
  h.controller.navigate('history');h.controller.message('fill-report','演练东桥有倒树，车辆无法通过');
  await h.click('chat-action','suggestion');
  const state=h.controller.inspect();
  assert.equal(state.view,'field');assert.equal(state.fieldSection,'report');
  assert.equal(state.fieldWorkspace,'tasks');assert.equal(state.form.text,'演练东桥有倒树，车辆无法通过');
  assert.equal(state.assistantOpen,false);assert.equal(state.form.checked,false);
  assert.equal(h.requests.length,0,'navigation never submits a suggested report');
});

test('assistant report, evidence and alternate-plan actions expose the correct workspace',async()=>{
  for(const [role,action,section,detail] of [
    ['field','show-reports','history',null],['command','show-reports','inbox',null],
    ['field','alternative','plan','alternative'],['field','explain','more','evidence']
  ]){
    const h=harness(role),f=fixture();h.controller.seed(f.snapshot());
    h.controller.navigate(role==='field'?'tasks':'execution');h.controller.message(action);
    await h.click('chat-action','suggestion');const state=h.controller.inspect();
    assert.equal(state.view,detail?'command':role);
    assert.equal(state.view==='command'?state.commandSection:state.fieldSection,section);
    if(detail==='evidence')assert.equal(state.tab,'evidence');
    if(detail==='alternative')assert.equal(state.showAlternative,true);
    assert.equal(h.requests.length,0,'viewing a suggestion must not publish or recalculate');
  }
});

test('stale assistant actions cannot navigate away or execute against a newer exercise revision',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());
  h.controller.navigate('execution');h.controller.message('generate','',f.snapshot().data.revision-1);
  await assert.rejects(h.click('chat-action','suggestion'),/依据已更新/);
  assert.equal(h.controller.inspect().commandSection,'execution');assert.equal(h.requests.length,0);
});

test('map and scene shortcuts reveal their specific report form while preserving unsubmitted text',async()=>{
  const h=harness('field'),f=fixture();h.controller.seed(f.snapshot());h.controller.prepare();
  h.controller.navigate('history');await h.click('map-road','east');
  let state=h.controller.inspect();assert.equal(state.fieldSection,'report');
  assert.equal(state.fieldWorkspace,'tasks');assert.equal(state.form.kind,'road');
  assert.equal(state.form.location,'east');assert.equal(state.form.text,'保留尚未提交的现场文字');
  assert.equal(state.fieldPrepared,null,'changing a report location requires a fresh confirmation');
  await h.click('field-scene','people');state=h.controller.inspect();
  assert.equal(state.fieldSection,'report');assert.equal(state.fieldWorkspace,'village');
  assert.equal(h.requests.length,0);
});

test('the operations guide navigates from a different section to planning, execution and report',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());
  h.controller.navigate('inbox');await h.operation('guide');
  for(let i=0;i<3;i++)await h.operation('guide-next');
  await h.operation('guide-locate','planning-panel');assert.equal(h.controller.inspect().commandSection,'plan');
  await h.operation('guide-next');await h.operation('guide-locate','task-panel');
  assert.equal(h.controller.inspect().commandSection,'execution');
  await h.operation('guide-next');await h.operation('guide-locate','ops-report');
  assert.equal(h.controller.inspect().commandSection,'more');assert.equal(h.controller.inspect().tab,'report');
  assert.equal(h.requests.length,0,'the guide locates actions without performing them');
});

test('workspace navigation stops voice and preserves both drafts and their stale-version protection',async()=>{
  const h=harness('field'),f=fixture();h.controller.seed(f.snapshot());h.controller.prepare();
  const before=h.controller.inspect();h.voice(true);await h.click('workspace-section','tasks');
  assert.equal(h.cancelled.length,1);await h.click('workspace-section','history');
  await h.click('workspace-section','report');const after=h.controller.inspect();
  assert.equal(after.fieldPrepared,before.fieldPrepared);assert.equal(after.villagePrepared,before.villagePrepared);
  assert.equal(after.fieldUtterance,before.fieldUtterance);assert.equal(after.villageText,before.villageText);
  assert.equal(after.fieldConfirmed,true);assert.ok(h.storage.size,'navigation saves the existing drafts');
  f.store.action('weather',{preset:'small'});h.controller.acceptState(f.snapshot());
  await assert.rejects(h.controller.submitFieldPrepared(),/演练已更新/);
  await assert.rejects(h.controller.villageClick('village-submit'),/现场记录已更新/);
  assert.equal(h.requests.length,0);assert.equal(h.controller.inspect().fieldPrepared,before.fieldPrepared);
});

test('arrival remains actionable until a real human verification action closes that pending item',async()=>{
  const h=harness(),f=fixture();
  f.store.action('confirm',{note:'核对接送对象和路线'});
  f.store.action('contact',{ids:f.store.data.activePlan.servedIds});f.store.action('start');
  const route=f.store.data.activePlan.routes.find(r=>r.people);
  for(let i=0;!f.store.data.fleet[route.vehicleId].finished&&i<10;i++)f.store.action('step',{vehicleId:route.vehicleId});
  const id=route.stops[0].id;assert.equal(f.store.data.stage[id],'arrived');
  const name=f.store.data.scenario.households.find(x=>x.id===id).name;
  const item=h.operations.pending(f.snapshot()).find(item=>item.detail.startsWith(name+' ·')&&/核验/.test(item.title));
  assert.ok(item,'the command inbox must surface arrival awaiting verification');
  assert.equal(f.store.data.stage[id],'arrived','rendering a pending task never verifies it');
  assert.ok(!h.operations.pendingHTML(f.snapshot()).includes('data-op="followup" data-id="'+item.key+'"'),
    'arrival verification must not expose an unsupported followup mutation');
  h.controller.seed(f.snapshot());await h.operation('go',item.op+'|'+item.id);
  assert.equal(h.controller.inspect().commandSection,'execution');assert.equal(h.requests.length,0);
  f.store.action('verify',{id});
  assert.ok(!h.operations.pending(f.snapshot()).some(next=>next.key===item.key));
});
