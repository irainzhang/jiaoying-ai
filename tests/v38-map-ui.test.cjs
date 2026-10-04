'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const M=require('../dist/transport-map.js'),X=require('../exercise.cjs'),G=require('../geo-scenario.cjs');
function harness(reduce=false){
  const frames=new Map(),markers=[],polylines=[],maps=[],elements=[],events={},calls={choose:[],route:[]};let next=1;
  class Element{constructor(){this.children=[];this.selectors={};this.events={};this.dataset={};this.hidden=false;this.isConnected=true;elements.push(this);}querySelector(key){return this.selectors[key]||(this.selectors[key]=new Element());}replaceChildren(child){this.children=[child];}append(child){this.children.push(child);}addEventListener(k,fn){(this.events[k]??=[]).push(fn);}setAttribute(k,v){this[k]=v;}emit(k,ev={}){for(const fn of this.events[k]||[])fn(ev);}}
  const layer=()=>({members:[],addTo(parent){parent.members?.push(this);return this;},clearLayers(){this.members=[];return this;}});
  const L={layerGroup:layer,divIcon:x=>x,polyline:(coords,opts)=>{const line={...layer(),coords,opts,bindPopup(){return this;}};polylines.push(line);return line;},marker:(coords,opts)=>{const marker={...layer(),coords,opts,moves:[],bindPopup(){return this;},bindTooltip(){return this;},setLatLng(p){this.coords=p;this.moves.push(p);return this;}};markers.push(marker);return marker;},map:()=>{const m={...layer(),events:{},getZoom:()=>13,hasLayer:()=>false,removeLayer(){},on(k,fn){this.events[k]=fn;},fitBounds(){},setView(){},invalidateSize(){},closePopup(){},scrollWheelZoom:{enable(){},disable(){}},attributionControl:{setPrefix(){},addAttribution(){}}};maps.push(m);return m;},control:{zoom:()=>({addTo(){}}),scale:()=>({addTo(){}})}};
  const document={hidden:false,createElement:()=>new Element(),addEventListener:(k,fn)=>events[k]=fn};
  const env={document,L,JiaoyingTransportMap:M,fetch:()=>new Promise(()=>{}),requestAnimationFrame:fn=>{const id=next++;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id),matchMedia:()=>({matches:reduce}),console};env.window=env;
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/real-map.js'),'utf8'),env);
  const d=G.apply(X.initial());d.activePlan={...X.solve(X.snapshot(d)).plan,id:'P1'};
  const container=new Element(),options={state:{data:d,session:'S'},routeChoice:'all',onChooseLocation:pick=>calls.choose.push(pick),onRouteChange:id=>calls.route.push(id)};
  env.RuianMap.mount(container,options);const root=container.children[0];
  return {api:env.RuianMap,d,root,maps,markers,polylines,frames,calls,options,document,events,tick(time){const batch=[...frames.values()];frames.clear();for(const fn of batch)fn(time);},play(){root.querySelector('[data-map-play]').emit('click');},clickMap(lng=120.643,lat=27.784){maps[0].events.click({latlng:{lng,lat}});}};
}
test('visual playback is pausable, moves only ghost markers, and never updates the transport ledger',()=>{
  const h=harness(),before=JSON.stringify(h.d);h.play();h.tick(0);h.tick(1000);
  const ghosts=h.markers.filter(m=>m.opts.icon.className==='geo-replay-vehicle');assert.equal(ghosts.length,3);assert.ok(ghosts.some(m=>m.moves.length===2));
  assert.equal(JSON.stringify(h.d),before);h.play();assert.equal(h.frames.size,0);assert.match(h.root.querySelector('.geo-play-note').textContent,/暂停/);
  h.api.suspend();assert.equal(h.root.querySelector('[data-map-stop]').disabled,true);assert.equal(JSON.stringify(h.d),before);
});
test('a new host revision stops and resets visual playback',()=>{
  const h=harness();h.play();h.tick(0);h.d.revision++;h.api.update({state:{data:h.d,session:'S'}});
  assert.equal(h.frames.size,0);assert.equal(h.root.querySelector('[data-map-stop]').disabled,true);assert.match(h.root.querySelector('.geo-play-note').textContent,/更新/);
});
test('ordinary map clicks cannot locate a demand; explicit pick mode only returns a candidate',()=>{
  const h=harness(),before=JSON.stringify(h.d);h.clickMap();assert.equal(h.calls.choose.length,0);
  h.api.update({pickLocation:true});h.clickMap();assert.equal(h.calls.choose.length,1);assert.ok(h.calls.choose[0].nodeId);assert.equal(h.calls.choose[0].longitude,120.643);assert.equal(JSON.stringify(h.d),before);
});
test('confirming or cancelling location selection removes both the candidate marker and stale confirmation text',()=>{
  const h=harness();h.api.update({pickLocation:true});h.clickMap();
  assert.match(h.root.querySelector('.geo-coordinate').textContent,/等待人工核对/);
  const candidateLayer=h.maps[0].members.find(layer=>layer.members?.some(marker=>marker.opts?.icon?.className==='geo-candidate-marker'));
  assert.ok(candidateLayer);assert.ok(candidateLayer.members.length>0);
  h.api.update({pickLocation:false});assert.equal(candidateLayer.members.length,0);assert.equal(h.root.querySelector('.geo-coordinate').textContent,'点击地图查看经纬度');
  h.clickMap();assert.match(h.root.querySelector('.geo-coordinate').textContent,/经度.*纬度.*WGS84/);assert.doesNotMatch(h.root.querySelector('.geo-coordinate').textContent,/候选|核对/);
});
test('leaving the map clears candidate text before reusing it on the execution view',()=>{
  const h=harness();h.api.update({pickLocation:true});h.clickMap();h.api.suspend();
  assert.equal(h.root.querySelector('.geo-coordinate').textContent,'点击地图查看经纬度');
  h.api.mount({replaceChildren(){}},{...h.options,pickLocation:false,plan:h.d.activePlan});
  assert.equal(h.root.querySelector('.geo-coordinate').textContent,'点击地图查看经纬度');
});
test('route controls are directly available in the real map and reduced motion leaves routes static',()=>{
  const h=harness(true);assert.match(h.root.querySelector('.geo-route-filter').innerHTML,/全部车辆/);
  const route={dataset:{mapRoute:'V1'}};h.root.emit('click',{target:{closest:selector=>selector==='[data-map-route]'?route:null}});assert.deepEqual(h.calls.route,['V1']);
  h.tick(0);h.play();assert.equal(h.markers.filter(m=>m.opts.icon.className==='geo-replay-vehicle').length,0);assert.match(h.root.querySelector('.geo-play-note').textContent,/减少动态/);
});
test('draft and published routes remain visually distinct, and collocated draft rows are counted together',()=>{
  const h=harness();h.polylines.length=0;h.markers.length=0;
  const p=h.d.villages[0].pickups[0],rows=[{villageId:h.d.villages[0].id,pickupId:p.id,people:2},{villageId:h.d.villages[0].id,pickupId:p.id,people:3}];
  h.api.update({plan:{...h.d.activePlan,id:'draft-next'},draftDemands:rows});
  assert.ok(h.polylines.some(line=>line.opts.dashArray===null&&line.opts.interactive===false));
  assert.ok(h.polylines.some(line=>line.opts.dashArray==='10 4'));
  const previews=h.markers.filter(m=>m.opts.icon.className==='geo-draft-demand');assert.equal(previews.length,1);assert.match(previews[0].opts.icon.html,/待导入 5 人/);
});
