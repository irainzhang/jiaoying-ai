'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const E=require('../exercise.cjs'),L=require('../intake-location.cjs'),I=require('../dist/command-intake.js');
const row=changes=>({villageName:'瑞安上传村',pickupName:'村文化礼堂门口',people:2,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'上传名单新增2人',...changes});
const intake=(x,rows)=>x.action('command-intake',{rows,source:'file'});
const geo=()=>{const x=E.create();x.action('enable-road-map');return x;};
const coords=x=>{const n=x.data.scenario.nodes.find(n=>n.id==='H1');return {longitude:n.longitude,latitude:n.latitude,coordinateSystem:'WGS84'};};
const unchanged=(x,fn,re)=>{const before=x.data;assert.throws(fn,re);assert.deepEqual(x.data,before);};

test('unknown uploaded village/pickup names are preserved; WGS84 coordinates parsed without guessing',()=>{
  const d=E.initial(),out=I.parseRows([['村庄','集合点','人数','经度','纬度','坐标系'],['瑞安真实村名','文化礼堂',2,120.64,27.785,'WGS84']],{data:d});
  assert.deepEqual(out.errors,[]);assert.equal(out.rows[0].villageName,'瑞安真实村名');assert.equal(out.rows[0].villageId,'');assert.equal(out.rows[0].pickupName,'文化礼堂');assert.equal(out.rows[0].longitude,120.64);
  assert.ok(I.parseRows([['村庄','人数','经度','纬度','坐标系'],['村一',1,120.64,27.785,'GCJ02']],{data:d}).errors.length);
  assert.ok(I.parseRows([['村庄','人数','经度','纬度'],['村一',1,120.64,'']],{data:d}).errors.length);
});

test('unknown names without coordinates enter an unlocated ledger and survive restore',()=>{
  const x=E.create(),before=x.data;intake(x,[row()]);const d=x.data,r=d.villageReports[0];
  assert.equal(d.villages.length,4);assert.equal(r.villageName,'瑞安上传村');assert.equal(r.pickupName,'村文化礼堂门口');assert.equal(r.locationStatus,'pending');assert.equal(r.locationNodeId,null);assert.equal(r.needsInfo,true);assert.deepEqual(r.householdIds,[]);
  assert.equal(d.scenario.nodes.length,before.scenario.nodes.length);assert.equal(E.metrics(d).people,17);assert.ok(d.plan.unassigned.some(h=>h.id==='BATCH-'+r.id));assert.equal(d.activePlan,null);
  assert.deepEqual(E.create(d).data.villageReports,d.villageReports);
});

test('WGS84 import on a diagram is rejected atomically with an explicit conversion instruction',()=>{
  const x=E.create();unchanged(x,()=>intake(x,[row(),row({villageName:'另一个村',longitude:120.64,latitude:27.785,coordinateSystem:'WGS84'})]),/启用瑞安道路地图/);
});

test('within-network coordinates associate existing road nodes and materialize traceable groups',()=>{
  const x=geo(),c=coords(x),nodes=x.data.scenario.nodes.length;intake(x,[row(c)]);const d=x.data,r=d.villageReports[0],p=d.villages.find(v=>v.id===r.villageId).pickups[0];
  assert.equal(r.locationStatus,'located');assert.ok(d.scenario.nodes.some(n=>n.id===r.locationNodeId));assert.equal(r.locationDistanceM,0);assert.equal(p.node,r.locationNodeId);assert.equal(d.scenario.nodes.length,nodes);
  assert.ok(r.householdIds.length);assert.ok(d.scenario.households.filter(h=>r.householdIds.includes(h.id)).every(h=>h.node===r.locationNodeId&&h.longitude===c.longitude));assert.deepEqual(E.validate(E.snapshot(d),d.plan),[]);assert.equal(E.metrics(d).people,17);
  assert.deepEqual(E.create(d).data.villageReports,d.villageReports);
});

test('coordinates outside the supplied network remain pending instead of making a route',()=>{
  const x=geo();intake(x,[row({longitude:120.9,latitude:27.9,coordinateSystem:'WGS84'})]);const r=x.data.villageReports[0];
  assert.equal(r.locationStatus,'pending');assert.match(r.locationReason,/范围外/);assert.equal(r.longitude,120.9);assert.deepEqual(r.householdIds,[]);assert.equal(E.metrics(x.data).people,17);
  assert.match(x.data.plan.unassigned.find(h=>h.batchId===r.id).reason,/范围外/);
  assert.deepEqual(E.create(x.data).data.villageReports,x.data.villageReports);
});

