'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const intake=require('../dist/command-intake.js');
const context=()=>({data:{villages:[{id:'VA',name:'演示村 A',pickups:[{id:'PA1',name:'村委会集合点（演示）',node:'H1'},{id:'PA2',name:'礼堂',node:'H2'}]},{id:'VB',name:'演示村 B',pickups:[{id:'PB1',name:'学校',node:'H3'}]}],scenario:{nodes:[{id:'H1'},{id:'H2'},{id:'H3'}],edges:[{from:'H1',to:'H2',open:true},{from:'H2',to:'H3',open:true}]}}});

test('unregistered Ruian street keeps the original name and ten people without invented coordinates',()=>{
  const text='玉海街道，新增 10 人',out=intake.parseText(text,context());
  assert.deepEqual(out.errors,[]);assert.equal(out.rows.length,1);
  const row=out.rows[0];assert.equal(row.people,10);assert.equal(row.villageName,'玉海街道');assert.equal(row.text,text);assert.equal(row.villageId,'');assert.equal(row.pickupId,'');assert.equal(row.longitude,undefined);
  assert.equal(row.assistancePeople,null);assert.equal(row.wheelchairPeople,null);
  const review=intake.reviewRows(out.rows,context());assert.deepEqual(review.errors,[]);assert.equal(review.readyPeople,0);assert.equal(review.pendingPeople,10);assert.match(review.rows[0].review.location.label,/待定位/);
});

test('missing place still produces an editable count row and only place review blocks saving',()=>{
  const out=intake.parseText('新增十人',context());assert.deepEqual(out.errors,[]);assert.equal(out.rows[0].people,10);assert.equal(out.rows[0].villageName,'');
  assert.match(out.warnings.join(''),/未提供所属地区/);assert.match(intake.reviewRows(out.rows,context()).errors.join(''),/名称不能为空/);
  const fixed=intake.updateRow(out.rows[0],'villageName','玉海街道',context());assert.deepEqual(intake.reviewRows([fixed],context()).errors,[]);assert.equal(fixed.people,10);
});

test('several unmatched areas keep their separate quantities and subcounts in lines and commas',()=>{
  for(const separator of ['；','\n','，']){
    const out=intake.parseText('玉海街道新增10人，其中2人需要协助'+separator+'莘塍街道新增5人，其中1人需要协助',context());
    assert.deepEqual(out.errors,[],separator);assert.deepEqual(out.rows.map(r=>[r.villageName,r.people,r.assistancePeople]),[['玉海街道',10,2],['莘塍街道',5,1]]);
  }
});

test('free text area and pickup context supports concise speech without claiming registered matches',()=>{
  const out=intake.parseText('新增六人',{...context(),villageName:'玉海街道',pickupName:'文化广场'});
  assert.deepEqual(out.errors,[]);assert.equal(out.rows[0].people,6);assert.equal(out.rows[0].villageName,'玉海街道');assert.equal(out.rows[0].pickupName,'文化广场');assert.equal(out.rows[0].pickupId,'');
});

test('explicit different area clears a free-text context pickup and count nouns never become village names',()=>{
  const out=intake.parseText('演示村 A 新增6人',{...context(),villageName:'玉海街道',pickupName:'文化广场'});
  assert.deepEqual(out.errors,[]);assert.equal(out.rows[0].villageId,'VA');assert.equal(out.rows[0].pickupName,'');
  const people=intake.parseText('新增10村民',context());assert.deepEqual(people.errors,[]);assert.equal(people.rows[0].people,10);assert.equal(people.rows[0].villageName,'');
});

test('spoken unregistered area cannot inherit an old selected area or pickup ID',()=>{
  const out=intake.parseText('玉海街道，新增十人',{...context(),villageId:'VA',pickupId:'PA1'});
  assert.deepEqual(out.errors,[]);assert.equal(out.rows[0].villageName,'玉海街道');assert.equal(out.rows[0].villageId,'');assert.equal(out.rows[0].pickupId,'');assert.equal(out.rows[0].pickupName,'');assert.match(out.warnings.join(''),/清空原接人点/);
});

