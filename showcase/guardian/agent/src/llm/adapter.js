/*!
 * 城市韧性守护 Agent · 大模型适配层（统一接口）
 * ---------------------------------------------------------------
 * 会议纪要：「大模型账号：Codex 大模型账号；后续开发如需购买可向导师申请报销」
 *           「开发AI智能体，并预留空的API接口」
 *
 * 因此这里的设计是：
 *   1. 默认 provider = 'offline'：离线规则引擎，不需要任何密钥、不联网，
 *      断网、额度用尽、现场网络抖动都不会让演示失败。
 *   2. 预留空的 API 接口：填入 baseUrl 与 apiKey 后把 provider 改为
 *      'openai-compatible'（Codex / OpenAI 兼容端点均可），工具契约完全不变。
 *   3. 两条路径对上层完全等价：都返回 {content, toolCalls, usage}。
 *      因此「换成大模型」不会改动任何工具、界面或工作流代码。
 *
 * 诚实性要求：界面与报告必须显示当前实际使用的是哪条路径，
 * 不得把离线规则引擎的输出表述为大模型能力。
 */
(function (FA) {
  'use strict';

  var providers = {};
  var lastActual = null;
  var inTurn = false;
  var turnResults = [];
  var turnFailed = false;

  function configKey(c) {
    // Only used in memory to invalidate a stale description; never exported.
    return JSON.stringify([c.provider, c.gatewayUrl, c.baseUrl, c.apiKey, c.model, c.allowNetwork]);
  }

  function describeResults(results, c) {
    var used = [];
    results.forEach(function (r) { if (used.indexOf(r.provider) < 0) used.push(r.provider); });
    var mixed = used.length > 1;
    var name = mixed ? 'mixed' : (used[0] || 'offline');
    var fellBack = results.some(function (r) { return !!r.fellBack; });
    var label = mixed ? '混合路径（在线大模型 + 离线规则引擎）' :
      (providers[name] ? providers[name].label : '离线规则引擎');
    var actualModel = results.reduce(function (value, r) { return r.model || value; }, c.model || null);
    var disclosure = mixed
      ? '本轮部分步骤使用在线大模型，部分步骤已回落离线规则引擎；不能将本轮全部任务理解归因于大模型。数值仍由本地工具计算。'
      : name === 'offline'
        ? (fellBack ? '在线大模型未能完成调用，本次任务理解不是大模型完成的；已回落离线规则引擎并留痕。数值仍由本地工具计算。' : '当前使用离线规则引擎整理任务并选择工具。所有数值均由本地统计模型与调度算法计算，不联网。')
        : '本轮通过' + (name === 'local-gateway' ? '本机后端代理' : '前端直连') + '使用大模型' + (actualModel ? '（' + actualModel + '）' : '') + '做任务理解与工具编排；数值仍由本地工具计算。';
    return {
      provider: name, providerLabel: label, usedProviders: used, requestedProvider: c.provider,
      mode: mixed ? 'mixed' : name === 'offline' ? 'offline' : 'online', fellBack: fellBack,
      model: actualModel, disclosure: disclosure,
      badgeLabel: mixed ? '运行路径：在线 + 离线回落（混合）' : name === 'offline'
        ? (fellBack ? '运行路径：离线规则引擎（本轮在线回落）' : '运行路径：离线规则引擎（API 接口已预留）')
        : '运行路径：' + (name === 'local-gateway' ? '本机代理' : '前端直连') + '（大模型）'
    };
  }

  FA.llm = {
    /** Defaults only. Human-facing configuration is exclusively agent/api-config.js. */
    config: {
      provider: 'offline',      // offline | local-gateway | openai-compatible
      gatewayUrl: '',
      baseUrl: '',              // 例如 https://api.openai.com/v1 或 Codex 兼容端点
      apiKey: '',               // 留空即不联网
      model: '',                // 例如 gpt-5-codex / 自建模型名
      organization: '',
      temperature: 0.2,
      maxTokens: 1200,
      timeoutMs: 30000,
      allowNetwork: false,      // 安全默认：不主动联网
      maxToolRounds: 4,         // 一次对话内最多几轮工具调用
      /** 系统提示词：与分析工具和边界声明保持一致 */
      systemPrompt: [
        '你是「城市韧性守护 Agent」，面向暴雨洪涝的脆弱人群预警与应急资源调度。',
        '你的职责是理解指挥员的自然语言任务，调用工具完成风险研判、脆弱性分析、资源缺口核查、调度优化、预案检索与情景推演，并给出可解释、可追溯的行动方案。',
        '硬性要求：',
        '1) 不预测具体积水深度，统一使用「积水易发风险」表述；风险由统计模型计算，你不替代模型做数值计算。',
        '2) 每一步结论都必须来自工具返回结果，不得编造数据、区域、规定或引用。',
        '3) 调度方案需人工确认后执行；你绝不能自行批准发布。',
        '4) 资源不足时必须如实保留未安排人员与缺口，不得把部分方案表述为全部解决。',
        '5) 不使用「精确预测」「保证」等表述，不把算法收益表述为 AI 效果。',
        '6) 每次回复都要附带下一步动作按钮，并说明为什么建议这一步。'
      ].join('\n')
    },

    register: function (name, impl) { providers[name] = impl; },
    providerNames: function () { return Object.keys(providers); },
    get: function (name) { return providers[name] || null; },

    /** 当前生效的 provider（配置缺失时自动回落到离线） */
    active: function () {
      var c = this.config;
      var p = providers[c.provider];
      if (!p) return providers.offline;
      if (!p.available()) return providers.offline;
      return p;
    },

    /** 当前路径说明：必须如实显示在界面上 */
    describe: function () {
      var c = this.config;
      var active = this.active();
      var configured = c.provider === 'local-gateway' ? !!c.gatewayUrl : !!(c.baseUrl && c.apiKey && c.model);
      var actual = lastActual && lastActual.key === configKey(c) ? lastActual.description : null;
      if (!actual) {
        actual = describeResults([{ provider: active.name, fellBack: c.provider !== 'offline' && active.name === 'offline' }], c);
        if (active.name !== 'offline') {
          actual.badgeLabel = '运行路径：' + (active.name === 'local-gateway' ? '本机代理' : '前端直连') + '（待首次调用）';
          actual.disclosure = '已配置在线路径，尚未验证本次调用。实际执行结果会在每轮回复与轨迹中标注。';
        }
      }
      return Object.assign({}, actual, {
        configured: configured,
        networkEnabled: !!c.allowNetwork,
        apiSlot: {
          ready: configured,
          path: 'dist/guardian/agent/api-config.js',
          hint: '自己接入 API：编辑 dist/guardian/agent/api-config.js。推荐 local-gateway，仅填写 gatewayUrl 并启用 allowNetwork；密钥留在后端 .env。'
        }
      });
    },

    beginTurn: function () { inTurn = true; turnResults = []; turnFailed = false; },
    finishTurn: function () {
      if (turnResults.length) lastActual = { key: configKey(this.config), description: describeResults(turnResults, this.config) };
      inTurn = false;
      return this.describe();
    },

    /** 暴露给模型的工具声明（OpenAI / Codex 兼容格式） */
    toolSpec: function () { return FA.tools.toOpenAiSchema(); },

    /**
     * 统一的对话补全入口。
     * @param {Array} messages [{role:'system'|'user'|'assistant'|'tool', content, toolCallId?}]
     * @param {object} opts { tools, state }
     * @returns {Promise|object} { provider, content, toolCalls:[{name,args,id}], usage }
     */
    complete: function (messages, opts) {
      var p = inTurn && turnFailed ? providers.offline : this.active();
      var started = Date.now();
      var self = this;
      if (p.name === 'offline' && this.config.provider !== 'offline' && !(inTurn && turnFailed)) {
        var requested = providers[this.config.provider];
        return this.fallback(new Error(requested && requested.unavailableReason ? requested.unavailableReason() : '未知运行路径，已使用离线规则引擎'), messages, opts);
      }
      try {
        var res = p.complete(messages, Object.assign({ tools: this.toolSpec(), config: this.config, systemPrompt: this.config.systemPrompt }, opts || {}));
        if (res && typeof res.then === 'function') {
          return res.then(function (r) { return self.record(self.decorate(r, p, started)); })
            .catch(function (err) { return self.fallback(err, messages, opts); });
        }
        return this.record(this.decorate(res, p, started));
      } catch (err) {
        return this.fallback(err, messages, opts);
      }
    },

    /** 在线路径失败时回落离线引擎，并如实留痕 */
    fallback: function (err, messages, opts) {
      if (inTurn) turnFailed = true;
      var detail = String(err && err.message || err);
      if (this.config.apiKey) detail = detail.split(this.config.apiKey).join('[密钥已隐藏]');
      FA.trace.push('warn', '在线大模型不可用，本次已回落离线规则引擎', {
        detail: detail.slice(0, 240) + ' —— 本次任务理解不是大模型完成的；数值仍由本地工具计算，请核对本轮结果。'
      });
      var res = providers.offline.complete(messages, Object.assign({ tools: this.toolSpec(), config: this.config }, opts || {}));
      var self = this;
      var offlineProvider = providers.offline;
      var startedAt = Date.now();
      if (res && typeof res.then === 'function') {
        return res.then(function (r) { return self.record(self.decorate(Object.assign(r, { fellBack: true }), offlineProvider, startedAt)); });
      }
      return this.record(this.decorate(Object.assign(res, { fellBack: true }), offlineProvider, startedAt));
    },

    record: function (res) {
      if (inTurn) turnResults.push(res);
      lastActual = { key: configKey(this.config), description: describeResults(inTurn ? turnResults : [res], this.config) };
      return res;
    },

    decorate: function (res, provider, startedAt) {
      return Object.assign({
        latencyMs: Date.now() - startedAt,
        content: '',
        toolCalls: [],
        usage: null
      }, res || {}, { provider: provider.name, providerLabel: provider.label });
    },

    /** 会话级切换（供演示：现场对比离线与大模型两条路径） */
    use: function (name) {
      if (!providers[name]) return { ok: false, message: '未知 provider：' + name };
      if (!providers[name].available()) {
        return {
          ok: false,
          message: providers[name].label + ' 当前不可用。' + (providers[name].unavailableReason ? providers[name].unavailableReason() : '')
        };
      }
      this.config.provider = name;
      lastActual = null;
      FA.trace.push('decision', '已切换智能体运行路径：' + providers[name].label, {
        detail: providers[name].name === 'offline'
          ? '使用离线规则引擎，不联网。'
          : '使用在线大模型，需网络与密钥，现场演示前务必先验证。'
      });
      return { ok: true, provider: providers[name].name, label: providers[name].label };
    }
  };

  // Allow only public configuration fields; a config file cannot replace the system boundary prompt.
  var supplied = window.GUARDIAN_API_CONFIG && window.GUARDIAN_API_CONFIG.llm || {};
  ['provider', 'gatewayUrl', 'baseUrl', 'apiKey', 'model', 'organization', 'temperature', 'maxTokens', 'timeoutMs', 'maxToolRounds'].forEach(function (key) {
    if (Object.prototype.hasOwnProperty.call(supplied, key)) FA.llm.config[key] = supplied[key];
  });
  FA.llm.config.allowNetwork = supplied.allowNetwork === true;
  FA.llm.config.maxToolRounds = Math.max(1, Math.min(12, Math.floor(Number(FA.llm.config.maxToolRounds) || 4)));
})(window.FA = window.FA || {});
