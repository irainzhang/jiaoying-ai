(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory(require('./village-assistant.js'));
  else root.JiaoyingCommandIntake = factory(root.JiaoyingVillageAssistant);
})(typeof globalThis !== 'undefined' ? globalThis : this, function (villageAssistant) {
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
  function pickupFor(value, village) {
    const key=norm(value);
    return (village.pickups || []).filter(p => [p.id,p.name,...(p.aliases || []),norm(p.name).replace(/\(演示\)/g,'')].some(name => norm(name)===key));
  }
  function warningsFor(row) {
    const out=[];
    if (!row.pickupId) out.push('集合点待补充，补齐后才能安排接人路线。');
    if (row.assistancePeople===null || row.wheelchairPeople===null) out.push('未提供的协助、轮椅人数保留为待核实，不默认填零。');
    if (row.groupPolicy==='unknown') out.push('同行关系待核实，补齐后才能安排分车。');
    return out;
  }
  function finish(out) { out.errors=unique(out.errors);out.warnings=unique(out.warnings);return out; }

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
      const match=villageFor(string(get('villageId'))||context.villageId,villages);
      const village=match.length===1?match[0]:null;
      if(!village)rowErrors.push('村庄“'+string(get('villageId'))+'”未登记或名称不唯一，请使用已登记村名或编号。');
      const pickupValue=string(get('pickupId'))||context.pickupId||'';
      const point=pickupValue&&village?pickupFor(pickupValue,village):[];
      if(pickupValue&&point.length!==1)rowErrors.push('集合点“'+pickupValue+'”不属于该村或名称不唯一。');
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
      const text=[village.name,point[0]?.name||'集合点待补充',named?'姓名：'+named:'','新增 '+people+' 人','需协助 '+(assistancePeople===null?'待核实':assistancePeople+' 人'),'轮椅 '+(wheelchairPeople===null?'待核实':wheelchairPeople+' 人'),'同行关系：'+(string(get('groupPolicy'))||'待核实'),string(get('text'))].filter(Boolean).join('；');
      if(text.length>2000){out.errors.push('第 '+item.rowIndex+' 行：姓名或备注过长，请将记录缩短至 2000 字以内。');continue;}
      const row={villageId:village.id,pickupId:point[0]?.id||'',people,assistancePeople,wheelchairPeople,groupPolicy,text,rowIndex:item.rowIndex};
      row.warnings=warningsFor(row);out.rows.push(row);
      out.warnings.push(...row.warnings.map(w=>'第 '+item.rowIndex+' 行：'+w));
    }
    return finish(out);
  }

  function segments(text, villages) {
    const paragraphs=text.split(/[;；\r\n。]+/).map(value=>value.trim()).filter(Boolean),out=[];
    for(const paragraph of paragraphs) {
      let current='';
      for(const clause of paragraph.split(/[,，]/)) {
        if(villagesIn(clause,villages).length && villagesIn(current,villages).length) {out.push(current);current=clause;}
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
      if(!context.villageId&&!villagesIn(part,villages).length){out.errors.push(prefix+'未识别到已登记的村庄，请使用完整村名或编号。');return;}
      const prepared=villageAssistant.prepare(prepareText(part,villages),{...context,mode:'increment'});
      if(prepared.proposal?.payload.mode && prepared.proposal.payload.mode!=='increment') {out.errors.push(prefix+'当前总量或更正不能作为新增任务导入，请在村级台账中核对。');return;}
      if(prepared.questions.length){out.errors.push(...prepared.questions.map(question=>prefix+question));return;}
      if(prepared.warnings.some(w=>w.includes('口述集合位置尚未登记'))){out.errors.push(prefix+'口述集合位置尚未登记，请使用本村已登记集合点；位置不确定时请明确说“集合点待补充”。');return;}
      const p=prepared.proposal?.payload;
      if(!p){out.errors.push(prefix+'没有识别到可登记的新增需求。');return;}
      const row={villageId:p.villageId,pickupId:p.pickupId,people:p.people,assistancePeople:p.assistancePeople,wheelchairPeople:p.wheelchairPeople,groupPolicy:p.groupPolicy,text:part,rowIndex,warnings:prepared.warnings};
      out.rows.push(row);out.warnings.push(...prepared.warnings.map(w=>prefix+w));
    });
    return finish(out);
  }

  return {mode:'local-rules',maxRows:MAX_ROWS,parseCSV,parseRows,parseText};
});
