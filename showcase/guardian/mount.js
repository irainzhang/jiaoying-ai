/* 城市韧性守护：主台版本化工具 + 次级独立沙盘；发布仍由主台人工确认。 */
(function () {
  'use strict';
  var script = document.currentScript;
  var source = script && script.src;
  var host, launcher, panel, frameBody, help, helpButton, closeButton, badge, counts, offline;
  var bridge, style, bridgeScript, priorOverflow, frameDocument, onFrameKey, workerListener;
  var disposed = false;
  var currentTask, hostToolsScript, workspaceMode = 'current', workspaceTabs, independence;

  function cleanup() {
    if (disposed) return;
    disposed = true;
    try { if (panel && panel.open) panel.close(); } catch (_) {}
    try { if (priorOverflow !== undefined) document.body.style.overflow = priorOverflow; } catch (_) {}
    try { if (frameDocument && onFrameKey) frameDocument.removeEventListener('keydown', onFrameKey, true); } catch (_) {}
    try { if (workerListener && navigator.serviceWorker) navigator.serviceWorker.removeEventListener('message', workerListener); } catch (_) {}
    try { if (bridge) bridge.destroy(); } catch (_) {}
    try { if (currentTask) currentTask.destroy(); } catch (_) {}
    [launcher, host, style, bridgeScript, hostToolsScript].forEach(function (node) { try { if (node) node.remove(); } catch (_) {} });
  }

  // A failed optional integration must not interfere with the original workspace.
  function safe(fn) {
    return function () { if (disposed) return; try { return fn.apply(null, arguments); } catch (_) { cleanup(); } };
  }
  function node(tag, attrs, text) {
    var el = document.createElement(tag);
    Object.keys(attrs || {}).forEach(function (name) { el.setAttribute(name, attrs[name]); });
    if (text !== undefined) el.textContent = text;
    return el;
  }
  function append(parent, children) { children.forEach(function (child) { parent.appendChild(child); }); return parent; }
  function button(id, text) { return node('button', { id: id, type: 'button' }, text); }
  function load(tag, attrs) {
    return new Promise(function (resolve, reject) {
      var el = node(tag, attrs), timer = setTimeout(function () { reject(new Error('guardian asset timeout')); }, 20000);
      if (tag === 'link') style = el; else bridgeScript = el;
      el.onload = function () { clearTimeout(timer); resolve(el); };
      el.onerror = function () { clearTimeout(timer); reject(new Error('guardian asset unavailable')); };
      document.head.appendChild(el);
    });
  }
  function providerText(provider) {
    if (!provider) return '运行路径：等待面板就绪';
    // The agent owns per-turn provenance, including pending / fallback / mixed paths.
    if (typeof provider.badgeLabel === 'string' && provider.badgeLabel.trim()) return provider.badgeLabel;
    if (provider.provider === 'offline' || provider.mode === 'offline') return '运行路径：离线规则引擎（API 接口已预留）';
    if (provider.provider === 'local-gateway') return '运行路径：本机代理';
    if (provider.provider === 'openai-compatible') return '运行路径：前端直连';
    return '运行路径：' + String(provider.providerLabel || provider.provider || '未知');
  }
  function updateProvider(provider) { if (provider) badge.textContent = providerText(provider); }
  function hideHelp() {
    help.hidden = true;
    frameBody.hidden = !!currentTask && workspaceMode === 'current';
    if(currentTask)currentTask.element.hidden=workspaceMode !== 'current';
    helpButton.setAttribute('aria-expanded', 'false');
    helpButton.focus();
  }
  function closePanel() {
    if (!panel.open) return;
    panel.close();
  }
  function onClosed() {
    document.body.style.overflow = priorOverflow === undefined ? '' : priorOverflow;
    priorOverflow = undefined;
    launcher.setAttribute('aria-expanded', 'false');
    launcher.focus({ preventScroll: true });
  }
  function openPanel() {
    if (panel.open) { closePanel(); return; }
    priorOverflow = document.body.style.overflow;
    panel.showModal();
    document.body.style.overflow = 'hidden';
    launcher.setAttribute('aria-expanded', 'true');
    closeButton.focus({ preventScroll: true });
    if(currentTask&&workspaceMode==='current')currentTask.refresh();
  }

  function selectWorkspace(mode){
    workspaceMode=mode;help.hidden=true;helpButton.setAttribute('aria-expanded','false');
    if(currentTask)currentTask.element.hidden=mode!=='current';frameBody.hidden=mode==='current';
    if(mode==='current'){
      counts.textContent='3 个主台工具 · 同一场任务 · 人工发布';
      badge.textContent='运行路径：主台本地规则与调度算法';
      independence.textContent='当前主台任务 · 人数、路线、缺项与执行反馈来自同一份主台记录；建议更新后仍需人工在主台发布。';
      currentTask.refresh();
    }else{
      counts.textContent='21 个工具 · 7 个技能 · 独立算法沙盘';updateProvider(bridge.getCapabilities()?.provider);
      independence.textContent='独立算法沙盘 · 10 网格与 15 人为独立合成底数，不是当前主台需求；沙盘模拟发布不会写入叫应任务。';
    }
    if(workspaceTabs)Array.prototype.forEach.call(workspaceTabs.children,function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-mode')===mode));});
  }

  function makeHelp(configURL) {
    var section = node('section', { id: 'guardian-api-help', 'aria-labelledby': 'guardian-api-title' });
    section.hidden = true;
    var title = node('h2', { id: 'guardian-api-title', tabindex: '-1' }, '自己接入 API');
    var path = node('code', {}, 'dist/guardian/agent/api-config.js');
    var intro = node('p', {}, '这个配置文件供独立算法沙盘接入模型与天气，顶部说明分为 ① 大模型、② 天气数据、③ 运行策略。本场任务助手目前使用主台本地工具，不向模型发送主台名单；后续接入模型还需扩展主台适配器。');
    var hint = node('p', { class: 'guardian-help-note' }, '公开版默认离线演练。推荐的本机代理只预留了配置，服务端转发端点尚未实现；不填写任何内容也能使用本面板。');
    var steps = node('ol');
    [
      '以后先在本机服务端新增 OpenAI 兼容转发端点，例如 POST /api/v3/agent/chat。由服务器读取 .env：JIAOYING_AI_BASE_URL、JIAOYING_AI_MODEL、JIAOYING_AI_KEY；真实密钥不写入网页，也不提交 GitHub。',
      "在配置文件的 llm 段，把 provider 改为 'local-gateway'，gatewayUrl 填完整转发地址，把 allowNetwork 改为 true。apiKey 保持空白。",
      '本机代理只接受回环来源时，应从本地服务的同源网页打开面板。GitHub Pages 的 HTTPS 网页不能代替你的本机后端；公开站点面向他人使用还需单独设计服务部署、来源权限与鉴权。',
      '服务端就绪后先试一次真实调用，核对顶部和每轮回复的实际运行路径。在线调用失败应显示回落离线的说明与轨迹。'
    ].forEach(function (text) { steps.appendChild(node('li', {}, text)); });
    var example = node('pre', {}, "llm: {\n  provider: 'local-gateway',\n  gatewayUrl: 'http://127.0.0.1:8769/api/v3/agent/chat',\n  allowNetwork: true,\n  apiKey: ''\n  // 其余配置保留原值\n}");
    var security = node('p', { class: 'guardian-help-note' }, 'GitHub Pages 源码公开。方式 B（openai-compatible）的 apiKey，以及天气段的令牌，一旦填入公开文件就会公开；本项目公开版保持空白。推荐方式 A，因为密钥只由后端读取。');
    var details = node('p', {}, '天气段保持 provider: offline、allowNetwork: false 即可继续用合成雨量；运行策略一般无需修改。此处是填写说明，不会保存密钥。');
    var link = node('a', { href: configURL, target: '_blank', rel: 'noopener' }, '查看 API 配置文件（只读）');
    var back = button('guardian-api-back', '返回守护面板');
    back.addEventListener('click', safe(hideHelp));
    append(section, [title, path, intro, hint, node('h3', {}, '推荐方式 A：本机代理'), steps, example, security, details, link, back]);
    return section;
  }

  function connectFrameKeyboard() {
    // Same-origin frame: Escape leaves the outer panel, except while its own
    // human-confirmation / hazard dialog is active. Never send a confirm command.
    try {
      if (frameDocument && onFrameKey) frameDocument.removeEventListener('keydown', onFrameKey, true);
      frameDocument = bridge.iframe.contentDocument;
      if (!frameDocument) return;
      onFrameKey = safe(function (event) {
        if (event.key !== 'Escape' || !panel.open) return;
        if (frameDocument.querySelector('.modal-mask, dialog[open]')) return;
        event.preventDefault();
        event.stopPropagation();
        closePanel();
      });
      frameDocument.addEventListener('keydown', onFrameKey, true);
    } catch (_) { /* The visible close button remains available if access fails. */ }
  }

  function setupOffline(scriptURL) {
    // Optional cache has a separate failure boundary: it must never hide a usable agent.
    try {
      if (!navigator.serviceWorker || !/^https?:$/.test(location.protocol) ||
          (location.protocol === 'http:' && !/^(localhost|127\.0\.0\.1|\[::1\])$/.test(location.hostname))) {
        offline.textContent = location.protocol === 'file:' ? '本地文件：面板无需网络' : '本浏览器未启用离线缓存';
        return;
      }
      var swURL = new URL('../guardian-offline-sw.js?v=1', scriptURL);
      var scope = new URL('../', scriptURL).href;
      offline.textContent = '正在准备守护面板离线缓存…';
      workerListener = function (event) {
        try {
          var data = event.data;
          if (disposed || !data || data.type !== 'GUARDIAN_CACHE_STATUS') return;
          if (event.source && event.source.scriptURL && new URL(event.source.scriptURL).pathname !== swURL.pathname) return;
          offline.textContent = data.ready
            ? '守护面板已缓存，可断网刷新；在线底图不在离线范围内'
            : '守护面板离线缓存未就绪，请联网完成首次加载';
        } catch (_) {}
      };
      navigator.serviceWorker.addEventListener('message', workerListener);
      function ask(reg) {
        [reg.active, reg.waiting, reg.installing].forEach(function (worker) {
          if (!worker) return;
          function query() { try { worker.postMessage({ type: 'GUARDIAN_CACHE_STATUS' }); } catch (_) {} }
          query();
          worker.addEventListener('statechange', query);
        });
      }
      navigator.serviceWorker.getRegistration(scope).then(function (existing) {
        if (disposed) return null;
        if (existing && existing.scope !== scope) existing = null;
        var current = existing && (existing.active || existing.waiting || existing.installing);
        if (current && new URL(current.scriptURL).pathname !== swURL.pathname) {
          offline.textContent = '已有其他离线服务，本面板未接管缓存';
          return null;
        }
        return navigator.serviceWorker.register(swURL.href, { scope: scope });
      }).then(function (registration) {
        if (disposed || !registration) return;
        ask(registration);
        navigator.serviceWorker.ready.then(function (ready) { if (!disposed) ask(ready); }).catch(function () {});
      }).catch(function () { if (!disposed) offline.textContent = '离线缓存未启用，当前仍可正常演练'; });
    } catch (_) { if (offline) offline.textContent = '离线缓存未启用，当前仍可正常演练'; }
  }

  async function init() {
    var anchor = document.getElementById('assistant-launcher');
    if (!source || !anchor || !document.body || document.getElementById('guardian-agent-host')) return;
    var scriptURL = new URL(source, location.href);
    await load('link', { rel: 'stylesheet', href: new URL('mount.css?v=1', scriptURL).href });
    await load('script', { src: new URL('bridge/flood-agent-bridge.js?v=1', scriptURL).href });
    if(window.JiaoyingGuardianHost){
      var originalBridgeScript=bridgeScript;
      hostToolsScript=await load('script',{src:new URL('host-tools.js?v=4',scriptURL).href});
      bridgeScript=originalBridgeScript;
    }
    if (disposed || !window.FloodAgent || typeof window.FloodAgent.mount !== 'function') throw new Error('guardian bridge unavailable');
    host = node('div', { id: 'guardian-agent-host' });
    panel = node('dialog', { id: 'guardian-agent-panel', 'aria-labelledby': 'guardian-agent-title', 'aria-describedby': 'guardian-independence guardian-boundary' });
    if (typeof panel.showModal !== 'function') throw new Error('dialog unavailable');
    var top = node('header', { class: 'guardian-panel-header' });
    var heading = node('div', { class: 'guardian-heading' });
    counts = node('span', { id: 'guardian-capabilities' }, '面板加载中');
    badge = node('span', { id: 'guardian-provider', role: 'status', 'aria-live': 'polite' }, providerText(null));
    append(heading, [node('h1', { id: 'guardian-agent-title' }, '城市韧性守护 Agent'), counts]);
    helpButton = button('guardian-api-button', '自己接入 API');
    helpButton.setAttribute('aria-controls', 'guardian-api-help');
    helpButton.setAttribute('aria-expanded', 'false');
    closeButton = button('guardian-close', '关闭面板');
    var controls = append(node('div', { class: 'guardian-controls' }), [helpButton, closeButton]);
    append(top, [heading, controls]);
    independence = node('div', { id: 'guardian-independence' }, '独立瑞安演练 · 人员、容量、车速和路网均为合成设定；模拟发布不会写入叫应任务。');
    var status = append(node('div', { class: 'guardian-status' }), [badge]);
    offline = node('span', { id: 'guardian-offline-status', role: 'status' }, '离线缓存状态待检查');
    status.appendChild(offline);
    frameBody = node('div', { id: 'guardian-agent-body' });
    help = makeHelp(new URL('agent/api-config.js', scriptURL).href);
    var content = append(node('div', { class: 'guardian-panel-content' }), [frameBody, help]);
    if(window.JiaoyingGuardianHost&&window.JiaoyingGuardianTools){
      currentTask=window.JiaoyingGuardianTools.createPanel({document:document,host:window.JiaoyingGuardianHost,beforeReview:closePanel});
      content.appendChild(currentTask.element);frameBody.hidden=true;
      workspaceTabs=node('nav',{class:'guardian-workspace-tabs','aria-label':'守护工作范围'});
      [['current','本场任务助手'],['sandbox','独立算法沙盘']].forEach(function(item){var b=button('guardian-mode-'+item[0],item[1]);b.setAttribute('data-mode',item[0]);b.setAttribute('aria-pressed',String(item[0]==='current'));b.addEventListener('click',safe(function(){selectWorkspace(item[0]);}));workspaceTabs.appendChild(b);});
    }
    var boundary = node('footer', { id: 'guardian-boundary' }, '基于公开数据的积水易发风险评估，仅供演练参考；调度方案需人工确认后执行。人员与资源均为演练设定；预案检索为公开文件概括性摘要，不是原文。');
    append(panel, [top, independence, status]);if(workspaceTabs)panel.appendChild(workspaceTabs);append(panel,[content,boundary]);
    host.appendChild(panel);
    document.body.appendChild(host);
    launcher = button('guardian-launcher', '城市韧性守护');
    launcher.className = 'ai-entry';
    launcher.hidden = true;
    launcher.setAttribute('aria-haspopup', 'dialog');
    launcher.setAttribute('aria-controls', 'guardian-agent-panel');
    launcher.setAttribute('aria-expanded', 'false');
    anchor.insertAdjacentElement('afterend', launcher);
    launcher.addEventListener('click', safe(openPanel));
    closeButton.addEventListener('click', safe(closePanel));
    panel.addEventListener('close', safe(onClosed));
    panel.addEventListener('cancel', safe(function (event) { event.preventDefault(); if (!help.hidden) hideHelp(); else closePanel(); }));
    helpButton.addEventListener('click', safe(function () {
      if (!help.hidden) { hideHelp(); return; }
      help.hidden = false; frameBody.hidden = true;
      if(currentTask)currentTask.element.hidden=true;
      helpButton.setAttribute('aria-expanded', 'true');
      document.getElementById('guardian-api-title').focus();
    }));
    bridge = window.FloodAgent.mount({
      container: '#guardian-agent-body',
      agentUrl: new URL('agent/embed.html', scriptURL).href,
      title: '城市韧性守护 Agent · 独立瑞安演练',
      height: 900,
      onReady: safe(function (payload) {
        var caps = payload && payload.capabilities || {};
        counts.textContent = (Array.isArray(caps.tools) ? caps.tools.length : '—') + ' 个工具 · ' +
          (Array.isArray(caps.skills) ? caps.skills.length : '—') + ' 个技能 · 独立演练';
        if(currentTask&&workspaceMode==='current'){counts.textContent='3 个主台工具 · 同一场任务 · 人工发布';badge.textContent='运行路径：主台本地规则与调度算法';independence.textContent='当前主台任务 · 人数、路线、缺项与执行反馈来自同一份主台记录；建议更新后仍需人工在主台发布。';}else updateProvider(caps.provider);
        connectFrameKeyboard();
      }),
      onTurn: safe(function (turn) { if(!currentTask||workspaceMode==='sandbox')updateProvider(turn && turn.provider); }),
      onPublished: safe(function () { if(!currentTask||workspaceMode==='sandbox')independence.textContent = '独立演练已模拟发布 · 通知文本可在面板内复制；没有写入叫应任务，也没有向真实人员发送。'; })
    });
    await bridge.whenReady(30000);
    if (disposed) return;
    launcher.hidden = false;
    setupOffline(scriptURL);
  }
  try { Promise.resolve(init()).catch(cleanup); } catch (_) { cleanup(); }
})();
