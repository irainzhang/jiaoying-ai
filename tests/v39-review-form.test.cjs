'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const UI=require('../dist/review-form.js');
const E=require('../exercise.cjs');

function fixture(extra={}){
  const store=E.create();store.action('generate');
  store.action('village-report',{villageId:'VA',mode:'increment',people:20,pickupId:'P-A1',assistancePeople:3,wheelchairPeople:null,groupPolicy:'unknown',text:'新增二十人，其中三人需要协助',...extra});
  return {store,id:store.data.villageReports[0].id,state:()=>({data:store.data})};
}
function fakeForm(values={}){
  const ids={'village-decision':'accept','vreview-pickup':'P-A1','vreview-assistance':'3','vreview-wheelchair':'','vreview-group':'unknown','village-note':'',...values};
  const elements=Object.fromEntries(Object.entries(ids).map(([id,value])=>[id,{value}]));
  for(const id of ['review-submit','review-outcome','review-details','review-assistance-status','review-wheelchair-status','review-note-details'])elements[id]={textContent:'',classList:{toggle(){}},hidden:false,disabled:false,open:false};
  const listeners={};
  return {elements,listeners,querySelector(selector){return elements[selector.slice(1)]||null;},contains(){return true;},addEventListener(name,fn){(listeners[name]??=[]).push(fn);},removeEventListener(name,fn){listeners[name]=listeners[name].filter(x=>x!==fn);},dispatch(name,event={}){for(const fn of listeners[name]||[])fn(event);},click(action){const target={dataset:{reviewAc:action}};this.dispatch('click',{target:{closest:()=>target}});}};
}

test('the screenshot case renders total people as an honest read-only summary and needs as editable inputs',()=>{
  const f=fixture(),html=UI.render(f.state(),f.id,'village-review');
  assert.match(html,/>20<small>人<\/small>/);assert.match(html,/上报原值/);assert.doesNotMatch(html,/vreview-people|<input[^>]*\sreadonly/);
  assert.match(html,/id="vreview-wheelchair"[^>]+value=""/);assert.match(html,/填 <b>0<\/b> 表示已确认没有/);
  assert.match(html,/先保存为待补信息/);assert.match(html,/补充说明（选填）/);assert.doesNotMatch(html,/<textarea[^>]*required/);
  assert.match(html,/人数有误？退回重报/);
});

test('blank needs are accepted as unknown without manufacturing zeroes or scheduling groups',()=>{
  const f=fixture(),form=fakeForm(),before=f.store.data.scenario.households.length;
  const p=UI.payload(f.state(),f.id,'village-review',form);
  assert.equal(p.wheelchairPeople,null);assert.equal(p.groupPolicy,'unknown');assert.match(p.note,/待补充/);
  f.store.action('village-review',p);
  const row=f.store.data.villageReports.find(r=>r.id===f.id);
  assert.equal(row.status,'accepted');assert.equal(row.needsInfo,true);assert.equal(row.wheelchairPeople,null);assert.deepEqual(row.householdIds,[]);
  assert.equal(f.store.data.scenario.households.length,before);
});

test('a person supplying all facts creates groups through the actual domain without required free text',()=>{
  const f=fixture(),form=fakeForm({'vreview-wheelchair':'1','vreview-group':'splittable'});
  const evaluated=UI.evaluate(f.state(),f.id,'village-review',UI.read(form));assert.equal(evaluated.label,'采纳并生成安排');
  f.store.action('village-review',UI.payload(f.state(),f.id,'village-review',form));
  const row=f.store.data.villageReports.find(r=>r.id===f.id);
  assert.equal(row.needsInfo,false);assert.ok(row.householdIds.length);assert.equal(row.assistancePeople,3);assert.equal(row.wheelchairPeople,1);
  const groups=f.store.data.scenario.households.filter(h=>row.householdIds.includes(h.id));
  assert.equal(groups.reduce((n,h)=>n+h.people,0),20);assert.equal(f.store.data.activePlan,null);
});

test('explicit zero is distinct from unknown and a shortcut requires a separate human click',()=>{
  const f=fixture(),form=fakeForm(),binding=UI.bind(form,f.state(),f.id,'village-review');
  assert.equal(UI.read(form).wheelchairPeople,'');assert.equal(UI.read(form).assistancePeople,'3');
  form.click('no-assistance');assert.equal(UI.read(form).wheelchairPeople,'0');assert.equal(UI.read(form).assistancePeople,'0');
  assert.equal(UI.read(form).groupPolicy,'unknown');assert.match(form.elements['review-outcome'].textContent,/同行安排/);
  form.elements['vreview-group'].value='splittable';form.dispatch('change');
  assert.equal(form.elements['review-submit'].textContent,'采纳并生成安排');
  const p=UI.payload(f.state(),f.id,'village-review',form);assert.equal(p.assistancePeople,0);assert.equal(p.wheelchairPeople,0);
  binding.destroy();assert.ok(Object.values(form.listeners).every(xs=>xs.length===0));
});

