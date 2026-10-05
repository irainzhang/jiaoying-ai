'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../exercise.cjs'),I=require('../dist/command-intake.js'),D=require('../dist/place-directory.js'),M=require('../dist/transport-map.js');
const context=()=>{const store=E.create(E.createBlank({mapMode:'ruian-roads'}));return {store,data:store.data};};
const area=ctx=>ctx.data.villages.find(v=>v.name==='玉海街道');
const point=ctx=>ctx.data.villages.find(v=>v.kind==='road-group').pickups[0];
test('road intake offers real places and explicitly retains only the selected historic sample',()=>{
 const ctx=context(),options=D.villageOptions(ctx.data);assert.ok(options.some(v=>v.label==='玉海街道'));assert.ok(options.some(v=>v.label==='东镇社区'));assert.ok(!options.some(v=>v.id==='VA'));
 assert.ok(D.villageOptions(ctx.data,'VA').some(v=>v.id==='VA'));assert.deepEqual(D.villages(E.create().data).map(v=>v.id),['VA','VB','VC']);
});
test('all sourced areas survive speech, and verified parent-child names resolve to the community only',()=>{
 const ctx=context();for(const v of ctx.data.villages.filter(v=>v.catalogSource&&v.kind!=='road-group')){const parsed=I.parseText(v.name+'，新增3人',ctx);assert.deepEqual(parsed.errors,[],v.name);assert.equal(parsed.rows[0].villageId,v.id);assert.equal(parsed.rows[0].pickupId,'');}
 const parsed=I.parseText('玉海街道东镇社区，新增3人',ctx);assert.deepEqual(parsed.errors,[]);assert.equal(parsed.rows[0].villageName,'东镇社区');
 for(const text of ['玉海街道，东镇社区新增3人','东镇社区新增3人']){const spoken=I.parseText(text,{...ctx,villageId:area(ctx).id,pickupId:point(ctx).id});assert.deepEqual(spoken.errors,[],text);assert.equal(spoken.rows[0].villageName,'东镇社区');assert.equal(spoken.rows[0].pickupId,'');}
 assert.ok(I.parseText('安阳街道东镇社区，新增3人',ctx).errors.length,'unrelated parent cannot be guessed');
});
test('actual candidate flows through quick editing, map preview, CSV, speech and saved demand without losing provenance',()=>{
 const ctx=context(),v=area(ctx),p=point(ctx);let scope=I.updateRow({},'villageName',v.id,ctx);scope=I.updateRow(scope,'pickupName',p.id,ctx);
 assert.equal(scope.pickupId,p.id);assert.equal(scope.pickupName,p.name);
 const rows=I.parseRows([['村庄','集合点','人数','需协助人数','轮椅人数','同行关系'],[v.id,p.id,3,0,0,'可分组']],ctx);assert.deepEqual(rows.errors,[]);
 const review=I.reviewRows(rows.rows,ctx);assert.deepEqual(review.errors,[]);assert.equal(review.readyPeople,3);assert.match(review.warnings.join(''),/所属街道尚未核实/);
 const map=M.draftPoints(ctx.data,review.rows);assert.equal(map.points.length,1);assert.equal(map.points[0].longitude,p.longitude);assert.equal(map.points[0].latitude,p.latitude);
 ctx.store.action('command-intake',{rows:review.rows,source:'text'});ctx.data=ctx.store.data;assert.equal(E.metrics(ctx.data).people,3);assert.equal(ctx.data.activePlan,null);
 const report=ctx.data.villageReports[0],registered=area(ctx).pickups.find(x=>x.id===report.pickupId);assert.equal(registered.publicPlaceId,p.id);assert.equal(registered.administrativeRelation,'user-selected-unverified');
 const options=D.pickupOptions(ctx.data,v.id);assert.equal(options.filter(o=>o.label===p.name).length,1);assert.match(options.find(o=>o.label===p.name).detail,/辖属待核/);
 for(const input of [p.id,registered.id,p.name]){const again=I.parseRows([['村庄','集合点','人数'],[v.id,input,2]],ctx);assert.deepEqual(again.errors,[],input);assert.deepEqual(I.reviewRows(again.rows,ctx).errors,[]);}
 for(const text of ['新增2人',v.name+'，'+p.name+'，新增2人']){const again=I.parseText(text,{...ctx,villageId:v.id,pickupId:p.id});assert.deepEqual(again.errors,[],text);assert.deepEqual(I.reviewRows(again.rows,ctx).errors,[]);}
 assert.deepEqual(I.reviewRows(review.rows,ctx).errors,[],'source ID in an older preview remains valid after local registration');
});
