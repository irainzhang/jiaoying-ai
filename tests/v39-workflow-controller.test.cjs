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
  for(const name of ['village-assistant.js','village-workspace.js','place-directory.js','command-intake.js','intake-file.js','entry-kit.js','resource-intake.js','quick-context.js','review-form.js','workflow-ui.js','resource-registry.js','resource-cards.js','task-workbench.js'])vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',name),'utf8'),context,{filename:name});
  const bootstrap='render();poll();setInterval(poll,1200);';
  const bridge=`window.testWorkflow={seed(next){state=next;connected=true;draftLoaded=true;},inspect(){return {view,commandSection,fieldSection,modal,busy,intake,quickText,quickDraft,villageForm,fieldVehicle,fieldHousehold,fieldLocation,reviewBound:!!reviewBinding};},acceptState,clickAction,navigate,reveal,action,readIntakeFile,workspaceNavHTML,commitIntakePlace,intakePlaceOptions,restoreIntakeDraft(){draftLoaded=false;restoreDraft();}};`;
  const source=fs.readFileSync(path.join(__dirname,'../dist/workspace-app.js'),'utf8');assert.ok(source.includes(bootstrap));vm.runInContext(source.replace(bootstrap,bridge),context,{filename:'workspace-app.js'});
  return {controller:context.testWorkflow,guardian:context.JiaoyingGuardianHost,elements,requests,downloads,blobs,storage,
    click(ac,id){return context.testWorkflow.clickAction({dataset:{ac,id},disabled:false});},
    change(id,value){for(const fn of listeners.change||[])fn({target:{id,value,dataset:{}}});},
    input(id,value,dataset={}){for(const fn of listeners.input||[])fn({target:{id,value,dataset}});},
    submit(){return Promise.all((listeners.submit||[]).map(fn=>fn({target:{id:'modal-form'},preventDefault(){}})));},
    respond(index,fixture,{reject=false}={}){const request=requests[index],body=JSON.parse(request.options.body);if(!reject)fixture.store.action(body.action,body.payload);request.resolve({ok:!reject,json:async()=>({...fixture.snapshot(),...(reject?{error:'依据已变化，请重新核对'}:{})})});return body;}
  };
}
function fixture(initial=null){const store=E.create(initial);store.action('generate');return {store,snapshot(){const data=store.data;return {session:'workflow-controller-test',data,taskSummary:E.taskSummary(data),mapConversion:E.mapConversionStatus(data),metrics:E.metrics(data),villageLedger:E.villageMetrics(data),blockedVehicles:[],capabilities:{villageReporting:true,commandIntake:true}};}};}
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
  await h.click('new-task-dialog');assert.match(h.elements['dialog-content'].innerHTML,/默认不带入上一场人员/);
  const revision=f.store.data.revision,pending=h.submit(),body=JSON.parse(h.requests[0].options.body);assert.equal(body.action,'new-task');assert.deepEqual(body.payload,{mapMode:'ruian-roads',seedMode:'blank',name:'',carryWaiting:false});assert.equal(body.expectedRevision,revision);assert.equal(body.session,'workflow-controller-test');
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
  assert.doesNotMatch(Workflow.archives(f.snapshot()),/data-ac="restore"|恢复这场|重新打开/);
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

function savedProgress(){
  const f=fixture(),x=f.store;x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');
  const route=x.data.activePlan.routes.find(row=>row.people);x.action('step',{vehicleId:route.vehicleId});
  x.action('report',{kind:'hazard',location:'H1',text:'现场补报一条待核实情况'});return f;
}

test('resource entry from a published task reviews end and new-task separately before opening the editable registry',async()=>{
 const f=savedProgress(),h=harness(),old=f.store.data;h.controller.seed(f.snapshot());
 await h.click('resource-next-task');assert.equal(h.requests.length,0);assert.equal(h.controller.inspect().modal.kind,'end-task');assert.match(h.elements['dialog-content'].innerHTML,/接下来：新建任务/);assert.deepEqual(f.store.data,old);
 let pending=h.submit();assert.equal(JSON.parse(h.requests[0].options.body).action,'end-task');h.respond(0,f);await pending;
 assert.equal(f.store.data.taskLifecycle.status,'stopped');assert.deepEqual(f.store.data.fleet,old.fleet);assert.deepEqual(f.store.data.stage,old.stage);assert.equal(h.requests.length,1);assert.equal(h.controller.inspect().modal.kind,'new-task');assert.equal(h.elements['task-map-mode'].value,'same');
 assert.match(h.elements['dialog-content'].innerHTML,/下一步直接打开资源录入/);
 pending=h.submit();const body=JSON.parse(h.requests[1].options.body);assert.equal(body.action,'new-task');assert.equal(body.payload.seedMode,'blank');assert.equal(body.payload.carryWaiting,false);h.respond(1,f);await pending;
 assert.equal(h.controller.inspect().modal.kind,'configure-resources');assert.ok(h.elements.dialog.open);assert.match(h.elements['dialog-content'].innerHTML,/data-readonly="false"/);assert.equal(E.metrics(f.store.data).people,0);assert.deepEqual(f.store.data.taskArchives[0].data.fleet,old.fleet);assert.equal(h.requests.length,2);
});

