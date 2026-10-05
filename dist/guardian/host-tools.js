/* Current-task tools: call the host's existing revision-checked action path.
 * No model, credential, synthetic guardian-grid conversion or publish tool. */
(function(root){
  'use strict';
  const clone=value=>JSON.parse(JSON.stringify(value));
  const stamp=state=>({session:state.session,revision:state.data.revision,inputVersion:state.data.inputVersion,executionVersion:state.data.executionVersion});
  function same(a,b){return !!a&&!!b&&['session','revision','inputVersion','executionVersion'].every(key=>a[key]===b[key]);}
  const routeNames=(data,route)=>({vehicle:data.scenario.vehicles.find(x=>x.id===route.vehicleId)?.name||route.vehicleId,shelter:data.scenario.shelters.find(x=>x.id===route.shelterId)?.name||route.shelterId||'待安排'});
  function describe(state){
    if(!state?.data||!state.metrics)throw new Error('主台尚未就绪，请稍后读取本场任务。');
    const d=state.data,draft=d.plan,p=draft||d.activePlan,m=state.metrics,s=state.taskSummary||{};
    const fresh=!!draft&&draft.inputVersion===d.inputVersion&&draft.executionVersion===d.executionVersion;
    const publishedDraft=!!draft&&draft.id===d.activePlan?.id;
    const planKind=draft?(fresh?(publishedDraft?'published-current':'current-draft'):'stale-draft'):d.activePlan?'published-record':'none';
    const routeScope=planKind==='published-current'?'已发布方案':planKind==='current-draft'?'当前草案':planKind==='stale-draft'?'旧草案记录':'原发布记录';
    const result={source:'jiaoying-current-task',stamp:stamp(state),exerciseId:d.exerciseId,name:d.taskName||d.scenario.name,provider:'本地工具与调度算法 · 未连接大模型',closed:['completed','stopped'].includes(d.taskLifecycle?.status),people:m.people,waiting:m.waiting,boarded:m.boarded,arrived:m.arrived,verified:m.verified,pendingReports:s.pendingReports??m.pendingReports??0,pendingInfoPeople:m.unplannedPeople??m.pendingInfoPeople??0,rainfall:d.weather.rainfall,planId:draft?.id||null,activePlanId:d.activePlan?.id||null,planFresh:fresh,planKind,routeScope,served:fresh?draft.servedPeople:null,publishedServed:d.activePlan?.servedPeople??null,routes:[],gaps:[],pending:[],evidence:[]};
    result.routes=(p?.routes||[]).filter(r=>r.people).map(r=>{
      const ids=r.passengerIds||[...(r.onboard||[]),...r.stops.map(x=>x.id)],count=stage=>ids.filter(id=>d.stage[id]===stage).reduce((n,id)=>n+(d.scenario.households.find(h=>h.id===id)?.people||0),0);
      const progress={waiting:count('waiting'),boarded:count('boarded'),arrived:count('arrived'),verified:count('verified')};
      const receiptLabel=progress.arrived+progress.verified===r.people?'本趟已登记到达':progress.boarded>0?'本趟接送中':d.activePlan&&d.fleet[r.vehicleId]?.startedPlanId===d.activePlan.id?'本趟已开始':d.activePlan&&d.taskAcks[r.vehicleId]?.planId===d.activePlan.id?'已接令 · 待执行':'已发布 · 待接令';
      return {...routeNames(d,r),vehicleId:r.vehicleId,people:r.people,minutes:r.finish,scope:routeScope,receiptLabel:planKind==='current-draft'?'待人工发布':planKind==='stale-draft'&&!publishedDraft?'旧草案 · 需重新计算':receiptLabel,progress,pickups:r.stops.map(x=>({name:d.scenario.households.find(h=>h.id===x.id)?.name||x.id,people:x.people,node:x.node})),segments:clone(r.segments||[])};
    });
    result.gaps=(p?.unassigned||[]).map(x=>({id:x.id,name:x.name||x.id,people:x.people,scope:fresh?(publishedDraft?'已发布方案待协调':'当前草案待协调'):'原快照待协调（需重算）',reason:x.reason||'该次计算的资源或路线约束未满足'}));
    result.pending=(Array.isArray(state.villageLedger)?state.villageLedger:[]).filter(x=>x.pendingPeople>0||x.unplannedPeople>0).map(x=>clone(x));
    result.evidence=[{label:'主任务版本',value:`${d.exerciseId} · 输入 ${d.inputVersion} / 执行 ${d.executionVersion} / 修订 ${d.revision}`},{label:'雨量口径',value:`${d.weather.rainfall} mm · ${d.weather.window} · 模拟数据`},{label:'路线依据',value:d.scenario.region.mapKind==='osm-road-network'?'瑞安局部公开道路快照；人员需求由本场录入，资源容量为演练配置':'合成演练路网与配置'}];
    const planSummary=fresh?`${publishedDraft?'当前方案已发布，安排':'当前草案可安排'} ${draft.servedPeople} 人，${result.gaps.reduce((n,x)=>n+x.people,0)} 人需继续协调。`:planKind==='published-record'?`已发布方案 ${d.activePlan.id} 原安排 ${d.activePlan.servedPeople} 人；这是发布时记录，当前剩余可安排人数需重新计算。`:planKind==='stale-draft'?`旧草案 ${draft.id} 的依据已变化；当前剩余可安排人数需重新计算。`:'尚未生成安排。';
    result.summary=`本场 ${m.people} 人，待转移 ${m.waiting} 人，车上 ${m.boarded} 人，到达待核验 ${m.arrived} 人，已核验 ${m.verified} 人。${planSummary}${result.closed?'本场已结束，保留记录供查看。':''}`;
    result.reportText=[`叫应本场任务摘要：${result.name}`,result.summary,`当前草案 ${result.planId||'无'}；已发布方案 ${result.activePlanId||'无'}；${result.planFresh?'草案版本与当前输入一致':'尚无有效草案，需计算或重新核对'}。`,`现场待核实 ${result.pendingReports} 条；${result.pendingInfoPeople} 人尚缺位置或必要信息，保留待安排。`,...result.routes.map(r=>`${r.scope} · ${r.vehicle}：该次安排 ${r.people} 人；${r.receiptLabel}，车上 ${r.progress.boarded} 人、到达待核验 ${r.progress.arrived} 人、已核验 ${r.progress.verified} 人。${r.pickups.map(x=>x.name).join(' → ')} → ${r.shelter}；该次计划演练累计 ${r.minutes} 分钟。`),...result.gaps.map(x=>`${x.scope}：${x.name} ${x.people} 人；${x.reason}`),...result.evidence.map(x=>`${x.label}：${x.value}`),'本地规则与算法结果，不是大模型回答；模拟天气、资源及通行条件仅供演练，人工确认后执行。不预测水深，不发送真实通知。'].join('\n');
    return result;
  }
  async function run(host,tool,expected){
    if(!host||typeof host.readState!=='function')throw new Error('主台适配器不可用');
    if(!['read_state','calculate_draft','prepare_report'].includes(tool))throw new Error('本场工具不提供发布、确认或安全核验操作');
    let state=await host.readState();const current=describe(state);
    if(expected&&!same(expected,current.stamp))throw new Error('主台情况已更新，请先读取最新本场，再重新计算。');
    if(tool==='calculate_draft'){
      if(current.closed)throw new Error('本场已结束，不能生成新草案。');
      if(current.people===0)throw new Error('本场当前 0 人，请先在主台录入需求。');
      state=await host.calculateDraft(current.stamp);
    }
    const result=describe(state);return {...result,tool,generatedAt:new Date().toISOString()};
  }
  function intent(text){
    const value=String(text||'').trim();
    if(/发布|执行|确认|核验/.test(value))return {tool:null,message:'请先查看本场草案，再点击“回主台核对并发布”。守护助手不会代替人工发布或登记执行结果。'};
    if(/报告|摘要|总结|通知/.test(value))return {tool:'prepare_report'};
    if(/多少|还有|缺口|进度/.test(value))return {tool:'read_state'};
    if(/安排|重排|调度|规划|计算|研判/.test(value))return {tool:'calculate_draft'};
    if(/人数|多少|情况|状态|任务|读取|查看|进度|路线|缺/.test(value))return {tool:'read_state'};
    return {tool:null,message:'本场支持“查看当前情况”“重新计算安排”“整理任务报告”。当前为本地规则选择工具，未连接大模型。'};
  }
  function createPanel({document:doc,host,beforeReview=()=>{}}){
    const section=doc.createElement('section');section.id='guardian-current-task';section.className='guardian-current-task';
    let latest=null,calculatedAt=null,busy=false,disposed=false;
    const element=(tag,text,className)=>{const x=doc.createElement(tag);if(text!==undefined)x.textContent=text;if(className)x.className=className;return x;};
    const heading=element('h2','当前主台任务'),label=element('p','本地工具与调度算法 · 未连接大模型','guardian-host-label'),facts=element('div','','guardian-host-facts'),status=element('p','正在读取本场任务…','guardian-host-status');status.setAttribute('role','status');status.setAttribute('aria-live','polite');
    const actions=element('div',undefined,'guardian-host-actions'),details=element('div',undefined,'guardian-host-results'),form=element('form'),input=element('input'),send=element('button','整理我的问题');input.placeholder='例如：还有多少人没安排？帮我重新计算安排';input.setAttribute('aria-label','询问本场任务');input.maxLength=300;send.type='submit';form.append(input,send);
    const controls=[];
    function addButton(text,callback){const b=element('button',text);b.type='button';b.addEventListener('click',callback);controls.push(b);actions.appendChild(b);return b;}
    const review=addButton('回主台核对并发布',async()=>{
      try{const fresh=await run(host,'read_state');if(!latest||!same(latest.stamp,fresh.stamp)||!same(calculatedAt,fresh.stamp))throw new Error('请用最新数据计算安排后，再返回主台核对。');if(!fresh.planId||!fresh.planFresh||fresh.closed)throw new Error('请先生成本场有效草案。');beforeReview();await host.openPublicationReview(latest.stamp);}catch(error){status.textContent=error.message;}
    });
    async function execute(tool){if(busy||disposed)return;busy=true;controls.forEach(b=>b.disabled=true);send.disabled=true;status.textContent=tool==='calculate_draft'?'正在使用本场需求和现有资源计算…':'正在读取主台本场记录…';try{latest=await run(host,tool,tool==='calculate_draft'?latest?.stamp:null);if(tool==='calculate_draft')calculatedAt=latest.stamp;render(latest,tool);status.textContent=tool==='calculate_draft'?'草案已回到主台，尚未发布。核对路线和缺口后由人点击发布。':tool==='prepare_report'?'本场报告已整理，可选中复制；没有对外发送。':'已读取主台当前任务。';}catch(error){status.textContent=error.message;}finally{busy=false;controls.forEach(b=>b.disabled=false);review.disabled=!latest?.planFresh||latest.closed||!same(calculatedAt,latest.stamp);send.disabled=false;}}
    addButton('查看本场情况',()=>execute('read_state'));addButton('计算安排草案',()=>execute('calculate_draft'));addButton('整理任务报告',()=>execute('prepare_report'));
    actions.appendChild(review);
    function render(value,tool){
      heading.textContent=value.name;facts.replaceChildren();
      for(const [name,n] of [['本场人员',value.people],['待转移',value.waiting],['车上',value.boarded],['到达待核验',value.arrived],['已核验',value.verified]]){const card=element('div');card.append(element('small',name),element('strong',String(n)));facts.appendChild(card);}
      details.replaceChildren(element('p',value.summary));
      details.appendChild(element('p',`读取版本：输入 ${value.stamp.inputVersion} / 执行 ${value.stamp.executionVersion} / 修订 ${value.stamp.revision}。草案 ${value.planId||'无'}，已发布 ${value.activePlanId||'无'}。`, 'guardian-host-version'));
      if(value.pendingReports)details.appendChild(element('p',`现场待核实 ${value.pendingReports} 条，请回主台处理后更新安排。`,'guardian-host-warning'));
      if(value.pendingInfoPeople)details.appendChild(element('p',`${value.pendingInfoPeople} 人缺少位置或必要信息，尚不能形成接人路线；请到主台“补齐本批缺项”集中处理。`,'guardian-host-warning'));
      if(!value.planFresh&&(value.planId||value.activePlanId))details.appendChild(element('p','下方为已有方案记录，不代表当前剩余人员已重新安排。请重新计算草案。','guardian-host-warning'));
      const routes=element('div',undefined,'guardian-host-routes');for(const r of value.routes){const card=element('article');card.append(element('h3',`${r.vehicle} · ${r.scope} ${r.people} 人`),element('p',`${r.receiptLabel} · 车上 ${r.progress.boarded} / 到达待核验 ${r.progress.arrived} / 已核验 ${r.progress.verified}`),element('p',`${r.pickups.map(x=>x.name).join(' → ')} → ${r.shelter}`),element('small',`该次计划演练累计 ${r.minutes} 分钟 · 路线与回执位置请在主台地图核对`));routes.appendChild(card);}details.appendChild(routes);
      if(value.gaps.length){const gaps=element('div',undefined,'guardian-host-warning');gaps.appendChild(element('strong',value.planFresh?(value.planKind==='published-current'?'已发布方案待协调人员与原因':'当前草案待安排人员与原因'):'原快照待协调人员与原因 · 请重算'));for(const x of value.gaps)gaps.appendChild(element('p',`${x.name} · ${x.people} 人：${x.reason}`));details.appendChild(gaps);}
      if(tool==='prepare_report'){const report=element('textarea');report.readOnly=true;report.value=value.reportText;report.rows=12;report.setAttribute('aria-label','可复制的本场任务报告');details.appendChild(report);}
      const evidence=element('details'),summary=element('summary','查看本次工具依据');evidence.appendChild(summary);for(const x of value.evidence)evidence.appendChild(element('p',`${x.label}：${x.value}`));details.appendChild(evidence);
    }
    form.addEventListener('submit',event=>{event.preventDefault();const found=intent(input.value);if(found.tool)execute(found.tool);else status.textContent=found.message;});
    section.append(heading,label,facts,actions,form,status,details);
    const changed=()=>{if(busy||disposed)return;Promise.resolve(host.readState()).then(state=>{if(!latest||!same(stamp(state),latest.stamp)){latest=describe(state);calculatedAt=null;render(latest,'read_state');status.textContent='已同步主台新的需求或执行反馈，请基于最新情况重新计算安排。';review.disabled=true;}}).catch(()=>{});};
    root.addEventListener?.('jiaoying:state',changed);
    return {element:section,refresh:()=>execute('read_state'),destroy(){disposed=true;root.removeEventListener?.('jiaoying:state',changed);}};
  }
  const api={stamp,same,describe,run,intent,createPanel};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.JiaoyingGuardianTools=api;
})(typeof window==='object'?window:globalThis);
