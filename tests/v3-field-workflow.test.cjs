const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../exercise.cjs');

function published(){const x=E.create();x.action('generate');x.action('confirm');return x;}
function progress(x,stage,extra={}){return x.action('field-progress',{stage,vehicleId:'V1',planId:x.data.activePlan.id,reporter:'现场测试员',source:'quick',...extra});}
function ready(){const x=published();for(const r of x.data.activePlan.routes.filter(r=>r.people)){progress(x,'ack',{vehicleId:r.vehicleId});for(const st of r.stops)progress(x,'contact',{vehicleId:r.vehicleId,householdId:st.id});}x.action('start');return x;}
function unchangedOnError(x,fn,pattern){const before=x.data;assert.throws(fn,pattern);assert.deepEqual(x.data,before);}

test('receiving a task is independent of contacting a household and rejects duplicate acknowledgements',()=>{
  const x=published(),before=x.data.contacts,planId=x.data.activePlan.id;
  progress(x,'ack');assert.deepEqual(x.data.contacts,before);assert.equal(x.data.taskAcks.V1.planId,planId);
  assert.equal(x.data.fieldEvents[0].stage,'ack');assert.match(x.data.lastAnnouncement,/联系状态尚未改变/);
  unchangedOnError(x,()=>progress(x,'ack'),/已接收/);assert.throws(()=>x.action('start'),/未完成联系/);
});

test('contact requires acknowledgement and follows this vehicle next uncontacted household',()=>{
  const x=published(),r=x.data.activePlan.routes.find(r=>r.vehicleId==='V1'),other=x.data.activePlan.routes.find(r=>r.vehicleId==='V2').stops[0];
  unchangedOnError(x,()=>progress(x,'contact',{householdId:r.stops[0].id}),/先确认本车已接收/);
  progress(x,'ack');unchangedOnError(x,()=>progress(x,'contact',{householdId:other.id}),/下一待联系/);
  unchangedOnError(x,()=>progress(x,'contact',{householdId:r.stops[1].id}),/下一待联系/);
  progress(x,'contact',{householdId:r.stops[0].id,source:'voice',text:'第一户已联系'});
  assert.equal(x.data.contacts[r.stops[0].id].contacted,true);assert.equal(x.data.stage[r.stops[0].id],'waiting');
  assert.equal(x.data.fieldEvents[0].source,'voice');assert.equal(x.data.fieldEvents[0].text,'第一户已联系');
  unchangedOnError(x,()=>progress(x,'contact',{householdId:r.stops[0].id}),/下一待联系/);
  progress(x,'contact',{householdId:r.stops[1].id});assert.equal(x.data.contacts[r.stops[1].id].contacted,true);
});

test('boarding requires execution and the exact next assigned household; duplicate and early arrival do not mutate state',()=>{
  const x=published(),r=x.data.activePlan.routes.find(r=>r.vehicleId==='V1');progress(x,'ack');
  unchangedOnError(x,()=>progress(x,'board',{householdId:r.stops[0].id}),/先开始模拟执行/);
  x.action('contact',{ids:x.data.scenario.households.map(h=>h.id)});x.action('start');
  unchangedOnError(x,()=>progress(x,'board',{householdId:r.stops[1].id}),/下一待接家庭/);
  unchangedOnError(x,()=>progress(x,'arrive'),/仍有待接家庭/);
  progress(x,'board',{householdId:r.stops[0].id,source:'text',text:'已经接上第一户'});
  assert.deepEqual(x.data.fleet.V1.onboard,[r.stops[0].id]);assert.equal(x.data.stage[r.stops[0].id],'boarded');
  assert.equal(x.data.fieldEvents[0].source,'text');assert.equal(x.data.fieldEvents[0].people,r.stops[0].people);
  unchangedOnError(x,()=>progress(x,'board',{householdId:r.stops[0].id}),/下一待接家庭/);
});

test('arrival reserves capacity exactly once and leaves every delivered household awaiting human verification',()=>{
  const x=ready(),r=x.data.activePlan.routes.find(r=>r.vehicleId==='V1');
  for(const st of r.stops)progress(x,'board',{householdId:st.id});
  progress(x,'arrive',{source:'voice',text:'已经到达安置点'});
  assert.equal(x.data.occupancy[r.shelterId],r.people);assert.deepEqual(x.data.fleet.V1.onboard,[]);
  assert.ok(r.passengerIds.every(id=>x.data.stage[id]==='arrived'));
  assert.equal(x.data.fieldEvents[0].stage,'arrive');assert.equal(x.data.fieldEvents[0].people,r.people);assert.match(x.data.lastAnnouncement,/等待人工核验/);
  unchangedOnError(x,()=>progress(x,'arrive'),/没有可回报/);
  x.action('verify',{id:r.passengerIds[0]});assert.equal(x.data.stage[r.passengerIds[0]],'verified');assert.equal(x.data.occupancy[r.shelterId],r.people);
});

