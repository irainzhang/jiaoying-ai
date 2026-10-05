'use strict';
// Public place names are a directory, never evidence of a safe pickup site.
// Only the real-road scenario receives this catalog. Existing live records stay put.
const data=require('./dist/assets/maps/ruian-places.json');
const SOURCE='ruian-places-v1';
const clone=value=>JSON.parse(JSON.stringify(value));
const norm=value=>String(value||'').normalize('NFKC').replace(/\s+/g,'').toUpperCase();
const assert=(condition,message)=>{if(!condition)throw new Error(message);};
const districts=()=>data.districts||[];
const places=()=>districts().flatMap(d=>(d.pickups||[]).map(p=>({...p,districtId:d.id})));
const sourceUrl=p=>p.sourceUrl||p.sourceUrls?.[0]||'';
const isRoads=d=>d.scenario?.region?.mapKind==='osm-road-network';
function districtFor(v){return districts().find(row=>row.id===(v.catalogDistrictId||v.id));}
function isDistrict(v){const original=districtFor(v);return v.catalogSource===SOURCE&&Boolean(original)&&norm(v.name)===norm(original.name);}
function isPickup(p){return p.catalogSource===SOURCE&&places().some(row=>row.id===p.id);}
function sharedPickup(d,id){
  if(!isRoads(d))return null;
  for(const village of d.villages||[])if(village.catalogSource===SOURCE&&village.kind==='road-group'){
    const point=village.pickups.find(p=>p.id===id&&p.catalogSource===SOURCE);if(point)return point;
  }
  return null;
}
function validate(d){
  const canonicalDistricts=new Set(districts().map(v=>v.id)),canonicalPickups=new Map(places().map(p=>[p.id,p]));
  for(const v of d.villages||[]){
    if(canonicalDistricts.has(v.id)||v.catalogSource!==undefined||v.catalogDistrictId!==undefined){
      assert(isRoads(d)&&isDistrict(v),'瑞安公开地区目录标记或名称与来源不一致');
      const original=districtFor(v);
      assert(v.id===original.id||v.imported===true,'瑞安公开地区目录编号无效');
      assert(v.sourceUrl===sourceUrl(original),'瑞安公开地区目录来源不一致');
    }
    for(const p of v.pickups||[]){
      if(p.publicPlaceSource!==undefined||p.publicPlaceId!==undefined){
        const original=canonicalPickups.get(p.publicPlaceId);
        assert(isRoads(d)&&p.imported===true&&p.publicPlaceSource===SOURCE&&original&&p.administrativeRelation==='user-selected-unverified','人工选用公开道路候选的来源或行政归属标记无效');
        assert(p.name===original.name&&p.longitude===original.longitude&&p.latitude===original.latitude&&p.sourceUrl===sourceUrl(original),'人工选用公开道路候选的位置与来源不一致');
        if(original.nodeId)assert(p.node===original.nodeId&&p.locationNodeId===original.nodeId,'人工选用公开道路候选的路网节点不一致');
      }
      if(!canonicalPickups.has(p.id)&&p.catalogSource===undefined)continue;
      const original=canonicalPickups.get(p.id);
      assert(isRoads(d)&&original&&p.catalogSource===SOURCE&&v.catalogDistrictId===original.districtId,'瑞安公开接人候选目录关联无效');
      assert(p.name===original.name&&p.longitude===original.longitude&&p.latitude===original.latitude&&p.coordinateSystem==='WGS84'&&p.sourceUrl===sourceUrl(original),'瑞安公开接人候选与来源不一致；请另建接人点保留人工修改');
      if(original.nodeId)assert(p.node===original.nodeId&&p.locationNodeId===original.nodeId,'瑞安公开接人候选道路节点与来源不一致');
    }
  }
  return true;
}
function ensure(d){
  if(!isRoads(d))return d;
  validate(d);
  const L=require('./intake-location.cjs');
  // A closure changes routing, not the identity/location of a catalog point.
  const locationScenario={...d.scenario,edges:d.scenario.edges.map(e=>({...e,open:true}))};
  const allIds=new Set(d.villages.flatMap(v=>v.pickups.map(p=>p.id)));
  for(const source of districts()){
    let target=d.villages.find(v=>v.id===source.id||v.catalogDistrictId===source.id);
    if(!target)target=d.villages.find(v=>v.imported===true&&norm(v.name)===norm(source.name));
    if(!target){target={id:source.id,name:source.name,township:source.township||'浙江省瑞安市',synthetic:false,pickups:[]};d.villages.push(target);}
    Object.assign(target,{catalogSource:SOURCE,catalogDistrictId:source.id,kind:source.kind||'district',township:source.township||'浙江省瑞安市',parentId:source.parentId||null,sourceUrl:sourceUrl(source),sourceName:source.sourceName||'OpenStreetMap 公开地名',administrativeRelation:source.kind==='road-group'?'not-an-administrative-area':'source-place-name'});
    for(const point of source.pickups||[]){
      // A same-name uploaded point may refer to another entrance. Do not rewrite it.
      if(allIds.has(point.id))continue;
      const location=L.resolve(locationScenario,{...point,coordinateSystem:'WGS84'});
      target.pickups.push({...clone(point),...location,id:point.id,node:location.locationNodeId,synthetic:false,purposeSynthetic:true,catalogSource:SOURCE,sourceUrl:sourceUrl(point),sourceName:point.sourceName||source.sourceName||'OpenStreetMap 公开道路节点',administrativeRelation:'unverified',coordinateSource:'OpenStreetMap 公开位置；接人用途为演练候选，非官方安全集合点',locationSource:'public-place-catalog',locationReason:location.locationReason+'；公开地点仅作为演练候选，接人用途及现场可用性需核对'});
      allIds.add(point.id);
    }
  }
  for(const village of d.villages)if(village.synthetic===true&&['VA','VB','VC'].includes(village.id)){
    village.legacyDemo=true;for(const p of village.pickups)p.legacyDemo=true;
  }
  d.placeDirectory={catalogSource:SOURCE,coverage:data.coverage||null,sources:clone(data.sources||[]),disclaimer:data.disclaimer||'公开地名与道路位置用于演练候选；不是官方安全集合点目录，行政归属及现场可用性需人工核对。'};
  validate(d);return d;
}
module.exports={ensure,validate,isDistrict,isPickup,sharedPickup,SOURCE,CATALOG_DISTRICTS:districts().length,CATALOG_PICKUPS:places().length};
