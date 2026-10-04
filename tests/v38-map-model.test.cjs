'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../dist/transport-map.js');
const X=require('../exercise.cjs'),G=require('../geo-scenario.cjs');
function scenario(){return {nodes:[{id:'A',longitude:120,latitude:28},{id:'B',longitude:120.001,latitude:28},{id:'C',longitude:120.001,latitude:28.001}],edges:[{id:'AB',from:'A',to:'B',open:true,directed:false,minutes:1,geometry:[[120,28],[120.0004,28.0002],[120.001,28]]},{id:'BC',from:'B',to:'C',open:true,directed:true,minutes:1,geometry:[[120.001,28],[120.001,28.001]]}],households:[],vehicles:[{id:'V1',name:'车 1',available:true,color:'#123456'}],shelters:[{id:'C',available:true}]};}
test('playback follows every bend of source roads and respects reverse and one-way travel',()=>{
  const s=scenario(),path=M.routeGeometry(s,{segments:[{from:'A',to:'C',nodes:['A','B','C'],edges:['AB','BC'],minutes:2}]});
  assert.equal(path.ok,true);assert.deepEqual(path.points,[[120,28],[120.0004,28.0002],[120.001,28],[120.001,28.001]]);
  assert.deepEqual(M.positionAt(path,0),[120,28]);assert.deepEqual(M.positionAt(path,1),[120.001,28.001]);
  const reverse=M.routeGeometry(s,{segments:[{nodes:['B','A'],edges:['AB']}]});assert.equal(reverse.ok,true);assert.deepEqual(reverse.points[0],[120.001,28]);
  assert.equal(M.routeGeometry(s,{segments:[{nodes:['C','B'],edges:['BC']}]}).ok,false);
  s.edges[0].open=false;assert.match(M.routeGeometry(s,{segments:[{nodes:['A','B'],edges:['AB']}]}).reason,/封闭/);
});
test('malformed or discontinuous geometry cannot draw an invented shortcut',()=>{
  const s=scenario();
  assert.equal(M.routeGeometry(s,{segments:[{nodes:['A','B'],edges:['AB','BC']}]}).ok,false);
  s.edges[0].geometry[0]=[120.05,28];assert.match(M.routeGeometry(s,{segments:[{nodes:['A','B'],edges:['AB']}]}).reason,/端点/);
  assert.equal(M.positionAt({ok:false},.5),null);
});
test('nearest pick returns the original point separately from the open-road anchor and never mutates the graph',()=>{
  const s=scenario(),before=JSON.stringify(s);s.edges[1].open=false;
  const result=M.nearest(s.nodes,120.001,28.0009,s.edges);assert.equal(result.nodeId,'B');assert.equal(result.latitude,28.0009);assert.equal(result.nodeLatitude,28);assert.ok(result.distanceMeters>90);
  s.edges[1].open=true;assert.equal(JSON.stringify(s),before);assert.equal(M.nearest(s.nodes,null,28,s.edges),null);
});
test('counts are located at actual receipt nodes; unknown demands remain visible without double counting',()=>{
  const d={scenario:scenario(),stage:{h1:'waiting',h2:'boarded',h3:'arrived',h4:'verified',old:'superseded'},fleet:{V1:{node:'C',onboard:['h2'],delivered:['h3','h4']}},villages:[{id:'V',pickups:[{id:'P',node:'A',locationStatus:'located',longitude:120,latitude:28}]}],villageReports:[{id:'R',status:'accepted',mode:'increment',intakeSource:'file',people:2,villageId:'V',pickupId:'P',householdIds:['h1']},{id:'U',status:'accepted',mode:'increment',locationStatus:'pending',people:5,villageName:'待匹配村',householdIds:[]},{id:'W',status:'pending',mode:'increment',people:3,villageId:'V',pickupId:'P',householdIds:[]},{id:'snapshot',mode:'snapshot',status:'accepted',people:50,householdIds:[]}]};
  d.scenario.households=[{id:'h1',node:'A',people:2,sourceBatchId:'R'},{id:'h2',node:'A',people:3},{id:'h3',node:'B',people:4},{id:'h4',node:'A',people:1},{id:'old',node:'A',people:8}];
  const before=JSON.stringify(d),out=M.aggregate(d);
  assert.equal(out.nodes.A.waiting,2);assert.equal(out.nodes.A.pending,3);assert.equal(out.nodes.A.uploaded,2);assert.equal(out.nodes.C.boarded,3);assert.equal(out.nodes.C.arrived,4);assert.equal(out.nodes.C.verified,1);
  assert.equal(out.unknownPeople,5);assert.equal(out.unknown[0].batchId,'U');assert.equal(JSON.stringify(d),before);
});
test('unsubmitted file rows are only preview points and unresolved coordinates never claim a road anchor',()=>{
  const d={scenario:scenario(),villages:[{id:'V',pickups:[{id:'P',node:'A'}]}]};
  const out=M.draftPoints(d,[{villageId:'V',pickupId:'P',people:2},{longitude:120.01,latitude:28.01,people:3,locationStatus:'pending'},{villageName:'未知村',people:4}]);
  assert.equal(out.points.length,2);assert.equal(out.points[0].nodeId,'A');assert.equal(out.points[1].nodeId,null);assert.equal(out.points[1].latitude,28.01);assert.equal(out.unknown[0].people,4);
  assert.deepEqual(M.aggregate(d).nodes,{});
});
test('playback uses only published, remaining routes and reads frozen real exercise data without writes',()=>{
  const d=G.apply(X.initial());d.activePlan={...X.solve(X.snapshot(d)).plan,id:'published'};
  function freeze(value){if(value&&typeof value==='object'){Object.values(value).forEach(freeze);Object.freeze(value);}return value;}
  const before=JSON.stringify(d),out=M.playbackRoutes(freeze(JSON.parse(before)));assert.equal(out.routes.length,3);assert.equal(out.skipped.length,0);assert.equal(JSON.stringify(d),before);
  for(const item of out.routes){assert.ok(item.path.points.length>2);assert.ok(M.positionAt(item.path,.35));}
  const route=d.activePlan.routes[0],stop=route.stops[0];d.stage[stop.id]='boarded';d.fleet[route.vehicleId].node=stop.node;d.fleet[route.vehicleId].onboard=[stop.id];
  const remaining=M.playbackRoutes(d,route.vehicleId);assert.equal(remaining.routes.length,1);
  const node=d.scenario.nodes.find(n=>n.id===stop.node);assert.deepEqual(remaining.routes[0].path.points[0],[node.longitude,node.latitude]);
  const edgeId=route.segments.at(-1).edges[0];d.scenario.edges.find(e=>e.id===edgeId).open=false;assert.equal(M.playbackRoutes(d,route.vehicleId).routes.length,0);
  d.activePlan=null;assert.equal(M.playbackRoutes(d).routes.length,0);
});
