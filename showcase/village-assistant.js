(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JiaoyingVillageAssistant = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // This adapter only drafts human-reviewed facts using local rules. It neither
  // calls a language model nor commits a report or invents missing field facts.
  const NUM = '[0-9零〇一二两三四五六七八九十百千]+';
  const DIGITS = {零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  const normalize = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  const unique = values => [...new Set(values)];
  const labels = {increment:'新增人数',snapshot:'当前待转移总量',correction:'更正人数'};

  function number(value) {
    if (/^\d+$/.test(value)) return Number(value);
    if (/^[零〇一二两三四五六七八九]+$/.test(value)) {
      return Number([...value].map(char => DIGITS[char]).join(''));
    }
    // “三百五” can mean 305 or 350 in speech; require 零 or 十 explicitly.
    if (/[百千][一二两三四五六七八九]$/.test(value)) return null;
    if (!/^[一二两三四五六七八九]?千?(?:[零〇]?[一二两三四五六七八九]百)?(?:[零〇]?[一二两三四五六七八九]?十)?[零〇]?[一二两三四五六七八九]?$/.test(value)) return null;
    let total = 0, digit = 0, previousUnit = Infinity;
    for (const char of value) {
      if (char in DIGITS) { digit = DIGITS[char]; continue; }
      const unit = {十:10,百:100,千:1000}[char];
      if (!unit || unit >= previousUnit) return null;
      total += (digit || 1) * unit; digit = 0; previousUnit = unit;
    }
    return total + digit;
  }

  function containsName(text, name) {
    const key = normalize(name);
    if (!key) return false;
    if (/^[A-Z0-9-]+$/.test(key)) return new RegExp('(^|[^A-Z0-9-])' + key + '(?![A-Z0-9-])').test(text);
    return text.includes(key);
  }
  function mentioned(text, items) {
    return items.filter(item => [item.id, item.name, ...(item.aliases || [])].some(name => containsName(text, name)));
  }
  function collect(text, patterns) {
    const found = [];
    for (const pattern of patterns) for (const m of text.matchAll(new RegExp(pattern, 'g'))) found.push(number(m[1]));
    return unique(found);
  }
  function validContextCount(value) { return Number.isInteger(value) && value >= 0 && value <= 500; }

  function prepare(input, context) {
    context = context || {};
    const text = typeof input === 'string' ? input.trim() : '';
    const t = normalize(text), data = context.data || {}, villages = data.villages || [];
    const result = {mode:'local-rules',intent:'clarify',title:'请核对村级上报',summary:'本地规则整理草稿，确认后才会提交。',proposal:null,questions:[],warnings:[],evidence:['依据：输入原文及已登记的演示村；未调用大模型。']};
    const ask = value => result.questions.push(value);
    const finish = () => { result.questions = unique(result.questions); result.warnings = unique(result.warnings); return result; };
    if (!text) { ask('请先说出或输入本村新增、当前待转移总量或更正人数。'); return finish(); }
    if (text.length > 2000) { ask('请将单条上报说明缩短至 2000 字以内。'); return finish(); }
    if (!Array.isArray(villages) || !villages.length) { ask('村庄资料尚未就绪，请等待两端连接。'); return finish(); }
    if (/[?？]/.test(text) || /(?:可能|大概|大约|预计|估计|约有|差不多|如果|假设|明天|计划|准备新增|将新增)/.test(t) || new RegExp('(?:约|近|超过|至少|不到)' + NUM).test(t) || new RegExp(NUM + '[.点]' + NUM).test(t) || new RegExp('(?:负|-)' + NUM + '(?:名|位|个)?人').test(t) || new RegExp(NUM + '(?:名|位|个)?人(?:左右|上下)').test(t) || new RegExp(NUM + '(?:到|至|~|～|—|-)' + NUM + '(?:名|位|个)?人').test(t)) {
      ask('人数需为已经核实的整数，请先核对估计、范围、疑问或计划中的人数。');
    }
    if (/(?:不要|不再|并未|没有|并非|不是|未|不)(?:需要)?(?:新增|增加|补报|更正|上报)|取消(?:本次|这次)?(?:上报|新增)|无需转移|不需要转移/.test(t)) ask('这段话含取消或否定上报，请明确本次需要登记的事实。');
    if (/(?:累计|已转移|已经转移|已上车|已经上车|已到达|已经到达|已安置|已经安置)/.test(t)) ask('本入口只登记新增需求或当前等待总量；累计转移、已上车或已到达人数请在任务进展中登记。');

    const explicitVillages = mentioned(t, villages);
    const selectedVillage = villages.find(v => v.id === context.villageId);
    if (context.villageId && !selectedVillage) ask('当前所选村庄已失效，请重新选择。');
    if (explicitVillages.length > 1) ask('一条记录只能属于一个村庄，请按村分开上报。');
    if (explicitVillages.length === 1 && selectedVillage && explicitVillages[0].id !== selectedVillage.id) ask('口述村庄与当前选择不一致，请核对所属村庄。');
    const village = explicitVillages.length === 1 ? explicitVillages[0] : selectedVillage;
    if (!village) ask('请先选择所属村庄，或说出已登记的演示村名称。');
    let remaining = t;
    for (const item of villages) for (const name of [item.id,item.name,item.township,...(item.aliases || [])].filter(Boolean).sort((a,b) => b.length-a.length)) remaining = remaining.split(normalize(name)).join('，');
    remaining = remaining.replace(/(?:本村|全村|该村|村庄|村民|村委会|行政村|一个村|所选村|当前村)/g, '，');
    if (/[\u4e00-\u9fa5]{2,12}(?:村|镇|乡|街道)/.test(remaining)) ask('描述含尚未登记的村镇名称，请先核对村庄；系统不会自动映射真实地名。');

    const hasCorrection = /更正|改为|改成|修正|应为|填错|报错/.test(t);
    const hasIncrement = /新增|新发现|增加|补报|再增|新登记/.test(t);
    const hasSnapshot = /(?:目前|当前|现在|现有|此刻|截至).{0,16}(?:待转移|等待转移|等待接送|等待|待接|还有|共有|总计|剩余)|(?:待转移|等待转移|等待接送|待接)(?:总量|总人数|合计|共计)|(?:仍有|还有).{0,8}(?:待转移|等待转移|需(?:要)?转移)/.test(t);
    let reportMode = hasCorrection ? 'correction' : hasSnapshot ? 'snapshot' : hasIncrement ? 'increment' : context.mode;
    if (hasIncrement && hasSnapshot && !hasCorrection) ask('这段话同时包含新增和当前总量，请分别上报，避免重复累计。');
    if (!labels[reportMode]) ask('请选择本次上报方式：新增人数、当前待转移总量或更正原批次。');
    if (context.mode && reportMode && context.mode !== reportMode) result.warnings.push('已按口述语义整理为“' + labels[reportMode] + '”，请核对确认卡中的上报方式。');

    const pickupItems = village?.pickups || [];
    const foreignPickups = villages.filter(v => v.id !== village?.id).flatMap(v => v.pickups || []).filter(p => containsName(t,p.id));
    if (foreignPickups.length) ask('口述集合点编号不属于当前村庄，请核对村庄与集合点。');
    const explicitPickups = mentioned(t, pickupItems);
    const selectedPickup = pickupItems.find(p => p.id === context.pickupId);
    if (context.pickupId && !selectedPickup) ask('集合点不属于当前村庄，请重新选择。');
    if (explicitPickups.length > 1) ask('一条记录只能对应一个集合点，请按集合点分别上报。');
    if (explicitPickups.length === 1 && selectedPickup && explicitPickups[0].id !== selectedPickup.id) ask('口述集合点与当前选择不一致，请核对。');
    let pickup = explicitPickups.length === 1 ? explicitPickups[0] : selectedPickup;
    const plainPickup = [];
    for (const p of pickupItems) {
      const short = normalize(p.name).replace(/[(（]演示[)）]/g, '');
      if (short && t.includes(short)) plainPickup.push(p);
    }
    if (!explicitPickups.length && plainPickup.length === 1) {
      if (selectedPickup && selectedPickup.id !== plainPickup[0].id) ask('口述集合点与当前选择不一致，请核对。');
      pickup = plainPickup[0];
    } else if (plainPickup.length > 1) ask('请将不同集合点的人数分条上报。');
    if (/(?:集合点|位置|点位)(?:还|尚)?(?:未定|未确定|不清楚|不知道|待定)|还没确定集合点/.test(t)) {
      if (selectedPickup) ask('口述集合点尚未确定，请将页面集合点改为“待补充”后再整理。');
      pickup = null;
    }
    let placeText = t;
    for (const p of pickupItems) for (const name of [p.id,p.name,normalize(p.name).replace(/[(（]演示[)）]/g,'')].filter(Boolean)) placeText = placeText.split(normalize(name)).join('，');
    if (/(?:在|位于|前往)[^，。；,;.]{2,24}?(?:集合|等车|等待接送)/.test(placeText)) {
      if (pickup) ask('口述包含尚未登记的集合位置，请核对所选集合点，不能自动映射。');
      else result.warnings.push('口述集合位置尚未登记，先保留原文并上报，待指挥端补充正式集合点。');
    }

    const assistanceValues = collect(t, [
      '(' + NUM + ')(?:名|位|个)?(?:人|村民|群众|居民)(?:需要|需|要)?(?:特殊)?(?:协助|搀扶|帮助|辅助)',
      '(' + NUM + ')(?:名|位|个)?(?:人|村民|群众|居民)(?:行动不便)',
      '(?:需(?:要)?(?:特殊)?(?:协助|搀扶|帮助|辅助)(?:的)?(?:人员|人数|人)?(?:有|为|共|是|:)?|行动不便(?:的)?(?:人员|人数)?(?:有|为|共|是|:)?)(' + NUM + ')(?:名|位|个)?(?:人)?',
      '(' + NUM + ')(?:名|位|个)?(?:行动不便|需搀扶)(?:的)?(?:人员|老人|人)'
    ]);
    const wheelchairValues = collect(t, [
      '(' + NUM + ')(?:名|位|个)?(?:人)?(?:需要|需|使用|坐|乘坐)?轮椅',
      '轮椅(?:人员|人数|使用者|需求)?(?:有|为|共|是|:)?(' + NUM + ')(?:名|位|个)?(?:人)?'
    ]);
    if (/无人需要(?:协助|搀扶)|无(?:特殊)?(?:协助|搀扶)需求|不需要(?:特殊)?(?:协助|搀扶)|无需(?:特殊)?(?:协助|搀扶)|都能自行转移|均能自行转移/.test(t)) assistanceValues.push(0);
    if (/无(?:人使用|需使用|需|人需要)?轮椅|没有轮椅(?:人员|需求|使用者)?|不需要轮椅|无需轮椅/.test(t)) wheelchairValues.push(0);
    const assisted = unique(assistanceValues), wheelchairs = unique(wheelchairValues);
    if (assisted.length > 1 || assisted.includes(null)) ask('协助人数出现多个或无法辨认的数值，请明确本批次协助人数。');
    if (wheelchairs.length > 1 || wheelchairs.includes(null)) ask('轮椅人数出现多个或无法辨认的数值，请明确本批次轮椅人数。');
    let assistancePeople = assisted.length === 1 ? assisted[0] : null;
    let wheelchairPeople = wheelchairs.length === 1 ? wheelchairs[0] : null;

    const candidateCounts = [];
    const targetedPatterns = reportMode === 'correction' ? [
      '(?:更正(?:人数)?为|改成|改为|修正为|应为|实际(?:是|为)|核实为)(?:总共|共|有)?(' + NUM + ')(?:名|位|个)?(?:人|村民|群众|居民)'
    ] : [
      '(?:新增|增加|补报|新发现|新登记|再增)(?:待转移|需转移|人员|人数)?(?:有|为|共|了)?(' + NUM + ')(?:名|位|个)?(?:人|村民|群众|居民)',
      '(?:待转移|等待转移|等待接送|待接|共有|总计|合计|共计|还有|仍有)(?:总量|总人数|人数)?(?:有|为|共|是|:)?(' + NUM + ')(?:名|位|个)?(?:人|村民|群众|居民)'
    ];
    candidateCounts.push(...collect(t, targetedPatterns));
    if (reportMode !== 'correction' || !candidateCounts.length) {
      for (const m of t.matchAll(new RegExp('(' + NUM + ')(?:名|位|个)?(?:人|村民|群众|居民)', 'g'))) {
        const prefix = t.slice(Math.max(0,m.index-12),m.index), suffix = t.slice(m.index+m[0].length,m.index+m[0].length+12);
        if (/(?:其中|含|包括|包含|协助|搀扶|轮椅|老人|儿童)(?:人数|人员)?(?:有|为|共|是|:)?$/.test(prefix) || /^(?:需要|需|要|使用|坐|乘坐)?(?:特殊)?(?:协助|搀扶|帮助|辅助|轮椅|行动不便)/.test(suffix)) continue;
        candidateCounts.push(number(m[1]));
      }
    }
    const counts = unique(candidateCounts);
    if (counts.length !== 1 || counts[0] === null) ask(counts.length > 1 ? '出现多个总人数，请明确本批次人数，特需人数应说明“其中”。' : '请明确本批次总人数，例如“新增二十人，其中三人需要协助”。');
    const people = counts.length === 1 ? counts[0] : null;
    if (people !== null && (!validContextCount(people) || (reportMode === 'increment' && people < 1))) ask(reportMode === 'increment' ? '新增人数应为 1 至 500 的整数。' : '当前总量或更正人数应为 0 至 500 的整数。');
    if (people !== null && assistancePeople !== null && assistancePeople > people) ask('协助人数不能超过本批次总人数。');
    if (people !== null && wheelchairPeople !== null && wheelchairPeople > people) ask('轮椅人数不能超过本批次总人数。');
    if (assistancePeople !== null && wheelchairPeople !== null && wheelchairPeople > assistancePeople) ask('轮椅人数应包含在协助人数中，不能超过协助人数。');

    const together = /一家人|同一家|同一家庭|不可拆分|不能拆分|不拆分|一起转移|必须同行/.test(t);
    const splittable = /可(?:以)?(?:按人数)?拆分|允许拆分|都是独立人员|均为独立人员|可以分批|可分组/.test(t.replace(/不可拆分|不能拆分|不可以拆分|不允许拆分|不可以分批|不可分组/g, '，'));
    if (together && splittable) ask('同时出现可拆分和必须同行，请核对人员分组方式。');
    const groupPolicy = together ? 'together' : splittable ? 'splittable' : 'unknown';

    let targetId = reportMode === 'correction' ? String(context.targetId || '') : '';
    const spokenTargets = unique(t.match(/VR\d+(?![A-Z0-9])/g) || []);
    if (reportMode === 'correction') {
      if (spokenTargets.length > 1) ask('每次只能更正一个原批次，请选择需要更正的记录。');
      if (spokenTargets.length === 1) {
        if (targetId && targetId !== spokenTargets[0]) ask('口述更正批次与页面所选记录不一致，请核对。');
        targetId = spokenTargets[0];
      }
      if (!targetId) ask('更正前请明确选择原批次，不能凭总数覆盖历史记录。');
      const target = (data.villageReports || []).find(r => r.id === targetId);
      if (targetId && !target) ask('原批次不存在，请刷新并重新选择。');
      if (target && village && target.villageId !== village.id) ask('原批次不属于本村，请核对更正对象。');
      if (target && (target.mode === 'snapshot' || target.supersededBy || target.status === 'rejected' || target.status === 'superseded')) ask('该记录不是可更正的有效人员批次，请重新选择。');
      if (target && (target.householdIds || []).some(id => data.stage?.[id] && data.stage[id] !== 'waiting')) ask('原批次已有人员上车或到达，不能在这里改写人数，请由指挥端核查。');
    }
    let observedAt = '';
    if (reportMode === 'snapshot') {
      const date = new Date(context.observedAt || '');
      if (!Number.isFinite(date.getTime())) ask('请填写本次“当前等待总量”的统计时刻。');
      else observedAt = date.toISOString();
      result.warnings.push('当前等待总量只作盘点记录，不会自动加减人员；差异需核对原批次。');
    }
    const reporter = String(context.reporter || '现场演示员').trim();
    if (!reporter || reporter.length > 40) ask('上报人名称应为 1 至 40 字。');
    if (result.questions.length) return finish();

    if (!pickup) result.warnings.push('集合点待补充：可以先上报，核实并补点后才进入路线规划。');
    if (assistancePeople === null || wheelchairPeople === null) result.warnings.push('未提及的协助或轮椅人数保留为“待核实”，不会默认填零。');
    if (groupPolicy === 'unknown') result.warnings.push('人员能否拆分尚未核实；分组规则补充后才进入路线规划。');
    if (assistancePeople !== null || wheelchairPeople !== null) result.warnings.push('协助人数、轮椅人数都是总人数的子集，轮椅人数包含在协助人数内，不重复相加。');
    if (village.synthetic) result.warnings.push('当前为演示村和合成集合点，尚未绑定真实村庄资料。');
    result.intent = 'village-report';
    result.title = '待确认：' + labels[reportMode];
    result.summary = village.name + ' · ' + labels[reportMode] + ' ' + people + ' 人' + (pickup ? ' · ' + pickup.name : ' · 集合点待补充');
    result.evidence.push('村庄：' + village.id + '；上报方式：' + reportMode + '；总人数：' + people);
    result.proposal = {action:'village-report',payload:{villageId:village.id,mode:reportMode,people,pickupId:pickup?.id || '',assistancePeople,wheelchairPeople,groupPolicy,targetId,observedAt,scope:'waiting',text,reporter,source:['voice','text','manual','quick'].includes(context.source) ? context.source : 'text',duplicateAcknowledged:false}};
    return finish();
  }

  return {mode:'local-rules',prepare};
});
