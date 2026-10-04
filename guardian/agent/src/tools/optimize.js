/*!
 * 城市韧性守护 Agent · 调度与推演工具组
 * ---------------------------------------------------------------
 * optimize_dispatch            生成人员转移与应急资源调度方案
 * explain_plan                 解释「为什么这样调度」
 * simulate_rainfall_scenario   80 / 120 / 160 mm 情景推演
 */
(function (FA) {
  'use strict';

  var DISCLAIMER = FA.data.region.disclaimer;

  /* ============================ 生成方案 ============================ */
  FA.tools.register({
    name: 'optimize_dispatch',
    label: '生成调度方案',
    group: '资源与调度',
    description: '在避难场所容量、车辆座位、无障碍位、开放路网与单车单趟的约束下，生成人员转移与安置点分配方案，并给出与「风险优先最近可行」基线在同一输入快照下的对比。算法为优先级贪心构造加有界局部搜索，不保证全局最优；必须保留未安排人员与缺口，不得把部分方案表述为全部解决。',
    parameters: {
      type: 'object',
      properties: {
        objective: { type: 'string', enum: ['risk_first', 'wait_min', 'balance'], description: '调度目标：risk_first 风险优先 / wait_min 等待最短 / balance 覆盖均衡' },
        rainfallMm: { type: 'number', minimum: 0, maximum: 500, description: '按指定累计雨量生成方案；省略则使用当前雨情' },
        maxIterations: { type: 'integer', minimum: 10, maximum: 2000, description: '局部搜索的最大评估次数，默认 600' }
      },
      required: []
    },
    mutates: true,
    handler: function (args) {
      var w = FA.store.world();
      if (args.rainfallMm != null) w.rainfallMm = args.rainfallMm;
      var plan = FA.optimizer.optimize(w, {
        objective: args.objective || 'risk_first',
        maxIterations: args.maxIterations
      });

      FA.store.patch({ plan: plan, risk: plan.analysis.risk, svi: plan.analysis.svi, priority: plan.analysis.priority }, {
        label: '已生成调度方案（' + plan.objectiveLabel + '）',
        detail: '已安排 ' + plan.metrics.servedPeople + '/' + plan.metrics.totalPeople + ' 人，未安排 ' + plan.metrics.unassignedPeople +
          ' 人，加权等待 ' + plan.metrics.weightedWait + ' 人·分钟；约束校验' + (plan.validation.ok ? '通过' : '未通过'),
        reason: 'plan'
      });

      return {
        ok: true,
        summary: '方案已生成（' + plan.objectiveLabel + '）：' + plan.metrics.vehicleCount + ' 辆车、' + plan.metrics.assignments.length +
          ' 条线路，已安排 ' + plan.metrics.servedPeople + '/' + plan.metrics.totalPeople + ' 人' +
          (plan.metrics.unassignedPeople ? '，仍有 ' + plan.metrics.unassignedPeople + ' 人未安排' : '，全部可安排') +
          '；加权等待 ' + plan.metrics.weightedWait + ' 人·分钟（基线 ' + plan.baseline.weightedWait + '）。',
        data: {
          planId: plan.id,
          objective: plan.objective,
          objectiveLabel: plan.objectiveLabel,
          algorithm: plan.algorithm,
          methodNote: plan.methodNote,
          rainfallMm: plan.rainfallMm,
          metrics: {
            servedPeople: plan.metrics.servedPeople,
            totalPeople: plan.metrics.totalPeople,
            unassignedPeople: plan.metrics.unassignedPeople,
            weightedWait: plan.metrics.weightedWait,
            priorityWait: plan.metrics.priorityWait,
            assistedWait: plan.metrics.assistedWait,
            urgentWait: plan.metrics.urgentWait,
            finishMinute: plan.metrics.finishMinute,
            driveMinutes: plan.metrics.driveMinutes,
            complete: plan.metrics.complete,
            coverage: plan.metrics.coverage,
            urgencyCoverage: plan.metrics.urgencyCoverage,
            idleVehicles: plan.metrics.idleVehicles
          },
          assignments: plan.assignments,
          shelterLoad: plan.shelterLoad,
          unassigned: plan.unassigned,
          explanations: plan.explanations,
          comparison: {
            note: plan.comparison.note,
            metrics: plan.comparison.metrics,
            priorityWait: plan.comparison.priorityWait,
            rows: plan.comparison.rows
          },
          baselineAlgorithm: plan.baseline.algorithm,
          validation: plan.validation,
          search: plan.search,
          elapsedMs: plan.elapsedMs
        },
        actions: [
          FA.actions.factory.createTasks(),
          FA.actions.factory.why(),
          FA.actions.make({
            label: '换「等待最短」重算',
            kind: 'tool',
            tool: 'optimize_dispatch',
            args: { objective: 'wait_min' },
            group: '资源与调度',
            hint: '同一输入快照下换目标函数重算，用于现场对比不同调度口径'
          }),
          FA.actions.factory.report()
        ],
        warnings: [
          DISCLAIMER.short,
          plan.methodNote,
          plan.validation.ok ? '约束校验通过。' : '约束校验未通过：' + plan.validation.errors.join('；'),
          '对比基线为明示规则的模拟策略，不代表人工调度实测。'
        ].concat(plan.metrics.unassignedPeople ? ['仍有 ' + plan.metrics.unassignedPeople + ' 人未安排，已如实保留缺口，需增援或另行组织。'] : [])
      };
    }
  });

  /* ============================ 解释方案 ============================ */
  FA.tools.register({
    name: 'explain_plan',
    label: '解释调度方案',
    group: '资源与调度',
    description: '解释当前调度方案「为什么这样调度」：每条线路的组序依据、安置点选择理由、起约束作用的资源、未安排人员的具体原因，以及与基线的差异。用于回答「为什么这样调度」，并提供可追溯依据。',
    parameters: {
      type: 'object',
      properties: {
        vehicleId: { type: 'string', description: '只解释某一辆车，例如 V1' },
        topN: { type: 'integer', minimum: 1, maximum: 20, description: '最多解释多少条安排，默认 6' }
      },
      required: []
    },
    mutates: false,
    handler: function (args) {
      var s = FA.store.raw();
      var plan = s.plan;
      if (!plan) {
        return {
          ok: false,
          summary: '当前还没有调度方案，先让我生成一版方案再解释。',
          actions: [FA.actions.factory.optimize()],
          warnings: ['没有方案时不做「事后解释」，避免编造依据。']
        };
      }

      var access = plan.analysis.access;
      var vehicleMap = {};
      s.vehicles.forEach(function (v) { vehicleMap[v.id] = v; });

      var assignments = plan.assignments.filter(function (a) {
        return !args.vehicleId || a.vehicleId === args.vehicleId;
      }).slice(0, args.topN || 6);

      // 起约束作用的资源：把容量/座位/无障碍位用满的项挑出来
      var binding = [];
      Object.keys(plan.shelterLoad).forEach(function (sid) {
        var load = plan.shelterLoad[sid];
        if (load.capacity && load.people >= load.capacity) binding.push(load.name + ' 安置容量已用满（' + load.people + '/' + load.capacity + '）');
        if (load.wheelchair > 0 && s.shelters.find(function (x) { return x.id === sid; })) {
          var sh = s.shelters.find(function (x) { return x.id === sid; });
          if (load.wheelchair >= sh.wheelchairSlots) binding.push(sh.name + ' 无障碍位已用满（' + load.wheelchair + '/' + sh.wheelchairSlots + '）');
        }
      });
      Object.keys(vehicleMap).forEach(function (vid) {
        var v = vehicleMap[vid];
        var a = plan.assignments.find(function (x) { return x.vehicleId === vid; });
        if (!a) return;
        if (a.people >= v.seats) binding.push(v.name + ' 座位已用满（' + a.people + '/' + v.seats + '）');
        if (v.wheelchairSlots && a.wheelchair >= v.wheelchairSlots) binding.push(v.name + ' 无障碍位已用满（' + a.wheelchair + '/' + v.wheelchairSlots + '）');
      });

      var reasons = assignments.map(function (a) {
        var v = vehicleMap[a.vehicleId] || {};
        var chain = a.stops.map(function (st) {
          return {
            groupId: st.groupId,
            groupName: st.groupName,
            zoneId: st.zoneId,
            people: st.people,
            urgency: st.urgency,
            pickupMinute: st.pickupMinute,
            why: '优先级紧迫度 ' + st.urgency +
              (st.highRisk ? '、属高风险' : '') +
              (st.assisted ? '、需协助' : '') +
              (st.wheelchair ? '、需无障碍位' : '') +
              '；从上一站到本站追加 ' + (st.pickupMinute) + ' 分钟累计车程'
          };
        });
        return {
          vehicleId: a.vehicleId,
          vehicleName: a.vehicleName,
          vehicleType: v.type,
          seats: v.seats,
          load: a.people + '/' + v.seats,
          wheelchair: a.wheelchair + '/' + (v.wheelchairSlots || 0),
          shelterId: a.shelterId,
          shelterName: a.shelterName,
          shelterWhy: '在容量允许的开放安置点中选择「最后接人点 → 安置点」行驶时间最短者（' +
            (a.legs && a.legs.length ? a.legs[a.legs.length - 1].minutes : 0) + ' 分钟）',
          order: a.stops.map(function (st) { return st.zoneId; }),
          finishMinute: a.finishMinute,
          driveMinutes: a.driveMinutes,
          legs: a.legs,
          chain: chain
        };
      });

      var deltas = Object.keys(plan.comparison.metrics).map(function (k) {
        var m = plan.comparison.metrics[k];
        return { key: k, baseline: m.baseline, optimized: m.optimized, unit: m.unit, delta: FA.util.round(m.optimized - m.baseline, 2) };
      });

      return {
        ok: true,
        summary: '共 ' + plan.assignments.length + ' 条线路。规则是：先按「风险 × 脆弱性」紧迫度排序接人，插入位置取追加车程最小者，' +
          '安置点在容量允许下取行驶时间最短者，最后用有界局部搜索压低整体等待。' +
          (binding.length ? '当前起约束作用的是：' + binding.slice(0, 3).join('；') + '。' : ''),
        data: {
          planId: plan.id,
          objective: plan.objective,
          objectiveLabel: plan.objectiveLabel,
          algorithm: plan.algorithm,
          methodNote: plan.methodNote,
          rules: [
            '人员分组按「网格应急响应优先级 + 高风险 + 需协助 + 无障碍需求」计算紧迫度',
            '紧迫度高者优先接入车辆线路，插入位置取追加车程最小的位置',
            '车辆载量受座位与无障碍位双重约束，超载即不可行',
            '安置点在剩余容量允许的开放安置点中选择行驶时间最短者',
            '构造完成后用有界局部搜索（插入 / 换位 / 跨车移动 / 跨车交换）继续改进',
            '全程只使用开放路段；单车单趟，未安排人员如实保留'
          ],
          reasons: reasons,
          bindingConstraints: binding,
          unassigned: plan.explanations || plan.unassigned,
          baselineComparison: {
            note: plan.comparison.note,
            deltas: deltas,
            priorityWait: plan.comparison.priorityWait
          },
          search: plan.search,
          validation: plan.validation
        },
        actions: [
          FA.actions.factory.createTasks(),
          FA.actions.factory.report(),
          FA.actions.make({
            label: '看调度路径',
            kind: 'view',
            args: { view: 'monitor-map', layer: 'routes' },
            group: '查看',
            hint: '在左栏实时监控中叠加车辆线路与接人顺序'
          })
        ],
        warnings: [
          plan.methodNote,
          '解释来自算法自身的约束与目标函数，不是事后编造的理由；算法不保证全局最优。'
        ]
      };
    }
  });

  /* ============================ 情景推演 ============================ */
  FA.tools.register({
    name: 'simulate_rainfall_scenario',
    label: '降雨情景推演',
    group: '情景推演',
    description: '在同一输入快照下，按多档累计雨量（默认 80 / 120 / 160 毫米、未来 6 小时）分别重算积水易发风险、受影响人口、脆弱人口、资源缺口与调度方案，回答「如果雨继续下怎么办」。推演结果是演练设定下的 what-if 计算，不是天气预报。',
    parameters: {
      type: 'object',
      properties: {
        steps: { type: 'array', maxItems: 6, description: '雨量档位（毫米），默认 [80,120,160]' },
        objective: { type: 'string', enum: ['risk_first', 'wait_min', 'balance'], description: '调度目标，默认 risk_first' },
        maxIterations: { type: 'integer', minimum: 10, maximum: 2000, description: '每个情景的局部搜索上限，默认 400 以控制推演耗时' }
      },
      required: []
    },
    mutates: true,
    handler: function (args) {
      var w = FA.store.world();
      var steps = (args.steps && args.steps.length ? args.steps : FA.data.region.demo.scenarioStepsMm).slice();
      steps = steps.map(function (x) { return Number(x); }).filter(function (x) { return isFinite(x) && x >= 0; }).sort(function (a, b) { return a - b; });
      if (!steps.length) return { ok: false, summary: '雨量档位无效', warnings: ['请给出至少一个非负雨量值'] };

      var objective = args.objective || 'risk_first';
      var maxIterations = args.maxIterations || 400;

      var results = steps.map(function (mm) {
        var scenarioWorld = Object.assign({}, w, { rainfallMm: mm });
        var gap = FA.analytics.resourceGap(scenarioWorld);
        var plan = FA.optimizer.optimize(scenarioWorld, { objective: objective, maxIterations: maxIterations });

        var highZones = gap.risk.zones.filter(function (z) { return z.level === 'high' || z.level === 'very-high'; });
        var exposed = FA.util.sum(highZones.map(function (z) {
          return scenarioWorld.zones.find(function (x) { return x.id === z.zoneId; });
        }), function (z) { return z ? z.population : 0; });
        var vulnerable = FA.util.sum(highZones.map(function (z) {
          return scenarioWorld.zones.find(function (x) { return x.id === z.zoneId; });
        }), function (z) { return z ? Math.round(z.population * (z.elderlyRatio + z.childRatio)) : 0; });
        var assisted = FA.util.sum(highZones.map(function (z) {
          return scenarioWorld.zones.find(function (x) { return x.id === z.zoneId; });
        }), function (z) { return z ? z.assisted : 0; });

        return {
          rainfallMm: mm,
          horizonHours: w.horizonHours,
          riskHighZoneCount: highZones.length,
          riskHighZones: highZones.map(function (z) { return { zoneId: z.zoneId, name: z.name, percent: z.percent, levelLabel: z.levelLabel }; }),
          exposedPopulation: exposed,
          vulnerablePopulation: vulnerable,
          assistedPopulation: assisted,
          gapCount: gap.gapCount,
          gaps: gap.gaps.map(function (g) { return { label: g.label, demand: g.demand, supply: g.supply, unit: g.unit, severity: g.severity }; }),
          unreachableZones: gap.unreachableZones,
          dispatch: {
            servedPeople: plan.metrics.servedPeople,
            totalPeople: plan.metrics.totalPeople,
            unassignedPeople: plan.metrics.unassignedPeople,
            weightedWait: plan.metrics.weightedWait,
            finishMinute: plan.metrics.finishMinute,
            complete: plan.metrics.complete,
            coverage: plan.metrics.coverage
          },
          validation: plan.validation
        };
      });

      // 相邻档位的边际变化，便于口播「雨再大 40 毫米会怎样」
      for (var i = 1; i < results.length; i++) {
        results[i].deltaVsPrevious = {
          rainfallMm: results[i].rainfallMm - results[i - 1].rainfallMm,
          riskHighZoneCount: results[i].riskHighZoneCount - results[i - 1].riskHighZoneCount,
          exposedPopulation: results[i].exposedPopulation - results[i - 1].exposedPopulation,
          vulnerablePopulation: results[i].vulnerablePopulation - results[i - 1].vulnerablePopulation,
          gapCount: results[i].gapCount - results[i - 1].gapCount,
          unassignedPeople: results[i].dispatch.unassignedPeople - results[i - 1].dispatch.unassignedPeople
        };
      }

      var first = results[0], last = results[results.length - 1];
      var margin = {
        fromMm: first.rainfallMm,
        toMm: last.rainfallMm,
        riskHighZoneDelta: last.riskHighZoneCount - first.riskHighZoneCount,
        exposedDelta: last.exposedPopulation - first.exposedPopulation,
        vulnerableDelta: last.vulnerablePopulation - first.vulnerablePopulation,
        gapDelta: last.gapCount - first.gapCount,
        unassignedDelta: last.dispatch.unassignedPeople - first.dispatch.unassignedPeople
      };

      FA.store.patch({ scenarioMatrix: { at: FA.util.nowIso(), objective: objective, steps: steps, results: results, margin: margin } }, {
        label: '完成 ' + steps.join(' / ') + ' mm 情景推演',
        detail: '从 ' + first.rainfallMm + ' 到 ' + last.rainfallMm + ' mm：高风险网格 ' + first.riskHighZoneCount + ' → ' + last.riskHighZoneCount +
          '，未安排人员 ' + first.dispatch.unassignedPeople + ' → ' + last.dispatch.unassignedPeople,
        reason: 'scenario'
      });

      return {
        ok: true,
        summary: '情景推演完成：雨量从 ' + first.rainfallMm + ' 加到 ' + last.rainfallMm + ' mm 时，高风险网格由 ' + first.riskHighZoneCount +
          ' 增至 ' + last.riskHighZoneCount + '，受影响人口由 ' + first.exposedPopulation + ' 增至 ' + last.exposedPopulation +
          '，未安排人员由 ' + first.dispatch.unassignedPeople + ' 变为 ' + last.dispatch.unassignedPeople + ' 人。',
        data: {
          objective: objective,
          steps: steps,
          horizonHours: w.horizonHours,
          results: results,
          margin: margin,
          methodNote: '同一输入快照下按不同雨量分别重算风险模型与调度算法；每档均为演练设定下的 what-if 计算，不是天气预报，也不代表真实灾情。'
        },
        actions: [
          FA.actions.factory.report(),
          FA.actions.make({
            label: '按 160 mm 生成方案',
            kind: 'scenario',
            args: { scenarioId: 'rain-160' },
            tone: 'primary',
            group: '情景推演',
            hint: '把演练情景切到 160 mm 并重新研判'
          }),
          FA.actions.factory.rag('强降雨 人员转移 优先顺序')
        ],
        warnings: [
          '推演为 what-if 计算，不是雨情预报；受影响人口基于演练设定的人口与脆弱性口径。',
          margin.unassignedDelta > 0 ? '雨量增大后未安排人员增加 ' + margin.unassignedDelta + ' 人，说明现有资源不足以覆盖该情景，需提前准备增援。' : '在当前演练设定下，各档雨量的未安排人数未进一步恶化。'
        ]
      };
    }
  });
})(window.FA = window.FA || {});
