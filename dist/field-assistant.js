(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JiaoyingFieldAssistant = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  // This is a conservative local rules adapter, not a language model. It only
  // prepares a proposal; the caller must show it for review before submitting.
  const mode = 'local-rules';
  const compact = value => String(value || '').normalize('NFKC').replace(/\s+/g, '').toUpperCase();
  const unique = values => [...new Set(values)];
  const digits = {零:0,〇:0,一:1,二:2,两:2,三:3,四:4,五:5,六:6,七:7,八:8,九:9};
  const numberPattern = '[0-9零〇一二两三四五六七八九十百]+';
  function number(value) {
    if (/^\d+$/.test(value)) return Number(value);
    if (Object.prototype.hasOwnProperty.call(digits, value)) return digits[value];
    const m = value.match(/^([一二三四五六七八九]?)十([一二三四五六七八九]?)$/);
    return m ? (m[1] ? digits[m[1]] : 1) * 10 + (m[2] ? digits[m[2]] : 0) : null;
  }
  function namedIds(text, records, names) {
    return records.filter(record => names(record).some(name => {
      const key = compact(name);
      if (!key) return false;
      if (/^[A-Z0-9-]+$/.test(key)) return new RegExp('(^|[^A-Z0-9])' + key + '(?![A-Z0-9])').test(text);
      return text.includes(key);
    })).map(record => record.id);
  }
  function householdsIn(text, households) {
    const ids = namedIds(text, households, h => [h.id, h.name]);
    for (const m of text.matchAll(new RegExp('(?:演练)?家庭(?:编号)?(' + numberPattern + ')', 'g'))) {
      const n = number(m[1]);
      if (n !== null) ids.push('H' + n);
    }
    return unique(ids);
  }
  function vehiclesIn(text, vehicles) {
    const ids = namedIds(text, vehicles, v => [v.id, v.name]);
    for (const m of text.matchAll(new RegExp('(' + numberPattern + ')号车', 'g'))) {
      const n = number(m[1]);
      if (n !== null) ids.push('V' + n);
    }
    return unique(ids);
  }
  function locationsIn(text, scenario) {
    const nodes = scenario.nodes || [], edges = scenario.edges || [];
    const nodeIds = unique([...namedIds(text, nodes, n => [n.id, n.label]), ...householdsIn(text, scenario.households || []).filter(id => nodes.some(n => n.id === id))]);
    const edgeIds = namedIds(text, edges, e => [e.id, e.label, e.name]);
    if (/东桥(?![东西])/.test(text) && edges.some(e => e.id === 'east')) edgeIds.push('east');
    if (/北桥(?![东西])/.test(text) && edges.some(e => e.id === 'north')) edgeIds.push('north');
    for (const edge of edges) {
      const from = nodes.find(n => n.id === edge.from), to = nodes.find(n => n.id === edge.to);
      if (!from || !to) continue;
      const a = compact(from.label), b = compact(to.label);
      if (text.includes(a + '到' + b) || text.includes(a + '至' + b) || text.includes(a + '—' + b) || text.includes(a + '-' + b) || text.includes(b + '到' + a) || text.includes(b + '至' + a)) edgeIds.push(edge.id);
    }
    return {nodeIds, edgeIds: unique(edgeIds)};
  }
  function countsIn(text) {
    const counts = [], invalid = [];
    for (const match of text.matchAll(new RegExp('(' + numberPattern + ')(?:名|位|个)?人', 'g'))) {
      // An explicitly subordinate count ("其中一人") is not the group total.
      const prefix = text.slice(Math.max(0, match.index - 7), match.index);
      if (/(?:其中|含|包括|包含)(?:有)?$/.test(prefix)) continue;
      const n = number(match[1]);
      if (n === null) invalid.push(match[0]); else counts.push(n);
    }
    if (/\d+[.点]\d+(?:名|位|个)?人/.test(text)) invalid.push('非整数人数');
    return {counts: unique(counts), invalid};
  }
  function unsupportedPlace(text, scenario) {
    let remaining = text;
    const names = [...(scenario.nodes || []).map(n => n.label), ...(scenario.households || []).map(h => h.name), ...(scenario.shelters || []).map(s => s.name)].filter(Boolean).sort((a,b) => b.length - a.length);
    for (const name of names) remaining = remaining.split(compact(name)).join('，');
    remaining = remaining.replace(/(?:演练)?(?:东桥[东西]?|北桥[东西]?)/g, '，').replace(/当前|现场|这里|所选位置|这个|那条/g, '');
    // Never map a real town/street/village to one of the fictional exercise nodes.
    return /[\u4e00-\u9fa5]{2,16}(?:街道|社区|行政村|镇|乡|村|县|市|大道|大桥|街|路口|医院|学校|大学|广场|车站|小区|公园|码头|桥|路)/.test(remaining);
  }
  function prepare(input, context) {
    context = context || {};
    const text = typeof input === 'string' ? input.trim() : '';
    const normalized = compact(text), data = context.data || {}, scenario = data.scenario || {};
    const result = {mode, intent:'clarify', title:'请补充或核对现场信息', summary:'本地规则仅整理草稿，确认前不会提交。', proposal:null, questions:[], warnings:[], evidence:[]};
    function ask(question) { result.questions.push(question); }
    function stop() { result.questions = unique(result.questions); return result; }
    if (!text) { ask('请先输入现场情况，或使用浏览器语音识别。'); return stop(); }
    if (text.length > 2000) { ask('请将单条现场说明缩短至 2000 字以内。'); return stop(); }
    if (!Array.isArray(scenario.nodes) || !Array.isArray(scenario.edges)) { ask('演练数据尚未就绪，请等待两端连接后再整理。'); return stop(); }
    result.evidence.push('依据：本次输入原文及当前演练数据；未调用大模型。');
    // These expressions do not establish that the described event happened.
    if (/(?:可能|也许|似乎|好像|大概|大约|预计|计划|准备|将|即将|打算|稍后|一会儿|待会|等会|尚未|还未|没|并未|并不|不再|并非|不是|不要|无需|无须|未能|未曾|不确定|不清楚|是否|能否|假如|如果|假设|应该|明天|以后|过会|约[0-9一二两三四五六七八九十])/.test(normalized) || /(?:未|不|待)(?:联系|上车|接到|到达|送达|收到|完成|确认|受阻|堵塞|封闭|积水|发生|存在|需要|新增)/.test(normalized) || /[?？]/.test(text)) {
      ask('这段描述含否定、疑问、不确定或将来计划，请明确已经发生的单项结果后再确认。');
      return stop();
    }
    const progress = [];
    if (/(?:已)?收到(?:了)?(?:任务|调度|指令)|(?:任务|调度|指令)(?:已)?收到|确认接单|已接单/.test(normalized)) progress.push('ack');
    if (/已(?:经)?联[系络](?:上|到)?|联系(?:上|到|好了|完成)/.test(normalized)) progress.push('contact');
    if (/已(?:经)?(?:上车|接到|接上)|上车(?:了|完成)/.test(normalized)) progress.push('board');
    if (/已(?:经)?(?:到达|送达|抵达)|(?:到达|送达|抵达)了/.test(normalized)) progress.push('arrive');
    const report = [];
    if (/道路受阻|路段受阻|受阻|封路|封闭|中断|无法通行|不能通行|无法通过|不通|堵塞|道路积水|路面淹水/.test(normalized)) report.push('road');
    if (/新增|增加.{0,8}人|新发现.{0,8}人|人员增加|待转移.{0,8}人|需(?:要)?转移.{0,8}人/.test(normalized)) report.push('people');
    if (/医疗|急救|受伤|医生|救护/.test(normalized)) report.push('medical');
    if (/险情|滑坡|塌方|倒塌|水位上涨|洪水|被困|积水|内涝/.test(normalized) && !report.includes('road')) report.push('hazard');
    if (progress.length + report.length !== 1) {
      ask(progress.length + report.length > 1 ? '这段话包含多个结果，请分条确认，例如先登记接人，再单独上报道路情况。' : '请明确一个已发生的结果：收到任务、已联系、已上车、已到达，或道路受阻、新增人员、医疗协助、险情。');
      return stop();
    }
    const reporter = typeof context.reporter === 'string' && context.reporter.trim() ? context.reporter.trim() : '现场演示员';
    if (reporter.length > 40) { ask('上报人名称请控制在 40 字以内。'); return stop(); }
    const mentions = locationsIn(normalized, scenario);
    if (unsupportedPlace(normalized, scenario)) {
      ask('描述中包含尚未登记的地名，请核实位置并明确选择演练点位；系统不会把真实地名自动映射到合成节点。');
      return stop();
    }

    if (progress.length) {
      const stage = progress[0], plan = data.activePlan;
      const vehicle = (scenario.vehicles || []).find(v => v.id === context.vehicleId);
      if (!vehicle) ask('请先明确选择执行车辆。');
      if (!plan?.id) ask('当前没有已发布方案，请先由指挥端确认并发布任务。');
      if (result.questions.length) return stop();
      const mentionedVehicles = vehiclesIn(normalized, scenario.vehicles || []);
      if (mentionedVehicles.some(id => id !== vehicle.id)) ask('描述中的车辆与当前选择不一致，请核对执行车辆。');
      const mentionedPlans = normalized.match(/P\d+-(?:ALT|A|B)(?![A-Z0-9])/g) || [];
      if (mentionedPlans.some(id => id !== compact(plan.id)) || (context.planId && context.planId !== plan.id)) ask('描述或页面选择的方案不是当前已发布方案，请刷新并确认任务版本。');
      const route = (plan.routes || []).find(r => r.vehicleId === vehicle.id), fleet = data.fleet?.[vehicle.id];
      if (!route || !route.people || route.holding || !fleet || fleet.finished) ask('所选车辆当前没有可以推进的已发布任务。');
      if (result.questions.length) return stop();
      const acknowledged = data.taskAcks?.[vehicle.id]?.planId === plan.id;
      if (stage !== 'ack' && !acknowledged) ask('请先为这辆车确认收到当前方案的任务。');
      if (stage === 'ack' && acknowledged) ask('这辆车已经确认收到当前任务，无需重复登记。');
      const payload = {planId:plan.id, vehicleId:vehicle.id, stage, text, reporter, source:'voice'};
      let detail = vehicle.name || vehicle.id;
      if (stage === 'board' || stage === 'arrive') {
        const pending = (route.stops || []).filter(st => data.stage?.[st.id] === 'waiting');
        const first = pending.length ? route.stops.indexOf(pending[0]) : (route.stops || []).length;
        if ((route.segments || []).slice(first).some(segment => (segment.edges || []).some(id => !(scenario.edges || []).find(edge => edge.id === id)?.open))) ask('剩余路线包含已确认封闭道路，请先由指挥端重新规划并确认。');
      }
      if (stage === 'contact' || stage === 'board') {
        const explicit = householdsIn(normalized, scenario.households || []);
        if (explicit.length > 1) ask('一次只能确认一户，请明确本次联系或上车的家庭。');
        if (explicit.length && context.householdId && explicit[0] !== context.householdId) ask('描述的家庭与所选家庭不一致，请核对。');
        const householdId = explicit.length === 1 ? explicit[0] : context.householdId;
        if (!householdId) ask('请明确家庭编号或在页面选择家庭，系统不会猜测联系或接人的对象。');
        const assigned = (route.stops || []).find(st => st.id === householdId);
        if (householdId && !assigned) ask('该家庭不在当前车辆的接人任务中，请核对任务分配。');
        const next = (route.stops || []).find(st => data.stage?.[st.id] === 'waiting' && (stage !== 'contact' || !data.contacts?.[st.id]?.contacted));
        if (assigned && next?.id !== householdId) ask('请按当前任务顺序确认下一户，或先由指挥端调整方案。');
        if (stage === 'board') {
          if (data.phase !== 'executing') ask('指挥端尚未开始模拟执行，不能登记上车。');
          if (assigned && !data.contacts?.[householdId]?.contacted) ask('该家庭尚未确认联系，请先完成联系登记。');
        }
        if (householdId) payload.householdId = householdId;
        const household = (scenario.households || []).find(h => h.id === householdId);
        const counts = countsIn(normalized);
        if (household && (counts.invalid.length || counts.counts.some(count => count !== household.people))) ask('描述人数与任务登记人数不一致，请先核对人员情况。');
        detail += household ? ' · ' + household.name : '';
      }
      if (stage === 'arrive') {
        if (data.phase !== 'executing') ask('指挥端尚未开始模拟执行，不能登记到达。');
        if ((route.stops || []).some(st => data.stage?.[st.id] === 'waiting')) ask('本车仍有未接人员，不能登记全车到达。');
        if (!fleet.onboard?.length) ask('本车没有已登记上车人员，不能确认送达。');
        const destination = (scenario.shelters || []).find(s => s.id === route.shelterId);
        if (!destination?.available) ask('任务安置点当前不可用，请先由指挥端协调。');
        const onboardPeople = (fleet.onboard || []).reduce((total,id) => total + ((scenario.households || []).find(h => h.id === id)?.people || 0), 0);
        if (destination && onboardPeople + (data.occupancy?.[destination.id] || 0) > destination.capacity) ask('任务安置点剩余容量不足，请先由指挥端协调。');
        const shelters = unique([...namedIds(normalized, scenario.shelters || [], s => [s.id,s.name]), ...mentions.nodeIds.filter(id => (scenario.shelters || []).some(s => s.id === id))]);
        if (shelters.some(id => id !== route.shelterId) || (context.location && context.location !== route.shelterId)) ask('描述或所选位置与任务安置点不一致，请核对实际到达地点。');
        if (mentions.nodeIds.some(id => id !== route.shelterId) || mentions.edgeIds.length) ask('描述的到达位置不是本车任务安置点，请核对。');
        if (!shelters.includes(route.shelterId) && context.location !== route.shelterId) ask('请明确已到达的安置点名称，或在页面选择任务安置点。');
        detail += destination ? ' · ' + destination.name : '';
      }
      if (result.questions.length) return stop();
      const labels = {ack:'收到任务',contact:'已联系家庭',board:'人员已上车',arrive:'已到达安置点'};
      result.intent = 'progress'; result.title = '待确认：' + labels[stage];
      result.summary = detail + '；绑定方案 ' + plan.id + '，确认后才登记进展。';
      result.proposal = {action:'field-progress',payload};
      result.warnings.push(stage === 'arrive' ? '到达登记不等于安全核验，仍由指挥端人工核验。' : '请核对现场事实；文字整理不会代替人工确认。');
      result.evidence.push('当前方案：' + plan.id + '；车辆：' + vehicle.id);
      return result;
    }

    const kind = report[0], nodeIds = mentions.nodeIds, edgeIds = mentions.edgeIds;
    let candidates = kind === 'road' ? edgeIds : kind === 'people' ? nodeIds : unique([...nodeIds,...edgeIds]);
    // Endpoint names identify the road when a full from/to pair is supplied.
    if (kind !== 'road' && edgeIds.length) candidates = unique([...candidates, ...edgeIds]);
    let location = candidates.length === 1 ? candidates[0] : '';
    if (candidates.length > 1) ask('描述涉及多个位置，请分条反馈，或只保留本次事件的具体位置。');
    if (context.location && candidates.length && !candidates.includes(context.location)) ask('描述位置与页面所选位置不一致，请核对后重新整理。');
    if (!location && !candidates.length && context.location) location = context.location;
    const isNode = (scenario.nodes || []).some(n => n.id === location), isEdge = (scenario.edges || []).some(e => e.id === location);
    if (!location || (!isNode && !isEdge)) ask('请明确选择演练地图内的事件位置。');
    else if (kind === 'road' && !isEdge) ask('道路反馈需要明确到一条道路，可说明演练东桥、北桥或完整起止点。');
    else if (kind === 'people' && !isNode) ask('新增人员需要明确接人点位，不能只选择一条道路。');
    const payload = {kind, location, text, reporter, source:'voice', wheelchair:/轮椅/.test(normalized), assistance:/轮椅|行动不便|需要协助|需协助|陪同|医疗|急救|受伤|救护/.test(normalized)};
    if (kind === 'people') {
      const counts = countsIn(normalized);
      if (counts.invalid.length || counts.counts.length !== 1) ask(counts.counts.length > 1 ? '描述中的人数不一致，请明确本次新增总人数。' : '请明确本次新增总人数，例如“新增三人”。');
      else if (!Number.isInteger(counts.counts[0]) || counts.counts[0] < 1 || counts.counts[0] > 30) ask('本演练单条新增人数须为 1–30 的整数，请核对人数。');
      else payload.people = counts.counts[0];
    }
    if (result.questions.length) return stop();
    const node = (scenario.nodes || []).find(n => n.id === location), edge = (scenario.edges || []).find(e => e.id === location);
    const label = node?.label || (location === 'east' ? '演练东桥' : location === 'north' ? '演练北桥' : edge ? ((scenario.nodes || []).find(n => n.id === edge.from)?.label || edge.from) + '—' + ((scenario.nodes || []).find(n => n.id === edge.to)?.label || edge.to) : location);
    const labels = {road:'道路受阻',people:'新增转移人员',medical:'医疗协助',hazard:'险情变化'};
    result.intent = 'report'; result.title = '待确认：' + labels[kind];
    result.summary = label + (kind === 'people' ? ' · 新增 ' + payload.people + ' 人' : '') + '；确认后发送至指挥端核实。';
    result.proposal = {action:'report',payload};
    result.warnings.push('现场报告需指挥端核实；本草稿不会自动封路、调整任务或判定医疗诊断。');
    result.evidence.push('位置匹配：' + label + '（' + location + '，合成演练地图）');
    return result;
  }
  return {mode, prepare};
});
