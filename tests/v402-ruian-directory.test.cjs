'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const X=require('../exercise.cjs'),V=require('../village-ledger.cjs'),L=require('../intake-location.cjs'),D=require('../ruian-directory.cjs');
const T=require('../lifecycle.cjs');
const source=require('../dist/assets/maps/ruian-places.json');
const clone=x=>JSON.parse(JSON.stringify(x));
const byName=(d,name)=>d.villages.find(v=>v.name===name);
const roadPoints=d=>d.villages.find(v=>v.kind==='road-group').pickups;
const demand=(v,p,people=2)=>({villageId:v.id,pickupId:p.id,people,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'人工选择公开道路候选，新增 '+people+' 人'});
function withoutDirectory(d){
  d.villages=d.villages.filter(v=>!v.catalogSource);delete d.placeDirectory;
  for(const v of d.villages){delete v.legacyDemo;for(const p of v.pickups)delete p.legacyDemo;}
  return d;
}

test('real-road blank tasks expose source-backed Ruian districts without adding demand or fake administrative coordinates',()=>{
  const d=X.createBlank();assert.equal(X.metrics(d).people,0);assert.equal(d.scenario.households.length,0);
  const real=d.villages.filter(v=>v.catalogSource===D.SOURCE);assert.equal(real.length,source.districts.length);
  const yu=byName(d,'玉海街道');assert.ok(yu);assert.equal(yu.imported,undefined);assert.deepEqual(yu.pickups,[]);assert.ok(yu.sourceUrl.startsWith('https://'));
  assert.ok(real.some(v=>v.kind==='community'));assert.ok(d.villages.filter(v=>/^V[ABC]$/.test(v.id)).every(v=>v.legacyDemo));assert.equal(L.validateCatalog(d),true);
  const diagram=X.initial();assert.equal(diagram.villages.length,3);assert.equal(diagram.placeDirectory,undefined);
});

test('public road candidates retain exact source coordinates, existing nodes and explicit non-official use',()=>{
  const d=X.createBlank();assert.equal(roadPoints(d).length,source.sharedPickups.length);
  for(const p of roadPoints(d)){
    const raw=source.sharedPickups.find(raw=>raw.id===p.id),node=d.scenario.nodes.find(n=>n.id===p.node);
    assert.equal(p.longitude,raw.longitude);assert.equal(p.latitude,raw.latitude);assert.equal(p.node,raw.nodeId);
    assert.equal(p.locationDistanceM,L.distance(p,node));assert.equal(p.synthetic,false);assert.equal(p.purposeSynthetic,true);assert.equal(p.officialAssemblyPoint,false);
    assert.match(p.locationReason,/演练候选/);assert.equal(p.administrativeRelation,'unverified');
  }
});

test('legacy published road tasks gain a directory without changing any live task or point facts',()=>{
  const x=X.create();x.action('enable-road-map');x.action('generate');x.action('confirm');
  const before=withoutDirectory(clone(x.data)),oldVillages=clone(before.villages),upgraded=X.create(before).data;
  for(const key of ['exerciseId','revision','scenario','stage','contacts','fleet','occupancy','activePlan','plan','planSnapshot','villageReports','history'])assert.deepEqual(upgraded[key],before[key],key);
  for(const old of oldVillages){const found=upgraded.villages.find(v=>v.id===old.id);for(const p of old.pickups){const retained=clone(found.pickups.find(x=>x.id===p.id));delete retained.legacyDemo;assert.deepEqual(retained,p);}}
  assert.ok(byName(upgraded,'玉海街道'));const twice=X.create(upgraded).data;assert.deepEqual(twice,upgraded);
});

test('upgrading a previously uploaded matching area preserves its ID, custom point and recorded batch',()=>{
  const d=withoutDirectory(X.createBlank());
  const fields=L.prepareRow(d,{villageName:'玉海街道',pickupName:'上传的文化礼堂'}),saved=clone(d.villages.find(v=>v.id===fields.villageId));
  V.ensure(d);const all=d.villages.filter(v=>v.name==='玉海街道');assert.equal(all.length,1);assert.equal(all[0].id,saved.id);assert.equal(all[0].imported,true);assert.deepEqual(all[0].pickups,saved.pickups);assert.equal(all[0].catalogSource,D.SOURCE);assert.equal(L.validateCatalog(d),true);
});

test('street-only requests stay pending until a concrete pickup is chosen',()=>{
  const x=X.create(X.createBlank()),v=byName(x.data,'玉海街道');
  x.action('command-intake',{rows:[{...demand(v,{id:''},10),pickupId:null}],source:'text'});
  const r=x.data.villageReports[0];assert.equal(r.people,10);assert.equal(r.locationStatus,'pending');assert.equal(r.locationNodeId,null);assert.deepEqual(r.householdIds,[]);assert.equal(X.metrics(x.data).people,10);assert.equal(x.data.plan.servedPeople,0);assert.equal(x.data.plan.unassigned[0].people,10);
});

