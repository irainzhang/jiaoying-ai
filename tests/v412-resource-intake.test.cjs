'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const I = require('../dist/resource-intake.js');
const context = () => ({
  nodes: [{ id: 'N1', label: '玉海街道集合点' }, { id: 'N2', label: '锦湖街道接收点' }],
  staff: [{ id: 'D01', role: 'driver', available: true }, { id: 'D02', role: 'driver', available: false }, { id: 'E01', role: 'escort', available: true }, { id: 'R01', role: 'reserve', available: true }],
  vehicles: [{ id: 'V01', name: '现有车辆' }], shelters: [{ id: 'S1', nodeId: 'N2' }]
});
const vehicle = overrides => ({ id: 'V02', name: '增援车', model: '演练中巴', vehicleType: 'minibus', totalCapacity: 19, wheelchairSlots: 2, start: 'N1', driverId: 'D01', escortIds: ['E01'], available: true, notes: '', ...overrides });

test('schema uses current map candidates and staff roles, never an invented location', () => {
  const c = context(), s = I.schema('vehicle', c);
  assert.deepEqual(s.fields.find(f => f.key === 'start').options, [{ value: 'N1', label: '玉海街道集合点 · N1' }, { value: 'N2', label: '锦湖街道接收点 · N2' }]);
  assert.deepEqual(s.fields.find(f => f.key === 'driverId').options.map(x => x.value), ['D01', 'D02']);
  assert.deepEqual(s.fields.find(f => f.key === 'escortIds').options.map(x => x.value), ['E01']);
  assert.deepEqual(I.schema('vehicle').fields.find(f => f.key === 'start').options, []);
  assert.deepEqual(s.template.rows, []);
  s.fields.find(f => f.key === 'vehicleType').options[0].label = '污染';
  assert.equal(I.schema('vehicle').fields.find(f => f.key === 'vehicleType').options[0].label, '厢式车');
});
test('required and optional labels are centralized and template headers remain importable',()=>{
  for(const kind of ['staff','vehicle','shelter']){
    const s=I.schema(kind,context());
    s.fields.forEach((field,index)=>{assert.ok(field.hint);assert.equal(s.template.headers[index],field.label+(field.required?' *':'（选填）'));});
    assert.doesNotThrow(()=>I.parseRows(kind,[s.template.headers,s.fields.map(f=>f.key==='intent'?'新增':f.key==='id'?'NEW1':'')],context()));
  }
  const s=I.schema('vehicle',context());
  assert.equal(s.fields.find(f=>f.key==='driverId').required,false);assert.equal(s.fields.find(f=>f.key==='wheelchairSlots').required,true);
  const row=I.parseRows('vehicle',[vehicle({id:'',driverId:'',escortIds:[],wheelchairSlots:0})],context()).rows;
  assert.equal(I.validateDraft('vehicle',row,context())[0].id,'');
  assert.throws(()=>I.validateDraft('vehicle',[vehicle({wheelchairSlots:''})],context()),/轮椅位.*尚未填写/);
});
test('star and required suffix decorations accept old and new headers but never bypass alias duplicate checks',()=>{
  for(const wrap of [x=>'* '+x,x=>x+' *',x=>'＊'+x+'＊',x=>'★'+x+'★',x=>x+'（必填）',x=>'★'+x+'（选填）＊',x=>x+'[可选]',x=>x+'必填']){
    const parsed=I.parseRows('staff',[['工作人员编号','岗位','是否到岗'].map(wrap),['D03','司机','是']],context());
    assert.deepEqual(parsed.rows,[{id:'D03',role:'driver',available:true}]);
  }
  assert.throws(()=>I.parseRows('staff',[['* 工作人员编号','人员编号（选填）'],['D03','D04']],context()),/多个表头/);
  assert.throws(()=>I.parseRows('vehicle',[['＊总核载人数','totalCapacity★'],[8,9]],context()),/多个表头/);
});
test('clear headers detect resource type without using row values or file names',()=>{
  assert.equal(I.detectKind([['工作人员编号 *','岗位 *'],['D01','司机']]),'staff');
  assert.equal(I.detectKind([['型号（必填）','总核载人数★'],['小客车',9]]),'vehicle');
  assert.equal(I.detectKind([['安置点名称 *','可接收人数'],['演练点',20]]),'shelter');
  assert.equal(I.detectKind([['名称','状态'],['安置点名称','是']]),null);
  assert.equal(I.detectKind([['名称','容量'],['旧车',8]]),null);
  assert.throws(()=>I.detectKind([['工作人员编号','车辆型号']]),/混合.*一种资源/);
  assert.throws(()=>I.parseRows('staff',[['车辆型号','总核载人数'],['小客车',9]],context()),/属于车辆.*当前选择的是工作人员/);
});
test('shelter updates resolve exact current map names before finding the existing resource',()=>{
  const c=context();c.shelters=[{id:'N2',nodeId:'N2',name:'演练接收点',capacity:15,available:true}];
  const headers=['操作','安置点名称','可接收人数','地图位置','是否可用'];
  for(const location of ['N2','锦湖街道接收点','锦湖街道接收点 · N2']){
    const parsed=I.parseRows('shelter',[headers,['修改','',20,location,'']],c);
    assert.equal(parsed.rows[0].targetId,'N2');assert.equal(parsed.rows[0].nodeId,'N2');
    const result=I.applyDraft('shelter',parsed.rows,c);assert.equal(result.length,1);assert.equal(result[0].capacity,20);assert.equal(result[0].name,'演练接收点');
  }
  assert.throws(()=>I.parseRows('shelter',[headers,['修改','',20,'锦湖','']],c),/未唯一匹配/);
  c.nodes.push({id:'N3',label:'锦湖街道接收点'});
  assert.throws(()=>I.parseRows('shelter',[headers,['修改','',20,'锦湖街道接收点','']],c),/未唯一匹配/);
  assert.equal(I.parseRows('shelter',[headers,['修改','',20,'N2','']],c).rows[0].targetId,'N2');
});
test('Chinese workbook headers and explicit states normalize without importing personal names', () => {
  const result = I.parseRows('staff', [['人员编号', '岗位', '是否到岗', '姓名'], ['D03', '司机', '是', '不得写入姓名'], ['E02', '随车协助', '未到岗', '也不写入']], context());
  assert.deepEqual(result.rows, [{ id: 'D03', role: 'driver', available: true }, { id: 'E02', role: 'escort', available: false }]);
  assert.match(result.warnings.join(''), /姓名.*不会写入/);
  assert.equal(JSON.stringify(result.rows).includes('不得'), false);
});
test('English object rows preserve explicit zero wheelchair slots and unavailable state', () => {
  const result = I.parseRows('vehicle', [vehicle({ wheelchairSlots: 0, available: false })], context());
  assert.deepEqual(I.validateDraft('vehicle', result.rows, context()), [vehicle({ wheelchairSlots: 0, available: false })]);
});
test('partial records retain editable rows and never default safety values', () => {
  const result = I.parseRows('vehicle', [['车辆名称'], ['未核实车辆']], context());
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].totalCapacity, ''); assert.equal(result.rows[0].wheelchairSlots, ''); assert.equal(result.rows[0].available, null);
  assert.equal(result.rows[0].vehicleType, ''); assert.equal(result.rows[0].start, '');
  assert.throws(() => I.validateDraft('vehicle', result.rows, context()), /型号.*尚未填写/);
});
test('old capacity is not promoted to total occupancy including workers', () => {
  const result = I.parseRows('vehicle', [['名称', '容量'], ['旧车', '8']], context());
  assert.equal(result.rows[0].totalCapacity, '');
  assert.match(result.warnings.join(''), /容量.*不等于总核载/);
});
test('duplicate and conflicting canonical headers reject before choosing a value', () => {
  assert.throws(() => I.parseRows('staff', [['编号', ' 编号 '], ['D03', 'D04']]), /重复表头/);
  assert.throws(() => I.parseRows('vehicle', [['总核载', 'totalCapacity'], [8, 12]]), /多个表头/);
});
test('unreadable workbook structures and extra unheaded cells are rejected as a whole', () => {
  assert.throws(() => I.parseRows('staff', []), /没有可读取/);
  assert.throws(() => I.parseRows('staff', [['随便'], ['内容']]), /没有识别到/);
  assert.throws(() => I.parseRows('staff', [['编号'], ['D03', 3]]), /没有表头/);
  assert.throws(() => I.parseRows('staff', [['编号'], ['D03'], {}]), /结构不一致/);
  assert.throws(() => I.parseRows('staff', [{ id: 'D03' }, { 编号: 'D04' }]), /表头不一致/);
  assert.throws(() => I.parseRows('staff', [['编号'], [{ unsupported: true }]]), /不能读取/);
  assert.throws(() => I.parseRows('staff', [['编号'], ['']]), /只有表头/);
});
test('only a unique exact location match is resolved; fuzzy and duplicate names remain empty', () => {
  const c = context();
  let result = I.parseRows('shelter', [['名称', '位置', '容量', '状态'], ['新点', '玉海街道集合点', '80', '可用']], c);
  assert.equal(result.rows[0].nodeId, 'N1');
  result = I.parseRows('shelter', [['名称', '位置'], ['新点', '玉海街道']], c);
  assert.equal(result.rows[0].nodeId, ''); assert.match(result.warnings.join(''), /未唯一匹配/);
  c.nodes.push({ id: 'N3', label: '玉海街道集合点' });
  result = I.parseRows('shelter', [['名称', '位置'], ['新点', '玉海街道集合点']], c);
  assert.equal(result.rows[0].nodeId, '');
});
test('unknown role, combined role and ambiguous state are retained as missing fields', () => {
  const { rows } = I.parseRows('staff', [['编号', '岗位', '状态'], ['X01', '司机兼协助', '可能到岗']], context());
  assert.deepEqual(rows, [{ id: 'X01', role: '', available: null }]);
  assert.throws(() => I.validateDraft('staff', rows, context()), /岗位/);
});
test('staff speech supports multiple entries and leaves unsupported fragments for review', () => {
  const result = I.parseSpeech('staff', '工作人员D03，岗位司机，已到岗；工作人员E02，岗位随车协助，未到岗，谢谢', context());
  assert.deepEqual(result.rows, [{ id: 'D03', role: 'driver', available: true }, { id: 'E02', role: 'escort', available: false }]);
  assert.match(result.warnings.join(''), /谢谢/);
});
test('vehicle speech parses explicit quantities and current candidate identifiers', () => {
  const result = I.parseSpeech('vehicle', '新增车辆增援一号，型号演练中巴，类别中小客车，总核载十九人，轮椅位两位，出发位置玉海街道集合点，司机D01，随车E01，状态可用', context());
  assert.deepEqual(result.rows[0], vehicle({ id: '', name: '增援一号' }));
  assert.deepEqual(I.validateDraft('vehicle', result.rows, context()), result.rows);
});
test('shelter speech produces a concrete local node only when named explicitly', () => {
  const result = I.parseSpeech('shelter', '新增安置点临时接收点，可接收人数一百零二人，位置N1，状态可用', context());
  assert.deepEqual(result.rows, [{ name: '临时接收点', capacity: 102, nodeId: 'N1', available: true }]);
  assert.deepEqual(I.validateDraft('shelter', result.rows, context()), result.rows);
});
test('spoken omissions remain null or blank and duplicate fields never silently win', () => {
  const result = I.parseSpeech('staff', '工作人员D03', context());
  assert.deepEqual(result.rows, [{ id: 'D03', role: '', available: null }]);
  assert.throws(() => I.parseSpeech('staff', '工作人员D03，岗位司机，角色随车协助', context()), /重复说明/);
  assert.throws(() => I.parseSpeech('staff', '请处理一下'), /未识别到明确/);
  assert.throws(() => I.parseSpeech('staff', ''), /先说出/);
});
test('ambiguous numerical speech is never interpreted as a safe capacity', () => {
  for (const value of ['三五人', '一百二', '十十', '约20人', '-1', '3.5', '1e2', '一百零']) {
    const result = I.parseRows('shelter', [['名称', '容量'], ['待核对', value]], context());
    assert.equal(result.rows[0].capacity, '', value);
    assert.match(result.warnings.join(''), /明确整数/, value);
  }
});
test('known Chinese integers support zero, tens, hundreds and safe explicit maximum', () => {
  for (const [value, number] of [['零', 0], ['十', 10], ['十二', 12], ['二十', 20], ['一百二十三', 123], ['两百', 200], ['一千', 1000], ['一万', 10000]]) {
    assert.equal(I.parseRows('shelter', [['名称', '容量'], ['点', value]]).rows[0].capacity, number, value);
  }
});
test('draft validation points to the bad field and does not require complete legacy resources', () => {
  let error; try { I.validateDraft('vehicle', [vehicle({ model: '' })], context()); } catch (e) { error = e; }
  assert.equal(error.rowIndex, 0); assert.equal(error.field, 'model');
  assert.deepEqual(I.validateDraft('staff', [{ id: 'D03', role: 'driver', available: true }], context()), [{ id: 'D03', role: 'driver', available: true }]);
});
test('duplicate staff or vehicle IDs and duplicate shelter nodes cannot append', () => {
  assert.throws(() => I.validateDraft('staff', [{ id: 'D01', role: 'driver', available: true }], context()), /重复/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle({ id: 'V01' })], context()), /重复/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle(), vehicle()], context()), /重复/);
  assert.throws(() => I.validateDraft('shelter', [{ name: '同址新名称', nodeId: 'N2', capacity: 1, available: true }], context()), /重复/);
});
test('unsafe IDs, invalid roles and non-boolean states cannot be confirmed', () => {
  for (const id of ['张三', '__proto__', 'constructor', 'D 03']) assert.throws(() => I.validateDraft('staff', [{ id, role: 'driver', available: true }]), /仅限/);
  assert.throws(() => I.validateDraft('staff', [{ id: 'X01', role: 'unknown', available: true }]), /候选/);
  assert.throws(() => I.validateDraft('staff', [{ id: 'X01', role: 'driver', available: 'true' }]), /是或否/);
});
test('vehicle role choices and wheelchair occupancy are checked before append', () => {
  assert.throws(() => I.validateDraft('vehicle', [vehicle({ driverId: 'R01' })], context()), /司机编号/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle({ escortIds: ['D01'] })], context()), /随车协助编号/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle({ escortIds: ['E01', 'E01'] })], context()), /重复编号/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle({ totalCapacity: 3, wheelchairSlots: 2 })], context()), /超过扣除/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle({ totalCapacity: 1, wheelchairSlots: 0 })], context()), /可接人数/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle({ start: 'wrong' })], context()), /出发位置/);
});
test('batch limits include existing resources and rejected file is not silently truncated', () => {
  const row = { id: 'D03', role: 'driver', available: true };
  assert.throws(() => I.parseRows('staff', [Array.from(Object.keys(row)), ...Array.from({ length: 151 }, (_, i) => ['X' + i, 'driver', true])]), /每批最多 150/);
  assert.throws(() => I.validateDraft('staff', [row], { staff: Array.from({ length: 150 }, (_, i) => ({ id: 'R' + i })) }), /合计最多 150/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle()], { ...context(), vehicles: Array.from({ length: 30 }, (_, i) => ({ id: 'R' + i })) }), /合计最多 30/);
});
test('all draft parsers and validation keep current context and input unchanged', () => {
  const c = context(), before = JSON.stringify(c), input = [vehicle()], raw = JSON.stringify(input);
  I.schema('vehicle', c); I.parseRows('vehicle', input, c); I.parseSpeech('staff', '工作人员D03，岗位司机，已到岗', c); I.validateDraft('vehicle', input, c);
  assert.equal(JSON.stringify(c), before); assert.equal(JSON.stringify(input), raw);
});
test('unsupported kinds cannot access inherited object members', () => {
  for (const kind of ['constructor', '__proto__', 'person', null]) {
    assert.throws(() => I.schema(kind), /请选择/);
    assert.throws(() => I.parseRows(kind, []), /请选择/);
  }
});
test('a negated or corrected arrival statement clears availability and prevents silent confirmation', () => {
  const result = I.parseSpeech('staff', '工作人员D03，岗位司机，已到岗，不过现在还没到岗', context());
  assert.equal(result.rows[0].available, null);
  assert.match(result.warnings.join(''), /相关字段已清空/);
  assert.throws(() => I.validateDraft('staff', result.rows, context()), /是否到岗/);
  const corrected = result.rows.map(row => ({ ...row, available: false }));
  assert.equal(I.validateDraft('staff', corrected, context())[0].available, false);
  const uncertain = I.parseSpeech('staff', '工作人员D03，岗位司机，未到岗，可能迟到', context());
  assert.equal(uncertain.rows[0].available, null);
});
test('a later layout correction invalidates earlier total occupancy rather than retaining nineteen seats', () => {
  const result = I.parseSpeech('vehicle', '新增车辆增援一号，型号演练中巴，类别中小客车，总核载十九人，轮椅位两位，出发位置N1，司机D01，随车E01，状态可用，实际当前布局八人', context());
  assert.equal(result.rows[0].totalCapacity, '');
  assert.throws(() => I.validateDraft('vehicle', result.rows, context()), /总核载人数/);
  result.rows[0].totalCapacity = 8;
  assert.equal(I.validateDraft('vehicle', result.rows, context())[0].totalCapacity, 8);
});
test('unlocated corrections block the original speech row until it is rephrased', () => {
  for (const correction of ['刚才那个说错了', '这台实际上只能拉八人', '另外还有两个人']) {
    const result = I.parseSpeech('staff', '工作人员D03，岗位司机，已到岗，' + correction, context());
    assert.deepEqual(result.rows[0]._unresolvedSpeech, [correction]);
    assert.throws(() => I.validateDraft('staff', result.rows, context()), /修改原话/);
  }
});
test('unknown drivers and escorts remain visible and cannot reduce staff seat accounting by being dropped', () => {
  const result = I.parseRows('vehicle', [vehicle({ driverId: 'D999', escortIds: 'E01 E999' })], context());
  assert.equal(result.rows[0].driverId, 'D999'); assert.deepEqual(result.rows[0].escortIds, ['E01', 'E999']);
  assert.throws(() => I.validateDraft('vehicle', result.rows, context()), /司机编号/);
  result.rows[0].driverId = 'D01';
  assert.throws(() => I.validateDraft('vehicle', result.rows, context()), /随车协助编号/);
});
test('spoken escort conjunctions and consecutive comma-separated identifiers preserve every worker', () => {
  const c = context(); c.staff.push({ id: 'E02', role: 'escort', available: true });
  for (const escortPhrase of ['E01和E02', 'E01 与 E02', 'E01及E02', 'E01，E02', 'E01，还有E02']) {
    const result = I.parseSpeech('vehicle', '新增车辆增援一号，随车' + escortPhrase, c);
    assert.deepEqual(result.rows[0].escortIds, ['E01', 'E02'], escortPhrase);
  }
  const unknown = I.parseSpeech('vehicle', '新增车辆增援一号，随车E01和E999', c);
  assert.deepEqual(unknown.rows[0].escortIds, ['E01', 'E999']);
});
test('a correction to optional crew data cannot become an empty-but-valid assignment', () => {
  const result = I.parseSpeech('vehicle', '新增车辆增援一号，型号演练中巴，类别中小客车，总核载十九人，轮椅位两位，出发位置N1，司机D01，随车E01，状态可用，不过司机换了', context());
  assert.equal(result.rows[0].driverId, '');
  assert.throws(() => I.validateDraft('vehicle', result.rows, context()), /修改原话/);
});
test('sentence punctuation can separate multiple complete staff registrations', () => {
  const result = I.parseSpeech('staff', '工作人员D03，司机，已到岗。工作人员E02，随车协助，未到岗', context());
  assert.deepEqual(result.rows, [{ id: 'D03', role: 'driver', available: true }, { id: 'E02', role: 'escort', available: false }]);
});
test('existing vehicle crew cannot be reused in a new vehicle draft, even when the existing vehicle is unavailable', () => {
  const c = context(); c.vehicles[0] = { id: 'V01', name: '原车辆', driverId: 'D01', escortIds: ['E01'], available: false };
  assert.throws(() => I.validateDraft('vehicle', [vehicle()], c), /司机编号.*D01.*原车辆.*不能重复编组/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle({ driverId: 'D02' })], c), /随车协助编号.*E01.*原车辆.*不能重复编组/);
  const independent = vehicle({ driverId: 'D02', escortIds: [] });
  assert.deepEqual(I.validateDraft('vehicle', [independent], c), [independent]);
});
test('batch vehicles cannot double-book a driver or escort and errors locate the second row', () => {
  let error;
  try { I.validateDraft('vehicle', [vehicle(), vehicle({ id: 'V03', name: '第二辆' })], context()); } catch (e) { error = e; }
  assert.equal(error.rowIndex, 1); assert.equal(error.field, 'driverId'); assert.match(error.message, /D01.*增援车.*不能重复编组/);
  assert.throws(() => I.validateDraft('vehicle', [vehicle(), vehicle({ id: 'V03', name: '第二辆', driverId: 'D02' })], context()), /随车协助编号.*E01.*不能重复编组/);
});
