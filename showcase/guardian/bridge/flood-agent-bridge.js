/*!
 * 城市韧性守护 Agent · 宿主页面桥（postMessage 双向通信）
 * ---------------------------------------------------------------
 * 给「叫应 AI · 瑞安协同演练」这类现有系统用：宿主页面只用 3 行代码
 * 就能把智能体面板挂进来，并通过事件与命令双向联动。
 *
 * 用法（宿主页面）：
 *   <div id="agent-slot"></div>
 *   <script src="../bridge/flood-agent-bridge.js"></script>
 *   <script>
 *     const agent = FloodAgent.mount({
 *       container: '#agent-slot',
 *       agentUrl: '../agent/embed.html',
 *       height: 820,
 *       onTurn: t => console.log('智能体回复', t.text),
 *       onPublished: p => console.log('方案已发布', p)
 *     });
 *     agent.send('帮我做一次完整的研判和调度建议');
 *   </script>
 *
 * 安全与边界：
 *   - 只接受来自该 iframe 自身的消息（比对 event.source），不信任其它窗口；
 *   - 发布类操作在智能体内部有「人工确认闸门」，宿主无法绕过，
 *     宿主也拿不到自动批准的捷径——这是刻意的设计。
 */
(function (global) {
  'use strict';

  var SOURCE_CHILD = 'flood-agent';
  var SOURCE_HOST = 'jiaoying-host';
  var PROTOCOL_VERSION = '3.7.0-guardian';

  function createEmitter() {
    var listeners = {};
    return {
      on: function (type, fn) { (listeners[type] = listeners[type] || []).push(fn); return this; },
      off: function (type, fn) { listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn; }); return this; },
      emit: function (type, payload) {
        (listeners[type] || []).slice().forEach(function (fn) {
          try { fn(payload); } catch (e) { /* 宿主回调抛错不影响桥本身 */ }
        });
        (listeners['*'] || []).slice().forEach(function (fn) {
          try { fn({ type: type, payload: payload }); } catch (e) { /* 同上 */ }
        });
      }
    };
  }

  /**
   * 挂载智能体面板。
   * @param {object} opts
   *   container  选择器或元素（必填）
   *   agentUrl   嵌入页地址，默认 'agent/embed.html'
   *   height     高度（像素），默认 760
   *   title      iframe 标题
   *   onReady / onTurn / onTrace / onState / onAction / onPublished / onHazard / onError
   *   onEvent    任意事件（统一回调）
   */
  function mount(opts) {
    opts = opts || {};
    var container = typeof opts.container === 'string' ? document.querySelector(opts.container) : opts.container;
    if (!container) throw new Error('[FloodAgent] 未找到挂载容器：' + opts.container);

    var url = opts.agentUrl || 'agent/embed.html';
    var expectedOrigin = new URL(url, document.baseURI || global.location.href).origin;
    var targetOrigin = expectedOrigin === 'null' ? '*' : expectedOrigin;
    url += (url.indexOf('?') >= 0 ? '&' : '?') + 'embed=1';

    var iframe = document.createElement('iframe');
    iframe.src = url;
    iframe.title = opts.title || '城市韧性守护 Agent';
    iframe.setAttribute('allow', 'clipboard-write');
    iframe.style.cssText = 'width:100%;border:0;border-radius:' + (opts.radius || '10px') + ';height:' + (opts.height || 760) + 'px;display:block;background:#f4f7f5';
    container.appendChild(iframe);

    var emitter = createEmitter();
    var ready = false;
    var capabilities = null;
    var lastState = null;
    var queue = [];
    var destroyed = false;

    function post(payload) {
      if (destroyed || !iframe.contentWindow) return;
      try {
        iframe.contentWindow.postMessage(Object.assign({
          source: SOURCE_HOST,
          protocol: PROTOCOL_VERSION
        }, payload), targetOrigin);
      } catch (e) {
        emitter.emit('error', { stage: 'post', message: String(e && e.message || e) });
      }
    }

    function command(cmd) {
      if (!ready) { queue.push({ type: 'command', command: cmd }); return Promise.resolve({ queued: true }); }
      post({ type: 'command', command: cmd });
      return Promise.resolve({ ok: true, queued: false });
    }

    function onMessage(e) {
      if (destroyed) return;
      // 只接受来自本 iframe 的消息
      if (!iframe.contentWindow || e.source !== iframe.contentWindow || e.origin !== expectedOrigin) return;
      var d = e.data;
      if (!d || d.source !== SOURCE_CHILD || d.protocol !== PROTOCOL_VERSION) return;

      var payload = d.payload;
      switch (d.type) {
        case 'ready':
          ready = true;
          capabilities = payload && payload.capabilities;
          emitter.emit('ready', payload);
          queue.splice(0).forEach(function (item) { post(item); });
          break;
        case 'turn': emitter.emit('turn', payload); break;
        case 'trace': emitter.emit('trace', payload); break;
        case 'action': emitter.emit('action', payload); break;
        case 'published': emitter.emit('published', payload); break;
        case 'hazard': emitter.emit('hazard', payload); break;
        case 'state':
          lastState = payload;
          emitter.emit('state', payload);
          break;
        default: break;
      }
      emitter.emit('event', { type: d.type, payload: payload });
    }

    global.addEventListener('message', onMessage);

    var api = {
      iframe: iframe,
      protocol: { child: SOURCE_CHILD, host: SOURCE_HOST, version: PROTOCOL_VERSION },

      on: emitter.on,
      off: emitter.off,

      /** 是否已收到子页面的 ready */
      isReady: function () { return ready; },
      /** 智能体能力清单（工具、技能、情景、阈值、边界声明等） */
      getCapabilities: function () { return capabilities; },
      /** 最近一次同步过来的状态快照 */
      getState: function () { return lastState; },

      /** 发一句话给智能体 */
      send: function (text) { return command({ kind: 'message', text: text }); },
      /** 触发一个动作按钮（可直接传智能体回传的 action 对象） */
      action: function (action) { return command({ kind: 'action', action: action }); },
      /** 切换演练情景 */
      setScenario: function (scenarioId) { return command({ kind: 'scenario', scenarioId: scenarioId }); },
      /** 推进口播雨量（毫米） */
      advanceRainfall: function (deltaMm) { return command({ kind: 'rainfall', deltaMm: deltaMm }); },
      /** 重置演练 */
      reset: function () { return command({ kind: 'reset' }); },
      /** 切换智能体运行路径（'offline' 或 'openai-compatible'） */
      setProvider: function (provider) { return command({ kind: 'set-provider', provider: provider }); },
      /** 主动索取一次状态快照与能力清单 */
      requestState: function () { post({ type: 'request-state' }); return Promise.resolve({ ok: true }); },
      /** 主动索取能力清单 */
      requestCapabilities: function () { post({ type: 'request-state' }); return Promise.resolve({ ok: true }); },

      /**
       * 请求子页面打开人工确认框。宿主不能批准，不能代填确认人。
       * 操作人必须在子页面亲自点击，姓名选填；工具与参数以待确认请求为准。
       */
      confirm: function (token, actor, tool, params) {
        return command({ kind: 'confirm', token: token });
      },

      destroy: function () {
        destroyed = true;
        global.removeEventListener('message', onMessage);
        if (iframe.parentNode) iframe.parentNode.removeChild(iframe);
      },

      /** 等待子页面就绪 */
      whenReady: function (timeoutMs) {
        if (ready) return Promise.resolve(capabilities);
        return new Promise(function (resolve, reject) {
          var timer = setTimeout(function () {
            reject(new Error('[FloodAgent] 等待智能体就绪超时（' + (timeoutMs || 10000) + ' ms）'));
          }, timeoutMs || 10000);
          emitter.on('ready', function (payload) { clearTimeout(timer); resolve(payload && payload.capabilities); });
        });
      }
    };

    // 便捷回调
    ['ready', 'turn', 'trace', 'state', 'action', 'published', 'hazard', 'event'].forEach(function (type) {
      var cb = opts['on' + type.charAt(0).toUpperCase() + type.slice(1)];
      if (typeof cb === 'function') emitter.on(type, cb);
    });

    return api;
  }

  global.FloodAgentBridge = {
    mount: mount,
    protocol: { child: SOURCE_CHILD, host: SOURCE_HOST, version: PROTOCOL_VERSION },
    /** 版本自检：宿主可用它确认桥与面板协议一致 */
    version: PROTOCOL_VERSION
  };
  // 便捷别名
  global.FloodAgent = global.FloodAgentBridge;
})(window);