test('resource next-task navigation can be cancelled and an already-ended task skips the end action',async()=>{
 const h=harness(),f=fixture();f.store.action('confirm');h.controller.seed(f.snapshot());const before=f.store.data;
 await h.click('resource-next-task');await h.click('close');assert.equal(h.requests.length,0);assert.deepEqual(f.store.data,before);
 f.store.action('end-task',{mode:'stopped'});h.controller.acceptState(f.snapshot());await h.click('resource-next-task');assert.equal(h.controller.inspect().modal.kind,'new-task');assert.equal(h.requests.length,0);await h.click('close');assert.equal(h.elements.dialog.open,false);
});

test('blocked map setup displays saved plan, passenger progress and pending report instead of an unusable convert button',()=>{
  const f=savedProgress(),before=f.store.data,state=f.snapshot();assert.equal(state.mapConversion.allowed,false);assert.ok(state.taskSummary.boarded>0);assert.equal(state.taskSummary.pendingReports,1);
  const html=Workflow.mapSetup(state);assert.ok(html.includes('已发布 '+before.activePlan.id));assert.ok(html.includes('车上 '+state.taskSummary.boarded+' 人'));assert.ok(html.includes('待核实 1 条'));assert.ok(html.includes('待接 '+state.taskSummary.waiting+' 人'));
  assert.match(html,/“未选择文件”只表示没有上传新名单/);assert.match(html,/data-ac="workspace-section" data-id="execution"/);assert.match(html,/data-ac="end-for-road-dialog"/);assert.doesNotMatch(html,/data-ac="map-enable"/);assert.match(html,/旧场记录会保留/);
  assert.deepEqual(f.store.data,before,'rendering the conversion explanation must never close, reset or modify saved work');
  assert.match(Workflow.mapSetup(fixture().snapshot()),/data-ac="map-enable"/);
});

test('switching an in-progress task to Ruian roads requires separate end and new-task confirmations with an intact archive',async()=>{
  const h=harness(),f=savedProgress(),old=f.store.data;h.controller.seed(f.snapshot());
  await h.click('end-for-road-dialog');assert.equal(h.requests.length,0);assert.deepEqual(f.store.data,old);assert.equal(h.controller.inspect().modal.kind,'end-task');assert.match(h.elements['dialog-content'].innerHTML,/提前结束并保留记录/);
  const end=h.submit(),endBody=JSON.parse(h.requests[0].options.body);assert.equal(endBody.action,'end-task');assert.equal(endBody.payload.mode,'stopped');assert.equal(endBody.expectedRevision,old.revision);assert.equal(endBody.session,'workflow-controller-test');h.respond(0,f);await end;
  const closed=f.store.data;assert.equal(closed.taskLifecycle.status,'stopped');for(const key of ['stage','fleet','activePlan','reports'])assert.deepEqual(closed[key],old[key]);assert.equal(closed.exerciseId,old.exerciseId);assert.equal(closed.scenario.region.mapKind,old.scenario.region.mapKind);
  assert.equal(h.requests.length,1,'opening the second dialog is not permission to create a new task');assert.equal(h.controller.inspect().modal.kind,'new-task');assert.equal(h.elements['task-map-mode'].value,'ruian-roads');assert.equal(h.elements.dialog.open,true);assert.match(h.elements['dialog-content'].innerHTML,/空白任务 · 0 人/);
  await h.click('close');assert.equal(h.requests.length,1);assert.deepEqual(f.store.data,closed,'cancelling the new-task dialog leaves the ended task intact');
  await h.click('new-road-task-dialog');assert.equal(h.requests.length,1);assert.equal(h.elements['task-map-mode'].value,'ruian-roads');
  const create=h.submit(),newBody=JSON.parse(h.requests[1].options.body);assert.equal(newBody.action,'new-task');assert.deepEqual(newBody.payload,{mapMode:'ruian-roads',seedMode:'blank',name:'',carryWaiting:false});assert.equal(newBody.expectedRevision,closed.revision);assert.equal(newBody.session,'workflow-controller-test');assert.notEqual(newBody.requestId,endBody.requestId);h.respond(1,f);await create;
  const next=f.store.data;assert.notEqual(next.exerciseId,old.exerciseId);assert.equal(next.scenario.region.mapKind,'osm-road-network');assert.equal(next.activePlan,null);assert.equal(E.metrics(next).waiting,0);assert.equal(next.taskArchives.length,1);assert.equal(next.taskArchives[0].exerciseId,old.exerciseId);for(const key of ['stage','fleet','activePlan','reports'])assert.deepEqual(next.taskArchives[0].data[key],old[key]);
  assert.equal(h.controller.inspect().commandSection,'inbox');assert.deepEqual(h.requests.map(row=>JSON.parse(row.options.body).action),['end-task','new-task']);
});

