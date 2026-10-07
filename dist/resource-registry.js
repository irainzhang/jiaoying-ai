(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JiaoyingResourceRegistry = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  const VERSION = 1;
  const ROLES = ['driver', 'escort', 'reserve'];
  const VEHICLE_TYPES = ['van', 'minibus', 'bus', 'accessible', 'other'];
  const TYPE_LABELS = { van: '厢式车', minibus: '中小客车', bus: '大客车', accessible: '无障碍车辆', other: '其他车辆' };
  const ROLE_LABELS = { driver: '司机', escort: '随车协助', reserve: '机动待命' };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const copy = value => JSON.parse(JSON.stringify(value));
  const isEnabled = scenario => scenario?.resourceRegistryVersion === VERSION;
  const validId = (value, max) => typeof value === 'string' && value.length <= max && /^[A-Za-z0-9][A-Za-z0-9_.:-]*$/.test(value) && !['__proto__', 'prototype', 'constructor'].includes(value);
  function text(value, max, label, optional = false) {
    assert(typeof value === 'string', label + '请填写文字');
    const clean = value.trim();
    assert((optional || clean.length > 0) && clean.length <= max, label + '请填写' + (optional ? '不超过 ' : '1–') + max + ' 字');
    return clean;
  }
  function integer(value, min, max, label) {
    assert(Number.isSafeInteger(value) && value >= min && value <= max, label + '须为 ' + min + '–' + max + ' 的整数');
    return value;
  }
  function normalizeStaff(rows) {
    assert(Array.isArray(rows) && rows.length <= 150, '工作人员登记最多 150 人');
    const seen = new Set();
    return rows.map((row, i) => {
      const label = '工作人员第 ' + (i + 1) + ' 行';
      assert(row && typeof row === 'object' && !Array.isArray(row), label + '无效');
      const id = text(row.id, 40, label + '编号');
      assert(validId(id, 40), label + '编号仅限字母、数字及 _ . : -，不能使用保留名称');
      assert(!seen.has(id), '工作人员编号 ' + id + ' 重复'); seen.add(id);
      assert(ROLES.includes(row.role), id + ' 请选择司机、随车协助或机动待命角色');
      assert(typeof row.available === 'boolean', id + ' 请明确是否到岗');
      // Only operational identifiers are retained; names and contact details are not part of this registry.
      return { id, role: row.role, available: row.available };
    });
  }
  function normalize(input, options = {}) {
    assert(input && typeof input === 'object', '资源登记数据无效');
    assert(input.resourceRegistryVersion === undefined || input.resourceRegistryVersion === VERSION, '资源登记版本不支持');
    const staff = normalizeStaff(input.staff), staffById = new Map(staff.map(s => [s.id, s]));
    const nodes = options.nodes ? new Set(options.nodes.map(n => typeof n === 'string' ? n : n.id)) : null;
    assert(Array.isArray(input.vehicles) && input.vehicles.length <= 30, '车辆登记最多 30 辆');
    const seenVehicles = new Set(), assigned = new Map();
    const vehicles = input.vehicles.map((row, index) => {
      assert(row && typeof row === 'object' && !Array.isArray(row), '车辆登记无效');
      const id = text(row.id, 60, '车辆编号', !!options.allowBlankVehicleIds);
      assert((options.allowBlankVehicleIds && !id) || validId(id, 60), '车辆编号无效');
      assert(!id || !seenVehicles.has(id), '车辆编号 ' + id + ' 重复'); if (id) seenVehicles.add(id);
      const label = row.name || id || '第 ' + (index + 1) + ' 辆车';
      const vehicleType = row.vehicleType;
      assert(VEHICLE_TYPES.includes(vehicleType), label + ' 请选择车辆类别');
      const totalCapacity = integer(row.totalCapacity, 1, 502, label + '当前布局总载人数');
      const driverId = text(row.driverId ?? '', 40, label + '司机编号', true);
      assert(Array.isArray(row.escortIds) && row.escortIds.length <= 10, label + '随车协助人员最多 10 人');
      const escortIds = row.escortIds.map(id => text(id, 40, label + '随车协助编号'));
      for (const [personId, role] of [...(driverId ? [[driverId, 'driver']] : []), ...escortIds.map(id => [id, 'escort'])]) {
        const member = staffById.get(personId);
        assert(member, label + ' 的工作人员 ' + personId + ' 尚未登记');
        assert(member.role === role, personId + ' 的登记角色不符合' + ROLE_LABELS[role] + '岗位');
        assert(!assigned.has(personId), personId + ' 已分配给 ' + assigned.get(personId) + '，不能重复编组');
        assigned.set(personId, label);
      }
      const capacity = totalCapacity - Number(Boolean(driverId)) - escortIds.length;
      assert(capacity >= 0, label + ' 总载人数不足以容纳已分配的工作人员');
      assert(capacity <= 500, label + ' 可接人数最多 500 人，请核对当前总载人数与工作人员配置');
      const wheelchairSlots = integer(row.wheelchairSlots, 0, 30, label + '核定轮椅位');
      assert(wheelchairSlots <= capacity, label + ' 轮椅位不能超过扣除工作人员后的可接人数');
      assert(typeof row.available === 'boolean', label + ' 请明确车辆是否可用');
      assert(typeof row.start === 'string' && row.start && (!nodes || nodes.has(row.start)), label + '请选择当前地图中的位置');
      const old = (options.oldVehicles || []).find(v => v.id === id);
      const vehicle = { id, name: text(row.name, 80, '车辆名称'), start: row.start, available: row.available,
        model: text(row.model, 80, label + '型号'), vehicleType, totalCapacity, capacity, wheelchairSlots,
        wheelchair: wheelchairSlots > 0, driverId, escortIds, notes: text(row.notes ?? '', 200, label + '备注', true) };
      const color = row.color || old?.color;
      if (color !== undefined) { assert(/^#[0-9a-f]{6}$/i.test(color), label + '颜色无效'); vehicle.color = color; }
      return vehicle;
    });
    return { resourceRegistryVersion: VERSION, staff, vehicles };
  }
  function validateScenario(scenario) {
    assert(scenario && typeof scenario === 'object', '场景数据无效');
    if (scenario.resourceRegistryVersion === undefined) {
      assert(scenario.staff === undefined && !(scenario.vehicles || []).some(v => ['model', 'vehicleType', 'totalCapacity', 'wheelchairSlots', 'driverId', 'escortIds'].some(key => v[key] !== undefined)), '资源登记字段缺少版本，请完整保存资源库后再使用');
      return true;
    }
    assert(isEnabled(scenario), '资源登记版本不支持');
    const clean = normalize(scenario, { nodes: scenario.nodes });
    for (let i = 0; i < clean.vehicles.length; i++) {
      const vehicle = scenario.vehicles[i], normalized = clean.vehicles[i];
      assert(vehicle.capacity === normalized.capacity, vehicle.id + ' 可接人数与总载人数及工作人员配置不一致');
      assert(vehicle.wheelchair === normalized.wheelchair, vehicle.id + ' 轮椅适配与核定轮椅位不一致');
      assert(vehicle.id === normalized.id && vehicle.driverId === normalized.driverId && JSON.stringify(vehicle.escortIds) === JSON.stringify(normalized.escortIds), '车辆或工作人员编号含未规范空格');
    }
    for (let i = 0; i < clean.staff.length; i++) assert(scenario.staff[i].id === clean.staff[i].id, '工作人员编号含未规范空格');
    return true;
  }
  function wheelchairCapacity(scenario, vehicle) {
    return isEnabled(scenario) ? vehicle.wheelchairSlots : Number(vehicle.wheelchair);
  }
  function crew(scenario, vehicle) {
    if (!isEnabled(scenario)) return { registered: false, driverId: '', escortIds: [], staffCount: 0, driver: null, escorts: [], available: null, issues: ['旧版资源未登记工作人员'] };
    const staff = new Map((scenario.staff || []).map(member => [member.id, member]));
    const driverId = vehicle.driverId || '', escortIds = [...(vehicle.escortIds || [])];
    const driver = driverId ? staff.get(driverId) || null : null;
    const escorts = escortIds.map(id => staff.get(id) || { id, role: 'unknown', available: false });
    const issues = [];
    if (!driverId) issues.push('未分配司机，暂不能派车');
    else if (!driver) issues.push('司机 ' + driverId + ' 未登记');
    else if (driver.role !== 'driver') issues.push(driverId + ' 不是已登记司机');
    else if (!driver.available) issues.push('司机 ' + driverId + ' 未到岗');
    for (const member of escorts) {
      if (member.role !== 'escort') issues.push('随车人员 ' + member.id + ' 未登记为随车协助员');
      else if (!member.available) issues.push('随车协助员 ' + member.id + ' 未到岗');
    }
    return { registered: true, driverId, escortIds, staffCount: Number(Boolean(driverId)) + escortIds.length,
      driver: driver ? { ...driver } : null, escorts: escorts.map(member => ({ ...member })), available: !issues.length, issues };
  }
  function routeIssues(scenario, vehicle, households = []) {
    if (!isEnabled(scenario)) return [];
    const status = crew(scenario, vehicle), issues = [...status.issues];
    if (!vehicle.available) issues.push('车辆当前停用');
    const people = households.reduce((n, h) => n + h.people, 0);
    const chairs = households.reduce((n, h) => n + (h.wheelchairPeople ?? Number(h.wheelchair)), 0);
    const assistance = households.reduce((n, h) => n + (h.assistancePeople ?? (h.assistance ? h.people : 0)), 0);
    if (people > vehicle.capacity) issues.push('扣除司机及随车工作人员后，可接人数不足');
    if (chairs > wheelchairCapacity(scenario, vehicle)) issues.push('核定轮椅位不足');
    if (assistance > 0 && !status.escorts.some(member => member.role === 'escort' && member.available)) issues.push('本批有需协助人员，尚未分配到岗随车协助员（演练规则）');
    return issues;
  }
  function suggestAssignments(vehicles, staff) {
    const result = copy(vehicles), roster = normalizeStaff(staff), byId = new Map(roster.map(member => [member.id, member]));
    const used = new Set(), issues = [], changes = [];
    result.forEach(vehicle => {
      for (const [id, role] of [...(vehicle.driverId ? [[vehicle.driverId, 'driver']] : []), ...(vehicle.escortIds || []).map(id => [id, 'escort'])]) {
        const member = byId.get(id);
        if (used.has(id)) issues.push(id + ' 已重复编组，请先人工调整');
        used.add(id);
        if (!member || member.role !== role) issues.push(vehicle.name + ' 的 ' + id + ' 登记角色不符或未登记，保留原编辑值待核对');
        else if (!member.available) issues.push(vehicle.name + ' 的 ' + id + ' 未到岗，保留编组与占位');
      }
    });
    result.forEach(vehicle => {
      if (vehicle.available === false) return;
      vehicle.driverId = vehicle.driverId || '';
      vehicle.escortIds = [...(vehicle.escortIds || [])];
      for (const role of ['driver', 'escort']) {
        if (role === 'driver' ? vehicle.driverId : vehicle.escortIds.length) continue;
        const member = roster.find(s => s.role === role && s.available && !used.has(s.id));
        const staffCount = Number(Boolean(vehicle.driverId)) + vehicle.escortIds.length;
        if (!Number.isSafeInteger(vehicle.totalCapacity) || vehicle.totalCapacity <= staffCount) { issues.push(vehicle.name + ' 总载人数未填或不足，未追加' + ROLE_LABELS[role]); continue; }
        if (!member) { issues.push(vehicle.name + ' 缺少可分配的到岗' + ROLE_LABELS[role]); continue; }
        if (role === 'driver') vehicle.driverId = member.id; else vehicle.escortIds.push(member.id);
        used.add(member.id); changes.push({ vehicleId: vehicle.id, staffId: member.id, role });
      }
      if (Number.isSafeInteger(vehicle.totalCapacity)) vehicle.capacity = vehicle.totalCapacity - Number(Boolean(vehicle.driverId)) - vehicle.escortIds.length;
      if (Number.isSafeInteger(vehicle.wheelchairSlots)) vehicle.wheelchair = vehicle.wheelchairSlots > 0;
      if (vehicle.wheelchairSlots > vehicle.capacity) issues.push(vehicle.name + ' 编组后轮椅位超过可接人数，请核实当前布局');
    });
    return { vehicles: result, issues, changes };
  }
  function demoStaffAndAssignments(vehicles) {
    assert(Array.isArray(vehicles) && vehicles.length <= 30, '演练资源最多 30 辆车');
    const staff = [], proposed = vehicles.map((vehicle, index) => {
      const suffix = String(index + 1).padStart(2, '0'), driverId = 'D' + suffix, escortId = 'E' + suffix;
      staff.push({ id: driverId, role: 'driver', available: true }, { id: escortId, role: 'escort', available: true });
      const capacity = integer(vehicle.capacity, 0, 500, vehicle.name + '原可接人数');
      return { ...vehicle, model: '演练车型（待替换）', vehicleType: 'other', totalCapacity: capacity + 2,
        wheelchairSlots: Math.min(capacity, vehicle.wheelchairSlots ?? Number(vehicle.wheelchair)),
        driverId, escortIds: [escortId], notes: '演练设定：按原可接人数另加 1 名司机和 1 名随车协助员；实际使用前需核实当前布局。' };
    });
    staff.push({ id: 'R01', role: 'reserve', available: true });
    return normalize({ staff, vehicles: proposed });
  }
  function resourceChangePolicy(data) {
    const active = !!data.activePlan || !!data.history?.length || data.phase === 'executing';
    const lockedVehicleIds = [], startLockedVehicleIds = [], lockedStaffIds = new Set();
    for (const vehicle of data.scenario.vehicles) {
      const fleet = data.fleet?.[vehicle.id] || {};
      const running = (fleet.onboard || []).length > 0 || (!fleet.finished && (!!fleet.startedPlanId || (data.phase === 'executing' && data.executionMode !== 'per-vehicle' && data.activePlan?.routes.some(r => r.vehicleId === vehicle.id && r.people))));
      if (running) { lockedVehicleIds.push(vehicle.id); for (const id of [vehicle.driverId, ...(vehicle.escortIds || [])].filter(Boolean)) lockedStaffIds.add(id); }
      if (running || fleet.minute || (fleet.delivered || []).length || fleet.finished) startLockedVehicleIds.push(vehicle.id);
    }
    return { active, lockedVehicleIds, startLockedVehicleIds, lockedStaffIds: [...lockedStaffIds] };
  }
  function resourceDiff(before, after) {
    const rows = [];
    for (const kind of ['staff', 'vehicles', 'shelters']) {
      const old = new Map((before[kind] || []).map(x => [x.id, x]));
      for (const item of after[kind] || []) {
        const prior = old.get(item.id), changes = [];
        for (const key of Object.keys(item)) if (!['color', 'synthetic', 'capacity', 'wheelchair', 'nodeId'].includes(key) || kind === 'shelters' && key === 'capacity') {
          if (!prior || JSON.stringify(prior[key]) !== JSON.stringify(item[key])) changes.push({ field: key, before: prior?.[key] ?? null, after: item[key] });
        }
        if (changes.length) rows.push({ kind, id: item.id, operation: prior ? 'update' : 'add', changes });
      }
      for (const item of before[kind] || []) if (!(after[kind] || []).some(x => x.id === item.id)) rows.push({ kind, id: item.id, operation: 'remove', changes: [] });
    }
    return rows;
  }
  // The same policy runs in the Node core and the browser bundle. UI controls
  // merely explain these constraints; they are never the enforcement boundary.
  function validateResourceChange(data, next) {
    const policy = resourceChangePolicy(data); if (!policy.active) return policy;
    const prior = data.scenario;
    for (const kind of ['vehicles', 'shelters', 'staff']) for (const item of prior[kind] || []) assert((next[kind] || []).some(x => x.id === item.id), '发布后不能移除资源 ' + item.id + '；请登记停用，历史与在途记录必须保留');
    for (const vehicle of next.vehicles) {
      const old = prior.vehicles.find(x => x.id === vehicle.id); if (!old) { assert(vehicle.available, '增援车辆必须核实可用后加入'); continue; }
      if (policy.lockedVehicleIds.includes(vehicle.id)) for (const key of ['name', 'model', 'vehicleType', 'totalCapacity', 'wheelchairSlots', 'driverId', 'escortIds']) assert(JSON.stringify(old[key]) === JSON.stringify(vehicle[key]), vehicle.id + ' 已出发或仍有车上人员，不能修改车型、运力或编组；可登记停用并协调');
      if (policy.startLockedVehicleIds.includes(vehicle.id)) assert(old.start === vehicle.start, vehicle.id + ' 已有行驶记录，不能改写出发位置');
    }
    for (const member of next.staff || []) {
      const old = (prior.staff || []).find(x => x.id === member.id);
      if (!old) assert(member.available, '增援工作人员 ' + member.id + ' 必须核实到岗后加入');
      if (old && policy.lockedStaffIds.includes(member.id)) assert(old.role === member.role, member.id + ' 正随已出发车辆执行，不能更换角色');
    }
    for (const shelter of next.shelters) assert(shelter.capacity >= (data.occupancy[shelter.id] || 0), shelter.id + ' 容量不能小于本场已接收人数');
    return policy;
  }
  return { VERSION, ROLES, VEHICLE_TYPES, TYPE_LABELS, ROLE_LABELS, isEnabled, normalize, validateScenario, resourceChangePolicy, resourceDiff, validateResourceChange,
    wheelchairCapacity, routeIssues, crew, suggestAssignments, demoStaffAndAssignments };
});
