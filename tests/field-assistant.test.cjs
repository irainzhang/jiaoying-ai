'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const A = require('../dist/field-assistant.js');
const E = require('../exercise.cjs');

function state() {
  const data = E.initial();
  data.activePlan = {id:'P1-A',inputVersion:data.inputVersion,routes:[{vehicleId:'V1',people:5,stops:[{id:'H1'},{id:'H2'}],shelterId:'S1',holding:false},{vehicleId:'V2',people:4,stops:[{id:'H3'}],shelterId:'S2',holding:false}]};
  data.taskAcks = {V1:{planId:'P1-A'}};
  return data;
}
function prepare(text, extra = {}) { return A.prepare(text, {data:state(), vehicleId:'V1',reporter:'测试现场员', ...extra}); }
function clarify(result) { assert.equal(result.intent,'clarify'); assert.equal(result.proposal,null); assert.ok(result.questions.length); }

test('honest local-rules mode prepares bridge obstruction without mutating input', () => {
  const context = {data:state(),vehicleId:'V1'}, before = structuredClone(context);
  const r = A.prepare('演练东桥道路受阻，无法通行',context);
  assert.equal(r.mode,'local-rules'); assert.equal(r.intent,'report');
  assert.equal(r.proposal.action,'report'); assert.equal(r.proposal.payload.location,'east');
  assert.equal(r.proposal.payload.kind,'road'); assert.deepEqual(context,before);
});
test('road endpoints resolve only a registered edge', () => {
  const r = prepare('西山路口到东桥西道路受阻');
  assert.equal(r.intent,'report'); assert.equal(r.proposal.payload.location,'r4');
  clarify(prepare('西山路口道路受阻'));
});
test('Chinese group count, wheelchair and a subordinate count stay separate', () => {
  const r = prepare('东桥西新增三人，其中一人需要轮椅');
  assert.equal(r.intent,'report'); assert.equal(r.proposal.payload.people,3);
  assert.equal(r.proposal.payload.location,'B1'); assert.equal(r.proposal.payload.wheelchair,true); assert.equal(r.proposal.payload.assistance,true);
  assert.equal(prepare('西山路口新增二十三人').proposal.payload.people,23);
  assert.equal(prepare('东桥西新增两人').proposal.payload.people,2);
});
test('missing location/count and invalid or contradictory counts never default to one', () => {
  for(const text of ['新增三人','东桥西新增人员','东桥西新增零人','东桥西新增三四人','东桥西新增1.5人','东桥西新增三十一人','东桥西新增三人，实际四人']) clarify(prepare(text));
});
test('explicit selected location supports shorthand but conflicts request clarification', () => {
  assert.equal(prepare('新增三人',{location:'B1'}).proposal.payload.location,'B1');
  clarify(prepare('东桥西新增三人',{location:'H1'}));
  clarify(prepare('东桥受阻',{location:'north'}));
  clarify(prepare('飞云街道新增三人',{location:'B1'}));
  clarify(prepare('温州大学新增三人',{location:'B1'}));
  clarify(prepare('人民路新增三人',{location:'B1'}));
  clarify(prepare('西山路口和东桥西新增三人'));
});
test('negative, planned, uncertain and mixed claims are never completion proposals', () => {
  for(const text of ['家庭01没上车','家庭01还未上车','家庭01未联系','没有收到任务','可能已到达安置点A','准备上车','计划已联系家庭01','明天新增三人','家庭01已上车，东桥受阻','已联系家庭01并已上车','东桥没有受阻','东桥是否受阻？','东桥西新增三人需要医疗协助','并没说家庭01已上车','东桥不再受阻','待上车，已联系家庭01','东桥不堵塞','东桥未封闭']) clarify(prepare(text));
});
test('medical and hazard reports preserve narrative without diagnosing', () => {
  const m = prepare('东桥西需要医疗协助'), h = prepare('西山路口出现险情');
  assert.equal(m.proposal.payload.kind,'medical'); assert.equal(m.proposal.payload.assistance,true);
  assert.equal(Object.hasOwn(m.proposal.payload,'diagnosis'),false);
  assert.equal(h.proposal.payload.kind,'hazard');
});
test('ack requires a selected car and active task; old or different references fail', () => {
  const data = state(); data.taskAcks = {};
  const r = prepare('收到任务',{data});
  assert.equal(r.intent,'progress'); assert.equal(r.proposal.payload.stage,'ack'); assert.equal(r.proposal.payload.planId,'P1-A');
  clarify(prepare('收到任务',{data,vehicleId:''}));
  clarify(prepare('收到任务',{data:{...data,activePlan:null}}));
  clarify(prepare('2号车收到任务',{data}));
  clarify(prepare('P0-A收到任务',{data}));
  clarify(prepare('收到任务',{data,planId:'P0-A'}));
  clarify(prepare('收到任务'));
});
test('contact requires explicit assigned household and current acknowledgement', () => {
  const r = prepare('已联系家庭01');
  assert.equal(r.proposal.payload.householdId,'H1'); assert.equal(r.proposal.payload.stage,'contact');
  assert.equal(prepare('已联系',{householdId:'H1'}).proposal.payload.householdId,'H1');
  clarify(prepare('已联系')); clarify(prepare('已联系家庭03')); clarify(prepare('已联系家庭02'));
  clarify(prepare('已联系家庭01',{householdId:'H2'}));
  const data = state(); data.taskAcks.V1.planId='P0-A'; clarify(prepare('已联系家庭01',{data}));
});
test('boarding requires executing, contacted and the next assigned household', () => {
  const data = state(); data.phase='executing'; data.contacts.H1.contacted=true;
  const r = prepare('家庭01已上车',{data});
  assert.equal(r.proposal.payload.stage,'board'); assert.equal(r.proposal.payload.householdId,'H1');
  clarify(prepare('家庭01已上车')); clarify(prepare('家庭02已上车',{data}));
  clarify(prepare('已接到',{data})); clarify(prepare('家庭03已上车',{data}));
  clarify(prepare('家庭01三人已上车',{data}));
  data.contacts.H1.contacted=false; clarify(prepare('家庭01已上车',{data}));
});
test('arrival requires actual onboard passengers, complete pickup and matching shelter', () => {
  const data = state(); data.phase='executing'; data.stage.H1='boarded'; data.stage.H2='boarded'; data.fleet.V1.onboard=['H1','H2'];
  const r = prepare('已到达安置点 A',{data});
  assert.equal(r.proposal.payload.stage,'arrive'); assert.match(r.warnings[0],/不等于安全核验/);
  assert.equal(prepare('已到达',{data,location:'S1'}).intent,'progress');
  clarify(prepare('已到达',{data})); clarify(prepare('已到达安置点B',{data}));
  clarify(prepare('已到达安置点A',{data,location:'S2'}));
  clarify(prepare('已到达东桥西',{data}));
  data.stage.H2='waiting'; clarify(prepare('已到达安置点A',{data}));
  data.stage.H2='boarded'; data.fleet.V1.onboard=[]; clarify(prepare('已到达安置点A',{data}));
});
test('confirmed road closure and insufficient destination capacity prevent progression', () => {
  const data = state(); data.phase='executing'; data.contacts.H1.contacted=true;
  data.activePlan.routes[0].segments=[{edges:['east']},{edges:[]},{edges:[]}];
  data.scenario.edges.find(e=>e.id==='east').open=false;
  clarify(prepare('家庭01已上车',{data}));
  data.stage.H1='boarded'; data.stage.H2='boarded'; data.fleet.V1.onboard=['H1','H2'];
  data.occupancy.S1=9; clarify(prepare('已到达安置点A',{data}));
  data.occupancy.S1=0; data.scenario.shelters[0].available=false;
  clarify(prepare('已到达安置点A',{data}));
});
test('empty data and oversized input are bounded, no implicit submission', () => {
  clarify(A.prepare('',{})); clarify(A.prepare('东桥受阻',{})); clarify(prepare('东桥受阻'.repeat(501)));
  const r=prepare('演练北桥道路受阻'); assert.equal(r.proposal.payload.source,'voice');
  assert.equal(r.proposal.payload.text,'演练北桥道路受阻');
});
