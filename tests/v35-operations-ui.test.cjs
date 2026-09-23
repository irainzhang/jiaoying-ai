'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const X=require('../exercise.cjs');

function ui(){
  const context={Date};context.window=context;
  vm.createContext(context);
  for(const name of ['capabilities.js','evidence-library.js','operations-ui.js'])
    vm.runInContext(fs.readFileSync(path.join(__dirname,'../dist',name),'utf8'),context,{filename:name});
  return {operations:context.JiaoyingOperations,evidence:context.JiaoyingEvidence};
}
const state=store=>{
  const data=store.data;
  return {data,session:'operations-ui-test',savedAt:'2026-09-23T12:00:00Z',
    metrics:X.metrics(data),diagnostics:X.diagnostics(data),
    blockedVehicles:(data.activePlan?.routes||[]).filter(r=>X.blockedRoute(data,r)).map(r=>r.vehicleId),
    capabilities:{operations:true,persistentStorage:true}};
};
const create=()=>{const store=X.create();store.action('generate');return store;};
const missingReport=store=>{
  store.action('village-report',{villageId:'VA',mode:'increment',people:2,
    text:'新增 2 人，接人位置与特殊需求待核实',reporter:'演练人员',source:'text'});
  return store.data.villageReports[0].id;
};

test('every displayed actionable followup can be saved through the actual domain',()=>{
  const {operations}=ui();
  for(const id of ['normal','resource-shortage','shelter-loss','village-growth']){
    const store=create();store.action('scenario',{id});
    const items=operations.pending(state(store));assert.ok(items.length);
    for(const item of items){
      assert.doesNotThrow(()=>store.action('followup',{key:item.key,owner:'演练值守',note:'已核对，继续联系并协调',dueAt:null,status:'working'}),`${id}: ${item.key}`);
      const current=operations.pending(state(store)).find(x=>x.key===item.key);
      assert.equal(current.owner,'演练值守');assert.equal(current.note,'已核对，继续联系并协调');
    }
  }
});

test('rejected incomplete village reports leave pending, while accepted incomplete reports remain actionable',()=>{
  const {operations}=ui(),rejected=create(),rejectedId=missingReport(rejected);
  assert.equal(operations.pending(state(rejected)).find(x=>x.key==='village:'+rejectedId)?.op,'village-review');
  rejected.action('village-review',{id:rejectedId,decision:'reject',note:'重复上报，本演练不采纳'});
  assert.equal(rejected.data.villageReports[0].needsInfo,true,'rejection does not erase original missing-information facts');
  assert.ok(!operations.pending(state(rejected)).some(x=>x.key==='village:'+rejectedId));
  const accepted=create(),acceptedId=missingReport(accepted);
  accepted.action('village-review',{id:acceptedId,decision:'accept',note:'人数核对属实，接送信息待补'});
  assert.equal(operations.pending(state(accepted)).find(x=>x.key==='village:'+acceptedId)?.op,'village-complete');
  accepted.action('village-complete',{id:acceptedId,pickupId:'P-A1',assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',note:'现场已补齐集合点与需求'});
  assert.ok(!operations.pending(state(accepted)).some(x=>x.key==='village:'+acceptedId));
});

test('vehicle and shelter failures have resource-management entries and disappear after verified recovery',()=>{
  const {operations}=ui(),store=create();
  for(const [kind,id] of [['vehicle','V1'],['shelter','S1']]){
    store.action('resource-event',{kind,id,available:false,reason:'演练现场已核实该资源暂时不可用'});
    const item=operations.pending(state(store)).find(x=>x.key===kind+':'+id);
    assert.ok(item,kind+' outage must remain visible even without a blocked active route');
    assert.equal(item.op,'resource');
    store.action('followup',{key:item.key,owner:'资源协调员',note:'已联系现场，等待恢复确认',dueAt:null,status:'working'});
    assert.equal(operations.pending(state(store)).find(x=>x.key===item.key).owner,'资源协调员');
    store.action('resource-event',{kind,id,available:true,reason:'现场完成复核，演练资源恢复可用'});
    assert.ok(!operations.pending(state(store)).some(x=>x.key===kind+':'+id));
  }
});

test('sources and report display the actual evidence library without object placeholders',()=>{
  const {operations,evidence}=ui(),html=operations.sources();
  assert.doesNotMatch(html,/\[object Object\]/);
  for(const source of evidence.sources){assert.ok(html.includes(source.name));assert.ok(html.includes(source.url.replace(/&/g,'&amp;')));}
  for(const policy of evidence.policies){assert.ok(html.includes(policy.section));assert.ok(html.includes(policy.summary));assert.ok(html.includes(policy.application));assert.ok(html.includes(policy.boundary));}
  for(const limit of evidence.limits)assert.ok(html.includes(limit.detail),limit.id+' limitation must be readable');
  assert.doesNotMatch(operations.report(state(create())),/\[object Object\]/);
});

test('external user text is rendered as text in pending and review report, not as markup',()=>{
  const {operations}=ui(),store=create(),payload='<img src=x onerror=alert(1)> & "现场记录"';
  store.action('report',{kind:'hazard',location:'H1',text:payload,reporter:'<现场人员>',source:'text'});
  store.action('followup',{key:'report:R1',owner:'<责任角色>',note:'<script>alert(2)</script> 已核对',dueAt:null,status:'working'});
  const report=operations.report(state(store));
  assert.ok(report.includes('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;现场记录&quot;'));
  assert.ok(report.includes('&lt;责任角色&gt;'));assert.ok(report.includes('&lt;script&gt;alert(2)&lt;/script&gt;'));
  assert.doesNotMatch(report,/<img\b|<script\b/);
  if(operations.pendingHTML){const pending=operations.pendingHTML(state(store));assert.ok(pending.includes('&lt;img'));assert.doesNotMatch(pending,/<img\b|<script\b/);}
});

test('comparison and report metrics come from the current computed plans and retain unmet demand',()=>{
  const {operations}=ui(),store=create();store.action('scenario',{id:'resource-shortage'});
  const current=state(store),html=operations.details(current),report=operations.report(current),d=current.data;
  for(const plan of [d.plan,d.baseline])for(const route of plan.routes.filter(r=>r.people)){
    assert.ok(html.includes(route.people+' 人'),route.vehicleId+' passenger count');
    assert.ok(html.includes(route.finish+' 分抵达'),route.vehicleId+' computed arrival');
    for(const stop of route.stops)assert.ok(html.includes(d.scenario.households.find(h=>h.id===stop.id).name));
  }
  const wait=current.diagnostics.comparison.assistedWait;
  assert.ok(html.includes('草案 '+wait.optimized+' / 基线 '+wait.baseline+' 人·分钟'));
  for(const person of d.plan.unassigned){assert.ok(report.includes(person.name));assert.ok(report.includes(person.people+' 人'));}
  assert.ok(report.includes(d.plan.id));assert.ok(report.includes('记录版本 '+d.revision));
  assert.equal(d.plan.servedPeople+d.plan.unassigned.reduce((sum,h)=>sum+h.people,0),d.plan.totalPeople);
});