test('V4 public new-task form defaults to blank road task without importing sample passengers or requiring a name',async()=>{
 const h=harness(),f=fixture();f.store.action('end-task',{mode:'stopped'});h.controller.seed(f.snapshot());await h.click('new-task-dialog');assert.equal(h.elements['task-seed-mode'].value,'blank');assert.equal(h.elements['task-map-mode'].value,'ruian-roads');assert.equal(h.elements['task-name'].value,'');const pending=h.submit();h.respond(0,f);await pending;assert.equal(E.metrics(f.store.data).people,0);assert.equal(f.store.data.taskName,'新建转移任务');assert.equal(f.store.data.scenario.region.mapKind,'osm-road-network');assert.equal(f.store.data.activePlan,null);assert.equal(f.store.data.taskArchives[0].summary.people,15);
});

test('V4 batch-contact button dispatches its actual plural action name and keeps plan/revision bound to its dialog',async()=>{
 const h=harness('field'),f=fixture();f.store.action('confirm');const p=f.store.data.activePlan,r=p.routes.find(r=>r.people);f.store.action('field-progress',{stage:'ack',planId:p.id,vehicleId:r.vehicleId});h.controller.seed(f.snapshot());await h.click('vehicle-contacts-dialog',r.vehicleId);assert.equal(h.controller.inspect().modal.kind,'vehicle-contacts');assert.equal(h.requests.length,0);assert.equal(h.controller.inspect().modal.planId,p.id);h.elements['dialog-content'].querySelectorAll=()=>r.stops.map(st=>({value:st.id,checked:true}));const revision=f.store.data.revision,pending=h.submit(),body=JSON.parse(h.requests[0].options.body);assert.equal(body.action,'field-contact-batch');assert.equal(body.payload.planId,p.id);assert.equal(body.payload.vehicleId,r.vehicleId);assert.deepEqual(body.payload.householdIds,r.stops.map(st=>st.id));assert.equal(body.expectedRevision,revision);h.respond(0,f);await pending;assert.ok(r.stops.every(st=>f.store.data.contacts[st.id].contacted));assert.ok(Object.values(f.store.data.stage).every(stage=>stage==='waiting'));
});

