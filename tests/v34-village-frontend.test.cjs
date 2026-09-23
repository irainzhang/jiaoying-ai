const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');
const {webcrypto}=require('node:crypto');
const Exercise=require('../exercise.cjs');

function harness(){
  const listeners={},requests=[],classList={add(){},remove(){},toggle(){}};
  const elements={toast:{textContent:'',classList},dialog:{addEventListener(){}}};
  const ui={duplicate:()=>null};
  const context={document:{getElementById:id=>elements[id]||null,addEventListener:(type,fn)=>(listeners[type]||=[]).push(fn),querySelector:()=>null,querySelectorAll:()=>[],body:{classList}},location:{hash:'#field'},window:{isSecureContext:true,addEventListener(){},JiaoyingVillageUI:ui},JiaoyingVillageUI:ui,JiaoyingVoice:{create:()=>({active:()=>false,state:()=>({}),cancel(){}})},crypto:webcrypto,AbortSignal,fetch:(url,options)=>new Promise((resolve,reject)=>requests.push({url,options,resolve,reject})),setTimeout:()=>1,clearTimeout(){},setInterval(){},matchMedia:()=>({matches:true})};
  let source=fs.readFileSync(path.join(__dirname,'../dist/workspace-app.js'),'utf8');
  const bridge=`window.testVillage={seed(next){state=next;connected=true;},prepare(payload){villageForm.text='第一条原话';villagePrepared={revision:d().revision,session:state.session,requestId:'village-ui-request',proposal:{action:'village-report',payload}};},inspect(){return {state,busy,text:villageForm.text,prepared:villagePrepared,receipt:villageReceipt};},villageClick,acceptState};`;
  assert.ok(source.includes('render();poll();setInterval(poll,1200);'));
  vm.createContext(context);vm.runInContext(source.replace('render();poll();setInterval(poll,1200);',bridge),context);
  return {controller:context.window.testVillage,requests,input(id,value,vdraft){for(const fn of listeners.input||[])fn({target:{id,value,dataset:vdraft?{vdraft}:{}}});}};
}
function fixture(){const store=Exercise.create();store.action('generate');return {store,snapshot:()=>({session:'village-ui-session',data:store.data,metrics:Exercise.metrics(store.data),villageLedger:Exercise.villageMetrics(store.data),capabilities:{villageReporting:true}})};}
const payload=(overrides={})=>({villageId:'VA',mode:'increment',people:4,pickupId:'',assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown',text:'新增4人，其他待补。',reporter:'演练员',source:'text',duplicateAcknowledged:false,...overrides});
test('one explicit click submits the edited card and unknown needs stay null',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.controller.prepare(payload());
  h.input('vdraft-people','5','people');
  const pending=h.controller.villageClick('village-submit');assert.equal(h.requests.length,1);
  const input=JSON.parse(h.requests[0].options.body);assert.equal(input.payload.people,5);assert.equal(input.payload.assistancePeople,null);assert.equal(input.payload.wheelchairPeople,null);
  f.store.action(input.action,input.payload);h.requests[0].resolve({ok:true,json:async()=>f.snapshot()});await pending;
  assert.equal(h.controller.inspect().prepared,null);assert.equal(f.store.data.villageReports[0].people,5);assert.equal(Exercise.metrics(f.store.data).people,15);
});
test('blank count and contradictory need counts cannot silently become accepted numbers',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.controller.prepare(payload({mode:'correction',people:'',targetId:'VR1'}));await assert.rejects(h.controller.villageClick('village-submit'),/有效总人数/);
  h.controller.prepare(payload({people:4,assistancePeople:1,wheelchairPeople:2}));await assert.rejects(h.controller.villageClick('village-submit'),/轮椅人数/);assert.equal(h.requests.length,0);
});
test('a concurrent state revision requires a fresh human review before submitting the card',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.controller.prepare(payload());f.store.action('weather',{preset:'small'});h.controller.acceptState(f.snapshot());await assert.rejects(h.controller.villageClick('village-submit'),/现场记录已更新/);assert.equal(h.requests.length,0);
});
test('late success does not erase a new village utterance entered while the request was outstanding',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.controller.prepare(payload());const pending=h.controller.villageClick('village-submit');h.input('village-utterance','第二条新增7人，待核对。');const input=JSON.parse(h.requests[0].options.body);f.store.action(input.action,input.payload);h.requests[0].resolve({ok:true,json:async()=>f.snapshot()});await pending;assert.equal(h.controller.inspect().text,'第二条新增7人，待核对。');assert.equal(h.controller.inspect().busy,false);
});
test('an uncertain request retry retains its idempotency key and the confirmed card',async()=>{
  const h=harness(),f=fixture();h.controller.seed(f.snapshot());h.controller.prepare(payload());let pending=h.controller.villageClick('village-submit');h.requests[0].reject(new Error('network failed'));await assert.rejects(pending,/network failed/);assert.ok(h.controller.inspect().prepared);
  pending=h.controller.villageClick('village-submit');assert.equal(JSON.parse(h.requests[0].options.body).requestId,JSON.parse(h.requests[1].options.body).requestId);h.requests[1].reject(new Error('network failed'));await assert.rejects(pending,/network failed/);
});
