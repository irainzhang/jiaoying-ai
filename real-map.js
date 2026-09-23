(()=>{
  'use strict';
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let root,map,status,roadLabels,placeLabels,dataPromise,loaded=false,overlay,options={},lastMapKind='',baseStatus='';
  const bounds=[[27.74,120.60],[27.82,120.70]],center=[27.7809878,120.6511821];
  const isWater=f=>f.properties.kind==='water'||f.properties.natural==='water'||Boolean(f.properties.waterway);
  const isRoad=f=>f.properties.kind==='road'||Boolean(f.properties.highway);
  function style(feature){
    const p=feature.properties;
    if(isWater(feature))return {color:'#286077',weight:p.waterway?3:1,fillColor:'#17435c',fillOpacity:1};
    if(p.kind==='rail'||p.railway)return {color:'#577084',weight:2,dashArray:'5 4'};
    if(p.kind==='park'||p.leisure||p.landuse)return {color:'#285050',weight:1,fillColor:'#1b3c3d',fillOpacity:.8};
    const major=['motorway','trunk','primary','secondary'].some(type=>p.highway?.startsWith(type));
    return {color:major?'#62859b':'#35576b',weight:major?4.5:2.2,opacity:1};
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
      L.geoJSON(roads,{style:f=>({color:['motorway','trunk','primary','secondary'].some(t=>f.properties.highway?.startsWith(t))?'#102333':'#102333',weight:['motorway','trunk','primary','secondary'].some(t=>f.properties.highway?.startsWith(t))?6.2:3.5,opacity:.85}),interactive:false}).addTo(map);
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
  function renderOverlay(){
    if(!map)return;
    if(!overlay)overlay=L.layerGroup().addTo(map);else overlay.clearLayers();
    const d=options.state?.data||options.state,scenario=d?.scenario,isGeo=scenario?.region?.mapKind==='osm-road-network';
    const legend=root.querySelector('.geo-legend');legend.hidden=!isGeo;
    status.textContent=baseStatus||'正在读取本地真实地图数据…';
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
        .bindPopup(selectionPopup(edge.label||edge.id,description,'选中此路段上报',()=>options.onSelectEdge?.(edge.id))).addTo(overlay);
      if(edge.directed){
        const mid=Math.max(1,Math.floor(edge.geometry.length/2)),a=edge.geometry[mid-1],b=edge.geometry[mid];
        const angle=Math.atan2(-(b[1]-a[1]),(b[0]-a[0])*Math.cos(a[1]*Math.PI/180))*180/Math.PI;
        L.marker(latLng([(a[0]+b[0])/2,(a[1]+b[1])/2]),{interactive:false,keyboard:false,icon:L.divIcon({className:'geo-direction',html:`<span style="display:block;transform:rotate(${angle}deg)">➤</span>`,iconSize:[16,16],iconAnchor:[8,8]})}).addTo(overlay);
      }
    }
    const selectedPlan=options.plan||d.plan||d.activePlan;
    for(const route of selectedPlan?.routes||[]){
      if(options.routeChoice&&options.routeChoice!=='all'&&route.vehicleId!==options.routeChoice)continue;
      const vehicle=scenario.vehicles.find(v=>v.id===route.vehicleId),color=vehicle?.color||'#ffc96c';
      for(const segment of route.segments||[])for(const edgeId of segment.edges||[]){
        const edge=roads.get(edgeId);if(!edge?.geometry)continue;
        // An older active plan can contain a newly closed road. Keep that road
        // red, label the blocked plan, and never paint it as a usable route.
        if(!edge.open)continue;
        L.polyline(edge.geometry.map(latLng),{color,weight:5,opacity:.95,dashArray:selectedPlan===d.activePlan?null:'10 4',interactive:false}).addTo(overlay);
      }
    }
    for(const node of scenario.nodes.filter(n=>n.kind!=='junction')){
      const shelter=scenario.shelters.find(sh=>sh.id===node.id),people=scenario.households.filter(h=>h.node===node.id&&d.stage[h.id]!=='superseded'),count=people.reduce((sum,h)=>sum+h.people,0);
      const text=node.kind==='home'?`${count} 人关联此演练集合点` : node.kind==='shelter'?`演练容量 ${shelter?.capacity||0} 人，已登记 ${d.occupancy[node.id]||0} 人；${shelter?.available?'开放':'停用'}`:'车辆在此集结，位置按登记更新';
      L.marker([node.latitude,node.longitude],{bubblingMouseEvents:false,keyboard:true,title:node.label,icon:L.divIcon({className:'geo-business-marker '+node.kind,html:`<span>${escapeHTML(node.id)}</span>`,iconSize:[34,30],iconAnchor:[17,15]})})
        .bindTooltip(escapeHTML(node.label),{direction:'top'})
        .bindPopup(selectionPopup(node.label,`${text}。坐标来自道路节点 ${node.osmNodeId}，业务用途模拟，非官方设施。`,'选中此点位上报',()=>options.onSelectNode?.(node.id))).addTo(overlay);
    }
    for(const vehicle of scenario.vehicles){
      const position=d.fleet[vehicle.id],node=nodes.get(position?.node);if(!node)continue;
      const colocated=scenario.vehicles.filter(v=>d.fleet[v.id]?.node===position.node).map(v=>v.id),index=colocated.indexOf(vehicle.id);
      L.marker([node.latitude,node.longitude],{keyboard:true,title:vehicle.name+' 登记位置',zIndexOffset:150,icon:L.divIcon({className:'geo-vehicle-marker',html:`<span style="border-color:${/^#[\da-f]{3,8}$/i.test(vehicle.color)?vehicle.color:'#559af5'};transform:translate(${(index-(colocated.length-1)/2)*30}px,-29px)">${escapeHTML(vehicle.id)}</span>`,iconSize:[32,25],iconAnchor:[16,13]})})
        .bindPopup(selectionPopup(vehicle.name,`${node.label}；${position.finished?'本趟完成':vehicle.available?'可执行任务':'车辆不可用'}。车载 ${position.onboard.reduce((sum,id)=>sum+(scenario.households.find(h=>h.id===id)?.people||0),0)} 人；按节点登记更新，非实时 GPS。`,'查看登记点位',()=>options.onSelectNode?.(node.id))).addTo(overlay);
    }
    const blocked=(selectedPlan?.routes||[]).filter(route=>(route.segments||[]).some(seg=>seg.edges.some(id=>!roads.get(id)?.open))).length;
    legend.innerHTML=`<b>真实道路演练</b><span>● 集合点 / 接收点用途模拟</span><span>➤ 公开快照单行方向</span><span>虚线：草案 · 实线：执行路线</span><span>红线：演练封路 · 车辆：登记位置</span>${blocked?`<strong>${blocked} 条旧路线含封闭路段，请复核</strong>`:''}`;
  }
  function create(container){
    root=document.createElement('div');root.className='real-map-root';root.innerHTML='<div class="real-map-canvas" role="region" aria-label="瑞安市城区真实地理地图"></div><div class="geo-tools"><button type="button" data-map-home>回到当前片区</button><button type="button" data-map-info aria-expanded="false">地图来源</button><button type="button" data-map-retry hidden>重试加载</button></div><div class="geo-detail" hidden></div><div class="geo-coordinate" aria-live="polite">点击地图查看经纬度</div><div class="geo-legend" hidden></div><div class="geo-status" role="status">正在读取本地真实地图数据…</div>';
    container.replaceChildren(root);status=root.querySelector('.geo-status');
    map=L.map(root.querySelector('.real-map-canvas'),{zoomControl:false,scrollWheelZoom:false,minZoom:12,maxZoom:17,maxBounds:[[27.728,120.585],[27.832,120.715]],maxBoundsViscosity:1,attributionControl:true});
    L.control.zoom({zoomInTitle:'放大地图',zoomOutTitle:'缩小地图'}).addTo(map);L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');map.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL');
    map.setView(center,13);
    root.querySelector('[data-map-home]').addEventListener('click',()=>{const d=options.state?.data||options.state,b=d?.scenario?.region?.bounds;map.fitBounds(b?[[b[1],b[0]],[b[3],b[2]]]:bounds,{padding:[25,25],animate:false});});
    root.querySelector('[data-map-info]').addEventListener('click',e=>{const box=root.querySelector('.geo-detail');box.hidden=!box.hidden;e.currentTarget.setAttribute('aria-expanded',String(!box.hidden));});
    root.querySelector('[data-map-retry]').addEventListener('click',e=>{e.currentTarget.hidden=true;load();});
    map.on('click',event=>{root.querySelector('.geo-coordinate').textContent=`经度 ${event.latlng.lng.toFixed(5)} · 纬度 ${event.latlng.lat.toFixed(5)}（WGS84）`;options.onSelectCoordinate?.({longitude:event.latlng.lng,latitude:event.latlng.lat});});
    map.on('focus',()=>map.scrollWheelZoom.enable());map.on('blur',()=>map.scrollWheelZoom.disable());
    load();
  }
  window.RuianMap={mount(container,nextOptions={}){options=nextOptions;if(!window.L){container.textContent='地图组件未加载，请重新刷新网页。';return;}if(!root)create(container);else container.replaceChildren(root);renderOverlay();requestAnimationFrame(()=>map.invalidateSize({pan:false}));},update(nextOptions={}){options={...options,...nextOptions};renderOverlay();}};
})();
