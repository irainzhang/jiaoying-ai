(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JiaoyingResourceIntake = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  // This module describes editable drafts, not an AI result or a saved resource.
  // All location/person choices come from the current registry, never a guessed match.
  const LIMITS = Object.freeze({ staff: 150, vehicle: 30, shelter: 30 });
  const LABELS = { staff: '工作人员', vehicle: '车辆', shelter: '安置接收点' };
  const ROLES = [{ value: 'driver', label: '司机' }, { value: 'escort', label: '随车协助' }, { value: 'reserve', label: '机动待命' }];
  const TYPES = [{ value: 'van', label: '厢式车' }, { value: 'minibus', label: '中小客车' }, { value: 'bus', label: '大客车' }, { value: 'accessible', label: '无障碍车辆' }, { value: 'other', label: '其他车辆' }];
  const ALIASES = {
    staff: { id: ['工作人员编号', '人员编号', '编号', '工号'], role: ['岗位', '角色', '人员角色', '工作人员角色'], available: ['是否到岗', '到岗状态', '到岗', '可用', '状态'] },
    vehicle: { id: ['车辆编号', '编号'], name: ['车辆名称', '名称', '车名'], model: ['车辆型号', '型号', '车型'], vehicleType: ['车辆类别', '车辆类型', '类别', '类型'], totalCapacity: ['当前布局总载人数', '当前总载人数', '总载人数', '总核载人数', '总核载', '核定总人数'], wheelchairSlots: ['核定轮椅位', '轮椅位', '轮椅位数'], start: ['出发位置', '出发地点', '位置节点', '当前位置', '地图位置', '位置'], driverId: ['司机编号', '司机'], escortIds: ['随车协助编号', '随车人员编号', '随车编号', '随车协助', '随车人员', '随车'], available: ['是否可用', '可用状态', '可用', '状态'], notes: ['备注', '说明'] },
    shelter: { name: ['安置点名称', '接收点名称', '名称'], capacity: ['可接收人数', '接收人数', '容量', '接收容量'], nodeId: ['位置节点', '地图位置', '地点', '位置'], available: ['是否可用', '可用状态', '可用', '状态'] }
  };
  const ROLE_VALUES = { '司机': 'driver', '驾驶员': 'driver', '随车协助': 'escort', '随车协助员': 'escort', '随车人员': 'escort', '协助人员': 'escort', '机动': 'reserve', '机动人员': 'reserve', '机动待命': 'reserve', '待命人员': 'reserve' };
  const TYPE_VALUES = { '厢式车': 'van', '厢式车辆': 'van', '中小客车': 'minibus', '中巴': 'minibus', '中巴车': 'minibus', '小客车': 'minibus', '大客车': 'bus', '大巴': 'bus', '大巴车': 'bus', '无障碍车辆': 'accessible', '无障碍车': 'accessible', '其他车辆': 'other', '其他': 'other' };
  const fail = message => { throw new Error(message); };
  const checkKind = kind => { if (!Object.hasOwn(LIMITS, kind)) fail('请选择工作人员、车辆或安置接收点'); };
  const str = value => value === null || value === undefined ? '' : String(value).trim();
  const compact = value => str(value).replace(/[\s\uFEFF]/g, '').toLowerCase();
  const blank = value => value === undefined || value === null || str(value) === '';
  const list = value => Array.isArray(value) ? value.map(str).filter(Boolean) : str(value).split(/[、,，;；|\s和与及]+/).filter(Boolean);
  function candidates(context) {
    return (context.nodes || []).map(n => typeof n === 'string' ? { value: n, label: n } : { value: n.id, label: (n.label || n.name || n.id) + ' · ' + n.id });
  }
  function schema(kind, context = {}) {
    checkKind(kind);
    const text = (key, label, required, maxLength) => ({ key, label, type: 'text', required, maxLength });
    const number = (key, label, min, max) => ({ key, label, type: 'number', required: true, min, max });
    const select = (key, label, options, required = true) => ({ key, label, type: 'select', required, options });
    const enabled = { key: 'available', label: kind === 'staff' ? '是否到岗' : '是否可用', type: 'boolean', required: true };
    let fields, example;
    if (kind === 'staff') {
      fields = [text('id', '工作人员编号', true, 40), select('role', '岗位', ROLES.map(x => ({ ...x }))), enabled];
      example = '工作人员 D01，岗位司机，已到岗；工作人员 E01，岗位随车协助，已到岗';
    } else if (kind === 'vehicle') {
      fields = [text('id', '车辆编号', false, 60), text('name', '车辆名称', true, 80), text('model', '车辆型号', true, 80), select('vehicleType', '车辆类别', TYPES.map(x => ({ ...x }))), number('totalCapacity', '总核载人数', 1, 502), number('wheelchairSlots', '核定轮椅位', 0, 30), select('start', '出发位置', candidates(context)), select('driverId', '司机编号', (context.staff || []).filter(s => s.role === 'driver').map(s => ({ value: s.id, label: s.id + (s.available === false ? ' · 未到岗' : '') })), false), { key: 'escortIds', label: '随车协助编号', type: 'list', required: false, max: 10, options: (context.staff || []).filter(s => s.role === 'escort').map(s => ({ value: s.id, label: s.id + (s.available === false ? ' · 未到岗' : '') })) }, enabled, text('notes', '备注', false, 200)];
      example = '新增车辆增援一号，型号演练中巴，类别中小客车，总核载十九人，轮椅位两位，出发位置请说当前地图地点，司机D01，随车E01，状态可用';
    } else {
      fields = [text('name', '安置点名称', true, 80), number('capacity', '可接收人数', 0, 10000), select('nodeId', '地图位置', candidates(context)), enabled];
      example = '新增安置点临时接收点，可接收人数八十人，位置请说当前地图地点，状态可用';
    }
    return { id: kind, label: LABELS[kind], example, fields, template: { headers: fields.map(f => f.label), rows: [] } };
  }
  function columnKey(kind, header) {
    const clean = compact(header).replace(/[（(](?:必填|选填|可选)[）)]$/g, '');
    for (const [key, names] of Object.entries(ALIASES[kind])) if ([key, ...names].some(x => compact(x) === clean)) return key;
    return null;
  }
  function integer(value) {
    if (typeof value === 'number') return Number.isSafeInteger(value) ? value : null;
    let text = str(value).replace(/\s/g, '').replace(/(?:人|位|座|个)$/, '');
    if (/^\d+$/.test(text)) { const n = Number(text); return Number.isSafeInteger(n) ? n : null; }
    if (!/^[零〇一二两三四五六七八九十百千万]+$/.test(text)) return null;
    if (text === '一万') return 10000;
    if (text.includes('万')) return null;
    const digits = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 }, units = { 十: 10, 百: 100, 千: 1000 };
    // Reject malformed/fuzzy quantities such as 三五人、一百二、十十 instead of guessing.
    if (!/[十百千]/.test(text)) return text.length === 1 ? digits[text] : null;
    let sum = 0, digit = null, lastUnit = 10000, hadZero = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (Object.hasOwn(digits, c)) {
        if (digits[c] === 0) { if (!sum || digit !== null || hadZero || i === text.length - 1) return null; hadZero = true; continue; }
        if (digit !== null) return null;
        digit = digits[c];
      } else {
        const unit = units[c];
        if (unit >= lastUnit || hadZero || (digit === null && !(i === 0 && unit === 10))) return null;
        sum += (digit === null ? 1 : digit) * unit; digit = null; lastUnit = unit;
      }
    }
    if (digit !== null && lastUnit >= 100 && !hadZero) return null;
    return sum + (digit || 0);
  }
  function boolean(value) {
    if (value === true || value === false) return value;
    const text = compact(value);
    if (['1', 'true', '是', '可用', '已到岗', '到岗', '在岗', '启用'].includes(text)) return true;
    if (['0', 'false', '否', '不可用', '停用', '未到岗', '未到', '不在岗', '缺勤', '未启用'].includes(text)) return false;
    return null;
  }
  function choice(field, value, context) {
    if (blank(value)) return '';
    const input = str(value);
    if (field.key === 'role' && Object.hasOwn(ROLE_VALUES, input)) return ROLE_VALUES[input];
    if (field.key === 'vehicleType' && Object.hasOwn(TYPE_VALUES, input)) return TYPE_VALUES[input];
    const exact = (field.options || []).filter(x => x.value === input || x.label === input);
    if (exact.length === 1) return exact[0].value;
    if (['nodeId', 'start'].includes(field.key)) {
      const nodes = (context.nodes || []).filter(n => typeof n !== 'string' && (n.label === input || n.name === input));
      if (nodes.length === 1) return nodes[0].id;
    }
    return '';
  }
  function rawRow(kind, input, context, index, warnings) {
    const row = {}, fields = schema(kind, context).fields;
    for (const field of fields) {
      const value = input[field.key], label = '第 ' + (index + 1) + ' 行「' + field.label + '」';
      if (field.type === 'number') {
        const n = integer(value); row[field.key] = n === null ? '' : n;
        if (!blank(value) && n === null) warnings.push(label + '未能识别为明确整数，已留空待核对。');
        else if (n !== null && (n < field.min || n > field.max)) warnings.push(label + '超出允许范围，请修改后确认。');
      } else if (field.type === 'boolean') {
        row[field.key] = boolean(value);
        if (!blank(value) && row[field.key] === null) warnings.push(label + '不明确，请选择是或否。');
      } else if (field.type === 'select') {
        row[field.key] = choice(field, value, context);
        if (!blank(value) && !row[field.key]) {
          // An unregistered driver cannot be discarded as if no driver was requested:
          // doing so would also stop accounting for that person's occupied seat.
          if (field.key === 'driverId') { row[field.key] = str(value); warnings.push(label + '“' + str(value) + '”尚未登记为司机，保留原编号待修正；无法直接确认。'); }
          else warnings.push(label + '“' + str(value) + '”未唯一匹配当前候选，已留空，请下拉搜索选择。');
        }
      } else if (field.type === 'list') {
        const values = list(value), valid = new Set((field.options || []).map(x => x.value));
        row[field.key] = values;
        const unknown = values.filter(x => !valid.has(x));
        if (unknown.length) warnings.push(label + '“' + unknown.join('、') + '”不是已登记的随车协助编号，已保留待修正；请先登记人员后选择，或核对后移除，无法直接确认。');
      } else row[field.key] = str(value);
      if (field.required && (row[field.key] === '' || row[field.key] === null)) warnings.push(label + '尚未填写；不会默认补齐，请在预览中核对。');
    }
    return row;
  }
  function parseRows(kind, rows, context = {}) {
    checkKind(kind);
    if (!Array.isArray(rows) || !rows.length) fail('文件中没有可读取的资源行');
    if (rows.length > 5001) fail('资源表行数过多，请拆分后导入');
    const warnings = [], records = [], arrayMode = Array.isArray(rows[0]);
    const allRows = arrayMode ? rows.slice(1) : rows;
    const headers = arrayMode ? rows[0] : Object.keys(rows[0] || {});
    if (headers.length > 256) fail('资源表列数过多，请使用当前模板');
    const seenHeaders = new Set(), seenKeys = new Set();
    const keys = headers.map(header => {
      const clean = compact(header), key = columnKey(kind, header);
      if (clean && seenHeaders.has(clean)) fail('重复表头「' + str(header) + '」，请保留一列后再导入');
      if (clean) seenHeaders.add(clean);
      if (key && seenKeys.has(key)) fail('多个表头同时对应「' + schema(kind, context).fields.find(f => f.key === key).label + '」，无法决定采用哪列');
      if (key) seenKeys.add(key);
      else if (clean) warnings.push(kind === 'vehicle' && clean === '容量' ? '车辆旧表「容量」不等于总核载，未自动换算；请补填当前布局总核载人数。' : '未识别列「' + str(header) + '」，该列不会写入资源库。');
      return key;
    });
    if (!keys.some(Boolean)) fail('没有识别到资源表头，请下载对应分类的 Excel 模板');
    for (const source of allRows) {
      if ((arrayMode && !Array.isArray(source)) || (!arrayMode && (!source || typeof source !== 'object' || Array.isArray(source)))) fail('资源表行结构不一致，请重新导出 Excel');
      if (!arrayMode && (Object.keys(source).length !== headers.length || !headers.every(h => Object.hasOwn(source, h)))) fail('对象行表头不一致，请使用相同列名');
      if (arrayMode && source.length > headers.length && source.slice(headers.length).some(x => !blank(x))) fail('存在没有表头的数据列，请补齐表头再导入');
      const values = arrayMode ? source : headers.map(h => source[h]);
      if (values.every(blank)) continue;
      if (values.some(x => typeof x === 'object' && x !== null && !Array.isArray(x))) fail('资源表包含不能读取的单元格，请使用普通文字和数字');
      const record = {};
      keys.forEach((key, i) => { if (key) record[key] = values[i]; });
      records.push(record);
    }
    if (!records.length) fail('文件中只有表头，没有资源数据');
    if (records.length > LIMITS[kind]) fail(LABELS[kind] + '每批最多 ' + LIMITS[kind] + ' 条，未截断或写入');
    return { rows: records.map((record, i) => rawRow(kind, record, context, i, warnings)), warnings };
  }
  function parseSpeech(kind, text, context = {}) {
    checkKind(kind);
    if (typeof text !== 'string' || !text.trim()) fail('请先说出要登记的资源信息');
    if (text.length > 20000) fail('一次语音内容过长，请拆分录入');
    const warnings = [], source = text.trim().split(/[；;\n]+|[。](?=\s*(?:(?:请)?(?:帮我)?(?:新增|添加|登记|录入)\s*)?(?:工作人员|人员|车辆|安置点|接收点))/).filter(x => x.trim()), records = [];
    const labels = Object.entries(ALIASES[kind]).flatMap(([key, aliases]) => aliases.map(label => ({ key, label }))).sort((a, b) => b.label.length - a.label.length);
    const typePrefix = kind === 'staff' ? /^(?:工作人员|人员)/ : kind === 'vehicle' ? /^车辆/ : /^(?:安置点|接收点)/;
    for (const sentence of source) {
      const record = {}, fragments = sentence.split(/[，,。]+/).map(str).filter(Boolean), uncertain = new Set(), unresolved = [];
      let matched = 0, lastKey = '';
      const put = (key, value) => { if (Object.hasOwn(record, key)) fail('同一条语音重复说明了「' + schema(kind, context).fields.find(f => f.key === key).label + '」，请核对后重新整理'); record[key] = value; lastKey = key; matched++; };
      for (let i = 0; i < fragments.length; i++) {
        const fragment = fragments[i].replace(/^(?:请)?(?:帮我)?(?:新增|添加|登记|录入)\s*/, '').trim();
        const alias = labels.find(x => fragment.startsWith(x.label) && fragment.length > x.label.length);
        if (alias) { put(alias.key, fragment.slice(alias.label.length).replace(/^\s*[:：是为]?\s*/, '')); continue; }
        if (boolean(fragment) !== null) { put('available', fragment); continue; }
        if (kind === 'staff' && Object.hasOwn(ROLE_VALUES, fragment)) { put('role', fragment); continue; }
        if (i === 0 && typePrefix.test(fragment)) { const value = fragment.replace(typePrefix, '').trim(); if (value) { put(kind === 'staff' ? 'id' : 'name', value); continue; } }
        const extraIds = fragment.replace(/^(?:还有|以及|和|及)\s*/, '');
        if (lastKey === 'escortIds' && /^[A-Za-z0-9_.:\-\s和与及、]+$/.test(extraIds) && list(extraIds).every(x => /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(x))) { record.escortIds = list(record.escortIds).concat(list(extraIds)); continue; }
        const concerned = [];
        if (/到岗|在岗|缺勤|出勤|迟到|可用|停用|故障|维修|能用/.test(fragment)) concerned.push('available');
        if (/位置|地点|出发|停靠|集合点/.test(fragment)) concerned.push(kind === 'vehicle' ? 'start' : kind === 'shelter' ? 'nodeId' : '');
        if (kind === 'vehicle') {
          if (/轮椅/.test(fragment)) concerned.push('wheelchairSlots');
          if (/核载|总载|载客|载人|布局|容量|乘员|座位/.test(fragment)) concerned.push('totalCapacity');
          if (/型号|车型/.test(fragment)) concerned.push('model');
          if (/类别|类型/.test(fragment)) concerned.push('vehicleType');
          if (/司机|驾驶员/.test(fragment)) concerned.push('driverId');
          if (/随车|协助/.test(fragment)) concerned.push('escortIds');
        } else if (kind === 'staff') {
          if (/岗位|角色|司机|驾驶员|协助|机动/.test(fragment)) concerned.push('role');
          if (/编号|工号/.test(fragment)) concerned.push('id');
        } else if (/人数|接收|容量|床位/.test(fragment)) concerned.push('capacity');
        const keys = concerned.filter(Boolean);
        const corrective = /但|不过|实际|改为|更正|不是|不要|取消|未|没|不|只有|只能|仅|大概|可能|待核|重新|改掉|说错|还有|另有|另外|再加|增加|明天|稍后|预计|才/.test(fragment) || /[零〇一二两三四五六七八九十百千万\d]+\s*(?:人|位|座|辆)/.test(fragment);
        if (keys.length) {
          keys.forEach(key => uncertain.add(key));
          // Optional crew fields may be genuinely empty, so uncertainty there
          // needs a row-level block rather than an empty value that passes.
          if (keys.some(key => ['driverId', 'escortIds'].includes(key))) unresolved.push(fragment);
          warnings.push('第 ' + (records.length + 1) + ' 行“' + fragment + '”涉及尚未理解的资源条件，相关字段已清空，必须重新核对填写。');
        } else if (corrective) { unresolved.push(fragment); warnings.push('第 ' + (records.length + 1) + ' 行“' + fragment + '”存在无法定位的更正或不确定条件；请修改原话后重新整理，本行无法直接确认。'); }
        else warnings.push('未理解片段“' + fragment + '”，未代入字段，请在预览中补充。');
      }
      if (!matched) fail('未识别到明确的资源字段，请按示例说出编号或名称、岗位或型号及状态');
      uncertain.forEach(key => { record[key] = ''; });
      if (unresolved.length) record._unresolvedSpeech = unresolved;
      records.push(record);
    }
    if (records.length > LIMITS[kind]) fail(LABELS[kind] + '每批最多 ' + LIMITS[kind] + ' 条');
    return { rows: records.map((record, i) => ({ ...rawRow(kind, record, context, i, warnings), ...(record._unresolvedSpeech ? { _unresolvedSpeech: record._unresolvedSpeech.slice() } : {}) })), warnings };
  }
  function validateDraft(kind, rows, context = {}) {
    checkKind(kind);
    const existing = context[kind === 'staff' ? 'staff' : kind === 'vehicle' ? 'vehicles' : 'shelters'] || [];
    if (!Array.isArray(rows) || !rows.length) fail('尚无可确认的' + LABELS[kind]);
    if (rows.length + existing.length > LIMITS[kind]) fail(LABELS[kind] + '登记合计最多 ' + LIMITS[kind] + ' 条');
    const fields = schema(kind, context).fields, ids = new Set(existing.map(x => kind === 'shelter' ? x.nodeId || x.id : x.id).filter(Boolean));
    const assigned = new Map();
    if (kind === 'vehicle') for (const vehicle of existing) {
      for (const id of [vehicle.driverId, ...(Array.isArray(vehicle.escortIds) ? vehicle.escortIds : [])].filter(Boolean)) {
        if (!assigned.has(id)) assigned.set(id, vehicle.name || vehicle.id || '现有车辆');
      }
    }
    return rows.map((source, index) => {
      if (!source || typeof source !== 'object' || Array.isArray(source)) fail('资源草稿格式无效');
      const row = {}, prefix = LABELS[kind] + '第 ' + (index + 1) + ' 行';
      const problem = (field, message) => { const error = new Error(prefix + '「' + field.label + '」' + message); error.rowIndex = index; error.field = field.key; throw error; };
      if (source._unresolvedSpeech?.length) problem({ label: '原话', key: '_unresolvedSpeech' }, '包含未解决的更正或不确定条件，请修改原话后重新整理：' + source._unresolvedSpeech.join('；'));
      for (const field of fields) {
        const value = source[field.key];
        if (field.required && blank(value)) problem(field, '尚未填写，请补充后确认');
        if (field.type === 'number') {
          const n = integer(value); if (n === null || n < field.min || n > field.max) problem(field, '须为 ' + field.min + '–' + field.max + ' 的明确整数'); row[field.key] = n;
        } else if (field.type === 'boolean') {
          if (typeof value !== 'boolean') problem(field, '请选择是或否'); row[field.key] = value;
        } else if (field.type === 'select') {
          const v = str(value); if (v && !(field.options || []).some(x => x.value === v)) problem(field, '不属于当前候选，请重新选择'); row[field.key] = v;
        } else if (field.type === 'list') {
          const values = list(value), allowed = new Set((field.options || []).map(x => x.value));
          if (values.length > field.max || values.some(x => !allowed.has(x))) problem(field, '请选择已登记的随车协助编号（最多 ' + field.max + ' 人）');
          if (new Set(values).size !== values.length) problem(field, '存在重复编号'); row[field.key] = values;
        } else {
          const v = str(value); if (v.length > field.maxLength) problem(field, '超过 ' + field.maxLength + ' 字');
          if (field.key === 'id' && v && (!/^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(v) || ['__proto__', 'prototype', 'constructor'].includes(v))) problem(field, '仅限字母、数字及 _ . : -，不能使用保留名称'); row[field.key] = v;
        }
      }
      const id = kind === 'shelter' ? row.nodeId : row.id;
      if (id && ids.has(id)) problem(fields.find(f => f.key === (kind === 'shelter' ? 'nodeId' : 'id')), '与现有资源或本批其他行重复');
      if (id) ids.add(id);
      if (kind === 'vehicle') {
        for (const [personId, key] of [...(row.driverId ? [[row.driverId, 'driverId']] : []), ...row.escortIds.map(personId => [personId, 'escortIds'])]) {
          if (assigned.has(personId)) problem(fields.find(f => f.key === key), '编号 ' + personId + ' 已分配给「' + assigned.get(personId) + '」，不能重复编组，请选择其他人员');
          assigned.set(personId, row.name || row.id || prefix);
        }
        const capacity = row.totalCapacity - Number(Boolean(row.driverId)) - row.escortIds.length;
        if (capacity < 0 || capacity > 500) problem(fields.find(f => f.key === 'totalCapacity'), '扣除工作人员后可接人数须为 0–500 人');
        if (row.wheelchairSlots > capacity) problem(fields.find(f => f.key === 'wheelchairSlots'), '超过扣除工作人员后的可接人数');
      }
      return row;
    });
  }
  return { schema, parseRows, parseSpeech, validateDraft, LIMITS };
});
