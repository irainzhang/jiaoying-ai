/*!
 * 城市韧性守护 Agent · 动作按钮
 * ---------------------------------------------------------------
 * 会议纪要原文：「助手回复必须附带动作按钮」「智能体需调用工具修改状态
 * 并推动工作流」。
 *
 * 因此在本系统里，动作按钮不是装饰，而是「执行闭环」的唯一入口：
 *   智能体回复 → 附带动作按钮 → 指挥员点击 → 调用工具 → 写状态 → 推工作流
 *   → 轨迹留痕 → 左栏监控与右栏方案同步变化。
 *
 * 所有按钮都声明成数据（可序列化），因此能通过 postMessage 传给宿主页面
 * （jiaoying-ai）由对方渲染，也能由本模块自渲染。
 */
(function (FA) {
  'use strict';

  var counter = 0;

  /**
   * @param {object} spec
   *   label        按钮文字
   *   kind         'tool' | 'prompt' | 'scenario' | 'view' | 'export' | 'rainfall' | 'confirm'
   *   tone         'primary' | 'default' | 'danger'
   *   tool         当 kind='tool' 时的工具名
   *   args         工具参数
   *   prompt       kind='prompt' 时发送的消息
   *   hint         悬停说明（为什么建议这一步）
   *   requiresConfirm 是否需人工确认（默认取工具的声明）
   *   group        按钮分组，用于界面分隔
   */
  function make(spec) {
    counter += 1;
    return Object.assign({
      id: spec.id || ('act-' + counter.toString(36)),
      kind: 'tool',
      tone: 'default',
      group: '下一步',
      hint: '',
      args: {}
    }, spec);
  }

  FA.actions = {
    make: make,

    /** 常用按钮工厂 —— 保持文案统一，避免同一动作在对话里出现多种叫法 */
    factory: {
      assess: function () {
        return make({
          label: '立即研判积水易发风险',
          kind: 'tool',
          tool: 'assess_flood_risk',
          tone: 'primary',
          group: '风险研判',
          hint: '按当前雨量重算各网格的积水易发风险等级与主要成因'
        });
      },
      priority: function () {
        return make({
          label: '识别优先保障群体',
          kind: 'tool',
          tool: 'identify_priority_groups',
          tone: 'primary',
          group: '风险研判',
          hint: '叠加社会脆弱性，回答「谁更需要优先保护」'
        });
      },
      gap: function () {
        return make({
          label: '核查资源缺口',
          kind: 'tool',
          tool: 'analyze_resource_gap',
          group: '资源与调度',
          hint: '对照安置容量、座位、无障碍位与可达性，算出现有能力与需求之差'
        });
      },
      optimize: function () {
        return make({
          label: '生成调度方案',
          kind: 'tool',
          tool: 'optimize_dispatch',
          args: { objective: 'risk_first' },
          tone: 'primary',
          group: '资源与调度',
          hint: '在容量、座位、无障碍位、路网约束下生成人员—避难点—车辆匹配方案'
        });
      },
      why: function () {
        return make({
          label: '为什么这样调度',
          kind: 'tool',
          tool: 'explain_plan',
          group: '资源与调度',
          hint: '给出方案的可解释依据：高风险优先、容量约束、路网代价'
        });
      },
      scenario: function () {
        return make({
          label: '情景推演 80 / 120 / 160 mm',
          kind: 'tool',
          tool: 'simulate_rainfall_scenario',
          args: { steps: [80, 120, 160] },
          group: '情景推演',
          hint: '同一输入快照下重算三档雨情的风险、受影响人口、脆弱人口、资源缺口'
        });
      },
      rag: function (query) {
        return make({
          label: '查预案依据',
          kind: 'tool',
          tool: 'search_plan_knowledge',
          args: { query: query || '强降雨 人员转移 优先顺序', topK: 3 },
          group: '预案依据',
          hint: '检索公开防汛预案与应急规范，为建议提供可引用依据'
        });
      },
      createTasks: function () {
        return make({
          label: '生成转移任务',
          kind: 'tool',
          tool: 'create_dispatch_tasks',
          group: '执行闭环',
          hint: '把方案落成可执行任务，写入状态并推动工作流'
        });
      },
      publish: function () {
        return make({
          label: '确认并模拟发布',
          kind: 'tool',
          tool: 'publish_dispatch_plan',
          tone: 'danger',
          group: '执行闭环',
          requiresConfirm: true,
          hint: '需人工确认后执行；发布后生成可直接粘贴到现有政务通讯工具的通知文本'
        });
      },
      report: function () {
        return make({
          label: '生成应急决策报告',
          kind: 'tool',
          tool: 'compose_decision_report',
          group: '交付物',
          hint: '输出含数据依据、边界声明与优化前后对比的报告，可导出用于 PPT'
        });
      },
      exportGov: function () {
        return make({
          label: '导出政务通知文本',
          kind: 'tool',
          tool: 'export_for_gov_channel',
          group: '交付物',
          hint: '取消独立接收端：生成可粘贴到现有政务通讯工具的通知文本'
        });
      },
      compliance: function () {
        return make({
          label: '合规与边界自查',
          kind: 'tool',
          tool: 'check_compliance',
          group: '交付物',
          hint: '自查地图规范、数据公开性、表述边界与免责声明是否到位'
        });
      },
      replan: function () {
        return make({
          label: '按新变化重新研判',
          kind: 'tool',
          tool: 'evaluate_trigger',
          args: { force: true },
          tone: 'primary',
          group: '执行闭环',
          hint: '忽略阈值与冷却期，强制执行一次重新研判'
        });
      },
      advanceRain: function (mm) {
        return make({
          label: '口播雨量 +' + (mm || 20) + ' mm',
          kind: 'rainfall',
          args: { deltaMm: mm || 20 },
          group: '演示控制',
          hint: '模拟动态变化的口播雨量，用于演示触发阈值与闭环重算'
        });
      },
      stateNow: function () {
        return make({
          label: '查看当前状态',
          kind: 'tool',
          tool: 'get_system_state',
          group: '查看',
          hint: '读取任务、雨量与方案的最新状态'
        });
      },
      showMap: function () {
        return make({
          label: '在地图上查看风险',
          kind: 'view',
          args: { view: 'monitor-map' },
          group: '查看',
          hint: '定位到左栏实时监控地图；长按地图可提交险情修改'
        });
      },
      followUp: function (label, prompt, hint) {
        return make({ label: label, kind: 'prompt', prompt: prompt, group: '追问', hint: hint || '' });
      }
    },

    /**
     * 执行一个动作。
     * @returns {Promise|object} kind='tool' 时返回工具执行结果
     */
    dispatch: function (action, context) {
      context = context || {};
      if (!action || !action.kind) return { ok: false, message: '非法动作' };

      switch (action.kind) {
        case 'tool':
          return FA.tools.execute(action.tool, Object.assign({}, action.args, {
            _actor: context.actor || null,
            _confirmToken: action.args && action.args._confirmToken
          }), { source: context.source || 'action-button', buttonId: action.id });

        case 'prompt':
          if (!FA.agent || !FA.agent.handleUserMessage) return { ok: false, message: '智能体未就绪' };
          return FA.agent.handleUserMessage(action.prompt, { source: 'action-button' });

        case 'rainfall': {
          var res = FA.store.advanceRainfall(action.args.deltaMm, '演示口播 +' + action.args.deltaMm + ' mm');
          var ev = FA.triggers.evaluate();
          FA.bus.emit('trigger:evaluated', ev);
          return Object.assign({ ok: res.ok, trigger: ev }, res);
        }

        case 'scenario':
          return FA.store.applyScenario(action.args.scenarioId);

        case 'view':
          FA.bus.emit('view:focus', action.args || {});
          return { ok: true };

        case 'export':
          FA.bus.emit('export:request', action.args || {});
          return { ok: true };

        case 'confirm':
          // 由界面在真实点击时调用，actor 必须来自界面
          return FA.confirm.approve(action.args.token, context.actor);

        default:
          return { ok: false, message: '未知动作类型：' + action.kind };
      }
    },

    /** 把动作列表按 group 归拢，供界面分组渲染 */
    groupActions: function (list) {
      var out = [];
      (list || []).forEach(function (a) {
        var g = out.find(function (x) { return x.group === a.group; });
        if (!g) { g = { group: a.group, actions: [] }; out.push(g); }
        g.actions.push(a);
      });
      return out;
    }
  };
})(window.FA = window.FA || {});
