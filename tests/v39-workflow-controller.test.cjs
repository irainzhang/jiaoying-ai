'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const E=require('../exercise.cjs');
const Workflow=require('../dist/workflow-ui.js');

// Exercise the shipped event handlers. Only layout is omitted: no #content
// element exists, so render does not need a browser or replace our modal DOM.
function harness(role='command'){
  const listeners={},requests=[],storage=new Map(),elements={},downloads=[],blobs=new Map();
  const classes=()=>({add(){},remove(){},toggle(){}});
  const decode=s=>String(s||'').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&amp;/g,'&');
  function element(id=''){
    const handlers={};let html='';
    const el={id,value:'',textContent:'',classList:classes(),open:false,disabled:false,hidden:false,dataset:{},focus(){},scrollIntoView(){},remove(){delete elements[id];},
      addEventListener(name,fn){(handlers[name]??=[]).push(fn);},removeEventListener(name,fn){handlers[name]=(handlers[name]||[]).filter(x=>x!==fn);},
      dispatch(name,event={}){return Promise.all((handlers[name]||[]).map(fn=>fn(event)));},
      querySelector(selector){return selector.startsWith('#')?elements[selector.slice(1)]||null:null;},contains(){return true;},
      close(){this.open=false;this.dispatch('close');},showModal(){this.open=true;},click(){downloads.push({href:this.href,name:this.download});}};
    Object.defineProperty(el,'innerHTML',{get:()=>html,set:value=>{
      html=String(value);
      if(id!=='dialog-content')return;
      for(const match of html.matchAll(/<(input|textarea|select|button|div|p|fieldset|details)\b([^>]*\bid="([^"]+)"[^>]*)>([\s\S]*?)(?=<\/(?:textarea|select|button|div|p|fieldset|details)>|$)|<input\b([^>]*\bid="([^"]+)"[^>]*)>/g)){
        const key=match[3]||match[6];if(!key)continue;elements[key]=element(key);
      }
      // IDs are enough for output elements; individual form values come from
      // their actual generated markup, not duplicated controller defaults.
      for(const match of html.matchAll(/\bid="([^"]+)"/g))elements[match[1]]??=element(match[1]);
      for(const match of html.matchAll(/<input\b([^>]*\bid="([^"]+)"[^>]*)>/g)){elements[match[2]].value=decode(match[1].match(/\bvalue="([^"]*)"/)?.[1]);}
      for(const match of html.matchAll(/<(textarea|select)\b[^>]*\bid="([^"]+)"[^>]*>([\s\S]*?)<\/\1>/g)){
        const options=[...match[3].matchAll(/<option\b([^>]*)>([\s\S]*?)<\/option>/g)];
        const option=options.find(x=>/\bselected\b/.test(x[1]))||options[0];
        elements[match[2]].value=decode(match[1]==='textarea'?match[3]:option?.[1].match(/\bvalue="([^"]*)"/)?.[1]||'');
      }
    }});return el;
  }
  for(const id of ['toast','dialog','dialog-content','modal-error'])elements[id]=element(id);
  let voiceActive=false;
  const context={document:{getElementById:id=>elements[id]||null,querySelector:()=>null,querySelectorAll:()=>[],addEventListener:(name,fn)=>(listeners[name]??=[]).push(fn),createElement:()=>element(),body:{classList:classes()}},
    location:{hash:'#'+role,pathname:'/jiaoying-ai/'},history:{replaceState(_a,_b,hash){context.location.hash=hash;}},isSecureContext:true,
    addEventListener(){},scrollTo(){},requestAnimationFrame:fn=>fn(),
    localStorage:{setItem:(k,v)=>storage.set(k,v),getItem:k=>storage.get(k)||null},
    JiaoyingVoice:{create(){return {active:()=>voiceActive,state:()=>({active:voiceActive}),start(){voiceActive=true;},stop(){voiceActive=false;},cancel(){voiceActive=false;}};}},
    crypto:webcrypto,AbortSignal,Date,TextDecoder,TextEncoder,Uint8Array,ArrayBuffer,DataView,Blob,
    URL:{createObjectURL(blob){const id='test-blob:'+blobs.size;blobs.set(id,blob);return id;},revokeObjectURL(){}},
    setTimeout:()=>1,clearTimeout(){},setInterval(){},matchMedia:()=>({matches:true}),
    fetch:(url,options)=>new Promise(resolve=>requests.push({url,options,resolve}))};
  context.window=context;vm.createContext(context);
  for(const name of ['village-assistant.js','village-workspace.js','command-intake.js','intake-file.js','quick-context.js','review-form.js','workflow-ui.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',name),'utf8'),context,{filename:name});
  const bootstrap='render();poll();setInterval(poll,1200);';
  const bridge=`window.testWorkflow={seed(next){state=next;connected=true;draftLoaded=true;},inspect(){return {view,commandSection,fieldSection,modal,busy,intake,quickText,quickDraft,villageForm,fieldVehicle,fieldHousehold,fieldLocation,reviewBound:!!reviewBinding};},acceptState,clickAction,navigate,reveal,action,readIntakeFile,workspaceNavHTML};`;
  const source=fs.readFileSync(path.join(__dirname,'../dist/workspace-app.js'),'utf8');assert.ok(source.includes(bootstrap));vm.runInContext(source.replace(bootstrap,bridge),context,{filename:'workspace-app.js'});
  return {controller:context.testWorkflow,elements,requests,downloads,blobs,storage,
    click(ac,id){return context.testWorkflow.clickAction({dataset:{ac,id},disabled:false});},
    change(id,value){for(const fn of listeners.change||[])fn({target:{id,value,dataset:{}}});},
    input(id,value){for(const fn of listeners.input||[])fn({target:{id,value,dataset:{}}});},
    submit(){return Promise.all((listeners.submit||[]).map(fn=>fn({target:{id:'modal-form'},preventDefault(){}})));},
    respond(index,fixture,{reject=false}={}){const request=requests[index],body=JSON.parse(request.options.body);if(!reject)fixture.store.action(body.action,body.payload);request.resolve({ok:!reject,json:async()=>({...fixture.snapshot(),...(reject?{error:'依据已变化，请重新核对'}:{})})});return body;}
  };
}
function fixture(){const store=E.create();store.action('generate');return {store,snapshot(){const data=store.data;return {session:'workflow-controller-test',data,taskSummary:E.taskSummary(data),metrics:E.metrics(data),villageLedger:E.villageMetrics(data),blockedVehicles:[],capabilities:{villageReporting:true,commandIntake:true}};}};}
function finish(f){const x=f.store;x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');for(const route of x.data.activePlan.routes.filter(r=>r.people))while(!x.data.fleet[route.vehicleId].finished)x.action('step',{vehicleId:route.vehicleId});for(const [id,stage] of Object.entries(x.data.stage))if(stage==='arrived')x.action('verify',{id});}
const csv='村庄,集合点,人数,需协助人数,轮椅人数,同行关系\n演示村 A,P-A1,2,0,0,可分组';
function file(){const bytes=new TextEncoder().encode(csv);return {name:'任务需求.csv',size:bytes.length,arrayBuffer:async()=>bytes.buffer};}

test('ending unfinished work is a modal choice with stamped concurrency fields and preserved raw states',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());const before=f.store.data;
  await h.click('end-task-dialog');assert.match(h.elements['dialog-content'].innerHTML,/提前结束并保留记录/);assert.doesNotMatch(h.elements['dialog-content'].innerHTML,/<textarea[^>]*required/);assert.equal(h.requests.length,0);
  const pending=h.submit(),body=JSON.parse(h.requests[0].options.body);assert.equal(body.action,'end-task');assert.equal(body.payload.mode,'stopped');assert.equal(body.payload.note,'');assert.equal(body.expectedRevision,before.revision);assert.equal(body.session,'workflow-controller-test');assert.ok(body.requestId);
  h.respond(0,f);await pending;
  assert.equal(f.store.data.taskLifecycle.status,'stopped');assert.deepEqual(f.store.data.stage,before.stage);assert.equal(h.controller.inspect().commandSection,'records');assert.equal(h.elements.dialog.open,false);assert.equal(h.controller.inspect().modal,null);
});

