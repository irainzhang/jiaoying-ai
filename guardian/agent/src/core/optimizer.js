/*!
 * 城市韧性守护 Agent · 应急资源优化配置
 * ---------------------------------------------------------------
 * 对应 Word 文档第四条第 4 点与创新点 2：
 *   在避难场所容量、道路距离、车辆数量和资源数量有限的条件下，
 *   通过优化算法生成更合理的人员避险与应急资源配置建议。
 *
 * 实现口径（务必与 PPT 表述一致，不得夸大）：
 *   - 约束：车辆座位、无障碍位、安置点容量与无障碍位、只走开放路段、单车单趟。
 *   - 算法：优先级贪心构造 + 有界局部搜索改进（bounded local search）。
 *   - 明确声明：规模较大时属于有界启发式，不保证全局最优。
 *     对比基线为明示规则的「风险优先最近可行」策略，不代表人工调度实测。
 *   - 纯函数：不读写 store，因此可用于情景推演与可复现评估。
 */
(function (FA) {
  'use strict';

  var OBJECTIVE_WEIGHTS = {
    risk_first: { coverage: 1.0, urgency: 2.0, wait: 0.50, drive: 0.20, gainDetour: 0.015, gainUrgency: 1.00, gainPeople: 0.010, gainWait: 0.000 },
    wait_min: { coverage: 1.2, urgency: 0.8, wait: 1.50, drive: 0.20, gainDetour: 0.020, gainUrgency: 0.25, gainPeople: 0.010, gainWait: 0.030 },
    balance: { coverage: 1.5, urgency: 1.0, wait: 0.60, drive: 0.20, gainDetour: 0.012, gainUrgency: 0.35, gainPeople: 0.020, gainWait: 0.005 }
  };

  function objectiveLabel(key) {
    var o = (FA.data.modelWeights.objectives || []).find(function (x) { return x.key === key; });
    return o ? o.label : key;
  }

  /* ------------------------------ 内部工具 ------------------------------ */
  function legTime(access, fromId, toId) {
    if (fromId === toId) return 0;
    var row = access.matrix[fromId];
    if (!row) return Infinity;
    var t = row[toId];
    return t == null ? Infinity : t;
  }

  function legRoads(access, roads, fromId, toId) {
    if (fromId === toId) return [];
    var path = FA.analytics.pathFrom(access.prev[fromId] || {}, fromId, toId);
    return FA.analytics.pathToRoads(path, roads);
  }

  /**
   * 计算一条车辆路线的时刻表。
   * 路线 = 车库/驻地 → 接人点1 → 接人点2 → … → 安置点
   */
  function scheduleRoute(world, access, vehicle, groupIds, shelterId) {
    var groups = world.groups;
    var zoneIds = [vehicle.baseZoneId];
    var ordered = [];
    for (var i = 0; i < groupIds.length; i++) {
      var g = groups.find(function (x) { return x.id === groupIds[i]; });
      if (!g) return { ok: false, reason: 'unknown-group', groupIds: groupIds };
      ordered.push(g);
      zoneIds.push(g.zoneId);
    }
    var shelter = null;
    if (shelterId) {
      shelter = world.shelters.find(function (s) { return s.id === shelterId; });
      if (!shelter) return { ok: false, reason: 'unknown-shelter', groupIds: groupIds };
      zoneIds.push(shelter.zoneId);
    }

    var legs = [], acc = 0, arrival = {}, driveMinutes = 0, routeRoadIds = [];
    for (var k = 0; k < zoneIds.length - 1; k++) {
      var from = zoneIds[k], to = zoneIds[k + 1];
      var t = legTime(access, from, to);
      if (!isFinite(t)) return { ok: false, reason: 'unreachable', from: from, to: to, groupIds: groupIds };
      var roads = legRoads(access, world.roads, from, to);
      legs.push({ from: from, to: to, minutes: t, roadIds: roads });
      routeRoadIds = routeRoadIds.concat(roads);
      acc += t;
      driveMinutes += t;
      if (k + 1 <= ordered.length) arrival[ordered[k].id] = acc;
    }

    var people = FA.util.sum(ordered, function (x) { return x.people; });
    var wheelchair = FA.util.sum(ordered, function (x) { return x.wheelchair || 0; });

    return {
      ok: true,
      groupIds: groupIds.slice(),
      groupOrder: ordered.map(function (x) { return x.id; }),
      shelterId: shelterId || null,
      legs: legs,
      routeRoadIds: routeRoadIds,
      arrival: arrival,
      finishMinute: acc,
      driveMinutes: driveMinutes,
      people: people,
      wheelchair: wheelchair
    };
  }

  /* ------------------------------ 人员组紧迫度 ------------------------------ */
  function groupUrgency(group, priorityMap) {
    var zp = priorityMap[group.zoneId] ? priorityMap[group.zoneId].priority : 0.3;
    var u = 0.55 * zp + 0.25 * (group.highRisk ? 1 : 0) + 0.15 * (group.assisted ? 1 : 0) + 0.05 * Math.min(1, group.wheelchair || 0);
    return FA.util.clamp(u, 0, 1);
  }

  /* ------------------------------ 贪心构造 ------------------------------ */
  function constructGreedy(world, analysis, objectiveKey) {
    var cfg = OBJECTIVE_WEIGHTS[objectiveKey] || OBJECTIVE_WEIGHTS.risk_first;
    var access = analysis.access;
    var priorityMap = {};
    analysis.priority.zones.forEach(function (p) { priorityMap[p.zoneId] = p; });

    var openShelters = world.shelters.filter(function (s) { return s.status === 'open'; });
    var shelterLoad = {};
    openShelters.forEach(function (s) { shelterLoad[s.id] = { people: s.occupied || 0, wheelchair: 0, base: s.occupied || 0 }; });

    var routes = world.vehicles.filter(function (v) { return v.status !== 'offline'; }).map(function (v) {
      return { vehicleId: v.id, vehicleName: v.name, baseZoneId: v.baseZoneId, seats: v.seats, wheelchairSlots: v.wheelchairSlots, groupIds: [], shelterId: null };
    });

    var pool = world.groups.slice().sort(function (a, b) {
      return groupUrgency(b, priorityMap) - groupUrgency(a, priorityMap);
    });

    routes.forEach(function (route) {
      var vehicle = world.vehicles.find(function (v) { return v.id === route.vehicleId; });
      var progress = true;
      while (progress) {
        progress = false;

        // 当前路线（暂无安置点）的时刻表，用于比较插入代价
        var current = scheduleRoute(world, access, vehicle, route.groupIds, null);
        var currentTime = current.ok ? current.finishMinute : 0;

        var best = null;
        pool.forEach(function (g, gi) {
          if (route.groupIds.indexOf(g.id) >= 0) return;
          var loadPeople = FA.util.sum(route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.people; });
          var loadWc = FA.util.sum(route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.wheelchair || 0; });
          if (loadPeople + g.people > vehicle.seats) return;
          if (loadWc + (g.wheelchair || 0) > vehicle.wheelchairSlots) return;

          // 该组自身是否可达任何开放安置点
          if (access.shelterMinutes[g.zoneId] == null) return;

          for (var pos = 0; pos <= route.groupIds.length; pos++) {
            var cand = route.groupIds.slice();
            cand.splice(pos, 0, g.id);
            var sch = scheduleRoute(world, access, vehicle, cand, null);
            if (!sch.ok) continue;
            var detour = sch.finishMinute - currentTime;
            var urgency = groupUrgency(g, priorityMap);
            var gain = cfg.gainUrgency * urgency
              + cfg.gainPeople * g.people
              - cfg.gainDetour * detour
              - cfg.gainWait * (sch.arrival[g.id] || 0);
            if (!best || gain > best.gain + 1e-9) {
              best = { gain: gain, groupId: g.id, pos: pos, index: gi, schedule: sch, detour: detour };
            }
          }
        });

        if (best) {
          route.groupIds.splice(best.pos, 0, best.groupId);
          pool.splice(best.index, 1);
          progress = true;
        }
      }

      // 选定安置点：在容量允许的前提下，让「最后一个接人点 → 安置点」的行驶时间最短
      if (route.groupIds.length) {
        var needed = FA.util.sum(route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.people; });
        var neededWc = FA.util.sum(route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.wheelchair || 0; });
        var pickupSch = scheduleRoute(world, access, vehicle, route.groupIds, null);
        var lastZone = pickupSch.ok ? pickupSch.legs[pickupSch.legs.length - 1].to : vehicle.baseZoneId;

        var pick = null;
        openShelters.forEach(function (s) {
          var load = shelterLoad[s.id];
          if (load.people + needed > s.capacity) return;
          if (load.wheelchair + neededWc > s.wheelchairSlots) return;
          var t = legTime(access, lastZone, s.zoneId);
          if (!isFinite(t)) return;
          if (!pick || t < pick.minutes) pick = { shelter: s, minutes: t };
        });

        if (pick) {
          route.shelterId = pick.shelter.id;
          shelterLoad[pick.shelter.id].people += needed;
          shelterLoad[pick.shelter.id].wheelchair += neededWc;
        } else {
          // 没有容量足够的安置点：从路线尾部回退，把人员放回待安排池，保留缺口
          var guard = 0;
          while (route.groupIds.length && !route.shelterId && guard++ < 20) {
            var dropped = route.groupIds.pop();
            pool.push(world.groups.find(function (x) { return x.id === dropped; }));
            var needed2 = FA.util.sum(route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.people; });
            var neededWc2 = FA.util.sum(route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.wheelchair || 0; });
            var sch2 = scheduleRoute(world, access, vehicle, route.groupIds, null);
            var lastZone2 = sch2.ok && sch2.legs.length ? sch2.legs[sch2.legs.length - 1].to : vehicle.baseZoneId;
            openShelters.forEach(function (s) {
              if (route.shelterId) return;
              var load = shelterLoad[s.id];
              if (load.people + needed2 > s.capacity) return;
              if (load.wheelchair + neededWc2 > s.wheelchairSlots) return;
              var t = legTime(access, lastZone2, s.zoneId);
              if (isFinite(t)) {
                route.shelterId = s.id;
                shelterLoad[s.id].people += needed2;
                shelterLoad[s.id].wheelchair += neededWc2;
              }
            });
          }
          if (!route.shelterId && route.groupIds.length === 0) {
            // 整条路线未能落地，全部退回池中
            route.shelterId = null;
          }
        }
      }
    });

    return { routes: routes, pool: pool, shelterLoad: shelterLoad };
  }

  /* ------------------------------ 基线算法 ------------------------------ */
  /** 明示规则的「风险优先 · 最近可行」基线，用来做优化前后对比 */
  function constructBaseline(world, analysis) {
    var access = analysis.access;
    var priorityMap = {};
    analysis.priority.zones.forEach(function (p) { priorityMap[p.zoneId] = p; });

    var openShelters = world.shelters.filter(function (s) { return s.status === 'open'; });
    var shelterLoad = {};
    openShelters.forEach(function (s) { shelterLoad[s.id] = { people: s.occupied || 0, wheelchair: 0, base: s.occupied || 0 }; });

    var routes = world.vehicles.filter(function (v) { return v.status !== 'offline'; }).map(function (v) {
      return { vehicleId: v.id, vehicleName: v.name, baseZoneId: v.baseZoneId, seats: v.seats, wheelchairSlots: v.wheelchairSlots, groupIds: [], shelterId: null };
    });

    var order = world.groups.slice().sort(function (a, b) {
      var ua = groupUrgency(a, priorityMap), ub = groupUrgency(b, priorityMap);
      if (Math.abs(ub - ua) > 1e-9) return ub - ua;
      return a.id < b.id ? -1 : 1;
    });

    var unassigned = [];
    order.forEach(function (g) {
      if (access.shelterMinutes[g.zoneId] == null) { unassigned.push(g); return; }
      var best = null;
      routes.forEach(function (route) {
        var vehicle = world.vehicles.find(function (v) { return v.id === route.vehicleId; });
        var loadPeople = FA.util.sum(route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.people; });
        var loadWc = FA.util.sum(route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.wheelchair || 0; });
        if (loadPeople + g.people > vehicle.seats) return;
        if (loadWc + (g.wheelchair || 0) > vehicle.wheelchairSlots) return;

        var cand = route.groupIds.concat([g.id]);
        var sch = scheduleRoute(world, access, vehicle, cand, null);
        if (!sch.ok) return;
        // 最近可行：只看到接人点为止的路程最短
        var pickupTime = sch.arrival[g.id];
        var nearestShelter = null;
        openShelters.forEach(function (s) {
          var load = shelterLoad[s.id];
          if (load.people + loadPeople + g.people > s.capacity) return;
          if (load.wheelchair + loadWc + (g.wheelchair || 0) > s.wheelchairSlots) return;
          var t = legTime(access, g.zoneId, s.zoneId);
          if (!isFinite(t)) return;
          if (!nearestShelter || t < nearestShelter.minutes) nearestShelter = { shelter: s, minutes: t };
        });
        if (!nearestShelter) return;
        var cost = pickupTime + nearestShelter.minutes;
        if (!best || cost < best.cost) best = { route: route, cost: cost, pickupTime: pickupTime, shelter: nearestShelter.shelter };
      });

      if (!best) { unassigned.push(g); return; }
      best.route.groupIds.push(g.id);
      if (!best.route.shelterId) {
        best.route.shelterId = best.shelter.id;
        shelterLoad[best.shelter.id].people += FA.util.sum(best.route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.people; });
        shelterLoad[best.shelter.id].wheelchair += FA.util.sum(best.route.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.wheelchair || 0; });
      } else if (best.route.shelterId !== best.shelter.id) {
        // 基线不重排安置点，保持先到先得
      }
    });

    return { routes: routes, pool: unassigned, shelterLoad: shelterLoad };
  }

  /* ------------------------------ 方案度量 ------------------------------ */
  function measure(world, analysis, built) {
    var access = analysis.access;
    var gmap = {};
    world.groups.forEach(function (g) { gmap[g.id] = g; });
    var priorityMap = {};
    analysis.priority.zones.forEach(function (p) { priorityMap[p.zoneId] = p; });

    var assignments = [];
    var assignedIds = {};
    var totalPeople = FA.util.sum(world.groups, function (g) { return g.people; });
    var weightedWait = 0, priorityWait = 0, assistedWait = 0, urgentWait = 0;
    var driveMinutes = 0, finishMinute = 0, servedPeople = 0, urgentPeople = 0, assistedPeople = 0;
    var validationErrors = [];

    built.routes.forEach(function (route) {
      if (!route.groupIds.length) return;
      var vehicle = world.vehicles.find(function (v) { return v.id === route.vehicleId; });
      var sch = scheduleRoute(world, access, vehicle, route.groupIds, route.shelterId);
      if (!sch.ok) {
        validationErrors.push(vehicle.name + ' 路线不可行（' + sch.reason + '）');
        return;
      }
      sch.groupOrder.forEach(function (gid) {
        var g = gmap[gid];
        if (!g) return;
        var t = sch.arrival[gid];
        weightedWait += g.people * t;
        var isUrgent = !!g.highRisk, isAssisted = !!g.assisted;
        if (isUrgent || isAssisted) priorityWait += g.people * t;
        if (isAssisted) assistedWait += g.people * t;
        if (isUrgent) urgentWait += g.people * t;
      });
      servedPeople += sch.people;
      urgentPeople += FA.util.sum(sch.groupOrder.map(function (id) { return gmap[id]; }), function (g) { return g.highRisk ? g.people : 0; });
      assistedPeople += FA.util.sum(sch.groupOrder.map(function (id) { return gmap[id]; }), function (g) { return g.assisted ? g.people : 0; });
      driveMinutes += sch.driveMinutes;
      finishMinute = Math.max(finishMinute, sch.finishMinute);
      sch.groupOrder.forEach(function (gid) { assignedIds[gid] = true; });

      assignments.push({
        vehicleId: route.vehicleId,
        vehicleName: route.vehicleName,
        baseZoneId: route.baseZoneId,
        shelterId: route.shelterId,
        shelterName: (world.shelters.find(function (s) { return s.id === route.shelterId; }) || {}).name,
        stops: sch.groupOrder.map(function (gid) {
          var g = gmap[gid];
          return {
            groupId: gid, groupName: g.name, zoneId: g.zoneId, people: g.people,
            wheelchair: g.wheelchair || 0, assisted: !!g.assisted, highRisk: !!g.highRisk,
            pickupMinute: sch.arrival[gid], urgency: FA.util.round(groupUrgency(g, priorityMap), 3)
          };
        }),
        legs: sch.legs,
        routeRoadIds: sch.routeRoadIds,
        finishMinute: sch.finishMinute,
        driveMinutes: sch.driveMinutes,
        people: sch.people,
        wheelchair: sch.wheelchair
      });
    });

    var unassigned = world.groups.filter(function (g) { return !assignedIds[g.id]; });
    var unassignedPeople = FA.util.sum(unassigned, function (g) { return g.people; });

    var shelterLoad = {};
    Object.keys(built.shelterLoad).forEach(function (sid) {
      var sh = world.shelters.find(function (s) { return s.id === sid; });
      var load = built.shelterLoad[sid];
      shelterLoad[sid] = {
        shelterId: sid,
        name: sh ? sh.name : sid,
        capacity: sh ? sh.capacity : 0,
        people: load.people,
        wheelchair: load.wheelchair,
        remaining: sh ? sh.capacity - load.people : 0
      };
    });

    var coveredUrgency = FA.util.sum(assignments, function (a) {
      return FA.util.sum(a.stops, function (s) { return s.urgency * s.people; });
    });
    var totalUrgency = FA.util.sum(world.groups, function (g) {
      return groupUrgency(g, priorityMap) * g.people;
    });

    return {
      servedPeople: servedPeople,
      totalPeople: totalPeople,
      unassignedPeople: unassignedPeople,
      urgentPeople: urgentPeople,
      assistedPeople: assistedPeople,
      weightedWait: weightedWait,
      priorityWait: priorityWait,
      assistedWait: assistedWait,
      urgentWait: urgentWait,
      finishMinute: finishMinute,
      driveMinutes: driveMinutes,
      complete: unassigned.length === 0,
      vehicleCount: built.routes.filter(function (r) { return r.groupIds.length; }).length,
      idleVehicles: built.routes.filter(function (r) { return !r.groupIds.length; }).map(function (r) { return r.vehicleName; }),
      coverage: totalPeople ? FA.util.round(servedPeople / totalPeople, 4) : 0,
      urgencyCoverage: totalUrgency ? FA.util.round(coveredUrgency / totalUrgency, 4) : 0,
      coveredUrgency: FA.util.round(coveredUrgency, 3),
      totalUrgency: FA.util.round(totalUrgency, 3),
      assignments: assignments,
      shelterLoad: shelterLoad,
      unassigned: unassigned.map(function (g) { return { id: g.id, name: g.name, zoneId: g.zoneId, people: g.people, stage: 'waiting' }; }),
      validationErrors: validationErrors
    };
  }

  function scoreOf(metrics, objectiveKey) {
    var cfg = OBJECTIVE_WEIGHTS[objectiveKey] || OBJECTIVE_WEIGHTS.risk_first;
    var waitHoursPerPerson = metrics.totalPeople ? (metrics.weightedWait / metrics.totalPeople) / 60 : 0;
    var drivePenalty = metrics.driveMinutes / 200;
    return cfg.urgency * metrics.urgencyCoverage
      + cfg.coverage * metrics.coverage
      - cfg.wait * waitHoursPerPerson
      - cfg.drive * drivePenalty;
  }

  /* ------------------------------ 有界局部搜索 ------------------------------ */
  function improve(world, analysis, built, objectiveKey, maxIterations) {
    var access = analysis.access;
    var routes = built.routes;
    var pool = built.pool;
    var iterations = 0;
    var improvements = 0;
    var bestScore = scoreOf(measure(world, analysis, built), objectiveKey);
    var limit = maxIterations || 600;

    function cloneBuilt() {
      return {
        routes: routes.map(function (r) { return Object.assign({}, r, { groupIds: r.groupIds.slice() }); }),
        pool: pool.slice(),
        shelterLoad: JSON.parse(JSON.stringify(built.shelterLoad))
      };
    }

    function applyMoveRebuild(mutator) {
      // 每次尝试都从当前最优结构重建，避免部分修改后容量账本不一致
      var trial = cloneBuilt();
      var ok = mutator(trial);
      if (!ok) return null;
      rebuildShelterLoad(trial);
      if (!checkFeasible(world, analysis, trial)) return null;
      return trial;
    }

    function rebuildShelterLoad(trial) {
      var openShelters = world.shelters.filter(function (s) { return s.status === 'open'; });
      var load = {};
      openShelters.forEach(function (s) { load[s.id] = { people: s.occupied || 0, wheelchair: 0, base: s.occupied || 0 }; });
      trial.routes.forEach(function (r) {
        if (!r.groupIds.length) { r.shelterId = null; return; }
        var people = FA.util.sum(r.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.people; });
        var wc = FA.util.sum(r.groupIds.map(function (id) { return world.groups.find(function (x) { return x.id === id; }); }), function (x) { return x.wheelchair || 0; });
        if (!r.shelterId) {
          var pick = null;
          openShelters.forEach(function (s) {
            if (load[s.id].people + people > s.capacity) return;
            if (load[s.id].wheelchair + wc > s.wheelchairSlots) return;
            var vehicle = world.vehicles.find(function (v) { return v.id === r.vehicleId; });
            var sch = scheduleRoute(world, access, vehicle, r.groupIds, null);
            var lastZone = sch.ok && sch.legs.length ? sch.legs[sch.legs.length - 1].to : r.baseZoneId;
            var t = legTime(access, lastZone, s.zoneId);
            if (!isFinite(t)) return;
            if (!pick || t < pick.minutes) pick = { shelter: s, minutes: t };
          });
          if (!pick) { return; }
          r.shelterId = pick.shelter.id;
        }
        load[r.shelterId].people += people;
        load[r.shelterId].wheelchair += wc;
      });
      trial.shelterLoad = load;
    }

    function checkFeasible(w, a, trial) {
      var vehicles = {};
      w.vehicles.forEach(function (v) { vehicles[v.id] = v; });
      var shelters = {};
      w.shelters.forEach(function (s) { shelters[s.id] = s; });
      var seen = {};
      for (var i = 0; i < trial.routes.length; i++) {
        var r = trial.routes[i];
        var v = vehicles[r.vehicleId];
        if (!v) return false;
        var people = 0, wc = 0;
        for (var j = 0; j < r.groupIds.length; j++) {
          var g = w.groups.find(function (x) { return x.id === r.groupIds[j]; });
          if (!g) return false;
          if (seen[g.id]) return false;
          seen[g.id] = true;
          people += g.people;
          wc += g.wheelchair || 0;
        }
        if (people > v.seats || wc > v.wheelchairSlots) return false;
        if (r.groupIds.length) {
          var sh = shelters[r.shelterId];
          if (!sh || sh.status !== 'open') return false;
          var load = trial.shelterLoad[r.shelterId];
          if (load.people > sh.capacity || load.wheelchair > sh.wheelchairSlots) return false;
          var sch = scheduleRoute(w, a.access, v, r.groupIds, r.shelterId);
          if (!sch.ok) return false;
        }
      }
      return true;
    }

    /* ---- 邻居枚举：每轮评估一族候选移动，接受其中最优的改进 ---- */
    function mutators(base) {
      var list = [];

      // 1) 把待安排人员插入任一线路的任一位置（提高覆盖）
      base.pool.forEach(function (g) {
        if (access.shelterMinutes[g.zoneId] == null) return;
        base.routes.forEach(function (r) {
          for (var pos = 0; pos <= r.groupIds.length; pos++) {
            (function (gid, routeId, p) {
              list.push(function (t) {
                var rr = t.routes.find(function (x) { return x.vehicleId === routeId; });
                var idx = t.pool.findIndex(function (x) { return x.id === gid; });
                if (!rr || idx < 0) return false;
                rr.shelterId = null;
                rr.groupIds.splice(p, 0, gid);
                t.pool.splice(idx, 1);
                return true;
              });
            })(g.id, r.vehicleId, pos);
          }
        });
      });

      // 2) 线路内相邻换位（2-opt 风格，压低等待）
      base.routes.forEach(function (r) {
        for (var k = 0; k < r.groupIds.length - 1; k++) {
          (function (routeId, i) {
            list.push(function (t) {
              var rr = t.routes.find(function (x) { return x.vehicleId === routeId; });
              if (!rr || rr.groupIds.length < i + 2) return false;
              var tmp = rr.groupIds[i];
              rr.groupIds[i] = rr.groupIds[i + 1];
              rr.groupIds[i + 1] = tmp;
              rr.shelterId = null;
              return true;
            });
          })(r.vehicleId, k);
        }
      });

      // 3) 跨车移动一组（腾出座位或降低整体等待）
      base.routes.forEach(function (from) {
        from.groupIds.forEach(function (gid) {
          base.routes.forEach(function (to) {
            if (to.vehicleId === from.vehicleId) return;
            for (var pos = 0; pos <= to.groupIds.length; pos++) {
              (function (fromId, toId, g, p) {
                list.push(function (t) {
                  var f = t.routes.find(function (x) { return x.vehicleId === fromId; });
                  var tt = t.routes.find(function (x) { return x.vehicleId === toId; });
                  if (!f || !tt) return false;
                  var idx = f.groupIds.indexOf(g);
                  if (idx < 0) return false;
                  f.groupIds.splice(idx, 1);
                  f.shelterId = null;
                  tt.groupIds.splice(p, 0, g);
                  tt.shelterId = null;
                  return true;
                });
              })(from.vehicleId, to.vehicleId, gid, pos);
            }
          });
        });
      });

      // 4) 跨车交换两组（改善车型与人员需求的匹配，例如无障碍位）
      base.routes.forEach(function (r1, i) {
        base.routes.forEach(function (r2, j) {
          if (j <= i) return;
          r1.groupIds.forEach(function (g1) {
            r2.groupIds.forEach(function (g2) {
              list.push(function (t) {
                var a = t.routes.find(function (x) { return x.vehicleId === r1.vehicleId; });
                var b = t.routes.find(function (x) { return x.vehicleId === r2.vehicleId; });
                if (!a || !b) return false;
                var ia = a.groupIds.indexOf(g1), ib = b.groupIds.indexOf(g2);
                if (ia < 0 || ib < 0) return false;
                a.groupIds[ia] = g2;
                b.groupIds[ib] = g1;
                a.shelterId = null;
                b.shelterId = null;
                return true;
              });
            });
          });
        });
      });

      return list;
    }

    var rounds = 0;
    var maxRounds = Math.max(1, Math.floor(limit / 8));
    while (iterations < limit && rounds < maxRounds) {
      rounds += 1;
      var cands = mutators(built);
      if (!cands.length) break;

      var bestTrial = null, bestS = bestScore;
      for (var c = 0; c < cands.length && iterations < limit; c++) {
        iterations += 1;
        var trial = applyMoveRebuild(cands[c]);
        if (!trial) continue;
        var s = scoreOf(measure(world, analysis, trial), objectiveKey);
        if (s > bestS + 1e-9) { bestS = s; bestTrial = trial; }
      }
      if (!bestTrial) break;                 // 无改进即收敛
      built = bestTrial;
      routes = built.routes;
      pool = built.pool;
      bestScore = bestS;
      improvements += 1;
    }

    built.score = FA.util.round(bestScore, 4);
    built.search = { iterations: iterations, improvements: improvements, bounded: true, limit: limit };
    return built;
  }

  /* ------------------------------ 未安排原因 ------------------------------ */
  function explainUnassigned(world, analysis, unassigned) {
    var access = analysis.access;
    var vehicles = world.vehicles.filter(function (v) { return v.status !== 'offline'; });
    var openShelters = world.shelters.filter(function (s) { return s.status === 'open'; });
    var maxSeats = vehicles.length ? Math.max.apply(null, vehicles.map(function (v) { return v.seats; })) : 0;
    var maxWc = vehicles.length ? Math.max.apply(null, vehicles.map(function (v) { return v.wheelchairSlots; })) : 0;
    var totalCapacity = FA.util.sum(openShelters, function (s) { return s.capacity - (s.occupied || 0); });

    return unassigned.map(function (u) {
      var g = world.groups.find(function (x) { return x.id === u.id; }) || u;
      var code, reason, next;
      if (access.shelterMinutes[g.zoneId] == null) {
        code = 'unreachable';
        reason = '当前开放路网无法从此网格到达任何开放安置点';
        next = '恢复受阻路段，或在该网格就近启用临时安置点。';
      } else if (g.people > maxSeats) {
        code = 'seat';
        reason = '单组人数超过任一可用车辆的座位数';
        next = '调派更大车辆，或拆分为两次转运。';
      } else if ((g.wheelchair || 0) > maxWc) {
        code = 'wheelchair';
        reason = '需要无障碍位，但可用车辆的无障碍座位不足';
        next = '调派无障碍车辆，或改用其他转运方式并安排陪护。';
      } else if (g.people > totalCapacity) {
        code = 'shelter-capacity';
        reason = '开放安置点的剩余容量不足以接收本组';
        next = '增开安置点或协调邻近接收点。';
      } else {
        code = 'joint-capacity';
        reason = '当前车辆适配、座位、安置容量或开放路网不能同时满足';
        next = '本组单独可适配，但与其他人员竞争有限座位、轮椅位或接收容量；优先级策略选择后仍需增援。';
      }
      return {
        id: u.id, name: u.name, zoneId: u.zoneId, people: u.people,
        stage: 'waiting', reason: reason, code: code, next: next
      };
    });
  }

  /* ------------------------------ 约束校验 ------------------------------ */
  /**
   * 对「这一份方案」做独立约束校验（不看当前 store，避免校验错对象）。
   * 这是可复现评估与界面「约束校验」徽标的共同依据。
   */
  function validatePlan(world, metrics) {
    var errors = [];
    var vehicles = {}, shelters = {};
    (world.vehicles || []).forEach(function (v) { vehicles[v.id] = v; });
    (world.shelters || []).forEach(function (s) { shelters[s.id] = s; });
    var closedRoadIds = (world.roads || []).filter(function (r) { return r.closed; }).map(function (r) { return r.id; });
    var seen = {};

    (metrics.assignments || []).forEach(function (a) {
      var v = vehicles[a.vehicleId];
      if (!v) { errors.push('方案引用了不存在的车辆 ' + a.vehicleId); return; }
      var people = FA.util.sum(a.stops || [], function (s) { return s.people; });
      var wc = FA.util.sum(a.stops || [], function (s) { return s.wheelchair || 0; });
      if (people > v.seats) errors.push(v.name + ' 座位超载：' + people + ' > ' + v.seats);
      if (wc > v.wheelchairSlots) errors.push(v.name + ' 无障碍位超载：' + wc + ' > ' + v.wheelchairSlots);
      (a.stops || []).forEach(function (s) {
        if (seen[s.groupId]) errors.push('人员组被重复安排：' + s.groupId);
        seen[s.groupId] = true;
      });
      (a.routeRoadIds || []).forEach(function (rid) {
        if (closedRoadIds.indexOf(rid) >= 0) errors.push(v.name + ' 路线使用了已阻断路段 ' + rid);
      });
      if (!a.shelterId) {
        errors.push(v.name + ' 有接人点但未指定安置点');
      } else if (!shelters[a.shelterId]) {
        errors.push('方案引用了不存在的安置点 ' + a.shelterId);
      } else if (shelters[a.shelterId].status !== 'open') {
        errors.push(shelters[a.shelterId].name + ' 已停用，方案不应使用');
      }
    });

    Object.keys(metrics.shelterLoad || {}).forEach(function (sid) {
      var sh = shelters[sid], load = metrics.shelterLoad[sid];
      if (!sh) { errors.push('方案引用了不存在的安置点 ' + sid); return; }
      if (load.people > sh.capacity) errors.push(sh.name + ' 容量超限：' + load.people + ' > ' + sh.capacity);
      if (load.wheelchair > sh.wheelchairSlots) errors.push(sh.name + ' 无障碍容量超限：' + load.wheelchair + ' > ' + sh.wheelchairSlots);
    });

    return { ok: errors.length === 0, errors: errors, checkedAt: FA.util.nowIso() };
  }

  /* ------------------------------ 主入口 ------------------------------ */
  /**
   * @param {object} world { zones, groups, shelters, vehicles, roads, rainfallMm }
   * @param {object} opts  { objective, maxIterations }
   */
  function optimize(world, opts) {
    opts = opts || {};
    var objectiveKey = opts.objective || 'risk_first';
    if (!OBJECTIVE_WEIGHTS[objectiveKey]) objectiveKey = 'risk_first';

    var started = Date.now();
    var access = FA.analytics.accessibility(world.zones, world.shelters, world.roads);
    var risk = FA.analytics.riskByZone(world.zones, world.rainfallMm);
    var svi = FA.analytics.sviByZone(world.zones, world.groups, access);
    var priority = FA.analytics.priorityList(risk, svi, access);
    var analysis = { access: access, risk: risk, svi: svi, priority: priority };

    // 优化方案
    var built = constructGreedy(world, analysis, objectiveKey);
    built = improve(world, analysis, built, objectiveKey, opts.maxIterations);
    var optimized = measure(world, analysis, built);
    optimized.algorithm = 'guardian-candidate-search-3.7 (' + objectiveKey + ')';
    optimized.objective = objectiveKey;
    optimized.objectiveLabel = objectiveLabel(objectiveKey);
    optimized.score = built.score;
    optimized.search = built.search;

    // 基线方案（同一输入快照）
    var baseBuilt = constructBaseline(world, analysis);
    var baseline = measure(world, analysis, baseBuilt);
    baseline.algorithm = 'risk-nearest-feasible-3.7';
    baseline.objective = 'risk_first';
    baseline.objectiveLabel = objectiveLabel('risk_first');
    baseline.score = FA.util.round(scoreOf(baseline, 'risk_first'), 4);

    var explanations = explainUnassigned(world, analysis, optimized.unassigned);
    optimized.explanations = explanations;

    var validation = validatePlan(world, optimized);

    // 优化前后对比
    var comparison = {
      sameSnapshot: true,
      note: '同一输入快照、相同资源与约束下比较优化算法与明示规则基线；不将算法收益表述为 AI 效果。',
      rows: world.vehicles.map(function (v) {
        var o = optimized.assignments.find(function (a) { return a.vehicleId === v.id; });
        var b = baseline.assignments.find(function (a) { return a.vehicleId === v.id; });
        function pack(a) {
          return a ? {
            people: a.people, ids: a.stops.map(function (s) { return s.groupId; }),
            stops: a.stops.map(function (s) { return s.zoneId; }), shelterId: a.shelterId,
            finish: a.finishMinute, drive: a.driveMinutes, holding: false
          } : { people: 0, ids: [], stops: [], shelterId: null, finish: 0, drive: 0, holding: false };
        }
        return { vehicleId: v.id, vehicleName: v.name, baseline: pack(b), optimized: pack(o) };
      }),
      shelters: world.shelters.map(function (s) {
        var o = optimized.shelterLoad[s.id], b = baseline.shelterLoad[s.id];
        return {
          id: s.id, name: s.name, capacity: s.capacity, occupied: s.occupied || 0,
          baseline: b ? b.people : 0, optimized: o ? o.people : 0
        };
      }),
      baselineUnassigned: baseline.unassigned,
      optimizedUnassigned: optimized.unassigned,
      priorityWait: { baseline: baseline.priorityWait, optimized: optimized.priorityWait, unit: '人·分钟', definition: '已安排高风险人数与实际需协助人数的并集等待，同人不重复；须同时比较未安排人数' },
      assistedWait: { baseline: baseline.assistedWait, optimized: optimized.assistedWait, unit: '人·分钟' },
      urgentWait: { baseline: baseline.urgentWait, optimized: optimized.urgentWait, unit: '人·分钟' },
      metrics: {
        servedPeople: { baseline: baseline.servedPeople, optimized: optimized.servedPeople, unit: '人' },
        unassignedPeople: { baseline: baseline.unassignedPeople, optimized: optimized.unassignedPeople, unit: '人' },
        weightedWait: { baseline: baseline.weightedWait, optimized: optimized.weightedWait, unit: '人·分钟' },
        finishMinute: { baseline: baseline.finishMinute, optimized: optimized.finishMinute, unit: '分钟' },
        driveMinutes: { baseline: baseline.driveMinutes, optimized: optimized.driveMinutes, unit: '分钟' }
      }
    };

    var plan = {
      id: FA.util.uid('PLAN'),
      at: FA.util.nowIso(),
      clock: FA.util.elapsed(),
      objective: objectiveKey,
      objectiveLabel: objectiveLabel(objectiveKey),
      rainfallMm: world.rainfallMm,
      algorithm: optimized.algorithm,
      methodNote: '优先级贪心构造 + 有界局部搜索；单次调度每车一趟；规模较大时不保证全局最优。',
      assignments: optimized.assignments,
      shelterLoad: optimized.shelterLoad,
      unassigned: optimized.unassigned,
      explanations: explanations,
      metrics: optimized,
      baseline: baseline,
      comparison: comparison,
      analysis: {
        risk: risk,
        svi: svi,
        priority: priority,
        access: {
          shelterMinutes: access.shelterMinutes,
          shelterNearest: access.shelterNearest,
          unreachable: access.unreachable,
          closedRoadIds: access.closedRoadIds,
          openRoadCount: access.openRoadCount
        }
      },
      validation: validation,
      search: built.search,
      elapsedMs: Date.now() - started
    };

    return plan;
  }

  FA.optimizer = {
    optimize: optimize,
    constructBaseline: constructBaseline,
    scheduleRoute: scheduleRoute,
    measure: measure,
    groupUrgency: groupUrgency,
    scoreOf: scoreOf,
    validatePlan: validatePlan,
    OBJECTIVE_WEIGHTS: OBJECTIVE_WEIGHTS
  };
})(window.FA = window.FA || {});