test('V4 uploaded eight-person task passes UI publish/contact/start and next-trip confirmation without losing delivered facts',async()=>{
 const h=harness(),f=fixture(E.createBlank({mapMode:'same'}));f.store.action('configure-resources',{vehicles:[{id:'V1',name:'接送车',capacity:4,start:'D',available:true,wheelchair:false}],shelters:[{id:'S1',name:'接收点',capacity:20,available:true}]});h.controller.seed(f.snapshot());const bytes=new TextEncoder().encode('村庄,集合点,人数,需协助人数,轮椅人数,同行关系\n演示村 A,P-A1,8,0,0,可分组');await h.controller.readIntakeFile({name:'本场8人.csv',size:bytes.length,arrayBuffer:async()=>bytes.buffer});assert.equal(h.requests.length,0);let pending=h.click('intake-submit');h.respond(0,f);await pending;assert.equal(E.metrics(f.store.data).people,8);assert.equal(h.controller.inspect().commandSection,'plan');await h.click('confirm');pending=h.submit();h.respond(1,f);await pending;assert.equal(h.controller.inspect().commandSection,'execution');let p=f.store.data.activePlan;assert.equal(p.servedPeople,4);assert.equal(p.unassigned.reduce((n,r)=>n+r.people,0),4);f.store.action('field-progress',{stage:'ack',planId:p.id,vehicleId:'V1'});h.controller.acceptState(f.snapshot());await h.click('vehicle-contacts-dialog','V1');h.elements['dialog-content'].querySelectorAll=()=>p.routes[0].stops.map(st=>({value:st.id,checked:true}));pending=h.submit();h.respond(2,f);await pending;await h.click('vehicle-start-dialog','V1');pending=h.submit();h.respond(3,f);await pending;assert.equal(f.store.data.fleet.V1.startedPlanId,p.id);while(!f.store.data.fleet.V1.finished){const index=h.requests.length;pending=h.click('step','V1');h.respond(index,f);await pending;}assert.equal(E.metrics(f.store.data).arrived,4);const finished=f.store.data;await h.click('next-trip-dialog','V1');assert.match(h.elements['dialog-content'].innerHTML,/保留上一趟已送达人员/);const index=h.requests.length;pending=h.submit();const payload=JSON.parse(h.requests[index].options.body);assert.equal(payload.action,'start-next-trip');assert.equal(payload.expectedRevision,finished.revision);h.respond(index,f);await pending;assert.equal(h.controller.inspect().commandSection,'plan');assert.deepEqual(f.store.data.occupancy,finished.occupancy);assert.deepEqual(f.store.data.fleet.V1.delivered,finished.fleet.V1.delivered);assert.equal(f.store.data.plan.servedPeople,4);assert.equal(f.store.data.fleet.V1.tripNumber,2);assert.equal(f.store.data.fleet.V1.startedPlanId,null);assert.doesNotThrow(()=>E.restore(f.store.data));
});

test('V4 actual Guardian host guards every version component before draft writes or opening publication review',async()=>{
 const h=harness(),f=fixture(),stamp=()=>({session:f.snapshot().session,revision:f.store.data.revision,inputVersion:f.store.data.inputVersion,executionVersion:f.store.data.executionVersion});h.controller.seed(f.snapshot());const current=stamp(),read=h.guardian.readState();read.data.scenario.households=[];assert.equal(h.guardian.readState().data.scenario.households.length,6);
 for(const key of Object.keys(current)){const stale={...current,[key]:key==='session'?'wrong':current[key]+1};await assert.rejects(h.guardian.calculateDraft(stale),/已变化/);assert.throws(()=>h.guardian.openPublicationReview(stale),/已变化/);}assert.equal(h.requests.length,0);assert.equal(h.elements.dialog.open,false);
 const pending=h.guardian.calculateDraft(current),body=JSON.parse(h.requests[0].options.body);assert.equal(body.action,'generate');assert.equal(body.expectedRevision,current.revision);assert.equal(body.session,current.session);h.respond(0,f);await pending;assert.equal(f.store.data.activePlan,null);const calculated=stamp();h.guardian.openPublicationReview(calculated);assert.equal(h.controller.inspect().modal.kind,'confirm');assert.equal(h.requests.length,1);f.store.action('weather',{rainfall:80});h.controller.acceptState(f.snapshot());assert.throws(()=>h.guardian.openPublicationReview(calculated),/已变化/);assert.equal(h.requests.length,1);
});

test('V4 stale vehicle-start dialog cannot silently start a newly published plan',async()=>{
 const h=harness(),f=fixture();f.store.action('confirm');const old=f.store.data.activePlan,route=old.routes.find(r=>r.people);f.store.action('field-progress',{stage:'ack',planId:old.id,vehicleId:route.vehicleId});f.store.action('field-contact-batch',{planId:old.id,vehicleId:route.vehicleId,householdIds:route.stops.map(st=>st.id)});h.controller.seed(f.snapshot());const revision=f.store.data.revision;await h.click('vehicle-start-dialog',route.vehicleId);f.store.action('generate');f.store.action('confirm');h.controller.acceptState(f.snapshot());const pending=h.submit(),body=JSON.parse(h.requests[0].options.body);assert.equal(body.payload.planId,old.id);assert.equal(body.expectedRevision,revision);h.respond(0,f,{reject:true});await pending;assert.notEqual(f.store.data.fleet[route.vehicleId].startedPlanId,f.store.data.activePlan.id);assert.equal(h.elements.dialog.open,true);assert.match(h.elements['modal-error'].textContent,/重新打开核对/);
});