test('fully verified work offers ordinary completion and uses the same explicit modal submission',async()=>{
  const h=harness(),f=fixture();finish(f);h.controller.seed(f.snapshot());await h.click('end-task-dialog');
  assert.equal(h.elements['task-end-mode'].value,'completed');assert.match(h.elements['dialog-content'].innerHTML,/确认完成整场任务/);
  const pending=h.submit();assert.equal(JSON.parse(h.requests[0].options.body).payload.mode,'completed');h.respond(0,f);await pending;
  assert.equal(f.store.data.taskLifecycle.status,'completed');assert.equal(f.store.data.taskLifecycle.summary.verified,15);assert.equal(h.controller.inspect().commandSection,'records');
});

test('arrival batch verification lists only arrived groups and submits the original IDs only after a human confirmation',async()=>{
  const h=harness(),f=fixture(),x=f.store;x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');
  const routes=x.data.activePlan.routes.filter(r=>r.people),first=routes[0];
  while(!x.data.fleet[first.vehicleId].finished)x.action('step',{vehicleId:first.vehicleId});
  h.controller.seed(f.snapshot());const opened=x.data,arrived=opened.scenario.households.filter(row=>opened.stage[row.id]==='arrived'),notArrived=opened.scenario.households.filter(row=>opened.stage[row.id]!=='arrived');
  assert.ok(arrived.length&&notArrived.length);await h.click('verify-arrivals-dialog');const html=h.elements['dialog-content'].innerHTML;
  assert.match(html,/确认这批已到达人员/);assert.ok(html.includes('现场已登记到达 '+arrived.reduce((n,row)=>n+row.people,0)+' 人'));
  const list=html.match(/<ul>([\s\S]*?)<\/ul>/)?.[1];assert.ok(list);assert.equal((list.match(/<li>/g)||[]).length,arrived.length);
  for(const row of arrived){assert.ok(list.includes(row.id),row.id+' must identify its receipt');assert.ok(list.includes(row.name));assert.ok(list.includes(row.people+' 人'));}
  for(const row of notArrived)assert.ok(!list.includes(row.name),'not-yet-arrived group must not be listed: '+row.id);
  assert.equal(h.requests.length,0);assert.deepEqual(x.data,opened);
  // More groups arrive while this dialog is open. Its confirmation must not
  // silently expand to include receipts that the user never saw in the list.
  for(const route of routes.slice(1))while(!x.data.fleet[route.vehicleId].finished)x.action('step',{vehicleId:route.vehicleId});
  h.controller.acceptState(f.snapshot());assert.equal(h.requests.length,0);
  const stale=h.submit(),oldBody=JSON.parse(h.requests[0].options.body);assert.equal(oldBody.action,'verify-arrivals');assert.deepEqual(oldBody.payload.ids,arrived.map(row=>row.id));assert.equal(oldBody.expectedRevision,opened.revision);assert.equal(oldBody.session,'workflow-controller-test');
  h.respond(0,f,{reject:true});await stale;assert.equal(E.taskSummary(x.data).verified,0);assert.match(h.elements['modal-error'].textContent,/重新打开核对/);
  await h.click('verify-arrivals-dialog');const fresh=x.data,allArrived=fresh.scenario.households.filter(row=>fresh.stage[row.id]==='arrived');assert.equal(h.requests.length,1);assert.ok(h.elements['dialog-content'].innerHTML.includes('现场已登记到达 15 人'));
  const confirm=h.submit(),body=JSON.parse(h.requests[1].options.body);assert.deepEqual(body.payload.ids,allArrived.map(row=>row.id));assert.equal(body.expectedRevision,fresh.revision);assert.equal(body.session,'workflow-controller-test');h.respond(1,f);await confirm;
  assert.equal(E.taskSummary(x.data).canComplete,true);assert.equal(E.taskSummary(x.data).verified,15);assert.equal(x.data.taskLifecycle.status,'active');assert.equal(h.elements.dialog.open,false);
});

