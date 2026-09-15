const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../dist/state.js');
const C=require('../dist/assistant-core.js');
const ask=(store,text)=>C.localReply(text,C.snapshot(store));

test('assistant snapshot is immutable and does not reuse stale plans',()=>{
  const s=create();s.generate();const c=C.snapshot(s),key=C.fingerprint(s);
  s.setEvent('vehicle',true);
  assert.equal(c.vehicles[1].available,true);assert.equal(C.snapshot(s).plan,null);
  assert.equal(C.snapshot(s).planState,'stale');assert.notEqual(C.fingerprint(s),key);
});
test('questions report bridge state and do not propose unrequested closure',()=>{
  const s=create(),before=JSON.stringify(s.exportData());
  for(const q of ['东桥现在是什么状态？','不要封闭东桥','东桥并未封闭','东桥恢复通行'])assert.equal(ask(s,q).actions.length,0,q);
  assert.equal(ask(s,'如果东桥封闭会怎样？').actions[0].event,'bridge');
  assert.equal(JSON.stringify(s.exportData()),before);
});
test('negated generation stays read-only and missing assignments are reported',()=>{
  const s=create();s.setEvent('vehicle',true);s.generate();
  const result=ask(s,'哪些家庭没有安排？');
  for(const h of s.data.plan.unassigned)assert.ok(result.reply.includes(h.name));
  const overview=ask(s,'不要生成方案，只告诉我当前情况');
  assert.equal(overview.actions.length,0);assert.match(overview.reply,/15 人/);
});
test('feedback mentioning a bridge preserves its household and full original text',()=>{
  const s=create(),text='南湾户老人需要轮椅，要过东桥';
  const result=ask(s,text);assert.equal(result.actions[0].type,'receipt');
  assert.equal(result.actions[0].householdId,'H5');assert.equal(result.actions[0].text,text);
  assert.equal(s.data.scenario.households[4].wheelchair,false);
});
test('ambiguous feedback does not invent identity or wheelchair requirements',()=>{
  const s=create(),result=ask(s,'老人腿脚不便，需要人员陪同接送');
  assert.equal(result.actions[0].householdId,null);assert.match(result.reply,/不能直接认定为需要轮椅/);
  const multi=ask(s,'南湾户和东岭户需要人员陪同接送');assert.equal(multi.actions[0].householdId,null);
});
test('long feedback is not silently truncated or passed into the shorter receipt form',()=>{
  const s=create(),result=ask(s,'南湾户需要陪同接送。'+'说明'.repeat(510));
  assert.equal(result.actions.length,0);assert.match(result.reply,/1000 字/);
});
test('execution keeps chat generation and closure unavailable while allowing review',()=>{
  const s=create();s.generate();s.confirm();s.publish();for(const h of s.data.scenario.households){s.acknowledge(h.id);s.contact(h.id);}s.start();
  assert.equal(ask(s,'重新生成方案').actions.length,0);
  assert.equal(ask(s,'如果东桥封闭会怎样？').actions.length,0);
  assert.equal(ask(s,'南湾户需要轮椅接送').actions[0].type,'receipt');
});
test('contact changes invalidate chat actions even when the planning version is unchanged',()=>{
  const s=create(),v=s.data.version,key=C.fingerprint(s);s.publish();s.acknowledge('H1');s.contact('H1');
  assert.equal(s.data.version,v);assert.notEqual(C.fingerprint(s),key);
  assert.match(ask(s,'总结当前情况').reply,/已联系 1 户/);
});