test('selecting a shared real-road candidate gives each area its own traceable point and conserves demand',()=>{
  const x=X.create(X.createBlank()),base=x.data,p=roadPoints(base)[0],yu=byName(base,'玉海街道'),anyang=byName(base,'安阳街道');
  x.action('command-intake',{rows:[{...demand(yu,p,2),longitude:p.longitude,latitude:p.latitude,coordinateSystem:'WGS84'},demand(anyang,p,3)],source:'text'});
  const d=x.data,reports=d.villageReports;assert.equal(X.metrics(d).people,5);assert.equal(d.plan.totalPeople,5);assert.deepEqual(X.validate(X.snapshot(d),d.plan),[]);
  assert.equal(new Set(reports.map(r=>r.pickupId)).size,2);assert.ok(reports.every(r=>r.pickupId!==p.id&&r.locationNodeId===p.node&&r.locationStatus==='located'));
  for(const name of ['玉海街道','安阳街道']){const copy=byName(d,name).pickups[0];assert.equal(copy.publicPlaceId,p.id);assert.equal(copy.publicPlaceSource,D.SOURCE);assert.equal(copy.administrativeRelation,'user-selected-unverified');assert.equal(copy.sourceUrl,p.sourceUrl);assert.equal(copy.longitude,p.longitude);}
  assert.deepEqual(roadPoints(d),roadPoints(base));assert.deepEqual(X.create(d).data.villageReports,reports);
  x.action('command-intake',{rows:[demand(yu,p,4)],source:'text'});assert.equal(byName(x.data,'玉海街道').pickups.length,1);assert.equal(X.metrics(x.data).people,9);
});

test('catalog selection cannot silently swallow conflicting coordinates or unrelated pickup IDs',()=>{
  const x=X.create(X.createBlank()),d=x.data,v=byName(d,'玉海街道'),p=roadPoints(d)[0],other=roadPoints(d)[1];
  const before=x.data;assert.throws(()=>x.action('command-intake',{rows:[{...demand(v,p),longitude:other.longitude,latitude:other.latitude,coordinateSystem:'WGS84'}],source:'text'}),/坐标与已登记接人点不一致/);assert.deepEqual(x.data,before);
  assert.throws(()=>L.prepareRow(clone(d),demand(v,{id:'P-A1'})),/接人点必须属于/);
});

test('restoration rejects forged public names, coordinates, associations and source markers',()=>{
  const original=X.createBlank();
  const changes=[d=>{byName(d,'玉海街道').name='假街道';},d=>{roadPoints(d)[0].longitude+=0.0001;},d=>{roadPoints(d)[0].sourceUrl='https://example.com/fake';},d=>{delete byName(d,'玉海街道').catalogSource;},d=>{d.villages.push({id:'FAKE-AREA',name:'假的空目录',township:'瑞安',catalogSource:D.SOURCE,pickups:[]});}];
  for(const edit of changes){const d=clone(original);edit(d);assert.throws(()=>X.create(d));}
  const d=clone(original),v=byName(d,'玉海街道'),row=L.prepareRow(d,demand(v,roadPoints(d)[0]));v.pickups.find(p=>p.id===row.pickupId).administrativeRelation='verified';assert.throws(()=>L.validateCatalog(d),/行政归属/);
});

test('road closures do not move public catalog coordinates or rewrite a live selection',()=>{
  const d=X.createBlank(),before=clone(d.villages),p=roadPoints(d)[0];
  for(const edge of d.scenario.edges)if(edge.from===p.node||edge.to===p.node)edge.open=false;
  V.ensure(d);assert.deepEqual(d.villages,before);
});

test('explicit diagram conversion keeps existing counts and adds real choices without replacing old IDs',()=>{
  const x=X.create();const before=x.data;x.action('enable-road-map');const d=x.data;
  assert.equal(X.metrics(d).people,X.metrics(before).people);assert.deepEqual(d.stage,before.stage);assert.equal(d.villages.find(v=>v.id==='VA').pickups[0].id,'P-A1');assert.ok(byName(d,'玉海街道'));assert.deepEqual(X.create(d).data.villageReports,d.villageReports);
});

test('restoring an already archived pre-directory road backup compares the same upgraded catalog and keeps fact checks',()=>{
  const old=withoutDirectory(X.createBlank());T.close(old,{mode:'stopped'});
  const current=X.createBlank();current.taskArchives=[T.archive(old)];
  const x=X.create(current);x.action('restore',{data:old});assert.equal(x.data.exerciseId,old.exerciseId);assert.equal(x.data.taskLifecycle.status,'stopped');assert.equal(X.metrics(x.data).people,0);assert.ok(byName(x.data,'玉海街道'));
  const tampered=clone(old);tampered.taskLifecycle.note='改写历史说明';
  const y=X.create(current);assert.throws(()=>y.action('restore',{data:tampered}),/历史任务备份与已保留事实不一致/);
});

test('a full old user directory can upgrade without losing records or exceeding the revised catalog-only allowance',()=>{
  const old=withoutDirectory(X.createBlank());let point=0;
  for(let i=0;i<500;i++)old.villages.push({id:'VI'+i,name:'用户地区 '+i,township:'待核对',imported:true,synthetic:false,pickups:[]});
  for(let i=6;i<1000;i++)old.villages[3+(i-6)%500].pickups.push({id:'PI'+point++,name:'用户位置 '+i,node:null,imported:true,locationStatus:'pending',locationNodeId:null});
  assert.equal(old.villages.length,503);assert.equal(old.villages.flatMap(v=>v.pickups).length,1000);
  const d=X.create(old).data;assert.equal(d.villages.length,503+D.CATALOG_DISTRICTS);assert.equal(d.villages.flatMap(v=>v.pickups).length,1000+D.CATALOG_PICKUPS);assert.equal(d.villages.filter(v=>v.imported).length,500);assert.equal(X.metrics(d).people,0);
});