test('matching does not bridge more than 500 metres even inside broad coordinate bounds',()=>{
  const s={region:{mapKind:'osm-road-network',bounds:[120,27,122,29]},nodes:[{id:'N',longitude:120,latitude:27}],edges:[{from:'N',to:'D',open:true}]};
  const location=L.resolve(s,{longitude:121,latitude:28,coordinateSystem:'WGS84'});assert.equal(location.locationStatus,'pending');assert.match(location.locationReason,/500米/);
});

test('manual locating only fills a held batch and recalculates once without publishing',()=>{
  const x=geo();intake(x,[row()]);const r=x.data.villageReports[0],before=x.data;
  x.action('map-demand-locate',{id:r.id,nodeId:'H1'});const d=x.data,located=d.villageReports[0];
  assert.equal(d.revision,before.revision+1);assert.equal(d.planCounter,before.planCounter+1);assert.equal(located.locationNodeId,'H1');assert.equal(located.needsInfo,false);assert.ok(located.householdIds.length);assert.equal(located.locationHistory.length,1);assert.equal(E.metrics(d).people,17);assert.equal(d.activePlan,null);assert.deepEqual(E.create(d).data.villageReports,d.villageReports);
  unchanged(x,()=>x.action('map-demand-locate',{id:r.id,nodeId:'H2'}),/未生成执行人员组/);
});

test('manual locating preserves missing assistance facts instead of inventing zeros',()=>{
  const x=geo();intake(x,[row({assistancePeople:null})]);const id=x.data.villageReports[0].id;
  x.action('map-demand-locate',{id,nodeId:'H1'});assert.equal(x.data.villageReports[0].needsInfo,true);assert.equal(x.data.villageReports[0].assistancePeople,null);assert.deepEqual(x.data.villageReports[0].householdIds,[]);
});

test('explicit road conversion keeps all entered demand, groups and session, replacing only map basis',()=>{
  const x=E.create();intake(x,[row(),row({villageId:'VA',villageName:undefined,pickupId:'P-A1',people:3})]);const before=x.data;
  x.action('enable-road-map');const d=x.data;
  assert.equal(d.exerciseId,before.exerciseId);assert.equal(d.revision,before.revision+1);assert.equal(E.metrics(d).people,E.metrics(before).people);assert.deepEqual(d.stage,before.stage);assert.deepEqual(d.contacts,before.contacts);assert.deepEqual(d.villageReports.map(r=>[r.id,r.people,r.householdIds]),before.villageReports.map(r=>[r.id,r.people,r.householdIds]));assert.equal(d.scenario.region.mapKind,'osm-road-network');assert.deepEqual(E.create(d).data.villageReports,d.villageReports);
});

test('road conversion refuses published or unmappable road incidents without resetting state',()=>{
  const x=E.create();x.action('generate');x.action('confirm');unchanged(x,()=>x.action('enable-road-map'),/已有发布或执行进度/);
  const y=E.create();y.action('scenario',{id:'road-closure'});unchanged(y,()=>y.action('enable-road-map'),/道路变化/);
});

test('restoration rejects forged dynamic coordinates, nodes and duplicated directory IDs',()=>{
  const x=geo();intake(x,[row(coords(x))]);const d=x.data;
  const uploaded=d=>d.villages.find(v=>v.imported&&v.name==='瑞安上传村');
  for(const mutate of [d=>{uploaded(d).pickups[0].node='unknown';},d=>{uploaded(d).id=d.villages[0].id;},d=>{uploaded(d).pickups[0].longitude=121;},d=>{d.villageReports[0].locationNodeId='H2';}]){const bad=JSON.parse(JSON.stringify(d));mutate(bad);assert.throws(()=>E.create(bad));}
});

test('partial plans may be manually confirmed with an automatic traceable note; version guards remain',()=>{
  const x=E.create();intake(x,[row()]);assert.equal(x.data.plan.complete,false);x.action('confirm');assert.match(x.data.activePlan.note,/人工确认.*待协调清单/);assert.equal(x.data.activePlan.complete,false);
  x.action('contact',{ids:x.data.activePlan.servedIds});x.action('start');x.action('step',{vehicleId:'V1'});assert.throws(()=>x.action('confirm'),/依据已变化/);
});

