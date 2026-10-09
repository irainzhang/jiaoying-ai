/* One capability summary across the intake, help and review screens. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.JiaoyingWorkflowStatus=api;})(typeof globalThis!=='undefined'?globalThis:this,function(){
  'use strict';
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const labels={people:'总人数',assistancePeople:'需协助人数',wheelchairPeople:'轮椅人数',villageName:'地区',villageId:'地区编号',pickupName:'接人点',pickupId:'接人点编号',role:'角色',available:'可用状态',totalCapacity:'总核载',wheelchairSlots:'轮椅位',driverId:'司机编号',escortIds:'随车编号',model:'型号',start:'出发点',capacity:'容量',nodeId:'位置',groupPolicy:'同行关系',name:'名称',id:'编号',intent:'操作',vehicleType:'车型'};
  const value=x=>x==null||x===''?'未提供':Array.isArray(x)?x.join('、'):typeof x==='boolean'?(x?'是':'否'):String(x);
  function connection(state,pages=false){
    const c=state?.connection||{};
    return pages?'GitHub 静态演练 · 本浏览器保存，不与其他设备共享。':c.shared?`同 Wi-Fi 房间 ${esc(c.roomId)} · ${c.role==='field'?'现场人员 '+esc(c.staffId)+' / '+esc(c.vehicleId):'指挥员'} · 数据保存在启动房间的电脑。`:'本机演练 · 两个网页共享本机任务；手机协同需另开同 Wi-Fi 房间。';
  }
  function statusLabel(status={}){return status.configured?'DeepSeek 语义整理已配置':'本地规则整理';}
  function strip(state,status,pages){return `<div class="workflow-capability-strip"><strong>${esc(statusLabel(status))}</strong><span>仅用于需求与资源字段整理；路线由算法计算，发布由人确认。</span><small>${connection(state,pages)}</small></div>`;}
  function hub(state,status,pages){
    const field=state?.connection?.role==='field',closed=['stopped','completed'].includes(state?.data?.taskLifecycle?.status);
    return `<section class="panel intake-help-hub"><div class="panel-body"><h2>AI 录入与操作帮助</h2><p>选需要办理的事，整理后在原表单核对。这里不会直接派车或修改任务。</p>${strip(state,status,pages)}<div class="intake-hub-actions">${!field?'<button type="button" class="primary" data-ac="semantic-go-demand" '+(closed?'disabled':'')+'>录入人员需求</button><button type="button" data-ac="semantic-go-resources" '+(closed?'disabled':'')+'>新增 / 更新资源</button>':''}<button type="button" data-ac="semantic-go-field" ${closed?'disabled':''}>现场补报新增人员</button></div><p>${status?.configured?'以上语音 / 文字录入可调用 DeepSeek；每轮预览单独显示是否调用成功，失败明确回退本地规则。':'当前按本地规则整理需求和资源信息，结果在核对表确认。'}</p><p>Excel 仍在浏览器解析。下方操作帮助和守护工具使用本地规则，发布任务由指挥人员核对后操作。</p></div></section>`;
  }
  function auditList(data){
    const entries=data?.intakeAudit||[];
    return `<section class="panel"><div class="panel-head"><div><h2>录入来源与人工修改</h2><p>保存原话、整理结果和确认后的字段；随任务导出与归档。</p></div><span class="badge">${entries.length} 批</span></div><div class="panel-body">${entries.length?entries.slice().reverse().map(r=>`<details class="intake-audit-entry"><summary>${esc(r.id)} · ${{demand:'人员需求',staff:'工作人员',vehicle:'车辆',shelter:'安置点'}[r.kind]||'录入'} · ${r.mode==='online'?'DeepSeek':'本地 / 人工'} · ${esc(new Date(r.savedAt).toLocaleString('zh-CN'))}</summary><p>${esc(r.model||'本地 / 人工整理')} · ${esc(r.reporter)} · ${esc((r.reportIds||[]).join('、'))}</p>${r.utterance?`<blockquote>${esc(r.utterance)}</blockquote>`:''}${r.reason?`<p>${esc(r.reason)}</p>`:''}<p>${r.sent&&r.mode!=='online'?'在线尝试失败后按本地规则处理。':''}确认 ${r.confirmedRows?.length||0} 条；确认时调整 ${r.changes?.length||0} 项。</p>${r.changes?.length?`<ul>${r.changes.map(c=>`<li>第 ${c.row} 条 · ${esc(labels[c.field]||c.field)}：${esc(value(c.before))} → <strong>${esc(value(c.after))}</strong></li>`).join('')}</ul>`:''}<details><summary>查看原始整理与确认字段</summary><pre>${esc(JSON.stringify({modelRows:r.modelRows,normalizedRows:r.normalizedRows,confirmedRows:r.confirmedRows},null,2))}</pre></details></details>`).join(''):'<p>尚无新版录入来源记录。历史任务不会被补写成曾经调用过模型。</p>'}</div></section>`;
  }
  function receipt(data,vehicleId,now=Date.now()){
    const event=(data.fieldEvents||[]).find(e=>e.vehicleId===vehicleId&&['board','arrive','start','ack','contact','contact-batch'].includes(e.stage));
    const at=event?.createdAt||event?.time;
    if(!at||!Number.isFinite(Date.parse(at)))return {at:null,stale:false,label:'尚无现场回执；当前为登记起点，非 GPS'};
    const minutes=Math.max(0,Math.floor((now-Date.parse(at))/60000)),stale=minutes>=10;
    return {at,stale,label:`最近回执 ${new Date(at).toLocaleTimeString('zh-CN')} · ${minutes} 分钟前${stale?'，超过 10 分钟未更新，请联系核实':''}；登记位置，非 GPS`};
  }
  return {connection,statusLabel,strip,hub,auditList,receipt};
});
