'use strict';
const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path');
const R = require('../dist/resource-registry.js');
const clone = v => JSON.parse(JSON.stringify(v));
const staff = () => [
  { id: 'D01', role: 'driver', available: true }, { id: 'D02', role: 'driver', available: true },
  { id: 'E01', role: 'escort', available: true }, { id: 'E02', role: 'escort', available: true },
  { id: 'R01', role: 'reserve', available: true }
];
const vehicle = (extra = {}) => ({ id: 'V1', name: '接送一号', model: '演练 8 人布局', vehicleType: 'minibus',
  totalCapacity: 8, start: 'D', available: true, color: '#446dff', wheelchairSlots: 2,
  driverId: 'D01', escortIds: ['E01'], notes: '', ...extra });
const source = () => ({ staff: staff(), vehicles: [vehicle()] });
const scenario = () => ({ nodes: [{ id: 'D' }], ...R.normalize(source(), { nodes: [{ id: 'D' }] }) });
const home = (extra = {}) => ({ people: 3, wheelchair: false, assistance: false, ...extra });

test('registry derives usable passenger places from explicit total and all assigned crew, with independent wheelchair slots', () => {
  const input = source(), snapshot = clone(input), clean = R.normalize(input, { nodes: ['D'] });
  assert.equal(clean.resourceRegistryVersion, 1); assert.equal(clean.vehicles[0].capacity, 6);
  assert.equal(clean.vehicles[0].wheelchair, true); assert.equal(R.wheelchairCapacity(clean, clean.vehicles[0]), 2);
  assert.deepEqual(input, snapshot); assert.notEqual(clean.vehicles[0].escortIds, input.vehicles[0].escortIds);
});

test('current layout and explicit slots govern fit, vehicle category does not invent accessibility', () => {
  const input = source(); input.vehicles[0] = vehicle({ vehicleType: 'accessible', wheelchairSlots: 0 });
  const s = R.normalize(input); assert.equal(s.vehicles[0].wheelchair, false);
  assert.match(R.routeIssues(s, s.vehicles[0], [home({ wheelchairPeople: 1 })]).join('；'), /轮椅位不足/);
});

test('registry rejects duplicate staff and unknown or incorrect crew roles, including reserve substitutions', () => {
  for (const edit of [
    x => x.staff.push({ ...x.staff[0] }),
    x => { x.vehicles[0].driverId = 'UNKNOWN'; },
    x => { x.vehicles[0].driverId = 'E01'; },
    x => { x.vehicles[0].driverId = 'R01'; },
    x => { x.vehicles[0].escortIds = ['D02']; },
    x => { x.vehicles[0].escortIds = ['R01']; },
    x => { x.vehicles[0].escortIds = ['E01', 'E01']; }
  ]) { const input = source(); edit(input); assert.throws(() => R.normalize(input)); }
});

test('a person cannot be assigned to two vehicles, even when one vehicle is out of service', () => {
  const input = source(); input.vehicles.push(vehicle({ id: 'V2', driverId: 'D02', available: false }));
  assert.throws(() => R.normalize(input), /重复编组/);
  input.vehicles[1].escortIds = ['E02']; input.vehicles[1].driverId = 'D01';
  assert.throws(() => R.normalize(input), /重复编组/);
});

test('staff records retain only pseudonymous operational identifiers', () => {
  const input = source(); Object.assign(input.staff[0], { name: '不得保存', telephone: 'private' });
  const clean = R.normalize(input); assert.deepEqual(clean.staff[0], { id: 'D01', role: 'driver', available: true });
  for (const id of ['张三', '', '__proto__', 'constructor', 'A'.repeat(41)]) {
    const invalid = source(); invalid.staff[0].id = id; assert.throws(() => R.normalize(invalid));
  }
});

test('registry rejects invalid layout counts instead of silently assuming sizes from vehicle model', () => {
  for (const override of [{ totalCapacity: '' }, { totalCapacity: 0 }, { totalCapacity: 503 }, { totalCapacity: 8.5 },
    { totalCapacity: 1 }, { wheelchairSlots: 7 }, { wheelchairSlots: -1 }, { wheelchairSlots: 1.5 }, { wheelchairSlots: 31 }]) {
    const input = source(); Object.assign(input.vehicles[0], override); assert.throws(() => R.normalize(input));
  }
  assert.equal(R.normalize({ staff: staff(), vehicles: [vehicle({ totalCapacity: 2, wheelchairSlots: 0 })] }).vehicles[0].capacity, 0);
  assert.equal(R.normalize({ staff: staff(), vehicles: [vehicle({ totalCapacity: 502 })] }).vehicles[0].capacity, 500);
  assert.throws(() => R.normalize({ staff: staff(), vehicles: [vehicle({ totalCapacity: 502, driverId: '', escortIds: [] })] }), /最多 500/);
});

