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

module.exports={apply,metadata:clone(network.metadata)};