test('an unknown spoken pickup becomes pending and never remains attached to an old selected pickup',()=>{
  const out=intake.parseText('演示村 A 新增六人，在学校门口集合',{...context(),villageId:'VA',pickupId:'PA1'});
  assert.deepEqual(out.errors,[]);assert.equal(out.rows[0].villageId,'VA');assert.equal(out.rows[0].pickupName,'学校门口');assert.equal(out.rows[0].pickupId,'');assert.match(out.warnings.join(''),/清空旧接人点/);
});

test('registered places and context retain actual IDs while ambiguous locations and invalid counts stay blocked',()=>{
  const out=intake.parseText('新增六人',{...context(),villageId:'VA',pickupId:'PA1'});assert.equal(out.rows[0].pickupId,'PA1');assert.equal(out.rows[0].villageName,'演示村 A');
  for(const text of ['演示村 A 和演示村 B 新增六人','玉海街道和莘塍街道新增六人','玉海街道新增0人','玉海街道新增501人','玉海街道新增-3人','玉海街道新增1.5人','玉海街道新增约10人','玉海街道新增六人其中七人需协助','玉海街道不要转移六人'])assert.ok(intake.parseText(text,context()).errors.length,text);
  const nearName=intake.parseText('演示村AA新增六人',context());assert.deepEqual(nearName.errors,[]);assert.equal(nearName.rows[0].villageId,'');assert.equal(nearName.rows[0].villageName,'演示村AA');
});

test('dropdown IDs show canonical names and keep same-name directory entries unambiguous during subsequent edits',()=>{
  const ctx=context();ctx.data.villages.push({id:'VC',name:'演示村 B',pickups:[{id:'PC1',name:'学校',node:'H2'},{id:'PC2',name:'学校',node:'H3'}]});
  const original=intake.parseText('玉海街道新增6人，无需协助，无轮椅，可分组',ctx).rows[0];
  const selected=intake.updateRow(original,'villageName','VC',ctx);assert.equal(selected.villageId,'VC');assert.equal(selected.villageName,'演示村 B');
  const located=intake.updateRow(selected,'pickupName','PC2',ctx);assert.equal(located.villageId,'VC');assert.equal(located.pickupId,'PC2');assert.equal(located.pickupName,'学校');assert.equal(intake.reviewRows([located],ctx).readyPeople,6);
  const edited=intake.updateRow(located,'people','7',ctx);assert.equal(edited.pickupId,'PC2');assert.deepEqual(intake.reviewRows([edited],ctx).errors,[]);
  const changed=intake.updateRow(located,'pickupName','学校门口',ctx);assert.equal(changed.villageId,'VC');assert.equal(changed.pickupId,'');assert.equal(intake.reviewRows([changed],ctx).pendingPeople,6);
});

test('reselecting the same dropdown IDs preserves verified point and coordinate anchors',()=>{
  const ctx=context(),row={villageId:'VA',villageName:'演示村 A',pickupId:'PA1',pickupName:'村委会集合点（演示）',locationNodeId:'H1',longitude:120.65,latitude:27.78,coordinateSystem:'WGS84',people:6,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'原始需求'};
  for(const [field,id] of [['villageName','VA'],['pickupName','PA1']]){
    const updated=intake.updateRow(row,field,id,ctx);
    for(const key of ['villageId','villageName','pickupId','pickupName','locationNodeId','longitude','latitude','coordinateSystem'])assert.equal(updated[key],row[key],field+' preserves '+key);
    assert.deepEqual(updated.editedFields,[]);
  }
  const moved=intake.updateRow(row,'pickupName','PA2',ctx);assert.equal(moved.pickupId,'PA2');assert.equal(moved.locationNodeId,null);assert.equal(moved.longitude,null);
  const relocated=intake.updateRow(row,'villageName','VB',ctx);assert.equal(relocated.villageId,'VB');assert.equal(relocated.pickupId,'');assert.equal(relocated.longitude,null);
});
