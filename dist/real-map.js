(()=>{
  'use strict';
  const escapeHTML=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let root,map,status,roadLabels,placeLabels,dataPromise,loaded=false;
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
      status.textContent=`瑞安市城区 · 飞云江两岸 · ${features.length.toLocaleString()} 个公开地理要素 · ${String(sourceDate).slice(0,10)} 数据`;
      root.querySelector('.geo-detail').innerHTML=`<strong>地图来源</strong><p>OpenStreetMap contributors，ODbL 1.0；由 Overpass 提取的真实道路、水系与地名，在本机绘制。地图范围是城区局部，不是瑞安市行政边界。</p><p>数据时间：${escapeHTML(sourceDate)}。历史快照不代表最新通行条件。</p><a href="assets/maps/SOURCES.md" target="_blank" rel="noopener">查看来源与原始查询</a> · <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">署名与许可</a>`;
    }).catch(error=>{loaded=false;dataPromise=null;status.textContent='真实地图加载失败：'+error.message+'。请点击重试。';root.querySelector('[data-map-retry]').hidden=false;});
  }
  function create(container){
    root=document.createElement('div');root.className='real-map-root';root.innerHTML='<div class="real-map-canvas" role="region" aria-label="瑞安市城区真实地理地图"></div><div class="geo-tools"><button type="button" data-map-home>回到瑞安市区</button><button type="button" data-map-info aria-expanded="false">地图来源</button><button type="button" data-map-retry hidden>重试加载</button></div><div class="geo-detail" hidden></div><div class="geo-coordinate" aria-live="polite">点击地图查看经纬度</div><div class="geo-status" role="status">正在读取本地真实地图数据…</div>';
    container.replaceChildren(root);status=root.querySelector('.geo-status');
    map=L.map(root.querySelector('.real-map-canvas'),{zoomControl:false,scrollWheelZoom:false,minZoom:12,maxZoom:17,maxBounds:[[27.728,120.585],[27.832,120.715]],maxBoundsViscosity:1,attributionControl:true});
    L.control.zoom({zoomInTitle:'放大地图',zoomOutTitle:'缩小地图'}).addTo(map);L.control.scale({imperial:false,position:'bottomleft'}).addTo(map);
    map.attributionControl.setPrefix('<a href="https://leafletjs.com" target="_blank" rel="noopener">Leaflet</a>');map.attributionControl.addAttribution('© <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a> · ODbL');
    map.setView(center,13);
    root.querySelector('[data-map-home]').addEventListener('click',()=>{map.fitBounds(bounds,{padding:[15,15],animate:false});});
    root.querySelector('[data-map-info]').addEventListener('click',e=>{const box=root.querySelector('.geo-detail');box.hidden=!box.hidden;e.currentTarget.setAttribute('aria-expanded',String(!box.hidden));});
    root.querySelector('[data-map-retry]').addEventListener('click',e=>{e.currentTarget.hidden=true;load();});
    map.on('click',event=>{root.querySelector('.geo-coordinate').textContent=`经度 ${event.latlng.lng.toFixed(5)} · 纬度 ${event.latlng.lat.toFixed(5)}（WGS84）`;});
    map.on('focus',()=>map.scrollWheelZoom.enable());map.on('blur',()=>map.scrollWheelZoom.disable());
    load();
  }
  window.RuianMap={mount(container){if(!window.L){container.textContent='地图组件未加载，请重新刷新网页。';return;}if(!root)create(container);else container.replaceChildren(root);requestAnimationFrame(()=>map.invalidateSize({pan:false}));}};
})();