test('replanning requires the exact currently published plan id and a new vehicle acknowledgement',()=>{
  const x=published(),old=x.data.activePlan.id;progress(x,'ack');x.action('generate');x.action('confirm');
  unchangedOnError(x,()=>progress(x,'contact',{planId:old,householdId:'H2'}),/方案已过期/);
  const r=x.data.activePlan.routes.find(r=>r.vehicleId==='V1');unchangedOnError(x,()=>progress(x,'contact',{householdId:r.stops[0].id}),/先确认本车已接收/);
  progress(x,'ack');assert.notEqual(x.data.taskAcks.V1.planId,old);progress(x,'contact',{householdId:r.stops[0].id});
});

test('confirmed blockage pauses field boarding just as it pauses command-side execution',()=>{
  const x=ready(),r=x.data.activePlan.routes.find(r=>r.vehicleId==='V1'),edgeId=r.segments[0].edges[0];
  x.action('report',{kind:'road',location:edgeId,text:'现场确认前方道路中断',source:'voice'});
  x.action('review',{id:x.data.reports[0].id,decision:'accept',note:'演练人工核实封闭'});
  assert.equal(E.blockedRoute(x.data,r),true);
  unchangedOnError(x,()=>progress(x,'board',{householdId:r.stops[0].id}),/暂停推进/);
});

test('an onboard-only replacement plan keeps passengers on their vehicle and requires acknowledgement before arrival',()=>{
  const x=ready(),r=x.data.activePlan.routes.find(r=>r.vehicleId==='V1');for(const st of r.stops)progress(x,'board',{householdId:st.id});
  const onboard=x.data.fleet.V1.onboard;x.action('generate');x.action('confirm');
  const replacement=x.data.activePlan.routes.find(r=>r.vehicleId==='V1');assert.equal(replacement.stops.length,0);assert.deepEqual(replacement.onboard,onboard);
  unchangedOnError(x,()=>progress(x,'arrive'),/先确认本车已接收/);progress(x,'ack');progress(x,'arrive');
  assert.deepEqual(x.data.fleet.V1.delivered,onboard);assert.equal(x.data.fieldEvents[0].people,r.people);assert.equal(x.data.occupancy[replacement.shelterId],r.people);
});

test('confirmed blockage also prevents an arrival record while retaining the onboard manifest and shelter occupancy',()=>{
  const x=ready(),r=x.data.activePlan.routes.find(r=>r.vehicleId==='V1');for(const st of r.stops)progress(x,'board',{householdId:st.id});
  x.action('report',{kind:'road',location:r.segments.at(-1).edges[0],text:'前往安置点道路受阻'});
  x.action('review',{id:x.data.reports[0].id,decision:'accept',note:'现场人员核实道路无法通行'});
  unchangedOnError(x,()=>progress(x,'arrive'),/暂停推进/);assert.deepEqual(x.data.fleet.V1.onboard,r.passengerIds);assert.equal(x.data.occupancy[r.shelterId],0);
});

test('ordinary feedback joins the shared field event stream without changing dispatch state',()=>{
  const x=published(),before=x.data.stage;
  x.action('report',{kind:'people',location:'H1',text:'现场新增两人需要协助',people:2,reporter:'现场乙',source:'voice'});
  const e=x.data.fieldEvents[0],r=x.data.reports[0];
  assert.equal(e.kind,'report');assert.equal(e.reportId,r.id);assert.equal(e.reportKind,'people');assert.equal(e.location,'H1');assert.equal(e.people,2);
  assert.equal(e.source,'voice');assert.equal(e.reporter,'现场乙');assert.equal(e.text,r.text);assert.equal(e.planId,x.data.activePlan.id);assert.deepEqual(x.data.stage,before);
  x.action('report',{kind:'other',location:'H1',text:'手动表单提交'});assert.equal(x.data.fieldEvents[0].source,'manual');
  for(let i=0;i<101;i++)x.action('report',{kind:'progress',location:'H1',text:'演练记录 '+i});
  assert.equal(x.data.fieldEvents.length,100);assert.equal(new Set(x.data.fieldEvents.map(e=>e.id)).size,100);assert.equal(x.data.fieldEvents[0].text,'演练记录 100');
});

test('restoring an older V3 data snapshot preserves execution, logs and occupancy and adds only new defaults',()=>{
  const x=ready(),r=x.data.activePlan.routes.find(r=>r.vehicleId==='V1');for(const st of r.stops)progress(x,'board',{householdId:st.id});progress(x,'arrive');
  const old=x.data;delete old.fieldEvents;delete old.taskAcks;
  const saved=structuredClone(old),restored=E.create(old);
  assert.deepEqual(restored.data.stage,saved.stage);assert.deepEqual(restored.data.fleet,saved.fleet);assert.deepEqual(restored.data.occupancy,saved.occupancy);assert.deepEqual(restored.data.log,saved.log);
  assert.equal(restored.data.revision,saved.revision);assert.deepEqual(restored.data.fieldEvents,[]);assert.deepEqual(restored.data.taskAcks,{});assert.deepEqual(old,saved);
  old.occupancy[r.shelterId]=0;assert.equal(restored.data.occupancy[r.shelterId],r.people);
  restored.action('verify',{id:r.passengerIds[0]});assert.equal(restored.data.stage[r.passengerIds[0]],'verified');assert.equal(restored.data.occupancy[r.shelterId],r.people);
  assert.throws(()=>E.create({...saved,schema:'invalid'}),/jiaoying-v3/);assert.throws(()=>E.create({...saved,fleet:{}}),/车辆状态无效/);
});
