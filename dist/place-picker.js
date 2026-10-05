/* Searchable place choices are suggestions, never inferred coordinates. */
(function(root,factory){'use strict';const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;if(root)root.JiaoyingPlacePicker=api;})(typeof window!=='undefined'?window:null,function(){
  'use strict';
  const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const normalize=value=>String(value??'').normalize('NFKC').replace(/\s+/g,'').toLocaleLowerCase();
  const cleanOptions=options=>(Array.isArray(options)?options:[]).filter(o=>o&&o.id!=null&&o.label!=null).map(o=>({id:String(o.id),label:String(o.label),detail:String(o.detail||'')}));
  function filterOptions(options,query){const q=normalize(query);return cleanOptions(options).filter(o=>!q||normalize(o.label).includes(q)||normalize(o.id).includes(q));}
  function html({id,label='地点',value='',options=[],noun='地点',allowCustom=true,placeholder,disabled=false,attributes={}}={}){
    if(!id)throw new Error('地点选择器需要唯一 id');
    noun=String(noun||'地点');allowCustom=allowCustom!==false;
    if(placeholder===undefined)placeholder=noun==='地点'&&allowCustom?'搜索名称 / 编号，或手动填写':`搜索${noun}名称 / 编号${allowCustom?'，或手动填写':'，从候选中选择'}`;
    const attrs=Object.entries(attributes).filter(([key])=>/^data-[a-z][a-z0-9-]*$/.test(key)&&!key.startsWith('data-place-')).map(([key,v])=>`${key}="${escape(v)}"`).join(' ');
    return `<div class="place-picker" data-place-picker data-place-noun="${escape(noun)}" data-place-allow-custom="${allowCustom}" data-place-options="${escape(JSON.stringify(cleanOptions(options)))}"><label class="place-picker-label" for="${escape(id)}">${escape(label)}</label><div class="place-picker-control"><input id="${escape(id)}" class="place-picker-input" type="text" value="${escape(value)}" placeholder="${escape(placeholder)}" role="combobox" aria-autocomplete="list" aria-expanded="false" aria-haspopup="listbox" aria-controls="${escape(id)}-options" aria-label="${escape(label)}" autocomplete="off" spellcheck="false" ${attrs} ${disabled?'disabled':''}><button class="place-picker-toggle" type="button" aria-label="展开${escape(label)}候选${escape(noun)}" aria-expanded="false" tabindex="-1" ${disabled?'disabled':''}><svg class="place-picker-chevron" width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="m6 9 6 6 6-6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path></svg></button></div></div>`;
  }
  function bind(container,{onCommit=()=>{},getOptions}={}){
    if(!container?.querySelectorAll)return ()=>{};
    const doc=container.ownerDocument||(typeof document!=='undefined'?document:null),win=doc?.defaultView;
    if(!doc?.body)return ()=>{};
    const disposers=[];let opened=null,portal=null,portalDialog=null,disposed=false;
    const listen=(node,event,handler,options)=>{node.addEventListener(event,handler,options);disposers.push(()=>node.removeEventListener(event,handler,options));};
    const freshOptions=entry=>{const dynamic=getOptions?.(entry.input);return dynamic===undefined?entry.options:cleanOptions(dynamic);};
    function close(){if(opened){opened.input.setAttribute('aria-expanded','false');opened.toggle.setAttribute('aria-expanded','false');opened.input.removeAttribute('aria-activedescendant');}opened=null;if(portal){portal.remove();portal=null;}if(portalDialog){portalDialog.removeEventListener('close',close);portalDialog=null;}}
    function position(){
      if(!portal||!opened)return;
      const rect=opened.control.getBoundingClientRect(),viewWidth=win?.innerWidth||doc.documentElement.clientWidth||1024,viewHeight=win?.innerHeight||doc.documentElement.clientHeight||768;
      if(rect.bottom<0||rect.top>viewHeight){close();return;}
      const width=Math.min(Math.max(rect.width,280),Math.max(200,viewWidth-24)),below=viewHeight-rect.bottom-12,above=rect.top-12,up=below<180&&above>below,room=Math.max(120,up?above:below);
      portal.style.width=width+'px';portal.style.left=Math.max(12,Math.min(rect.left,viewWidth-width-12))+'px';portal.style.maxHeight=Math.min(390,room)+'px';
      portal.style.top=up?'auto':Math.max(8,rect.bottom+6)+'px';portal.style.bottom=up?Math.max(8,viewHeight-rect.top+6)+'px':'auto';
      const list=portal.querySelector('.place-picker-list');if(list)list.style.maxHeight=Math.max(70,Math.min(320,room-65))+'px';
    }
    function markActive(){
      if(!opened||!portal)return;
      const items=portal.querySelectorAll('[data-place-option]');
      items.forEach((item,i)=>{item.setAttribute('aria-selected',String(i===opened.active));item.classList.toggle('is-active',i===opened.active);});
      const item=items[opened.active];if(item){opened.input.setAttribute('aria-activedescendant',item.id);item.scrollIntoView?.({block:'nearest'});}else opened.input.removeAttribute('aria-activedescendant');
    }
    function draw(){
      if(!opened||!portal)return;
      const entry=opened,options=filterOptions(freshOptions(entry),entry.query),manual=entry.allowCustom?entry.input.value.trim():'';entry.visible=options;entry.manual=manual;entry.active=-1;
      const noun=escape(entry.noun),caption=entry.allowCustom?'可直接填写新'+noun:'请从已登记'+noun+'中选择',empty=entry.allowCustom?'可以继续填写。':'请修改搜索内容，并从候选中选择。',manualNote=entry.noun==='地点'?'未登记地点保留原名，接人位置需补充或地图定位。':'未登记'+noun+'保留填写内容，核对后再保存。';
      portal.innerHTML=`<div class="place-picker-caption">搜索名称或编号 · ${caption}</div><div class="place-picker-list" id="${escape(entry.input.id)}-options" role="listbox" aria-label="${escape(entry.label)}候选${noun}">${options.map((option,i)=>`<div class="place-picker-option" role="option" aria-selected="false" id="${escape(entry.input.id)}-choice-${i}" data-place-option="${i}"><strong>${escape(option.label)}</strong><span class="place-picker-option-id">${escape(option.id)}</span><small>${escape(option.detail||'已登记'+entry.noun)}</small></div>`).join('')}${!options.length?`<div class="place-picker-empty" role="status">没有匹配的已登记${noun}，${empty}</div>`:''}${manual?`<div class="place-picker-option place-picker-manual" role="option" aria-selected="false" id="${escape(entry.input.id)}-choice-${options.length}" data-place-option="${options.length}"><strong>使用填写内容：${escape(manual)}</strong><small>${manualNote}</small></div>`:''}</div>`;
      entry.input.removeAttribute('aria-activedescendant');position();
    }
    function open(entry,query=''){
      if(disposed||entry.input.disabled)return;
      if(opened!==entry){close();opened=entry;portal=doc.createElement('div');portal.className='place-picker-popup';portalDialog=entry.input.closest?.('dialog[open]')||null;(portalDialog||doc.body).appendChild(portal);if(portalDialog)portalDialog.addEventListener('close',close);
        portal.addEventListener('pointerdown',event=>event.preventDefault());
        portal.addEventListener('click',event=>{const item=event.target.closest?.('[data-place-option]');if(!item||!opened)return;event.preventDefault();event.stopPropagation();choose(Number(item.dataset.placeOption));});
      }
      entry.query=query;entry.input.setAttribute('aria-expanded','true');entry.toggle.setAttribute('aria-expanded','true');draw();
    }
    function commit(entry,value,choice,reason){
      const changed=entry.lastValue!==value;entry.input.value=value;entry.lastValue=value;close();
      if(choice||changed)onCommit(entry.input,value,choice,{reason});
    }
    function choose(index){const entry=opened;if(!entry)return;const choice=entry.visible[index];if(choice)commit(entry,choice.label,choice,'selection');else if(index===entry.visible.length&&entry.manual)commit(entry,entry.manual,null,'manual');}
    for(const wrapper of container.querySelectorAll('[data-place-picker]')){
      const input=wrapper.querySelector('.place-picker-input'),toggle=wrapper.querySelector('.place-picker-toggle');if(!input||!toggle)continue;
      const control=wrapper.querySelector('.place-picker-control')||input;
      let options=[];try{options=cleanOptions(JSON.parse(wrapper.dataset.placeOptions||'[]'));}catch{}
      const entry={wrapper,input,toggle,control,options,noun:wrapper.dataset.placeNoun||'地点',allowCustom:wrapper.dataset.placeAllowCustom!=='false',label:input.getAttribute('aria-label')||'地点',lastValue:input.value,query:'',visible:[],active:-1,manual:''};
      listen(input,'input',event=>{event.stopPropagation();open(entry,input.value);});
      listen(input,'change',event=>event.stopPropagation());
      listen(input,'click',event=>{event.stopPropagation();if(opened!==entry)open(entry);});
      listen(input,'blur',event=>{if(wrapper.contains(event.relatedTarget)||portal?.contains(event.relatedTarget))return;commit(entry,input.value.trim(),null,'blur');});
      listen(input,'keydown',event=>{
        if(event.isComposing)return;
        if(event.key==='ArrowDown'||event.key==='ArrowUp'){
          event.preventDefault();event.stopPropagation();if(opened!==entry)open(entry);
          const count=entry.visible.length+(entry.manual?1:0);if(count){entry.active=event.key==='ArrowDown'?(entry.active+1)%count:(entry.active<0?count-1:(entry.active-1+count)%count);markActive();}
        }else if(event.key==='Enter'){
          event.preventDefault();event.stopPropagation();if(opened===entry&&entry.active>=0)choose(entry.active);else commit(entry,input.value.trim(),null,'enter');
        }else if(event.key==='Escape'){
          if(opened===entry){event.preventDefault();event.stopPropagation();close();}
        }else if(event.key==='Tab'){commit(entry,input.value.trim(),null,'tab');}
      });
      listen(toggle,'pointerdown',event=>event.preventDefault());
      listen(toggle,'click',event=>{event.preventDefault();event.stopPropagation();if(opened===entry)close();else{input.focus({preventScroll:true});open(entry);}});
    }
    listen(doc,'pointerdown',event=>{if(opened&&!opened.wrapper.contains(event.target)&&!portal?.contains(event.target))close();});
    if(win){listen(win,'resize',position);listen(win,'scroll',position,true);}
    return ()=>{if(disposed)return;disposed=true;close();for(const dispose of disposers)dispose();};
  }
  return {html,bind,filterOptions};
});
