'use strict';
// Data validation and transparent, deterministic explanations; no model service.
const assert=(ok,message)=>{if(!ok)throw new Error(message);};
const object=x=>!!x&&typeof x==='object'&&!Array.isArray(x);
const sum=(rows,fn)=>rows.reduce((n,row)=>n+fn(row),0);
const bounded=(n,min,max)=>Number.isFinite(n)&&n>=min&&n<=max;
const integer=(n,min,max)=>Number.isInteger(n)&&bounded(n,min,max);
const validId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,79}$/.test(id)&&!['__proto__','prototype','constructor'].includes(id);
const catalog=[
  {id:'normal',name:'初始接送',description:'15 人、3 辆车、2 个安置点；先比较同一输入的两套方案。'},
  {id:'road-closure',name:'道路中断',description:'东桥核实受阻；重新计算绕行和转移安排。'},
  {id:'village-growth',name:'村级新增 12 人',description:'演示村 A 新增 12 人，其中 3 人需协助、含 1 名轮椅人员；核实后计算资源缺口。'},
  {id:'resource-shortage',name:'车辆故障',description:'1 号车不可用，轮椅接送受限；展示不能安排的对象及增援需求。'},
  {id:'shelter-loss',name:'安置点停用',description:'安置点 A 不可接收；剩余容量不足时明确待协调人员。'},
  {id:'ruian-roads',name:'瑞安真实路网',description:'使用公开 OSM 道路；接送用途、容量和速度仍为演练假设。'}
];

