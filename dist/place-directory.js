/* One place directory for intake choices and local preview parsing. No geocoding. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.JiaoyingPlaceDirectory=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const isRoad=data=>data?.scenario?.region?.mapKind==='osm-road-network';
  const real=v=>v?.catalogSource==='ruian-places-v1';
  const legacy=v=>/^V[ABC]$/.test(v.id)&&v.synthetic===true&&!v.imported&&!real(v);
  function villages(data,selectedId){return (data?.villages||[]).filter(v=>!isRoad(data)||!legacy(v)||v.id===selectedId);}
  function pickups(data,villageId){
    const village=(data?.villages||[]).find(v=>v.id===villageId);
    if(!village)return [];
    const own=village.pickups||[];
    if(!isRoad(data)||(!real(village)&&!village.imported)||(village.catalogDistrictId||village.id)==='RA-URBAN-ROADS')return own;
    const shared=(data.villages.find(v=>(v.catalogDistrictId||v.id)==='RA-URBAN-ROADS'&&real(v))?.pickups||[]);
    // Keep source IDs resolvable for older previews after a point is registered
    // locally. Only the option list hides the duplicate physical location.
    return [...own,...shared.filter(p=>!own.some(x=>x.id===p.id)).map(p=>({...p,sharedCandidate:true}))];
  }
  function villageOptions(data,selectedId){return villages(data,selectedId).map(v=>({id:v.id,label:v.name,detail:real(v)?((v.catalogDistrictId||v.id)==='RA-URBAN-ROADS'?'真实道路点 · 按位置选择':(v.township&&v.township!==v.name?v.township+' · ':'')+'瑞安地名目录'):legacy(v)?'旧场演示地点 · 保留原记录':'本场登记地区 · '+v.id}));}
  function pickupOptions(data,villageId){const points=pickups(data,villageId);return points.filter(p=>!p.sharedCandidate||!points.some(x=>x.publicPlaceId===p.id)).map(p=>({id:p.id,label:p.name,detail:p.sharedCandidate||p.administrativeRelation==='user-selected-unverified'?'瑞安城区道路候选 · 街道辖属待核':p.catalogSource==='ruian-places-v1'?'真实地图位置 · 演练候选点':'本地区已登记接人点 · '+p.id}));}
  return {isRoad,villages,pickups,villageOptions,pickupOptions};
});