test('weather numeric control preserves one-hour simulated units and only recalculates at level changes',()=>{
  const x=E.create();x.action('generate');const p=x.data.planCounter,roads=x.data.scenario.edges;
  x.action('weather',{rainfall:30});assert.equal(x.data.planCounter,p);assert.equal(x.data.weather.level,1);
  x.action('weather',{rainfall:50});assert.equal(x.data.planCounter,p+1);assert.equal(x.data.weather.level,2);
  x.action('weather',{rainfall:80});assert.equal(x.data.planCounter,p+2);assert.equal(x.data.weather.level,3);assert.equal(x.data.weather.sourceMode,'simulation');assert.match(x.data.weather.window,/最近1小时/);assert.deepEqual(x.data.scenario.edges,roads);assert.equal(x.data.activePlan,null);
  unchanged(x,()=>x.action('weather',{rainfall:301}),/整数/);
});

test('a known pickup cannot silently swallow a conflicting manually selected node',()=>{
  const x=geo();
  unchanged(x,()=>intake(x,[row({villageId:'VA',pickupId:'P-A1',locationNodeId:'H2'})]),/清空集合点编号/);
  const n=x.data.scenario.nodes.find(n=>n.id==='H2');
  unchanged(x,()=>intake(x,[row({villageId:'VA',pickupId:'P-A1',longitude:n.longitude,latitude:n.latitude,coordinateSystem:'WGS84'})]),/坐标与已登记接人点不一致/);
  intake(x,[row({villageId:'VA',pickupId:'',pickupName:'本次新接人位置',locationNodeId:'H2'})]);
  assert.equal(x.data.villageReports[0].locationNodeId,'H2');
  assert.notEqual(x.data.villageReports[0].pickupId,'P-A1');
  assert.equal(x.data.villages[0].pickups.find(p=>p.id==='P-A1').node,'H1');
});

test('locating an exclusive placeholder preserves its name and permits a later upload to reuse the known point',()=>{
  const x=geo();intake(x,[row()]);const original=x.data.villageReports[0];
  x.action('map-demand-locate',{id:original.id,nodeId:'H1'});
  const located=x.data.villageReports[0],village=x.data.villages.find(v=>v.id===located.villageId);
  assert.equal(located.pickupId,original.pickupId);assert.equal(located.pickupName,original.pickupName);assert.equal(village.pickups.length,1);
  const parsed=I.parseRows([['村庄','集合点','人数','需协助人数','轮椅人数','同行关系'],[original.villageName,original.pickupName,3,0,0,'可拆分']],{data:x.data});
  assert.deepEqual(parsed.errors,[]);assert.equal(parsed.rows[0].pickupId,located.pickupId);
  intake(x,parsed.rows);const next=x.data.villageReports[0];
  assert.equal(next.locationNodeId,'H1');assert.equal(next.needsInfo,false);assert.equal(E.metrics(x.data).people,20);
  assert.equal(x.data.villages.find(v=>v.id===located.villageId).pickups.length,1);
  assert.deepEqual(E.create(x.data).data.villageReports,x.data.villageReports);
});

test('locating a shared placeholder changes only the confirmed batch and creates no ambiguous duplicate name',()=>{
  const x=geo();intake(x,[row(),row({people:3,text:'另一批新增3人'})]);
  const before=x.data,first=before.villageReports.find(r=>r.people===2),other=before.villageReports.find(r=>r.people===3);
  assert.equal(first.pickupId,other.pickupId);
  x.action('map-demand-locate',{id:first.id,nodeId:'H1'});
  const d=x.data,located=d.villageReports.find(r=>r.id===first.id),pending=d.villageReports.find(r=>r.id===other.id);
  assert.deepEqual(pending,other);assert.equal(pending.locationStatus,'pending');assert.notEqual(located.pickupId,other.pickupId);assert.match(located.pickupName,/定位 VR/);
  const village=d.villages.find(v=>v.id===first.villageId);assert.equal(new Set(village.pickups.map(p=>p.name)).size,village.pickups.length);
  const known=I.parseRows([['村庄','集合点','人数'],[located.villageName,located.pickupName,1]],{data:d});assert.deepEqual(known.errors,[]);assert.equal(known.rows[0].pickupId,located.pickupId);
  const unresolved=I.parseRows([['村庄','集合点','人数'],[other.villageName,other.pickupName,1]],{data:d});assert.deepEqual(unresolved.errors,[]);assert.equal(unresolved.rows[0].pickupId,other.pickupId);
  assert.equal(E.metrics(d).people,20);assert.deepEqual(E.create(d).data.villageReports,d.villageReports);
});