test('normalization checks lengths, required booleans, roles and existing map nodes', () => {
  for (const edit of [x => { x.vehicles[0].start = 'not-on-map'; }, x => { x.vehicles[0].model = 'x'.repeat(81); },
    x => { x.vehicles[0].notes = 'x'.repeat(201); }, x => { x.vehicles[0].vehicleType = 'truck'; },
    x => { x.vehicles[0].available = 'true'; }, x => { x.staff[0].available = 'false'; },
    x => { x.staff[0].role = 'all'; }]) {
    const input = source(); edit(input); assert.throws(() => R.normalize(input, { nodes: [{ id: 'D' }] }));
  }
  assert.throws(() => R.normalize({ staff: staff(), vehicles: Array.from({ length: 31 }, (_, i) => vehicle({ id: 'V' + i })) }), /30/);
  assert.throws(() => R.normalize({ staff: Array.from({ length: 151 }, (_, i) => ({ id: 'S' + i, role: 'reserve', available: true })), vehicles: [] }), /150/);
});

test('the UI can validate blank new vehicle ids without allowing blank ids in stored scenarios', () => {
  const input = source(); input.vehicles[0].id = '';
  assert.throws(() => R.normalize(input), /编号/);
  const normalized = R.normalize(input, { allowBlankVehicleIds: true });
  assert.equal(normalized.vehicles[0].id, ''); assert.throws(() => R.validateScenario(normalized), /编号/);
});

test('missing drivers may be saved, but are an explicit dispatch blockage', () => {
  const s = R.normalize({ staff: staff(), vehicles: [vehicle({ driverId: '' })] });
  assert.equal(s.vehicles[0].capacity, 7); assert.equal(R.validateScenario(s), true);
  assert.match(R.routeIssues(s, s.vehicles[0], [home()]).join('；'), /未分配司机/);
});

test('absence preserves all occupied crew places, can be restored, and blocks even an ordinary trip', () => {
  const s = scenario(); s.staff.find(s => s.id === 'E01').available = false;
  assert.equal(R.validateScenario(s), true); assert.equal(s.vehicles[0].capacity, 6);
  assert.match(R.routeIssues(s, s.vehicles[0], [home()]).join('；'), /E01 未到岗/);
  s.staff.find(s => s.id === 'E01').available = true; assert.deepEqual(R.routeIssues(s, s.vehicles[0], [home()]), []);
  s.staff.find(s => s.id === 'D01').available = false; assert.match(R.routeIssues(s, s.vehicles[0], []).join('；'), /司机 D01 未到岗/);
});

test('assistance requires an on-duty escort under a labeled demonstration rule', () => {
  const s = R.normalize({ staff: staff(), vehicles: [vehicle({ escortIds: [] })] });
  const v = s.vehicles[0]; assert.deepEqual(R.routeIssues(s, v, [home()]), []);
  assert.match(R.routeIssues(s, v, [home({ assistancePeople: 1 })]).join('；'), /演练规则/);
  assert.match(R.routeIssues(s, v, [home({ assistance: true })]).join('；'), /随车协助员/);
});

test('wheelchair and assistance counts use explicit group quantities with legacy household fallback', () => {
  const s = scenario(), v = s.vehicles[0];
  assert.deepEqual(R.routeIssues(s, v, [home({ wheelchairPeople: 2, assistancePeople: 2 })]), []);
  assert.match(R.routeIssues(s, v, [home({ wheelchairPeople: 3, assistancePeople: 3 })]).join('；'), /轮椅位/);
  assert.deepEqual(R.routeIssues(s, v, [home({ wheelchair: true, assistance: true })]), []);
  assert.match(R.routeIssues(s, v, [home({ people: 7 })]).join('；'), /可接人数不足/);
});

test('restored registry snapshots reject tampering with derived passenger and wheelchair values without mutation', () => {
  const s = scenario(), before = clone(s); assert.equal(R.validateScenario(s), true); assert.deepEqual(s, before);
  const changed = clone(s); changed.vehicles[0].capacity++; assert.throws(() => R.validateScenario(changed), /不一致/);
  const changed2 = clone(s); changed2.vehicles[0].wheelchair = false; assert.throws(() => R.validateScenario(changed2), /不一致/);
  const changed3 = clone(s); changed3.vehicles[0].driverId = ' D01 '; assert.throws(() => R.validateScenario(changed3), /空格/);
});

