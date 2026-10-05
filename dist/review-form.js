/* Village review: unknown needs stay unknown until a person supplies a value. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.JiaoyingReviewForm=api;})(typeof window!=='undefined'?window:globalThis,function(){
  'use strict';
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const modes={increment:'新增人员',snapshot:'待转移总数观测',correction:'人数更正'};
  const selected=(a,b)=>a===b?' selected':'';
  function record(state,id){const row=state.data.villageReports.find(x=>x.id===id);if(!row)throw new Error('上报记录已变化，请关闭后重新打开');return row;}
  function initial(row){return {decision:'accept',pickupId:row.pickupId||'',assistancePeople:row.assistancePeople??'',wheelchairPeople:row.wheelchairPeople??'',groupPolicy:row.groupPolicy||'unknown',note:''};}
  function integer(raw,max,label,errors){if(raw===null||raw===undefined||String(raw).trim()==='')return null;const n=Number(raw);if(!Number.isInteger(n)||n<0||n>max){errors.push(label+'须为 0–'+max+' 的整数');return null;}return n;}
  function evaluate(state,id,kind,values){
    const row=record(state,id),village=state.data.villages.find(x=>x.id===row.villageId),v={...initial(row),...values};
    const errors=[],missing=[],decision=kind==='village-review'?v.decision:'accept',payload={id, ...(kind==='village-review'?{decision}:{})};
    if(!['accept','reject'].includes(decision))errors.push('请选择采纳或退回');
    let label,summary;
    if(decision==='reject'){
      label='退回现场重报';summary='本条不计入转移安排，现场可查看退回说明后重新上报。';
    }else if(row.mode==='snapshot'){
      label='采纳这次人数观测';summary='只保存清点结果，不重复增加转移人数。';
    }else{
      const pickupId=v.pickupId||null,pickup=village?.pickups.find(x=>x.id===pickupId);
      if(pickupId&&!pickup)errors.push('集合点不属于当前村庄，请重新选择');
      const assistancePeople=integer(v.assistancePeople,row.people,'需协助人数',errors),wheelchairPeople=integer(v.wheelchairPeople,row.people,'轮椅人数',errors),groupPolicy=v.groupPolicy||'unknown';
      if(!['unknown','splittable','together'].includes(groupPolicy))errors.push('请选择有效的同行安排');
      if(assistancePeople!==null&&wheelchairPeople!==null&&wheelchairPeople>assistancePeople)errors.push('轮椅人数已包含在协助人数中，不能超过协助人数');
      Object.assign(payload,{pickupId,assistancePeople,wheelchairPeople,groupPolicy});
      if(row.people>0){
        if(!pickup)missing.push('集合点');else if(!pickup.node||pickup.locationStatus==='pending')missing.push('集合点地图位置');
        if(assistancePeople===null)missing.push('协助人数');
        if(wheelchairPeople===null)missing.push('轮椅人数');
        if(groupPolicy==='unknown')missing.push('同行安排');
      }
      if(missing.length){
        label=kind==='village-complete'?'补齐后生成安排':'先保存为待补信息';
        summary='还缺'+missing.join('、')+'。'+(kind==='village-complete'?'这条已采纳；补齐后才能生成接送组。':'可先采纳人数，保留待办，暂不生成接送组。');
      }else{
        label=kind==='village-complete'?'保存并生成安排':'采纳并生成安排';
        summary=row.people===0?'将更正为 0 人，原批次会保留历史记录。':'生成接送组并更新调度草案；发布任务仍由您点击确认。';
      }
    }
    const rawNote=typeof v.note==='string'?v.note.trim():'';
    if(rawNote.length>300)errors.push('说明不能超过 300 字');
    payload.note=rawNote||(decision==='reject'?'指挥台退回：请现场核实人数与接送信息后重新上报。':row.mode==='snapshot'?'指挥台点击采纳当前待转移人数观测。':missing.length?'指挥台核实采纳人数；'+missing.join('、')+'待补充，暂未生成接送组。':'指挥台核对集合点、协助人数、轮椅人数和同行安排，点击生成接送组。');
    const canSubmit=errors.length===0&&!(kind==='village-complete'&&missing.length);
    return {payload,errors,missing,canSubmit,label,summary,decision};
  }
  function read(container){const get=id=>container.querySelector('#'+id)?.value;return {decision:get('village-decision')||'accept',pickupId:get('vreview-pickup'),assistancePeople:get('vreview-assistance'),wheelchairPeople:get('vreview-wheelchair'),groupPolicy:get('vreview-group'),note:get('village-note')||''};}
  function payload(state,id,kind,container){const result=evaluate(state,id,kind,read(container));if(!result.canSubmit)throw new Error(result.errors[0]||'请补齐'+result.missing.join('、')+'后再生成安排');return result.payload;}
  function render(state,id,kind){
    const row=record(state,id),village=state.data.villages.find(x=>x.id===row.villageId),result=evaluate(state,id,kind,initial(row));
    const eligibleCorrection=kind==='village-complete'&&row.mode!=='snapshot'&&row.status==='accepted'&&!row.supersededBy&&(row.householdIds||[]).every(h=>state.data.stage[h]==='waiting')&&!state.data.villageReports.some(x=>x.status==='pending'&&x.mode==='correction'&&x.targetId===row.id);
    return `<section class="review-form" data-review-form><h2>${kind==='village-complete'?'补齐这批接送信息':'核实这条现场上报'}</h2><p class="review-meta">${esc(row.id)} · ${esc(village?.name)} · ${esc(modes[row.mode])}</p><div class="review-people"><div><span>${row.mode==='snapshot'?'本次清点人数':'这批上报人数'}</span><strong>${esc(row.people)}<small>人</small></strong><span class="review-readonly-label">上报原值</span></div>${row.mode==='snapshot'?'<p>这是待转移人数观测，不重复累计。</p>':`<p>总人数保留原始上报记录；${kind==='village-review'?'有误可退回现场重新上报。':'有误请提交更正批次，保留原记录。'}</p>${kind==='village-review'?'<button type="button" class="quiet small" data-review-ac="return">人数有误？退回重报</button>':eligibleCorrection?`<button type="button" class="quiet small" data-ac="review-correct" data-id="${esc(row.id)}">去现场更正这批人数</button>`:''}`}</div><details class="review-original"><summary>查看现场原话</summary><p>${esc(row.text)}</p></details>${kind==='village-review'?'<label for="village-decision">处理方式</label><select id="village-decision"><option value="accept">采纳这条上报</option><option value="reject">退回现场重报</option></select>':''}${row.mode==='snapshot'?'':`<fieldset class="review-details" id="review-details"><legend>接送信息 · 在这里补齐</legend><div class="review-fields"><div class="review-location"><label for="vreview-pickup">集合点</label><select id="vreview-pickup"><option value="">待核实集合点</option>${(village?.pickups||[]).map(x=>`<option value="${esc(x.id)}"${selected(row.pickupId,x.id)}>${esc(x.name)}${!x.node||x.locationStatus==='pending'?'（待地图定位）':''}</option>`).join('')}</select></div><div><label for="vreview-assistance">需协助人数 <small id="review-assistance-status">${row.assistancePeople===null?'待核实':'已确认'}</small></label><input id="vreview-assistance" type="number" inputmode="numeric" min="0" max="${row.people}" step="1" placeholder="待核实，请留空" value="${esc(row.assistancePeople)}"></div><div><label for="vreview-wheelchair">其中轮椅人数 <small id="review-wheelchair-status">${row.wheelchairPeople===null?'待核实':'已确认'}</small></label><input id="vreview-wheelchair" type="number" inputmode="numeric" min="0" max="${row.people}" step="1" placeholder="待核实，请留空" value="${esc(row.wheelchairPeople)}"></div><div class="review-person-note"><p>填 <b>0</b> 表示已确认没有；留空表示待核实。轮椅人数包含在协助人数中。</p><button type="button" class="small" data-review-ac="no-assistance">已核实：无需协助或轮椅位</button></div><div class="review-group"><label for="vreview-group">同行安排</label><select id="vreview-group"><option value="unknown"${selected(row.groupPolicy,'unknown')}>待核实能否分组</option><option value="splittable"${selected(row.groupPolicy,'splittable')}>可以分组，按车辆容量安排</option><option value="together"${selected(row.groupPolicy,'together')}>需要同行，不拆分这批人员</option></select></div></div></fieldset>`}<details class="review-note" id="review-note-details"><summary>补充说明（选填）</summary><label class="sr-only" for="village-note">补充核实说明，选填</label><textarea id="village-note" maxlength="300" rows="2" placeholder="可记录联系情况或退回原因"></textarea></details><div class="review-outcome" id="review-outcome" role="status" aria-live="polite">${esc(result.summary)}</div><button type="submit" class="primary review-submit" id="review-submit"${result.canSubmit?'':' disabled'}>${esc(result.label)}</button><p class="review-guard">${row.mode==='snapshot'?'人数观测与具体转移批次分别保存。':'本步不会直接发布任务，也不会把未知需求当作 0 人。'}</p></section>`;
  }
  function bind(container,state,id,kind){
    const find=id=>container.querySelector('#'+id);
    const update=()=>{
      const result=evaluate(state,id,kind,read(container)),button=find('review-submit'),outcome=find('review-outcome'),fields=find('review-details');
      if(button){button.textContent=result.label;button.disabled=!result.canSubmit;}
      if(outcome){outcome.textContent=result.errors.length?result.errors.join('；'):result.summary;outcome.classList.toggle('has-error',result.errors.length>0);}
      if(fields){fields.hidden=result.decision==='reject';fields.disabled=result.decision==='reject';}
      for(const key of ['assistance','wheelchair']){const status=find('review-'+key+'-status'),input=find('vreview-'+key);if(status&&input){status.textContent=String(input.value).trim()===''?'待核实':'已填写 '+input.value+' 人';}}
      return result;
    };
    const click=e=>{
      const target=e.target.closest?.('[data-review-ac]');if(!target||!container.contains(target))return;
      if(target.dataset.reviewAc==='no-assistance'){find('vreview-assistance').value='0';find('vreview-wheelchair').value='0';}
      if(target.dataset.reviewAc==='return'){find('village-decision').value='reject';const note=find('village-note');if(note&&!note.value.trim())note.value='上报总人数需要更正，请现场核实后重新上报。';const details=find('review-note-details');if(details)details.open=true;}
      update();
    };
    container.addEventListener('input',update);container.addEventListener('change',update);container.addEventListener('click',click);update();
    return {update,destroy(){container.removeEventListener('input',update);container.removeEventListener('change',update);container.removeEventListener('click',click);}};
  }
  return {render,bind,read,evaluate,payload};
});
