const test=require('node:test');
const assert=require('node:assert/strict');
const X=require('../exercise.cjs');
const tools=require('../dist/guardian/host-tools.js');
function hostFixture(blank=false){
 const store=X.create(blank?X.createBlank():undefined),calls=[];
 const snapshot=()=>({session:'host-session',data:store.data,metrics:X.metrics(store.data),taskSummary:X.taskSummary(store.data),villageLedger:X.villageMetrics(store.data)});
 return {store,calls,readState:snapshot,async calculateDraft(expected){assert.ok(tools.same(expected,tools.stamp(snapshot())));calls.push('generate');store.action('generate');return snapshot();},openPublicationReview(){calls.push('open-confirm-dialog');}};
}
test('Guardian current task reports actual zero-person startup, never imports independent 15-person seed',async()=>{
 const host=hostFixture(true),before=host.store.data,result=await tools.run(host,'read_state');
 assert.equal(result.people,0);assert.equal(result.routes.length,0);assert.equal(result.source,'jiaoying-current-task');assert.match(result.provider,/本地工具与调度算法/);assert.deepEqual(host.store.data,before);
 await assert.rejects(tools.run(host,'calculate_draft'),/0 人/);assert.equal(host.calls.length,0);
});
test('Guardian calculation uses current host demands and writes only a draft through host adapter',async()=>{
 const host=hostFixture(),initial=await tools.run(host,'read_state');
 host.store.action('command-intake',{rows:[{villageId:'VA',pickupId:'P-A1',people:5,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'测试新增5人'}],source:'text'});
 const observed=await tools.run(host,'read_state');assert.equal(observed.people,20);assert.notDeepEqual(observed.stamp,initial.stamp);
 const calculated=await tools.run(host,'calculate_draft',observed.stamp);assert.equal(calculated.people,20);assert.equal(calculated.planFresh,true);assert.deepEqual(host.calls,['generate']);assert.equal(host.store.data.activePlan,null);
 assert.deepEqual(calculated.routes.map(x=>x.people),host.store.data.plan.routes.filter(x=>x.people).map(x=>x.people));assert.deepEqual(calculated.routes[0].segments,host.store.data.plan.routes.find(x=>x.people).segments);
});
test('Guardian rejects stale revision/session/input/execution stamps before invoking a tool',async()=>{
 const host=hostFixture(),current=await tools.run(host,'read_state');
 for(const key of ['session','revision','inputVersion','executionVersion']){const stale={...current.stamp,[key]:key==='session'?'another':current.stamp[key]+1};await assert.rejects(tools.run(host,'calculate_draft',stale),/已更新/);}
 assert.equal(host.calls.length,0);
 host.store.action('weather',{rainfall:80});await assert.rejects(tools.run(host,'calculate_draft',current.stamp),/已更新/);assert.equal(host.calls.length,0);
});
test('Guardian report preserves gaps, pending facts, live stages and provenance without mutating host',async()=>{
 const host=hostFixture();host.store.action('generate');host.store.action('village-report',{villageId:'VA',mode:'increment',people:3,pickupId:'P-A1',assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'新发现3人',source:'voice',reporter:'现场'});
 const before=host.store.data,result=await tools.run(host,'prepare_report');assert.equal(result.pendingReports,1);assert.equal(result.pending[0].pendingPeople,3);assert.match(result.reportText,/本地规则与算法结果/);assert.match(result.reportText,/未发布|已发布方案 无/);assert.equal(result.tool,'prepare_report');assert.deepEqual(host.store.data,before);
 host.store.action('end-task',{mode:'stopped'});await assert.rejects(tools.run(host,'calculate_draft'),/已结束/);
});
test('after arrivals with no draft, published routes remain historical and never claim current remaining capacity',async()=>{
 const host=hostFixture(true);
 host.store.action('command-intake',{rows:[{villageId:'VA',pickupId:'P-A1',people:20,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'测试新增20人'}],source:'text'});
 host.store.action('confirm');const published=host.store.data.activePlan,route=published.routes.find(r=>r.people);
 host.store.action('contact',{ids:published.servedIds});host.store.action('start');
 while(!host.store.data.fleet[route.vehicleId].finished)host.store.action('step',{vehicleId:route.vehicleId});
 assert.equal(host.store.data.plan,null);const result=await tools.run(host,'prepare_report');
 assert.equal(result.people,20);assert.equal(result.arrived,route.people);assert.equal(result.waiting+result.boarded+result.arrived+result.verified,20);
 assert.equal(result.planId,null);assert.equal(result.activePlanId,published.id);assert.equal(result.planKind,'published-record');assert.equal(result.planFresh,false);assert.equal(result.served,null);
 assert.doesNotMatch(result.summary,/当前草案可安排/);assert.match(result.summary,new RegExp('原安排 '+published.servedPeople+' 人'));assert.match(result.summary,/当前剩余可安排人数需重新计算/);assert.match(result.summary,new RegExp('到达待核验 '+route.people+' 人'));
 const done=result.routes.find(r=>r.vehicleId===route.vehicleId);assert.equal(done.progress.arrived,route.people);assert.equal(done.receiptLabel,'本趟已登记到达');assert.equal(done.scope,'原发布记录');
 assert.ok(result.gaps.length);assert.ok(result.gaps.every(x=>x.scope==='原快照待协调（需重算）'));assert.match(result.reportText,/原快照待协调（需重算）/);
});
test('the retained draft with the published plan id shows published awaiting acknowledgement, not awaiting publication',async()=>{
 const host=hostFixture();host.store.action('generate');host.store.action('confirm');
 const result=await tools.run(host,'read_state');assert.equal(result.planId,result.activePlanId);assert.equal(result.planKind,'published-current');assert.match(result.summary,/当前方案已发布/);assert.doesNotMatch(result.reportText,/待人工发布/);
 assert.ok(result.routes.length);assert.ok(result.routes.every(r=>r.receiptLabel==='已发布 · 待接令'&&r.scope==='已发布方案'));
});
test('only three current-task tools are exposed and natural-language publication request cannot publish',async()=>{
 const host=hostFixture();for(const name of ['confirm','publish_dispatch_plan','start','verify','end-task'])await assert.rejects(tools.run(host,name),/不提供发布/);
 assert.equal(tools.intent('还有多少人没安排').tool,'read_state');assert.equal(tools.intent('帮我重新安排').tool,'calculate_draft');assert.equal(tools.intent('查看当前人数').tool,'read_state');assert.equal(tools.intent('整理报告').tool,'prepare_report');assert.equal(tools.intent('现在发布任务').tool,null);assert.equal(host.calls.length,0);
});

test('ended task reports retain gaps and publication facts without directing the user to recalculate',async()=>{
 const host=hostFixture(true);
 host.store.action('command-intake',{rows:[{villageId:'VA',pickupId:'P-A1',people:20,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'20人演练'}],source:'text'});
 host.store.action('confirm');host.store.action('end-task',{mode:'stopped'});
 const before=host.store.data,result=await tools.run(host,'prepare_report');
 assert.equal(result.closed,true);assert.equal(result.waiting,20);assert.match(result.summary,/本场已结束/);
 assert.match(result.reportText,/历史记录保留/);assert.doesNotMatch(result.summary+'\n'+result.reportText,/需重算|需重新计算|需计算或重新核对/);
 assert.ok(result.gaps.length);assert.ok(result.gaps.every(x=>x.scope==='结束时待协调'));
 await assert.rejects(tools.run(host,'calculate_draft'),/已结束/);assert.deepEqual(host.store.data,before);
});
