/*!
 * 城市韧性守护 Agent · 分析内核（纯函数，无状态）
 * ---------------------------------------------------------------
 * 对应 Word 文档「六、拟采用的主要AI及数据技术」中的四个模块：
 *   - 洪涝风险模型   → riskByZone()     加权 Logistic 代理模型
 *   - 可解释 AI      → 每个网格输出因子贡献度分解（SHAP 风格）
 *   - 社会脆弱性分析 → sviByZone()      指标体系加权法（非 CDC SVI 照搬）
 *   - GIS 空间分析   → travelMatrix() / accessibility()  Dijkstra 路网可达性
 *   - 应急响应优先级 → priorityList()   灾害风险 + 人口暴露 + 社会脆弱性 + 应对能力
 *
 * 全部是纯函数：同一个 world 输入一定得到同一个输出，便于「可复现评估」。
 * 这些函数不读写 store，因此情景推演（不同雨量、不同路网）可以安全地反复调用，
 * 不会污染当前工作状态。
 */
(function (FA) {
  'use strict';

  var W = FA.data.modelWeights;

  /* ============================ 风险模型 ============================ */
  function drainageScore(cap) {
    var map = W.floodRisk.normalize.drainageCapacity;
    return map[cap] == null ? 0.5 : map[cap];
  }

  /** 逻辑函数；输入过大时截断，避免 Math.exp 溢出成 Infinity */
  function sigmoid(z) {
    if (z > 30) return 1;
    if (z < -30) return 0;
    return 1 / (1 + Math.exp(-z));
  }

  /**
   * 逐网格积水易发风险评估。
   * @returns {{rainfallMm:number, method:string, methodLabel:string, zones:Array}}
   */
  function riskByZone(zones, rainfallMm) {
    var cfg = W.floodRisk, nz = cfg.normalize;
    var rainNorm = FA.util.norm(rainfallMm, nz.rainfallMm);

    var results = (zones || []).map(function (z) {
      var factors = [
        { key: 'rainfall', label: '累计雨量', value: rainfallMm, unit: 'mm', weight: cfg.weights.rainfall, norm: rainNorm, contribution: cfg.weights.rainfall * rainNorm },
        { key: 'lowElevation', label: '地势低洼', value: z.elevationM, unit: 'm', weight: cfg.weights.lowElevation, norm: 1 - FA.util.norm(z.elevationM, nz.elevationM), contribution: cfg.weights.lowElevation * (1 - FA.util.norm(z.elevationM, nz.elevationM)) },
        { key: 'impervious', label: '不透水面比例', value: z.impervious, unit: '', weight: cfg.weights.impervious, norm: FA.util.norm(z.impervious, nz.impervious), contribution: cfg.weights.impervious * FA.util.norm(z.impervious, nz.impervious) },
        { key: 'history', label: '历史易涝次数', value: z.history, unit: '次', weight: cfg.weights.history, norm: FA.util.norm(z.history, nz.history), contribution: cfg.weights.history * FA.util.norm(z.history, nz.history) },
        { key: 'riverProximity', label: '临江程度', value: z.riverDistanceM, unit: 'm', weight: cfg.weights.riverProximity, norm: 1 - FA.util.norm(z.riverDistanceM, nz.riverDistanceM), contribution: cfg.weights.riverProximity * (1 - FA.util.norm(z.riverDistanceM, nz.riverDistanceM)) },
        { key: 'drainageDeficit', label: '排水能力不足', value: z.drainage, unit: '', weight: cfg.weights.drainageDeficit, norm: drainageScore(z.drainage), contribution: cfg.weights.drainageDeficit * drainageScore(z.drainage) }
      ];

      var z0 = cfg.intercept + FA.util.sum(factors, function (f) { return f.contribution; });
      var score = sigmoid(z0);
      var level = FA.util.levelOf(score, cfg.levels);

      // 因子贡献度排序：正面贡献在前（解释了「为什么这里风险高」）
      var drivers = factors.slice().sort(function (a, b) { return b.contribution - a.contribution; })
        .map(function (f) {
          return {
            key: f.key,
            label: f.label,
            value: f.value,
            unit: f.unit,
            norm: FA.util.round(f.norm, 3),
            contribution: FA.util.round(f.contribution, 3),
            share: FA.util.round(f.contribution / Math.max(0.0001, FA.util.sum(factors, function (x) { return x.contribution; })), 3)
          };
        });

      return {
        zoneId: z.id,
        name: z.name,
        alias: z.alias,
        score: FA.util.round(score, 4),
        percent: FA.util.round(score * 100, 1),
        level: level.key,
        levelLabel: level.label,
        logit: FA.util.round(z0, 3),
        drivers: drivers,
        // 一句话解释，直接用于对话与报告
        explanation: level.label + '风险：' + drivers[0].label + '（贡献 ' + FA.util.round(drivers[0].contribution, 2) +
          '）与' + drivers[1].label + '（贡献 ' + FA.util.round(drivers[1].contribution, 2) + '）是主要成因'
      };
    });

    results.sort(function (a, b) { return b.score - a.score; });
    return {
      rainfallMm: rainfallMm,
      method: cfg.method,
      methodLabel: cfg.methodLabel,
      methodNote: '权重与归一化区间外置于 region-config.js，可审计、可替换为 LightGBM/XGBoost 等训练模型；本演示不宣称水动力仿真精度。',
      intercept: cfg.intercept,
      zones: results
    };
  }

  /* ============================ 路网可达性 ============================ */
  function buildAdjacency(zones, roads) {
    var adj = {};
    (zones || []).forEach(function (z) { adj[z.id] = []; });
    (roads || []).forEach(function (r) {
      if (r.closed) return;
      if (adj[r.from]) adj[r.from].push({ to: r.to, minutes: r.minutes, roadId: r.id });
      if (adj[r.to]) adj[r.to].push({ to: r.from, minutes: r.minutes, roadId: r.id });
    });
    return adj;
  }

  /** 单源最短行驶时间（Dijkstra）。返回 { dist, prev } */
  function dijkstra(adj, fromId, zoneIds) {
    var dist = {}, prev = {}, visited = {};
    (zoneIds || []).forEach(function (id) { dist[id] = Infinity; });
    if (dist[fromId] === undefined) return { dist: dist, prev: prev };
    dist[fromId] = 0;
    while (true) {
      var cur = null, best = Infinity;
      Object.keys(dist).forEach(function (k) {
        if (!visited[k] && dist[k] < best) { best = dist[k]; cur = k; }
      });
      if (cur === null || best === Infinity) break;
      visited[cur] = true;
      (adj[cur] || []).forEach(function (e) {
        var nd = dist[cur] + e.minutes;
        if (nd < dist[e.to]) { dist[e.to] = nd; prev[e.to] = cur; }
      });
    }
    return { dist: dist, prev: prev };
  }

  function pathFrom(prev, fromId, toId) {
    if (fromId === toId) return [fromId];
    var path = [toId], node = toId, guard = 0;
    while (prev[node] !== undefined && guard++ < 200) {
      node = prev[node];
      path.unshift(node);
      if (node === fromId) return path;
    }
    return [];
  }

  function pathToRoads(path, roads) {
    var ids = [];
    for (var i = 0; i < path.length - 1; i++) {
      var a = path[i], b = path[i + 1];
      var road = (roads || []).find(function (r) {
        return !r.closed && ((r.from === a && r.to === b) || (r.from === b && r.to === a));
      });
      if (road) ids.push(road.id);
    }
    return ids;
  }

  /**
   * 全网行驶时间矩阵 + 到最近开放安置点的可达性。
   * @returns {{matrix:object, paths:object, shelterMinutes:object, shelterNearest:object, unreachable:Array, closedRoadIds:Array}}
   */
  function accessibility(zones, shelters, roads) {
    var ids = (zones || []).map(function (z) { return z.id; });
    var adj = buildAdjacency(zones, roads);
    var matrix = {}, paths = {};
    ids.forEach(function (id) {
      var res = dijkstra(adj, id, ids);
      matrix[id] = res.dist;
      paths[id] = res.prev;
    });

    var open = (shelters || []).filter(function (s) { return s.status === 'open'; });
    var shelterMinutes = {}, shelterNearest = {}, unreachable = [];

    ids.forEach(function (id) {
      var best = Infinity, bestShelter = null, bestPath = [];
      open.forEach(function (sh) {
        var t = matrix[id][sh.zoneId];
        if (t < best) {
          best = t;
          bestShelter = sh;
          bestPath = pathFrom(paths[id], id, sh.zoneId);
        }
      });
      shelterMinutes[id] = isFinite(best) ? best : null;
      shelterNearest[id] = bestShelter ? bestShelter.id : null;
      if (!isFinite(best)) unreachable.push(id);
    });

    return {
      matrix: matrix,
      prev: paths,
      shelterMinutes: shelterMinutes,
      shelterNearest: shelterNearest,
      unreachable: unreachable,
      closedRoadIds: (roads || []).filter(function (r) { return r.closed; }).map(function (r) { return r.id; }),
      openRoadCount: (roads || []).filter(function (r) { return !r.closed; }).length,
      shelterReachable: open.map(function (s) { return { id: s.id, name: s.name, zoneId: s.zoneId }; })
    };
  }

  /* ============================ 社会脆弱性指数 ============================ */
  /**
   * @param {object} access accessibility() 的结果，用于避难点可达时间指标
   */
  function sviByZone(zones, groups, access) {
    var cfg = W.svi;
    var groupsByZone = FA.util.groupBy(groups || [], function (g) { return g.zoneId; });

    var results = (zones || []).map(function (z) {
      var zGroups = groupsByZone[z.id] || [];
      var assistedRatio = z.population > 0 ? (z.assisted / z.population) : 0;
      var shelterMin = (access && access.shelterMinutes[z.id] != null) ? access.shelterMinutes[z.id] : 20;

      var raw = {
        elderlyRatio: z.elderlyRatio,
        childRatio: z.childRatio,
        assistedRatio: assistedRatio,
        hospitalAccessMin: z.hospitalMin,
        shelterAccessMin: shelterMin
      };

      var indicators = cfg.indicators.map(function (ind) {
        var value = raw[ind.key];
        var norm = FA.util.norm(value, ind.normalize);
        return {
          key: ind.key,
          label: ind.label,
          value: FA.util.round(value, 3),
          weight: ind.weight,
          norm: FA.util.round(norm, 3),
          contribution: FA.util.round(ind.weight * norm, 4)
        };
      });

      var score = FA.util.sum(indicators, function (i) { return i.contribution; });
      var level = FA.util.levelOf(score, cfg.levels);
      indicators.sort(function (a, b) { return b.contribution - a.contribution; });

      return {
        zoneId: z.id,
        name: z.name,
        alias: z.alias,
        population: z.population,
        elderlyCount: Math.round(z.population * z.elderlyRatio),
        assisted: z.assisted,
        groupCount: zGroups.length,
        groupPeople: FA.util.sum(zGroups, function (g) { return g.people; }),
        score: FA.util.round(score, 4),
        percent: FA.util.round(score * 100, 1),
        level: level.key,
        levelLabel: level.label,
        indicators: indicators,
        explanation: level.label + '脆弱性：' + indicators[0].label + '（贡献 ' + FA.util.round(indicators[0].contribution, 3) +
          '）与' + indicators[1].label + '（贡献 ' + FA.util.round(indicators[1].contribution, 3) + '）是主要成因'
      };
    });

    results.sort(function (a, b) { return b.score - a.score; });
    return {
      method: cfg.method,
      methodLabel: cfg.methodLabel,
      methodNote: '指标体系加权法，指标与权重外置于 region-config.js。项目沿用「脆弱群体优先」的资源配置机制，但不照搬美国 CDC/FEMA 的 SVI 指标与阈值。',
      indicators: cfg.indicators,
      zones: results
    };
  }

  /* ============================ 应急响应优先级 ============================ */
  /**
   * 对应 Word 创新点 1：灾害风险 + 人口暴露 + 社会脆弱性 + 应对能力 → 应急响应优先级
   */
  function priorityList(risk, svi, access) {
    var cfg = W.priority;
    var riskMap = {}, sviMap = {};
    (risk.zones || []).forEach(function (r) { riskMap[r.zoneId] = r; });
    (svi.zones || []).forEach(function (s) { sviMap[s.zoneId] = s; });

    var list = Object.keys(riskMap).map(function (zoneId) {
      var r = riskMap[zoneId], s = sviMap[zoneId] || { score: 0, population: 0 };
      var shelterMin = (access.shelterMinutes[zoneId] != null) ? access.shelterMinutes[zoneId] : 20;
      var exposureNorm = FA.util.norm(r.population || s.population, cfg.normalize.population);
      var capabilityDeficit = FA.util.norm(shelterMin, W.svi.indicators.find(function (i) { return i.key === 'shelterAccessMin'; }).normalize);

      var components = {
        risk: FA.util.round(r.score, 4),
        exposure: FA.util.round(exposureNorm, 4),
        svi: FA.util.round(s.score, 4),
        capabilityDeficit: FA.util.round(capabilityDeficit, 4)
      };
      var score = cfg.weights.risk * components.risk +
        cfg.weights.exposure * components.exposure +
        cfg.weights.svi * components.svi +
        cfg.weights.capabilityDeficit * components.capabilityDeficit;

      var contributions = [
        { key: 'risk', label: '积水易发风险', weight: cfg.weights.risk, contribution: FA.util.round(cfg.weights.risk * components.risk, 4) },
        { key: 'svi', label: '社会脆弱性', weight: cfg.weights.svi, contribution: FA.util.round(cfg.weights.svi * components.svi, 4) },
        { key: 'exposure', label: '人口暴露', weight: cfg.weights.exposure, contribution: FA.util.round(cfg.weights.exposure * components.exposure, 4) },
        { key: 'capabilityDeficit', label: '应对能力不足', weight: cfg.weights.capabilityDeficit, contribution: FA.util.round(cfg.weights.capabilityDeficit * capabilityDeficit, 4) }
      ].sort(function (a, b) { return b.contribution - a.contribution; });

      return {
        zoneId: zoneId,
        name: r.name,
        alias: r.alias,
        riskLevel: r.level,
        riskLevelLabel: r.levelLabel,
        riskScore: FA.util.round(r.score, 3),
        sviLevel: s.level,
        sviLevelLabel: s.levelLabel,
        sviScore: FA.util.round(s.score, 3),
        population: r.population,
        priority: FA.util.round(score, 4),
        priorityPercent: FA.util.round(score * 100, 1),
        components: components,
        contributions: contributions,
        tag: (r.level === 'very-high' || r.level === 'high') && (s.level === 'very-high' || s.level === 'high')
          ? '高风险 × 高脆弱'
          : (r.level === 'low' || r.level === 'medium') && (s.level === 'very-high' || s.level === 'high')
            ? '风险一般 × 高脆弱'
            : (r.level === 'very-high' || r.level === 'high')
              ? '高风险 × 脆弱性一般'
              : '常规关注',
        explanation: '优先级 ' + FA.util.round(score * 100, 1) + '：主要由' + contributions[0].label + '（' + FA.util.round(contributions[0].contribution, 3) +
          '）与' + contributions[1].label + '（' + FA.util.round(contributions[1].contribution, 3) + '）构成'
      };
    });

    list.sort(function (a, b) { return b.priority - a.priority; });
    return {
      method: cfg.method,
      methodLabel: cfg.methodLabel,
      weights: cfg.weights,
      note: '这一步是「从哪里危险 → 谁更需要保护」的落点：同一危险度下，脆弱性高的网格会获得更高响应优先级。',
      zones: list
    };
  }

  /* ============================ 资源缺口 ============================ */
  /**
   * 判断当前应急保障能力与需求之差（Word 文档第四条第 3 点）。
   */
  function resourceGap(world) {
    var access = accessibility(world.zones, world.shelters, world.roads);
    var risk = riskByZone(world.zones, world.rainfallMm);
    var svi = sviByZone(world.zones, world.groups, access);
    var priority = priorityList(risk, svi, access);

    var openShelters = (world.shelters || []).filter(function (s) { return s.status === 'open'; });
    var vehicles = (world.vehicles || []).filter(function (v) { return v.status !== 'offline'; });
    var groups = world.groups || [];

    var demand = {
      groups: groups.length,
      people: FA.util.sum(groups, function (g) { return g.people; }),
      assisted: FA.util.sum(groups, function (g) { return g.assisted ? g.people : 0; }),
      wheelchair: FA.util.sum(groups, function (g) { return g.wheelchair || 0; }),
      highRiskPeople: FA.util.sum(groups, function (g) { return g.highRisk ? g.people : 0; })
    };

    var supply = {
      shelters: openShelters.length,
      shelterCapacity: FA.util.sum(openShelters, function (s) { return s.capacity; }),
      shelterWheelchair: FA.util.sum(openShelters, function (s) { return s.wheelchairSlots; }),
      shelterUsed: FA.util.sum(openShelters, function (s) { return s.occupied || 0; }),
      vehicles: vehicles.length,
      seats: FA.util.sum(vehicles, function (v) { return v.seats; }),
      wheelchairSeats: FA.util.sum(vehicles, function (v) { return v.wheelchairSlots; })
    };

    // 可达性缺口：需求方无法在合理时间内到达任何开放安置点
    var unreachableZones = (world.zones || []).filter(function (z) {
      var hasDemand = groups.some(function (g) { return g.zoneId === z.id; });
      return hasDemand && (access.shelterMinutes[z.id] == null);
    });

    var gaps = [];
    if (supply.shelterCapacity < demand.people) {
      gaps.push({ key: 'shelter-capacity', label: '安置容量缺口', demand: demand.people, supply: supply.shelterCapacity, unit: '人', severity: 'high', note: '开放安置点总容量小于需转移人数，需增开安置点或分批安置。' });
    }
    if (supply.seats < demand.people) {
      gaps.push({ key: 'seat', label: '运力座位缺口', demand: demand.people, supply: supply.seats, unit: '座', severity: 'high', note: '单车单趟条件下座位不足，需增援车辆或增加趟次。' });
    }
    if (supply.wheelchairSeats < demand.wheelchair) {
      gaps.push({ key: 'wheelchair', label: '无障碍运力缺口', demand: demand.wheelchair, supply: supply.wheelchairSeats, unit: '位', severity: 'very-high', note: '无障碍座位不足，需优先保障卧床与行动不便人员。' });
    }
    if (supply.shelterWheelchair < demand.wheelchair) {
      gaps.push({ key: 'shelter-wheelchair', label: '安置点无障碍容量缺口', demand: demand.wheelchair, supply: supply.shelterWheelchair, unit: '位', severity: 'high', note: '安置点无障碍位不足。' });
    }
    if (unreachableZones.length) {
      gaps.push({ key: 'access', label: '可达性缺口', demand: unreachableZones.length, supply: 0, unit: '个网格', severity: 'very-high', note: '存在有需求但无法通过开放路网到达任何安置点的网格：' + unreachableZones.map(function (z) { return z.name; }).join('、') + '。' });
    }
    var blockedRoads = (world.roads || []).filter(function (r) { return r.closed; });
    if (blockedRoads.length) {
      gaps.push({ key: 'road', label: '路网阻断', demand: blockedRoads.length, supply: 0, unit: '条', severity: 'medium', note: '阻断路段：' + blockedRoads.map(function (r) { return r.name; }).join('、') + '。' });
    }

    // 逐网格的接收能力
    var perZone = priority.zones.map(function (p) {
      var minutes = access.shelterMinutes[p.zoneId];
      return {
        zoneId: p.zoneId,
        name: p.name,
        priority: p.priority,
        priorityPercent: p.priorityPercent,
        tag: p.tag,
        shelterMinutes: minutes,
        shelterNearest: access.shelterNearest[p.zoneId],
        shelterLevel: minutes == null ? '不可达' : (minutes <= 6 ? '好' : minutes <= 12 ? '一般' : '偏弱'),
        groupPeople: FA.util.sum(groups.filter(function (g) { return g.zoneId === p.zoneId; }), function (g) { return g.people; })
      };
    }).sort(function (a, b) { return b.priority - a.priority; });

    return {
      demand: demand,
      supply: supply,
      gaps: gaps,
      gapCount: gaps.length,
      sufficient: gaps.length === 0,
      unreachableZones: unreachableZones.map(function (z) { return { zoneId: z.id, name: z.name }; }),
      perZone: perZone,
      access: access,
      risk: risk,
      svi: svi,
      priority: priority,
      note: gaps.length === 0
        ? '在当前演练设定下，安置容量、座位与无障碍位均可覆盖需求；这仅代表所列演练输入。'
        : '存在 ' + gaps.length + ' 项资源缺口，方案会明确保留缺口，不把部分方案宣称为全部解决。'
    };
  }

  FA.analytics = {
    riskByZone: riskByZone,
    sviByZone: sviByZone,
    priorityList: priorityList,
    accessibility: accessibility,
    resourceGap: resourceGap,
    dijkstra: dijkstra,
    buildAdjacency: buildAdjacency,
    pathFrom: pathFrom,
    pathToRoads: pathToRoads,
    sigmoid: sigmoid
  };
})(window.FA = window.FA || {});
