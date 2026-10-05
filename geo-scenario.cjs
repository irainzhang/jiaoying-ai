'use strict';
const network=require('./dist/assets/maps/ruian-routing.json');
const clone=value=>JSON.parse(JSON.stringify(value));

// Apply only to a fresh exercise. Scenario replacement belongs to the domain's
// explicit, confirmed scenario action; this helper must not erase live records.
function apply(d){
  if(!d?.scenario||d.phase!=='preparation'||d.plan||d.activePlan||d.baseline||d.alternative||
      ['reports','villageReports','fieldEvents','history'].some(key=>d[key]?.length)||
      Object.values(d.contacts||{}).some(c=>c.ack||c.contacted)||
      Object.values(d.fleet||{}).some(f=>f.onboard?.length||f.finished||f.minute>0)||
      Object.values(d.stage||{}).some(stage=>stage!=='waiting')||
      d.scenario.households.some(h=>!/^H[1-6]$/.test(h.id)))
    throw new Error('道路情景只能应用于新建演练，不能覆盖已有执行记录');
  const s=d.scenario;
  s.name=network.region.name;
  s.region=clone(network.region);
  s.nodes=clone(network.nodes);
  s.edges=clone(network.edges);
  s.geographicMetadata=clone(network.metadata);
  s.households.forEach(h=>{h.node=h.id;h.note=(h.note||'')+'；接人位置为公开道路节点上的演练集合点，非真实家庭地址';});
  s.vehicles.forEach(v=>{v.start='D';d.fleet[v.id].node='D';});
  s.shelters.forEach(sh=>{sh.name=s.nodes.find(n=>n.id===sh.id).label;sh.synthetic=true;});
  for(const village of d.villages||[])for(const pickup of village.pickups){
    const node=s.nodes.find(n=>n.id===pickup.node);
    if(!node)throw new Error('演练集合点与道路节点无法对应');
    Object.assign(pickup,{name:node.label,longitude:node.longitude,latitude:node.latitude,
      coordinateSystem:'WGS84',osmNodeId:node.osmNodeId,sourceUrl:node.sourceUrl,
      synthetic:true,coordinateSource:'OpenStreetMap 历史道路节点；集合点用途为演练设定'});
  }
  d.lastAnnouncement='瑞安城区道路演练已就绪。真实 OSM 道路几何与单行方向参与求解；集合点、接收点用途、车辆、容量与时间为演练设定。';
  return d;
}

function conversionStatus(d){
  const reasons=[],add=(code,message)=>reasons.push({code,message});
  const alreadyRoads=d.scenario.region.mapKind==='osm-road-network';
  if(alreadyRoads)return {allowed:false,alreadyRoads:true,reasons:[{code:'already-roads',message:'当前已经是瑞安道路地图，无需重复转换'}]};
  if(['completed','stopped'].includes(d.taskLifecycle?.status))add('task-closed','本场任务已结束；保留记录后，可新建瑞安道路任务');
  if(d.activePlan)add('published-plan','本场仍保留已发布方案 '+d.activePlan.id+'；未上传新名单不代表没有已发布任务');
  if(d.history.length)add('published-history','本场保留 '+d.history.length+' 份历史发布方案');
  if(d.phase!=='preparation')add('execution-phase','本场已经开始模拟执行，不能直接替换路线依据');
  const progressed=Object.entries(d.stage).filter(([,stage])=>stage!=='waiting'&&stage!=='superseded');
  if(progressed.length){
    const total=stage=>progressed.reduce((n,[id,value])=>n+(value===stage?(d.scenario.households.find(h=>h.id===id)?.people||0):0),0);
    add('person-progress','人员记录：已上车 '+total('boarded')+' 人、到达待核验 '+total('arrived')+' 人、已核验 '+total('verified')+' 人');
  }
  const contacts=Object.entries(d.contacts).filter(([,c])=>c.ack||c.contacted);
  if(contacts.length){
    const people=contacts.reduce((n,[id])=>n+(d.scenario.households.find(h=>h.id===id)?.people||0),0);
    add('contacts','已有联系或接收登记 '+contacts.length+' 组、'+people+' 人');
  }
  const vehicles=Object.values(d.fleet).filter(f=>f.onboard.length||f.delivered.length||f.finished||f.minute!==0);
  if(vehicles.length)add('vehicle-progress',vehicles.length+' 辆车已有行程或送达记录');
  const nodes=new Set(network.nodes.map(n=>n.id));
  if(d.scenario.edges.some(e=>!e.open)||d.reports.some(r=>r.kind==='road'))add('road-changes','已有道路变化或道路反馈，不能无损映射到另一套路网');
  if(d.reports.some(r=>!nodes.has(r.location)))add('report-location','已有位置反馈无法对应真实道路节点');
  if(!d.scenario.households.every(h=>nodes.has(h.node))||!d.scenario.vehicles.every(v=>nodes.has(v.start)&&nodes.has(d.fleet[v.id].node))||!d.scenario.shelters.every(s=>nodes.has(s.id))||
    !d.villages.every(v=>v.pickups.every(p=>!p.node||nodes.has(p.node))))add('demand-location','现有需求或资源位置无法对应真实道路节点，不能无损转换');
  return {allowed:reasons.length===0,alreadyRoads:false,reasons};
}

function convert(d){
  const status=conversionStatus(d);
  if(!status.allowed){
    const executing=status.reasons.some(r=>['published-plan','published-history','execution-phase','person-progress','contacts','vehicle-progress'].includes(r.code));
    throw new Error((executing?'已有发布或执行进度，不能转换地图；':'')+status.reasons.map(r=>r.message).join('；'));
  }
  const s=d.scenario;s.name=network.region.name;s.region=clone(network.region);s.nodes=clone(network.nodes);s.edges=clone(network.edges);s.geographicMetadata=clone(network.metadata);
  for(const village of d.villages)for(const pickup of village.pickups){
    if(!pickup.node)continue;const node=s.nodes.find(n=>n.id===pickup.node);
    Object.assign(pickup,{longitude:node.longitude,latitude:node.latitude,coordinateSystem:'WGS84',locationNodeId:node.id,locationStatus:'located',locationDistanceM:0,locationSource:'catalog',locationReason:'原演练集合点对应公开道路节点；接送用途仍为演练设定',osmNodeId:node.osmNodeId,sourceUrl:node.sourceUrl});
  }
  const L=require('./intake-location.cjs');
  for(const r of d.villageReports){const v=d.villages.find(v=>v.id===r.villageId);Object.assign(r,L.metadata(v,v.pickups.find(p=>p.id===r.pickupId)));}
  for(const h of s.households){const v=d.villages.find(v=>v.id===h.villageId);if(v)Object.assign(h,L.metadata(v,v.pickups.find(p=>p.id===h.pickupId)));}
  d.scenarioPreset='ruian-roads';
  return d;
}
module.exports={apply,convert,conversionStatus,metadata:clone(network.metadata)};
