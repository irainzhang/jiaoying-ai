const test=require('node:test');
const assert=require('node:assert/strict');
const X=require('../exercise.cjs');
const T=require('../lifecycle.cjs');
const clone=value=>structuredClone(value);
function begin(){const x=X.create();x.action('generate');x.action('confirm');x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');return x;}
function finish(x){for(const route of x.data.activePlan.routes.filter(r=>r.people))while(!x.data.fleet[route.vehicleId].finished)x.action('step',{vehicleId:route.vehicleId});for(const [id,stage] of Object.entries(x.data.stage))if(stage==='arrived')x.action('verify',{id});}
const village={villageId:'VA',mode:'increment',people:4,pickupId:'P-A1',assistancePeople:null,wheelchairPeople:null,groupPolicy:'unknown',text:'新增4人，其他信息暂未确认',source:'voice',reporter:'现场值守'};

test('legacy states hydrate as active without inventing closures or history',()=>{
 const x=X.create(),legacy=x.data;delete legacy.taskLifecycle;delete legacy.taskArchives;
 const reopened=X.create(legacy).data;assert.deepEqual(reopened.taskLifecycle,{status:'active',endedAt:null,note:'',summary:null});assert.deepEqual(reopened.taskArchives,[]);assert.equal(X.taskSummary(reopened).canComplete,false);
});

test('early closure preserves boarded passengers, pending facts, plans and all original task records',()=>{
 const x=begin(),route=x.data.activePlan.routes.find(r=>r.people);x.action('step',{vehicleId:route.vehicleId});
 x.action('village-report',village);x.action('report',{kind:'people',location:'H1',people:2,text:'另外两人待核实'});
 const before=x.data,after=x.action('end-task',{mode:'stopped'});
 for(const key of ['scenario','stage','fleet','contacts','occupancy','reports','villageReports','fieldEvents','activePlan','taskAcks','phase'])assert.deepEqual(after[key],before[key],key);
 assert.equal(after.taskLifecycle.status,'stopped');assert.equal(after.revision,before.revision+1);assert.equal(after.taskLifecycle.summary.pendingReviewPeople,6);assert.equal(after.taskLifecycle.summary.pendingReports,2);assert.ok(after.taskLifecycle.summary.boarded>0);assert.match(after.taskLifecycle.note,/按原状态保留/);
 assert.doesNotThrow(()=>X.restore(after));
});

test('closed task rejects ordinary in-place writes atomically while explicit new-task operations remain available',()=>{
 const x=X.create();x.action('generate');x.action('end-task',{mode:'stopped'});const before=x.data;
 for(const action of ['end-task','generate','confirm','weather','report','village-report','village-review','command-intake','map-demand-locate','enable-road-map','field-progress','contact','start','step','verify','edit','resource-event','followup']){
   assert.throws(()=>x.action(action,{}),/已结束/);assert.deepEqual(x.data,before,action);
 }
});

test('completed requires every effective person verified and pending facts reviewed',()=>{
 const x=begin();assert.throws(()=>x.action('end-task',{mode:'completed'}),/未完成/);finish(x);
 assert.equal(X.taskSummary(x.data).canComplete,true);x.action('village-report',village);
 const id=x.data.villageReports[0].id;assert.equal(X.taskSummary(x.data).canComplete,false);assert.throws(()=>x.action('end-task',{mode:'completed'}),/待核实/);
 x.action('village-review',{id,decision:'reject',note:'重复上报，已有记录'});const before=x.data;
 x.action('end-task',{mode:'completed'});assert.equal(x.data.taskLifecycle.summary.verified,15);assert.equal(x.data.taskLifecycle.status,'completed');assert.deepEqual(x.data.stage,before.stage);
});

test('accepted unlocated demands remain unplanned and prevent complete closure',()=>{
 const x=begin();finish(x);x.action('command-intake',{source:'text',rows:[{villageName:'临时未定位村',people:2,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'临时未定位村新增2人'}]});
 const summary=X.taskSummary(x.data);assert.equal(summary.waiting,2);assert.equal(summary.unplannedPeople,2);assert.equal(summary.unlocatedPeople,2);assert.equal(summary.canComplete,false);
 x.action('end-task',{mode:'stopped'});assert.deepEqual(x.data.taskLifecycle.summary,summary);
});

test('new task archives the entire closed task once and retains real road mode',()=>{
 const x=X.create();x.action('scenario',{id:'ruian-roads'});assert.throws(()=>x.action('new-task'),/先结束/);x.action('end-task',{mode:'stopped'});const closed=x.data;
 x.action('new-task');const next=x.data;
 assert.notEqual(next.exerciseId,closed.exerciseId);assert.equal(next.revision,closed.revision+1);assert.equal(next.scenario.region.mapKind,'osm-road-network');assert.equal(next.scenarioPreset,'ruian-roads');assert.equal(next.taskLifecycle.status,'active');assert.equal(next.taskArchives.length,2);assert.equal(next.taskArchives[0].data.taskArchives,undefined);
 const source=clone(closed);delete source.taskArchives;assert.deepEqual(next.taskArchives[0].data,source);assert.equal(X.metrics(next).waiting,15);assert.equal(next.activePlan,null);assert.doesNotThrow(()=>X.restore(next));
 x.action('end-task',{mode:'stopped'});x.action('new-task');assert.equal(x.data.taskArchives.length,3);assert.ok(x.data.taskArchives.every(row=>row.data.taskArchives===undefined));
});

test('existing advanced reset and scenario preserve past task archives',()=>{
 const x=X.create();x.action('end-task',{mode:'stopped'});x.action('new-task');const archived=x.data.taskArchives;
 x.action('reset');assert.deepEqual(x.data.taskArchives.slice(1),archived);assert.equal(x.data.taskArchives[0].status,'stopped');x.action('scenario',{id:'resource-shortage'});assert.deepEqual(x.data.taskArchives.slice(2),archived);assert.equal(x.data.taskArchives.length,archived.length+2);
});

test('closed backups restore read-only without clearing published history or inventing new plans',()=>{
 const source=begin();source.action('step',{vehicleId:source.data.activePlan.routes.find(r=>r.people).vehicleId});source.action('end-task',{mode:'stopped'});
 const target=X.create();target.action('restore',{data:source.data});
 for(const key of ['stage','fleet','activePlan','taskLifecycle','taskAcks','inputVersion','executionVersion'])assert.deepEqual(target.data[key],source.data[key],key);
 assert.throws(()=>target.action('generate'),/已结束/);
});

test('restoring an old open backup cannot reopen the same closed task or an archived task',()=>{
 const x=begin(),old=x.data;x.action('end-task',{mode:'stopped'});const closed=x.data;
 assert.throws(()=>x.action('restore',{data:old}),/不能.*重新打开/);assert.deepEqual(x.data,closed);
 x.action('new-task');const next=x.data;assert.throws(()=>x.action('restore',{data:old}),/历史已结束/);assert.deepEqual(x.data,next);
});

test('restoring a different task keeps the current closed task and both prior archives',()=>{
 const a=X.create(),b=X.create();a.action('end-task',{mode:'stopped'});a.action('new-task');a.action('end-task',{mode:'stopped'});const closed=a.data;
 a.action('restore',{data:b.data});assert.equal(a.data.taskArchives.length,2);assert.equal(a.data.taskArchives[0].exerciseId,closed.exerciseId);assert.equal(a.data.taskArchives[0].data.stage.H1,'waiting');
});

test('restoration validates closure summary, completion truth and flattened archive content',()=>{
 const x=X.create();x.action('end-task',{mode:'stopped'});x.action('new-task');
 const cases=[d=>{d.taskArchives[0].data.taskLifecycle.summary.verified=15;},d=>{d.taskArchives[0].data.taskLifecycle.status='completed';d.taskArchives[0].status='completed';},d=>{d.taskArchives[0].data.taskArchives=[];},d=>{d.taskArchives[0].data.stage.H1='verified';},d=>{d.taskArchives.push(clone(d.taskArchives[0]));},d=>{d.taskLifecycle={status:'active',endedAt:'2026-10-05T00:00:00Z',note:'',summary:null};}];
 for(const mutate of cases){const bad=x.data;mutate(bad);assert.throws(()=>X.restore(bad));}
});

test('archive count and size are bounded without evicting unfinished records',()=>{
 const x=X.create();for(let i=0;i<T.MAX_ARCHIVES;i++){x.action('end-task',{mode:'stopped'});x.action('new-task');}
 x.action('end-task',{mode:'stopped'});const before=x.data;assert.throws(()=>x.action('new-task'),/不会自动清理/);assert.deepEqual(x.data,before);
 assert.throws(()=>T.mergeArchives([{exerciseId:'large',data:{note:'字'.repeat(1500000)}}]),/4 MB/);
});
