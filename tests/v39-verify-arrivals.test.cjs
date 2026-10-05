const test=require('node:test');
const assert=require('node:assert/strict');
const E=require('../exercise.cjs');
function delivered(){
 const x=E.create();x.action('generate');x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');
 for(const route of x.data.activePlan.routes.filter(r=>r.people))while(!x.data.fleet[route.vehicleId].finished)x.action('step',{vehicleId:route.vehicleId});
 return x;
}
test('batch verification changes only explicitly selected arrived groups and keeps counts, fleet and occupancy',()=>{
 const x=delivered(),before=x.data,ids=Object.keys(before.stage).slice(0,2),people=before.scenario.households.filter(h=>ids.includes(h.id)).reduce((n,h)=>n+h.people,0);
 x.action('verify-arrivals',{ids});const after=x.data;
 for(const [id,stage] of Object.entries(after.stage))assert.equal(stage,ids.includes(id)?'verified':before.stage[id]);
 for(const key of ['fleet','occupancy','activePlan','contacts','reports','villageReports','taskLifecycle'])assert.deepEqual(after[key],before[key]);
 assert.equal(after.executionVersion,before.executionVersion+1);assert.equal(after.revision,before.revision+1);assert.equal(E.metrics(after).verified,people);assert.equal(E.metrics(after).arrived,15-people);assert.equal(after.plan,null);assert.equal(after.planSnapshot,null);
 assert.deepEqual(after.log[0].householdIds,ids);assert.equal(after.log[0].people,people);assert.match(after.lastAnnouncement,/本批 2 组/);assert.doesNotThrow(()=>E.restore(after));
});
test('invalid IDs, duplicate IDs and invalid collection sizes fail before any group is verified',()=>{
 const x=delivered(),before=x.data;
 for(const ids of [[],null,'H1',['H1','missing'],['H1','H1'],['H1',null],Array.from({length:201},(_,i)=>'H'+i)]){
  assert.throws(()=>x.action('verify-arrivals',{ids}));assert.deepEqual(x.data,before);
 }
 x.action('verify',{id:'H1'});const after=x.data;assert.throws(()=>x.action('verify-arrivals',{ids:['H2','H1']}),/整批未提交/);assert.deepEqual(x.data,after);
});
test('batch verification never fabricates arrival for waiting or boarded people',()=>{
 const x=E.create();x.action('generate');const before=x.data;
 assert.throws(()=>x.action('verify-arrivals',{ids:['H1']}),/先有到达/);assert.deepEqual(x.data,before);
 x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');const route=x.data.activePlan.routes.find(r=>r.people);x.action('step',{vehicleId:route.vehicleId});const boarded=x.data,id=boarded.fleet[route.vehicleId].onboard[0];
 assert.throws(()=>x.action('verify-arrivals',{ids:[id]}),/先有到达/);assert.deepEqual(x.data,boarded);
});
test('a whole arrived batch can be verified once and enables task completion without bypassing task closure',()=>{
 const x=delivered(),ids=Object.keys(x.data.stage);x.action('verify-arrivals',{ids});assert.equal(E.taskSummary(x.data).canComplete,true);assert.equal(E.metrics(x.data).verified,15);
 x.action('end-task',{mode:'completed'});const closed=x.data;assert.throws(()=>x.action('verify-arrivals',{ids}),/已结束/);assert.deepEqual(x.data,closed);
});
