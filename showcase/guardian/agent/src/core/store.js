/*!
 * 城市韧性守护 Agent · 状态仓库
 * ---------------------------------------------------------------
 * 唯一真相源（single source of truth）。左栏实时监控与右栏规划发布
 * 读的是同一份 state，因此「智能体改状态 → 两个栏位同时变」是天然成立的，
 * 不需要任何额外的消息同步逻辑。
 *
 * 设计要点：
 *   1. 所有写操作走 patch()，每次写入都留痕（trace），可追溯。
 *   2. 风险 / SVI / 可达性 / 优先级 / 方案 都是「派生结果」，带 rainfallMm 与时间戳，
 *      一旦输入（雨量、路网、险情）变化就会被标记为 stale，避免用旧结论冒充新结论。
 *   3. 支持导出 / 导入 JSON，便于答辩现场备份恢复与复现。
 */
(function (FA) {
  'use strict';

  var STALE_KEYS = ['risk', 'svi', 'access', 'priority', 'resourceGap', 'plan', 'report'];

  function initialState() {
    var snap = FA.data.createSnapshot();
    return Object.assign(snap, {
      /* 派生结果 */
      risk: null,
      svi: null,
      access: null,
      priority: null,
      resourceGap: null,
      plan: null,
      report: null,
      /* 执行闭环 */
      tasks: [],
      publishedPlanId: null,
      publishedAt: null,
      publishLog: [],
      /* 知识检索 */
      knowledge: [],
      /* 动态触发 */
      pendingChanges: {
        count: 0,
        rainfallDeltaMm: 0,
        hazardCount: 0,
        maxSeverity: 0,
        closedRoadCount: 0,
        affectedDelta: 0,
        items: [],
        lastEvaluatedAt: null,
        lastReplanAt: null
      },
      /* 合规自查 */
      compliance: null,
      /* 元信息 */
      version: '3.7.0-guardian',
      updatedAt: FA.util.nowIso(),
      stale: false,
      /* 输入版本号：任何输入（雨量/路网/险情/情景）变化时 +1。
         每个派生结果记录自己是在哪个输入版本上算出来的，
         只要版本对不上就说明「结论过期」——这样重算之后过期标记会自动消失，
         不会出现「明明已经重算过，却还挂着需重新计算」的矛盾状态。 */
      inputRevision: 0,
      revisions: {}
    });
  }

  var state = initialState();
  var history = [];

  function notify(reason) {
    FA.bus.emit('state', { reason: reason, updatedAt: state.updatedAt });
  }

  /** 是否存在「算在旧输入上」的派生结果 */
  function computeStale() {
    return STALE_KEYS.some(function (k) {
      return state[k] && state.revisions[k] !== state.inputRevision;
    });
  }

  /** 输入发生变化：版本 +1，并重算过期标记 */
  function bumpInput(reason) {
    state.inputRevision += 1;
    state.stale = computeStale();
    if (state.stale) {
      FA.trace.push('warn', '输入已变化，已有分析结果过期', {
        detail: '原因：' + reason + '。界面会明确标注过期，重算后标记自动消失，不会用旧结论冒充新结论。'
      });
    }
  }

  FA.store = {
    /** 只读快照（浅拷贝顶层，避免 UI 直接改内部对象） */
    get: function () {
      return Object.assign({}, state, {
        pendingChanges: Object.assign({}, state.pendingChanges),
        plan: state.plan ? Object.assign({}, state.plan) : null
      });
    },

    /** 直接取内部引用：只读使用，禁止修改 */
    raw: function () { return state; },

    /** 派发变更：唯一入口 */
    patch: function (patch, opts) {
      opts = opts || {};
      Object.assign(state, patch);
      state.updatedAt = FA.util.nowIso();
      // 本批写入的派生结果，记下它基于哪个输入版本
      STALE_KEYS.forEach(function (k) {
        if (patch && Object.prototype.hasOwnProperty.call(patch, k) && state[k]) {
          state.revisions[k] = state.inputRevision;
        }
      });
      state.stale = computeStale();
      if (opts.silent !== true) {
        FA.trace.push('state', opts.label || '状态已更新', { detail: opts.detail || '' });
      }
      notify(opts.reason || 'patch');
      return state;
    },

    /* ------------------------------ 选择器 ------------------------------ */
    zone: function (id) { return state.zones.find(function (z) { return z.id === id; }) || null; },
    group: function (id) { return state.groups.find(function (g) { return g.id === id; }) || null; },
    shelter: function (id) { return state.shelters.find(function (s) { return s.id === id; }) || null; },
    vehicle: function (id) { return state.vehicles.find(function (v) { return v.id === id; }) || null; },
    road: function (id) { return state.roads.find(function (r) { return r.id === id; }) || null; },
    hazard: function (id) { return state.hazards.find(function (h) { return h.id === id; }) || null; },
    task: function (id) { return state.tasks.find(function (t) { return t.id === id; }) || null; },

    /** 当前参与调度的人员组（含情景启用的村级新增） */
    activeGroups: function () {
      var base = state.groups.slice();
      if (state.enableVillageGrowth) base = base.concat(FA.data.clone(FA.data.villageGrowthGroups));
      return base;
    },

    /** 当前可用车辆（排除故障车） */
    activeVehicles: function () {
      return state.vehicles.filter(function (v) {
        return state.vehicleOffline.indexOf(v.id) < 0 && v.status !== 'offline';
      });
    },

    /** 当前开放安置点 */
    activeShelters: function () {
      return state.shelters.filter(function (s) {
        return state.shelterClosed.indexOf(s.id) < 0 && s.status === 'open';
      });
    },

    /** 当前可通行路段 */
    openRoads: function () {
      return state.roads.filter(function (r) { return !r.closed; });
    },

    /** 邻接表：{ zoneId: [{ to, minutes, roadId }] }，只包含可通行路段 */
    adjacency: function () {
      var adj = {};
      state.zones.forEach(function (z) { adj[z.id] = []; });
      state.roads.forEach(function (r) {
        if (r.closed) return;
        if (adj[r.from]) adj[r.from].push({ to: r.to, minutes: r.minutes, roadId: r.id });
        if (adj[r.to]) adj[r.to].push({ to: r.from, minutes: r.minutes, roadId: r.id });
      });
      return adj;
    },

    /** 某点对全网的行驶时间（Dijkstra，纯前端图算法，等价 NetworkX 的作用） */
    travelTimes: function (fromZoneId) {
      var adj = this.adjacency();
      var dist = {};
      state.zones.forEach(function (z) { dist[z.id] = Infinity; });
      if (dist[fromZoneId] === undefined) return dist;
      dist[fromZoneId] = 0;
      var visited = {};
      for (var i = 0; i < state.zones.length; i++) {
        var cur = null, best = Infinity;
        Object.keys(dist).forEach(function (k) {
          if (!visited[k] && dist[k] < best) { best = dist[k]; cur = k; }
        });
        if (cur === null) break;
        visited[cur] = true;
        (adj[cur] || []).forEach(function (edge) {
          var nd = dist[cur] + edge.minutes;
          if (nd < dist[edge.to]) dist[edge.to] = nd;
        });
      }
      return dist;
    },

    /** 最短路径（用于在右栏画出调度路径） */
    shortestPath: function (fromZoneId, toZoneId) {
      var adj = this.adjacency();
      var dist = {}, prev = {}, visited = {};
      state.zones.forEach(function (z) { dist[z.id] = Infinity; });
      dist[fromZoneId] = 0;
      for (var i = 0; i < state.zones.length; i++) {
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
      if (dist[toZoneId] === Infinity) return { path: [], minutes: Infinity };
      var path = [toZoneId], node = toZoneId;
      while (prev[node] !== undefined) { node = prev[node]; path.unshift(node); }
      return { path: path, minutes: dist[toZoneId] };
    },

    /* ------------------------------ 情景与重置 ------------------------------ */
    applyScenario: function (scenarioId) {
      var sc = FA.data.scenarios.find(function (s) { return s.id === scenarioId; });
      if (!sc) return { ok: false, message: '未找到情景 ' + scenarioId };
      var snap = FA.data.createSnapshot();
      state.zones = snap.zones;
      state.groups = snap.groups;
      state.shelters = snap.shelters;
      state.vehicles = snap.vehicles;
      state.roads = snap.roads;
      state.hazards = snap.hazards;
      state.enableVillageGrowth = !!sc.enableVillageGrowth;
      state.vehicleOffline = (sc.vehicleOffline || []).slice();
      state.shelterClosed = (sc.shelterClosed || []).slice();
      state.rainfallMm = sc.rainfallMm;
      state.horizonHours = FA.data.region.demo.scenarioHorizonHours;
      state.roads.forEach(function (r) {
        if ((sc.closedRoadIds || []).indexOf(r.id) >= 0) r.closed = true;
      });
      state.vehicles.forEach(function (v) {
        if (state.vehicleOffline.indexOf(v.id) >= 0) v.status = 'offline';
      });
      state.shelters.forEach(function (s) {
        if (state.shelterClosed.indexOf(s.id) >= 0) s.status = 'closed';
      });
      state.scenarioId = sc.id;
      state.tasks = [];
      state.publishedPlanId = null;
      state.publishedAt = null;
      state.knowledge = [];
      STALE_KEYS.forEach(function (k) { state[k] = null; });
      state.stale = false;
      state.inputRevision = 0;
      state.revisions = {};
      state.pendingChanges = initialState().pendingChanges;
      state.rainfallTimeline = [{ at: FA.util.nowIso(), mm: state.rainfallMm, label: '情景设定 ' + sc.rainfallMm + ' mm' }];
      state.updatedAt = FA.util.nowIso();
      FA.trace.push('state', '已切换到情景：' + sc.name, {
        detail: sc.description + '（雨量 ' + sc.rainfallMm + ' mm）'
      });
      notify('scenario');
      return { ok: true, scenario: sc };
    },

    reset: function () {
      state = initialState();
      state.rainfallTimeline = [{ at: FA.util.nowIso(), mm: state.rainfallMm, label: '初始实况' }];
      history = [];
      FA.util.resetClock();
      FA.trace.clear();
      notify('reset');
      return { ok: true };
    },

    /* ------------------------------ 雨量与险情 ------------------------------ */
    /** 口播雨量推进：演示「动态变化的口播数据」 */
    advanceRainfall: function (deltaMm, label) {
      var delta = Number(deltaMm);
      if (!isFinite(delta) || delta === 0) return { ok: false, message: '雨量增量无效' };
      var before = state.rainfallMm;
      state.rainfallMm = FA.util.round(state.rainfallMm + delta, 1);
      state.rainfallTimeline = state.rainfallTimeline || [];
      state.rainfallTimeline.push({
        at: FA.util.nowIso(),
        mm: state.rainfallMm,
        label: label || ('口播 +' + delta + ' mm')
      });
      state.updatedAt = FA.util.nowIso();
      this.accumulateChange('rainfall', delta, '口播雨量由 ' + before + ' 变为 ' + state.rainfallMm + ' mm');
      bumpInput('口播雨量 ' + before + ' → ' + state.rainfallMm + ' mm');
      FA.trace.push('perceive', '口播雨量更新', {
        detail: '累计雨量 ' + before + ' → ' + state.rainfallMm + ' mm（增量 ' + delta + ' mm）'
      });
      notify('rainfall');
      return { ok: true, before: before, after: state.rainfallMm, delta: delta };
    },

    /**
     * 直接设定累计雨量（情景设定，不是自然累积）。
     * 与 advanceRainfall 的区别：这是一次明确的设定行为，
     * 因此不计入「变化累积」，避免把设定动作当成雨情漂移去触发重算。
     */
    setRainfall: function (rainfallMm, note) {
      var target = Number(rainfallMm);
      if (!isFinite(target) || target < 0) return { ok: false, message: '雨量值无效' };
      target = FA.util.round(target, 1);
      var before = state.rainfallMm;
      state.rainfallMm = target;
      state.rainfallTimeline = state.rainfallTimeline || [];
      state.rainfallTimeline.push({
        at: FA.util.nowIso(),
        mm: target,
        label: note || ('情景设定 ' + target + ' mm')
      });
      state.updatedAt = FA.util.nowIso();
      bumpInput('累计雨量设定为 ' + target + ' mm');
      if (before !== target) {
        FA.trace.push('perceive', '累计雨量设定为 ' + target + ' mm', {
          detail: '由 ' + before + ' mm 调整为 ' + target + ' mm（情景设定，不计入变化累积）'
        });
      }
      notify('rainfall-set');
      return { ok: true, before: before, after: target, changed: before !== target };
    },

    /** 追加险情（地图长按 / 口播 / 现场上报） */
    addHazard: function (hazard) {
      var h = Object.assign({
        id: FA.util.uid('HZ'),
        at: FA.util.elapsed(),
        source: 'map-longpress',
        confirmed: false,
        severity: 2
      }, hazard || {});
      state.hazards = state.hazards.concat([h]);
      state.updatedAt = FA.util.nowIso();
      this.accumulateChange('hazard', 1, '新增险情：' + (h.note || h.zoneId || '未注明'), { severity: h.severity });
      bumpInput('新增险情 ' + (h.zoneId || ''));
      FA.trace.push('perceive', '收到险情上报：' + (FA.store.zone(h.zoneId) ? FA.store.zone(h.zoneId).name : h.zoneId), {
        detail: (h.note || '') + '（严等级 ' + h.severity + '，来源 ' + h.source + '）'
      });
      notify('hazard');
      return h;
    },

    /** 打开 / 关闭路段 */
    setRoadClosed: function (roadId, closed) {
      var road = this.road(roadId);
      if (!road) return { ok: false, message: '未找到路段 ' + roadId };
      if (road.closed === !!closed) return { ok: true, unchanged: true, road: road };
      road.closed = !!closed;
      state.updatedAt = FA.util.nowIso();
      this.accumulateChange('road', 1, (closed ? '路段阻断：' : '路段恢复：') + road.name);
      bumpInput((closed ? '路段阻断：' : '路段恢复：') + road.name);
      FA.trace.push('perceive', (closed ? '路段阻断：' : '路段恢复：') + road.name, {
        detail: road.from + ' → ' + road.to
      });
      notify('road');
      return { ok: true, road: road };
    },

    /* ------------------------------ 动态触发累积 ------------------------------ */
    accumulateChange: function (kind, value, note, extra) {
      var pc = state.pendingChanges;
      pc.count += 1;
      pc.items.push({ at: FA.util.nowIso(), kind: kind, value: value, note: note || '', extra: extra || null });
      if (pc.items.length > 60) pc.items = pc.items.slice(-60);
      if (kind === 'rainfall') pc.rainfallDeltaMm += Number(value) || 0;
      if (kind === 'hazard') {
        pc.hazardCount += 1;
        pc.maxSeverity = Math.max(pc.maxSeverity, Number((extra && extra.severity) || 1));
      }
      if (kind === 'road') pc.closedRoadCount += Number(value) || 0;
      if (kind === 'affected') pc.affectedDelta += Number(value) || 0;
      FA.bus.emit('pending-changes', pc);
      return pc;
    },

    peekPendingChanges: function () { return state.pendingChanges; },

    clearPendingChanges: function (opts) {
      var prev = state.pendingChanges;
      state.pendingChanges = Object.assign(initialState().pendingChanges, {
        lastReplanAt: (opts && opts.replan) ? FA.util.nowIso() : prev.lastReplanAt,
        lastEvaluatedAt: FA.util.nowIso()
      });
      FA.bus.emit('pending-changes', state.pendingChanges);
      return prev;
    },

    /* ------------------------------ 执行闭环 ------------------------------ */
    /** 生成任务（写状态，推工作流） */
    setTasks: function (tasks, meta) {
      state.tasks = tasks.map(function (t) {
        return Object.assign({
          id: FA.util.uid('TK'),
          stage: 'created',
          history: [{ at: FA.util.nowIso(), stage: 'created', note: '由调度方案生成' }]
        }, t);
      });
      state.updatedAt = FA.util.nowIso();
      FA.trace.push('state', '已生成 ' + state.tasks.length + ' 条转移任务', {
        detail: (meta && meta.detail) || '等待人工确认后发布'
      });
      notify('tasks');
      return state.tasks;
    },

    /** 更新单条任务状态 —— 执行闭环的核心写操作 */
    updateTaskStage: function (taskId, stage, actor, note) {
      var t = this.task(taskId);
      if (!t) return { ok: false, message: '未找到任务 ' + taskId };
      var allowed = ['created', 'published', 'notified', 'received', 'contacted', 'boarded', 'arrived', 'held', 'cancelled'];
      if (allowed.indexOf(stage) < 0) return { ok: false, message: '未知状态 ' + stage };
      t.stage = stage;
      t.updatedAt = FA.util.nowIso();
      t.history.push({ at: FA.util.nowIso(), stage: stage, actor: actor || '系统', note: note || '' });
      state.updatedAt = FA.util.nowIso();
      FA.trace.push(stage === 'arrived' ? 'state' : 'state',
        (t.groupName || t.groupId) + ' → ' + FA.tools.stageLabel(stage), {
          detail: (actor ? '操作人：' + actor + '。' : '') + (note || '')
        });
      notify('task-stage');
      return { ok: true, task: t };
    },

    /** 批量更新（例如发布后全部置为 published） */
    updateTasksByPlan: function (planId, stage, actor, note) {
      var changed = 0;
      state.tasks.forEach(function (t) {
        if (t.planId !== planId) return;
        t.stage = stage;
        t.updatedAt = FA.util.nowIso();
        t.history.push({ at: FA.util.nowIso(), stage: stage, actor: actor || '系统', note: note || '' });
        changed += 1;
      });
      state.updatedAt = FA.util.nowIso();
      notify('tasks-bulk');
      return changed;
    },

    markPublished: function (planId, channel, confirmedBy) {
      state.publishedPlanId = planId;
      state.publishedAt = FA.util.nowIso();
      state.publishLog.push({
        at: state.publishedAt,
        planId: planId,
        channel: channel || '政务通讯工具（模拟）',
        confirmedBy: confirmedBy || '演练指挥员'
      });
      notify('published');
      return state.publishLog[state.publishLog.length - 1];
    },

    /* ------------------------------ 导入 / 导出 ------------------------------ */
    exportJson: function () {
      return JSON.stringify({
        version: state.version,
        exportedAt: FA.util.nowIso(),
        regionId: FA.data.region.id,
        state: state,
        trace: FA.trace.recent(80)
      }, null, 2);
    },

    importJson: function (text) {
      try {
        var parsed = JSON.parse(text);
        if (!parsed || !parsed.state) return { ok: false, message: '文件结构不正确（缺少 state 字段）' };
        state = Object.assign(initialState(), parsed.state);
        notify('import');
        FA.trace.push('state', '已从备份恢复演练状态', { detail: '导入时间 ' + (parsed.exportedAt || '未知') });
        return { ok: true };
      } catch (e) {
        return { ok: false, message: '解析失败：' + String(e.message || e) };
      }
    },

    /** 组装工具/算法需要的 world 快照（含情景开关的影响） */
    world: function () {
      return {
        zones: state.zones,
        groups: this.activeGroups(),
        shelters: this.activeShelters(),
        vehicles: this.activeVehicles(),
        roads: state.roads,
        rainfallMm: state.rainfallMm,
        horizonHours: state.horizonHours
      };
    },

    /** 一致性自查：约束校验，供评估与「边界提示」使用 */
    validate: function () {
      var errors = [];
      var s = state;

      // 1) 座位不超载
      var plan = s.plan;
      if (plan && plan.assignments) {
        plan.assignments.forEach(function (a) {
          var v = s.vehicles.find(function (x) { return x.id === a.vehicleId; });
          if (!v) { errors.push('方案引用了不存在的车辆 ' + a.vehicleId); return; }
          var seats = FA.util.sum(a.stops || [], function (st) { return st.people || 0; });
          if (seats > v.seats) errors.push(v.name + ' 座位超载：' + seats + ' > ' + v.seats);
          var wc = FA.util.sum(a.stops || [], function (st) { return st.wheelchair || 0; });
          if (wc > v.wheelchairSlots) errors.push(v.name + ' 无障碍位超载：' + wc + ' > ' + v.wheelchairSlots);
        });

        // 2) 安置容量不超限
        Object.keys(plan.shelterLoad || {}).forEach(function (sid) {
          var sh = s.shelters.find(function (x) { return x.id === sid; });
          if (!sh) { errors.push('方案引用了不存在的安置点 ' + sid); return; }
          var load = plan.shelterLoad[sid];
          if (load.people > sh.capacity) errors.push(sh.name + ' 容量超限：' + load.people + ' > ' + sh.capacity);
          if (load.wheelchair > sh.wheelchairSlots) errors.push(sh.name + ' 无障碍容量超限：' + load.wheelchair + ' > ' + sh.wheelchairSlots);
        });

        // 3) 同一组不得重复安排
        var seen = {};
        (plan.assignments || []).forEach(function (a) {
          (a.stops || []).forEach(function (st) {
            if (seen[st.groupId]) errors.push('人员组被重复安排：' + st.groupId);
            seen[st.groupId] = true;
          });
        });

        // 4) 不得使用已阻断路段
        var closed = s.roads.filter(function (r) { return r.closed; }).map(function (r) { return r.id; });
        (plan.assignments || []).forEach(function (a) {
          (a.routeRoadIds || []).forEach(function (rid) {
            if (closed.indexOf(rid) >= 0) errors.push('方案使用了已阻断路段 ' + rid);
          });
        });
      }

      // 5) 状态一致性
      if (s.publishedPlanId && (!s.plan || s.plan.id !== s.publishedPlanId)) {
        errors.push('已发布方案与当前方案不一致，需重新确认');
      }
      return { ok: errors.length === 0, errors: errors };
    }
  };

  /* 初始化时间线 */
  state.rainfallTimeline = [{ at: FA.util.nowIso(), mm: state.rainfallMm, label: '初始实况' }];
})(window.FA = window.FA || {});
