/*!
 * 城市韧性守护 Agent · 执行闭环工具组
 * ---------------------------------------------------------------
 * submit_hazard_report    地图长按 / 口播 / 现场上报险情修改
 * evaluate_trigger        动态触发标准判定（是否值得重算方案）
 * create_dispatch_tasks   把方案落成任务（写状态）
 * publish_dispatch_plan   人工确认后模拟发布（需确认令牌）
 * update_task_state       接收 / 联系 / 上车 / 到达，推动工作流
 * get_system_state        读取当前状态快照
 *
 * 这一组工具是「智能体需调用工具修改状态并推动工作流」的实现载体。
 */
(function (FA) {
  'use strict';

  var DISCLAIMER = FA.data.region.disclaimer;

  /* ============================ 上报险情 ============================ */
  FA.tools.register({
    name: 'submit_hazard_report',
    label: '提交险情修改',
    group: '执行闭环',
    description: '提交或修改一条险情（地图长按、口播或现场上报），记录到状态并累积到动态触发判定中。提交后本工具只记录与提示，不会自动重算方案；是否需要重算由 evaluate_trigger 按阈值判断，并由人工确认。',
    parameters: {
      type: 'object',
      properties: {
        zoneId: { type: 'string', description: '险情所在网格编号，例如 R02' },
        severity: { type: 'integer', minimum: 1, maximum: 5, description: '险情严等级 1-5，默认 2' },
        note: { type: 'string', description: '险情描述' },
        source: { type: 'string', enum: ['map-longpress', 'oral', 'field'], description: '来源：地图长按 / 口播 / 现场' },
        closeRoadId: { type: 'string', description: '若该险情导致某路段阻断，填入路段编号，例如 RD04' }
      },
      required: ['zoneId']
    },
    mutates: true,
    handler: function (args) {
      var zone = FA.store.zone(args.zoneId);
      if (!zone) {
        return {
          ok: false,
          summary: '未找到网格 ' + args.zoneId,
          warnings: ['可用网格：' + FA.store.raw().zones.map(function (z) { return z.id; }).join('、')]
        };
      }

      var hazard = FA.store.addHazard({
        zoneId: zone.id,
        severity: args.severity || 2,
        note: args.note || (zone.name + ' 险情上报'),
        source: args.source || 'map-longpress'
      });

      var roadResult = null;
      if (args.closeRoadId) {
        roadResult = FA.store.setRoadClosed(args.closeRoadId, true);
      }

      var ev = FA.triggers.evaluate();
      FA.bus.emit('trigger:evaluated', ev);

      return {
        ok: true,
        summary: '已记录 ' + zone.name + ' 的险情（严等级 ' + hazard.severity + '）' +
          (roadResult && roadResult.ok ? '，并标记路段 ' + args.closeRoadId + ' 阻断' : '') +
          '。' + (ev.shouldReplan ? '已触发重算阈值，建议重新研判。' : '尚未达到重算阈值，系统只累积提示。'),
        data: {
          hazard: hazard,
          road: roadResult && roadResult.road ? { id: roadResult.road.id, name: roadResult.road.name, closed: roadResult.road.closed } : null,
          trigger: ev,
          pendingChanges: FA.store.peekPendingChanges()
        },
        actions: ev.shouldReplan
          ? [
            FA.actions.factory.replan(),
            FA.actions.factory.showMap(),
            FA.actions.make({ label: '先看影响范围', kind: 'tool', tool: 'assess_flood_risk', group: '风险研判' })
          ]
          : [
            FA.actions.factory.advanceRain(FA.data.region.demo.rainfallStepMm),
            FA.actions.factory.stateNow(),
            FA.actions.factory.showMap()
          ],
        warnings: [
          DISCLAIMER.short,
          ev.shouldReplan ? '变化达到阈值，但重算仍需人工确认后执行。' : '未达阈值时系统不重算方案，避免方案频繁变动。'
        ]
      };
    }
  });

  /* ============================ 设定累计雨量 ============================ */
  FA.tools.register({
    name: 'set_scenario_rainfall',
    label: '设定累计雨量',
    group: '风险研判',
    description: '把当前演练情景的累计雨量设定为指定值，例如指挥员口述「未来 6 小时累计降雨 120 毫米」。这是情景设定而不是雨量自然累积，因此不计入动态触发的「变化累积」，但会让已有分析结果标记为过期，提示需要重新计算。',
    parameters: {
      type: 'object',
      properties: {
        rainfallMm: { type: 'number', minimum: 0, maximum: 500, description: '累计雨量（毫米）' },
        note: { type: 'string', description: '设定说明，例如「指挥员口述 6 小时累计雨量」' }
      },
      required: ['rainfallMm']
    },
    mutates: true,
    handler: function (args) {
      var res = FA.store.setRainfall(args.rainfallMm, args.note);
      if (!res.ok) return { ok: false, summary: res.message || '雨量设定失败' };

      var ev = FA.triggers.evaluate();
      return {
        ok: true,
        summary: res.changed
          ? ('累计雨量已设为 ' + res.after + ' mm（原 ' + res.before + ' mm）。已有分析结果标记为过期，需按新雨量重新计算。')
          : ('累计雨量本就是 ' + res.after + ' mm，无需调整。'),
        data: {
          before: res.before,
          after: res.after,
          changed: res.changed,
          timeline: FA.store.raw().rainfallTimeline,
          trigger: ev
        },
        actions: [
          FA.actions.factory.assess(),
          FA.actions.factory.optimize(),
          FA.actions.factory.scenario()
        ],
        warnings: [
          '雨量为演练设定值，不是气象预报；风险表述统一为「积水易发风险」，不预测具体水深。',
          '情景设定不计入变化累积，以免把「设定动作」误判为雨情漂移而触发重算。'
        ]
      };
    }
  });

  /* ============================ 口播雨量推进 ============================ */
  FA.tools.register({
    name: 'advance_oral_rainfall',
    label: '推进口播雨量',
    group: '执行闭环',
    description: '模拟演示中「动态变化的口播数据」：把累计雨量按给定量推进，写入雨量时间线并累积到动态触发判定，随后立即按阈值判断是否需要重新研判。用于现场演示雨情持续恶化时的闭环响应。',
    parameters: {
      type: 'object',
      properties: {
        deltaMm: { type: 'number', minimum: 0.1, maximum: 200, description: '本次口播的雨量增量（毫米）' },
        note: { type: 'string', description: '口播内容备注，例如「指挥部通报短时强降雨」' }
      },
      required: ['deltaMm']
    },
    mutates: true,
    handler: function (args) {
      var res = FA.store.advanceRainfall(args.deltaMm, args.note || ('口播 +' + args.deltaMm + ' mm'));
      if (!res.ok) return { ok: false, summary: res.message || '雨量推进失败' };

      var ev = FA.triggers.evaluate();
      FA.bus.emit('trigger:evaluated', ev);

      return {
        ok: true,
        summary: '口播雨量已推进：' + res.before + ' → ' + res.after + ' mm（+' + res.delta + ' mm）。' +
          (ev.shouldReplan
            ? '累计增量已达 ' + FA.triggers.thresholds().rainfallDeltaMm + ' mm，触发重算阈值，建议重新研判。'
            : '距重算阈值还差 ' + FA.util.round(Math.max(0, FA.triggers.thresholds().rainfallDeltaMm - FA.store.peekPendingChanges().rainfallDeltaMm), 1) + ' mm，系统只累积提示。'),
        data: {
          before: res.before,
          after: res.after,
          delta: res.delta,
          timeline: FA.store.raw().rainfallTimeline,
          trigger: ev,
          pendingChanges: FA.store.peekPendingChanges(),
          thresholds: FA.triggers.table()
        },
        actions: ev.shouldReplan
          ? [FA.actions.factory.replan(), FA.actions.factory.assess(), FA.actions.factory.optimize()]
          : [FA.actions.factory.advanceRain(FA.data.region.demo.rainfallStepMm), FA.actions.factory.assess(), FA.actions.factory.stateNow()],
        warnings: [
          '口播雨量为演练设定值，用于演示动态响应；不是气象预报。',
          ev.shouldReplan ? '达到阈值也只是「建议重算」，重算与发布仍需人工确认。' : '未达阈值不重算，避免方案频繁变动。'
        ]
      };
    }
  });

  /* ============================ 触发判定 ============================ */
  FA.tools.register({
    name: 'evaluate_trigger',
    label: '动态触发判定',
    group: '执行闭环',
    description: '按动态触发标准判断累积的雨量、险情、路段与受影响人数变化是否值得重新研判方案。未达阈值时只累积提示、不重算，以避免方案频繁变动；force=true 时忽略阈值与冷却期做一次强制重新研判。',
    parameters: {
      type: 'object',
      properties: {
        force: { type: 'boolean', description: '忽略阈值与冷却期，强制执行一次重新研判' }
      },
      required: []
    },
    mutates: true,
    handler: function (args) {
      var ev = FA.triggers.evaluate({ force: !!args.force });
      var pendingBefore = FA.store.peekPendingChanges();

      if (args.force) {
        FA.store.clearPendingChanges({ replan: true });
        FA.trace.push('decision', '指挥员要求强制重新研判', {
          detail: '忽略阈值与冷却期；已清空累积变化计数并记录重算时间。'
        });
      } else {
        FA.store.clearPendingChanges({ replan: false });
      }

      FA.bus.emit('trigger:evaluated', ev);

      return {
        ok: true,
        summary: args.force
          ? '已按指挥员要求强制执行重新研判，接下来重算风险与方案。'
          : (ev.shouldReplan
            ? '变化已达到重算阈值：' + ev.reasons[0] + '。' + ev.recommendation
            : '变化尚未达到重算阈值。' + ev.recommendation),
        data: {
          evaluation: ev,
          thresholds: FA.triggers.table(),
          pendingBefore: pendingBefore,
          pendingAfter: FA.store.peekPendingChanges()
        },
        actions: args.force
          ? [
            FA.actions.factory.assess(),
            FA.actions.factory.optimize()
          ]
          : (ev.shouldReplan
            ? [FA.actions.factory.replan(), FA.actions.factory.assess(), FA.actions.factory.optimize()]
            : [FA.actions.factory.advanceRain(FA.data.region.demo.rainfallStepMm), FA.actions.factory.stateNow()]),
        warnings: [
          ev.cooldownActive ? '当前处于 ' + ev.cooldownRemainMinutes + ' 分钟冷却期内，仅提示不重算。' : '',
          '阈值的作用是防止方案频繁变动；即使触发，重算仍需人工确认后执行。'
        ].filter(Boolean)
      };
    }
  });

  /* ============================ 生成任务 ============================ */
  FA.tools.register({
    name: 'create_dispatch_tasks',
    label: '生成转移任务',
    group: '执行闭环',
    description: '把当前调度方案落成可执行的转移任务（按人员组逐条生成），写入状态并推动工作流。任务生成后仍需人工确认发布，发布后才能更新为已通知、已接收、已联系、已上车、已到达等状态。',
    parameters: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: '指定方案编号；省略则使用当前方案' }
      },
      required: []
    },
    mutates: true,
    handler: function (args) {
      var s = FA.store.raw();
      var plan = s.plan;
      if (!plan) {
        return {
          ok: false,
          summary: '还没有调度方案，无法生成任务。先生成方案。',
          actions: [FA.actions.factory.optimize()]
        };
      }
      if (args.planId && args.planId !== plan.id) {
        return {
          ok: false,
          summary: '指定的方案编号与当前方案不一致（当前 ' + plan.id + '）。',
          warnings: ['为避免把任务挂到过期方案上，请先确认方案。'],
          actions: [FA.actions.factory.optimize()]
        };
      }

      var tasks = [];
      plan.assignments.forEach(function (a) {
        a.stops.forEach(function (st, idx) {
          tasks.push({
            planId: plan.id,
            vehicleId: a.vehicleId,
            vehicleName: a.vehicleName,
            groupId: st.groupId,
            groupName: st.groupName,
            zoneId: st.zoneId,
            shelterId: a.shelterId,
            shelterName: a.shelterName,
            people: st.people,
            wheelchair: st.wheelchair,
            assisted: st.assisted,
            highRisk: st.highRisk,
            pickupMinute: st.pickupMinute,
            stopIndex: idx + 1,
            stopCount: a.stops.length,
            legMinutes: a.legs && a.legs[idx] ? a.legs[idx].minutes : null,
            routeRoadIds: a.routeRoadIds || []
          });
        });
      });

      if (!tasks.length) {
        return {
          ok: false,
          summary: '当前方案里没有可安排的接人任务（所有人员仍未安排），请先解决资源缺口。',
          actions: [FA.actions.factory.gap(), FA.actions.factory.replan()],
          warnings: ['未安排人员需要增援或另行组织，本工具不会伪造任务。']
        };
      }

      var created = FA.store.setTasks(tasks, { detail: '来源方案 ' + plan.id + '（' + plan.objectiveLabel + '）' });

      return {
        ok: true,
        summary: '已生成 ' + created.length + ' 条转移任务，覆盖 ' + plan.metrics.servedPeople + ' 人；任务处于「已生成」状态，需人工确认后才能发布。',
        data: {
          planId: plan.id,
          count: created.length,
          tasks: created.map(function (t) {
            return {
              id: t.id, vehicleName: t.vehicleName, groupName: t.groupName, zoneId: t.zoneId,
              shelterName: t.shelterName, people: t.people, stage: t.stage, stageLabel: FA.tools.stageLabel(t.stage)
            };
          }),
          stages: FA.tools.stageLabels()
        },
        actions: [
          FA.actions.factory.publish(),
          FA.actions.factory.exportGov(),
          FA.actions.factory.stateNow()
        ],
        warnings: [
          '调度方案需人工确认后执行；发布前任务不会推送给执行人员。'
        ]
      };
    }
  });

  /* ============================ 发布（需人工确认） ============================ */
  FA.tools.register({
    name: 'publish_dispatch_plan',
    label: '确认并模拟发布调度方案',
    group: '执行闭环',
    description: '在人工确认后模拟发布调度方案：把相关任务置为已发布/已通知，生成可直接粘贴到现有政务通讯工具的通知文本。本工具必须经人工确认（确认令牌）才能执行，智能体不会自行批准；发布后仍可回退。',
    parameters: {
      type: 'object',
      properties: {
        planId: { type: 'string', description: '要发布的方案编号；省略则使用当前方案' },
        channel: { type: 'string', description: '发布渠道，默认「政务通讯工具（模拟）」' },
        summary: { type: 'string', description: '给确认人看的操作摘要' }
      },
      required: []
    },
    mutates: true,
    requiresConfirm: true,
    confirmDetail: '该操作会把方案推送给执行人员（模拟），并改变任务状态，需人工确认后执行。',
    handler: function (args) {
      var s = FA.store.raw();
      var plan = s.plan;
      if (!plan) {
        return { ok: false, summary: '还没有调度方案，无法发布。', actions: [FA.actions.factory.optimize()] };
      }
      if (args.planId && args.planId !== plan.id) {
        return {
          ok: false,
          summary: '方案编号不一致（当前 ' + plan.id + '），拒绝发布过期方案。',
          warnings: ['这是防止「确认了 A 方案却发布了 B 方案」的保护。'],
          actions: [FA.actions.factory.optimize()]
        };
      }

      var tasks = s.tasks.filter(function (t) { return t.planId === plan.id; });
      if (!tasks.length) {
        return {
          ok: false,
          summary: '当前方案还没有生成任务，先调用「生成转移任务」。',
          actions: [FA.actions.factory.createTasks()]
        };
      }

      var channel = args.channel || '政务通讯工具（模拟）';
      var confirmedBy = args._confirmedBy || '演练指挥员';
      var changed = FA.store.updateTasksByPlan(plan.id, 'published', confirmedBy, '方案已发布');
      var log = FA.store.markPublished(plan.id, channel, confirmedBy);

      var notifications = FA.tools.buildNotifications(plan, s);

      FA.trace.push('publish', '方案已模拟发布到' + channel, {
        detail: '方案 ' + plan.id + '，' + changed + ' 条任务进入已发布状态，确认人：' + confirmedBy +
          '。取消独立接收端：通知文本可直接粘贴到现有政务通讯工具。'
      });

      return {
        ok: true,
        summary: '方案已发布到' + channel + '（确认人：' + confirmedBy + '），' + changed + ' 条任务已通知；已生成 ' +
          notifications.length + ' 条可直接粘贴的通知文本。',
        data: {
          planId: plan.id,
          channel: channel,
          confirmedBy: confirmedBy,
          publishedAt: log.at,
          taskCount: changed,
          notifications: notifications,
          stages: FA.tools.stageLabels(),
          nextSteps: [
            '执行人员收到任务后回复「已接收」',
            '联系到人员后回复「已联系」',
            '人员上车后回复「已上车」',
            '到达安置点后回复「已到达」'
          ]
        },
        actions: [
          FA.actions.make({
            label: '标记「已接收」',
            kind: 'tool',
            tool: 'update_task_state',
            args: { taskId: 'ALL', stage: 'received', actor: '执行人员（模拟）', note: '已收到转移任务' },
            tone: 'primary',
            group: '执行闭环',
            hint: '批量推进所有任务到已接收'
          }),
          FA.actions.make({
            label: '标记「已到达」',
            kind: 'tool',
            tool: 'update_task_state',
            args: { taskId: 'ALL', stage: 'arrived', actor: '执行人员（模拟）', note: '已到达安置点' },
            group: '执行闭环',
            hint: '演示完整闭环：任务全部完成'
          }),
          FA.actions.factory.stateNow(),
          FA.actions.factory.report()
        ],
        warnings: [
          '本次为「模拟发布」，未接入任何真实政务通讯系统；请仅使用演练信息。',
          '发布后如雨情或险情变化，需重新研判并按新方案再次确认。'
        ]
      };
    }
  });

  /* ============================ 更新任务状态 ============================ */
  FA.tools.register({
    name: 'update_task_state',
    label: '更新任务执行状态',
    group: '执行闭环',
    description: '仅更新已经人工确认发布的当前方案任务（已通知 / 已接收 / 已联系 / 已上车 / 已到达 / 待增援），推动工作流前进并留痕。不能代替人工发布。taskId 可传任务编号、人员组编号（如 H1），或 ALL 表示当前方案的全部任务。',
    parameters: {
      type: 'object',
      properties: {
        taskId: { type: 'string', description: '任务编号、人员组编号，或 ALL' },
        stage: { type: 'string', enum: ['notified', 'received', 'contacted', 'boarded', 'arrived', 'held', 'cancelled'], description: '发布后的目标状态；发布必须使用人工确认工具' },
        actor: { type: 'string', description: '操作人（执行人员 / 指挥员）' },
        note: { type: 'string', description: '备注' }
      },
      required: ['taskId', 'stage']
    },
    mutates: true,
    handler: function (args) {
      var s = FA.store.raw();
      var plan = s.plan;
      var targets = [];

      function unpublished() {
        return { ok: false, summary: '任务尚未由人工确认发布，或不属于当前已发布方案；不能推进执行状态。',
          warnings: ['请先核对当前方案，并在「确认并模拟发布」弹框中点击确认；无需填写姓名。执行回执不能代替发布。'],
          actions: [FA.actions.factory.publish(), FA.actions.factory.stateNow()] };
      }
      // This tool must never serve as a second publishing route, including direct handler calls.
      if (args.stage === 'published') return unpublished();
      var publication = plan && (s.publishLog || []).find(function (p) {
        return p.planId === plan.id && p.at === s.publishedAt && typeof p.confirmedBy === 'string' && p.confirmedBy.trim();
      });
      if (!plan || s.publishedPlanId !== plan.id || !publication) return unpublished();

      if (args.taskId === 'ALL') {
        if (!plan) return { ok: false, summary: '没有方案，无法批量更新任务。' };
        targets = s.tasks.filter(function (t) { return t.planId === plan.id; });
      } else {
        var t = FA.store.task(args.taskId);
        if (t) targets = [t];
        else targets = s.tasks.filter(function (x) { return x.groupId === args.taskId; });
      }

      if (!targets.length) {
        return {
          ok: false,
          summary: '未找到任务 ' + args.taskId + '。',
          warnings: ['可用任务：' + s.tasks.map(function (t) { return t.id + '(' + t.groupName + ')'; }).join('、') || '（当前没有任务，先生成任务）'],
          actions: [FA.actions.factory.createTasks(), FA.actions.factory.stateNow()]
        };
      }

      // Validate the whole batch before writing any task. Regenerating tasks for
      // the same plan does not inherit an earlier batch's human approval.
      if (targets.some(function (t) {
        return t.planId !== plan.id || !(t.history || []).some(function (h) {
          return h.stage === 'published' && h.actor === publication.confirmedBy;
        });
      })) return unpublished();

      var updated = [];
      targets.forEach(function (t) {
        var r = FA.store.updateTaskStage(t.id, args.stage, args.actor, args.note);
        if (r.ok) updated.push(r.task);
      });

      var counts = FA.tools.taskStats(s.tasks.filter(function (t) { return !plan || t.planId === plan.id; }));
      var arrived = counts.byStage.arrived || 0;
      var allDone = targets.length > 0 && counts.total > 0 && arrived === counts.total;

      return {
        ok: true,
        summary: '已把 ' + updated.length + ' 条任务更新为「' + FA.tools.stageLabel(args.stage) + '」' +
          (args.taskId === 'ALL' ? '（当前方案全部任务）' : '（' + targets[0].groupName + '）') +
          '。当前进度：' + counts.total + ' 条任务中已到达 ' + arrived + ' 条。',
        data: {
          updated: updated.map(function (t) {
            return { id: t.id, groupName: t.groupName, vehicleName: t.vehicleName, stage: t.stage, stageLabel: FA.tools.stageLabel(t.stage) };
          }),
          stats: counts,
          allDone: allDone
        },
        actions: allDone
          ? [
            FA.actions.factory.report(),
            FA.actions.factory.exportGov(),
            FA.actions.make({ label: '查看完整交接记录', kind: 'view', args: { view: 'monitor-tasks' }, group: '查看' })
          ]
          : [
            FA.actions.make({
              label: '推进到「已上车」',
              kind: 'tool',
              tool: 'update_task_state',
              args: { taskId: 'ALL', stage: 'boarded', actor: args.actor || '执行人员（模拟）', note: '人员已上车' },
              group: '执行闭环'
            }),
            FA.actions.factory.stateNow()
          ],
        warnings: allDone ? ['全部任务已到达，闭环完成。本次为演练模拟，未接入真实政务系统。'] : []
      };
    }
  });

  /* ============================ 状态快照 ============================ */
  FA.tools.register({
    name: 'get_system_state',
    label: '读取当前状态',
    group: '查看',
    description: '读取当前演练状态的完整快照：情景与雨量、风险评估是否已完成、方案指标、任务执行进度、待处理变化与触发判定。用于回答「现在什么情况」「任务到哪一步了」。',
    parameters: {
      type: 'object',
      properties: {
        includeFull: { type: 'boolean', description: '是否包含完整方案与任务明细，默认 false' }
      },
      required: []
    },
    mutates: false,
    handler: function (args) {
      var s = FA.store.raw();
      var scenario = FA.data.scenarios.find(function (x) { return x.id === s.scenarioId; }) || { name: s.scenarioId, description: '' };
      var ev = FA.triggers.evaluate();
      var tasksForPlan = s.plan ? s.tasks.filter(function (t) { return t.planId === s.plan.id; }) : [];
      var stats = FA.tools.taskStats(tasksForPlan);

      var lines = [
        '情景：' + scenario.name + '（' + s.rainfallMm + ' mm / ' + s.horizonHours + ' 小时）',
        '风险评估：' + (s.risk ? '已完成（' + s.risk.rainfallMm + ' mm）' : '未完成'),
        '优先级：' + (s.priority ? '已完成，最高 ' + s.priority.zones[0].name : '未完成'),
        '方案：' + (s.plan ? s.plan.objectiveLabel + '，已安排 ' + s.plan.metrics.servedPeople + '/' + s.plan.metrics.totalPeople + ' 人' : '未生成'),
        '任务：' + stats.total + ' 条' + (stats.total ? '（' + Object.keys(stats.byStage).map(function (k) { return FA.tools.stageLabel(k) + ' ' + stats.byStage[k]; }).join('，') + '）' : ''),
        '发布：' + (s.publishedPlanId ? '已模拟发布于 ' + FA.util.formatTime(s.publishedAt) : '未发布'),
        '待处理变化：' + s.pendingChanges.count + ' 项（' + ev.recommendation + '）'
      ];

      return {
        ok: true,
        summary: lines.join('；') + '。',
        data: {
          scenario: { id: s.scenarioId, name: scenario.name, description: scenario.description },
          rainfallMm: s.rainfallMm,
          horizonHours: s.horizonHours,
          rainfallTimeline: s.rainfallTimeline || [],
          stale: s.stale,
          risk: s.risk ? { at: s.risk.rainfallMm, method: s.risk.methodLabel, top: s.risk.zones.slice(0, 3).map(function (z) { return { zoneId: z.zoneId, percent: z.percent, levelLabel: z.levelLabel }; }) } : null,
          svi: s.svi ? { method: s.svi.methodLabel, top: s.svi.zones.slice(0, 3).map(function (z) { return { zoneId: z.zoneId, percent: z.percent }; }) } : null,
          access: s.access ? { openRoadCount: s.access.openRoadCount, unreachable: s.access.unreachable, closedRoadIds: s.access.closedRoadIds } : null,
          priority: s.priority ? { top: s.priority.zones.slice(0, 3).map(function (z) { return { zoneId: z.zoneId, priorityPercent: z.priorityPercent, tag: z.tag }; }) } : null,
          resourceGap: s.resourceGap ? { gapCount: s.resourceGap.gaps.length, gaps: s.resourceGap.gaps.map(function (g) { return g.label; }) } : null,
          plan: s.plan ? {
            id: s.plan.id, objectiveLabel: s.plan.objectiveLabel, algorithm: s.plan.algorithm,
            metrics: s.plan.metrics, validation: s.plan.validation,
            assignments: args.includeFull ? s.plan.assignments : undefined,
            unassigned: s.plan.unassigned,
            shelterLoad: s.plan.shelterLoad
          } : null,
          tasks: args.includeFull ? s.tasks : undefined,
          taskStats: stats,
          published: { planId: s.publishedPlanId, at: s.publishedAt, log: s.publishLog },
          pendingChanges: s.pendingChanges,
          trigger: ev,
          hazards: s.hazards,
          scenarioMatrix: s.scenarioMatrix ? { steps: s.scenarioMatrix.steps, margin: s.scenarioMatrix.margin } : null,
          knowledge: s.knowledge
        },
        actions: s.plan
          ? [FA.actions.factory.stateNow(), FA.actions.factory.report(), FA.actions.make({ label: '查看任务进度', kind: 'view', args: { view: 'monitor-tasks' }, group: '查看' })]
          : [FA.actions.factory.assess(), FA.actions.factory.optimize(), FA.actions.factory.scenario()],
        warnings: [
          DISCLAIMER.short,
          s.stale ? '注意：输入已发生变化，部分分析结果已过期，需重新计算后再引用。' : ''
        ].filter(Boolean)
      };
    }
  });

  /* ============================ 共享辅助 ============================ */
  FA.tools.taskStats = function (tasks) {
    var byStage = {};
    (tasks || []).forEach(function (t) {
      byStage[t.stage] = (byStage[t.stage] || 0) + 1;
    });
    var people = FA.util.sum(tasks || [], function (t) { return t.people || 0; });
    var arrivedPeople = FA.util.sum((tasks || []).filter(function (t) { return t.stage === 'arrived'; }), function (t) { return t.people || 0; });
    return {
      total: (tasks || []).length,
      byStage: byStage,
      people: people,
      arrivedPeople: arrivedPeople,
      progress: people ? FA.util.round(arrivedPeople / people, 3) : 0
    };
  };

  /**
   * 生成可直接粘贴到现有政务通讯工具的通知文本。
   * 对应会议纪要「取消独立接收端，执行人员通过现有政务通讯工具接收调度结果」。
   */
  FA.tools.buildNotifications = function (plan, state) {
    var out = [];
    (plan.assignments || []).forEach(function (a) {
      var lines = [];
      lines.push('【转移任务 · ' + a.vehicleName + '】');
      lines.push('接人顺序：');
      (a.stops || []).forEach(function (st, i) {
        var zone = (state.zones || []).find(function (z) { return z.id === st.zoneId; });
        var flags = [];
        if (st.highRisk) flags.push('高风险');
        if (st.assisted) flags.push('需协助');
        if (st.wheelchair) flags.push('无障碍 ' + st.wheelchair + ' 位');
        lines.push('  ' + (i + 1) + '. ' + (zone ? zone.name : st.zoneId) + ' · ' + st.groupName + '（' + st.people + ' 人' +
          (flags.length ? '，' + flags.join('、') : '') + '）');
      });
      lines.push('送往：' + a.shelterName + '（本车 ' + a.people + ' 人，预计 ' + a.finishMinute + ' 分钟完成）');
      lines.push('回执要求：收到回复「已接收」，联系到人回复「已联系」，上车回复「已上车」，到达回复「已到达」。');
      lines.push('边界说明：本通知为演练模拟发布，调度方案已由人工确认；请仅使用演练信息。');
      out.push({
        vehicleId: a.vehicleId,
        vehicleName: a.vehicleName,
        shelterName: a.shelterName,
        text: lines.join('\n')
      });
    });
    return out;
  };
})(window.FA = window.FA || {});
