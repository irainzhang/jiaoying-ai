(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./village-assistant.js'),require('./place-directory.js'));
  else root.JiaoyingCommandIntake = factory(root.JiaoyingVillageAssistant,root.JiaoyingPlaceDirectory);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (villageAssistant,directory) {
  'use strict';

  // Pure local normalization: a preview is never a submission or an allocation.
  const MAX_ROWS = 100;
  const norm = value => String(value == null ? '' : value).normalize('NFKC').trim().replace(/\s+/g, '').toUpperCase();
  const string = value => String(value == null ? '' : value).trim();
  const unique = values => [...new Set(values)];
  const result = sourceText => ({rows:[],errors:[],warnings:[],sourceText:sourceText || ''});
  const aliases = {
    villageId:['村庄','所属村','村名','村庄名称','村庄编号','行政村','village','villageid'],
    pickupId:['集合点','接人点','集合点编号','接人地点','pickup','pickupid'],
    people:['人数','总人数','人员数量','新增人数','转移人数','people','count'],
    assistancePeople:['需协助人数','需要协助人数','协助人数','行动不便人数','assistancepeople','assistance'],
    wheelchairPeople:['轮椅人数','需轮椅人数','轮椅需求人数','wheelchairpeople','wheelchair'],
    groupPolicy:['同行关系','分组方式','人员关系','能否拆分','grouppolicy'],
    name:['姓名','人员姓名','name'],
    longitude:['经度','longitude','lng','lon'],
    latitude:['纬度','latitude','lat'],
    coordinateSystem:['坐标系','坐标系统','coordinatesystem','crs'],
    text:['备注','说明','原文','text','note']
  };
  const headers = new Map(Object.entries(aliases).flatMap(([key,names]) => names.map(name => [norm(name),key])));

  function names(village) {
    const values = [village.id,village.name,...(village.aliases || [])];
    const demo = norm(village.name).match(/^演示村([A-Z])$/);
    if (demo) values.push('村'+demo[1]);
    return unique(values.filter(Boolean).map(norm));
  }
  function includesName(text, name) {
    if (/^[A-Z0-9-]+$/.test(name)) return new RegExp('(^|[^A-Z0-9-])'+name+'(?![A-Z0-9-])').test(text);
    if (/[A-Z0-9]$/.test(name)) return text.includes(name) && !new RegExp(name+'[A-Z0-9]').test(text);
    return text.includes(name);
  }
  function villagesIn(text, villages) { const t=norm(text);return villages.filter(v => names(v).some(name => includesName(t,name))); }
  function villageFor(value, villages) { const key=norm(value);return villages.filter(v => names(v).includes(key)); }
  const pickupItemsFor=(village,data)=>directory?directory.pickups(data,village?.id):(village?.pickups||[]);
  const distinctPoints=points=>points.filter((p,i)=>points.findIndex(x=>(x.publicPlaceId||x.id)===(p.publicPlaceId||p.id))===i);
  function pickupFor(value, village, data) {
    const key=norm(value);
    const points=pickupItemsFor(village,data),byId=points.filter(p=>norm(p.id)===key);
    return byId.length?byId:distinctPoints(points.filter(p => [p.name,...(p.aliases || []),norm(p.name).replace(/\(演示\)/g,'')].some(name => norm(name)===key)));
  }
  function warningsFor(row) {
    const out=[];
    if (!row.pickupId) out.push('集合点待补充，补齐后才能安排接人路线。');
    if (row.assistancePeople===null || row.wheelchairPeople===null) out.push('未提供的协助、轮椅人数保留为待核实，不默认填零。');
    if (row.groupPolicy==='unknown') out.push('同行关系待核实，补齐后才能安排分车。');
    return out;
  }
  function finish(out) { out.errors=unique(out.errors);out.warnings=unique(out.warnings);return out; }

  // These are labels from the utterance, not geocoding results. Unknown labels
  // deliberately receive no registered ID or road anchor.
  function spokenLocalities(text) {
    const tokens=String(text).normalize('NFKC').match(/[\p{Script=Han}A-Za-z0-9·-]{1,60}?(?:街道|社区|行政村|片区|小区|乡|镇|村(?!民|庄|委|里|内))(?:[ \t]*[A-Za-z][A-Za-z0-9-]*)?/gu)||[];
    return unique(tokens.map(value=>value.replace(/^(?:请将|请(?:帮我|帮忙)?|帮我|安排|接送|转移|来自|位于|我们在|在|新增|增加|补报)+/g,'').trim()).filter(value=>value.length>1&&!/^(?:本村|全村|该村|所选村|当前村|一个村|行政村)$/.test(value)));
  }
  function spokenPickup(text) {
    const t=String(text).normalize('NFKC');
    const match=t.match(/(?:在|位于|前往)([^，,。；;\r\n]{2,80}?)(?:集合|等车|等待接送)(?=[，,。；;]|$)/)||t.match(/(?:集合点|接人点|接人地点)\s*[:：]\s*([^，,。；;\r\n]{2,80})/);
    return match?match[1].trim():'';
  }

  function parseCSV(input) {
    if (typeof input!=='string') throw new Error('CSV 内容必须是文本。');
    let text=input.replace(/^\uFEFF/,'');
    if (text.length>2*1024*1024) throw new Error('CSV 内容过大，请每次上传不超过 100 条需求。');
    let delimiter=',';
    const separator=text.match(/^sep=([,\t;])\r?\n/i);
    if (separator) { delimiter=separator[1];text=text.slice(separator[0].length); }
    else {
      let quoted=false, commas=0,tabs=0;
      for(let i=0;i<text.length;i++) {
        const ch=text[i];
        if(ch==='"') { if(quoted && text[i+1]==='"')i++;else quoted=!quoted; }
        else if(!quoted) { if(ch==='\n'||ch==='\r')break;if(ch===',')commas++;if(ch==='\t')tabs++; }
      }
      if(tabs>commas)delimiter='\t';
    }
    const rows=[];let row=[],cell='',quoted=false,closed=false;
    const cellEnd=()=>{row.push(cell);cell='';closed=false;};
    const rowEnd=()=>{cellEnd();rows.push(row);row=[];};
    for(let i=0;i<text.length;i++) {
      const ch=text[i];
      if(quoted) {
        if(ch==='"') { if(text[i+1]==='"'){cell+='"';i++;}else {quoted=false;closed=true;} }
        else cell+=ch;
      } else if(ch===delimiter)cellEnd();
      else if(ch==='\r'||ch==='\n') { if(ch==='\r'&&text[i+1]==='\n')i++;rowEnd(); }
      else if(ch==='"') { if(cell.length||closed)throw new Error('CSV 引号格式不正确，请检查第 '+(rows.length+1)+' 行。');quoted=true; }
      else if(closed) { if(!/[ \t]/.test(ch))throw new Error('CSV 引号结束后含多余文字，请检查第 '+(rows.length+1)+' 行。'); }
      else cell+=ch;
    }
    if(quoted)throw new Error('CSV 引号未闭合，请检查包含换行或逗号的单元格。');
    if(cell.length||row.length||closed)rowEnd();
    return rows;
  }

  function count(value, label, errors, optional) {
    const text=norm(value);
    if(optional && (!text || ['待核实','未知','不详','待补充','UNKNOWN'].includes(text)))return null;
    if(!/^\d+$/.test(text) || !Number.isSafeInteger(Number(text)) || Number(text)>500) {
      errors.push(label+'须为 0 至 500 的整数'+(optional?'，不确定时请留空。':'。'));return null;
    }
    return Number(text);
  }
  function grouping(value, errors) {
    const text=norm(value);
    if(!text||['UNKNOWN','未知','不详','待核实','待补充'].includes(text))return 'unknown';
    if(['SPLITTABLE','可拆分','可以拆分','可分组','可以分组','独立人员','允许分车','可分车','是','可'].includes(text))return 'splittable';
    if(['TOGETHER','必须同行','同行','整组同行','不可拆分','不能拆分','一家人','同一家庭','否','不可'].includes(text))return 'together';
    errors.push('同行关系无法识别，请填“可拆分”“必须同行”或留空待核实。');return 'unknown';
  }

  function parseRows(input, context) {
    context=context||{};const out=result();
    if(!Array.isArray(input)||!input.length||input.some(row=>!Array.isArray(row))) {out.errors.push('请上传含表头的 Excel / CSV 表格。');return out;}
    const first=input.findIndex(row=>row.some(value=>string(value)));
    if(first<0){out.errors.push('表格为空。');return out;}
    const header=input[first];const cols={};
    header.forEach((name,index)=>{const key=headers.get(norm(name));if(key){if(cols[key]!==undefined)out.errors.push('表头“'+string(name)+'”与其他列含义重复，请只保留一列。');else cols[key]=index;}});
    if(cols.villageId===undefined&&!context.villageId)out.errors.push('表格缺少“村庄”列。');
    if(cols.people===undefined&&cols.name===undefined)out.errors.push('表格需包含“人数”列，或提供每人一行的“姓名”列。');
    const source=input.slice(first+1).map((values,index)=>({values,rowIndex:first+index+2})).filter(item=>item.values.some(value=>string(value)));
    if(!source.length)out.errors.push('表格没有可导入的人员记录。');
    if(source.length>MAX_ROWS)out.errors.push('单次最多导入 100 条记录，请分批上传。');
    const villages=context.data?.villages||[];
    if(!villages.length)out.errors.push('村庄资料尚未就绪，请等待连接后重新整理。');
    if(out.errors.length)return finish(out);
    for(const item of source) {
      const values=item.values, rowErrors=[],get=key=>cols[key]===undefined?'':values[cols[key]];
      if(values.slice(header.length).some(value=>string(value)))rowErrors.push('存在超出表头的单元格，请检查逗号、引号或列数。');
      const villageValue=string(get('villageId'))||context.villageId||'';
      const match=villageFor(villageValue,villages);
      const village=match.length===1?match[0]:null;
      if(!villageValue||villageValue.length>100)rowErrors.push('村庄名称不能为空且不能超过100字。');
      if(match.length>1)rowErrors.push('村庄名称不唯一，请使用已登记编号。');
      const pickupValue=string(get('pickupId'))||context.pickupId||'';
      const point=pickupValue&&village?pickupFor(pickupValue,village,context.data):[];
      if(pickupValue.length>100)rowErrors.push('集合点名称不能超过100字。');
      if(point.length>1||pickupValue&&!point.length&&villages.some(v=>(v.pickups||[]).some(p=>p.id===pickupValue)))rowErrors.push('集合点“'+pickupValue+'”不属于该村或名称不唯一。');
      const lon=string(get('longitude')),lat=string(get('latitude')),hasCoordinates=!!(lon||lat);
      let longitude=null,latitude=null,coordinateSystem=null;
      if(hasCoordinates){
        longitude=Number(lon);latitude=Number(lat);coordinateSystem=norm(get('coordinateSystem'))||'WGS84';
        if(!lon||!lat||!Number.isFinite(longitude)||!Number.isFinite(latitude)||longitude<-180||longitude>180||latitude<-90||latitude>90)rowErrors.push('经纬度须同时提供有效数字。');
        if(coordinateSystem!=='WGS84')rowErrors.push('仅接受WGS84经纬度，请先核对或转换坐标系，不能直接使用GCJ02或BD09。');
      }
      const named=string(get('name'));
      let people;
      if(!string(get('people')) && named)people=1;
      else people=count(get('people'),'人数',rowErrors,false);
      if(people===0)rowErrors.push('新增人数应至少为 1 人。');
      const assistancePeople=count(get('assistancePeople'),'需协助人数',rowErrors,true);
      const wheelchairPeople=count(get('wheelchairPeople'),'轮椅人数',rowErrors,true);
      if(people!==null&&assistancePeople!==null&&assistancePeople>people)rowErrors.push('需协助人数不能超过总人数。');
      if(people!==null&&wheelchairPeople!==null&&wheelchairPeople>people)rowErrors.push('轮椅人数不能超过总人数。');
      if(assistancePeople!==null&&wheelchairPeople!==null&&wheelchairPeople>assistancePeople)rowErrors.push('轮椅人数包含在需协助人数内，不能超过需协助人数。');
      const groupPolicy=grouping(get('groupPolicy'),rowErrors);
      if(rowErrors.length){out.errors.push(...rowErrors.map(error=>'第 '+item.rowIndex+' 行：'+error));continue;}
      const text=[village?.name||villageValue,point[0]?.name||pickupValue||'集合点待补充',named?'姓名：'+named:'','新增 '+people+' 人','需协助 '+(assistancePeople===null?'待核实':assistancePeople+' 人'),'轮椅 '+(wheelchairPeople===null?'待核实':wheelchairPeople+' 人'),'同行关系：'+(string(get('groupPolicy'))||'待核实'),string(get('text'))].filter(Boolean).join('；');
      if(text.length>2000){out.errors.push('第 '+item.rowIndex+' 行：姓名或备注过长，请将记录缩短至 2000 字以内。');continue;}
      const row={villageId:village?.id||'',villageName:village?.name||villageValue,pickupId:point[0]?.id||'',pickupName:point[0]?.name||pickupValue,longitude,latitude,coordinateSystem,people,assistancePeople,wheelchairPeople,groupPolicy,text,rowIndex:item.rowIndex};
      row.warnings=warningsFor(row);out.rows.push(row);
      if(!village)row.warnings.push('保留上传村庄原名；行政归属尚未核验，不自动猜测位置。');
      if(!point.length)row.warnings.push(hasCoordinates?'经纬度需在瑞安道路地图内核对关联；超出有限路网范围时保留待定位。':'未找到已登记接人位置，先入台账待定位，不生成虚构路线。');
      out.warnings.push(...row.warnings.map(w=>'第 '+item.rowIndex+' 行：'+w));
    }
    return finish(out);
  }

  function segments(text, villages) {
    const paragraphs=text.split(/[;；\r\n。]+/).map(value=>value.trim()).filter(Boolean),out=[];
    for(const paragraph of paragraphs) {
      let current='';
      for(const clause of paragraph.split(/[,，]/)) {
        const startsPlace=!!(villagesIn(clause,villages).length||spokenLocalities(clause).length);
        const hasDemand=/(?:新增|增加|补报|新发现|新登记|再增|安排|接送|转移).*[0-9零〇一二两三四五六七八九十百千]+/.test(current);
        const parentPrefix=!hasDemand&&!/[0-9零〇一二两三四五六七八九十百千]+\s*(?:名|位|个)?人/.test(current)&&villagesIn(clause,villages).some(child=>villagesIn(current,villages).some(parent=>child.parentId===(parent.catalogDistrictId||parent.id)));
        if(startsPlace && !parentPrefix && (villagesIn(current,villages).length||hasDemand)) {out.push(current);current=clause;}
        else current+=(current?'，':'')+clause;
      }
      if(!current)continue;
      if(out.length && !villagesIn(current,villages).length && /^(其中|含|包含|包括|轮椅|协助|需协助|无需|无轮椅|都能|均能|可拆分|可以分|独立人员|必须同行|不可拆分|在|集合点)/.test(norm(current)))out[out.length-1]+='，'+current;
      else out.push(current);
    }
    return out;
  }
  function prepareText(text, villages) {
    let t=text.normalize('NFKC');
    // Only known demo aliases are expanded; real village names are never guessed.
    for(const village of villages) {
      const demo=norm(village.name).match(/^演示村([A-Z])$/);
      if(demo)t=t.replace(new RegExp('(?<!演示)村\\s*'+demo[1]+'(?![A-Z0-9])','gi'),village.name);
    }
    // Explicit quantities make these command verbs equivalent to an added demand.
    // Existing total-count and correction semantics are kept for the assistant to reject below.
    if(!/(?:更正|改为|改成|修正|目前|当前|现在|现有|总量|总人数|累计|还有|仍有|已转移|已经转移|已上车|已经上车|已到达|已经到达|已安置|已经安置)/.test(t)) {
      t=t.replace(/(?:安排|转移|接送|请将)\s*(?=[0-9零〇一二两三四五六七八九十百千]+(?:名|位|个)?(?:人|村民|群众|居民))/g,'新增');
    }
    t=t.replace(/(?<!不)可以分组/g,'可分组');
    return t;
  }

  function parseText(input, context) {
    context=context||{};const text=typeof input==='string'?input.trim():'';const out=result(text);
    if(!text){out.errors.push('请先输入或说出要安排的村庄、集合点和新增人数。');return out;}
    if(text.length>20000){out.errors.push('本次内容过长，请拆分为每次不超过 100 条、总计 20000 字的需求。');return out;}
    if(!villageAssistant?.prepare){out.errors.push('本地整理模块尚未就绪，请刷新后重试。');return out;}
    const villages=context.data?.villages||[];
    if(!villages.length){out.errors.push('村庄资料尚未就绪，请等待连接后重新整理。');return out;}
    const parts=segments(text,villages);
    if(parts.length>MAX_ROWS){out.errors.push('单次最多整理 100 条记录，请分批输入。');return out;}
    parts.forEach((part,index)=>{
      const rowIndex=index+1, prefix='第 '+rowIndex+' 条：';
      if(/(?:不要|无需|不用|不必|不再|取消|不需要|不能|未|不)(?:再)?(?:安排|转移|接送)|(?:安排|转移|接送)(?:取消|不了)/.test(norm(part))) {out.errors.push(prefix+'包含取消或否定安排，请明确本次新增需求。');return;}
      if(/(?:总计|共计|合计|总共|共有|总量|总人数)/.test(norm(part))&&!/(?:新增|新发现|增加|补报|新登记|再增)/.test(norm(part))){out.errors.push(prefix+'总量不能直接当作新增人数，请明确本次新增需求；总量盘点请使用村级台账。');return;}
      const named=villagesIn(part,villages),explicit=named.filter(v=>!named.some(child=>child.parentId===(v.catalogDistrictId||v.id))),selected=villages.find(v=>v.id===context.villageId);
      if(explicit.length>1){out.errors.push(prefix+'一条记录涉及多个或同名地区，请按地区分开，并选择唯一的登记编号。');return;}
      if(context.villageId&&!selected){out.errors.push(prefix+'当前所选地区已失效，请重新选择。');return;}
      if(explicit.length===1&&selected&&explicit[0].id!==selected.id&&explicit[0].parentId!==(selected.catalogDistrictId||selected.id)){out.errors.push(prefix+'口述地区与当前选择不一致，请核对所属地区。');return;}
      const localities=spokenLocalities(part).filter(value=>!villages.some(v=>names(v).includes(norm(value)))&&!explicit.some(v=>norm(v.name).startsWith(norm(value))));
      // A known village can sit inside an explicitly spoken township. Do not
      // silently discard that extra place: the user can select one unambiguous
      // area instead of routing a potentially different village.
      if(localities.length>1||explicit.length&&localities.length){out.errors.push(prefix+'一条记录涉及多个地区名称，请分条录入或先明确所属地区。');return;}
      const freeVillage=localities[0]||(!explicit.length&&!selected?string(context.villageName):'');
      const village=freeVillage?null:(explicit[0]||selected||null);
      const villageName=village?.name||freeVillage;
      const contextVillageName=selected?.name||string(context.villageName),spokenVillageName=explicit[0]?.name||localities[0];
      const changedVillage=!!(contextVillageName&&spokenVillageName&&norm(contextVillageName)!==norm(spokenVillageName));
      const locationWarnings=[];
      if(changedVillage)locationWarnings.push('口述地区与已选地区不同，已保留口述原名并清空原接人点，请核对。');
      if(!village)locationWarnings.push(villageName?'地区未在本场目录中登记，保留原名待定位；不会自动映射真实位置。':'未提供所属地区，已保留人数；请在本行搜索选择或填写地区。');
      const pickupItems=pickupItemsFor(village,context.data);
      const foreign= villages.filter(v=>v.id!==village?.id).flatMap(v=>v.pickups||[]).filter(p=>!pickupItems.some(x=>x.id===p.id)&&includesName(norm(part),norm(p.id)));
      if(foreign.length){out.errors.push(prefix+'口述接人点编号不属于当前地区，请核对地区与接人点。');return;}
      const registeredPickups=distinctPoints(pickupItems.filter(p=>[p.id,p.name,...(p.aliases||[]),norm(p.name).replace(/\(演示\)/g,'')].some(value=>includesName(norm(part),norm(value)))));
      if(registeredPickups.length>1){out.errors.push(prefix+'接人点名称不唯一，请选择登记编号或按接人点分条录入。');return;}
      const selectedPickup=pickupItems.find(p=>p.id===context.pickupId);
      if(!changedVillage&&context.pickupId&&village&&!selectedPickup){out.errors.push(prefix+'所选接人点不属于当前地区，请重新选择。');return;}
      const spokenPoint=spokenPickup(part);
      const unknownPoint=spokenPoint&&!registeredPickups.length?spokenPoint:'';
      const pointName=unknownPoint||(!changedVillage&&!registeredPickups.length&&!selectedPickup?string(context.pickupName):'');
      const effectivePickup=registeredPickups[0]||(!unknownPoint&&!changedVillage?selectedPickup:null);
      if(registeredPickups[0]&&selectedPickup&&registeredPickups[0].id!==selectedPickup.id)locationWarnings.push('口述接人点与当前选择不同，已按明确的口述登记点整理，请核对。');
      if(unknownPoint&&selectedPickup)locationWarnings.push('口述接人位置与所选登记点不同，已保留口述位置并清空旧接人点，请核对。');
      // Reuse the existing conservative count/negation rules with a temporary
      // label-only directory. Temporary IDs never leave this parsing adapter.
      const temporaryVillage={...(village||{}),id:village?.id||'__draft-area__',name:villageName||'未提供地区',pickups:distinctPoints([effectivePickup,...pickupItems].filter(Boolean))};
      if(pointName)temporaryVillage.pickups.push({id:'__draft-pickup__',name:pointName});
      const prepared=villageAssistant.prepare(prepareText(part,villages),{...context,data:{...context.data,villages:[temporaryVillage]},villageId:temporaryVillage.id,pickupId:effectivePickup?.id||(pointName?'__draft-pickup__':''),mode:'increment'});
      if(prepared.proposal?.payload.mode && prepared.proposal.payload.mode!=='increment') {out.errors.push(prefix+'当前总量或更正不能作为新增任务导入，请在村级台账中核对。');return;}
      if(prepared.questions.length){out.errors.push(...prepared.questions.map(question=>prefix+question));return;}
      const p=prepared.proposal?.payload;
      if(!p){out.errors.push(prefix+'没有识别到可登记的新增需求。');return;}
      const pickup=pickupItems.find(item=>item.id===p.pickupId);
      const row={villageId:village?.id||'',villageName,pickupId:pickup?.id||'',pickupName:pickup?.name||pointName,people:p.people,assistancePeople:p.assistancePeople,wheelchairPeople:p.wheelchairPeople,groupPolicy:p.groupPolicy,text:part,rowIndex};
      row.warnings=unique([...prepared.warnings,...locationWarnings,...(!pickup?['接人位置待定位；可以先保存需求，补齐位置后再安排路线。']:[])]);
      out.rows.push(row);out.warnings.push(...row.warnings.map(w=>prefix+w));
    });
    return finish(out);
  }

  const editableFields=['people','villageName','pickupName','assistancePeople','wheelchairPeople','groupPolicy'];
  const fieldLabels={people:'人数',villageName:'村庄',pickupName:'接人点',assistancePeople:'协助人数',wheelchairPeople:'轮椅人数',groupPolicy:'同行关系'};
  const fieldText=(key,value)=>value==null||value===''?'待补':key==='groupPolicy'?({unknown:'待补',splittable:'可分组',together:'须同行'}[value]||String(value)):String(value);
  function withNames(row,context={}) {
    const village=(context.data?.villages||[]).find(v=>v.id===row.villageId),point=pickupItemsFor(village,context.data).find(p=>p.id===row.pickupId);
    return {...row,villageName:row.villageName||village?.name||'',pickupName:row.pickupName||point?.name||''};
  }
  function remember(row,context={}) {
    const next=withNames(row,context);
    if(!next.original)next.original=Object.fromEntries([...editableFields,'text'].map(key=>[key,next[key]??null]));
    next.editedFields=editableFields.filter(key=>next[key]!==next.original[key]);
    return next;
  }
  // Editing a place is an explicit change of facts. Clear the previous anchor so
  // a new label can never remain silently attached to the old map location.
  function updateRow(row,key,value,context={}) {
    let next=remember(row,context);
    if(!editableFields.includes(key))return next;
    const edited=['people','assistancePeople','wheelchairPeople'].includes(key)?(value===''||value==null?null:Number(value)):string(value);
    // A dropdown returns IDs while the input displays canonical names. Picking
    // the current item again must not discard its verified location anchor.
    if(key==='villageName'&&next.villageId&&norm(edited)===norm(next.villageId)&&(context.data?.villages||[]).some(v=>v.id===next.villageId))return next;
    if(key==='pickupName'&&next.pickupId&&norm(edited)===norm(next.pickupId)&&pickupItemsFor((context.data?.villages||[]).find(v=>v.id===next.villageId),context.data).some(p=>p.id===next.pickupId))return next;
    if(next[key]===edited)return next;
    next[key]=edited;
    if(key==='villageName'||key==='pickupName') {
      const villages=context.data?.villages||[],matches=villageFor(next.villageName,villages);
      const selectedVillage=key==='villageName'?villages.find(v=>norm(v.id)===norm(edited)):villages.find(v=>v.id===next.villageId);
      const village=selectedVillage||(matches.length===1?matches[0]:null);
      next.villageId=village?.id||'';
      next.pickupId='';next.locationNodeId=null;next.longitude=null;next.latitude=null;next.coordinateSystem=null;
      // An old village's pickup is not reused merely because it has a generic
      // name shared by another village. The operator chooses the new point.
      if(key==='villageName'){next.villageName=village?.name||edited;next.pickupName='';}
      else if(village){const points=pickupFor(next.pickupName,village,context.data),selectedPoint=pickupItemsFor(village,context.data).find(p=>norm(p.id)===norm(edited)),point=selectedPoint||(points.length===1?points[0]:null);if(point){next.pickupId=point.id;next.pickupName=point.name;}}
    }
    next.editedFields=editableFields.filter(field=>next[field]!==next.original[field]);
    return next;
  }
  function locationReview(row,data={}) {
    const scenario=data.scenario||{},villages=data.villages||[],village=villages.find(v=>v.id===row.villageId),pickup=pickupItemsFor(village,data).find(p=>p.id===row.pickupId);
    const nodeId=row.locationNodeId||pickup?.node;
    const hasCoordinates=row.longitude!=null||row.latitude!=null;
    if(pickup&&row.locationNodeId&&pickup.node!==row.locationNodeId)return {ready:false,label:'接人点与选点冲突',error:'已登记接人点与人工选点不一致，请修改接人点后重新选点。'};
    if(hasCoordinates) {
      if(!Number.isFinite(row.longitude)||!Number.isFinite(row.latitude)||row.longitude<-180||row.longitude>180||row.latitude<-90||row.latitude>90)return {ready:false,label:'经纬度格式待修正',error:'经纬度须同时提供有效数字。'};
      if(row.coordinateSystem!=='WGS84')return {ready:false,label:'坐标系待修正',error:'仅接受 WGS84 经纬度，不能直接使用其他坐标系。'};
      if(scenario.region?.mapKind!=='osm-road-network')return {ready:false,label:'需使用真实道路任务',error:'当前任务不是瑞安道路地图；请先按地图提示启用道路或结束本场后新建道路任务，再保存含坐标的需求。'};
      const b=scenario.region?.bounds;
      if(!Array.isArray(b)||row.longitude<b[0]||row.latitude<b[1]||row.longitude>b[2]||row.latitude>b[3])return {ready:false,label:'超出当前路网范围',warning:'坐标超出当前有限瑞安道路范围；保存需求后仍待定位，不会生成虚构路线。'};
      if(pickup){
        const rad=x=>x*Math.PI/180,lat=rad(row.latitude-(pickup.latitude||0)),lon=rad(row.longitude-(pickup.longitude||0));
        const q=Math.sin(lat/2)**2+Math.cos(rad(row.latitude))*Math.cos(rad(pickup.latitude||0))*Math.sin(lon/2)**2;
        const metres=6371000*2*Math.atan2(Math.sqrt(q),Math.sqrt(Math.max(0,1-q)));
        if(!Number.isFinite(pickup.longitude)||!Number.isFinite(pickup.latitude)||metres>1)return {ready:false,label:'坐标与登记点冲突',error:'上传坐标与已登记接人点不一致；请修改接人点名称并重新核对位置。'};
      }
      // Coordinates alone are a candidate, never proof that a usable route has
      // been found. The authoritative import performs its own road matching.
      if(!nodeId)return {ready:false,label:'坐标待匹配道路',warning:'已提供 WGS84 坐标，保存时匹配可用道路；匹配失败的需求保留待定位。'};
    }
    if(nodeId){
      if(Array.isArray(scenario.nodes)&&!scenario.nodes.some(n=>n.id===nodeId))return {ready:false,label:'接入点待核对',error:'已选接人节点不在当前地图中，请重新选点。'};
      if(Array.isArray(scenario.edges)&&!scenario.edges.some(e=>e.open&&(e.from===nodeId||e.to===nodeId)))return {ready:false,label:'接入道路暂不可用',warning:'接人点没有开放的接入道路，需核实道路情况后重新安排。'};
      return {ready:true,label:row.locationNodeId?'已人工选点':'已匹配登记点'};
    }
    return {ready:false,label:'待定位',warning:'未匹配到已登记接人点；补充位置后才能安排接送。'};
  }
  function reviewRows(rows,context={}) {
    const data=context.data||{},villages=data.villages||[],out={rows:[],errors:[],warnings:[],readyPeople:0,pendingPeople:0,readyRows:0,pendingRows:0};
    for(const [index,input] of (rows||[]).entries()){
      const row=remember(input,context),errors=[],prefix='第 '+(row.rowIndex||index+1)+' 行：';
      if(!Number.isInteger(row.people)||row.people<1||row.people>500)errors.push('人数须为 1 至 500 的整数。');
      for(const key of ['assistancePeople','wheelchairPeople'])if(row[key]!=null&&(!Number.isInteger(row[key])||row[key]<0||row[key]>row.people))errors.push(fieldLabels[key]+'须为 0 至总人数之间的整数，未确认时请留空。');
      if(row.assistancePeople!=null&&row.wheelchairPeople!=null&&row.wheelchairPeople>row.assistancePeople)errors.push('轮椅人数不能超过需协助人数。');
      if(!['unknown','splittable','together'].includes(row.groupPolicy))errors.push('请核对同行关系。');
      if(!row.villageName||row.villageName.length>100||/[\u0000-\u001f]/.test(row.villageName))errors.push('村庄名称不能为空且不能超过 100 字。');
      if(row.pickupName.length>100||/[\u0000-\u001f]/.test(row.pickupName))errors.push('接人点名称不能超过 100 字。');
      const matches=villageFor(row.villageName,villages),byId=villages.find(v=>v.id===row.villageId),village=byId||(matches.length===1?matches[0]:null);
      if(row.villageId&&!byId)errors.push('所选村庄已不在本场目录中，请重新核对。');
      if(matches.length>1&&!byId)errors.push('同名村庄不唯一，请在村庄栏使用已登记编号。');
      if(village){
        const points=pickupFor(row.pickupName,village,data),point=pickupItemsFor(village,data).find(p=>p.id===row.pickupId);
        if(row.pickupId&&!point)errors.push('接人点不属于当前村庄，请重新选择。');
        if(points.length>1&&!point)errors.push('同名接人点不唯一，请在接人点栏使用已登记编号。');
        if(!row.pickupId&&!row.locationNodeId&&points.length===1&&!Number.isFinite(row.longitude)&&!Number.isFinite(row.latitude))row.pickupId=points[0].id;
        if(!row.villageId)row.villageId=village.id;
      }
      const location=locationReview(row,data);
      if(location.error)errors.push(location.error);
      const missing=[!location.ready?'位置':null,row.assistancePeople==null?'协助人数':null,row.wheelchairPeople==null?'轮椅人数':null,row.groupPolicy==='unknown'?'同行关系':null].filter(Boolean);
      row.review={ready:!errors.length&&!missing.length,missing,location,errors};out.rows.push(row);
      out.errors.push(...errors.map(error=>prefix+error));
      if(location.warning)out.warnings.push(prefix+location.warning);
      const candidate=pickupItemsFor(village,data).find(p=>p.id===row.pickupId);
      if(candidate?.sharedCandidate||candidate?.administrativeRelation==='user-selected-unverified')out.warnings.push(prefix+'接人点为瑞安城区道路候选，所属街道尚未核实，请按地图确认现场位置。');
      const people=Number.isInteger(row.people)&&row.people>0?row.people:0;
      if(row.review.ready){out.readyRows++;out.readyPeople+=people;}else{out.pendingRows++;out.pendingPeople+=people;}
    }
    out.errors=unique(out.errors);out.warnings=unique(out.warnings);return out;
  }
  function summary(state,rows) {
    const reviewed=reviewRows(rows,{data:state.data||state}),metrics=state.metrics||{},existingPeople=Number.isFinite(metrics.people)?metrics.people:0;
    const incomingPeople=reviewed.rows.reduce((n,row)=>n+(Number.isInteger(row.people)&&row.people>0?row.people:0),0);
    const legacyPending=(state.data?.reports||[]).filter(r=>r.status==='pending'&&r.kind==='people').reduce((n,r)=>n+(Number.isFinite(r.people)?r.people:0),0);
    const pendingReportPeople=Number.isFinite(state.taskSummary?.pendingReviewPeople)?state.taskSummary.pendingReviewPeople:(Number.isFinite(metrics.pendingVillagePeople)?metrics.pendingVillagePeople:0)+legacyPending;
    return {...reviewed,existingPeople,incomingPeople,afterPeople:existingPeople+incomingPeople,pendingReportPeople};
  }
  function submissionText(row) {
    const original=row.original||{},changes=(row.editedFields||[]).map(key=>fieldLabels[key]+' '+fieldText(key,original[key])+' → '+fieldText(key,row[key]));
    const note=changes.length?'；人工核对修改：'+changes.join('，'):'';
    const source=string(original.text??row.text);
    return source.slice(0,Math.max(0,2000-note.length))+note;
  }
  return {mode:'local-rules',maxRows:MAX_ROWS,parseCSV,parseRows,parseText,editableFields,updateRow,reviewRows,summary,submissionText};
});
