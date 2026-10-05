'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../dist/task-workbench.js'),E=require('../exercise.cjs');
const nodes=['D','S1'];
const staff=()=>[{id:'W001',role:'driver',available:true},{id:'W002',role:'escort',available:true},{id:'W003',role:'reserve',available:true}];
const vehicle=()=>({id:'V1',name:'接送车',model:'演练中型客车',vehicleType:'minibus',totalCapacity:'10',wheelchairSlots:'2',driverId:'W001',escortIds:['W002'],notes:'核对轮椅固定装置',start:'D',available:true});
const input=()=>({resourceRegistryVersion:1,staff:staff(),vehicles:[vehicle()],shelters:[{id:'S1',name:'接收点',nodeId:'S1',capacity:'30',available:true}]});
const validate=x=>W.validateRegistryInput(x,{nodes});

test('registry submission deducts workers and retains model, capabilities and identifiers',()=>{
  const x=validate(input());assert.equal(x.resourceRegistryVersion,1);assert.equal(x.vehicles[0].capacity,8);assert.equal(x.vehicles[0].totalCapacity,10);assert.equal(x.vehicles[0].wheelchairSlots,2);assert.equal(x.vehicles[0].wheelchair,true);assert.deepEqual(x.vehicles[0].escortIds,['W002']);assert.equal(x.vehicles[0].model,'演练中型客车');
});
test('workers cannot be double assigned or silently used in a different role',()=>{
  const x=input();x.vehicles.push({...vehicle(),id:'V2'});assert.throws(()=>validate(x),/不能重复编组/);x.vehicles.pop();x.vehicles[0].driverId='W003';assert.throws(()=>validate(x),/角色/);x.vehicles[0].driverId='UNKNOWN';assert.throws(()=>validate(x),/尚未登记/);
});
test('unavailable and missing drivers stay registered for shortage reporting, never invented',()=>{
  const x=input();x.staff[0].available=false;assert.equal(validate(x).staff[0].available,false);x.vehicles[0].driverId='';assert.equal(validate(x).vehicles[0].driverId,'');
});
test('blank, fractional or overlarge total capacity and impossible wheelchair layouts are rejected',()=>{
  for(const value of ['', ' ', '0', '-1','2.5','503','Infinity']){const x=input();x.vehicles[0].totalCapacity=value;assert.throws(()=>validate(x),/总核载|容量/);}const x=input();x.vehicles[0].wheelchairSlots='9';assert.throws(()=>validate(x),/轮椅位不能超过/);x.vehicles[0].wheelchairSlots='1.5';assert.throws(()=>validate(x),/轮椅位/);
});
test('new vehicle id can stay blank for server assignment but model must be explicit',()=>{
  const x=input();x.vehicles[0].id='';assert.equal(validate(x).vehicles[0].id,'');x.vehicles[0].model='';assert.throws(()=>validate(x),/型号/);
});
test('staff CSV supports both role names and codes and rejects partial invalid imports atomically',()=>{
  const current=staff(),copy=JSON.stringify(current);const added=W.parseStaffCSV('编号,岗位,可用\nW010,司机,1\nW011,escort,0\nW012,机动人员,1',{existing:current});assert.deepEqual(added,[{id:'W010',role:'driver',available:true},{id:'W011',role:'escort',available:false},{id:'W012',role:'reserve',available:true}]);for(const csv of ['W001,driver,1','W020,doctor,1','W021,driver,yes','W022,driver,1\nW022,escort,1'])assert.throws(()=>W.parseStaffCSV(csv,{existing:current}));assert.equal(JSON.stringify(current),copy);
});
test('suggestion operates only on a draft and never assigns standby roles as drivers',()=>{
  const x=input();x.vehicles[0].driverId='';x.vehicles[0].escortIds=[];const before=JSON.stringify(x),suggested=W.suggestCrew(x);assert.equal(suggested.vehicles[0].driverId,'W001');assert.deepEqual(suggested.vehicles[0].escortIds,['W002']);assert.equal(suggested.vehicles[0].capacity,8);assert.equal(JSON.stringify(x),before);x.staff[0].available=false;const shortage=W.suggestCrew(x);assert.equal(shortage.vehicles[0].driverId,'');assert.match(shortage.issues.join(' '),/缺少.*司机/);
});
test('registry form separates people, vehicle cards and secondary shelters without a wide table',()=>{
  const data=E.createBlank();const html=W.resourceForm({data});assert.match(html,/01 工作人员/);assert.match(html,/02 车辆与编组/);assert.match(html,/03 安置接收点/);assert.match(html,/data-resource-version="1"/);assert.doesNotMatch(html,/<table/);assert.match(html,/旧登记的可接人数/);assert.match(html,/不会自动把旧人数当作总核载/);assert.match(html,/保存资源并重新计算/);
});
test('readonly registry has disabled fields and no save or demo seed action',()=>{
  const html=W.resourceForm({data:E.createBlank()},{readonly:true});assert.match(html,/data-readonly="true"/);assert.match(html,/<fieldset class="registry-fields" disabled/);assert.doesNotMatch(html,/type="submit"/);assert.doesNotMatch(html,/id="resource-seed"/);assert.match(html,/当前为查看模式/);
});
test('new inputs and personnel identifiers are escaped when rendering',()=>{
  const data=E.createBlank();data.scenario.vehicles[0]={...data.scenario.vehicles[0],...vehicle(),model:'x" autofocus="x',notes:'<img src=x onerror=alert(1)>'};data.scenario.staff=[{id:'bad" onclick="x',role:'driver',available:true}];const html=W.resourceForm({data});assert.match(html,/x&quot; autofocus=&quot;x/);assert.match(html,/&lt;img/);assert.doesNotMatch(html,/<img src=x/);assert.doesNotMatch(html,/value="bad" onclick=/);
});
test('reading the live registry form produces server-compatible fields instead of stale legacy capacity',()=>{
  const x=input(),controls={name:{value:x.vehicles[0].name},model:{value:x.vehicles[0].model},type:{value:'accessible'},totalCapacity:{value:'9'},wheelchairSlots:{value:'2'},driverId:{value:'W001'},notes:{value:'固定装置待核'},node:{value:'D'},available:{checked:true}};
  const vr={dataset:{resourceKind:'vehicle',resourceId:'V1'},querySelector:s=>controls[s.match(/field="([^"]+)"/)[1]],querySelectorAll:()=>[{value:'W002'}]};
  const sh={name:{value:'接收点'},capacity:{value:'30'},node:{value:'S1'},available:{checked:true}},sr={dataset:{resourceKind:'shelter',resourceId:'S1'},querySelector:s=>sh[s.match(/field="([^"]+)"/)[1]]};
  const people=x.staff.map(v=>({querySelector:s=>{const key=s.match(/field="([^"]+)"/)[1];return key==='available'?{checked:v[key]}:{value:v[key]};}}));
  const container={querySelector:()=>({dataset:{resourceVersion:'1',resourceNodes:JSON.stringify(nodes)}}),querySelectorAll:s=>s==='[data-staff-row]'?people:[vr,sr]};
  const payload=W.readResources(container);assert.equal(payload.resourceRegistryVersion,1);assert.equal(payload.vehicles[0].vehicleType,'accessible');assert.equal(payload.vehicles[0].totalCapacity,9);assert.equal(payload.vehicles[0].capacity,7);assert.deepEqual(payload.vehicles[0].escortIds,['W002']);assert.deepEqual(payload.staff,x.staff);assert.equal(payload.shelters[0].capacity,30);
});