function inspectJSON(value){
  let entries=0;const seen=new Set();
  function walk(x,depth){
    assert(depth<=40,'恢复数据嵌套过深');assert(++entries<=400000,'恢复数据对象数量过大');
    if(x===null||typeof x==='boolean')return;
    if(typeof x==='number'){assert(Number.isFinite(x),'恢复数据包含非法数字');return;}
    if(typeof x==='string'){assert(x.length<=20000,'恢复数据文本过长');return;}
    assert(object(x)||Array.isArray(x),'恢复数据必须为 JSON 对象');assert(!seen.has(x),'恢复数据不能有循环引用');seen.add(x);
    for(const [key,item] of Object.entries(x)){assert(!['__proto__','prototype','constructor'].includes(key),'恢复数据含禁止的属性');walk(item,depth+1);}seen.delete(x);
  }
  walk(value,0);assert(JSON.stringify(value).length<=8*1024*1024,'恢复文件超过 8 MB 限额');
}
function checkPlan(p,s,label){
  if(p===null)return;
  assert(object(p)&&Array.isArray(p.routes)&&p.routes.length<=s.vehicles.length&&Array.isArray(p.servedIds)&&Array.isArray(p.unassigned),label+'结构无效');
  assert(p.id===undefined||validId(p.id),label+'编号无效');
  if(p.steps!==undefined)assert(Array.isArray(p.steps)&&p.steps.length<=20&&p.steps.every(step=>typeof step==='string'&&step.length<=500),label+'步骤结构无效');
  for(const key of ['servedPeople','totalPeople','urgentPeople','assistedPeople','onboardCount','wait','finish','drive','inputVersion','executionVersion'])assert(bounded(p[key],0,1e12),label+'统计无效');
  assert(p.servedIds.every(id=>s.households.some(h=>h.id===id)),label+'含未知人员');
  const vehicleIds=new Set();
  for(const r of p.routes){
    assert(object(r)&&s.vehicles.some(v=>v.id===r.vehicleId)&&!vehicleIds.has(r.vehicleId),label+'车辆无效或重复');vehicleIds.add(r.vehicleId);
    assert(s.nodes.some(n=>n.id===r.from)&&bounded(r.startMinute,0,1e7)&&bounded(r.finish,0,1e7)&&integer(r.people,0,500)&&typeof r.holding==='boolean',label+'路线数值无效');
    for(const key of ['onboard','passengerIds'])assert(Array.isArray(r[key])&&r[key].length<=200&&r[key].every(id=>s.households.some(h=>h.id===id)),label+'乘员关联无效');
    assert(Array.isArray(r.stops)&&r.stops.length<=200&&r.stops.every(st=>object(st)&&s.households.some(h=>h.id===st.id)&&s.nodes.some(n=>n.id===st.node)&&integer(st.people,1,500)&&bounded(st.arrival,0,1e7)&&bounded(st.depart,st.arrival,1e7)),label+'站点无效');
    assert(r.shelterId===null||s.shelters.some(sh=>sh.id===r.shelterId),label+'接收点无效');
    assert(Array.isArray(r.segments)&&r.segments.length<=201,label+'路段结构无效');
    for(const seg of r.segments){
      assert(object(seg)&&Array.isArray(seg.nodes)&&Array.isArray(seg.edges)&&seg.nodes.length<=2500&&seg.edges.length===seg.nodes.length-1&&seg.nodes[0]===seg.from&&seg.nodes.at(-1)===seg.to&&bounded(seg.minutes,0,1e7),label+'路径结构无效');
      let minutes=0;
      for(let k=0;k<seg.edges.length;k++){const e=s.edges.find(e=>e.id===seg.edges[k]);assert(e&&((e.from===seg.nodes[k]&&e.to===seg.nodes[k+1])||(!e.directed&&e.to===seg.nodes[k]&&e.from===seg.nodes[k+1])),label+'路径关联或方向无效');minutes+=e.minutes;}
      assert(Math.abs(minutes-seg.minutes)<1e-6,label+'路径时间不符');
    }
  }
  assert(p.unassigned.length<=2000&&p.unassigned.every(h=>object(h)&&typeof h.id==='string'&&integer(h.people,1,500)&&typeof h.reason==='string'),label+'待协调名单无效');
}
function validateState(d){
  inspectJSON(d);assert(object(d)&&d.schema==='jiaoying-v3','恢复数据必须为 jiaoying-v3 演练数据');const s=d.scenario;
  assert(object(s),'恢复数据缺少演练场景');
  const limits={nodes:2500,edges:8000,households:2000,vehicles:30,shelters:30};
  for(const [key,max] of Object.entries(limits)){assert(Array.isArray(s[key])&&s[key].length>0&&s[key].length<=max&&s[key].every(x=>object(x)&&validId(x.id)),'恢复数据'+key+'目录无效或超过限额');assert(new Set(s[key].map(x=>x.id)).size===s[key].length,'恢复数据存在重复对象');}
  const nodes=new Set(s.nodes.map(n=>n.id));
  assert(object(s.region)&&['synthetic-topology','osm-road-network'].includes(s.region.mapKind),'恢复地图模式无效');
  const geographic=s.region.mapKind==='osm-road-network';
  const coordinate=point=>Array.isArray(point)&&point.length===2&&bounded(point[0],-180,180)&&bounded(point[1],-90,90);
  if(s.region.bounds!==undefined){const b=s.region.bounds;assert(Array.isArray(b)&&b.length===4&&coordinate(b.slice(0,2))&&coordinate(b.slice(2))&&b[0]<b[2]&&b[1]<b[3],'恢复地图范围无效');}
  if(geographic)assert(s.region.coordinateSystem==='WGS84','真实道路演练坐标系无效');
  assert(s.nodes.every(n=>bounded(n.x,-1e7,1e7)&&bounded(n.y,-1e7,1e7)&&typeof n.label==='string'&&['home','shelter','depot','junction'].includes(n.kind)),'恢复点位坐标或类型无效');
  for(const n of s.nodes){if(geographic||n.longitude!==undefined&&n.longitude!==null||n.latitude!==undefined&&n.latitude!==null)assert(coordinate([n.longitude,n.latitude]),'恢复经纬度坐标无效');}
  assert(s.edges.every(e=>nodes.has(e.from)&&nodes.has(e.to)&&e.from!==e.to&&bounded(e.minutes,0.001,1440)&&typeof e.open==='boolean'&&(e.directed===undefined||typeof e.directed==='boolean')),'恢复道路端点、耗时或开闭状态无效');
  for(const e of s.edges){
    if(geographic||e.geometry!==undefined){assert(Array.isArray(e.geometry)&&e.geometry.length>=2&&e.geometry.length<=1000&&e.geometry.every(coordinate),'恢复道路几何无效');
      if(geographic){const from=s.nodes.find(n=>n.id===e.from),to=s.nodes.find(n=>n.id===e.to),start=e.geometry[0],end=e.geometry.at(-1);assert(Math.abs(start[0]-from.longitude)<1e-7&&Math.abs(start[1]-from.latitude)<1e-7&&Math.abs(end[0]-to.longitude)<1e-7&&Math.abs(end[1]-to.latitude)<1e-7,'恢复道路几何端点与路网不一致');}}
    if(e.osmWayIds!==undefined)assert(Array.isArray(e.osmWayIds)&&e.osmWayIds.length<=1000&&e.osmWayIds.every(id=>integer(id,1,Number.MAX_SAFE_INTEGER)),'恢复道路来源编号无效');
  }
  assert(s.vehicles.every(v=>nodes.has(v.start)&&integer(v.capacity,0,500)&&typeof v.available==='boolean'&&typeof v.wheelchair==='boolean'&&typeof v.name==='string'&&typeof v.color==='string'&&/^#[0-9a-f]{6}$/i.test(v.color)),'恢复车辆容量、类型或颜色无效');
  assert(s.shelters.every(sh=>nodes.has(sh.id)&&integer(sh.capacity,0,10000)&&typeof sh.available==='boolean'&&typeof sh.name==='string'),'恢复安置容量或状态无效');
  assert(s.households.every(h=>nodes.has(h.node)&&integer(h.people,1,500)&&integer(h.risk,1,3)&&integer(h.priority,1,3)&&bounded(h.service,0,1440)&&typeof h.assistance==='boolean'&&typeof h.wheelchair==='boolean'&&typeof h.name==='string'),'恢复人员数量、风险或服务时长无效');
  for(const h of s.households){const assisted=h.assistancePeople??(h.assistance?h.people:0),chairs=h.wheelchairPeople??Number(h.wheelchair);assert(integer(assisted,0,h.people)&&integer(chairs,0,assisted)&&Boolean(chairs)===h.wheelchair&&Boolean(assisted)===h.assistance,'恢复人员特殊需求人数无效');}
  assert(['revision','inputVersion','executionVersion'].every(k=>integer(d[k],1,Number.MAX_SAFE_INTEGER-2))&&integer(d.planCounter,0,Number.MAX_SAFE_INTEGER-2),'恢复数据版本无效');
  for(const resource of [...s.vehicles,...s.shelters])if(resource.resourceChangeVersion!==undefined)assert(integer(resource.resourceChangeVersion,1,d.inputVersion),'恢复资源变更版本无效');
  assert(['preparation','executing'].includes(d.phase)&&['stage','contacts','fleet','occupancy','weather'].every(k=>object(d[k])),'恢复数据状态结构无效');
  assert(integer(d.weather.level,1,3)&&bounded(d.weather.rainfall,0,10000),'恢复天气数据无效');
  const maxRows={reports:2000,history:20,log:150,fieldEvents:100,villageReports:2000};
  for(const [key,max] of Object.entries(maxRows))if(d[key]!==undefined)assert(Array.isArray(d[key])&&d[key].length<=max&&d[key].every(object),'恢复记录结构无效或超过限额：'+key);
  assert(['reports','history','log'].every(k=>Array.isArray(d[k])),'恢复数据记录缺失');
  if(d.villages!==undefined){
    assert(Array.isArray(d.villages)&&d.villages.length===3&&d.villages.every(v=>object(v)&&validId(v.id)&&typeof v.name==='string'&&v.name.length<=100&&typeof v.township==='string'&&v.township.length<=100&&Array.isArray(v.pickups)&&v.pickups.length>0&&v.pickups.length<=30),'恢复村庄或集合点目录无效');
    assert(new Set(d.villages.map(v=>v.id)).size===d.villages.length,'恢复村庄编号重复');
    const pickups=d.villages.flatMap(v=>v.pickups);
    assert(pickups.every(p=>object(p)&&validId(p.id)&&nodes.has(p.node)&&typeof p.name==='string'&&p.name.length<=100)&&new Set(pickups.map(p=>p.id)).size===pickups.length,'恢复集合点内容或编号无效');
  }
  if(d.villageReports!==undefined)assert(d.villageReports.every(r=>validId(r.id)&&Array.isArray(r.householdIds)&&r.householdIds.length<=200&&r.householdIds.every(validId)),'恢复村级批次编号或人员组目录无效');
  assert(s.households.every(h=>['waiting','boarded','arrived','verified','superseded'].includes(d.stage[h.id])&&object(d.contacts[h.id])&&typeof d.contacts[h.id].contacted==='boolean'&&typeof d.contacts[h.id].ack==='boolean'),'恢复人员阶段或联系记录无效');
  assert(Object.keys(d.stage).every(id=>s.households.some(h=>h.id===id))&&Object.keys(d.fleet).every(id=>s.vehicles.some(v=>v.id===id))&&Object.keys(d.occupancy).every(id=>s.shelters.some(sh=>sh.id===id)),'恢复台账含未知对象');
  const onboard=new Set(),delivered=new Set(),occupancy={};
  for(const v of s.vehicles){const f=d.fleet[v.id];assert(object(f)&&nodes.has(f.node)&&bounded(f.minute,0,1e7)&&typeof f.finished==='boolean','恢复车辆状态无效：位置或时间不合法');
    for(const key of ['onboard','delivered'])assert(Array.isArray(f[key])&&f[key].length<=200&&f[key].every(id=>s.households.some(h=>h.id===id)),'恢复车辆乘员不存在');
    for(const id of f.onboard){assert(d.stage[id]==='boarded'&&!onboard.has(id),'恢复已上车人员重复或阶段不符');onboard.add(id);}
    for(const id of f.delivered){assert(['arrived','verified'].includes(d.stage[id])&&!delivered.has(id),'恢复已到达人员重复或阶段不符');delivered.add(id);}
    const hs=f.onboard.map(id=>s.households.find(h=>h.id===id));assert(sum(hs,h=>h.people)<=v.capacity&&sum(hs,h=>h.wheelchairPeople??Number(h.wheelchair))<=Number(v.wheelchair),'恢复车载人数超载');
    assert(!f.finished||!f.onboard.length,'已结束车辆仍有在途人员');assert(!f.delivered.length||f.finished&&s.shelters.some(sh=>sh.id===f.node),'已送达记录缺少有效到达点');
    if(f.delivered.length)occupancy[f.node]=(occupancy[f.node]||0)+sum(f.delivered,id=>s.households.find(h=>h.id===id).people);
  }
  for(const h of s.households){assert((d.stage[h.id]==='boarded')===onboard.has(h.id),'恢复已上车人员守恒校验失败');assert(['arrived','verified'].includes(d.stage[h.id])===delivered.has(h.id),'恢复已到达人员守恒校验失败');}
  for(const sh of s.shelters)assert(integer(d.occupancy[sh.id],0,sh.capacity)&&d.occupancy[sh.id]===(occupancy[sh.id]||0),'恢复安置人数不守恒');
  // Legacy stores may have preparation + boarding records; external import checks
  // the stricter phase rule separately rather than breaking legacy hydration.
  for(const r of d.reports)assert(validId(r.id)&&['road','people','medical','hazard','progress','other'].includes(r.kind)&&['pending','accepted','rejected','coordination','resolved'].includes(r.status)&&(nodes.has(r.location)||s.edges.some(e=>e.id===r.location))&&typeof r.text==='string'&&integer(r.people,0,500),'恢复现场反馈无效');
  assert(d.taskAcks===undefined||object(d.taskAcks)&&Object.entries(d.taskAcks).every(([id,a])=>s.vehicles.some(v=>v.id===id)&&object(a)&&typeof a.planId==='string'),'恢复接令记录无效');
  assert(d.log.every(row=>integer(row.id,1,Number.MAX_SAFE_INTEGER)&&typeof row.message==='string'&&row.message.length<=5000&&typeof row.type==='string'&&typeof row.time==='string'&&Number.isFinite(Date.parse(row.time))),'恢复日志内容无效');
  assert(d.lastAnnouncement===undefined||typeof d.lastAnnouncement==='string','恢复播报内容无效');
  assert(d.exerciseId===undefined||typeof d.exerciseId==='string'&&d.exerciseId.length<=100,'恢复演练编号无效');
  assert(d.createdAt===undefined||typeof d.createdAt==='string'&&Number.isFinite(Date.parse(d.createdAt)),'恢复创建时间无效');
  if(d.lastDelta!==undefined){
    const delta=d.lastDelta,keys=['people','highRisk','capacity','shortage','closed','rainfall'];
    assert(object(delta)&&typeof delta.time==='string'&&Number.isFinite(Date.parse(delta.time))&&Array.isArray(delta.rows)&&delta.rows.length<=keys.length,'恢复指标变化结构无效');
    assert(delta.reason===undefined||typeof delta.reason==='string'&&delta.reason.length<=5000,'恢复指标变化说明无效');
    assert(delta.rows.every(r=>object(r)&&keys.includes(r.key)&&[r.before,r.after,r.delta].every(n=>bounded(n,-1e8,1e8))&&Math.abs(r.after-r.before-r.delta)<1e-6)&&new Set(delta.rows.map(r=>r.key)).size===delta.rows.length,'恢复指标变化数值或类型无效');
  }
  for(const row of [...s.households,...s.vehicles,...s.shelters,...d.reports,...(d.villageReports||[]),...(d.fieldEvents||[])]){
    for(const key of ['name','note','text','reporter','summary','reason','resolution','response','label','unavailableReason'])if(row[key]!==undefined)assert(typeof row[key]==='string'&&row[key].length<=5000,'恢复记录文本字段无效：'+key);
  }
  if(d.fieldEvents!==undefined)assert(d.fieldEvents.every(row=>validId(row.id)&&['report','progress','village'].includes(row.kind)&&typeof row.time==='string'&&Number.isFinite(Date.parse(row.time))),'恢复现场事件无效');
  if(d.followups!==undefined)assert(object(d.followups)&&Object.keys(d.followups).length<=500&&Object.entries(d.followups).every(([key,r])=>validId(key)&&object(r)&&['open','working','resolved'].includes(r.status)&&typeof r.owner==='string'&&r.owner.length<=40&&typeof r.note==='string'&&r.note.length<=500&&(r.dueAt===null||typeof r.dueAt==='string'&&Number.isFinite(Date.parse(r.dueAt)))),'恢复责任跟进记录无效');
  for(const key of ['plan','baseline','alternative','activePlan'])checkPlan(d[key],s,'恢复'+key);
  if(d.plan){
    assert(d.baseline!==null&&object(d.planSnapshot),'恢复草案缺少配套基线或快照');
    const i=d.planSnapshot;
    assert(object(i.scenario)&&['nodes','edges','households','vehicles','shelters'].every(key=>Array.isArray(i.scenario[key]))&&object(i.stage)&&object(i.fleet)&&object(i.occupancy)&&Array.isArray(i.unplannedRequests),'恢复草案快照结构无效');
  }else assert(d.baseline===null&&d.alternative===null&&(d.planSnapshot===null||d.planSnapshot===undefined),'恢复草案与配套结果不一致');
  for(const p of d.history)checkPlan(p,s,'历史方案');
  return d;
}

function explainUnassigned(i,h,E){
  if(h.id.startsWith('BATCH-'))return {...h,code:'information',next:'补齐集合点、特殊需求和分组信息后重新计算。'};
  const home=i.scenario.households.find(x=>x.id===h.id);if(!home)return {...h,code:'information',next:'核对人员编号。'};
  const s=i.scenario,chairs=home.wheelchairPeople??Number(home.wheelchair);
  const available=s.vehicles.filter(v=>v.available&&!i.fleet[v.id].finished);
  if(h.stage==='boarded'){const v=s.vehicles.find(v=>i.fleet[v.id].onboard.includes(h.id));return {...h,code:v&&!v.available?'vehicle-unavailable':'onboard-held',next:'原车人员保持锁定；人工协调维修、专业接驳或可达接收点，再核实重新计算。'};}
  if(!available.length)return {...h,code:'vehicle-unavailable',next:'登记增援可用车辆后重新计算。'};
  if(!available.some(v=>v.capacity>=home.people&&Number(v.wheelchair)>=chairs))return {...h,code:'vehicle-fit',next:chairs?'协调具备轮椅位且座位足够的车辆；不能自动拆分同行组。':'协调座位足够的车辆，或由现场明确允许分组后更正批次。'};
  const shelters=s.shelters.filter(sh=>sh.available&&sh.capacity-(i.occupancy[sh.id]||0)>=home.people);
  if(!shelters.length)return {...h,code:'shelter-capacity',next:'核实并登记可接收的安置资源；不自动提高容量。'};
  if(!available.some(v=>E.shortestPath(s,i.fleet[v.id].node,home.node))||!shelters.some(sh=>E.shortestPath(s,home.node,sh.id)))return {...h,code:'road-access',next:'核查封闭路段、开放替代道路或协调专业救援。'};
  return {...h,code:'joint-capacity',next:'本组单独可适配，但与其他人员竞争有限座位、轮椅位或接收容量；优先级策略选择后仍需增援。'};
}
function diagnostics(d,helpers){
  const {E,snapshot,validate,blockedRoute}=helpers,i=d.planSnapshot||snapshot(d),p=d.plan,b=d.baseline;
  const routeSummary=(plan,id)=>{const r=plan?.routes.find(x=>x.vehicleId===id);return r?{people:r.people,ids:r.passengerIds,stops:r.stops.map(x=>x.id),shelterId:r.shelterId,finish:r.finish,drive:r.drive,holding:r.holding}:null;};
  const changes=d.scenario.vehicles.map(v=>({vehicleId:v.id,vehicleName:v.name,before:routeSummary(d.activePlan,v.id),after:routeSummary(p,v.id)})).filter(x=>p&&d.activePlan&&JSON.stringify(x.before)!==JSON.stringify(x.after));
  const errors=p?validate(i,p):[];
  const rows=d.scenario.vehicles.map(v=>({vehicleId:v.id,vehicleName:v.name,baseline:routeSummary(b,v.id),optimized:routeSummary(p,v.id)}));
  const shelterRows=d.scenario.shelters.map(sh=>({id:sh.id,name:sh.name,capacity:sh.capacity,occupied:i.occupancy[sh.id]||0,baseline:sum(b?.routes.filter(r=>r.shelterId===sh.id)||[],r=>r.people),optimized:sum(p?.routes.filter(r=>r.shelterId===sh.id)||[],r=>r.people)}));
  const waiting=(plan,kind='priority')=>plan?sum(plan.routes,r=>sum(r.stops,st=>{const h=i.scenario.households.find(x=>x.id===st.id);if(!h)return 0;const assisted=h.assistancePeople??(h.assistance?h.people:0),people=kind==='assisted'?assisted:kind==='urgent'?(h.risk===3?h.people:0):h.risk===3?h.people:assisted;return Math.max(0,st.arrival-r.startMinute)*people;})):null;
  const coordination=[];
  for(const r of d.reports.filter(x=>['pending','coordination','accepted'].includes(x.status)))coordination.push({key:'report:'+r.id,type:'report',title:r.id+' '+(r.status==='pending'?'待核实':'待处置'),detail:r.text});
  for(const r of (d.villageReports||[]).filter(x=>x.status==='pending'||x.status==='accepted'&&x.needsInfo))coordination.push({key:'village:'+r.id,type:'village',title:r.id+(r.status==='pending'?' 村级上报待核实':' 待补调度信息'),detail:r.text});
  for(const h of p?.unassigned||[])coordination.push({key:'person:'+h.id,type:'person',title:h.name+' · '+h.people+' 人待协调',detail:h.reason});
  for(const v of d.scenario.vehicles.filter(x=>!x.available))coordination.push({key:'vehicle:'+v.id,type:'resource',title:v.name+' 不可用',detail:v.unavailableReason||'待核实恢复条件'});
  for(const sh of d.scenario.shelters.filter(x=>!x.available))coordination.push({key:'shelter:'+sh.id,type:'resource',title:sh.name+' 不可用',detail:sh.unavailableReason||'待核实接收能力'});
  for(const h of d.scenario.households.filter(h=>d.stage[h.id]==='waiting'&&!d.contacts[h.id]?.contacted))coordination.push({key:'contact:'+h.id,type:'contact',title:h.name+' 待联系',detail:'接收任务不等于联系成功，请登记实际联系结果。'});
  for(const r of d.activePlan?.routes||[])if(!d.fleet[r.vehicleId].finished&&blockedRoute?.(d,r))coordination.push({key:'blocked:'+r.vehicleId,type:'blocked',title:r.vehicleId+' 执行受阻',detail:'核查资源、路段和当前乘员；重新计算并确认后再推进。'});
  for(const item of coordination)item.followup=d.followups?.[item.key]||null;
  return {scenarioCatalog:catalog,currentScenario:d.scenarioPreset||'normal',constraints:{checked:Boolean(p),ok:Boolean(p)&&!errors.length,errors,inputVersion:i.inputVersion,executionVersion:i.executionVersion,algorithm:p?.algorithm||null,checks:['容量与轮椅位','路径连续与开放方向','已上车人员原车锁定','人员守恒与未安排名单','安置剩余容量'],scope:'仅校验演练输入的调度约束，不等于现场安全评估'},comparison:{sameSnapshot:!!p&&!!b&&p.inputVersion===b.inputVersion&&p.executionVersion===b.executionVersion,rows,shelters:shelterRows,baselineUnassigned:b?.unassigned||[],optimizedUnassigned:p?.unassigned||[],priorityWait:{baseline:waiting(b),optimized:waiting(p),unit:'人·分钟',definition:'已安排高风险人数与实际需协助人数的并集等待，同人不重复；须同时比较未安排人数'},assistedWait:{baseline:waiting(b,'assisted'),optimized:waiting(p,'assisted'),unit:'人·分钟'},urgentWait:{baseline:waiting(b,'urgent'),optimized:waiting(p,'urgent'),unit:'人·分钟'}},changes,unassigned:(p?.unassigned||[]).map(h=>explainUnassigned(i,h,E)),coordination,planB:{available:Boolean(d.alternative),scope:'同一输入下另一可行候选；资源失效后须登记变化并重算，旧备选不能直接视为有效',failureScenarios:['road-closure','resource-shortage','shelter-loss']}};
}
module.exports={validateState,diagnostics,catalog,inspectJSON};
