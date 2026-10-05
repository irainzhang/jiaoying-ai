/* Shared vehicle/crew display for the command and field pages. */
(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.JiaoyingResourceCards=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const e=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const types={van:'小型客车',minibus:'中型客车',bus:'大型客车',accessible:'无障碍车辆',other:'其他车型'};
  const sum=(rows,fn)=>rows.reduce((n,x)=>n+fn(x),0);
  function needs(h){return {assistance:h.assistancePeople??(h.assistance?h.people:0),chairs:h.wheelchairPeople??Number(h.wheelchair)};}
  function passengerNote(h){const n=needs(h);return n.assistance||n.chairs?`<span class="resource-need">${n.assistance?'需协助 '+n.assistance+' 人':''}${n.assistance&&n.chairs?' · ':''}${n.chairs?'其中轮椅 '+n.chairs+' 人':''}</span>`:'';}
  function facts(d,v,r={}){
    const s=d.scenario,registered=s.resourceRegistryVersion===1,ids=r.holding?(d.fleet[v.id]?.onboard||[]):(r.passengerIds||[]),rows=s.households.filter(h=>ids.includes(h.id)),a=r.resourceAssignment;
    const capacity=a?.passengerCapacity??v.capacity,slots=a?.wheelchairSlots??(registered?v.wheelchairSlots:Number(v.wheelchair)),driver=a?.driverId??v.driverId,escorts=a?.escortIds??v.escortIds??[];
    return {registered,capacity,slots,driver,escorts,people:r.holding?sum(rows,h=>h.people):(r.people||0),assistance:sum(rows,h=>needs(h).assistance),chairs:sum(rows,h=>needs(h).chairs),total:a?.totalCapacity??v.totalCapacity,model:a?.model??v.model,type:a?.vehicleType??v.vehicleType};
  }
  function card(d,vehicleId,route={}){
    const v=d.scenario.vehicles.find(v=>v.id===vehicleId);if(!v)return '';
    const f=facts(d,v,route),onboard=sum((d.fleet[v.id]?.onboard||[]),id=>d.scenario.households.find(h=>h.id===id)?.people||0),special=f.slots>0||f.assistance>0||f.type==='accessible',assigned=[f.driver,...f.escorts].filter(Boolean),absent=assigned.filter(id=>!d.scenario.staff?.find(p=>p.id===id)?.available);
    return `<div class="resource-dispatch ${special?'is-special':''}" aria-label="${e(v.name)}车辆与人员配置"><div class="resource-dispatch-title"><strong>${e(types[f.type]||'车型未登记')}${f.model?' · '+e(f.model):''}</strong><span>${e(v.id)}</span></div><div class="resource-dispatch-load"><b>${f.people}<small> 人${route.holding?'原车待协调':'本趟接送'}</small></b><span>可转移 ${f.capacity} 人${f.registered?` · 总核载 ${f.total} 人`:''}<br>当前车上 ${onboard} 人</span></div><div class="resource-badges">${f.slots?`<span class="resource-tag chair">轮椅适配 · ${f.chairs} / ${f.slots} 位</span>`:''}${f.assistance?`<span class="resource-tag assistance">需协助 ${f.assistance} 人${f.chairs?'（含轮椅 '+f.chairs+' 人）':''}</span>`:''}${f.type==='accessible'&&!f.slots?'<span class="resource-tag warning">未登记轮椅位</span>':''}</div>${f.registered?`<div class="resource-crew"><span>司机 <b>${e(f.driver||'待分配')}</b></span><span>随车协助 <b>${e(f.escorts.join('、')||'未配置')}</b></span></div>${absent.length?`<p class="resource-crew-alert">人员未到岗：${absent.map(e).join('、')}，需协调后重新核对任务。</p>`:''}<small class="resource-capacity-note">已从总核载中扣除 ${assigned.length} 名工作人员；轮椅乘客计入转移人数。</small>`:'<p class="resource-capacity-note">旧版演练容量；工作人员尚未登记。可在下一场通过资源库编组。</p>'}${v.notes?`<p class="resource-special-note">特别说明：${e(v.notes)}</p>`:''}</div>`;
  }
  function overview(d){const s=d.scenario,enabled=s.resourceRegistryVersion===1,staff=s.staff||[],on=staff.filter(p=>p.available).length;return `<aside class="resource-overview" aria-label="本场资源概况"><div><strong>本场资源</strong><span>${s.vehicles.filter(v=>v.available).length} / ${s.vehicles.length} 辆车可用</span><span>${enabled?'工作人员 '+on+' / '+staff.length+' 人到岗':'工作人员待登记'}</span><small>${enabled?'先核对编组和实际可载人数，再发布任务。':'当前沿用旧演练车辆；进入资源库登记车型与人员。'}</small></div><button type="button" class="quiet small" data-ac="configure-resources-dialog">查看资源库</button></aside>`;}
  function selectorLabel(d,v){const r=d.activePlan?.routes.find(r=>r.vehicleId===v.id),f=facts(d,v,r||{});return v.name+(f.driver?' · 司机 '+f.driver:'')+(f.escorts.length?' · 协助 '+f.escorts.join('/'):'')+(r?.people?' · 接送 '+r.people+' 人':'')+(f.slots?' · 轮椅适配':'');}
  return {card,overview,selectorLabel,passengerNote,facts};
});
