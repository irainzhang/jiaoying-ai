const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../dist/engine.js');
const {create}=require('../dist/state.js');
function ready(c){c.generate();c.confirm();c.publish();for(const h of c.data.scenario.households){c.acknowledge(h.id);c.contact(h.id);}c.start();}
test('planning input edits invalidate both comparison results and confirmation together',()=>{
  const c=create();c.generate();c.confirm();const oldInput=JSON.stringify(c.data.planInput);c.updateHousehold('H5',{people:2});
  assert.equal(c.fresh(),false);assert.equal(c.data.confirmed,null);assert.equal(JSON.stringify(c.data.planInput),oldInput);assert.throws(()=>c.confirm(),/重新计算/);
  c.generate();assert.equal(c.fresh(),true);assert.equal(c.data.plan.totalPeople,c.data.baseline.totalPeople);assert.equal(c.data.plan.totalPeople,16);
});
test('no-op edits and ordinary receipts do not invalidate a current confirmed plan',()=>{
  const c=create();c.generate();c.confirm();const v=c.data.version;assert.equal(c.updateResource('vehicles','V1',{capacity:6}),false);
  c.receipt('H5','收到。',{assistance:false,wheelchair:false});assert.equal(c.data.version,v);assert.ok(c.data.confirmed);assert.ok(c.fresh());assert.equal(c.data.execution.H5,'waiting');
});
test('invalid saves are transactional and preserve the previous plan',()=>{
  const c=create();c.generate();c.confirm();const before=JSON.stringify(c.exportData());assert.throws(()=>c.updateHousehold('H1',{people:0}),/家庭数据/);assert.equal(JSON.stringify(c.exportData()),before);
});
test('wheelchair receipt adds normalized requirements but never invents people or attendance',()=>{
  const c=create();c.generate();c.confirm();c.receipt('H5','已通知，需要轮椅车辆接送。',{assistance:true,wheelchair:true});
  const h=c.data.scenario.households.find(h=>h.id==='H5');assert.equal(h.people,1);assert.equal(h.priority,2);assert.equal(h.service,6);assert.equal(h.wheelchair,true);assert.equal(c.fresh(),false);assert.equal(c.data.execution.H5,'waiting');
});
test('a user can correct a rule suggestion before it changes dispatch inputs',()=>{
  const c=create();c.generate();const version=c.data.version;c.receipt('H5','需要轮椅车辆接送。',{assistance:false,wheelchair:false});assert.equal(c.data.version,version);assert.equal(c.data.scenario.households[4].wheelchair,false);assert.equal(c.data.receipts[0].parsed.needsWheelchair,true);
});
test('assistance priority and service constraints remain consistent after an edit',()=>{
  const c=create();c.updateHousehold('H5',{priority:2,assistance:false,service:2});const h=c.data.scenario.households.find(h=>h.id==='H5');assert.equal(h.assistance,true);assert.equal(h.service,5);
  assert.ok(c.data.log[0].changes.some(x=>x.field==='service'&&x.before===2&&x.after===5));
});
test('partial confirmation requires a coordination note and keeps unresolved families',()=>{
  const c=create();c.setEvent('vehicle',true);const p=c.generate();assert.ok(!p.complete);assert.ok(p.servedPeople>0);assert.throws(()=>c.confirm(),/协调措施/);
  c.confirm('联系邻区增援车辆，未安排家庭保留待协调');assert.equal(c.data.confirmed.partial,true);assert.ok(c.data.plan.unassigned.length>0);
  c.publish();for(const st of p.routes.flatMap(r=>r.stops)){c.acknowledge(st.id);c.contact(st.id);}c.start();assert.throws(()=>c.advance(p.unassigned[0].id,'board'),/尚未安排/);
});
test('zero coverage has no executable part to confirm',()=>{
  const c=create();for(const v of c.data.scenario.vehicles)c.updateResource('vehicles',v.id,{available:false});c.generate();assert.throws(()=>c.confirm('已经联系救援力量处理'),/没有可执行/);
});
test('execution requires confirmation, publication and actual contact records',()=>{
  const c=create();assert.throws(()=>c.start(),/确认/);c.generate();c.confirm();assert.throws(()=>c.start(),/发布/);c.publish();assert.throws(()=>c.contact('H1'),/先确认收到/);assert.throws(()=>c.start(),/未联系/);
  for(const h of c.data.scenario.households){c.acknowledge(h.id);c.contact(h.id);}c.start();assert.equal(c.data.phase,'executing');
});
test('in-flight edits and replanning are blocked without changing confirmed routes',()=>{
  const c=create();ready(c);const before=JSON.stringify(c.exportData());
  assert.throws(()=>c.generate(),/冻结/);assert.throws(()=>c.setEvent('bridge',true),/冻结/);assert.throws(()=>c.updateHousehold('H1',{people:5}),/冻结/);assert.equal(JSON.stringify(c.exportData()),before);
});
test('execution enforces pickup order, completes pickup before arrival and separates verification',()=>{
  const c=create();ready(c);const r=c.data.plan.routes.find(r=>r.stops.length>1),[first,second]=r.stops;
  assert.throws(()=>c.advance(second.id,'board'),/接送顺序/);assert.throws(()=>c.advance(first.id,'verify'),/到达登记/);
  c.advance(first.id,'board');assert.throws(()=>c.advance(first.id,'arrive'),/完成各户/);c.advance(second.id,'board');
  c.advance(first.id,'arrive');assert.equal(c.data.execution[first.id],'arrived');c.advance(first.id,'verify');assert.equal(c.data.execution[first.id],'verified');assert.throws(()=>c.advance(first.id,'board'),/接送顺序/);
});
test('in-flight receipt becomes a coordination item, not a reassignment or arrival confirmation',()=>{
  const c=create();ready(c);const input=JSON.stringify(c.data.planInput),routes=JSON.stringify(c.data.plan.routes),version=c.data.version;
  c.receipt('H5','已到达安置点，需要轮椅协助。',{assistance:true,wheelchair:true});assert.equal(c.data.pending.length,1);assert.equal(c.data.execution.H5,'waiting');assert.equal(c.data.version,version);assert.equal(JSON.stringify(c.data.plan.routes),routes);assert.equal(JSON.stringify(c.data.planInput),input);assert.ok(c.fresh());
  assert.throws(()=>c.advance('H5','board'),/未解决/);assert.throws(()=>c.advance('H5','verify'),/未解决/);
});
test('export is a detached reproducible snapshot and reset clears all simulated progress',()=>{
  const c=create();ready(c);const exported=c.exportData();assert.deepEqual(E.validatePlan(exported.planInput,exported.plan),[]);assert.deepEqual(E.validatePlan(exported.planInput,exported.baseline),[]);exported.scenario.households[0].people=99;assert.equal(c.data.scenario.households[0].people,2);
  c.reset();assert.equal(c.data.phase,'preparation');assert.equal(c.data.confirmed,null);assert.equal(c.data.sent,false);assert.equal(c.data.plan,null);assert.equal(c.data.receipts.length,0);
});
