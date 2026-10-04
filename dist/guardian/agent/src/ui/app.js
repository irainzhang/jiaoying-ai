/*!
 * 城市韧性守护 Agent · 界面控制器
 * ---------------------------------------------------------------
 * 负责把「左栏实时监控 + 右栏规划发布」与智能体、工具、状态仓库接起来，
 * 并处理需要人工确认的动作（确认弹层是真实的点击，不是自动批准）。
 *
 * 嵌入模式：URL 带 ?embed=1 时收窄布局，并与宿主页面通过 postMessage 通信。
 */
(function (FA) {
  'use strict';

  var el = FA.ui.el;
  var IM = FA.ui.map;

  var PARENT_SOURCE = 'flood-agent';
  var HOST_SOURCE = 'jiaoying-host';
  var BRIDGE_VERSION = '3.7.0-guardian';

  function boot() {
    var embed = /[?&]embed=1/.test(location.search);
    if (embed) document.body.classList.add('embed');
    var runtime = (window.GUARDIAN_API_CONFIG || {}).runtime || {};
    if (runtime.defaultScenarioId) {
      var configuredScenario = FA.store.applyScenario(runtime.defaultScenarioId);
      if (!configuredScenario.ok) FA.trace.push('warn', '默认情景配置无效，保留演练初始值', { detail: configuredScenario.message });
    }
    var expectedParentOrigin = location.origin;
    try { if (document.referrer) expectedParentOrigin = new URL(document.referrer).origin; } catch (e) { /* same-origin fallback */ }
    var parentTargetOrigin = expectedParentOrigin === 'null' ? '*' : expectedParentOrigin;

    /* ------------------------------ 元素引用 ------------------------------ */
    var refs = {
      map: document.getElementById('map'),
      trace: document.getElementById('trace'),
      tasks: document.getElementById('tasks'),
      zones: document.getElementById('zones'),
      stats: document.getElementById('stats'),
      log: document.getElementById('chat-log'),
      plan: document.getElementById('plan'),
      report: document.getElementById('report'),
      reportText: document.getElementById('report-text'),
      doc: document.getElementById('doc'),
      quick: document.getElementById('quick'),
      input: document.getElementById('input'),
      send: document.getElementById('send'),
      scenario: document.getElementById('scenario'),
      providerBadge: document.getElementById('provider-badge'),
      staleBadge: document.getElementById('stale-badge'),
      dataBadge: document.getElementById('data-badge'),
      traceMeta: document.getElementById('trace-meta')
    };

    var monitor = FA.ui.monitor.create(refs);
    var planner = FA.ui.planner.create(refs, { onAction: handleAction });

    /* ------------------------------ 地图 ------------------------------ */
    var mapView = IM.create(refs.map, {
      onLongPress: openHazardModal,
      onSelect: function (zoneId) {
        var zone = FA.store.zone(zoneId);
        if (!zone) return;
        planner.pushSystem('已选中 ' + zone.name + '（' + zone.alias + '）。长按或右键该网格可提交险情修改。');
      }
    });

    /* ------------------------------ 渲染 ------------------------------ */
    function renderAll() {
      var s = FA.store.get();
      mapView.render(s);
      monitor.renderAll(s);
      monitor.renderTrace(FA.trace.recent(60));
      planner.renderPlan(s.plan);
      planner.renderReport(s.report);
      renderBadges(s);
      if (refs.traceMeta) refs.traceMeta.textContent = FA.trace.entries.length + ' 条轨迹';
    }

    function renderBadges(s) {
      var d = FA.llm.describe();
      if (refs.providerBadge) {
        // This disclosure is mandatory even when runtime.showProviderBadge is false.
        refs.providerBadge.className = 'badge ' + (d.mode === 'online' ? 'badge-online' : 'badge-offline');
        refs.providerBadge.textContent = d.badgeLabel || '运行路径：离线规则引擎（API 接口已预留）';
        refs.providerBadge.title = d.disclosure;
      }
      if (refs.staleBadge) {
        refs.staleBadge.classList.toggle('hidden', !s.stale);
      }
      if (refs.dataBadge) {
        refs.dataBadge.textContent = FA.data.region.dataModeLabel + ' · ' + FA.data.region.spatialScaleLabel;
      }
    }

    /* ------------------------------ 对话 ------------------------------ */
    var hasInteracted = false;
    var agentBusy = false;

    function waitForCurrentTurn() {
      if (!agentBusy) return false;
      FA.ui.toast('当前任务仍在处理中，请完成后再操作。', 'err');
      return true;
    }

    function send(text) {
      if (waitForCurrentTurn()) return Promise.resolve({ ok: false, busy: true });
      var clean = String(text || '').trim();
      if (!clean) return;
      hasInteracted = true;
      if (!refs.input.disabled) refs.input.value = '';
      planner.pushUser(clean);
      setBusy(true);

      var busyNode = planner.pushBusy('正在理解任务并编排工具…');
      var p = FA.agent.handleUserMessage(clean, { source: 'chat' });

      return Promise.resolve(p).then(function (turn) {
        planner.clearBusy();
        setBusy(false);
        planner.pushTurn(turn);
        renderAll();
        publish('turn', {
          text: turn.text,
          actions: turn.actions,
          citations: turn.citations,
          warnings: turn.warnings,
          needConfirm: turn.needConfirm,
          provider: turn.provider
        });
        return turn;
      }).catch(function (err) {
        planner.clearBusy();
        setBusy(false);
        planner.pushSystem('本轮执行出错：' + String(err && err.message || err));
        FA.ui.toast('执行出错：' + String(err && err.message || err), 'err');
      });
    }

    function setBusy(busy) {
      agentBusy = busy;
      refs.send.disabled = busy;
      refs.input.disabled = busy;
      // 只在与用户交互之后才把焦点交给输入框，并且禁止滚动。
      // 否则页面一加载就会被聚焦到页面底部的输入框，
      // 单栏嵌入布局下会直接跳到最底部，看起来像「顶部一大片空白」。
      if (!busy && hasInteracted) {
        try { refs.input.focus({ preventScroll: true }); }
        catch (e) { /* 老浏览器不支持 options 时忽略即可，不值得为此滚动页面 */ }
      }
    }

    /* ------------------------------ 动作按钮 ------------------------------ */
    function handleAction(action, btn) {
      if (waitForCurrentTurn()) return Promise.resolve({ ok: false, busy: true });
      if (action.kind === 'prompt') return send(action.prompt);
      if (action.kind === 'confirm') return handleConfirmAction(action);
      if (action.kind === 'export') return handleExport(action);
      if (action.kind === 'view') return handleView(action);

      if (btn) btn.disabled = true;
      setBusy(true);
      var out = FA.actions.dispatch(action, { source: 'action-button', actor: currentActor() });

      return Promise.resolve(out).then(function (res) {
        if (btn) btn.disabled = false;
        setBusy(false);

        // 工具直接返回结果：把它作为一轮回复呈现
        if (res && res.tool) {
          var turn = {
            text: res.needConfirm
              ? ('**需要人工确认**：' + (res.toolLabel || res.tool) + ' 属于需确认的操作，已暂停等待你的确认。智能体不会自行批准。\n\n' + (res.summary || ''))
              : (res.summary || '已完成。'),
            actions: res.actions || [],
            citations: res.citations || [],
            warnings: res.warnings || [],
            needConfirm: !!res.needConfirm,
            provider: localToolProvider(),
            planner: { intentLabel: res.toolLabel || res.tool },
            elapsedMs: 0
          };
          planner.pushSystem('已执行动作：' + action.label);
          planner.pushTurn(turn);
        } else if (res && res.trigger) {
          planner.pushSystem('已推进口播雨量：' + res.before + ' → ' + res.after + ' mm。' + (res.trigger.recommendation || ''));
        }

        renderAll();
        publish('action', { label: action.label, result: res });
        if (res && res.needConfirm && res.confirmRequest) {
          return handleConfirmAction({ args: { token: res.confirmRequest.token } });
        }
        return res;
      }).catch(function (err) {
        if (btn) btn.disabled = false;
        setBusy(false);
        FA.ui.toast('动作执行失败：' + String(err && err.message || err), 'err');
      });
    }

    function currentActor() {
      var input = document.getElementById('actor');
      return (input && input.value.trim()) || '演练值守';
    }

    function localToolProvider() {
      return { mode: 'offline', provider: 'offline', providerLabel: '本地工具执行（人工操作）',
        disclosure: '本次操作由本地工具执行，未调用大模型。' };
    }

    /** 人工确认：真实弹层 → 批准令牌 → 用同一组参数重新执行工具 */
    function handleConfirmAction(action) {
      if (waitForCurrentTurn()) return Promise.resolve({ ok: false, busy: true });
      var token = action.args && action.args.token;
      var req = FA.confirm.list().find(function (r) { return r.token === token; });
      if (!req) {
        FA.ui.toast('确认请求不存在、已过期或依据已变化，请重新核对方案。', 'err');
        return Promise.resolve({ ok: false, message: '需重新申请人工确认' });
      }
      // The pending request is authoritative; a host cannot substitute another tool or arguments.
      var tool = req.toolName;
      var params = req.args;
      var def = FA.tools.get(tool);

      setBusy(true);
      return FA.ui.modal({
        title: '人工确认：' + ((def && def.label) || tool),
        html: '<p>' + FA.ui.escapeHtml((req && req.detail) || (def && def.confirmDetail) || '该操作会改变执行状态，需人工确认。') + '</p>' +
          '<p class="small muted">核对方案后点击即可确认，无需输入姓名或确认文字。操作人默认记为“演练值守”，可选填修改；确认记录会保留。</p>' +
          (params && Object.keys(params).length
            ? '<pre class="doc">' + FA.ui.escapeHtml(JSON.stringify(params, null, 2)) + '</pre>'
            : ''),
        fields: [{ key: 'actor', label: '操作人（选填）', value: currentActor(), placeholder: '留空使用“演练值守”', required: false }],
        confirmText: '确认并执行',
        danger: true,
        requireHuman: true
      }).then(function (values) {
        setBusy(false);
        if (!values) {
          planner.pushSystem('已取消确认。方案未发布，状态未改变。');
          return null;
        }
        var approved = FA.confirm.approve(token, values.actor, values._humanEvent);
        if (!approved.ok) {
          FA.ui.toast(approved.message, 'err');
          return null;
        }
        var exec = FA.tools.execute(tool, Object.assign({}, params, {
          _confirmToken: token,
          _actor: values.actor
        }), { source: 'confirm-modal' });

        return Promise.resolve(exec).then(function (res) {
          planner.pushTurn({
            text: '**' + (res.toolLabel || tool) + '**：' + (res.summary || ''),
            actions: res.actions || [],
            citations: res.citations || [],
            warnings: res.warnings || [],
            needConfirm: !!res.needConfirm,
            provider: localToolProvider(),
            planner: { intentLabel: '人工确认后执行' },
            elapsedMs: 0
          });
          if (res.data && res.data.notifications) {
            planner.renderDoc(refs.doc,
              res.data.notifications.map(function (n) { return n.text; }).join('\n\n'),
              '发布后生成的通知文本将显示在这里。');
          }
          renderAll();
          if (res.ok) publish('published', res.data || {});
          FA.ui.toast(res.ok ? '已按确认执行：' + (res.toolLabel || tool) : (res.summary || '操作未完成'), res.ok ? 'ok' : 'err');
          return res;
        });
      });
    }

    function handleExport(action) {
      var fmt = (action.args && action.args.format) || 'markdown';
      var s = FA.store.get();
      if (fmt === 'json') {
        FA.ui.download('城市韧性守护Agent_演练状态.json', FA.store.exportJson(), 'application/json');
        planner.pushSystem('已导出演练状态 JSON（可用于备份与复现）。');
      } else if (fmt === 'clipboard') {
        if (s.plan) {
          var r = FA.tools.execute('export_for_gov_channel', { style: 'full' });
          FA.ui.copyText(r.data.fullText).then(function (ok) {
            FA.ui.toast(ok ? '政务通知文本已复制，可直接粘贴到现有政务通讯工具' : '复制失败，请在下方手动复制', ok ? 'ok' : 'err');
            planner.renderDoc(refs.doc, r.data.fullText, '');
          });
        } else {
          FA.ui.toast('还没有方案，先生成方案', 'err');
        }
      } else if (s.report) {
        FA.ui.download('城市韧性守护Agent_应急决策报告.md', s.report.markdown, 'text/markdown');
        planner.pushSystem('已导出应急决策报告。');
      } else {
        FA.ui.toast('还没有报告，先生成报告', 'err');
      }
      return { ok: true };
    }

    function handleView(action) {
      var view = (action.args && action.args.view) || '';
      if (action.args && action.args.layer) mapView.setLayers(defineLayer(action.args.layer));
      if (view === 'monitor-map') {
        refs.map.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (view === 'monitor-tasks') {
        refs.tasks.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (view === 'monitor-knowledge') {
        var st = FA.rag.status();
        planner.renderDoc(refs.doc,
          (st.loaded ? '已收录 ' + st.docCount + ' 份公开文件摘要：\n\n' : '知识库未加载。\n\n') +
          st.sources.map(function (d, i) {
            return (i + 1) + '. 《' + d.title + '》' + (d.publisher ? '（' + d.publisher + '）' : '') + '\n   ' + d.url;
          }).join('\n') +
          '\n\n检索方式：' + st.methodLabel + '。' + st.methodNote,
          '暂无知识库来源。');
        refs.doc.scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (view === 'monitor-provenance') {
        planner.renderDoc(refs.doc,
          FA.data.region.dataProvenance.map(function (d, i) {
            return (i + 1) + '. ' + d.category + '｜用途：' + d.purpose + '\n   来源：' + d.source + '（' + d.status + '）';
          }).join('\n') + '\n\n' + FA.data.region.disclaimer.full,
          '暂无数据来源清单。');
        refs.doc.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      return { ok: true };
    }

    function defineLayer(layer) {
      if (layer === 'roads') return { risk: true, routes: true, hazards: true };
      if (layer === 'routes') return { risk: true, routes: true, hazards: true };
      return { risk: true, routes: true, hazards: true };
    }

    /* ------------------------------ 长按提交险情 ------------------------------ */
    function openHazardModal(zoneId) {
      if (waitForCurrentTurn()) return;
      var zone = FA.store.zone(zoneId);
      if (!zone) return;
      var roads = FA.store.raw().roads.filter(function (r) { return !r.closed; });

      FA.ui.modal({
        title: '提交险情修改 · ' + zone.name,
        html: '<p>在地图上长按提交的险情会记录到状态，并累积到<b>动态触发判定</b>中。</p>' +
          '<p class="small muted">为演示「避免方案频繁变动」：未达到阈值时系统只累积提示，不会自动重算方案；达到阈值也只是<b>建议</b>重算，仍需人工确认。</p>',
        fields: [
          { key: 'severity', label: '险情严等级（1-5）', type: 'select', value: '3', options: [1, 2, 3, 4, 5].map(function (n) { return { value: String(n), label: n + ' 级' }; }) },
          { key: 'note', label: '险情描述', type: 'textarea', value: zone.alias + '出现积水', placeholder: '例如：路面积水较深，建议绕行' },
          { key: 'closeRoadId', label: '关联阻断路段（可空）', type: 'select', value: '', options: [{ value: '', label: '不阻断任何路段' }].concat(roads.map(function (r) { return { value: r.id, label: r.name + '（' + r.from + '→' + r.to + '）' }; })) }
        ],
        confirmText: '提交险情',
        danger: false
      }).then(function (values) {
        if (!values) return;
        if (waitForCurrentTurn()) return;
        var res = FA.tools.execute('submit_hazard_report', {
          zoneId: zoneId,
          severity: Number(values.severity),
          note: values.note,
          source: 'map-longpress',
          closeRoadId: values.closeRoadId || undefined
        }, { source: 'map-longpress' });

        Promise.resolve(res).then(function (r) {
          planner.pushTurn({
            text: r.summary,
            actions: r.actions || [],
            citations: [],
            warnings: r.warnings || [],
            provider: localToolProvider(),
            planner: { intentLabel: '地图长按提交险情' },
            elapsedMs: 0
          });
          renderAll();
          publish('hazard', r.data || {});
        });
      });
    }

    /* ------------------------------ 顶部控制 ------------------------------ */
    if (refs.scenario) {
      FA.data.scenarios.forEach(function (sc) {
        refs.scenario.appendChild(el('option', { value: sc.id, text: sc.name + '（' + sc.rainfallMm + ' mm）' }));
      });
      refs.scenario.value = FA.store.get().scenarioId;
      refs.scenario.addEventListener('change', function () {
        if (waitForCurrentTurn()) { refs.scenario.value = FA.store.get().scenarioId; return; }
        var id = refs.scenario.value;
        var res = FA.store.applyScenario(id);
        if (!res.ok) { FA.ui.toast(res.message, 'err'); return; }
        planner.pushSystem('已切换情景：' + res.scenario.name + '。正在按该情景重新研判…');
        renderAll();
        send('帮我做一次完整的研判和调度建议');
      });
    }

    var btnPipeline = document.getElementById('btn-pipeline');
    if (btnPipeline) btnPipeline.addEventListener('click', function () {
      send('未来 6 小时累计降雨 ' + FA.store.get().rainfallMm + ' 毫米，帮我做一次完整的研判和调度建议');
    });

    var btnRain = document.getElementById('btn-rain');
    if (btnRain) btnRain.addEventListener('click', function () {
      handleAction(FA.actions.factory.advanceRain(FA.data.region.demo.rainfallStepMm));
    });

    var btnReport = document.getElementById('btn-report');
    if (btnReport) btnReport.addEventListener('click', function () {
      handleAction(FA.actions.factory.report());
    });

    var btnCompliance = document.getElementById('btn-compliance');
    if (btnCompliance) btnCompliance.addEventListener('click', function () {
      handleAction(FA.actions.factory.compliance());
    });

    var btnReset = document.getElementById('btn-reset');
    if (btnReset) btnReset.addEventListener('click', function () {
      if (waitForCurrentTurn()) return;
      FA.ui.modal({ title: '重置演练', text: '将清空方案、任务与轨迹，并恢复到初始情景与初始雨量。此操作不可撤销。', confirmText: '确认重置', danger: true })
        .then(function (v) {
          if (!v) return;
          if (waitForCurrentTurn()) return;
          FA.store.reset();
          FA.agent.reset();
          planner.clearLog();
          planner.pushSystem('已重置演练：情景与雨量恢复初始值，方案、任务与轨迹已清空。');
          refs.doc.innerHTML = '';
          renderAll();
        });
    });

    var btnExport = document.getElementById('btn-export');
    if (btnExport) btnExport.addEventListener('click', function () {
      handleAction(FA.actions.make({ kind: 'export', args: { format: 'json' } }));
    });

    var fileImport = document.getElementById('file-import');
    if (fileImport) fileImport.addEventListener('change', function (e) {
      if (waitForCurrentTurn()) { e.target.value = ''; return; }
      var f = e.target.files && e.target.files[0];
      if (!f) return;
      var reader = new FileReader();
      reader.onload = function () {
        if (waitForCurrentTurn()) return;
        var r = FA.store.importJson(String(reader.result));
        if (r.ok) {
          planner.pushSystem('已从备份恢复演练状态。');
          renderAll();
        } else {
          FA.ui.toast(r.message, 'err');
        }
      };
      reader.readAsText(f);
      e.target.value = '';
    });

    var btnHelp = document.getElementById('btn-help');
    if (btnHelp) btnHelp.addEventListener('click', function () {
      showHelp();
    });

    var btnSkills = document.getElementById('btn-skills');
    if (btnSkills) btnSkills.addEventListener('click', function () {
      var st = FA.skills.status();
      var cat = FA.skills.catalog();
      planner.renderDoc(refs.doc,
        '技能包（' + st.spec + '）\n\n' +
        (cat.length ? cat.map(function (s, i) {
          return (i + 1) + '. ' + s.name + '（' + s.lineCount + ' 行）\n   ' + s.description + '\n   关联工具：' + (s.tools.join('、') || '—');
        }).join('\n\n') : ('未加载：' + st.buildHint)) +
        '\n\n工具清单（' + FA.tools.all().length + ' 个）：\n' +
        FA.tools.catalog().map(function (t) {
          return '· ' + t.name + (t.requiresConfirm ? '（需人工确认）' : '') + (t.mutates ? '（改状态）' : '') + '\n  ' + t.description;
        }).join('\n'),
        '暂无技能信息。');
      refs.doc.scrollIntoView({ behavior: 'smooth', block: 'center' });
    });

    if (refs.send) refs.send.addEventListener('click', function () { send(refs.input.value); });
    if (refs.input) {
      refs.input.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); send(refs.input.value); }
      });
    }

    /* ------------------------------ 快捷按钮 ------------------------------ */
    planner.quickActions([
      FA.actions.factory.followUp('完整研判', '帮我做一次完整的研判和调度建议', '一句话走完七个核心问题'),
      FA.actions.factory.followUp('哪里最危险', '现在哪里积水风险最高？', '风险评估'),
      FA.actions.factory.followUp('谁最需要保护', '哪些人最需要优先保护？', '脆弱性与优先级'),
      FA.actions.factory.followUp('资源够不够', '现在的应急资源够不够？', '资源缺口'),
      FA.actions.factory.followUp('如果雨更大', '如果雨继续下到 160 毫米怎么办？', '情景推演'),
      FA.actions.factory.followUp('为什么这样调度', '为什么这样调度？', '可解释性'),
      FA.actions.factory.followUp('查预案依据', '人员转移的优先顺序有什么预案依据？', 'RAG 检索'),
      FA.actions.factory.followUp('当前状态', '现在什么情况？', '状态快照')
    ]);

    /* ------------------------------ 轨迹订阅 ------------------------------ */
    FA.bus.on('trace', function (entry) {
      monitor.renderTrace(FA.trace.recent(60));
      publish('trace', entry);
    });
    FA.bus.on('state', function () {
      renderAll();
      publish('state', stateSummary());
    });
    FA.bus.on('trigger:evaluated', function (ev) {
      if (ev && ev.shouldReplan) {
        FA.ui.toast('变化已达重算阈值，建议重新研判（需人工确认）', 'err', 5000);
      }
    });

    /* ------------------------------ 欢迎与自检 ------------------------------ */
    planner.pushSystem('这是「城市韧性守护 Agent」的演练工作台。左侧为实时监控（地图、智能体感知与执行轨迹、任务进度），右侧为规划发布（对话、动作按钮、调度方案、决策报告）。');
    planner.pushSystem('运行路径：' + FA.llm.describe().disclosure);
    planner.pushSystem('数据说明：' + FA.data.region.dataModeLabel + '，人员/容量/车速/路网均为演练设定，仅使用模拟信息。');

    var skillStatus = FA.skills.status();
    var kbStatus = FA.rag.status();
    planner.pushSystem('技能包：' + (skillStatus.loaded ? skillStatus.count + ' 个 SKILL.md 已加载' : '未加载（执行 node scripts/build-bundles.mjs）') +
      '；工具：' + FA.tools.all().length + ' 个；知识库：' + (kbStatus.loaded ? kbStatus.docCount + ' 份公开文件摘要' : '未加载'));

    setBusy(true);
    var turn = FA.agent.handleUserMessage('你好', { source: 'boot' });
    Promise.resolve(turn).then(function (t) {
      setBusy(false);
      planner.pushTurn(t);
      renderAll();
      publish('ready', { version: BRIDGE_VERSION, capabilities: capabilities() });
      // 主动推一次状态快照，宿主导航一挂上就能拿到当前局面，不必再问一轮
      publish('state', stateSummary());
      // 演示/截图用：?autorun=1 时自动跑一遍完整研判链路，
      // 这样打开页面即可看到方案、轨迹与任务都已填充（也方便评委直接访问）。
      if (/[?&]autorun=1/.test(location.search) || runtime.autoRunOnBoot === true) {
        var mm = (location.search.match(/[?&]rain=(\d+(?:\.\d+)?)/) || [])[1];
        if (mm) {
          // 用 setRainfall 而不是 advanceRainfall：这是情景设定，不是雨情漂移，
          // 否则会凭空累积一次「变化」，把动态触发判定弄脏。
          FA.store.setRainfall(Number(mm), '演示初始雨量设定');
          renderAll();
        }
        send('未来 6 小时累计降雨 ' + FA.store.get().rainfallMm + ' 毫米，帮我做一次完整的研判和调度建议');
      }
    }).catch(function () {
      setBusy(false);
      renderAll();
      publish('ready', { version: BRIDGE_VERSION, capabilities: capabilities() });
      publish('state', stateSummary());
    });

    showHelp(true);

    /* ------------------------------ 宿主桥接 ------------------------------ */
    function capabilities() {
      return {
        tools: FA.tools.names(),
        skills: FA.skills.status().names,
        scenarios: FA.data.scenarios.map(function (s) { return { id: s.id, name: s.name, rainfallMm: s.rainfallMm }; }),
        provider: FA.llm.describe(),
        knowledgeBase: FA.rag.status(),
        triggers: FA.triggers.table(),
        disclaimer: FA.data.region.disclaimer,
        humanConfirmRequired: ['publish_dispatch_plan'],
        version: BRIDGE_VERSION
      };
    }

    function stateSummary() {
      var s = FA.store.get();
      return {
        scenarioId: s.scenarioId,
        rainfallMm: s.rainfallMm,
        horizonHours: s.horizonHours,
        stale: s.stale,
        risk: s.risk ? { rainfallMm: s.risk.rainfallMm, zones: s.risk.zones.map(function (z) { return { zoneId: z.zoneId, percent: z.percent, level: z.level, levelLabel: z.levelLabel }; }) } : null,
        svi: s.svi ? { zones: s.svi.zones.map(function (z) { return { zoneId: z.zoneId, percent: z.percent, level: z.level, levelLabel: z.levelLabel }; }) } : null,
        priority: s.priority ? { zones: s.priority.zones.map(function (z) { return { zoneId: z.zoneId, priorityPercent: z.priorityPercent, tag: z.tag }; }) } : null,
        resourceGap: s.resourceGap ? { gapCount: s.resourceGap.gaps.length, gaps: s.resourceGap.gaps.map(function (g) { return { key: g.key, label: g.label, demand: g.demand, supply: g.supply, unit: g.unit }; }) } : null,
        plan: s.plan ? {
          id: s.plan.id,
          objectiveLabel: s.plan.objectiveLabel,
          metrics: s.plan.metrics,
          validation: s.plan.validation,
          assignments: s.plan.assignments.map(function (a) {
            return { vehicleId: a.vehicleId, vehicleName: a.vehicleName, shelterName: a.shelterName, people: a.people, finishMinute: a.finishMinute, groups: a.stops.map(function (st) { return st.groupName; }) };
          }),
          unassigned: s.plan.unassigned
        } : null,
        taskStats: FA.tools.taskStats(s.plan ? s.tasks.filter(function (t) { return t.planId === s.plan.id; }) : s.tasks),
        published: { planId: s.publishedPlanId, at: s.publishedAt },
        pendingChanges: { count: s.pendingChanges.count, rainfallDeltaMm: s.pendingChanges.rainfallDeltaMm },
        trigger: FA.triggers.evaluate(),
        hazards: s.hazards,
        compliance: s.compliance ? { passed: s.compliance.passed, total: s.compliance.total, ok: s.compliance.ok } : null
      };
    }

    function publish(type, payload) {
      if (window.parent === window) return;
      try {
        window.parent.postMessage({ source: PARENT_SOURCE, type: type, protocol: BRIDGE_VERSION, version: BRIDGE_VERSION, payload: payload, at: FA.util.nowIso() }, parentTargetOrigin);
      } catch (e) { /* 跨域受限时静默：不影响本地演示 */ }
    }

    window.addEventListener('message', function (e) {
      var d = e.data;
      if (window.parent === window || e.source !== window.parent || e.origin !== expectedParentOrigin) return;
      if (!d || d.source !== HOST_SOURCE || d.protocol !== BRIDGE_VERSION) return;
      if (d.type === 'command') return handleHostCommand(d.command || {});
      if (d.type === 'request-state') {
        publish('state', stateSummary());
        publish('ready', { version: BRIDGE_VERSION, capabilities: capabilities() });
      }
    });

    function handleHostCommand(cmd) {
      if (waitForCurrentTurn()) return Promise.resolve({ ok: false, busy: true });
      switch (cmd.kind) {
        case 'message': return send(cmd.text);
        case 'action': return handleAction(cmd.action || FA.actions.make(cmd.action));
        case 'confirm': {
          // A host command may ask to show the dialog, but can never approve it.
          return handleConfirmAction({ args: { token: cmd.token } });
        }
        case 'scenario': {
          var res = FA.store.applyScenario(cmd.scenarioId);
          if (refs.scenario) refs.scenario.value = cmd.scenarioId;
          renderAll();
          return res;
        }
        case 'rainfall': {
          var out = FA.actions.dispatch(FA.actions.factory.advanceRain(cmd.deltaMm || FA.data.region.demo.rainfallStepMm));
          renderAll();
          return out;
        }
        case 'reset': {
          FA.store.reset();
          FA.agent.reset();
          renderAll();
          publish('ready', { version: BRIDGE_VERSION, capabilities: capabilities() });
          return { ok: true };
        }
        case 'set-provider': {
          var r = FA.llm.use(cmd.provider);
          renderAll();
          return r;
        }
        case 'subscribe': {
          publish('state', stateSummary());
          return { ok: true };
        }
        default:
          return { ok: false, message: '未知命令：' + cmd.kind };
      }
    }

    // 宿主若已在监听，在 ready 之前主动报一次到（避免子页面先于宿主监听完成而漏掉）
    publish('ready', { version: BRIDGE_VERSION, capabilities: capabilities() });

    function showHelp(silent) {
      planner.renderDoc(refs.doc,
        '【演练工作台使用说明】\n\n' +
        '1. 左栏「实时监控」\n   · 地图：颜色表示积水易发风险等级，圆点大小表示人口；长按网格 600ms（或右键）提交险情修改。\n' +
        '   · 轨迹：智能体每一次感知、规划、工具调用与状态变更都会实时滚动，回答“它是怎么得出结论的”。\n' +
        '   · 任务：方案落成任务后的执行进度（已通知→已接收→已联系→已上车→已到达）。\n\n' +
        '2. 右栏「规划发布」\n   · 对话框：用自然语言下任务；每条回复都附带可点击的动作按钮。\n' +
        '   · 动作按钮点击即调用工具并改变状态，推动工作流前进。\n' +
        '   · 发布需人工点击确认：核对后点「确认并执行」即可，操作人选填，默认“演练值守”；智能体不会自行批准。\n\n' +
        '3. 演示动线（约 2—3 分钟）\n   ① 点「完整研判」→ 一句话走完七个核心问题；\n' +
        '   ② 点「口播雨量 +20 mm」两次 → 观察动态触发与阈值提示；\n' +
        '   ③ 地图长按某网格提交险情并阻断一条路段 → 看轨迹与状态变化；\n' +
        '   ④ 点「情景推演 80/120/160 mm」→ 回答“如果雨继续下怎么办”；\n' +
        '   ⑤ 生成任务 → 确认并发布 → 标记已到达 → 生成报告。\n\n' +
        '边界：' + FA.data.region.disclaimer.full + '\n\n' +
        '数据来源与公开获取方式见「数据与依据」按钮；技能与工具清单见「技能/工具」按钮。',
        '暂无说明。');
      if (!silent) refs.doc.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    renderAll();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot);
  } else {
    boot();
  }
})(window.FA = window.FA || {});
