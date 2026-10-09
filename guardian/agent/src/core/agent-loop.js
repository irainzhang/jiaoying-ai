/*!
 * 城市韧性守护 Agent · 智能体主循环
 * ---------------------------------------------------------------
 * 循环：感知 → 任务理解（规划）→ 调用工具 → 观察结果 → 生成回复（附带动作按钮）
 *
 * 会议纪要的两条硬要求在代码里怎么落地：
 *   - 「助手回复必须附带动作按钮」：composeReply 里若动作按钮为空，
 *     会强制补上默认动作集，因此任何一条回复都不可能没有按钮。
 *   - 「智能体需调用工具修改状态并推动工作流」：回复的动作按钮全部是
 *     FA.actions.dispatch 的入口，点击即调用工具并写状态。
 *
 * 与运行路径无关：离线规则引擎和在线大模型返回同一结构，
 * 因此「换成大模型」不需要改这里的任何一行。
 */
(function (FA) {
  'use strict';

  function defaultActions() {
    return [
      FA.actions.factory.assess(),
      FA.actions.factory.optimize(),
      FA.actions.factory.scenario(),
      FA.actions.factory.rag('强降雨 人员转移 优先顺序')
    ];
  }

  function dedupeActions(list) {
    var seen = {};
    return (list || []).filter(function (a) {
      if (!a) return false;
      var key = a.kind + '|' + (a.tool || a.prompt || a.label) + '|' + JSON.stringify(a.args || {});
      if (seen[key]) return false;
      seen[key] = true;
      return true;
    });
  }

  function dedupeWarnings(list) {
    var seen = {};
    return (list || []).filter(function (w) {
      if (!w) return false;
      if (seen[w]) return false;
      seen[w] = true;
      return true;
    });
  }

  /** 工具结果 → 人类可读的一步 */
  function stepLine(res, index) {
    var label = res.toolLabel || res.tool;
    return (index + 1) + '. **' + label + '** — ' + (res.summary || (res.ok ? '完成' : '未完成'));
  }

  function composeReply(turn) {
    var results = turn.toolResults.filter(Boolean);
    var lines = [];
    var needConfirm = results.filter(function (r) { return r.needConfirm; });
    var failed = results.filter(function (r) { return r.ok === false && !r.needConfirm; });

    // ---- 未识别：如实说明，不硬猜 ----
    if (turn.planner && turn.planner.unhandled) {
      lines.push('离线规则引擎没有识别出这句话对应的任务，因此**没有调用任何工具**，也没有给出结论。');
      lines.push('');
      lines.push('离线引擎只在预置意图范围内工作。要处理开放域问题，请配置大模型接口（`agent/api-config.js`），' +
        '或直接点下面的按钮。');
      return {
        text: lines.join('\n'),
        actions: defaultActions(),
        warnings: ['这一轮没有产生任何分析结论，请勿把本回复当作研判结果。'],
        citations: []
      };
    }

    // ---- 没有工具调用：引导型回复（寒暄或需要澄清） ----
    if (!results.length) {
      lines.push(turn.content && turn.content.indexOf('__UNHANDLED__') !== 0
        ? turn.content
        : '我可以用工具完成：积水易发风险评估、社会脆弱性与优先保障群体识别、路网可达性分析、资源缺口核查、人员转移与应急资源调度、公开预案依据检索、降雨情景推演、任务生成与执行闭环跟踪。');
      lines.push('');
      lines.push('建议从「完整研判」开始：一句话就能走完『暴雨来了 → 哪里最危险 → 谁最需要保护 → 资源够不够 → 资源派到哪里』的链路。');
      return {
        text: lines.join('\n'),
        actions: dedupeActions([
          FA.actions.factory.followUp('完整研判一遍', '帮我做一次完整的研判和调度建议', '按顺序串起全部工具'),
          FA.actions.factory.followUp('看当前状态', '现在什么情况？', '读取状态快照')
        ].concat(defaultActions())),
        warnings: [],
        citations: []
      };
    }

    // ---- 有工具结果：结论 + 执行过程 ----
    var lead = results[results.length - 1];
    lines.push('**结论**：' + (lead.summary || '本步已完成。'));

    if (needConfirm.length) {
      lines.push('');
      lines.push('**需要人工确认**：' + needConfirm.map(function (r) { return r.toolLabel || r.tool; }).join('、') +
        ' 属于需确认的操作，已暂停等待你的确认。智能体不会自行批准。');
    }
    if (failed.length) {
      lines.push('');
      lines.push('**未完成的步骤**：' + failed.map(function (r) { return (r.toolLabel || r.tool) + '（' + r.summary + '）'; }).join('；'));
    }

    if (results.length > 1) {
      lines.push('');
      lines.push('**执行过程**（' + results.length + ' 步，全部由工具实际计算）：');
      results.forEach(function (r, i) { lines.push(stepLine(r, i)); });
    }

    // ---- 关键数据摘要：取最后一步里最有信息量的字段 ----
    var data = lead.data || {};
    var facts = [];
    if (data.metrics) {
      facts.push('已安排 ' + data.metrics.servedPeople + '/' + data.metrics.totalPeople + ' 人');
      facts.push('未安排 ' + data.metrics.unassignedPeople + ' 人');
      facts.push('加权等待 ' + data.metrics.weightedWait + ' 人·分钟（基线 ' + (data.comparison && data.comparison.metrics ? data.comparison.metrics.weightedWait.baseline : '—') + '）');
      if (data.metrics.finishMinute) facts.push('完成时间 ' + data.metrics.finishMinute + ' 分钟');
      if (data.validation) facts.push('约束校验' + (data.validation.ok ? '通过' : '未通过'));
    }
    if (data.gaps && data.gaps.length) facts.push('资源缺口 ' + data.gaps.length + ' 项');
    if (data.hits && data.hits.length) facts.push('预案依据 ' + data.hits.length + ' 条');
    if (data.results && data.results.length) facts.push('推演 ' + data.results.length + ' 档雨情');
    if (data.trigger) facts.push('触发判定：' + (data.trigger.shouldReplan ? '达到重算阈值' : '未达阈值'));
    if (data.stats) facts.push('任务进度 ' + data.stats.total + ' 条（已到达 ' + (data.stats.byStage.arrived || 0) + '）');
    if (facts.length) {
      lines.push('');
      lines.push('**关键数据**：' + facts.join('；') + '。');
    }

    var byGroup = FA.actions.groupActions(dedupeActions(
      needConfirm.length
        ? needConfirm[0].actions
        : [].concat(lead.actions || [], results.length > 1 ? (results[results.length - 2].actions || []).slice(0, 1) : [])
    ));
    var actionList = needConfirm.length ? (needConfirm[0].actions || []) : [].concat(lead.actions || []);
    if (actionList.length < 2) actionList = actionList.concat(defaultActions());
    actionList = dedupeActions(actionList);

    return {
      text: lines.join('\n'),
      actions: actionList,
      actionGroups: FA.actions.groupActions(actionList),
      citations: results.reduce(function (acc, r) { return acc.concat(r.citations || []); }, []),
      warnings: dedupeWarnings(results.reduce(function (acc, r) { return acc.concat(r.warnings || []); }, [])).slice(0, 8)
    };
  }

  FA.agent = {
    messages: [],
    lastTurn: null,
    busy: false,

    reset: function () {
      this.messages = [];
      this.lastTurn = null;
      FA.trace.push('decision', '已开始新的对话', { detail: '历史消息已清空；演练状态未重置。' });
      FA.bus.emit('agent:reset', null);
      return { ok: true };
    },

    /** 导出对话记录（用于报告附录与答辩备查） */
    history: function () {
      return this.messages.map(function (m) {
        return { role: m.role, content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content || ''), at: m.at };
      });
    },

    /**
     * 处理一句自然语言指令。
     * @param {string} text
     * @param {object} [opts] { source }
     * @returns {Promise|object} turn
     */
    handleUserMessage: function (text, opts) {
      opts = opts || {};
      var self = this;
      var started = Date.now();
      var clean = String(text == null ? '' : text).trim();

      if (this.busy) return Promise.resolve({
        ok: false, busy: true, text: '上一轮仍在执行，请等待完成后再提交。',
        actions: [], toolResults: [], warnings: [], citations: [],
        provider: { provider: 'local-status', providerLabel: '本地执行状态提示', mode: 'offline', disclosure: '本地执行状态提示，不改变业务数据。' }
      });

      if (!clean) {
        return {
          ok: false,
          text: '请输入指令，例如「未来 6 小时 120 毫米，帮我做一次完整的研判和调度建议」。',
          actions: defaultActions(),
          toolResults: [],
          warnings: [],
          citations: []
        };
      }

      this.busy = true;
      FA.trace.push('perceive', '收到指令：' + clean.slice(0, 60) + (clean.length > 60 ? '…' : ''), {
        detail: '来源：' + (opts.source === 'action-button' ? '动作按钮' : '指挥员输入')
      });

      var userMsg = { role: 'user', content: clean, at: FA.util.nowIso() };
      this.messages.push(userMsg);

      var llmCfg = FA.llm.config;
      var maxRounds = llmCfg.maxToolRounds || 4;
      FA.llm.beginTurn();

      function runRound(round) {
        if (round > maxRounds) {
          FA.trace.push('warn', '达到工具调用轮次上限', { detail: '为避免无限循环，本轮停止继续调用工具。' });
          return Promise.resolve({ content: '', toolCalls: [], planner: { intent: 'round-limit', intentLabel: '轮次上限' } });
        }
        var res = FA.llm.complete(self.messages, {});
        return Promise.resolve(res).then(function (r) {
          if (!r.toolCalls || !r.toolCalls.length) return r;

          // 记录「真正做出规划」那一轮的意图。
          // 后续轮次只会返回“汇总工具结果”，不能让它覆盖掉原始意图，
          // 否则「本轮是否完成了一次重算」这类判断会失效。
          if (!turn.planner && r.planner && r.planner.intent !== 'compose') turn.planner = r.planner;

          var calls = r.toolCalls.map(function (tc) {
            return { id: tc.id || FA.util.uid('tc'), name: tc.name, args: tc.args || {} };
          });
          self.messages.push({ role: 'assistant', content: r.content || '', toolCalls: calls, at: FA.util.nowIso() });

          // 依序执行工具：后面的工具可能依赖前面写入的状态
          return calls.reduce(function (chain, tc) {
            return chain.then(function () {
              var out = FA.tools.execute(tc.name, Object.assign({}, tc.args, { _source: opts.source || 'chat' }), {
                source: opts.source || 'chat'
              });
              return Promise.resolve(out).then(function (result) {
                self.messages.push({
                  role: 'tool',
                  name: tc.name,
                  toolCallId: tc.id,
                  content: JSON.stringify({
                    ok: result.ok,
                    summary: result.summary,
                    needConfirm: !!result.needConfirm
                  }),
                  at: FA.util.nowIso()
                });
                turn.toolResults.push(result);
              });
            });
          }, Promise.resolve()).then(function () {
            return runRound(round + 1);
          });
        });
      }

      var turn = {
        ok: true,
        input: clean,
        at: FA.util.nowIso(),
        startedAt: started,
        toolResults: [],
        provider: null,
        planner: null,
        text: '',
        actions: [],
        citations: [],
        warnings: [],
        elapsedMs: 0
      };

      return runRound(1).then(function (finalRes) {
        turn.provider = FA.llm.finishTurn();
        turn.fellBack = turn.provider.fellBack;
        // 保留做出规划的意图；只有从未规划过（例如引导型回复）才用最后一步的结果
        if (!turn.planner) turn.planner = finalRes.planner || null;
        turn.content = finalRes.content || '';

        var composed = composeReply({
          toolResults: turn.toolResults,
          content: turn.content,
          planner: turn.planner
        });
        turn.text = composed.text;
        turn.actions = composed.actions;
        turn.actionGroups = composed.actionGroups;
        turn.citations = composed.citations;
        turn.warnings = composed.warnings;
        if (turn.fellBack) turn.warnings.push(turn.provider.disclosure);
        turn.needConfirm = turn.toolResults.some(function (r) { return r.needConfirm; });
        turn.elapsedMs = Date.now() - started;

        // 完整链路 / 调度 / 触发重算之后：清空累积变化并记录重算时间
        var names = turn.toolResults.map(function (r) { return r.tool; });
        var replanned = names.indexOf('optimize_dispatch') >= 0 &&
          (turn.planner && /full-pipeline|dispatch|trigger|replan/.test(turn.planner.intent || ''));
        if (replanned) {
          FA.store.clearPendingChanges({ replan: true });
          FA.trace.push('decision', '已按最新输入完成重新研判', {
            detail: '方案已重算，累积变化计数已清零，重算时间已记录（用于最短重算间隔）。'
          });
        }

        turn.ok = !(turn.toolResults.length === 1 && turn.toolResults[0].ok === false && turn.toolResults[0].needConfirm);

        self.messages.push({ role: 'assistant', content: turn.text, at: FA.util.nowIso() });
        if (self.messages.length > 60) self.messages = self.messages.slice(-60);

        self.lastTurn = turn;
        FA.trace.push('decision', '回复已生成（含 ' + turn.actions.length + ' 个动作按钮）', {
          detail: '运行路径：' + turn.provider.providerLabel + '；耗时 ' + turn.elapsedMs + ' ms。' + turn.provider.disclosure
        });
        FA.bus.emit('agent:turn', turn);
        return turn;
      }).finally(function () {
        self.busy = false;
        FA.llm.finishTurn();
      });
    },

    /** 供界面/桥接使用的动作执行入口 */
    runAction: function (action, context) {
      var self = this;
      var out = FA.actions.dispatch(action, context);
      return Promise.resolve(out).then(function (res) {
        FA.bus.emit('agent:action', { action: action, result: res });
        return res;
      });
    }
  };
})(window.FA = window.FA || {});