test('invalid numeric relationships and another village pickup block submission with an actionable message',()=>{
  const f=fixture();
  for(const values of [{wheelchairPeople:4,assistancePeople:3},{assistancePeople:21},{assistancePeople:-1},{wheelchairPeople:0.5},{pickupId:'P-B1'}]){
    const result=UI.evaluate(f.state(),f.id,'village-review',values);assert.equal(result.canSubmit,false);assert.ok(result.errors.length);
  }
  const form=fakeForm({'vreview-wheelchair':'4'});UI.bind(form,f.state(),f.id,'village-review');
  assert.equal(form.elements['review-submit'].disabled,true);assert.match(form.elements['review-outcome'].textContent,/不能超过协助人数/);
  assert.throws(()=>UI.payload(f.state(),f.id,'village-review',form),/不能超过协助人数/);
});

test('return for a wrong total keeps the immutable source count and rejects only after submission',()=>{
  const f=fixture(),form=fakeForm();UI.bind(form,f.state(),f.id,'village-review');form.click('return');
  assert.equal(f.store.data.villageReports[0].status,'pending');assert.equal(form.elements['review-details'].hidden,true);
  const p=UI.payload(f.state(),f.id,'village-review',form);assert.equal(p.decision,'reject');assert.match(p.note,/总人数需要更正/);assert.equal(p.people,undefined);
  f.store.action('village-review',p);const row=f.store.data.villageReports[0];assert.equal(row.status,'rejected');assert.equal(row.people,20);assert.deepEqual(row.householdIds,[]);
});

test('completing an accepted record requires real missing facts and preserves the accepted total',()=>{
  const f=fixture();f.store.action('village-review',UI.payload(f.state(),f.id,'village-review',fakeForm()));
  let result=UI.evaluate(f.state(),f.id,'village-complete',{});assert.equal(result.canSubmit,false);assert.equal(result.label,'补齐后生成安排');
  assert.match(UI.render(f.state(),f.id,'village-complete'),/data-ac="review-correct"/);
  const form=fakeForm({'vreview-wheelchair':'0','vreview-group':'splittable'}),p=UI.payload(f.state(),f.id,'village-complete',form);
  assert.equal(p.decision,undefined);f.store.action('village-complete',p);const row=f.store.data.villageReports[0];assert.equal(row.people,20);assert.equal(row.needsInfo,false);
});

test('a snapshot observation never asks for allocation facts or adds people',()=>{
  const f=fixture({mode:'snapshot',scope:'waiting',observedAt:'2026-10-05T10:00:00Z'}),before=E.metrics(f.store.data).people;
  const result=UI.evaluate(f.state(),f.id,'village-review',{});assert.equal(result.canSubmit,true);assert.equal(result.label,'采纳这次人数观测');
  assert.doesNotMatch(UI.render(f.state(),f.id,'village-review'),/id="vreview-/);
  f.store.action('village-review',result.payload);assert.equal(E.metrics(f.store.data).people,before);assert.equal(f.store.data.villageReports[0].status,'accepted');
});

test('an unresolved map location stays pending even when all people needs are filled',()=>{
  const f=fixture(),state=f.state();const village=state.data.villages.find(v=>v.id==='VA');village.pickups.push({id:'PX',name:'新上报的集合点',node:null,locationStatus:'pending'});
  const result=UI.evaluate(state,f.id,'village-review',{pickupId:'PX',assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable'});
  assert.equal(result.canSubmit,true);assert.deepEqual(result.missing,['集合点地图位置']);assert.equal(result.label,'先保存为待补信息');
});

test('source text and place names are escaped and omitted optional notes get factual audit text',()=>{
  const f=fixture({text:'<img src=x onerror=alert(1)>'}),state=f.state();state.data.villages.find(v=>v.id==='VA').name='<script>test</script>';
  const html=UI.render(state,f.id,'village-review');assert.doesNotMatch(html,/<script>|<img/);assert.match(html,/&lt;script&gt;/);assert.match(html,/&lt;img/);
  const result=UI.evaluate(state,f.id,'village-review',{note:'   '});assert.ok(result.payload.note.trim());assert.match(result.payload.note,/待补充/);
  assert.equal(UI.evaluate(state,f.id,'village-review',{note:'x'.repeat(301)}).canSubmit,false);
});
