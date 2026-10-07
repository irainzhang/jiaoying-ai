/*!
 * 城市韧性守护 Agent · 兼容 Chat Completions 的可选连接器
 * 唯一填写位置：agent/api-config.js。默认不联网。
 * local-gateway: 完整端点；不向浏览器索要密钥；model 可由后端 .env 提供。
 * openai-compatible: 仅供本机临时演示；禁止把真实密钥发布到 GitHub Pages。
 */
(function (FA) {
  'use strict';

  function endpoint(config, gateway) {
    var value = gateway ? config.gatewayUrl : config.baseUrl;
    if (typeof value !== 'string' || !value.trim()) throw new Error(gateway ? '缺少 gatewayUrl' : '缺少 baseUrl');
    var url;
    try { url = new URL(value); } catch (e) { throw new Error('API 地址必须是完整的 HTTP(S) 地址'); }
    if (url.username || url.password || url.search || url.hash) throw new Error('API 地址不得包含凭据、查询参数或片段');
    var loopback = /^(localhost|127\.0\.0\.1|\[::1\])$/i.test(url.hostname);
    if (url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) throw new Error('API 地址须使用 HTTPS，或本机回环 HTTP');
    return gateway ? url.href : url.href.replace(/\/+$/, '') + '/chat/completions';
  }

  function missing(config, gateway) {
    var lack = [];
    try { endpoint(config, gateway); } catch (e) { lack.push(e.message); }
    if (!gateway && !config.apiKey) lack.push('apiKey');
    if (!gateway && !config.model) lack.push('model');
    if (config.allowNetwork !== true) lack.push('allowNetwork=true');
    if (typeof fetch !== 'function') lack.push('运行环境不支持 fetch');
    return lack;
  }

  function complete(messages, opts, gateway) {
    var config = FA.llm.config;
    var lack = missing(config, gateway);
    if (lack.length) return Promise.reject(new Error('在线路径不可用，缺少或需要修正：' + lack.join('、')));
    var body = {
      messages: (messages || []).map(function (m) {
        var out = { role: m.role, content: m.content == null ? '' : m.content };
        if (m.toolCallId) { out.role = 'tool'; out.tool_call_id = m.toolCallId; }
        if (m.name) out.name = m.name;
        if (m.toolCalls) out.tool_calls = m.toolCalls.map(function (tc) {
          return { id: tc.id, type: 'function', function: { name: tc.name, arguments: JSON.stringify(tc.args || {}) } };
        });
        return out;
      }),
      tools: (opts && opts.tools) || FA.llm.toolSpec(),
      tool_choice: 'auto', temperature: config.temperature, max_tokens: config.maxTokens
    };
    // An omitted model is intentional in gateway mode: the backend owns the default model and key.
    if (config.model) body.model = config.model;
    // Always use our boundary prompt, not a prior message's replacement system prompt.
    body.messages = body.messages.filter(function (m) { return m.role !== 'system'; });
    body.messages.unshift({ role: 'system', content: config.systemPrompt });
    var headers = { 'Content-Type': 'application/json' };
    if (!gateway) {
      headers.Authorization = 'Bearer ' + config.apiKey;
      if (config.organization) headers['OpenAI-Organization'] = config.organization;
    }
    var controller = typeof AbortController === 'function' ? new AbortController() : null;
    var timeout = Math.max(100, Math.min(120000, Number(config.timeoutMs) || 30000));
    var timer;
    FA.trace.push('plan', gateway ? '通过本机代理请求大模型' : '通过前端直连请求大模型', {
      detail: '模型 ' + (config.model || '由服务端配置') + '；工具 ' + body.tools.length + ' 项。数值仍由本地工具计算。'
    });
    var request = Promise.resolve().then(function () {
      return fetch(endpoint(config, gateway), {
        method: 'POST', headers: headers, body: JSON.stringify(body),
        signal: controller ? controller.signal : undefined,
        credentials: 'omit', redirect: 'error', cache: 'no-store'
      });
    }).then(function (res) {
      // Do not expose upstream error bodies: they may contain provider credentials or diagnostics.
      if (!res || !res.ok) throw new Error('大模型请求失败（HTTP ' + (res && res.status || '未知') + '）');
      return res.json();
    }).then(function (json) {
      var msg = json && json.choices && json.choices[0] && json.choices[0].message;
      if (!msg || typeof msg !== 'object' || (msg.content != null && typeof msg.content !== 'string')) throw new Error('大模型返回结构无效');
      if (msg.tool_calls != null && !Array.isArray(msg.tool_calls)) throw new Error('大模型工具调用结构无效');
      if (!(typeof msg.content === 'string' && msg.content.trim()) && !(msg.tool_calls && msg.tool_calls.length)) throw new Error('大模型返回空内容');
      if (msg.tool_calls && msg.tool_calls.length > 32) throw new Error('大模型单轮工具调用数量超限');
      var toolCalls = (msg.tool_calls || []).map(function (tc) {
        if (!tc || !tc.function || typeof tc.function.name !== 'string' || typeof tc.function.arguments !== 'string') throw new Error('大模型工具调用缺少名称或 JSON 参数');
        var args;
        try { args = JSON.parse(tc.function.arguments || '{}'); } catch (e) { throw new Error('大模型工具调用参数不是有效 JSON'); }
        if (!args || typeof args !== 'object' || Array.isArray(args)) throw new Error('大模型工具调用参数必须是对象');
        // Private approval metadata must never originate from a model response.
        Object.keys(args).forEach(function (key) { if (key.charAt(0) === '_') delete args[key]; });
        return { id: tc.id || FA.util.uid('tc'), name: tc.function.name, args: args };
      });
      return { content: msg.content || '', toolCalls: toolCalls, usage: json.usage || null, model: json.model || config.model || null };
    });
    var deadline = new Promise(function (_, reject) {
      timer = setTimeout(function () {
        if (controller) controller.abort();
        reject(new Error('大模型调用超时，已停止等待'));
      }, timeout);
    });
    return Promise.race([request, deadline]).then(function (result) {
      clearTimeout(timer); return result;
    }, function (err) {
      clearTimeout(timer);
      // Fetch errors are deliberately generic so a URL/key echoed by a runtime cannot reach the UI.
      var safe = /^(大模型|API 地址|在线路径)/.test(String(err && err.message || ''));
      throw new Error(safe ? err.message : '大模型网络连接失败');
    });
  }

  ['local-gateway', 'openai-compatible'].forEach(function (name) {
    var gateway = name === 'local-gateway';
    FA.llm.register(name, {
      name: name,
      label: gateway ? '本机代理大模型' : '前端直连大模型',
      available: function () { return missing(FA.llm.config, gateway).length === 0; },
      unavailableReason: function () {
        var lack = missing(FA.llm.config, gateway);
        return lack.length ? '请在 agent/api-config.js 修正：' + lack.join('、') + '。' : '';
      },
      complete: function (messages, opts) { return complete(messages, opts, gateway); }
    });
  });
})(window.FA = window.FA || {});
