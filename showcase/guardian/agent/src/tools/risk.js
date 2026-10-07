/*!
 * 城市韧性守护 Agent · 风险与脆弱性工具组
 * ---------------------------------------------------------------
 * get_weather_nowcast        雨情实况/短临（彩云 / 腾讯适配器，未配置密钥时用演练口播）
 * assess_flood_risk          积水易发风险评估（可解释因子贡献）
 * compute_social_vulnerability  社会脆弱性指数 SVI
 * analyze_accessibility      路网与安置点可达性
 * identify_priority_groups   高风险 × 高脆弱 的优先保障群体
 * analyze_resource_gap       应急保障能力与资源缺口
 */
(function (FA) {
  'use strict';

  var DISCLAIMER = FA.data.region.disclaimer;

  /* ============================ 雨情适配器 ============================ */
  /**
   * 对应会议纪要「天气数据：彩云天气免费版 或 腾讯位置服务免费体验包」。
   * 默认 provider='offline'：不联网，直接使用演练口播雨量，
   * 保证现场断网、未配置密钥、额度用尽时演示都不失败。
   * 拿到密钥后只需填写 config 并置 allowNetwork=true。
   */
  FA.weather = {
    config: {
      provider: 'offline',      // offline | caiyun | tencent
      caiyunToken: '',          // 预留：彩云天气令牌（免费版）
      tencentKey: '',           // 预留：腾讯位置服务 Key（免费体验包）
      allowNetwork: false,      // 安全默认：不主动联网
      timeoutMs: 8000,
      endpoint: {
        caiyun: 'https://api.caiyunapp.com/v2.6/',
        tencent: 'https://apis.map.qq.com/ws/weather/v1/'
      }
    },

    /** 是否具备联网取数条件 */
    online: function () {
      var c = this.config;
      if (!c.allowNetwork) return false;
      if (c.provider === 'caiyun') return !!c.caiyunToken;
      if (c.provider === 'tencent') return !!c.tencentKey;
      return false;
    },

    /**
     * 取雨情。返回 { ok, source, rainfallMm, horizonHours, note, raw? }
     * 绝不抛错：联网失败一律回落离线口播数据，并在 note 中说明。
     */
    nowcast: function (opts) {
      opts = opts || {};
      var s = FA.store.raw();
      var offline = {
        ok: true,
        source: 'offline-oral',
        sourceLabel: '演练口播数据（离线）',
        rainfallMm: s.rainfallMm,
        horizonHours: opts.horizonHours || s.horizonHours,
        timeline: (s.rainfallTimeline || []).slice(-12),
        note: '未配置或未启用在线天气数据源，使用演练口播雨量与情景设定值。',
        adapterReady: {
          caiyun: '已预留：填入 caiyunToken 并把 allowNetwork 置为 true 即可切换到彩云天气免费版。',
          tencent: '已预留：填入 tencentKey 并把 provider 置为 tencent 即可切换到腾讯位置服务免费体验包。'
        }
      };

      if (!this.online()) return offline;

      var self = this;
      var c = this.config;
      var url = null;
      if (c.provider === 'caiyun') {
        url = c.endpoint.caiyun + c.caiyunToken + '/' + (opts.lng || 120.65) + ',' + (opts.lat || 27.78) + '/realtime';
      } else if (c.provider === 'tencent') {
        url = c.endpoint.tencent + '?' + 'location=' + (opts.lat || 27.78) + ',' + (opts.lng || 120.65) + '&key=' + c.tencentKey;
      }
      if (!url) return offline;

      // 有网时返回 Promise；失败回落离线数据并如实说明
      if (typeof fetch !== 'function') {
        offline.note = '当前环境没有 fetch，无法联网取数，已回落演练口播数据。';
        return offline;
      }
      return fetch(url, { signal: (typeof AbortController === 'function') ? new AbortController().signal : undefined })
        .then(function (r) { return r.json(); })
        .then(function (json) {
          var mm = null;
          try {
            if (c.provider === 'caiyun') mm = json.result.realtime.precipitation.local.intensity;
            else mm = json.result.realtime.precipitation;
          } catch (e) { mm = null; }
          if (mm == null || !isFinite(Number(mm))) {
            return Object.assign({}, offline, { note: '在线数据源返回结构无法解析，已回落演练口播数据。' });
          }
          return {
            ok: true,
            source: c.provider,
            sourceLabel: (c.provider === 'caiyun' ? '彩云天气' : '腾讯位置服务') + '（在线）',
            rainfallMm: FA.util.round(Number(mm), 1),
            horizonHours: opts.horizonHours || s.horizonHours,
            timeline: (s.rainfallTimeline || []).slice(-12),
            note: '实时降水强度来自在线数据源，累计雨量口径与演练情景可能不同，需人工复核。',
            raw: json
          };
        })
        .catch(function (err) {
          return Object.assign({}, offline, { note: '在线取数失败（' + String(err && err.message || err) + '），已回落演练口播数据。' });
        });
    }
  };

  /* ============================ 工具：雨情 ============================ */
  FA.tools.register({
    name: 'get_weather_nowcast',
    label: '获取雨情实况与短临',
    group: '风险研判',
    description: '获取当前雨情实况与未来短临雨量，作为积水易发风险评估的输入。未配置在线天气数据源时使用演练口播数据，并会明确说明数据来源。在开始任何风险研判之前应先调用本工具确定雨量口径。',
    parameters: {
      type: 'object',
      properties: {
        horizonHours: { type: 'number', minimum: 1, maximum: 24, description: '预报时长（小时）' }
      },
      required: []
    },
    mutates: false,
    handler: function (args) {
      var res = FA.weather.nowcast({ horizonHours: args.horizonHours });
      var finish = function (r) {
        var s = FA.store.raw();
        return {
          ok: r.ok,
          summary: '当前累计雨量 ' + r.rainfallMm + ' mm（' + r.sourceLabel + '），未来 ' + r.horizonHours + ' 小时为预报窗口。',
          data: {
            rainfallMm: r.rainfallMm,
            horizonHours: r.horizonHours,
            source: r.source,
            sourceLabel: r.sourceLabel,
            timeline: r.timeline,
            note: r.note,
            scenarioRainfallMm: FA.data.region.demo.scenarioRainfallMm,
            pendingRainfallDeltaMm: s.pendingChanges.rainfallDeltaMm
          },
          actions: [
            FA.actions.factory.assess(),
            FA.actions.factory.advanceRain(FA.data.region.demo.rainfallStepMm),
            FA.actions.factory.scenario()
          ],
          warnings: [DISCLAIMER.short]
        };
      };
      if (res && typeof res.then === 'function') return res.then(finish);
      return finish(res);
    }
  });

  /* ============================ 工具：风险评估 ============================ */
  FA.tools.register({
    name: 'assess_flood_risk',
    label: '积水易发风险评估',
    group: '风险研判',
    description: '按给定累计雨量评估各网格的积水易发风险等级，并给出每个网格风险高低的因子贡献度分解（可解释）。这是加权 Logistic 代理模型，不是水动力仿真，不预测具体水深。输出风险等级为 低/中/高/极高。',
    parameters: {
      type: 'object',
      properties: {
        rainfallMm: { type: 'number', minimum: 0, maximum: 500, description: '累计雨量（毫米）；省略则使用当前雨情' },
        topN: { type: 'integer', minimum: 1, maximum: 10, description: '返回风险最高的前 N 个网格，默认 5' }
      },
      required: []
    },
    mutates: true,
    handler: function (args) {
      var w = FA.store.world();
      var mm = (args.rainfallMm == null) ? w.rainfallMm : args.rainfallMm;
      var risk = FA.analytics.riskByZone(w.zones, mm);
      var topN = args.topN || 5;
      var top = risk.zones.slice(0, topN);
      var high = risk.zones.filter(function (z) { return z.level === 'high' || z.level === 'very-high'; });

      FA.store.patch({ risk: risk }, {
        label: '完成积水易发风险评估（' + mm + ' mm）',
        detail: '高风险及以上网格 ' + high.length + ' 个；方法：' + risk.methodLabel,
        reason: 'risk'
      });

      return {
        ok: true,
        summary: '在累计雨量 ' + mm + ' mm 下，' + high.length + ' 个网格达到高风险及以上；最高为 ' + top[0].name +
          '（' + top[0].percent + '%，' + top[0].levelLabel + '）。',
        data: {
          rainfallMm: mm,
          method: risk.method,
          methodLabel: risk.methodLabel,
          methodNote: risk.methodNote,
          highRiskCount: high.length,
          zones: risk.zones,
          top: top
        },
        actions: [
          FA.actions.factory.priority(),
          FA.actions.factory.gap(),
          FA.actions.factory.optimize(),
          FA.actions.make({
            label: '看风险地图',
            kind: 'view',
            args: { view: 'monitor-map' },
            group: '查看',
            hint: '在左栏实时监控中叠加风险分层'
          })
        ],
        warnings: [
          DISCLAIMER.short,
          '本结果为「积水易发风险」评估，不是对具体路段积水深度的预测；主因：' + top[0].explanation + '。'
        ]
      };
    }
  });

  /* ============================ 工具：社会脆弱性 ============================ */
  FA.tools.register({
    name: 'compute_social_vulnerability',
    label: '社会脆弱性指数 SVI',
    group: '风险研判',
    description: '计算各网格的社会脆弱性指数（SVI）：老龄人口占比、儿童占比、需协助人员占比、医疗可达时间、避难点可达时间五项指标加权合成。用于回答「谁更需要优先保护」，与积水风险相互独立。',
    parameters: {
      type: 'object',
      properties: {
        topN: { type: 'integer', minimum: 1, maximum: 10, description: '返回脆弱性最高的前 N 个网格，默认 5' }
      },
      required: []
    },
    mutates: true,
    handler: function (args) {
      var w = FA.store.world();
      var access = FA.store.raw().access || FA.analytics.accessibility(w.zones, w.shelters, w.roads);
      var svi = FA.analytics.sviByZone(w.zones, w.groups, access);
      var top = svi.zones.slice(0, args.topN || 5);

      FA.store.patch({ svi: svi, access: access }, {
        label: '完成社会脆弱性分析',
        detail: '最高脆弱网格：' + top[0].name + '（' + top[0].percent + '%）',
        reason: 'svi'
      });

      return {
        ok: true,
        summary: '社会脆弱性最高的是 ' + top[0].name + '（' + top[0].percent + '%，' + top[0].levelLabel + '），主因：' + top[0].explanation + '。',
        data: {
          method: svi.method,
          methodLabel: svi.methodLabel,
          methodNote: svi.methodNote,
          indicators: svi.indicators,
          zones: svi.zones,
          top: top
        },
        actions: [
          FA.actions.factory.priority(),
          FA.actions.factory.assess(),
          FA.actions.factory.optimize()
        ],
        warnings: [
          '脆弱性指标为演练设定口径，指标与权重外置可审计；不代表对真实社区的评价。'
        ]
      };
    }
  });

  /* ============================ 工具：可达性 ============================ */
  FA.tools.register({
    name: 'analyze_accessibility',
    label: '路网与安置点可达性分析',
    group: '地理分析',
    description: '基于演练路网计算各网格到最近开放安置点的最短行驶时间，识别不可达网格与阻断路段。只使用当前开放路段；不可达网格必须作为缺口报出，不得静默丢弃。',
    parameters: {
      type: 'object',
      properties: {
        zoneId: { type: 'string', description: '仅查询某个网格到各安置点的可达时间' },
        topN: { type: 'integer', minimum: 1, maximum: 10, description: '返回可达性最差的网格数量，默认 5' }
      },
      required: []
    },
    mutates: true,
    handler: function (args) {
      var w = FA.store.world();
      var access = FA.analytics.accessibility(w.zones, w.shelters, w.roads);

      var detail = null;
      if (args.zoneId) {
        var zone = w.zones.find(function (z) { return z.id === args.zoneId; });
        if (!zone) return { ok: false, summary: '未找到网格 ' + args.zoneId, warnings: ['可用网格：' + w.zones.map(function (z) { return z.id; }).join('、')] };
        var times = w.shelters.filter(function (s) { return s.status === 'open'; }).map(function (s) {
          var t = access.matrix[zone.id] ? access.matrix[zone.id][s.zoneId] : Infinity;
          return { shelterId: s.id, name: s.name, minutes: isFinite(t) ? t : null, reachable: isFinite(t) };
        }).sort(function (a, b) { return (a.minutes == null ? 1e9 : a.minutes) - (b.minutes == null ? 1e9 : b.minutes); });
        detail = { zoneId: zone.id, zoneName: zone.name, alias: zone.alias, shelters: times };
      }

      var worst = w.zones.map(function (z) {
        var t = access.shelterMinutes[z.id];
        return { zoneId: z.id, name: z.name, alias: z.alias, shelterMinutes: t, reachable: t != null };
      }).sort(function (a, b) {
        var av = a.shelterMinutes == null ? 1e9 : a.shelterMinutes;
        var bv = b.shelterMinutes == null ? 1e9 : b.shelterMinutes;
        return bv - av;
      }).slice(0, args.topN || 5);

      FA.store.patch({ access: access }, {
        label: '完成路网可达性分析',
        detail: '开放路段 ' + access.openRoadCount + ' 条；不可达网格 ' + access.unreachable.length + ' 个',
        reason: 'access'
      });

      return {
        ok: true,
        summary: access.unreachable.length
          ? '开放路段 ' + access.openRoadCount + ' 条；有 ' + access.unreachable.length + ' 个网格当前无法到达任何开放安置点，已列为可达性缺口。'
          : '开放路段 ' + access.openRoadCount + ' 条；所有有需求的网格均可到达至少一个开放安置点，最远 ' + (worst[0].shelterMinutes) + ' 分钟。',
        data: {
          openRoadCount: access.openRoadCount,
          closedRoadIds: access.closedRoadIds,
          closedRoads: w.roads.filter(function (r) { return r.closed; }).map(function (r) { return { id: r.id, name: r.name, from: r.from, to: r.to }; }),
          unreachable: access.unreachable,
          worst: worst,
          detail: detail,
          matrix: args.zoneId ? access.matrix : undefined
        },
        actions: [
          FA.actions.factory.gap(),
          FA.actions.factory.optimize(),
          FA.actions.make({
            label: '在地图上标注阻断路段',
            kind: 'view',
            args: { view: 'monitor-map', layer: 'roads' },
            group: '查看'
          })
        ],
        warnings: [
          '路网为演练设定路网，仅代表几何与设定的行驶时间，不代表实时通行状况。',
          '地图展示须使用合规底图；本演示不加载任何在线底图。'
        ]
      };
    }
  });

  /* ============================ 工具：优先保障群体 ============================ */
  FA.tools.register({
    name: 'identify_priority_groups',
    label: '识别优先保障群体',
    group: '风险研判',
    description: '把积水易发风险、人口暴露、社会脆弱性与应对能力加权合成应急响应优先级，并列出高风险×高脆弱网格中需要优先保护的具体人员组（老人、儿童、需协助人员）。这是回答「谁更需要优先保护」的工具。',
    parameters: {
      type: 'object',
      properties: {
        topN: { type: 'integer', minimum: 1, maximum: 10, description: '返回优先级最高的前 N 个网格，默认 5' },
        minPriority: { type: 'number', minimum: 0, maximum: 1, description: '只返回优先级不低于该值的网格，默认 0.5' }
      },
      required: []
    },
    mutates: true,
    handler: function (args) {
      var w = FA.store.world();
      var s = FA.store.raw();
      var access = s.access || FA.analytics.accessibility(w.zones, w.shelters, w.roads);
      var risk = s.risk || FA.analytics.riskByZone(w.zones, w.rainfallMm);
      var svi = s.svi || FA.analytics.sviByZone(w.zones, w.groups, access);
      var priority = FA.analytics.priorityList(risk, svi, access);

      var minPriority = args.minPriority == null ? 0.5 : args.minPriority;
      var selected = priority.zones.filter(function (z) { return z.priority >= minPriority; }).slice(0, args.topN || 5);

      // 这些网格里的具体人员组
      var priorityGroups = [];
      selected.forEach(function (p) {
        w.groups.filter(function (g) { return g.zoneId === p.zoneId; }).forEach(function (g) {
          priorityGroups.push({
            id: g.id, name: g.name, zoneId: g.zoneId, zoneName: p.name, people: g.people,
            elderly: g.elderly, child: g.child, assisted: !!g.assisted, wheelchair: g.wheelchair || 0,
            highRisk: !!g.highRisk, tag: p.tag, priority: p.priority, note: g.note
          });
        });
      });
      priorityGroups.sort(function (a, b) { return (b.priority - a.priority) || (b.people - a.people); });

      var vulnerablePeople = FA.util.sum(priorityGroups, function (g) { return g.people; });
      var assistedPeople = FA.util.sum(priorityGroups, function (g) { return g.assisted ? g.people : 0; });
      var wheelchairCount = FA.util.sum(priorityGroups, function (g) { return g.wheelchair; });

      FA.store.patch({ priority: priority, risk: risk, svi: svi, access: access }, {
        label: '完成应急响应优先级排序',
        detail: '达到优先级 ' + minPriority + ' 的网格 ' + selected.length + ' 个，涉及 ' + priorityGroups.length + ' 组共 ' + vulnerablePeople + ' 人',
        reason: 'priority'
      });

      return {
        ok: true,
        summary: '优先保障 ' + selected.length + ' 个网格、' + priorityGroups.length + ' 组共 ' + vulnerablePeople +
          ' 人；其中需协助 ' + assistedPeople + ' 人、无障碍 ' + wheelchairCount + ' 位。最高优先级：' + (selected[0] ? selected[0].name + '（' + selected[0].priorityPercent + '，' + selected[0].tag + '）' : '无') + '。',
        data: {
          method: priority.method,
          methodLabel: priority.methodLabel,
          note: priority.note,
          weights: priority.weights,
          minPriority: minPriority,
          zones: priority.zones,
          selected: selected,
          groups: priorityGroups,
          totals: {
            zones: selected.length,
            groups: priorityGroups.length,
            people: vulnerablePeople,
            assistedPeople: assistedPeople,
            wheelchair: wheelchairCount,
            elderly: FA.util.sum(priorityGroups, function (g) { return g.elderly || 0; }),
            child: FA.util.sum(priorityGroups, function (g) { return g.child || 0; })
          }
        },
        actions: [
          FA.actions.factory.gap(),
          FA.actions.factory.optimize(),
          FA.actions.factory.why()
        ],
        warnings: [
          '优先级为「灾害风险 + 人口暴露 + 社会脆弱性 + 应对能力」的加权合成结果，权重外置可调；同一危险度下脆弱性高的网格会获得更高优先级。'
        ]
      };
    }
  });

  /* ============================ 工具：资源缺口 ============================ */
  FA.tools.register({
    name: 'analyze_resource_gap',
    label: '核查应急资源缺口',
    group: '资源与调度',
    description: '对照避难场所容量、车辆座位、无障碍位、路网可达性与人员需求，计算当前应急保障能力与需求之差，列出安置容量、运力座位、无障碍运力、可达性、路网阻断等缺口。用于回答「现有应急资源是否充足」。',
    parameters: { type: 'object', properties: {}, required: [] },
    mutates: true,
    handler: function () {
      var w = FA.store.world();
      var gap = FA.analytics.resourceGap(w);

      FA.store.patch({ resourceGap: { demand: gap.demand, supply: gap.supply, gaps: gap.gaps, perZone: gap.perZone }, risk: gap.risk, svi: gap.svi, priority: gap.priority, access: gap.access }, {
        label: '完成应急保障能力核查',
        detail: gap.sufficient ? '在当前演练设定下未发现缺口' : '发现 ' + gap.gapCount + ' 项资源缺口',
        reason: 'resourceGap'
      });

      var lines = gap.gaps.map(function (g) { return g.label + '（需求 ' + g.demand + ' / 能力 ' + g.supply + ' ' + g.unit + '）'; });

      return {
        ok: true,
        summary: gap.sufficient
          ? '需求 ' + gap.demand.people + ' 人，安置容量 ' + gap.supply.shelterCapacity + ' 人、座位 ' + gap.supply.seats + ' 座，当前演练设定下未发现缺口。'
          : '需求 ' + gap.demand.people + ' 人，安置容量 ' + gap.supply.shelterCapacity + ' 人、座位 ' + gap.supply.seats + ' 座；发现 ' + gap.gapCount + ' 项缺口：' + lines.join('；') + '。',
        data: {
          demand: gap.demand,
          supply: gap.supply,
          gaps: gap.gaps,
          gapCount: gap.gapCount,
          sufficient: gap.sufficient,
          unreachableZones: gap.unreachableZones,
          perZone: gap.perZone,
          note: gap.note
        },
        actions: [
          FA.actions.factory.optimize(),
          FA.actions.factory.rag('应急物资 调拨 安置点 容量'),
          FA.actions.factory.report()
        ],
        warnings: gap.unreachableZones.length
          ? ['存在不可达网格，任何「已全部覆盖」的表述都不成立。']
          : []
      };
    }
  });
})(window.FA = window.FA || {});
