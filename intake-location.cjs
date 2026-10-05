'use strict';
// Local matching only. This module never geocodes a name or invents a road.
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const D=require('./ruian-directory.cjs');
// Bundled choices do not consume capacity reserved for pre-existing user data.
const MAX_DISTANCE_M=500,MAX_VILLAGES=503+D.CATALOG_DISTRICTS,MAX_PICKUPS=1000+D.CATALOG_PICKUPS;
const norm=s=>String(s||'').normalize('NFKC').trim().replace(/\s+/g,'').toUpperCase();
const label=(value,title)=>{assert(typeof value==='string'&&value.trim()&&value.length<=100&&!/[\u0000-\u001f]/.test(value),title+'不能为空且不能超过100字');return value.trim();};
const validId=s=>typeof s==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(s)&&!['constructor','prototype','__proto__'].includes(s);
const coordinate=(lon,lat)=>typeof lon==='number'&&Number.isFinite(lon)&&lon>=-180&&lon<=180&&typeof lat==='number'&&Number.isFinite(lat)&&lat>=-90&&lat<=90;
const present=n=>n!==undefined&&n!==null&&n!=='';
function distance(a,b){const rad=x=>x*Math.PI/180,dlat=rad(b.latitude-a.latitude),dlon=rad(b.longitude-a.longitude),q=Math.sin(dlat/2)**2+Math.cos(rad(a.latitude))*Math.cos(rad(b.latitude))*Math.sin(dlon/2)**2;return 6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));}
function roadNode(s,node){return s.edges.some(e=>e.open&&(e.from===node.id||e.to===node.id));}
function resolve(s,p={}){
  const geo=s.region?.mapKind==='osm-road-network',hasCoords=present(p.longitude)||present(p.latitude),nodeId=p.nodeId||p.locationNodeId||null;
  if(hasCoords){assert(coordinate(p.longitude,p.latitude),'经纬度须同时提供有效数字，使用WGS84坐标');assert(p.coordinateSystem==='WGS84','仅支持明确标注的WGS84坐标，不自动转换其他坐标系');assert(geo,'当前为合成示意地图；请先点击“启用瑞安道路地图”，保留现有需求后再导入经纬度');}
  const base={longitude:hasCoords?p.longitude:null,latitude:hasCoords?p.latitude:null,coordinateSystem:hasCoords?'WGS84':null,locationNodeId:null,locationStatus:'pending',locationDistanceM:null,locationReason:'未提供可确认的位置，请选择路网节点或补充WGS84经纬度',locationSource:'unlocated'};
  let node=nodeId?s.nodes.find(n=>n.id===nodeId):null;
  if(nodeId)assert(node,'所选接人路网节点不存在');
  if(hasCoords){
    const b=s.region.bounds;
    if(!Array.isArray(b)||p.longitude<b[0]||p.latitude<b[1]||p.longitude>b[2]||p.latitude>b[3])return {...base,locationReason:'坐标在当前有限瑞安道路数据范围外，保留需求待定位，不生成虚构路线',locationSource:'uploaded-coordinate'};
    const candidates=s.nodes.filter(n=>coordinate(n.longitude,n.latitude)&&roadNode(s,n));
    if(!node)node=candidates.sort((a,b)=>distance(p,a)-distance(p,b)||a.id.localeCompare(b.id))[0];
    const metres=node?distance(p,node):Infinity;
    if(!node||!roadNode(s,node)||metres>MAX_DISTANCE_M)return {...base,locationReason:'坐标距离可接送道路节点超过500米或节点道路不可用，保留需求待定位',locationSource:'uploaded-coordinate'};
    return {...base,locationNodeId:node.id,locationStatus:'located',locationDistanceM:Math.round(metres*10)/10,locationReason:'已关联现有道路节点；原坐标至道路节点的接驳路段未建模，需现场核对',locationSource:nodeId?'manual-node':'nearest-road-node'};
  }
  if(node){
    assert(roadNode(s,node),'所选节点没有开放道路，请选择其他节点');
    return {...base,longitude:geo?node.longitude:null,latitude:geo?node.latitude:null,coordinateSystem:geo?'WGS84':null,locationNodeId:node.id,locationStatus:'located',locationDistanceM:geo?0:null,locationReason:'人工选择现有路网节点，待现场核对接人位置',locationSource:'manual-node'};
  }
  return base;
}
function nextId(list,prefix){let n=1;while(list.some(x=>x.id===prefix+n))n++;return prefix+n;}
function prepareRow(d,row){
  let village=row.villageId?d.villages.find(v=>v.id===row.villageId):null;
  if(row.villageId)assert(village,'请选择有效的已登记村庄编号');
  if(!village){const name=label(row.villageName,'村庄名称'),matches=d.villages.filter(v=>norm(v.name)===norm(name));assert(matches.length<2,'村庄名称不唯一，请选村庄编号');village=matches[0];
    if(!village){assert(d.villages.length<MAX_VILLAGES,'村庄目录已达上限');village={id:nextId(d.villages,'VI'),name,township:'上传地点（待核对行政归属）',synthetic:false,imported:true,pickups:[]};d.villages.push(village);}}
  let pickup=row.pickupId?village.pickups.find(p=>p.id===row.pickupId):null;
  if(!pickup&&row.pickupId){
    const shared=D.sharedPickup(d,row.pickupId);
    if(shared){
      pickup=village.pickups.find(p=>p.publicPlaceSource===D.SOURCE&&p.publicPlaceId===shared.id);
      if(!pickup){
        const all=d.villages.flatMap(v=>v.pickups);assert(all.length<MAX_PICKUPS&&village.pickups.length<100,'集合点目录已达上限');
        const copy=JSON.parse(JSON.stringify(shared));delete copy.catalogSource;
        pickup={...copy,id:nextId(all,'PI'),imported:true,publicPlaceId:shared.id,publicPlaceSource:D.SOURCE,administrativeRelation:'user-selected-unverified',locationReason:shared.locationReason+'；由本次录入选用，所在街道/村庄归属未核实'};
        village.pickups.push(pickup);
      }
    }
  }
  if(row.pickupId)assert(pickup,'接人点必须属于当前村庄');
  const explicitLocation=present(row.longitude)||present(row.latitude)||row.locationNodeId||row.nodeId;
  if(pickup&&explicitLocation){
    const selected=row.nodeId||row.locationNodeId;
    assert(!selected||selected===pickup.node,'选择的路网节点与已登记接人点不一致；更换位置须清空集合点编号并作为新接人点核对');
    const location=resolve(d.scenario,{...row,nodeId:pickup.node});
    assert(location.locationStatus==='located'&&location.locationNodeId===pickup.node,'上传坐标与已登记接人点不一致，请使用不同集合点名称并核对位置');
    if(present(row.longitude)||present(row.latitude))assert(coordinate(pickup.longitude,pickup.latitude)&&distance(row,pickup)<=1,'上传坐标与已登记接人点不一致；请清空集合点编号，以新接人点保留本次坐标');
  }
  if(!pickup&&row.pickupName&&!explicitLocation){const matches=village.pickups.filter(p=>norm(p.name)===norm(row.pickupName));assert(matches.length<2,'集合点名称不唯一，请选集合点编号');pickup=matches[0];}
  if(!pickup&&(row.pickupName||explicitLocation)){
    const location=resolve(d.scenario,row),name=row.pickupName?label(row.pickupName,'集合点名称'):'上传坐标接人点';
    const same=village.pickups.find(p=>norm(p.name)===norm(name)&&p.longitude===location.longitude&&p.latitude===location.latitude&&p.node===location.locationNodeId);
    if(same)pickup=same;else{
      const all=d.villages.flatMap(v=>v.pickups);assert(all.length<MAX_PICKUPS&&village.pickups.length<100,'集合点目录已达上限');
      pickup={id:nextId(all,'PI'),name,node:location.locationNodeId,synthetic:false,imported:true,...location};village.pickups.push(pickup);
    }
  }
  return {...row,villageId:village.id,pickupId:pickup?.id||null};
}
function metadata(village,pickup){
  return {villageName:village.name,pickupName:pickup?.name||'',longitude:pickup?.longitude??null,latitude:pickup?.latitude??null,coordinateSystem:pickup?.coordinateSystem||null,
    locationNodeId:pickup?.node||null,locationStatus:pickup?.node?'located':'pending',locationDistanceM:pickup?.locationDistanceM??null,
    locationReason:pickup?.locationReason||(pickup?.node?'使用已登记接人点':'接人点待定位'),locationSource:pickup?.locationSource||(pickup?.node?'catalog':'unlocated')};
}
function validateCatalog(d){
  const villages=d.villages,nodes=new Set(d.scenario.nodes.map(n=>n.id));
  assert(Array.isArray(villages)&&villages.length>=3&&villages.length<=MAX_VILLAGES,'村庄目录数量无效');
  assert(new Set(villages.map(v=>v.id)).size===villages.length,'村庄编号重复');
  for(const v of villages){assert(v&&validId(v.id)&&typeof v.name==='string'&&v.name.trim()&&v.name.length<=100&&typeof v.township==='string'&&v.township.length<=100&&Array.isArray(v.pickups)&&v.pickups.length<=100&&(v.pickups.length>0||v.imported===true||D.isDistrict(v)),'村庄或集合点目录无效');}
  const pickups=villages.flatMap(v=>v.pickups);
  assert(pickups.length<=MAX_PICKUPS&&new Set(pickups.map(p=>p.id)).size===pickups.length,'集合点数量或编号无效');
  for(const p of pickups){
    assert(p&&validId(p.id)&&typeof p.name==='string'&&p.name.trim()&&p.name.length<=100,'集合点名称或编号无效');
    assert(nodes.has(p.node)||((p.imported===true||D.isPickup(p))&&p.node===null&&p.locationStatus==='pending'&&p.locationNodeId===null),'集合点路网节点无效');
    if(p.locationStatus!==undefined)assert(['pending','located'].includes(p.locationStatus)&&(p.locationStatus==='located')===nodes.has(p.node)&&p.locationNodeId===p.node,'集合点定位状态不一致');
    if(p.longitude!==undefined&&p.longitude!==null||p.latitude!==undefined&&p.latitude!==null)assert(coordinate(p.longitude,p.latitude)&&p.coordinateSystem==='WGS84','集合点经纬度或坐标系无效');
    if(p.locationDistanceM!==undefined&&p.locationDistanceM!==null)assert(Number.isFinite(p.locationDistanceM)&&p.locationDistanceM>=0&&p.locationDistanceM<=MAX_DISTANCE_M,'集合点接驳距离无效');
    if(p.node&&coordinate(p.longitude,p.latitude)&&d.scenario.region.mapKind==='osm-road-network'){
      const node=d.scenario.nodes.find(n=>n.id===p.node),metres=distance(p,node),b=d.scenario.region.bounds;
      assert(metres<=MAX_DISTANCE_M&&(!p.imported||(p.longitude>=b[0]&&p.latitude>=b[1]&&p.longitude<=b[2]&&p.latitude<=b[3])),'集合点坐标与关联道路节点距离或范围不一致');
      if(p.locationDistanceM!==undefined&&p.locationDistanceM!==null)assert(Math.abs(p.locationDistanceM-metres)<0.2,'集合点接驳距离与坐标不一致');
    }
  }
  D.validate(d);
  return true;
}
module.exports={resolve,prepareRow,metadata,validateCatalog,distance,MAX_DISTANCE_M,MAX_VILLAGES,MAX_PICKUPS};
