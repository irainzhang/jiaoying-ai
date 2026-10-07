'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const semantic=require('../dist/semantic-demand.js'),intake=require('../dist/command-intake.js');
function data(){return {revision:1,villages:[
  {id:'VA',name:'甲村',pickups:[{id:'PA1',name:'甲村礼堂',node:'H1'},{id:'PA2',name:'甲村校门',node:'H2'}]},
  {id:'VB',name:'乙村',pickups:[{id:'PB1',name:'乙村礼堂',node:'H3'}]}
],scenario:{nodes:[{id:'H1'},{id:'H2'},{id:'H3'}],edges:[{from:'H1',to:'H2',open:true},{from:'H2',to:'H3',open:true}]}};}
const row=(extra={})=>({intent:'increment',villageName:null,pickupName:null,people:6,assistancePeople:null,wheelchairPeople:null,groupPolicy:null,evidence:null,...extra});
const options=(extra={})=>({data:data(),scope:{villageId:'VA',pickupId:'PA1'},utterance:'新增六人',...extra});
const parse=(r,opts)=>semantic.normalize({rows:[r]},options(opts));

test('semantic demand preserves unknown fields and explicit zero without inventing standard conditions',()=>{
  const a=parse(row()).rows[0];assert.equal(a.people,6);assert.equal(a.assistancePeople,null);assert.equal(a.wheelchairPeople,null);assert.equal(a.groupPolicy,'unknown');
  const b=parse(row({assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable'})).rows[0];assert.equal(b.assistancePeople,0);assert.equal(b.wheelchairPeople,0);assert.equal(b.groupPolicy,'splittable');
  assert.equal(intake.reviewRows([b],{data:data()}).readyPeople,6);
});

test('explicit context is inherited only for an unchanged registered area',()=>{
  const same=parse(row()).rows[0];assert.equal(same.villageId,'VA');assert.equal(same.pickupId,'PA1');assert.equal(same.pickupName,'甲村礼堂');
  const other=parse(row({villageName:'乙村'})).rows[0];assert.equal(other.villageId,'VB');assert.equal(other.pickupId,'');assert.equal(other.pickupName,'');
  const unknown=parse(row({villageName:'玉海街道'})).rows[0];assert.equal(unknown.villageId,'');assert.equal(unknown.pickupId,'');assert.equal(unknown.pickupName,'');
});

test('a different unregistered area cannot inherit another unregistered area pickup',()=>{
  const a=parse(row({villageName:'莘塍街道'}),{scope:{villageName:'玉海街道',pickupName:'文化广场'}}).rows[0];
  assert.equal(a.villageId,'');assert.equal(a.villageName,'莘塍街道');assert.equal(a.pickupId,'');assert.equal(a.pickupName,'');
  const same=parse(row(),{scope:{villageName:'玉海街道',pickupName:'文化广场'}}).rows[0];assert.equal(same.pickupName,'文化广场');
});

test('explicitly selected IDs remain unambiguous when directory names are duplicated',()=>{
  const d=data();d.villages.push({id:'VC',name:'甲村',pickups:[{id:'PC1',name:'甲村礼堂',node:'H2'},{id:'PC2',name:'甲村礼堂',node:'H3'}]});
  for(const input of [row(),row({villageName:'甲村',pickupName:'甲村礼堂'})]){
    const result=parse(input,{data:d,scope:{villageId:'VC',pickupId:'PC2'}}).rows[0];
    assert.equal(result.villageId,'VC');assert.equal(result.pickupId,'PC2');assert.equal(result.villageName,'甲村');assert.equal(result.pickupName,'甲村礼堂');
  }
});

test('unknown locations remain editable labels with no model supplied coordinates or IDs',()=>{
  const a=parse(row({villageName:'未登记地区',pickupName:'桥边树下',villageId:'VA',pickupId:'PA1',longitude:120.5,latitude:27.7,coordinateSystem:'WGS84',locationNodeId:'H1'})).rows[0];
  assert.equal(a.villageName,'未登记地区');assert.equal(a.pickupName,'桥边树下');assert.equal(a.villageId,'');assert.equal(a.pickupId,'');assert.equal(a.longitude,null);assert.equal(a.latitude,null);assert.equal(a.coordinateSystem,null);assert.ok(!a.locationNodeId);
  assert.equal(intake.reviewRows([a],{data:data()}).pendingPeople,6);
});

test('explicit replacement pickup never stays attached to the old map node',()=>{
  const a=parse(row({pickupName:'河边未登记接人点'})).rows[0];assert.equal(a.villageId,'VA');assert.equal(a.pickupId,'');assert.equal(a.pickupName,'河边未登记接人点');assert.ok(!a.locationNodeId);
  const b=parse(row({villageName:'乙村',pickupName:'乙村礼堂'})).rows[0];assert.equal(b.villageId,'VB');assert.equal(b.pickupId,'PB1');
});

test('explicitly unknown pickup clears inherited location instead of silently keeping the old scope',()=>{
  const utterance='新增六人，集合点待定',opts=options({utterance});
  const parsed=semantic.normalize({rows:[row()]},opts);assert.equal(parsed.rows[0].pickupId,'');assert.equal(parsed.rows[0].pickupName,'');assert.equal(parsed.rows[0].villageId,'VA');
  const q=semantic.quick({rows:[row()]},opts);assert.equal(q.proposal.payload.pickupId,'');
});

test('a single model evidence excerpt cannot hide an explicit unknown location in the complete utterance',()=>{
  const utterance='新增六人，集合点待定',opts=options({utterance}),response={rows:[row({evidence:'新增六人'})]};
  const parsed=semantic.normalize(response,opts);assert.equal(parsed.rows[0].text,'新增六人');assert.equal(parsed.rows[0].pickupId,'');assert.equal(parsed.rows[0].pickupName,'');
  const q=semantic.quick(response,opts);assert.equal(q.proposal.payload.pickupId,'');assert.equal(q.proposal.payload.text,utterance);
});

test('unknown numeric strings and invalid counts reach existing review errors without coercion',()=>{
  for(const people of [null,'6',-1,0,501,1.5,NaN,Infinity]){
    const a=parse(row({people}));assert.ok(intake.reviewRows(a.rows,{data:data()}).errors.length,String(people));
  }
  for(const extra of [{assistancePeople:7},{assistancePeople:-1},{assistancePeople:1.5},{assistancePeople:1,wheelchairPeople:2},{wheelchairPeople:7}]){
    const a=parse(row(extra));assert.ok(intake.reviewRows(a.rows,{data:data()}).errors.length,JSON.stringify(extra));
  }
  assert.equal(parse(row({assistancePeople:'0',wheelchairPeople:'0'})).rows[0].assistancePeople,null);
});

test('total, correction and other intents are never accepted as an increment',()=>{
  for(const intent of ['total','correction','progress','other','',null,undefined]){
    const response={rows:[row({intent})]},a=semantic.normalize(response,options()),q=semantic.quick(response,options());
    assert.match(a.errors.join(''),/不能自动累计/);assert.equal(q.proposal,null);assert.ok(q.questions.length);
  }
});

test('quick capture accepts one known batch but never silently truncates several batches',()=>{
  const opts=options({reporter:'执行端乙',source:'voice'}),one=semantic.quick({rows:[row()]},opts);
  assert.deepEqual(one.questions,[]);assert.equal(one.proposal.payload.people,6);assert.equal(one.proposal.payload.mode,'increment');assert.equal(one.proposal.payload.source,'voice');assert.equal(one.proposal.payload.reporter,'执行端乙');assert.equal(one.proposal.payload.duplicateAcknowledged,false);
  const many=semantic.quick({rows:[row(),row({villageName:'乙村',people:3})]},opts);assert.equal(many.proposal,null);assert.match(many.questions.join(''),/一次确认一批/);
  const missing=semantic.quick({rows:[row({villageName:'未知村'})]},opts);assert.equal(missing.proposal,null);assert.match(missing.questions.join(''),/已登记/);
});

test('quick capture requires reviewable count and keeps optional needs unknown',()=>{
  const invalid=semantic.quick({rows:[row({people:0})]},options());assert.equal(invalid.proposal,null);assert.match(invalid.questions.join(''),/人数/);
  const a=semantic.quick({rows:[row()]},options());assert.equal(a.proposal.payload.assistancePeople,null);assert.equal(a.proposal.payload.wheelchairPeople,null);assert.equal(a.proposal.payload.groupPolicy,'unknown');
});

test('empty and malformed model rows cannot produce a saving proposal',()=>{
  const empty=semantic.normalize({rows:[]},options());assert.equal(empty.rows.length,0);assert.ok(empty.errors.length);assert.equal(semantic.quick({rows:[]},options()).proposal,null);
  for(const value of [null,{}, {rows:null},{rows:[null]},{rows:[[]]},{rows:Array.from({length:101},()=>row())}])assert.throws(()=>semantic.normalize(value,options()));
});

test('evidence must be a substring of the original utterance and arbitrary action keys are discarded',()=>{
  const utterance='甲村新增六人，其中两人需要协助',response=row({evidence:'其中两人需要协助',action:'publish',confirmed:true});
  const a=parse(response,{utterance}).rows[0];assert.equal(a.text,'其中两人需要协助');assert.equal(a.action,undefined);assert.equal(a.confirmed,undefined);
  const b=parse(row({evidence:'已经全员安全到达'}),{utterance}).rows[0];assert.equal(b.text,utterance);
});

test('semantic context exposes names and current choices but not unrelated private registry fields',()=>{
  const d=data();d.secret='hidden';d.villages[0].phone='13800000000';d.villages[0].pickups[0].longitude=120.5;
  const ctx=semantic.context(d,{villageId:'VA',pickupId:'PA1'},'新增六人');assert.equal(ctx.scope.villageName,'甲村');assert.equal(ctx.scope.pickupName,'甲村礼堂');assert.deepEqual(Object.keys(ctx).sort(),['scope','villages']);
  assert.ok(!JSON.stringify(ctx).includes('13800000000'));assert.ok(!JSON.stringify(ctx).includes('longitude'));assert.ok(!JSON.stringify(ctx).includes('hidden'));
  const large={...d,villages:Array.from({length:160},(_,i)=>({id:'V'+i,name:'村'+i,pickups:Array.from({length:30},(_,j)=>({id:'P'+i+'-'+j,name:'点'+i+'-'+j}))}))};
  const limited=semantic.context(large,{villageId:'V159',pickupId:'P159-29'},'');assert.ok(limited.villages.length<=100);assert.equal(limited.villages[0].id,'V159');assert.ok(limited.villages.flatMap(v=>v.pickups).length<=150);assert.ok(limited.villages[0].pickups.some(p=>p.id==='P159-29'));
});

test('raw hostile utterances and model warning text are escaped when shown in the shared intake views',()=>{
  const attack='</textarea><img src=x onerror="alert(1)">',d=data(),context={window:null};context.window=context;
  context.JiaoyingCommandIntake=intake;context.JiaoyingPlaceDirectory=require('../dist/place-directory.js');context.JiaoyingEntryKit=require('../dist/entry-kit.js');
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/intake-ui.js'),'utf8'),context);
  const state={data:d,session:'s',capabilities:{commandIntake:true}},helpers={btn:()=>'',badge:()=>'',voiceHTML:()=>''};
  const parsed=semantic.normalize({rows:[row()],warnings:[attack]},options({data:d,utterance:attack}));
  const html=context.JiaoyingIntakeUI.command(state,{text:attack,method:'text',draft:{...parsed,revision:1,session:'s'},scope:{},connected:true},helpers);
  assert.ok(!html.includes(attack));assert.ok(html.includes('&lt;img src=x onerror=&quot;alert(1)&quot;&gt;'));
  const q=semantic.quick({rows:[row()],warnings:[attack]},options({data:d,utterance:attack}));
  const quickHTML=context.JiaoyingIntakeUI.quick(state,{text:attack,draft:{...q,revision:1,session:'s'},scope:{villageId:'VA'},connected:true},helpers);assert.ok(!quickHTML.includes(attack));assert.ok(quickHTML.includes('&lt;img'));
});
