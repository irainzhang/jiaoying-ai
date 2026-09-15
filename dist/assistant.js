(function(root){
  'use strict';
  const C=root.JiaoyingAssistantCore,esc=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  function create({store,render,onGenerate,onBridge,onReview,notify}){
    let messages=[],input='',busy=false,checking=false,status={configured:false,model:''},epoch=0,request=null,returnTo='warning',messageId=0,checkSequence=0;
    const prompts=['总结当前情况','谁还没有安排接送？','为什么这样派车？','如果东桥封闭会怎样？','南湾户需要轮椅车辆接送。'];
    const localService=()=>/^https?:$/.test(location.protocol)&&['localhost','127.0.0.1','[::1]'].includes(location.hostname);
    const current=()=>C.snapshot(store),key=()=>C.fingerprint(store),isPage=()=>location.hash==='#assistant';
    function update(){if(isPage())render();}
    function reset(){epoch++;request?.abort();request=null;messages=[];input='';busy=false;}
    function serialize(){return {modelConfigured:status.configured,model:status.model,messages:messages.map(m=>({role:m.role,text:m.text,mode:m.mode,version:m.version,revision:m.revision,stale:m.key?m.key!==key():false,actions:m.actions?.map(a=>({type:a.type,label:a.label,used:a.used||false}))}))};}
    function greet(){if(!messages.length)messages.push({id:++messageId,role:'assistant',mode:'guide',text:'我可以结合本次演练，帮你了解当前情况、查看接送缺口，并把现场反馈带入核实流程。\n直接输入问题，或选一个示例开始。涉及修改路况、需求和方案时，我会提供需要你核对的操作入口。'});}
    async function check(){if(checking)return;const sequence=++checkSequence;checking=true;update();try{if(!localService())throw new Error('静态演示使用本地导览');const response=await fetch('/api/ai/status',{signal:AbortSignal.timeout(4000)});if(!response.ok)throw new Error('服务未启用');const result=await response.json();if(sequence===checkSequence)status={configured:result.configured===true,model:typeof result.model==='string'?result.model:''};}catch(_){if(sequence===checkSequence)status={configured:false,model:''};}finally{if(sequence===checkSequence){checking=false;update();}}}
    function addResult(text,mode,context,actions=[],contextKey=key()){const m={id:++messageId,role:'assistant',text,mode,version:context.version,revision:context.revision,key:contextKey,actions};messages.push(m);return m;}
    async function send(){
      if(busy)return;const text=input.trim();if(!text){notify('请先输入问题或现场反馈');return;}if(text.length>2000){notify('单条问题请控制在 2000 字以内');return;}
      const context=current(),contextKey=key(),generation=epoch,local=C.localReply(text,context);messages.push({id:++messageId,role:'user',text});input='';busy=true;update();
      try{
        if(!status.configured){addResult(local.reply,'local',context,local.actions,contextKey);return;}
        request=new AbortController();const activeRequest=request,timer=setTimeout(()=>activeRequest.abort(),45000);
        try{
          const history=messages.filter(m=>m.role==='user'||m.mode==='model').slice(-10).map(m=>({role:m.role,content:m.text}));
          const response=await fetch('/api/ai/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({messages:history,context}),signal:activeRequest.signal});
          const result=await response.json();if(!response.ok||typeof result.reply!=='string'||!result.reply.trim())throw new Error(result.error||'模型返回无效');
          if(epoch!==generation)return;addResult(result.reply,'model',context,local.actions,contextKey);status.lastSuccess=true;
        }finally{clearTimeout(timer);}
      }catch(error){if(epoch!==generation)return;addResult('本次模型请求未完成。'+(error.name==='AbortError'?'请求已取消或超时。':'请检查模型服务配置与网络。')+'\n可以重试，或切换本地导览继续查看演练。没有执行任何调度操作。','error',context,[],contextKey);}
      finally{if(epoch===generation){busy=false;request=null;update();scrollEnd();}}
    }
    function scrollEnd(){requestAnimationFrame(()=>{const el=document.getElementById('chat-messages');if(el)el.scrollTop=el.scrollHeight;});}
    function actionHTML(a,m,index){const stale=m.key!==key(),frozen=store.data.phase!=='preparation'&&a.type!=='receipt';return `<div class="chat-action"><strong>${a.type==='receipt'?'待核实的现场反馈':a.type==='bridge'?'演练条件变更':'调度工具'}</strong><p>${a.type==='bridge'?'将对应桥梁设为封闭，重新计算两种草案；不会确认方案。':a.type==='receipt'?'原文带入反馈页，人工核对对象与需求后再登记。':'按本次全部家庭和当前资源计算，不下达真实指令。'}</p>${a.type==='receipt'&&!a.householdId?`<label for="chat-home-${m.id}">先选择对应家庭</label><select id="chat-home-${m.id}" data-chat-household="${m.id}" ${stale||a.used?'disabled':''}><option value="">请选择家庭</option>${store.data.scenario.households.map(h=>`<option value="${h.id}" ${m.selection===h.id?'selected':''}>${esc(h.name)} · ${h.people} 人</option>`).join('')}</select>`:''}<button class="button secondary" data-ai="action" data-message="${m.id}" data-index="${index}" ${stale||frozen||a.used||busy?'disabled':''}>${a.used?'已处理':stale?'依据已变化，请重新提问':frozen?'执行中不支持重规划':esc(a.label)}</button></div>`;}
    function page(){
      greet();const c=current(),mode=checking?'检查服务状态…':status.configured?(status.lastSuccess?'模型已响应':'模型已配置，待首次请求'):'本地导览 · 未连接大模型';
      return `<section class="page-heading ai-heading"><div><span class="eyebrow">JIAOYING / ASSISTANT</span><h1>AI 协同助手</h1><p>围绕当前演练提问，把现场情况衔接到接送行动。</p></div><a class="button quiet" href="#${returnTo}">返回${{warning:'预警叫应',ledger:'人员与资源',dispatch:'路径与调度',feedback:'转移反馈',evidence:'方案依据'}[returnTo]||'工作台'} →</a></section><div class="assistant-workspace"><section class="panel chat-shell" aria-label="AI交流区"><div class="chat-top"><div class="chat-identity"><span class="assistant-avatar"><img src="assets/logo-mark.png" alt="" width="38" height="38"></span><div><strong>叫应协同助手</strong><small>${esc(mode)}${status.configured?' · '+esc(status.model):''}</small></div></div><button class="text-button" data-ai="clear" ${busy?'disabled':''}>清空对话</button></div><div id="chat-messages" class="chat-messages" role="log" aria-label="对话记录" aria-live="polite">${messages.map(m=>`<article class="chat-message ${m.role}"><span class="message-avatar">${m.role==='user'?'我':'AI'}</span><div class="message-main"><div class="message-meta">${m.role==='user'?'你':m.mode==='model'?esc(status.model||'模型回答'):m.mode==='local'?'本地导览回答':m.mode==='tool'?'调度工具结果':m.mode==='error'?'服务提示':'助手使用说明'}${m.version?' · 输入 v'+m.version+' / 记录 '+m.revision:''}${m.key&&m.key!==key()?'<span class="chat-stale">依据已更新</span>':''}</div><div class="message-bubble">${esc(m.text).replace(/\n/g,'<br>')}</div>${m.actions?.map((a,i)=>actionHTML(a,m,i)).join('')||''}</div></article>`).join('')}${busy?'<div class="chat-loading" role="status">正在请求配置的模型…<button class="text-button" data-ai="cancel">取消</button></div>':''}</div><div class="chat-composer"><div class="chat-prompts">${prompts.slice(0,4).map((p,i)=>`<button data-ai="prompt" data-index="${i}" ${busy?'disabled':''}>${p}</button>`).join('')}</div><label class="sr-only" for="chat-input">向 AI 协同助手提问</label><textarea id="chat-input" rows="2" maxlength="2000" placeholder="例如：南湾户家属还没到，需要人员陪同接送…" ${busy?'disabled':''}>${esc(input)}</textarea><div class="composer-bottom"><span>${status.configured?'发送时会将问题及当前虚构演练交给所配置的模型。':'本地规则导览响应；已预留 DeepSeek 接入。'}<br>Enter 发送 · Shift + Enter 换行</span><button class="button primary" data-ai="send" ${busy?'disabled':''}>${busy?'正在回复…':'发送 ↑'}</button></div></div></section><aside class="assistant-context"><section class="panel">${contextCard(c)}</section><section class="panel ai-help"><h2>可以这样问</h2>${prompts.map((p,i)=>`<button data-ai="prompt" data-index="${i}" ${busy?'disabled':''}>${p}<span>↗</span></button>`).join('')}</section><section class="panel ai-connection"><h2>模型连接</h2><p>${status.configured?'服务已配置，首次成功回复后显示“模型已响应”。':localService()?'已预留 DeepSeek 接入，后续配置账号即可尝试模型对话。当前可体验本地导览与业务联动。':'在线与离线演示均使用本地导览。后续接入 DeepSeek，请下载项目并启动本机服务。'}</p><div class="ai-connection-actions"><button class="text-button" data-ai="connection">查看接入说明</button><button class="text-button" data-ai="check" ${checking?'disabled':''}>刷新状态</button>${status.configured?'<button class="text-button" data-ai="local">切换本地导览</button>':''}</div></section></aside></div>`;
    }
    function contextCard(c){return `<div class="ai-context-head"><h2>正在参考的演练</h2><span class="tag blue">输入 v${c.version}</span></div><div class="ai-context-body"><strong>青岚镇 · 暴雨转移</strong><dl><div><dt>对象</dt><dd>${c.households.length} 户 / ${c.totalPeople} 人</dd></div><div><dt>阶段</dt><dd>${c.phase==='preparation'?'出发前准备':'执行中 · 路线冻结'}</dd></div><div><dt>有效方案</dt><dd>${c.plan?c.plan.servedPeople+' / '+c.totalPeople+' 人已安排':c.planState==='stale'?'旧方案已失效':'尚未生成'}</dd></div><div><dt>可用车辆</dt><dd>${c.vehicles.filter(v=>v.available).length} 辆</dd></div><div><dt>东桥 / 北桥</dt><dd>${c.roads.find(e=>e.id==='east').open?'开放':'封闭'} / ${c.roads.find(e=>e.id==='north').open?'开放':'封闭'}</dd></div><div><dt>待协调事项</dt><dd>${c.pending.length} 项</dd></div></dl><p>每条回答保留其输入版本。演练变化后，旧建议会标记过期。</p><a href="#dispatch">查看接送方案 →</a></div>`;}
    function connection(){const dialog=document.getElementById('edit-dialog');document.getElementById('dialog-body').innerHTML=`<div class="dialog-head"><h2>连接大模型服务</h2><button class="button quiet small" data-action="close">关闭</button></div><p>交流入口已经可用。当前${status.configured?'已配置模型服务':'使用本地导览，尚未配置模型服务'}。</p><p>已按 DeepSeek 预留连接，由本地服务读取配置。后续需要账号可用的模型名称和访问密钥；密钥保留在本机服务端，不放进网页或聊天记录。</p><p class="hint">接入说明位于 demo/AI接入说明.md，配置示例位于 demo/.env.example。配置后重启本地服务，点击“刷新状态”再提问。</p><div class="notice no-margin">对话不会直接确认转移、登记安全或发送调度指令。操作建议仍经过当前演练的核实和确认流程。</div>`;dialog.showModal();}
    document.addEventListener('input',e=>{if(e.target.id==='chat-input')input=e.target.value;});
    document.addEventListener('change',e=>{if(e.target.dataset.chatHousehold){const m=messages.find(m=>String(m.id)===e.target.dataset.chatHousehold);if(m)m.selection=e.target.value;}});
    document.addEventListener('keydown',e=>{if(e.target.id==='chat-input'&&e.key==='Enter'&&!e.shiftKey&&!e.isComposing){e.preventDefault();send();}});
    document.addEventListener('click',async e=>{
      const el=e.target.closest('[data-ai]');if(!el||el.disabled)return;
      try{const action=el.dataset.ai;
        if(action==='send'){await send();return;}
        if(action==='prompt'){input=prompts[Number(el.dataset.index)];update();document.getElementById('chat-input')?.focus();return;}
        if(action==='clear'){reset();update();return;}
        if(action==='cancel'){request?.abort();return;}
        if(action==='connection'){connection();return;}
        if(action==='check'){await check();return;}
        if(action==='local'){checkSequence++;checking=false;status={configured:false,model:''};update();return;}
        if(action==='action'){
          const m=messages.find(m=>String(m.id)===el.dataset.message),a=m?.actions?.[Number(el.dataset.index)];if(!a||a.used||busy)throw new Error('该建议已处理或正在请求，请稍候');if(m.key!==key())throw new Error('演练依据已变化，请重新提问后核对当前建议');
          if(a.type==='receipt'){const id=a.householdId||m.selection;if(!store.data.scenario.households.some(h=>h.id===id))throw new Error('请先选择对应家庭');onReview(id,a.text);a.used=true;return;}
          if(store.data.phase!=='preparation')throw new Error('执行中不能修改路况或重新规划');
          a.used=true;update();if(a.type==='bridge')await onBridge(a.event);else if(a.type==='generate')await onGenerate();
          const c=current();addResult(`算法已完成当前输入 v${c.version} 的计算：安排 ${c.plan.servedPeople} / ${c.totalPeople} 人，${c.plan.unassigned.length} 户未安排；预计最后抵达 ${c.plan.servedPeople?'+'+c.plan.finish+' 分':'无法估计'}。\n请到路径与调度页核对路线和资源，再人工确认草案。`,'tool',c);update();scrollEnd();
        }
      }catch(error){notify(error.message);update();}
    });
    function navigation(page){if(page!=='assistant')returnTo=page;const floating=document.getElementById('assistant-launcher');if(floating)floating.hidden=page==='assistant';}
    queueMicrotask(check);return {page,reset,serialize,navigation,check};
  }
  root.JiaoyingAssistant={create};
})(window);
