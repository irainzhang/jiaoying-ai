/* Shared semantic intake. The browser calls only its own backend, never a model vendor.
 * Extraction creates a reviewable draft; all writes remain in the existing business adapters. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.JiaoyingSemanticIntake=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const text=(value,max=160)=>typeof value==='string'?value.slice(0,max):'';
  const kinds=new Set(['demand','vehicle','staff','shelter']);
  const auditFields={demand:['rowIndex','villageId','villageName','pickupId','pickupName','people','assistancePeople','wheelchairPeople','groupPolicy','intent','pickupDisposition','longitude','latitude','coordinateSystem','locationNodeId','text'],staff:['id','role','available','intent','targetId','explicitFields'],vehicle:['id','name','model','vehicleType','totalCapacity','wheelchairSlots','start','driverId','escortIds','available','notes','intent','targetId','explicitFields'],shelter:['id','name','capacity','nodeId','available','intent','targetId','explicitFields']};
  const boundedValue=value=>value===null||typeof value==='boolean'?value:typeof value==='number'?Number.isFinite(value)?value:null:typeof value==='string'?value.slice(0,1000):Array.isArray(value)?value.filter(x=>typeof x==='string').slice(0,30).map(x=>x.slice(0,100)):null;
  function auditRows(rows,kind){return (Array.isArray(rows)?rows:[]).slice(0,kind==='staff'?150:100).filter(row=>row&&typeof row==='object'&&!Array.isArray(row)).map(row=>Object.fromEntries([...(auditFields[kind]||[]),'evidence'].filter(key=>Object.hasOwn(row,key)).map(key=>[key,boundedValue(row[key])])));}
  function reviewIssues(rows){return (rows||[]).flatMap((row,rowIndex)=>(Array.isArray(row?.validationIssues)?row.validationIssues:[]).slice(0,15).filter(x=>x&&typeof x.field==='string').map(x=>({rowIndex,field:text(x.field,50),code:text(x.code,80),message:text(x.message,300),modelValue:boundedValue(x.modelValue)}))).slice(0,150);}
  function auditRecord(semantic,confirmedRows,{source='text',kind=semantic?.kind||'demand',utterance=''}={}){
    if(!kinds.has(kind))throw Error('审计录入类型无效。');
    const confirmed=auditRows(confirmedRows,kind),normalized=auditRows(semantic?.normalizedRows||[],kind),changes=[],removedRows=[],addedRows=[];
    const keyOf=(row,index)=>kind==='demand'?(row.rowIndex!=null?'source:'+row.rowIndex:'position:'+index):'resource:'+(row.targetId||row.id||row.nodeId||row.name||'position:'+index);
    const original=new Map(normalized.map((row,index)=>[keyOf(row,index),{row,index}])),current=new Map(confirmed.map((row,index)=>[keyOf(row,index),{row,index}]));
    for(const [rowKey,{row:beforeRow,index}] of original){
      const afterRow=current.get(rowKey)?.row;if(!afterRow){removedRows.push({rowKey,row:beforeRow});continue;}
      for(const field of auditFields[kind]){
        const before=beforeRow[field]??null,after=afterRow[field]??null;
        if(JSON.stringify(before)!==JSON.stringify(after))changes.push({rowIndex:index,rowKey,field,before,after});
      }
    }
    for(const [rowKey,{row}] of current)if(!original.has(rowKey))addedRows.push({rowKey,row});
    const online=semantic?.mode==='online'&&semantic?.provider==='deepseek';
    return {schemaVersion:1,source:['text','voice','file','manual'].includes(source)?source:'manual',kind,provider:online?'deepseek':semantic?'offline':source==='file'?'file':'manual',mode:online?'online':'offline',model:online?text(semantic.model,100):'',requestId:text(semantic?.requestId,100),at:text(semantic?.at,40)||new Date().toISOString(),utterance:text(semantic?.utterance||utterance,8000),modelRows:online?auditRows(semantic.modelRows,kind):[],normalizedRows:normalized,confirmedRows:confirmed,changes:changes.slice(0,1000),removedRows,addedRows,reviewIssues:(semantic?.reviewIssues||[]).slice(0,150).map(x=>({rowIndex:Number.isInteger(x.rowIndex)?x.rowIndex:0,field:text(x.field,50),code:text(x.code,80),message:text(x.message,300),modelValue:boundedValue(x.modelValue)})),reason:text(semantic?.reason,300),sent:semantic?.sent===true};
  }
  const abortError=()=>Object.assign(new Error('本次整理已取消。'),{name:'AbortError'});
  function safeContext(input={}){
    const result={};
    if(Array.isArray(input.nodes))result.nodes=input.nodes.slice(0,300).map(n=>({id:text(n?.id,80),name:text(n?.name||n?.label,120)}));
    if(Array.isArray(input.staff))result.staff=input.staff.slice(0,150).map(s=>({id:text(s?.id,60),role:text(s?.role,30),...(typeof s?.available==='boolean'?{available:s.available}:{})}));
    for(const key of ['vehicles','shelters'])if(Array.isArray(input[key]))result[key]=input[key].slice(0,30).map(s=>({id:text(s?.id||s?.nodeId,80),name:text(s?.name||s?.label,120),...(typeof s?.available==='boolean'?{available:s.available}:{})}));
    if(Array.isArray(input.villages))result.villages=input.villages.slice(0,200).map(v=>({id:text(v?.id,80),name:text(v?.name,120),pickups:(v?.pickups||[]).slice(0,50).map(p=>({id:text(p?.id,80),name:text(p?.name,120)}))}));
    if(input.scope&&typeof input.scope==='object')result.scope=Object.fromEntries(['villageId','villageName','pickupId','pickupName'].filter(k=>typeof input.scope[k]==='string').map(k=>[k,text(input.scope[k],120)]));
    return result;
  }
  function createClient(environment=root){
    let state={checked:false,checking:false,configured:false,connected:false,provider:'deepseek',mode:'offline',model:'',reason:'尚未检查本机语义服务。',lastResult:null},inflight=null;
    const listeners=new Set(),history=[];
    const getStatus=()=>({...state,lastResult:state.lastResult?{...state.lastResult}:null});
    const notify=()=>{for(const fn of listeners)try{fn(getStatus());}catch(_){/* A view must not break intake. */}};
    const canProbe=()=>!!environment.fetch&&/^https?:$/.test(environment.location?.protocol||'')&&!/(^|\.)github\.io$/i.test(environment.location?.hostname||'');
    async function request(path,{body,signal,timeoutMs=45000}={}){
      if(signal?.aborted)throw abortError();
      const controller=new environment.AbortController();let timer,timedOut=false;
      const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});
      try{
        timer=environment.setTimeout(()=>{timedOut=true;controller.abort();},timeoutMs);
        const response=await environment.fetch(path,{method:body?'POST':'GET',credentials:'same-origin',cache:'no-store',redirect:'error',headers:body?{'Content-Type':'application/json'}:{Accept:'application/json'},...(body?{body:JSON.stringify(body)}:{}),signal:controller.signal});
        if(!response.ok){const error=new Error(response.status===429?'语义服务繁忙或额度受限，请稍后重试。':response.status===503?'语义服务当前不可用。':'语义服务返回异常（'+response.status+'）。');error.code='http-'+response.status;throw error;}
        const raw=await response.text();if(raw.length>500000)throw new Error('语义服务返回内容过大。');
        let data;try{data=JSON.parse(raw);}catch(_){throw new Error('当前地址没有可用的语义服务。');}
        if(signal?.aborted)throw abortError();return data;
      }catch(error){if(signal?.aborted)throw abortError();if(timedOut)throw new Error('语义服务响应超时。');if(error.name==='AbortError')throw new Error('语义服务连接中断。');throw error;}
      finally{environment.clearTimeout(timer);signal?.removeEventListener('abort',abort);}
    }
    async function refreshStatus(){
      if(inflight)return inflight;
      if(!canProbe()){state={...state,checked:true,checking:false,configured:false,connected:false,mode:'offline',reason:'当前为静态演示；使用本机服务地址后可接入 DeepSeek。'};notify();return getStatus();}
      state={...state,checking:true};
      inflight=(async()=>{try{const data=await request('/api/v3/semantic/status',{timeoutMs:5000});if(typeof data?.configured!=='boolean')throw new Error('当前地址没有可用的语义服务。');state={...state,checked:true,checking:false,configured:data.configured,connected:data.connected===true,mode:data.configured?'server-proxy':'offline',model:text(data.model,100),reason:data.configured?'后端已配置；语义调用是否成功以本次结果为准。':'本机尚未配置 DeepSeek，继续使用本地规则。'};}catch(_){state={...state,checked:true,checking:false,configured:false,connected:false,mode:'offline',reason:'未连接本机语义服务，继续使用本地规则。'};}finally{inflight=null;notify();}return getStatus();})();return inflight;
    }
    const record=semantic=>{history.push({...semantic});if(history.length>30)history.shift();state={...state,connected:semantic.mode==='online',lastResult:{mode:semantic.mode,requestId:semantic.requestId,at:semantic.at,reason:semantic.reason}};};
    async function interpret(kind,utterance,{context={},fallback,normalize,signal}={}){
      if(!kinds.has(kind))throw new Error('未支持的语义录入类型。');
      if(typeof utterance!=='string'||!utterance.trim()||utterance.length>8000)throw new Error('请提供 1–8000 字的原话。');
      if(typeof fallback!=='function'||typeof normalize!=='function')throw new Error('语义录入需要本地校验与回退适配器。');
      if(signal?.aborted)throw abortError();
      if(!state.checked)await refreshStatus();if(signal?.aborted)throw abortError();
      const requestId='semantic-'+Date.now().toString(36)+'-'+Math.random().toString(36).slice(2,9),at=new Date().toISOString();let sent=false,reason=state.reason;
      if(state.configured&&canProbe()){
        try{
          sent=true;const response=await request('/api/v3/semantic',{body:{requestId,kind,utterance:utterance.trim(),context:safeContext(context)},signal});
          if(!response||response.ok!==true||response.provider!=='deepseek'||response.status!=='online'||response.kind!==kind||!Array.isArray(response.rows)||response.rows.length>150||response.requiresReview!==true)throw new Error('语义结果结构不符合约定。');
          if(response.requestId&&response.requestId!==requestId)throw new Error('语义结果与本次输入不匹配。');
          const normalized=await normalize(response.rows,response);if(signal?.aborted)throw abortError();
          if(!normalized||typeof normalized!=='object')throw new Error('语义结果未通过本地整理。');
          const normalizedRows=normalized.rows|| (normalized.proposal?.payload?[normalized.proposal.payload]:[]);
          const semantic={schemaVersion:1,kind,utterance:utterance.trim(),provider:'deepseek',mode:'online',model:text(response.model,100),reason:'由 DeepSeek 理解原话，本地规则校验；仍需核对。',requestId,at,sent:true,evidence:response.rows.map(r=>text(r?.evidence,300)).filter(Boolean),modelRows:auditRows(response.rows,kind),normalizedRows:auditRows(normalizedRows,kind),reviewIssues:reviewIssues(response.rows)};
          // Retain the rejected value only in provenance, never in editable fields.
          for(const issue of semantic.reviewIssues)if(semantic.modelRows[issue.rowIndex]&&auditFields[kind].includes(issue.field))semantic.modelRows[issue.rowIndex][issue.field]=issue.modelValue;
          record(semantic);return {...normalized,semantic};
        }catch(error){if(signal?.aborted||error.name==='AbortError')throw abortError();reason=error.code?.startsWith('http-')?error.message:/^语义|^当前地址/.test(error.message)?text(error.message,200):'在线语义结果未通过本地检查或服务连接失败。';}
      }
      const semantic={schemaVersion:1,kind,utterance:utterance.trim(),provider:'offline',mode:'offline',model:'',reason:text(reason,200),requestId,at,sent,modelRows:[],normalizedRows:[],reviewIssues:[]};
      try{const normalized=await fallback();if(signal?.aborted)throw abortError();semantic.normalizedRows=auditRows(normalized.rows||(normalized.proposal?.payload?[normalized.proposal.payload]:[]),kind);record(semantic);return {...normalized,semantic};}
      catch(error){if(signal?.aborted||error.name==='AbortError')throw abortError();record(semantic);error.semantic=semantic;throw error;}
    }
    function statusHTML(){const s=getStatus();return `<div class="notice semantic-status ${s.configured?'':'warn'}" role="status"><strong>${s.configured?'DeepSeek 语义整理 · 本机代理已配置':'本地规则整理 · 未连接大模型'}</strong><p>${esc(s.checking?'正在检查本机配置…':s.reason)}</p><p>${s.configured?'点击整理会将本次原话与匹配所需的地点、工作人员编号发送给 DeepSeek；Excel 原文件不发送。':'Excel 在浏览器读取，语音转文字后按本地规则整理。'}</p><button type="button" data-ac="semantic-refresh" class="quiet small">刷新语义服务状态</button></div>`;}
    function sourceHTML(semantic){if(!semantic)return '';const online=semantic.mode==='online';return `<div class="notice semantic-source ${online?'':'warn'}" role="status"><strong>本次来源：${online?'DeepSeek 语义识别'+(semantic.model?' · '+esc(semantic.model):''):'本地规则整理（不是大模型结果）'}</strong><p>${esc(semantic.reason)}</p>${!online&&semantic.sent?'<p>已尝试在线整理，失败后回落本地规则；请核对本次结果。</p>':''}${semantic.evidence?.length?`<details><summary>查看对应原话</summary>${semantic.evidence.map(x=>'<p>'+esc(x)+'</p>').join('')}</details>`:''}<small>仅生成待核对内容，不会自动保存或发布任务。</small></div>`;}
    return {interpret,getStatus,refreshStatus,subscribe(fn){listeners.add(fn);return ()=>listeners.delete(fn);},statusHTML,sourceHTML,getHistory:()=>history.map(x=>JSON.parse(JSON.stringify(x))),safeContext,auditRecord};
  }
  return {...createClient(root),createClient};
});
