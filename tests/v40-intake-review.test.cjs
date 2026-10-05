'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const intake=require('../dist/command-intake.js');
const E=require('../exercise.cjs');
const context=()=>({data:{villages:[{id:'VA',name:'登记村 A',pickups:[{id:'PA1',name:'村委会',node:'H1'},{id:'PA2',name:'礼堂',node:'H2'}]},{id:'VB',name:'登记村 B',pickups:[{id:'PB1',name:'村委会',node:'H3'}]}],scenario:{nodes:[{id:'H1'},{id:'H2'},{id:'H3'}],edges:[{from:'H1',to:'H2',open:true},{from:'H2',to:'H3',open:true}],region:{}}}});
const row=()=>({villageId:'VA',pickupId:'PA1',people:6,assistancePeople:1,wheelchairPeople:0,groupPolicy:'splittable',text:'登记村 A 村委会新增 6 人，其中 1 人需要协助',rowIndex:2});

test('counts are editable while source values and correction provenance remain intact',()=>{
  const original=row(),ctx=context(),changed=intake.updateRow(original,'people','8',ctx);
  assert.equal(original.people,6);assert.equal(changed.people,8);assert.equal(changed.original.people,6);assert.deepEqual(changed.editedFields,['people']);
  assert.equal(changed.original.text,original.text);assert.match(intake.submissionText(changed),/人数 6 → 8/);
  const changedAgain=intake.updateRow(changed,'people','9',ctx);assert.equal(changedAgain.original.people,6);
  const undo=intake.updateRow(changedAgain,'people','6',ctx);assert.deepEqual(undo.editedFields,[]);assert.equal(intake.submissionText(undo),original.text);
});

test('editing a village clears the old pickup and coordinates instead of reusing a generic place name',()=>{
  const r={...row(),longitude:120.64,latitude:27.78,coordinateSystem:'WGS84',locationNodeId:'H1'};
  const changed=intake.updateRow(r,'villageName','登记村 B',context());
  assert.equal(changed.villageId,'VB');assert.equal(changed.pickupId,'');assert.equal(changed.pickupName,'');assert.equal(changed.locationNodeId,null);assert.equal(changed.longitude,null);
  assert.equal(intake.reviewRows([changed],context()).pendingPeople,6);
  const located=intake.updateRow(changed,'pickupName','村委会',context());assert.equal(located.pickupId,'PB1');assert.equal(intake.reviewRows([located],context()).readyPeople,6);
});

test('changing a pickup matches only within the selected village and preserves unmatched names',()=>{
  const changed=intake.updateRow(row(),'pickupName','礼堂',context());assert.equal(changed.pickupId,'PA2');
  const unmatched=intake.updateRow(changed,'pickupName','学校门口',context());assert.equal(unmatched.pickupId,'');assert.equal(unmatched.pickupName,'学校门口');
  const reviewed=intake.reviewRows([unmatched],context());assert.equal(reviewed.readyPeople,0);assert.equal(reviewed.pendingPeople,6);assert.deepEqual(reviewed.errors,[]);
});

test('ambiguous directory names are blocked until an explicit registered ID resolves them',()=>{
  const ctx=context();ctx.data.villages.push({id:'VC',name:'登记村 B',pickups:[{id:'PC1',name:'村委会',node:'H2'}]});
  const changed=intake.updateRow(row(),'villageName','登记村 B',ctx);assert.equal(changed.villageId,'');assert.match(intake.reviewRows([changed],ctx).errors.join(''),/同名村庄/);
  const unique=intake.updateRow(changed,'villageName','VC',ctx);assert.equal(unique.villageId,'VC');assert.deepEqual(intake.reviewRows([unique],ctx).errors,[]);
  ctx.data.villages[2].pickups.push({id:'PC2',name:'村委会',node:'H3'});
  const ambiguous=intake.updateRow(unique,'pickupName','村委会',ctx);assert.equal(ambiguous.pickupId,'');assert.match(intake.reviewRows([ambiguous],ctx).errors.join(''),/同名接人点/);
  assert.deepEqual(intake.reviewRows([intake.updateRow(ambiguous,'pickupName','PC2',ctx)],ctx).errors,[]);
});

test('unknown assistance and wheelchair values remain unknown; invalid subsets cannot be submitted',()=>{
  const r=intake.updateRow(row(),'assistancePeople','',context()),review=intake.reviewRows([r],context());
  assert.equal(r.assistancePeople,null);assert.equal(review.readyPeople,0);assert.equal(review.pendingPeople,6);assert.deepEqual(review.errors,[]);
  for(const value of ['',0,-1,1.5,501])assert.match(intake.reviewRows([intake.updateRow(row(),'people',value,context())],context()).errors.join(''),/人数须/);
  const bad=intake.updateRow(row(),'people','1',context()),wheel=intake.updateRow(bad,'wheelchairPeople','2',context());assert.match(intake.reviewRows([wheel],context()).errors.join(''),/轮椅人数/);
});

