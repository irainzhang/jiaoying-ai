(function(root){
  'use strict';
  const esc=x=>String(x??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const assert=(ok,message)=>{if(!ok)throw Error(message);};
  const validId=id=>typeof id==='string'&&/^[A-Za-z0-9][A-Za-z0-9_.:-]{0,59}$/.test(id)&&!['__proto__','prototype','constructor'].includes(id);
  function capacity(value,kind,label){const raw=String(value??'').trim(),max=kind==='vehicle'?500:10000;assert(/^\d+$/.test(raw),label+'容量请填写明确的整数；未知时请先核对，不会自动按 0 保存');const n=Number(raw);assert(Number.isSafeInteger(n)&&n>=0&&n<=max,label+'容量须为 0–'+max+' 的整数');return n;}
  function validateResources(input,{nodes,allowEmpty=false}={}){
    const known=new Set((nodes||[]).map(n=>typeof n==='string'?n:n.id)),result={vehicles:[],shelters:[]};
    for(const [kind,key] of [['vehicle','vehicles'],['shelter','shelters']]){
      const rows=input[key]||[],seen=new Set();assert(rows.length<31&&(allowEmpty||rows.length>0),kind==='vehicle'?'请保留 1–30 辆车':'请保留 1–30 个安置点');
      rows.forEach((row,index)=>{const label=(kind==='vehicle'?'车辆':'安置点')+'第 '+(index+1)+' 行',name=String(row.name??'').trim(),node=kind==='vehicle'?row.start:row.nodeId||row.id,id=kind==='vehicle'?String(row.id??'').trim():node;
        assert(name&&name.length<=80,label+'名称请填写 1–80 字');assert(typeof node==='string'&&node&&(!nodes||known.has(node)),label+'请选择当前地图中的位置；不会自动代选');
        assert(kind==='vehicle'&&id===''||validId(id),label+'编号无效');assert(!id||!seen.has(id),label+'编号/位置重复，请合并或更正后保存');if(id)seen.add(id);
        assert(typeof row.available==='boolean',label+'可用状态无效');const item={id,name,capacity:capacity(row.capacity,kind,label),available:row.available};
        if(kind==='vehicle'){assert(typeof row.wheelchair==='boolean',label+'轮椅适配状态无效');Object.assign(item,{start:node,wheelchair:row.wheelchair});if(row.color)item.color=row.color;}else item.nodeId=node;
        result[key].push(item);
      });
    }
    return result;
  }
  function parseResourceCSV(text,{nodes,existing={vehicles:[],shelters:[]}}={}){
    const parser=root.JiaoyingCommandIntake||(typeof module==='object'&&module.exports?require('./command-intake.js'):null);assert(parser?.parseCSV,'资源表读取组件尚未就绪');assert(typeof text==='string'&&text.length<=100000,'资源表请控制在 10 万字符以内');
    const parsed=[],rows=parser.parseCSV(text);
    for(const [i,raw] of rows.entries()){
      const r=raw.map(x=>String(x??'').trim());if(i===0&&['类型','type'].includes(r[0]))continue;if(!r.some(Boolean))continue;
      assert(r.length===7,'第 '+(i+1)+' 行应为 7 列：类型、编号、名称、容量、位置节点、轮椅位、可用');const [kind,id,name,count,node,wheelchair,available]=r;
      assert(['vehicle','shelter'].includes(kind),'第 '+(i+1)+' 行类型须为 vehicle 或 shelter');assert(['0','1'].includes(wheelchair)&&['0','1'].includes(available),'第 '+(i+1)+' 行轮椅位与可用须填 0 或 1');
      if(kind==='shelter')assert(!id||id===node,'第 '+(i+1)+' 行安置点编号须与地图位置节点一致');
      parsed.push({kind,id:kind==='shelter'?node:id,name,capacity:capacity(count,kind,'第 '+(i+1)+' 行'),node,wheelchair:wheelchair==='1',available:available==='1'});
    }
    assert(parsed.length>0&&parsed.length<=60,'请提供 1–60 条资源，每种最多 30 条');
    const combined={vehicles:[...existing.vehicles],shelters:[...existing.shelters]};for(const x of parsed)combined[x.kind==='vehicle'?'vehicles':'shelters'].push({...x,...(x.kind==='vehicle'?{start:x.node}:{nodeId:x.node})});validateResources(combined,{nodes,allowEmpty:true});return parsed;
  }
  function resourceForm(state){
    const s=state.data.scenario;
    const options=value=>`<option value="">请选择地图位置</option>`+s.nodes.map(n=>`<option value="${esc(n.id)}" ${value===n.id?'selected':''}>${esc(n.label||n.id)} · ${esc(n.id)}</option>`).join('');
    const row=(x,kind,index)=>`<tr data-resource-kind="${kind}" data-resource-id="${esc(x.id)}"><td><input aria-label="${kind==='vehicle'?'车辆':'安置点'}${index+1}名称" data-resource-field="name" value="${esc(x.name)}" maxlength="80" required><small>${esc(x.id)}</small></td><td><input aria-label="${esc(x.name)}容量" type="number" min="0" max="${kind==='vehicle'?500:10000}" step="1" required data-resource-field="capacity" value="${x.capacity}"></td><td><select aria-label="${esc(x.name)}位置" data-resource-field="node" required>${options(kind==='vehicle'?x.start:x.id)}</select></td><td>${kind==='vehicle'?`<label><input type="checkbox" data-resource-field="wheelchair" ${x.wheelchair?'checked':''}>轮椅位</label>`:'按接收人数计'}</td><td><label><input type="checkbox" data-resource-field="available" ${x.available!==false?'checked':''}>可用</label></td><td><button type="button" data-resource-remove>移除</button></td></tr>`;
    return `<h2>本场车辆与安置点</h2><p>在发布前配置资源。初始资源均为演练设定，请按本场需要核对；发布后通过“资源状态变化”登记停用或恢复。</p><p class="boundary">地图位置使用当前路网节点；这不代表该地点获批为安置点。每辆车的容量包含需协助人员，轮椅适配当前按 1 个轮椅位计算。</p><div id="resource-editor" data-node-options="${esc(options(''))}" data-resource-nodes="${esc(JSON.stringify(s.nodes.map(n=>n.id)))}">${['vehicle','shelter'].map(kind=>`<h3>${kind==='vehicle'?'接送车辆':'安置接收点'}</h3><div class="table-wrap"><table><thead><tr><th>名称 / 编号</th><th>容量</th><th>位置</th><th>适配</th><th>状态</th><th></th></tr></thead><tbody data-resource-list="${kind}">${(kind==='vehicle'?s.vehicles:s.shelters).map((x,i)=>row(x,kind,i)).join('')}</tbody></table></div><button type="button" data-resource-add="${kind}">＋增加${kind==='vehicle'?'车辆':'安置点'}</button>`).join('')}</div><p id="resource-editor-error" role="alert"></p><details class="compact-disclosure"><summary>批量粘贴资源表（CSV）</summary><p>列：类型,编号,名称,容量,位置节点,轮椅位,可用。类型填 vehicle 或 shelter；车辆编号可留空自动生成，安置点编号须与位置节点一致。每种最多 30 条，读取后追加到表格，核对后保存。</p><textarea id="resource-csv" aria-label="资源 CSV 表" placeholder="vehicle,,增援车,8,D,0,1"></textarea><button type="button" id="resource-csv-parse">读取资源表</button><p id="resource-csv-error" role="alert"></p></details><p class="notice">保存只更新资源和草案，不会发布任务。容量留空不会按 0 保存；需要禁用可取消“可用”。</p><button type="submit" class="primary">保存资源并重新计算</button>`;
  }
  function bindResources(container){
    const editor=container.querySelector('#resource-editor');if(!editor)return ()=>{};const doc=container.ownerDocument||root.document;
    function add(kind,data={}){const body=editor.querySelector(`[data-resource-list="${kind}"]`),tr=doc.createElement('tr');tr.dataset.resourceKind=kind;tr.dataset.resourceId=data.id||'';
      tr.innerHTML=`<td><input aria-label="新资源名称" data-resource-field="name" maxlength="80" required value="${esc(data.name||'')}"><small>${data.id?esc(data.id):kind==='vehicle'?'保存时自动编号':'使用位置节点编号'}</small></td><td><input aria-label="新资源容量" type="number" min="0" max="${kind==='vehicle'?500:10000}" step="1" required data-resource-field="capacity" value="${data.capacity??''}"></td><td><select aria-label="新资源位置" data-resource-field="node" required>${editor.dataset.nodeOptions}</select></td><td>${kind==='vehicle'?`<label><input type="checkbox" data-resource-field="wheelchair" ${data.wheelchair?'checked':''}>轮椅位</label>`:'按接收人数计'}</td><td><label><input type="checkbox" data-resource-field="available" ${data.available!==false?'checked':''}>可用</label></td><td><button type="button" data-resource-remove>移除</button></td>`;body.appendChild(tr);if(data.node)tr.querySelector('[data-resource-field="node"]').value=data.node;return tr;}
    function click(e){const target=e.target.closest('button');if(!target)return;
      if(target.dataset.resourceAdd){const kind=target.dataset.resourceAdd,error=container.querySelector('#resource-editor-error');try{assert(['vehicle','shelter'].includes(kind),'资源类型无效');assert(editor.querySelectorAll(`[data-resource-kind="${kind}"]`).length<30,'每种资源最多 30 条');add(kind);if(error)error.textContent='';}catch(err){if(error)error.textContent=err.message;}}
      if(target.hasAttribute('data-resource-remove'))target.closest('tr').remove();
      if(target.id==='resource-csv-parse'){const error=container.querySelector('#resource-csv-error');try{const nodes=JSON.parse(editor.dataset.resourceNodes),existing=readResources(container,{allowEmpty:true}),parsed=parseResourceCSV(container.querySelector('#resource-csv').value,{nodes,existing});parsed.forEach(x=>add(x.kind,x));error.textContent='已完整追加 '+parsed.length+' 条，请核对表格后保存。';}catch(err){error.textContent=err.message+'；本次未追加任何记录。';}}
    }
    container.addEventListener('click',click);return ()=>container.removeEventListener('click',click);
  }
  function readResources(container,{allowEmpty=false}={}){const vehicles=[],shelters=[],editor=container.querySelector('#resource-editor');for(const row of container.querySelectorAll('[data-resource-kind]')){const value=k=>row.querySelector(`[data-resource-field="${k}"]`);const item={id:row.dataset.resourceId,name:value('name').value,capacity:value('capacity').value,available:value('available').checked};if(row.dataset.resourceKind==='vehicle'){item.start=value('node').value;item.wheelchair=value('wheelchair').checked;vehicles.push(item);}else{item.nodeId=value('node').value;item.id=item.nodeId;shelters.push(item);}}return validateResources({vehicles,shelters},{nodes:editor?.dataset.resourceNodes?JSON.parse(editor.dataset.resourceNodes):undefined,allowEmpty});}
  function pendingInfo(state){return (state.data.villageReports||[]).filter(r=>r.status==='accepted'&&!r.supersededBy&&r.mode!=='snapshot'&&!r.householdIds?.length&&r.people>0);}
  function readiness(state,vehicleId){const d=state.data,r=d.activePlan?.routes.find(r=>r.vehicleId===vehicleId),f=d.fleet[vehicleId];if(!r||!f||!r.people||r.holding||f.finished)return null;const ids=r.stops.filter(h=>d.stage[h.id]==='waiting'&&!d.contacts[h.id]?.contacted).map(h=>h.id);return {route:r,fleet:f,uncontacted:ids,ack:d.taskAcks?.[vehicleId]?.planId===d.activePlan.id};}
  const api={resourceForm,bindResources,readResources,validateResources,parseResourceCSV,pendingInfo,readiness};if(typeof module==='object'&&module.exports)module.exports=api;else root.JiaoyingTaskWorkbench=api;
})(typeof window==='object'?window:globalThis);