test('an end dialog keeps its original revision when another operation changes current state',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());await h.click('end-task-dialog');const opened=h.controller.inspect().modal.revision;
  f.store.action('weather',{rainfall:50});h.controller.acceptState(f.snapshot());const pending=h.submit();
  assert.equal(JSON.parse(h.requests[0].options.body).expectedRevision,opened);h.respond(0,f,{reject:true});await pending;
  assert.equal(f.store.data.taskLifecycle.status,'active');assert.equal(h.elements.dialog.open,true);assert.match(h.elements['modal-error'].textContent,/关闭后重新打开核对/);
});

test('remote closure moves command to records and prevents further mutating actions before HTTP',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.controller.navigate('plan');f.store.action('end-task',{mode:'stopped'});h.controller.acceptState(f.snapshot());
  assert.equal(h.controller.inspect().commandSection,'records');h.controller.navigate('inbox');assert.equal(h.controller.inspect().commandSection,'records');
  await assert.rejects(h.click('generate'),/任务已结束/);await assert.rejects(h.click('weather-demo'),/任务已结束/);assert.equal(h.requests.length,0);
  assert.equal(h.controller.workspaceNavHTML(),'');h.controller.navigate('more');assert.equal(h.controller.inspect().commandSection,'more');
});

test('starting a new task archives old work, returns to intake, and discards old unsent demands',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());await h.controller.readIntakeFile(file());h.input('quick-text','新增三人');
  f.store.action('end-task',{mode:'stopped'});h.controller.acceptState(f.snapshot());const oldId=f.store.data.exerciseId;
  await h.click('new-task-dialog');assert.match(h.elements['dialog-content'].innerHTML,/上一场的未完成人员不会自动带入/);
  const revision=f.store.data.revision,pending=h.submit(),body=JSON.parse(h.requests[0].options.body);assert.equal(body.action,'new-task');assert.deepEqual(body.payload,{});assert.equal(body.expectedRevision,revision);assert.equal(body.session,'workflow-controller-test');
  h.respond(0,f);await pending;const ui=h.controller.inspect();assert.notEqual(f.store.data.exerciseId,oldId);assert.equal(f.store.data.taskArchives[0].exerciseId,oldId);assert.equal(ui.commandSection,'inbox');assert.equal(ui.intake.draft,null);assert.equal(ui.intake.filename,'');assert.equal(ui.quickText,'');assert.equal(ui.quickDraft,null);
});