test('summary includes accepted demand only and labels unverified supplements separately',()=>{
  const state={...context(),metrics:{people:20,pendingVillagePeople:3}},review=intake.summary(state,[row(),{...row(),people:2,assistancePeople:null}]);
  assert.equal(review.existingPeople,20);assert.equal(review.incomingPeople,8);assert.equal(review.afterPeople,28);assert.equal(review.pendingReportPeople,3);assert.equal(review.readyPeople,6);assert.equal(review.pendingPeople,2);
});

test('review rematches registered names across the whole batch without inventing unknown anchors',()=>{
  const ctx=context(),rows=[{...row(),villageId:'',pickupId:'',villageName:'登记村 A',pickupName:'礼堂'},{...row(),villageId:'',pickupId:'',villageName:'新增村',pickupName:'活动室'}];
  const result=intake.reviewRows(rows,ctx);assert.equal(result.rows[0].villageId,'VA');assert.equal(result.rows[0].pickupId,'PA2');assert.equal(result.readyPeople,6);assert.equal(result.pendingPeople,6);
  assert.equal(rows[0].pickupId,'');assert.equal(result.rows[1].villageId,'');assert.equal(result.rows[1].pickupId,'');
});

test('out of coverage coordinates are retained as pending and diagram coordinates carry an actionable error',()=>{
  const ctx=context(),r={...row(),pickupId:'',pickupName:'新增点',longitude:120.9,latitude:27.9,coordinateSystem:'WGS84'};
  assert.match(intake.reviewRows([r],ctx).errors.join(''),/新建道路任务/);
  ctx.data.scenario.region={mapKind:'osm-road-network',bounds:[120.6,27.74,120.7,27.82]};
  const result=intake.reviewRows([r],ctx);assert.deepEqual(result.errors,[]);assert.equal(result.readyPeople,0);assert.match(result.warnings.join(''),/范围/);assert.equal(result.rows[0].longitude,120.9);
});

test('a coordinate inside coverage is still a candidate until the backend matches its road',()=>{
  const ctx=context();ctx.data.scenario.region={mapKind:'osm-road-network',bounds:[120.6,27.74,120.7,27.82]};
  const r={...row(),pickupId:'',pickupName:'新增点',longitude:120.65,latitude:27.78,coordinateSystem:'WGS84'};
  const result=intake.reviewRows([r],ctx);assert.equal(result.readyPeople,0);assert.equal(result.pendingPeople,6);assert.match(result.rows[0].review.location.label,/待匹配/);assert.deepEqual(result.errors,[]);
});

test('review blocks pickup versus manual-node conflicts before authoritative import rejects them',()=>{
  const result=intake.reviewRows([{...row(),locationNodeId:'H2'}],context());assert.match(result.errors.join(''),/不一致/);assert.equal(result.readyPeople,0);
});

test('human-selected location with complete needs remains ready after a road-based import and restore',()=>{
  const x=E.create();x.action('enable-road-map');const data=x.data,n=data.scenario.nodes.find(n=>n.id==='H1');
  const row={villageName:'上传村',pickupName:'人工核对接人点',people:6,assistancePeople:1,wheelchairPeople:0,groupPolicy:'splittable',locationNodeId:n.id,longitude:n.longitude,latitude:n.latitude,coordinateSystem:'WGS84',text:'上传村新增6人'};
  const result=intake.reviewRows([row],{data});assert.deepEqual(result.errors,[]);assert.equal(result.readyPeople,6);
  x.action('command-intake',{rows:result.rows,source:'file'});assert.equal(x.data.villageReports[0].needsInfo,false);assert.equal(x.data.villageReports[0].people,6);assert.equal(x.data.activePlan,null);assert.deepEqual(E.create(x.data).data.villageReports,x.data.villageReports);
});

test('the review UI provides one count equation, editable fields and honest save wording',()=>{
  const contextUI={window:{JiaoyingCommandIntake:intake,JiaoyingPlaceDirectory:require('../dist/place-directory.js')}};vm.createContext(contextUI);vm.runInContext(fs.readFileSync(require.resolve('../dist/intake-ui.js'),'utf8'),contextUI);
  const state={...context(),session:'s',metrics:{people:20,pendingVillagePeople:3},capabilities:{commandIntake:true}};state.data.revision=1;
  const changed=intake.updateRow(row(),'people','8',state),ui={draft:{rows:[{...changed,assistancePeople:null}],errors:[],warnings:[],revision:1,session:'s'},connected:true};
  const h={btn:(label,action,attrs='',cls='')=>`<button data-ac="${action}" ${attrs} class="${cls}">${label}</button>`,badge:s=>s,voiceHTML:()=>''};
  const html=contextUI.window.JiaoyingIntakeUI.command(state,ui,h);
  assert.match(html,/本场已有 20 人 ＋ 此次新增 8 人 ＝ 保存后 28 人/);assert.match(html,/另有现场补报 3 人待核实/);
  for(const field of ['people','villageName','pickupName','assistancePeople','wheelchairPeople','groupPolicy'])assert.ok(html.includes(`data-intake-field="${field}"`));
  assert.match(html,/已人工修改/);assert.match(html,/查看原值/);assert.match(html,/保存需求并补齐信息/);assert.doesNotMatch(html,/导入需求并查看路线/);
});