test('V4 Guardian publication review selects the freshly calculated primary draft rather than a leftover alternative toggle',async()=>{
 const h=harness(),f=fixture();assert.ok(f.store.data.alternative);h.controller.seed(f.snapshot());await h.click('alternative');const current={session:f.snapshot().session,revision:f.store.data.revision,inputVersion:f.store.data.inputVersion,executionVersion:f.store.data.executionVersion};h.guardian.openPublicationReview(current);assert.equal(h.controller.inspect().modal.alternative,false);assert.ok(h.elements['dialog-content'].innerHTML.includes(f.store.data.plan.id));assert.ok(!h.elements['dialog-content'].innerHTML.includes(f.store.data.alternative.id));assert.equal(h.requests.length,0);
});

test('V4.0.2 searchable quick entry preserves a registered district and routes incomplete demand to follow-up',async()=>{
 const h=harness(),f=fixture(E.createBlank({mapMode:'ruian-roads'}));h.controller.seed(f.snapshot());
 const district={id:'intake-scope-village',value:'玉海街道',dataset:{intakeScope:'villageName'}};
 h.controller.commitIntakePlace(district,'玉海街道',null,{reason:'blur'});
 h.input('intake-fast-people','10',{intakeFast:'people'});await h.click('intake-fast-prepare');
 const draft=h.controller.inspect().intake.draft;assert.equal(draft.rows.length,1);assert.equal(draft.rows[0].villageName,'玉海街道');assert.equal(draft.rows[0].people,10);assert.equal(draft.rows[0].villageId,f.store.data.villages.find(v=>v.name==='玉海街道').id);assert.equal(draft.rows[0].assistancePeople,null);assert.equal(draft.errors.length,0);
 const pending=h.click('intake-submit'),body=JSON.parse(h.requests[0].options.body);assert.equal(body.payload.rows[0].people,10);assert.equal(body.payload.rows[0].villageName,'玉海街道');h.respond(0,f);await pending;assert.equal(E.metrics(f.store.data).people,10);assert.equal(h.controller.inspect().commandSection,'inbox');assert.equal(f.store.data.plan?.servedPeople||0,0);
});

test('V4.0.1 switching selected district clears the old pickup and a changed fast count invalidates preview',async()=>{
 const h=harness(),f=fixture();h.controller.seed(f.snapshot());const input={dataset:{intakeScope:'villageName'},value:''};
 h.controller.commitIntakePlace(input,'VA',{id:'VA'},{reason:'selection'});
 h.controller.commitIntakePlace({dataset:{intakeScope:'pickupName'},value:''},'P-A1',{id:'P-A1'},{reason:'selection'});
 assert.equal(h.controller.inspect().intake.scope.pickupId,'P-A1');h.input('intake-fast-people','10',{intakeFast:'people'});await h.click('intake-fast-prepare');assert.equal(h.controller.inspect().intake.draft.rows[0].people,10);
 h.input('intake-fast-people','12',{intakeFast:'people'});assert.equal(h.controller.inspect().intake.draft,null);
 h.controller.commitIntakePlace(input,'VB',{id:'VB'},{reason:'blur'});const scope=h.controller.inspect().intake.scope;assert.equal(scope.villageId,'VB');assert.equal(scope.pickupId,'');assert.equal(scope.pickupName,'');const options=h.controller.intakePlaceOptions({dataset:{intakeScope:'pickupName'}});assert.ok(options.every(p=>p.id!=='P-A1'));
 await h.click('intake-fast-prepare');assert.equal(h.controller.inspect().intake.draft.rows[0].people,12);assert.equal(h.controller.inspect().intake.draft.rows[0].pickupId,'');
});

test('V4.0.1 recovers the old unmatched-village draft as a reviewable row without writing a task',()=>{
 const h=harness(),f=fixture(E.createBlank({mapMode:'ruian-roads'}));h.controller.seed(f.snapshot());h.storage.set('jiaoying-draft-v35:/jiaoying-ai/:command',JSON.stringify({exerciseId:f.store.data.exerciseId,intake:{text:'玉海街道，新增 10 人',source:'text',draft:{rows:[],errors:['第1条：未识别到已登记的村庄，请使用完整村名或编号。'],warnings:[]}}}));
 h.controller.restoreIntakeDraft();const draft=h.controller.inspect().intake.draft;assert.equal(draft.rows.length,1);assert.equal(draft.rows[0].people,10);assert.equal(draft.rows[0].villageName,'玉海街道');assert.equal(h.requests.length,0);assert.equal(E.metrics(f.store.data).people,0);
});
