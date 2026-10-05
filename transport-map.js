(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./place-directory.js'));else root.JiaoyingTransportMap=factory(root.JiaoyingPlaceDirectory);})(typeof globalThis!=='undefined'?globalThis:this,function(directory){
  'use strict';
  const coordinate=(longitude,latitude)=>typeof longitude==='number'&&typeof latitude==='number'&&Number.isFinite(longitude)&&Number.isFinite(latitude)&&Math.abs(longitude)<=180&&Math.abs(latitude)<=90;
  function distance(a,b){const r=Math.PI/180,dy=(b[1]-a[1])*r,dx=(b[0]-a[0])*r,q=Math.sin(dy/2)**2+Math.cos(a[1]*r)*Math.cos(b[1]*r)*Math.sin(dx/2)**2;return 6371000*2*Math.atan2(Math.sqrt(Math.min(1,q)),Math.sqrt(Math.max(0,1-q)));}
  function nearest(nodes,longitude,latitude,edges){
    if(!coordinate(longitude,latitude))return null;
    const accessible=edges?new Set(edges.filter(e=>e.open).flatMap(e=>[e.from,e.to])):null;
    let result=null;
    for(const n of nodes||[]){if(!coordinate(n.longitude,n.latitude)||(accessible&&!accessible.has(n.id)))continue;const meters=distance([longitude,latitude],[n.longitude,n.latitude]);if(!result||meters<result.distanceMeters)result={nodeId:n.id,longitude,latitude,nodeLongitude:n.longitude,nodeLatitude:n.latitude,distanceMeters:meters};}
    return result;
  }
  function aggregate(data){
    const d=data||{},s=d.scenario||{},nodes=new Map((s.nodes||[]).map(n=>[n.id,n])),reports=new Map((d.villageReports||[]).map(r=>[r.id,r]));
    const stats={},unknown=[],uploadPoints=[];
    function add(nodeId,key,people,uploaded){if(!nodes.has(nodeId))return false;const row=stats[nodeId]||(stats[nodeId]={nodeId,waiting:0,boarded:0,arrived:0,verified:0,pending:0,uploaded:0});row[key]+=people;if(uploaded)row.uploaded+=people;return true;}
    const isUpload=r=>r&&(r.intakeSource==='file'||r.inputSource==='file'||r.source==='file');
    const pickups=new Map((d.villages||[]).flatMap(v=>(v.pickups||[]).map(p=>[v.id+'|'+p.id,p])));
    const fleet=Object.entries(d.fleet||{});
    for(const h of s.households||[]){
      const stage=d.stage?.[h.id]||'waiting';if(stage==='superseded')continue;
      const r=reports.get(h.sourceBatchId),uploaded=isUpload(r),people=Number(h.people)||0;
      let nodeId=h.node,key=stage;
      if(stage==='boarded')nodeId=fleet.find(([,f])=>(f.onboard||[]).includes(h.id))?.[1].node;
      if(stage==='arrived'||stage==='verified'){
        const vehicle=fleet.find(([,f])=>(f.delivered||[]).includes(h.id));
        nodeId=vehicle?.[1].node||d.activePlan?.routes?.find(route=>(route.passengerIds||[]).includes(h.id))?.shelterId;
      }
      if(!['waiting','boarded','arrived','verified'].includes(key))continue;
      if(!add(nodeId,key,people,uploaded))unknown.push({batchId:r?.id||h.id,name:h.name||h.id,people,status:stage,reason:'执行台账尚无可在当前路网显示的位置'});
    }
    for(const r of reports.values()){
      if(!['pending','accepted'].includes(r.status)||r.mode==='snapshot'||r.supersededBy||!r.people)continue;
      const pickup=pickups.get(r.villageId+'|'+r.pickupId),nodeId=r.locationNodeId||pickup?.locationNodeId||pickup?.node;
      const located=r.locationStatus!=='pending'&&pickup?.locationStatus!=='pending'&&nodes.has(nodeId);
      // Materialized household groups have already been counted above.
      if(!(r.householdIds||[]).length){
        const key=r.status==='pending'?'pending':'waiting';
        if(!located)unknown.push({batchId:r.id,name:[r.villageName||r.villageId,r.pickupName||pickup?.name].filter(Boolean).join(' · ')||r.id,people:r.people,status:r.status,reason:r.locationReason||'地点待人工定位，尚未生成接人路线'});
        else add(nodeId,key,r.people,isUpload(r));
      }
      const longitude=r.longitude??pickup?.longitude,latitude=r.latitude??pickup?.latitude;
      if(isUpload(r)&&located&&coordinate(longitude,latitude))uploadPoints.push({batchId:r.id,nodeId,longitude,latitude,people:r.people,name:[r.villageName||r.villageId,r.pickupName||pickup?.name].filter(Boolean).join(' · '),status:r.status});
    }
    return {nodes:stats,unknown,unknownPeople:unknown.reduce((n,r)=>n+r.people,0),uploadPoints};
  }
  function routeGeometry(scenario,route){
    const edges=new Map((scenario?.edges||[]).map(e=>[e.id,e])),nodes=new Map((scenario?.nodes||[]).map(n=>[n.id,n]));
    const points=[];let minutes=0;
    for(const segment of route?.segments||[]){
      if(!Array.isArray(segment.nodes)||segment.nodes.length!==(segment.edges||[]).length+1)return {ok:false,reason:'路线节点与路段不一致',points:[]};
      for(let i=0;i<(segment.edges||[]).length;i++){
        const edge=edges.get(segment.edges[i]),from=segment.nodes[i],to=segment.nodes[i+1];
        if(!edge?.open)return {ok:false,reason:'执行路线含已封闭或缺失路段，请先复核',points:[]};
        const forward=edge.from===from&&edge.to===to,reverse=!edge.directed&&edge.to===from&&edge.from===to;
        if(!forward&&!reverse)return {ok:false,reason:'路线与单行方向不一致',points:[]};
        const line=(forward?edge.geometry:[...(edge.geometry||[])].reverse());
        if(!Array.isArray(line)||line.length<2||line.some(p=>!coordinate(p?.[0],p?.[1])))return {ok:false,reason:'路段缺少有效道路几何',points:[]};
        const a=nodes.get(from),b=nodes.get(to);
        if(!a||!b||distance(line[0],[a.longitude,a.latitude])>2||distance(line.at(-1),[b.longitude,b.latitude])>2)return {ok:false,reason:'道路几何端点与路线不一致',points:[]};
        if(points.length&&distance(points.at(-1),line[0])>2)return {ok:false,reason:'路线不连续，不能播放',points:[]};
        line.forEach(p=>{if(!points.length||distance(points.at(-1),p)>.01)points.push([...p]);});
      }
      minutes+=Number(segment.minutes)||0;
    }
    if(points.length<2)return {ok:false,reason:'没有可播放的剩余道路',points:[]};
    const lengths=[0];for(let i=1;i<points.length;i++)lengths.push(lengths.at(-1)+distance(points[i-1],points[i]));
    return {ok:true,points,lengths,lengthMeters:lengths.at(-1),minutes};
  }
  function draftPoints(d,rows){
    const points=[],unknown=[],nodes=new Map((d.scenario?.nodes||[]).map(n=>[n.id,n]));
    for(const [index,row] of (rows||[]).entries()){
      const pickup=(directory?.pickups(d,row.villageId)||d.villages?.find(v=>v.id===row.villageId)?.pickups||[]).find(p=>p.id===row.pickupId);
      const nodeId=row.locationNodeId||pickup?.locationNodeId||pickup?.node,node=nodes.get(nodeId);
      const hasCoordinates=coordinate(row.longitude,row.latitude);
      const explicitPending=row.locationStatus==='pending'||pickup?.locationStatus==='pending';
      const longitude=hasCoordinates?row.longitude:explicitPending?null:pickup?.longitude??node?.longitude;
      const latitude=hasCoordinates?row.latitude:explicitPending?null:pickup?.latitude??node?.latitude;
      const item={index,people:Number(row.people)||0,name:[row.villageName||row.villageId,row.pickupName||pickup?.name||row.pickupId].filter(Boolean).join(' · ')||'名单第 '+(index+1)+' 行',nodeId:!explicitPending&&node?nodeId:null,longitude,latitude};
      if(coordinate(longitude,latitude))points.push(item);else unknown.push(item);
    }
    return {points,unknown};
  }
  function positionAt(path,fraction){
    if(!path?.ok||!path.points?.length)return null;
    const p=Math.max(0,Math.min(1,Number(fraction)||0)),target=path.lengthMeters*p;
    if(p===1)return [...path.points.at(-1)];
    for(let i=1;i<path.points.length;i++){if(path.lengths[i]>=target){const span=path.lengths[i]-path.lengths[i-1],r=span?(target-path.lengths[i-1])/span:0,a=path.points[i-1],b=path.points[i];return [a[0]+(b[0]-a[0])*r,a[1]+(b[1]-a[1])*r];}}
    return [...path.points[0]];
  }
  function playbackRoutes(d,choice='all'){
    const routes=[],skipped=[];
    for(const route of d.activePlan?.routes||[]){
      if(choice!=='all'&&route.vehicleId!==choice)continue;
      const fleet=d.fleet?.[route.vehicleId];if(!fleet||fleet.finished||!route.people||route.holding)continue;
      const first=(route.stops||[]).findIndex(stop=>d.stage?.[stop.id]==='waiting'),offset=first<0?(route.stops||[]).length:first;
      const segments=(route.segments||[]).slice(offset);
      if(!segments.length||segments[0].from!==fleet.node){skipped.push({vehicleId:route.vehicleId,reason:'执行路线与最新回执位置不一致，请复核'});continue;}
      const path=routeGeometry(d.scenario,{segments});
      if(!path.ok){skipped.push({vehicleId:route.vehicleId,reason:path.reason});continue;}
      const vehicle=d.scenario.vehicles.find(v=>v.id===route.vehicleId);
      if(vehicle?.available===false||d.scenario.shelters.find(s=>s.id===route.shelterId)?.available===false){skipped.push({vehicleId:route.vehicleId,reason:'车辆或接收点停用，请先协调'});continue;}
      routes.push({vehicleId:route.vehicleId,name:vehicle?.name||route.vehicleId,color:vehicle?.color||'#3861e9',path,durationMs:Math.max(5000,Math.min(30000,path.minutes*500))});
    }
    return {routes,skipped};
  }
  function versionKey(state,choice,plan,pickLocation){const d=state?.data||state||{};return JSON.stringify([state?.session,d.exerciseId,d.revision,d.inputVersion,d.executionVersion,d.activePlan?.id,plan?.id,d.scenario?.region?.mapKind,choice,!!pickLocation]);}
  return {coordinate,distance,nearest,aggregate,draftPoints,routeGeometry,positionAt,playbackRoutes,versionKey};
});