test('legacy scenarios preserve old capacity and one-wheelchair behavior without manufactured personnel', () => {
  const s = { vehicles: [{ id: 'V1', capacity: 6, wheelchair: true, available: true }] }, before = clone(s);
  assert.equal(R.isEnabled(s), false); assert.equal(R.validateScenario(s), true);
  assert.equal(R.wheelchairCapacity(s, s.vehicles[0]), 1); assert.deepEqual(R.routeIssues(s, s.vehicles[0], [home()]), []);
  assert.equal(R.crew(s, s.vehicles[0]).registered, false); assert.deepEqual(s, before);
  assert.throws(() => R.validateScenario({ ...s, staff: [] }), /缺少版本/);
  assert.throws(() => R.validateScenario({ ...s, resourceRegistryVersion: 2 }), /版本/);
});

test('crew DTOs do not share mutable personnel references with the source registry', () => {
  const s = scenario(), result = R.crew(s, s.vehicles[0]);
  assert.equal(result.staffCount, 2); assert.equal(result.driverId, 'D01'); assert.deepEqual(result.escortIds, ['E01']);
  result.driver.available = false; result.escorts[0].available = false; result.escortIds.push('E02');
  assert.equal(s.staff[0].available, true); assert.equal(s.staff[2].available, true); assert.equal(s.vehicles[0].escortIds.length, 1);
});

test('suggested crews are deterministic editor drafts and use only the matching on-duty roles', () => {
  const vehicles = [vehicle({ driverId: '', escortIds: [] }), vehicle({ id: 'V2', driverId: '', escortIds: [] })];
  const roster = staff(), original = clone({ vehicles, roster });
  const result = R.suggestAssignments(vehicles, roster);
  assert.deepEqual(result.vehicles.map(v => [v.driverId, v.escortIds]), [['D01', ['E01']], ['D02', ['E02']]]);
  assert.equal(result.changes.length, 4); assert.deepEqual(result.issues, []);
  assert.deepEqual(R.suggestAssignments(vehicles, roster), result); assert.deepEqual({ vehicles, roster }, original);
});

test('crew suggestions preserve absent assignments, flag shortages and never promote reserve staff', () => {
  const vehicles = [vehicle(), vehicle({ id: 'V2', driverId: '', escortIds: [] })];
  const roster = staff().filter(p => !['D02', 'E02'].includes(p.id)); roster[0].available = false;
  const result = R.suggestAssignments(vehicles, roster);
  assert.equal(result.vehicles[0].driverId, 'D01'); assert.equal(result.vehicles[0].capacity, 6);
  assert.equal(result.vehicles[1].driverId, ''); assert.deepEqual(result.vehicles[1].escortIds, []);
  assert.match(result.issues.join('；'), /未到岗/); assert.match(result.issues.join('；'), /缺少/);
  assert.ok(!result.changes.some(c => c.staffId === 'R01'));
});

test('crew suggestions retain conflicts for explicit correction and do not assign staff to disabled vehicles', () => {
  const v1 = vehicle(), v2 = vehicle({ id: 'V2' }), v3 = vehicle({ id: 'V3', available: false, driverId: '', escortIds: [] });
  const result = R.suggestAssignments([v1, v2, v3], staff());
  assert.match(result.issues.join('；'), /重复编组/); assert.equal(result.vehicles[1].driverId, 'D01');
  assert.equal(result.vehicles[2].driverId, ''); assert.deepEqual(result.vehicles[2].escortIds, []);
});

test('explicit demo preparation preserves original passenger capacity and position ids without mutating old state', () => {
  const vehicles = [{ id: 'V1', name: '一号车', start: 'D', capacity: 6, wheelchair: true, available: true, color: '#446dff' }];
  const before = clone(vehicles), result = R.demoStaffAndAssignments(vehicles);
  assert.deepEqual(vehicles, before); assert.equal(result.vehicles[0].start, 'D'); assert.equal(result.vehicles[0].id, 'V1');
  assert.equal(result.vehicles[0].capacity, 6); assert.equal(result.vehicles[0].totalCapacity, 8);
  assert.match(result.vehicles[0].notes, /演练设定/); assert.match(result.vehicles[0].model, /待替换/);
  assert.ok(result.staff.some(p => p.role === 'reserve')); assert.equal(R.validateScenario(result), true);
});

test('classic-script browser export is available without module loaders or network dependencies', () => {
  const context = vm.createContext({}); vm.runInContext(fs.readFileSync(path.join(__dirname, '../dist/resource-registry.js'), 'utf8'), context);
  assert.equal(context.JiaoyingResourceRegistry.VERSION, 1);
  assert.equal(typeof context.JiaoyingResourceRegistry.normalize, 'function');
});
