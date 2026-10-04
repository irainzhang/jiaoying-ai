(()=>{
  'use strict';
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let root,map,status,roadLabels,placeLabels,dataPromise,loaded=false,overlay,options={},lastMapKind='',baseStatus='';
  let previousVersion='',previousExercise='',previousFleet={},previousPickLocation=false,ghostLayer,frame=0,playback=null,playNote='模拟播放只展示已发布路线，不修改人员、任务或回执。',candidateLayer;
  const model=()=>window.JiaoyingTransportMap;
  const data=()=>options.state?.data||options.state||{};
  const reduced=()=>window.matchMedia?.('(prefers-reduced-motion: reduce)').matches===true;
  const color=value=>/^#[\da-f]{3,8}$/i.test(value||'')?value:'#3861e9';
  const bounds=[[27.74,120.60],[27.82,120.70]],center=[27.7809878,120.6511821];
  const isWater=f=>f.properties.kind==='water'||f.properties.natural==='water'||Boolean(f.properties.waterway);
  const isRoad=f=>f.properties.kind==='road'||Boolean(f.properties.highway);
  function style(feature){
    const p=feature.properties;
    if(isWater(feature))return {color:'#86b9ce',weight:p.waterway?3:1,fillColor:'#c9e6ef',fillOpacity:1};
    if(p.kind==='rail'||p.railway)return {color:'#8399a9',weight:2,dashArray:'5 4'};
    if(p.kind==='park'||p.leisure||p.landuse)return {color:'#b4cfbb',weight:1,fillColor:'#dbeadf',fillOpacity:.8};
    const major=['motorway','trunk','primary','secondary'].some(type=>p.highway?.startsWith(type));
    return {color:major?'#ffffff':'#f9fcfe',weight:major?4.5:2.2,opacity:1};
  }
  function popup(feature,layer){const p=feature.properties;layer.bindPopup(`<div class="geo-popup"><strong>${escapeHTML(p.name||p['name:zh']||(isRoad(feature)?'未命名道路':'地理要素'))}</strong><p>OpenStreetMap 实际地理要素</p><small>这不是实时路况、灾情或调度任务。</small></div>`);}
  function addLabels(features){
    roadLabels=L.layerGroup();placeLabels=L.layerGroup();const seen=new Set();
    const namedRoads=features.filter(f=>isRoad(f)&&f.properties.name&&f.geometry.type==='LineString').sort((a,b)=>b.geometry.coordinates.length-a.geometry.coordinates.length);
    for(const f of namedRoads){const name=f.properties.name;if(seen.has(name)||seen.size>=28)continue;seen.add(name);const point=f.geometry.coordinates[Math.floor(f.geometry.coordinates.length/2)];if(point[0]<120.60||point[0]>120.70||point[1]<27.74||point[1]>27.82)continue;L.marker([point[1],point[0]],{interactive:false,keyboard:false,icon:L.divIcon({className:'geo-road-label',html:escapeHTML(name),iconSize:[130,18],iconAnchor:[65,9]})}).addTo(roadLabels);}
    const places=features.filter(f=>f.geometry.type==='Point'&&f.properties.name&&f.properties.kind==='place');
    for(const f of places){const point=f.geometry.coordinates,p=f.properties;L.marker([point[1],point[0]],{interactive:false,keyboard:false,icon:L.divIcon({className:'geo-place-label '+(['city','town'].includes(p.place)?'major':''),html:escapeHTML(p.name),iconSize:[160,24],iconAnchor:[80,12]})}).addTo(placeLabels);}
    const riverNames=new Set();for(const f of features.filter(f=>f.properties.waterway==='river'&&f.properties.name&&f.geometry.type==='LineString')){if(riverNames.has(f.properties.name))continue;const points=f.geometry.coordinates.filter(p=>p[0]>=120.61&&p[0]<=120.69&&p[1]>=27.75&&p[1]<=27.81);if(!points.length)continue;riverNames.add(f.properties.name);points.sort((a,b)=>Math.abs(a[0]-center[1])-Math.abs(b[0]-center[1]));const p=points[0];L.marker([p[1],p[0]],{interactive:false,keyboard:false,icon:L.divIcon({className:'geo-water-label',html:escapeHTML(f.properties.name),iconSize:[150,24],iconAnchor:[75,12]})}).addTo(placeLabels);}
    placeLabels.addTo(map);
    const update=()=>{if(map.getZoom()>=14){if(!map.hasLayer(roadLabels))roadLabels.addTo(map);}else if(map.hasLayer(roadLabels))map.removeLayer(roadLabels);};map.on('zoomend',update);update();
  }
  function load(){
    if(!dataPromise)dataPromise=fetch('assets/maps/ruian-urban.geojson').then(r=>{if(!r.ok)throw new Error('地图文件尚未就绪');return r.json();});
    return dataPromise.then(data=>{
      if(loaded)return;loaded=true;
      const features=data.features;
      if(data.type!=='FeatureCollection'||!Array.isArray(features)||!features.length)throw new Error('地图数据格式不完整');
      L.geoJSON({type:'FeatureCollection',features:features.filter(f=>!isRoad(f)&&f.geometry.type!=='Point')},{style,onEachFeature:popup}).addTo(map);
      const roads={type:'FeatureCollection',features:features.filter(isRoad)};
      L.geoJSON(roads,{style:f=>({color:'#c1cdd3',weight:['motorway','trunk','primary','secondary'].some(t=>f.properties.highway?.startsWith(t))?6.2:3.5,opacity:.85}),interactive:false}).addTo(map);
      L.geoJSON(roads,{style,onEachFeature:popup}).addTo(map);addLabels(features);
      const sourceDate=data.metadata?.sourceTime||data.metadata?.timestamp||data.metadata?.osmBaseTime||'2026-09-22';
      baseStatus=`瑞安市城区 · 飞云江两岸 · ${features.length.toLocaleString()} 个公开地理要素 · ${String(sourceDate).slice(0,10)} 数据`;
      root.querySelector('.geo-detail').innerHTML=`<strong>地图来源与演练边界</strong><p>OpenStreetMap contributors，ODbL 1.0；由 Overpass 提取的真实道路、水系与地名，在本机绘制。地图范围是城区局部，不是瑞安市行政边界。</p><p>数据时间：${escapeHTML(sourceDate)}。历史快照不代表最新通行条件。道路演练保留共享节点和单行方向，未覆盖完整转向、限高和临时管制。</p><p>集合点、接收点用途与容量均为演练设定；不表示官方避难场所。通行时间按演练速度计算，不用于安全导航。OSM 许可不等于比赛已审核地图来源。</p><a href="assets/maps/SOURCES.md" target="_blank" rel="noopener">查看来源与原始查询</a> · <a href="assets/maps/ruian-routing.json" target="_blank" rel="noopener">道路演练数据</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">署名与许可</a>`;
      renderOverlay();
    }).catch(error=>{loaded=false;dataPromise=null;status.textContent='真实地图加载失败：'+error.message+'。请点击重试。';root.querySelector('[data-map-retry]').hidden=false;});
  }
  const latLng=point=>[point[1],point[0]];
  function selectionPopup(title,description,label,callback){
    const box=document.createElement('div');box.className='geo-popup';
    box.innerHTML=`<strong>${escapeHTML(title)}</strong><p>${escapeHTML(description)}</p>`;
    if(typeof callback==='function'){const button=document.createElement('button');button.type='button';button.textContent=label;button.className='geo-select';button.addEventListener('click',()=>{map.closePopup();callback();});box.append(button);}
    return box;
  }
  function playbackStatus(){
    if(!root)return;
    const play=root.querySelector('[data-map-play]'),reset=root.querySelector('[data-map-stop]'),note=root.querySelector('.geo-play-note');
    if(play){play.textContent=playback?.running?'暂停模拟播放':playback?.finished?'重新播放运输演练':playback?'继续模拟播放':'播放运输演练';play.setAttribute('aria-pressed',String(!!playback?.running));play.disabled=!model()||!data().activePlan||options.pickLocation===true;}
    if(reset)reset.disabled=!playback;
    if(note)note.textContent=playNote;
  }
  function stopPlayback(note){
    if(frame)cancelAnimationFrame(frame);frame=0;playback=null;
    ghostLayer?.clearLayers();if(note)playNote=note;playbackStatus();
  }
  function pausePlayback(note){
    if(frame)cancelAnimationFrame(frame);frame=0;if(playback)playback.running=false;
    if(note)playNote=note;playbackStatus();
  }
  function animate(timestamp){
    if(!playback?.running)return;
    if(reduced()){stopPlayback('已启用减少动态效果，停止模拟播放并保留静态路线。');return;}
    if(!root?.isConnected||document.hidden){pausePlayback('已暂停：离开地图或页面。播放仅为视觉演练，台账未改变。');return;}
    if(playback.last!==null)playback.elapsed+=Math.min(1000,Math.max(0,timestamp-playback.last));
    playback.last=timestamp;
    let complete=true;
    for(const item of playback.routes){const ratio=Math.min(1,playback.elapsed/item.durationMs),point=model().positionAt(item.path,ratio);if(point)item.marker.setLatLng(latLng(point));if(ratio<1)complete=false;}
    if(complete){playback.finished=true;playNote='模拟播放结束；这是压缩时间的视觉演示，实际执行仍以现场回执为准。';pausePlayback();return;}
    frame=requestAnimationFrame(animate);
  }
  function togglePlayback(){
    if(playback?.running){pausePlayback('模拟播放已暂停 · 非 GPS；现场台账未改变。');return;}
    if(reduced()){playNote='系统已开启减少动态效果，保持静态路线；现场执行仍按回执更新。';playbackStatus();return;}
    if(!data().activePlan||!model()||options.pickLocation)return;
    if(playback?.finished)stopPlayback();
    if(!playback){
      const prepared=model().playbackRoutes(data(),options.routeChoice||'all');
      if(!prepared.routes.length){playNote=prepared.skipped[0]?.reason||'没有可播放的剩余执行路线；请先核对并发布安排。';playbackStatus();return;}
      if(!ghostLayer)ghostLayer=L.layerGroup().addTo(map);else ghostLayer.clearLayers();
      playback={running:false,elapsed:0,last:null,routes:prepared.routes.map(item=>({...item,marker:L.marker(latLng(item.path.points[0]),{interactive:false,keyboard:false,zIndexOffset:400,icon:L.divIcon({className:'geo-replay-vehicle',html:`<span style="--vehicle-color:${color(item.color)}">${escapeHTML(item.vehicleId)}<small>模拟</small></span>`,iconSize:[42,38],iconAnchor:[21,19]})}).addTo(ghostLayer)}))};
      playNote='模拟播放已发布路线 · 非 GPS · 时间已压缩；'+(prepared.skipped.length?`${prepared.skipped.length} 条受阻路线未播放；`:'')+'不改变任何任务进度。';
    }else playNote='继续模拟播放 · 非 GPS；不改变任何任务进度。';
    playback.running=true;playback.last=null;playbackStatus();frame=requestAnimationFrame(animate);
  }
  function renderControls(d,isGeo,summary,drafts){
    const controls=root.querySelector('.geo-transport-controls');controls.hidden=!isGeo;
    if(!isGeo)return;
    const choice=options.routeChoice||'all';
    root.querySelector('.geo-route-filter').innerHTML=[{id:'all',name:'全部车辆'},...(d.scenario.vehicles||[])].map(v=>`<button type="button" data-map-route="${escapeHTML(v.id)}" aria-pressed="${choice===v.id}" style="${v.color?'--route-color:'+color(v.color):''}">${escapeHTML(v.name)}</button>`).join('');
    const unknown=root.querySelector('.geo-needs-location');
    const draftPeople=[...drafts.unknown,...drafts.points.filter(p=>!p.nodeId)].reduce((n,r)=>n+r.people,0);
    unknown.hidden=!summary.unknown.length&&!draftPeople;
    unknown.innerHTML=(summary.unknown.length?`<strong>待定位 ${summary.unknownPeople} 人 / ${summary.unknown.length} 批</strong><select data-map-unlocated aria-label="选择待定位需求">${summary.unknown.map(r=>`<option value="${escapeHTML(r.batchId)}">${escapeHTML(r.name)} · ${r.people} 人${r.status==='pending'?'（待核实）':''}</option>`).join('')}</select>${typeof options.onLocateDemand==='function'?'<button type="button" data-map-locate>在地图定位</button>':''}`:'')+(draftPeople?`<span>名单中另有 ${draftPeople} 人地点待确认；候选坐标不代表已匹配道路。</span>`:'');
    root.querySelector('.geo-pick-hint').hidden=!options.pickLocation;
    playbackStatus();
  }
  function chooseLocation(longitude,latitude){
    if(!options.pickLocation||!model())return;
    const d=data(),pick=model().nearest(d.scenario?.nodes,longitude,latitude,d.scenario?.edges);
    if(!pick){root.querySelector('.geo-coordinate').textContent='当前情景没有可匹配的真实道路节点，请先使用真实道路情景。';return;}
    if(!candidateLayer)candidateLayer=L.layerGroup().addTo(map);else candidateLayer.clearLayers();
    L.marker([latitude,longitude],{keyboard:false,icon:L.divIcon({className:'geo-candidate-marker',html:'<span>待确认</span>',iconSize:[58,28],iconAnchor:[29,14]})}).addTo(candidateLayer);
    L.polyline([[latitude,longitude],[pick.nodeLatitude,pick.nodeLongitude]],{color:'#c77d17',weight:2,dashArray:'3 6',interactive:false}).addTo(candidateLayer);
    root.querySelector('.geo-coordinate').textContent=`候选点 ${longitude.toFixed(5)}, ${latitude.toFixed(5)} · 距道路接入点 ${Math.round(pick.distanceMeters)} 米，等待人工核对`;
    options.onChooseLocation?.(pick);
  }
  function clearCandidate(){
    candidateLayer?.clearLayers();
    if(root)root.querySelector('.geo-coordinate').textContent='点击地图查看经纬度';
  }
  function renderOverlay(){
    if(!map)return;
    if(previousPickLocation&&!options.pickLocation)clearCandidate();
    previousPickLocation=!!options.pickLocation;
    if(!overlay)overlay=L.layerGroup().addTo(map);else overlay.clearLayers();
    const d=options.state?.data||options.state,scenario=d?.scenario,isGeo=scenario?.region?.mapKind==='osm-road-network';
    const legend=root.querySelector('.geo-legend');legend.hidden=!isGeo;
    status.textContent=baseStatus||'正在读取本地真实地图数据…';
    if(!model()){root.querySelector('.geo-transport-controls').hidden=true;return;}
    const summary=model().aggregate(d),drafts=model().draftPoints(d||{},options.draftDemands||[]);
    const signature=model().versionKey(options.state,options.routeChoice,options.plan,options.pickLocation)+JSON.stringify(options.draftDemands||[]);
    if(previousVersion&&previousVersion!==signature){stopPlayback('任务、回执或地图视图已更新，模拟播放已重置；请按最新安排查看。');candidateLayer?.clearLayers();}
    previousVersion=signature;renderControls(d||{},isGeo,summary,drafts);
    if(previousExercise!==d?.exerciseId){previousFleet={};previousExercise=d?.exerciseId;}
    if(!isGeo){lastMapKind='';return;}
    const scenarioBounds=scenario.region.bounds;
    if(lastMapKind!=='osm-road-network'&&scenarioBounds){map.fitBounds([[scenarioBounds[1],scenarioBounds[0]],[scenarioBounds[3],scenarioBounds[2]]],{padding:[32,32],animate:false});lastMapKind='osm-road-network';}
    const closed=scenario.edges.filter(edge=>!edge.open).length;
    status.textContent=`真实道路演练 · ${scenario.nodes.length} 节点 / ${scenario.edges.length} 路段 · ${closed} 段演练封闭 · 业务用途 / 容量 / 时间为模拟`;
    const roads=new Map(scenario.edges.map(edge=>[edge.id,edge])),nodes=new Map(scenario.nodes.map(node=>[node.id,node]));
    for(const edge of scenario.edges){
      if(!Array.isArray(edge.geometry)||edge.geometry.length<2)continue;
      const description=`${edge.directed?'单行方向 '+edge.from+' → '+edge.to:'双向道路'} · ${Math.round(edge.lengthMeters||0)} 米 · 演练 ${edge.minutes} 分钟。${edge.open?'演练中开放':'已核实演练封闭'}；OSM way ${(edge.osmWayIds||[]).join(' / ')}。不代表实时路况。`;
      L.polyline(edge.geometry.map(latLng),{color:edge.open?'#62b9c9':'#ff5d70',weight:edge.open?4:7,opacity:edge.open?.75:1,dashArray:edge.open?null:'9 5',bubblingMouseEvents:false})
        .bindPopup(selectionPopup(edge.label||edge.id,description,options.pickLocation?'选择道路附近候选位置':'选中此路段上报',()=>{if(options.pickLocation){const point=edge.geometry[Math.floor(edge.geometry.length/2)];chooseLocation(point[0],point[1]);}else options.onSelectEdge?.(edge.id);})).addTo(overlay);
      if(edge.directed){
        const mid=Math.max(1,Math.floor(edge.geometry.length/2)),a=edge.geometry[mid-1],b=edge.geometry[mid];
        const angle=Math.atan2(-(b[1]-a[1]),(b[0]-a[0])*Math.cos(a[1]*Math.PI/180))*180/Math.PI;
        L.marker(latLng([(a[0]+b[0])/2,(a[1]+b[1])/2]),{interactive:false,keyboard:false,icon:L.divIcon({className:'geo-direction',html:`<span style="display:block;transform:rotate(${angle}deg)">➤</span>`,iconSize:[16,16],iconAnchor:[8,8]})}).addTo(overlay);
      }
    }
    const selectedPlan=options.plan||d.plan||d.activePlan;
    const routePlans=d.activePlan&&selectedPlan?.id!==d.activePlan.id?[d.activePlan,selectedPlan]:[selectedPlan];
    for(const displayPlan of routePlans.filter(Boolean))for(const route of displayPlan.routes||[]){
      if(options.routeChoice&&options.routeChoice!=='all'&&route.vehicleId!==options.routeChoice)continue;
      const vehicle=scenario.vehicles.find(v=>v.id===route.vehicleId),color=vehicle?.color||'#ffc96c';
      for(const segment of route.segments||[])for(const edgeId of segment.edges||[]){
        const edge=roads.get(edgeId);if(!edge?.geometry)continue;
        // An older active plan can contain a newly closed road. Keep that road
        // red, label the blocked plan, and never paint it as a usable route.
        if(!edge.open)continue;
        const published=displayPlan.id&&displayPlan.id===d.activePlan?.id;
        L.polyline(edge.geometry.map(latLng),{color,weight:published&&routePlans.length>1?4:5,opacity:published&&routePlans.length>1 ? .55 : .95,dashArray:published?null:'10 4',interactive:false}).addTo(overlay);
      }
    }
    for(const node of scenario.nodes.filter(n=>n.kind!=='junction'||summary.nodes[n.id])){
      const shelter=scenario.shelters.find(sh=>sh.id===node.id),people=scenario.households.filter(h=>h.node===node.id&&d.stage[h.id]!=='superseded'),count=people.reduce((sum,h)=>sum+h.people,0);
      const values=summary.nodes[node.id]||{},stages=`待接 ${values.waiting||0} · 车上 ${values.boarded||0} · 到达 ${values.arrived||0} · 已核验 ${values.verified||0}${values.pending?' · 待核实 '+values.pending:''}`;
      const text=(node.kind==='home'?`${count} 人关联此演练集合点` : node.kind==='shelter'?`演练容量 ${shelter?.capacity||0} 人，已登记 ${d.occupancy[node.id]||0} 人；${shelter?.available?'开放':'停用'}`:'车辆在此集结，位置按登记更新')+'。'+stages+(values.uploaded?`。其中上传名单 ${values.uploaded} 人`:'');
      const mini=[values.waiting?'待接 '+values.waiting:'',values.boarded?'车上 '+values.boarded:'',values.arrived?'到达 '+values.arrived:'',values.verified?'核验 '+values.verified:'',values.pending?'待核实 '+values.pending:''].filter(Boolean).join(' · ');
      L.marker([node.latitude,node.longitude],{bubblingMouseEvents:false,keyboard:true,title:node.label+' '+stages,icon:L.divIcon({className:'geo-business-marker '+node.kind+(values.uploaded?' geo-uploaded':''),html:`<span>${escapeHTML(node.id)}${values.uploaded?'<b>上传</b>':''}</span>${mini?`<small>${escapeHTML(mini)}</small>`:''}`,iconSize:[110,48],iconAnchor:[55,15]})})
        .bindTooltip(escapeHTML(node.label),{direction:'top'})
        .bindPopup(selectionPopup(node.label,`${text}。坐标来自道路节点 ${node.osmNodeId}，业务用途模拟，非官方设施。`,options.pickLocation?'将此节点作为候选位置':'选中此点位上报',()=>options.pickLocation?chooseLocation(node.longitude,node.latitude):options.onSelectNode?.(node.id))).addTo(overlay);
    }
    for(const point of summary.uploadPoints){
      const node=nodes.get(point.nodeId);if(!node)continue;
      const meters=model().distance([point.longitude,point.latitude],[node.longitude,node.latitude]);if(meters<3)continue;
      L.polyline([[point.latitude,point.longitude],[node.latitude,node.longitude]],{color:'#c88826',weight:1.5,dashArray:'3 5',interactive:false}).addTo(overlay);
      L.marker([point.latitude,point.longitude],{keyboard:true,title:point.name+' 上传坐标',icon:L.divIcon({className:'geo-upload-coordinate',html:'<span>上传坐标</span>',iconSize:[60,25],iconAnchor:[30,13]})}).bindPopup(selectionPopup(point.name,`${point.people} 人 · 原上传 WGS84 坐标；关联道路接入节点 ${point.nodeId}，相距约 ${Math.round(meters)} 米。虚线只表示位置对应，不是可步行或可通车路线。`)).addTo(overlay);
    }
    const draftGroups=new Map();
    for(const point of drafts.points){const key=point.longitude+'|'+point.latitude+'|'+(point.nodeId||'');if(!draftGroups.has(key))draftGroups.set(key,{...point,people:0,rows:0});const group=draftGroups.get(key);group.people+=point.people;group.rows++;}
    for(const point of draftGroups.values()){
      L.marker([point.latitude,point.longitude],{keyboard:true,title:'待导入 '+point.name,icon:L.divIcon({className:'geo-draft-demand',html:`<span>待导入 ${point.people} 人</span>`,iconSize:[104,30],iconAnchor:[52,15]})}).bindPopup(selectionPopup(point.name,`${point.rows} 行名单，共 ${point.people} 人尚未导入台账。${point.nodeId?'已识别道路接入点 '+point.nodeId:'只显示候选坐标，地点仍待匹配和人工确认'}；当前安排与任务未改变。`)).addTo(overlay);
    }
    const moved=[];
    for(const vehicle of scenario.vehicles){
      const position=d.fleet[vehicle.id],node=nodes.get(position?.node);if(!node)continue;
      const prior=previousFleet[vehicle.id],changed=prior&&prior!==position.node;if(changed)moved.push(vehicle.name+' → '+node.label);
      const colocated=scenario.vehicles.filter(v=>d.fleet[v.id]?.node===position.node).map(v=>v.id),index=colocated.indexOf(vehicle.id);
      L.marker([node.latitude,node.longitude],{keyboard:true,title:vehicle.name+' 回执登记位置',zIndexOffset:150,icon:L.divIcon({className:'geo-vehicle-marker'+(changed&&!reduced()?' geo-receipt-updated':''),html:`<span style="border-color:${color(vehicle.color)};transform:translate(${(index-(colocated.length-1)/2)*30}px,-29px)">${escapeHTML(vehicle.id)}</span>`,iconSize:[32,25],iconAnchor:[16,13]})})
        .bindPopup(selectionPopup(vehicle.name,`${node.label}；${position.finished?'本趟完成':vehicle.available?'可执行任务':'车辆不可用'}。车载 ${position.onboard.reduce((sum,id)=>sum+(scenario.households.find(h=>h.id===id)?.people||0),0)} 人；按节点登记更新，非实时 GPS。`,'查看登记点位',()=>options.onSelectNode?.(node.id))).addTo(overlay);
    }
    if(moved.length)root.querySelector('.geo-coordinate').textContent='新现场回执：'+moved.join('；')+'（登记位置，非 GPS）';
    previousFleet=Object.fromEntries(scenario.vehicles.map(v=>[v.id,d.fleet[v.id]?.node]));
    const blocked=(selectedPlan?.routes||[]).filter(route=>(route.segments||[]).some(seg=>seg.edges.some(id=>!roads.get(id)?.open))).length;
    legend.innerHTML=`<b>同一份任务与回执</b><span>虚线：草案 · 实线：已发布路线</span><span>橙色空心：待导入 · 金色：上传需求</span><span>红线：封路 · 车辆：回执登记位置</span>${blocked?`<strong>${blocked} 条旧路线含封闭路段，请复核</strong>`:''}`;
  }
  function create(container){
    root=document.createElement('div');root.className='real-map-root';root.innerHTML='<div class="geo-transport-controls" hidden><div class="geo-route-filter" role="group" aria-label="筛选车辆路线"></div><div class="geo-play-controls"><button type="button" data-map-play aria-pressed="false">播放运输演练</button><button type="button" data-map-stop disabled>重置播放</button><span class="geo-play-note" role="status"></span></div><div class="geo-needs-location" hidden></div><p class="geo-pick-hint" hidden>正在选择需求位置：点击地图返回候选坐标与道路接入点，再到需求卡核对确认。</p></div><div class="geo-stage"><div class="real-map-canvas" role="region" aria-label="瑞安市城区真实地理地图"></div><div class="geo-tools"><button type="button" data-map-home>回到当前片区</button><button type="button" data-map-info aria-expanded="false">地图来源</button><button type="button" data-map-retry hidden>重试加载</button></div><div class="geo-detail" hidden></div><div class="geo-coordinate" aria-live="polite">点击地图查看经纬度</div><div class="geo-legend" hidden></div><div class="geo-status" role="status">正在读取本地真实地图数据…</div></div>';
    container.replaceChildren(root);status=root.querySelector('.geo-status');
    map=L.map(root.querySelector('.real-map-canvas'),{zoomControl:false,scrollWheelZoom:false,minZoom:12,maxZoom:17,maxBounds:[[27.728,120.585],[27.832,120.715]],maxBoundsViscosity:1,attributionControl:true});
    L.control.zoom({zoomInTitle:'放大地图',zoomOutTitle:'缩小地图'}).addTo(map);L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');map.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL');
    map.setView(center,13);
    root.querySelector('[data-map-home]').addEventListener('click',()=>{const d=options.state?.data||options.state,b=d?.scenario?.region?.bounds;map.fitBounds(b?[[b[1],b[0]],[b[3],b[2]]]:bounds,{padding:[25,25],animate:false});});
    root.querySelector('[data-map-info]').addEventListener('click',e=>{const box=root.querySelector('.geo-detail');box.hidden=!box.hidden;e.currentTarget.setAttribute('aria-expanded',String(!box.hidden));});
    root.querySelector('[data-map-retry]').addEventListener('click',e=>{e.currentTarget.hidden=true;load();});
    root.querySelector('[data-map-play]').addEventListener('click',togglePlayback);
    root.querySelector('[data-map-stop]').addEventListener('click',()=>stopPlayback('模拟播放已重置；现场任务与回执保持不变。'));
    root.addEventListener('click',event=>{const chosen=event.target.closest('[data-map-route]');if(chosen){const id=chosen.dataset.mapRoute;options.routeChoice=id;stopPlayback('已切换车辆；播放将按所选车辆的最新发布路线开始。');renderOverlay();options.onRouteChange?.(id);return;}if(event.target.closest('[data-map-locate]'))options.onLocateDemand?.(root.querySelector('[data-map-unlocated]').value);});
    map.on('click',event=>{const {lng:longitude,lat:latitude}=event.latlng;root.querySelector('.geo-coordinate').textContent=`经度 ${longitude.toFixed(5)} · 纬度 ${latitude.toFixed(5)}（WGS84）`;if(options.pickLocation)chooseLocation(longitude,latitude);else options.onSelectCoordinate?.({longitude,latitude});});
    map.on('focus',()=>map.scrollWheelZoom.enable());map.on('blur',()=>map.scrollWheelZoom.disable());
    load();
  }
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pausePlayback('页面已离开前台，模拟播放暂停。');});
  window.RuianMap={mount(container,nextOptions={}){options=nextOptions;if(!window.L){container.textContent='地图组件未加载，请重新刷新网页。';return;}if(!root)create(container);else container.replaceChildren(root);renderOverlay();requestAnimationFrame(()=>map.invalidateSize({pan:false}));},update(nextOptions={}){options={...options,...nextOptions};renderOverlay();},suspend(){stopPlayback('地图已切换，模拟播放已重置。');clearCandidate();previousPickLocation=false;}};
})();
