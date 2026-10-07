/* Shared intake: local file / speech -> editable preview -> explicit draft append.
 * Business adapters own schemas, interpretation and domain validation. No write API here. */
(function(root,factory){'use strict';const api=factory(root);if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.JiaoyingEntryKit=api;})(typeof globalThis!=='undefined'?globalThis:this,function(root){
  'use strict';
  const esc=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const attrs=object=>Object.entries(object||{}).filter(([k])=>/^(?:data-[a-z][a-z0-9-]*|aria-[a-z][a-z0-9-]*)$/.test(k)).map(([k,v])=>`${k}="${esc(v)}"`).join(' ');
  const empty=v=>v==null||v==='';
  const options=field=>(field.options||[]).map(o=>({value:String(o.value),label:String(o.label??o.value)}));
  function fieldLabel(field){return `<span class="entry-field-label">${esc(field.label)}${field.required?' <span class="entry-required" aria-label="必填">*</span>':' <span class="entry-optional">选填</span>'}</span>`;}
  function fieldHint(field){return field.hint?`<small class="entry-field-hint">${esc(field.hint)}</small>`:'';}
  function schemaHelpHTML(schema){
    const fields=schema.fields||[],required=fields.filter(f=>f.required),optional=fields.filter(f=>!f.required);
    return `<div class="entry-schema-help"><p><strong><span class="entry-required" aria-label="必填">*</span> 必填：</strong>${required.length?required.map(f=>esc(f.label)).join('、'):'无'}</p>${optional.length?`<p><strong>选填：</strong>${optional.map(f=>esc(f.label)+(f.optionalSummary?'（'+esc(f.optionalSummary)+'）':'')).join('、')}</p>`:''}${schema.helpNote?`<p class="entry-schema-note">${esc(schema.helpNote)}</p>`:''}</div>`;
  }
  function modesHTML({label='录入方式',items=[],value,disabled=false,className=''}={}){return `<div class="entry-modes ${esc(className)}" role="group" aria-label="${esc(label)}">${items.map(item=>`<button type="button" ${attrs(item.attributes)} aria-pressed="${item.value===value}" class="${item.value===value?'primary':'quiet'}" ${disabled?'disabled':''}>${esc(item.label)}</button>`).join('')}</div>`;}
  function fileHTML({id,label='上传 Excel / CSV',description='',templateAction,templateLabel='下载 Excel 模板',status='文件只在当前浏览器读取，不上传到 GitHub。',disabled=false}={}){return `<div class="intake-upload entry-file"><p>${esc(description)}</p><div class="actions"><label class="file-button" for="${esc(id)}">${esc(label)}<input id="${esc(id)}" type="file" accept=".xlsx,.csv" ${disabled?'disabled':''}></label>${templateAction?`<button type="button" data-ac="${esc(templateAction)}" class="quiet" ${disabled?'disabled':''}>${esc(templateLabel)}</button>`:''}</div><p role="status">${esc(status)}</p></div>`;}
  function voiceHTML({state={},target='chat',activeTarget,button}={}){
    const v=state,here=!!(v.active&&activeTarget===target),elsewhere=!!(v.active&&!here);
    const btn=button||((text,action,attributes,classes)=>`<button type="button" data-ac="${esc(action)}" class="${esc(classes)}" ${attributes}>${esc(text)}</button>`);
    return `<div class="voice-controls">${btn(here?(v.phase==='starting'?'取消等待':v.phase==='stopping'?'整理中…':'结束识别'):target==='chat'?'语音提问':'语音输入','voice',`data-target="${esc(target)}" aria-pressed="${here}" ${!v.supported||elsewhere||v.phase==='stopping'?'disabled':''}`,target==='field-agent'?'primary':'')}${here?btn('取消本次','voice-cancel','','quiet'):'<span>普通话 · 核对后提交</span>'}</div><p class="voice-note" role="status">${esc(elsewhere?'另一处正在进行语音识别，请先结束。':v.note)}</p>${here?`<div class="voice-preview">${esc(v.preview||'正在等待语音…')}</div>`:''}<p class="voice-note muted">浏览器识别可能联网；本演示不保存录音。</p>`;
  }
  function pickerHTML(config={}){if(root.JiaoyingPlacePicker?.html)return root.JiaoyingPlacePicker.html(config);return `<label for="${esc(config.id)}">${esc(config.label||'地点')}<input id="${esc(config.id)}" type="text" value="${esc(config.value)}" placeholder="${esc(config.placeholder||'搜索或填写')}" ${attrs(config.attributes)} ${config.disabled?'disabled':''}></label>`;}
  function readFile(file){if(!root.JiaoyingIntakeFile?.read)throw new Error('文件读取组件尚未就绪，请刷新页面。');return root.JiaoyingIntakeFile.read(file);}
  function html({id,title='录入方式',kinds=[],kind}={}){
    if(!id||!kinds.length)throw new Error('录入模块需要唯一编号和至少一种业务类型。');
    const selected=kinds.some(k=>k.value===kind)?kind:kinds[0].value;
    return `<section id="${esc(id)}" class="entry-kit" data-entry-kit="${esc(id)}" aria-label="${esc(title)}"><div class="entry-kit-heading"><div><h3>${esc(title)}</h3><p>选类型 → 导入或说出情况 → 核对后加入草稿</p></div><label>录入内容<select data-entry-kind aria-label="录入内容">${kinds.map(k=>`<option value="${esc(k.value)}" ${k.value===selected?'selected':''}>${esc(k.label)}</option>`).join('')}</select></label></div><div data-entry-schema-help></div>${modesHTML({value:'file',items:[{value:'file',label:'Excel 导入',attributes:{'data-entry-mode':'file'}},{value:'speech',label:'语音输入',attributes:{'data-entry-mode':'speech'}}]})}<div data-entry-material="file" class="entry-kit-material"><label class="file-button" for="${esc(id)}-file">选择 Excel / CSV 文件<input type="file" id="${esc(id)}-file" data-entry-file accept=".xlsx,.csv"></label><button type="button" class="quiet" data-entry-action="template">下载 Excel 模板</button><p>文件仅在当前浏览器读取。一次导入一种内容，核对新增或变更后加入当前草稿。</p></div><div data-entry-material="speech" class="entry-kit-material" hidden><p data-entry-example></p><label for="${esc(id)}-speech">语音识别原话（可以修改）</label><textarea id="${esc(id)}-speech" data-entry-speech maxlength="2000" rows="3" placeholder="点击语音输入，说出编号、数量与当前情况；识别结束后核对原话。"></textarea><div data-entry-voice></div><button type="button" class="primary" data-entry-action="parse">整理并预览</button><div data-entry-semantic-status>${root.JiaoyingSemanticIntake?.statusHTML()||'<p>当前使用本地规则整理；没说清的字段保留待补，核对后才加入草稿。</p>'}</div></div><p data-entry-status role="status" aria-live="polite"></p><p data-entry-error class="error-text" role="alert" tabindex="-1"></p><div data-entry-preview></div><button type="button" class="quiet small" data-entry-action="cancel" hidden>取消本次录入</button></section>`;
  }
  function selectOptions(field,value,query=''){
    const list=options(field),v=String(value??''),q=String(query).trim().toLocaleLowerCase();
    return `<option value="">请选择 / 待补</option>${v&&!list.some(o=>o.value===v)?`<option value="${esc(v)}" selected>待修正：${esc(v)}</option>`:''}${list.filter(o=>o.value===v||!q||(o.label+' '+o.value).toLocaleLowerCase().includes(q)).map(o=>`<option value="${esc(o.value)}" ${o.value===v?'selected':''}>${esc(o.label)}</option>`).join('')}`;
  }
  function fieldHTML(field,value,index,id){
    const fieldId=id+'-row-'+index+'-'+field.key,label=`第 ${index+1} 条 ${field.label}`,common=`data-entry-field="${esc(field.key)}" data-entry-row="${index}" aria-label="${esc(label)}"${field.required?' aria-required="true"':''}`,name=fieldLabel(field),hint=fieldHint(field);
    if(field.type==='list'){
      const current=Array.isArray(value)?value:empty(value)?[]:[String(value)],list=options(field),unknown=current.filter(v=>!list.some(o=>o.value===String(v)));
      return `<fieldset class="entry-list"><legend>${name}</legend>${[...list,...unknown.map(v=>({value:String(v),label:'待修正：'+String(v)}))].map(o=>`<label><input type="checkbox" data-entry-field="${esc(field.key)}" data-entry-row="${index}" aria-label="${esc(label+' '+o.label)}" value="${esc(o.value)}" ${current.map(String).includes(o.value)?'checked':''}>${esc(o.label)}</label>`).join('')||'<span>暂无候选，请先登记相关资源。</span>'}${hint}</fieldset>`;
    }
    if(field.type==='select')return `<div class="entry-select"><label for="${esc(fieldId)}">${name}</label><input type="search" data-entry-search="${esc(field.key)}" data-entry-row="${index}" aria-label="搜索${esc(label)}候选" placeholder="搜索名称或编号"><select id="${esc(fieldId)}" ${common}>${selectOptions(field,value)}</select>${hint}</div>`;
    if(field.type==='boolean')return `<label for="${esc(fieldId)}">${name}<select id="${esc(fieldId)}" ${common}><option value="" ${empty(value)?'selected':''}>尚未确认</option><option value="true" ${value===true?'selected':''}>是</option><option value="false" ${value===false?'selected':''}>否</option>${!empty(value)&&value!==true&&value!==false?`<option value="${esc(value)}" selected>待修正：${esc(value)}</option>`:''}</select>${hint}</label>`;
    return `<label for="${esc(fieldId)}">${name}<input id="${esc(fieldId)}" ${common} type="${field.type==='number'?'number':'text'}" value="${esc(value)}" ${field.min!=null?`min="${esc(field.min)}"`:''} ${field.max!=null?`max="${esc(field.max)}"`:''} ${field.maxLength!=null?`maxlength="${esc(field.maxLength)}"`:''} ${field.type==='number'?'step="any"':''}>${hint}</label>`;
  }
  function changeHTML(schema,row){
    const before=row._resourceBefore;if(!before)return '';
    const show=(field,value)=>{if(value==null||value==='')return '未提供';if(Array.isArray(value))return value.join('、');if(typeof value==='boolean')return value?'是':'否';return (field.options||[]).find(o=>String(o.value)===String(value))?.label||String(value);};
    const changed=schema.fields.filter(f=>JSON.stringify(before[f.key])!==JSON.stringify(row[f.key]));
    return '<div class="entry-change-list"><strong>更新现有记录 · '+esc(before.id||before.nodeId||'')+'</strong>'+ (changed.length?changed.map(f=>'<p>'+esc(f.label)+'：'+esc(show(f,before[f.key]))+' → <strong>'+esc(show(f,row[f.key]))+'</strong></p>').join(''):'<p>当前字段与原记录一致，没有变更。</p>')+'</div>';
  }
  function previewHTML(schema,rows,warnings=[],id='entry'){
    return `<div class="entry-preview" role="region" aria-label="录入预览"><div class="entry-preview-heading"><h4>核对 ${rows.length} 条${esc(schema.label||'记录')}</h4><strong>尚未加入草稿</strong></div>${warnings.length?`<div class="notice warn">${warnings.map(w=>`<p>${esc(w)}</p>`).join('')}</div>`:''}${rows.map((row,index)=>`<article class="entry-preview-row" data-entry-preview-row="${index}"><div class="entry-row-heading"><strong>第 ${index+1} 条</strong><button type="button" class="quiet small" data-entry-action="remove" data-entry-row="${index}" aria-label="移除第 ${index+1} 条预览">移除</button></div><div data-entry-diff="${index}">${changeHTML(schema,row)}</div><div class="entry-fields">${schema.fields.map(f=>fieldHTML(f,row[f.key],index,id)).join('')}</div></article>`).join('')}<div class="entry-preview-actions"><button type="button" class="primary" data-entry-action="apply" ${rows.length?'':'disabled'}>确认加入草稿（${rows.length} 条）</button><button type="button" class="quiet" data-entry-action="cancel">取消预览</button></div><p>只加入正在编辑的草稿；随后仍需点击本页的保存按钮。</p></div>`;
  }
  function normalizeRows(schema,rows){
    if(!Array.isArray(rows)||!rows.length)throw new Error('没有可加入的记录，请先导入或整理。');
    const error=(i,f,message)=>{const e=new Error(`第 ${i+1} 条：${f.label}${message}`);e.entryRow=i;e.entryField=f.key;throw e;};
    return rows.map((original,i)=>{const row={...original};for(const f of schema.fields){let v=row[f.key];
      if(typeof v==='string')v=v.trim();
      if(empty(v)){if(f.required)error(i,f,'不能为空，请补充。');row[f.key]=v==null?'':v;continue;}
      if(f.type==='number'){const n=typeof v==='number'?v:Number(v);if(!Number.isFinite(n))error(i,f,'需要填写有效数字。');if(f.min!=null&&n<f.min||f.max!=null&&n>f.max)error(i,f,`应在 ${f.min??'不限'} 至 ${f.max??'不限'} 之间。`);v=n;}
      else if(f.type==='boolean'){if(v!==true&&v!==false)error(i,f,'请明确选择是或否。');}
      else if(f.type==='select'){v=String(v);if(!options(f).some(o=>o.value===v))error(i,f,'不在当前候选中，请重新选择。');}
      else if(f.type==='list'){if(!Array.isArray(v))error(i,f,'请从候选中勾选。');v=v.map(String);if(new Set(v).size!==v.length)error(i,f,'含重复编号，请重新勾选。');if(f.required&&!v.length)error(i,f,'至少选择一项。');if(f.max!=null&&v.length>f.max)error(i,f,`最多选择 ${f.max} 项。`);if(v.some(x=>!options(f).some(o=>o.value===x)))error(i,f,'含已失效或未识别的候选，请重新勾选。');}
      else {v=String(v);if(f.maxLength!=null&&v.length>f.maxLength)error(i,f,`不能超过 ${f.maxLength} 字。`);}
      row[f.key]=v;
    }return row;});
  }
  function bind(container,{id,getSchema,parseRows,parseSpeech,validate,onApply,beforeVoice,detectKind,onKindChange}={}){
    const host=[...container.querySelectorAll('[data-entry-kit]')].find(node=>node.dataset.entryKit===id)||(container.dataset?.entryKit===id?container:null);
    if(!host){const noop=()=>{};noop.hasPending=()=>false;noop.setKind=()=>false;return noop;}
    const q=s=>host.querySelector(s),qa=s=>[...host.querySelectorAll(s)],listeners=[];
    let disposed=false,sequence=0,kind=q('[data-entry-kind]').value,mode='file',preview=null,reading=false,applying=false,voice=null,semanticRequest=null,speechSource='text';
    const schema=()=>{const s=getSchema(kind);if(!s||!Array.isArray(s.fields))throw new Error('当前录入类型尚未配置，请刷新页面。');return s;};
    const pending=()=>!disposed&&(reading||applying||!!voice?.active()||!!q('[data-entry-speech]').value.trim()||!!q('[data-entry-file]').value||!!preview);
    const status=text=>{if(!disposed)q('[data-entry-status]').textContent=text;};
    function error(e){if(disposed)return;const box=q('[data-entry-error]');box.textContent=e?.message||String(e);if(e?.semantic&&!preview)q('[data-entry-preview]').innerHTML=root.JiaoyingSemanticIntake?.sourceHTML(e.semantic)||'';const row=e?.entryRow??e?.rowIndex,key=e?.entryField??e?.field,field=qa('[data-entry-field]').find(n=>Number(n.dataset.entryRow)===row&&n.dataset.entryField===key);(field||box).focus?.();(field||box).scrollIntoView?.({block:'nearest'});}
    function controls(){if(disposed)return;q('[data-entry-action="cancel"]').hidden=!pending();q('[data-entry-action="parse"]').disabled=!!voice?.active()||reading||applying;q('[data-entry-kind]').disabled=applying;q('[data-entry-file]').disabled=applying;qa('[data-entry-mode]').forEach(node=>node.disabled=applying);qa('[data-entry-action="cancel"],[data-entry-action="remove"]').forEach(node=>node.disabled=applying);const apply=q('[data-entry-action="apply"]');if(apply)apply.disabled=applying||reading||!preview?.rows.length;}
    function invalidate(){sequence++;semanticRequest?.abort();semanticRequest=null;reading=false;preview=null;q('[data-entry-preview]').innerHTML='';q('[data-entry-error]').textContent='';controls();}
    function clear(message){invalidate();speechSource='text';q('[data-entry-file]').value='';q('[data-entry-speech]').value='';voice?.cancel('已取消本次语音。',false);drawVoice();status(message||'已取消本次录入，当前资源草稿保持不变。');controls();}
    function drawPreview(){if(disposed)return;q('[data-entry-preview]').innerHTML=preview?(root.JiaoyingSemanticIntake?.sourceHTML(preview.semantic)||'')+previewHTML(schema(),preview.rows,preview.warnings,id):'';controls();}
    function accept(result,warnings=[]){if(!result||!Array.isArray(result.rows))throw new Error('未能整理成记录，请补充内容后重试。');if(result.rows.length>500)throw new Error('一次最多核对 500 条，请拆分后导入。');preview={semantic:result.semantic,originalRows:JSON.parse(JSON.stringify(result.rows)),rows:result.rows.map(row=>({...row})),warnings:[...warnings,...(result.warnings||[])]};drawPreview();status(preview.rows.length?`已整理 ${preview.rows.length} 条，请逐项核对后加入草稿。`:'没有识别到完整记录，请补充内容后重试。');q('[data-entry-preview]').scrollIntoView?.({block:'nearest'});}
    function drawVoice(){if(disposed)return;const v=voice?.state()||{supported:false,active:false,note:'语音组件尚未就绪，可使用设备键盘听写。'};q('[data-entry-voice]').innerHTML=`<div class="voice-controls"><button type="button" data-entry-action="voice" aria-pressed="${!!v.active}" ${!v.supported||v.phase==='stopping'?'disabled':''}>${esc(v.active?(v.phase==='starting'?'取消等待':v.phase==='stopping'?'整理中…':'结束识别'):'开始语音输入')}</button>${v.active?'<button type="button" class="quiet" data-entry-action="voice-cancel">取消本次语音</button>':''}</div><p class="voice-note" role="status">${esc(v.note)}</p>${v.active?`<div class="voice-preview">${esc(v.preview||'正在等待语音…')}</div>`:''}<p class="voice-note">浏览器识别可能联网；不保存录音。</p>`;q('[data-entry-speech]').readOnly=!!v.active;controls();}
    if(root.JiaoyingVoice?.create)voice=root.JiaoyingVoice.create({Recognition:root.SpeechRecognition||root.webkitSpeechRecognition,secure:root.isSecureContext!==false,getText:()=>q('[data-entry-speech]').value,onText:text=>{if(disposed)return;invalidate();speechSource='voice';q('[data-entry-speech]').value=text;controls();},onChange:()=>drawVoice()});
    function updateKind(){const current=schema();q('[data-entry-example]').textContent='例如：'+(current.example||'说清编号、数量及当前情况。');const help=q('[data-entry-schema-help]');if(help)help.innerHTML=schemaHelpHTML(current);const template=q('[data-entry-action="template"]');if(template)template.textContent='下载'+(current.label||'录入')+' Excel 模板';}
    function activateKind(next){if(next===kind){q('[data-entry-kind]').value=kind;return true;}const nextSchema=getSchema(next);if(!nextSchema||!Array.isArray(nextSchema.fields))throw new Error('当前录入类型尚未配置，请刷新页面。');const kinds=q('[data-entry-kind]').options;if(kinds&&!Array.from(kinds).some(option=>option.value===next))throw new Error('这个文件的资源类型不在当前录入范围内。');kind=next;q('[data-entry-kind]').value=kind;updateKind();onKindChange?.(kind);return true;}
    function setKind(next){if(disposed)return false;if(next===kind){q('[data-entry-kind]').value=kind;return true;}if(pending()){q('[data-entry-kind]').value=kind;error(new Error('当前'+(schema().label||'录入内容')+'还有未确认的材料，请先确认加入草稿或点击“取消本次录入”，再切换类型。'));return false;}try{activateKind(next);q('[data-entry-error]').textContent='';status('已切换为'+(schema().label||'当前类型')+'录入，请选择文件或使用语音输入。');return true;}catch(e){q('[data-entry-kind]').value=kind;error(e);return false;}}
    const listen=(name,fn)=>{host.addEventListener(name,fn);listeners.push(()=>host.removeEventListener(name,fn));};
    listen('input',event=>{
      const node=event.target;if(applying)return;if(node===q('[data-entry-speech]')){invalidate();status('原话已修改，请点击“整理并预览”。');controls();return;}
      if(node.dataset?.entrySearch!=null){const f=schema().fields.find(f=>f.key===node.dataset.entrySearch),row=preview?.rows[Number(node.dataset.entryRow)];if(f&&row){const select=qa('select[data-entry-field]').find(n=>n.dataset.entryField===f.key&&n.dataset.entryRow===node.dataset.entryRow);if(select)select.innerHTML=selectOptions(f,row[f.key],node.value);}return;}
      editField(node);
    });
    function editField(node){if(!preview||node.dataset?.entryField==null)return;const index=Number(node.dataset.entryRow),field=schema().fields.find(f=>f.key===node.dataset.entryField),row=preview.rows[index];if(!field||!row)return;let value=node.value;if(field.type==='boolean')value=value==='true'?true:value==='false'?false:value;else if(field.type==='list')value=qa('[data-entry-field]').filter(n=>n.dataset.entryField===field.key&&Number(n.dataset.entryRow)===index&&n.checked).map(n=>n.value);row[field.key]=value;const diff=q('[data-entry-diff="'+index+'"]');if(diff)diff.innerHTML=changeHTML(schema(),row);q('[data-entry-error]').textContent='';}
    listen('change',async event=>{
      const node=event.target;if(applying)return;
      if(node===q('[data-entry-kind]')){setKind(node.value);return;}
      if(node!==q('[data-entry-file]')){editField(node);return;}
      invalidate();const file=node.files?.[0];if(!file){status('未选择文件。');return;}const token=sequence;let fileRead=false;reading=true;status('正在读取并整理 '+file.name+'…');controls();
      try{const read=await readFile(file);if(disposed||token!==sequence)return;fileRead=true;const detected=detectKind?.(read.rows),kindWarnings=[];if(detected&&detected!==kind){activateKind(detected);kindWarnings.push('已根据文件表头切换为'+(schema().label||detected)+'录入，请核对下方内容。');}const result=await parseRows(kind,read.rows);if(disposed||token!==sequence)return;accept(result,[...(read.warnings||[]),...kindWarnings]);}catch(e){if(!disposed&&token===sequence){status((fileRead?'文件已读取，但内容整理未完成':'文件读取未完成')+'；本次没有加入草稿，请按下方提示处理。');error(e);}}finally{if(!disposed&&token===sequence){reading=false;controls();}}
    });
    listen('click',async event=>{
      const button=event.target.closest?.('[data-entry-action],[data-entry-mode]');if(!button||!host.contains(button)||button.disabled||applying)return;event.preventDefault();event.stopPropagation();
      if(button.dataset.entryMode){if(mode===button.dataset.entryMode)return;mode=button.dataset.entryMode;clear('已切换录入方式。');qa('[data-entry-material]').forEach(n=>n.hidden=n.dataset.entryMaterial!==mode);qa('[data-entry-mode]').forEach(n=>{const active=n.dataset.entryMode===mode;n.setAttribute('aria-pressed',String(active));n.classList.toggle('primary',active);n.classList.toggle('quiet',!active);});return;}
      const action=button.dataset.entryAction;
      if(action==='cancel'){clear();return;}
      if(action==='voice-cancel'){voice?.cancel();return;}
      if(action==='voice'){if(voice?.active())voice.stop();else{beforeVoice?.();invalidate();voice?.start();}return;}
      try{
        if(action==='template'){const s=schema(),template=s.template||{headers:s.fields.map(f=>f.label),rows:[]},bytes=xlsxTemplate(template.headers,template.rows||[]),doc=host.ownerDocument,url=root.URL.createObjectURL(new Blob([bytes],{type:'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'})),link=doc.createElement('a');link.href=url;link.download=String(s.label||'录入')+'-录入模板.xlsx';doc.body.appendChild(link);link.click();link.remove();root.setTimeout(()=>root.URL.revokeObjectURL(url),1000);status(template.rows?.length?'Excel 模板已下载。示例均为演练设定，填写实际内容后再导入。':'Excel 模板已下载。按表头填写后再导入，空模板不会加入草稿。');return;}
        if(action==='parse'){if(voice?.active()||applying)return;invalidate();const text=q('[data-entry-speech]').value.trim();if(!text)throw new Error('请先使用语音输入，或在原话框补充情况。');const token=sequence;semanticRequest=typeof root.AbortController==='function'?new root.AbortController():null;reading=true;status('正在整理原话，请稍候；修改原话或取消会撤回本次整理。');controls();try{const result=await parseSpeech(kind,text,{signal:semanticRequest?.signal});if(!disposed&&token===sequence)accept(result);}catch(e){if(!disposed&&token===sequence)error(e);}finally{if(!disposed&&token===sequence){reading=false;controls();}}return;}
        if(action==='remove'){if(!preview||applying)return;preview.rows.splice(Number(button.dataset.entryRow),1);drawPreview();return;}
        if(action==='apply'){if(!preview||applying||reading)return;const token=sequence;applying=true;controls();try{let rows=normalizeRows(schema(),preview.rows);rows=validate?await validate(kind,rows):rows;if(disposed||token!==sequence)return;await onApply(kind,rows,{semantic:preview.semantic,source:mode==='file'?'file':speechSource,utterance:mode==='speech'?q('[data-entry-speech]').value:'',normalizedRows:preview.originalRows});if(!disposed&&token===sequence){clear(`已将 ${rows.length} 条记录加入草稿，请继续保存。`);}}finally{applying=false;controls();}}
      }catch(e){if(!disposed)error(e);}
    });
    updateKind();drawVoice();controls();
    const updateSemanticStatus=()=>{const node=q('[data-entry-semantic-status]');if(!disposed&&node&&root.JiaoyingSemanticIntake)node.innerHTML=root.JiaoyingSemanticIntake.statusHTML();};
    const unsubscribeSemantic=root.JiaoyingSemanticIntake?.subscribe(updateSemanticStatus);updateSemanticStatus();
    const dispose=()=>{if(disposed)return;disposed=true;sequence++;semanticRequest?.abort();unsubscribeSemantic?.();voice?.cancel('录入窗口已关闭。',false);for(const remove of listeners)remove();};dispose.hasPending=pending;dispose.setKind=setKind;return dispose;
  }
  function xlsxTemplate(headers,rows=[]){
    if(!Array.isArray(headers)||!headers.length||headers.length>256||!Array.isArray(rows)||rows.length>4999)throw new Error('Excel 模板的列数或行数无效。');
    const xml=value=>String(value??'').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF]/g,'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&apos;'}[c]));
    const column=i=>{let s='';for(i++;i;i=Math.floor((i-1)/26))s=String.fromCharCode(65+(i-1)%26)+s;return s;};
    const content=[headers,...rows].map((row,r)=>{if(!Array.isArray(row)||row.length>headers.length)throw new Error('Excel 模板示例行的列数超出表头。');return `<row r="${r+1}">${row.map((value,c)=>`<c r="${column(c)}${r+1}" t="inlineStr"><is><t xml:space="preserve">${xml(value)}</t></is></c>`).join('')}</row>`;}).join('');
    const rel='http://schemas.openxmlformats.org/officeDocument/2006/relationships',ns='http://schemas.openxmlformats.org/spreadsheetml/2006/main';
    const files={
      '[Content_Types].xml':'<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/></Types>',
      '_rels/.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>`,
      'xl/workbook.xml':`<workbook xmlns="${ns}" xmlns:r="${rel}"><sheets><sheet name="演练示例-填写后导入" sheetId="1" r:id="rId1"/></sheets></workbook>`,
      'xl/_rels/workbook.xml.rels':`<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="${rel}/worksheet" Target="worksheets/sheet1.xml"/></Relationships>`,
      'xl/worksheets/sheet1.xml':`<worksheet xmlns="${ns}"><sheetData>${content}</sheetData></worksheet>`
    };
    const encoder=new TextEncoder(),parts=[],directory=[];let offset=0;
    const crc=bytes=>{let n=0xffffffff;for(const b of bytes){n^=b;for(let k=0;k<8;k++)n=n>>>1^(n&1?0xedb88320:0);}return (n^0xffffffff)>>>0;};
    for(const [name,text] of Object.entries(files)){
      const n=encoder.encode(name),data=encoder.encode('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'+text),checksum=crc(data),local=new Uint8Array(30),lv=new DataView(local.buffer),central=new Uint8Array(46),cv=new DataView(central.buffer);
      lv.setUint32(0,0x04034b50,true);lv.setUint16(4,20,true);lv.setUint16(6,0x0800,true);lv.setUint16(12,33,true);lv.setUint32(14,checksum,true);lv.setUint32(18,data.length,true);lv.setUint32(22,data.length,true);lv.setUint16(26,n.length,true);
      cv.setUint32(0,0x02014b50,true);cv.setUint16(4,20,true);cv.setUint16(6,20,true);cv.setUint16(8,0x0800,true);cv.setUint16(14,33,true);cv.setUint32(16,checksum,true);cv.setUint32(20,data.length,true);cv.setUint32(24,data.length,true);cv.setUint16(28,n.length,true);cv.setUint32(42,offset,true);
      parts.push(local,n,data);directory.push(central,n);offset+=local.length+n.length+data.length;
    }
    const size=directory.reduce((n,p)=>n+p.length,0),end=new Uint8Array(22),ev=new DataView(end.buffer);ev.setUint32(0,0x06054b50,true);ev.setUint16(8,directory.length/2,true);ev.setUint16(10,directory.length/2,true);ev.setUint32(12,size,true);ev.setUint32(16,offset,true);
    const result=new Uint8Array(offset+size+22);let at=0;for(const p of [...parts,...directory,end]){result.set(p,at);at+=p.length;}return result;
  }
  return {html,bind,modesHTML,fileHTML,voiceHTML,pickerHTML,readFile,previewHTML,changeHTML,normalizeRows,xlsxTemplate,fieldLabel,fieldHint,schemaHelpHTML};
});