test('new task also clears correction mode and stale field selection from the previous task',async()=>{
  const h=harness('field'),f=fixture();h.controller.seed(f.snapshot());h.change('village-mode','correction');h.change('village-target','VR-stale');h.change('field-vehicle','V3');h.change('field-household','VG-stale');h.change('field-location','old-node');
  f.store.action('end-task',{mode:'stopped'});h.controller.acceptState(f.snapshot());f.store.action('new-task');h.controller.acceptState(f.snapshot());const ui=h.controller.inspect();
  assert.equal(ui.villageForm.mode,'increment');assert.equal(ui.villageForm.targetId,'');assert.equal(ui.fieldVehicle,'');assert.equal(ui.fieldHousehold,'');assert.equal(ui.fieldLocation,'');assert.equal(ui.fieldSection,'tasks');
});

test('archives can be viewed and exported without restoring the old task or sending write actions',async()=>{
  const h=harness(),f=fixture();f.store.action('command-intake',{source:'text',rows:[{villageName:'未定位上传村',people:2,assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown'}]});f.store.action('end-task',{mode:'stopped'});const old=f.store.data;f.store.action('new-task');h.controller.seed(f.snapshot());const before=f.store.data;
  await h.click('archive-view',old.exerciseId);assert.match(h.elements['dialog-content'].innerHTML,/历史任务记录/);assert.doesNotMatch(h.elements['dialog-content'].innerHTML,/data-ac="restore"|恢复这场|重新打开/);assert.equal(h.requests.length,0);
  await h.click('archive-export',old.exerciseId);assert.equal(h.downloads.length,1);const exported=JSON.parse(await h.blobs.get(h.downloads[0].href).text());assert.equal(exported.data.exerciseId,old.exerciseId);assert.equal(exported.data.taskLifecycle.status,'stopped');assert.deepEqual(exported.data.stage,old.stage);assert.deepEqual(exported.data.taskArchives,[]);assert.equal(h.requests.length,0);assert.deepEqual(f.store.data,before);
  assert.equal(exported.taskSummary.people,17);assert.equal(E.metrics(before).people,15);if(exported.metrics)assert.equal(exported.metrics.people,17,'archive metadata must not inherit current task counts');
  assert.doesNotMatch(Workflow.archives(f.snapshot()),/restore|恢复|重新打开/);
});

test('the actual review modal renders, binds, and submits nullable facts without obligatory note text',async()=>{
  const h=harness(),f=fixture();f.store.action('village-report',{villageId:'VA',mode:'increment',people:20,pickupId:'P-A1',assistancePeople:3,wheelchairPeople:null,groupPolicy:'unknown',text:'新增二十人，其中三人需要协助'});h.controller.seed(f.snapshot());const id=f.store.data.villageReports[0].id;
  await h.click('village-review',id);assert.match(h.elements['dialog-content'].innerHTML,/上报原值/);assert.equal(h.controller.inspect().reviewBound,true);assert.equal(h.elements['review-submit'].textContent,'先保存为待补信息');
  const pending=h.submit(),body=JSON.parse(h.requests[0].options.body);assert.equal(body.action,'village-review');assert.equal(body.payload.wheelchairPeople,null);assert.match(body.payload.note,/待补充/);h.respond(0,f);await pending;
  assert.equal(f.store.data.villageReports[0].needsInfo,true);assert.equal(h.controller.inspect().reviewBound,false);
  await h.click('village-complete',id);h.elements['vreview-wheelchair'].value='0';h.elements['vreview-group'].value='splittable';await h.elements['dialog-content'].dispatch('change');assert.equal(h.elements['review-submit'].textContent,'保存并生成安排');
  const complete=h.submit();assert.equal(JSON.parse(h.requests[1].options.body).payload.wheelchairPeople,0);h.respond(1,f);await complete;assert.equal(f.store.data.villageReports[0].needsInfo,false);
});

test('readonly total correction action changes to the field role with an explicit accepted batch target',async()=>{
  const h=harness(),f=fixture();f.store.action('village-report',{villageId:'VA',mode:'increment',people:2,text:'新增两人'});const id=f.store.data.villageReports[0].id;f.store.action('village-review',{id,decision:'accept',note:'人数采纳，详情待补'});h.controller.seed(f.snapshot());await h.click('village-complete',id);await h.click('review-correct',id);const ui=h.controller.inspect();
  assert.equal(ui.view,'field');assert.equal(ui.fieldSection,'report');assert.equal(ui.villageForm.mode,'correction');assert.equal(ui.villageForm.targetId,id);assert.equal(ui.reviewBound,false);assert.equal(h.elements.dialog.open,false);assert.equal(h.requests.length,0);
});

test('legacy plan, execution, more and report entry points remain routed through the simplified navigation',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());assert.equal((h.controller.workspaceNavHTML().match(/data-ac="workspace-section"/g)||[]).length,3);
  await h.click('workspace-section','plan');assert.equal(h.controller.inspect().commandSection,'plan');assert.match(h.controller.workspaceNavHTML(),/data-id="execution" class="active"/);
  await h.click('workspace-section','execution');assert.equal(h.controller.inspect().commandSection,'execution');await h.click('workspace-section','more');assert.equal(h.controller.inspect().commandSection,'more');await h.click('report');assert.equal(h.controller.inspect().commandSection,'records');
  const field=harness('field');field.controller.seed(f.snapshot());await field.click('workspace-section','history');assert.equal(field.controller.inspect().fieldSection,'history');assert.equal((field.controller.workspaceNavHTML().match(/data-ac="workspace-section"/g)||[]).length,2);assert.match(field.controller.workspaceNavHTML(),/data-id="report" class="active"/);
});
