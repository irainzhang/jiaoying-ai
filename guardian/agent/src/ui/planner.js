/*!
 * 城市韧性守护 Agent · 右栏「规划发布」
 * 展示：对话与动作按钮 / 调度方案 / 应急决策报告 / 预案依据
 *
 * 对应会议纪要「发布端采用左侧实时监控、右侧规划发布的双栏布局」
 * 与「助手回复必须附带动作按钮」。
 */
(function (FA) {
  'use strict';

  var el = FA.ui.el;

  /** The comparison uses the stored tool result, never numbers parsed from a prose summary. */
  function scenarioComparison(matrix) {
    if (!matrix || !Array.isArray(matrix.results) || !matrix.results.length) return null;
    function number(value) { return typeof value === 'number' && isFinite(value) ? String(value) : '—'; }
    var block = el('section', { class: 'card-body guardian-scenario-comparison', 'aria-label': '降雨情景对比' });
    block.appendChild(el('h4', { class: 'block-title', text: '降雨情景对比 · ' + matrix.results.map(function (r) { return number(r.rainfallMm); }).join(' / ') + ' mm' }));
    block.appendChild(el('div', { class: 'small muted mt6', text: '最近一次推演快照' + (matrix.at ? ' · ' + FA.util.formatTime(matrix.at) : '') + '。各档分别实际重算，未替换当前执行方案。' }));
    var scroll = el('div', { role: 'region', tabindex: '0', 'aria-label': '降雨情景对比表，可横向滚动', style: 'overflow-x:auto;max-width:100%;margin-top:10px' });
    var table = el('table', { class: 'table', style: 'min-width:650px', 'aria-label': '降雨情景计算结果' });
    table.appendChild(el('thead', {}, [el('tr', {}, [
      '累计雨量（mm）', '高风险网格（个）', '受影响人口（人）', '脆弱人口（人）', '已安排 / 需求（人）', '未安排（人）', '资源缺口（项）'
    ].map(function (label) { return el('th', { scope: 'col', class: 'num', text: label }); }))]));
    var body = el('tbody');
    matrix.results.forEach(function (row) {
      var dispatch = row.dispatch || {};
      body.appendChild(el('tr', { 'data-rainfall-mm': number(row.rainfallMm) }, [
        el('th', { scope: 'row', class: 'num', text: number(row.rainfallMm) }),
        el('td', { class: 'num', text: number(row.riskHighZoneCount) }),
        el('td', { class: 'num', text: number(row.exposedPopulation) }),
        el('td', { class: 'num', text: number(row.vulnerablePopulation) }),
        el('td', { class: 'num', text: number(dispatch.servedPeople) + ' / ' + number(dispatch.totalPeople) }),
        el('td', { class: 'num', text: number(dispatch.unassignedPeople) }),
        el('td', { class: 'num', text: number(row.gapCount) })
      ]));
    });
    table.appendChild(body);
    scroll.appendChild(table);
    block.appendChild(scroll);
    block.appendChild(el('p', { class: 'small muted mt6', text: '人员、人口与资源均为演练设定值；高风险网格包含高与极高两级，脆弱人口按这些网格中的老年及儿童人口估算。受影响人口与待转移任务人数口径不同。情景推演不是天气预报，也不预测水深。' }));
    block.appendChild(el('p', { class: 'small muted mt6', text: '修改雨情、人员或资源后请重新推演。资源不足时，未安排人数与缺口会如实保留。' }));
    return block;
  }

  function create(refs, callbacks) {
    callbacks = callbacks || {};
    var actionMap = {};
    var seq = 0;

    /* ------------------------------ 动作按钮 ------------------------------ */
    function actionButton(action) {
      actionMap[action.id] = action;
      var btn = el('button', {
        class: 'abtn',
        'data-action-id': action.id,
        'data-tone': action.tone || 'default',
        title: action.hint || ''
      });
      btn.appendChild(el('span', { text: action.label }));
      if (action.hint) btn.appendChild(el('span', { class: 'hint', text: action.hint }));
      return btn;
    }

    function actionBlock(actions, title) {
      var groups = FA.actions.groupActions(actions || []);
      var wrap = el('div', { class: 'block' }, [el('div', { class: 'block-title', text: title || '下一步动作（点击即调用工具并改变状态）' })]);
      var box = el('div', { class: 'actions' });
      groups.forEach(function (g) {
        box.appendChild(el('div', { class: 'action-group' }, [
          el('div', { class: 'g-label', text: g.group }),
          el('div', { class: 'action-row' }, g.actions.map(actionButton))
        ]));
      });
      wrap.appendChild(box);
      return wrap;
    }

    function bump(logEl) { logEl.scrollTop = logEl.scrollHeight; }

    /* ------------------------------ 消息气泡 ------------------------------ */
    function pushUser(text) {
      refs.log.appendChild(el('div', { class: 'msg user' }, [
        el('div', { class: 'who', text: '指挥员' }),
        el('div', { class: 'bubble', text: text })
      ]));
      bump(refs.log);
    }

    function pushSystem(text) {
      refs.log.appendChild(el('div', { class: 'msg system' }, [
        el('div', { class: 'bubble', text: text })
      ]));
      bump(refs.log);
    }

    /** 渲染一轮智能体回复：结论 + 动作按钮 + 边界提示 + 引用 */
    function pushTurn(turn) {
      seq += 1;
      var bubble = el('div', { class: 'bubble' });

      if (turn.provider) {
        var tone = turn.provider.mode === 'online' ? 'pill-warn' : 'pill';
        bubble.appendChild(el('div', { class: 'small muted', style: 'margin-bottom:6px' }, [
          el('span', { class: 'pill ' + tone, text: turn.provider.providerLabel }),
          turn.planner && turn.planner.intentLabel ? el('span', { class: 'pill', style: 'margin-left:5px', text: '意图：' + turn.planner.intentLabel }) : null,
          el('span', { class: 'muted', style: 'margin-left:6px', text: '耗时 ' + turn.elapsedMs + ' ms' })
        ]));
      }

      bubble.appendChild(el('div', { html: FA.ui.md(turn.text) }));

      if (turn.citations && turn.citations.length) {
        var citeBlock = el('div', { class: 'block' }, [el('div', { class: 'block-title', text: '依据（公开文件摘要）' })]);
        var ul = el('ul', { class: 'cite-list' });
        turn.citations.forEach(function (c) {
          ul.appendChild(el('li', {
            html: '《' + FA.ui.escapeHtml(c.title) + '》' + (c.publisher ? '（' + FA.ui.escapeHtml(c.publisher) + '）' : '') +
              (c.url ? ' — <a href="' + FA.ui.escapeHtml(c.url) + '" target="_blank" rel="noopener">公开来源</a>' : '')
          }));
        });
        citeBlock.appendChild(ul);
        citeBlock.appendChild(el('div', { class: 'small muted mt6', text: '知识库为公开文件的概括性摘要，不是原文；引用以官方发布为准。' }));
        bubble.appendChild(citeBlock);
      }

      if (turn.warnings && turn.warnings.length) {
        var wBlock = el('div', { class: 'block' }, [el('div', { class: 'block-title', text: '边界与提示' })]);
        var wUl = el('ul', { class: 'warn-list' });
        turn.warnings.forEach(function (w) { wUl.appendChild(el('li', { text: w })); });
        wBlock.appendChild(wUl);
        bubble.appendChild(wBlock);
      }

      if (turn.actions && turn.actions.length) {
        bubble.appendChild(actionBlock(turn.actions, turn.needConfirm
          ? '需要人工确认后才能继续（智能体不会自行批准）'
          : '下一步动作（点击即调用工具并改变状态）'));
      }

      refs.log.appendChild(el('div', { class: 'msg agent' }, [
        el('div', { class: 'who', text: '城市韧性守护 Agent' + (turn.provider ? ' · ' + turn.provider.providerLabel : '') }),
        bubble
      ]));
      bump(refs.log);
    }

    function pushBusy(text) {
      var node = el('div', { class: 'msg agent', id: 'fa-busy' }, [
        el('div', { class: 'who', text: '城市韧性守护 Agent' }),
        el('div', { class: 'bubble' }, [
          el('div', { class: 'thinking' }, [
            el('span', { class: 'dots', html: '<i></i><i></i><i></i>' }),
            el('span', { text: text || '正在理解任务并编排工具…' })
          ])
        ])
      ]);
      refs.log.appendChild(node);
      bump(refs.log);
      return node;
    }

    function clearBusy() {
      var n = document.getElementById('fa-busy');
      if (n) n.remove();
    }

    /* ------------------------------ 调度方案卡 ------------------------------ */
    function renderPlan(plan) {
      var host = refs.plan;
      if (!host) return;
      host.innerHTML = '';
      var comparison = scenarioComparison(FA.store.get().scenarioMatrix);
      if (comparison) host.appendChild(comparison);

      if (!plan) {
        host.appendChild(el('div', {
          class: 'trace-empty',
          text: '尚无调度方案。点击「生成调度方案」，或直接说「帮我做一次完整的研判和调度建议」。'
        }));
        return;
      }

      var m = plan.metrics;
      host.appendChild(el('div', { class: 'card-body' }, [
        el('div', { class: 'stat-grid' }, [
          stat('已安排', m.servedPeople + '/' + m.totalPeople + ' 人', m.complete ? 'good' : 'warn'),
          stat('未安排', m.unassignedPeople + ' 人', m.unassignedPeople ? 'bad' : 'good'),
          stat('加权等待', m.weightedWait + '', ''),
          stat('完成时间', m.finishMinute + ' 分', ''),
          stat('约束校验', plan.validation.ok ? '通过' : '未通过', plan.validation.ok ? 'good' : 'bad')
        ]),
        el('div', { class: 'small muted mt10', text: '目标：' + plan.objectiveLabel + '；算法：' + plan.algorithm + '。' + plan.methodNote })
      ]));

      // ---- 车辆线路 ----
      var lines = el('div', { class: 'card-body' });
      lines.appendChild(el('div', { class: 'block-title', text: '车辆线路（单车单趟）' }));
      plan.assignments.forEach(function (a, idx) {
        var color = FA.ui.map.VEHICLE_COLOR[idx % FA.ui.map.VEHICLE_COLOR.length];
        var row = el('div', { style: 'padding:7px 0;border-bottom:1px dashed #eef2ef' });
        row.appendChild(el('div', {}, [
          el('span', { style: 'display:inline-block;width:8px;height:8px;border-radius:2px;background:' + color + ';margin-right:6px' }),
          el('strong', { text: a.vehicleName }),
          el('span', { class: 'small muted', text: '　载 ' + a.people + ' 人 · 行驶 ' + a.driveMinutes + ' 分 · 预计 ' + a.finishMinute + ' 分完成' })
        ]));
        var chain = el('div', { class: 'small', style: 'margin-top:4px;color:#3c4b45' });
        chain.appendChild(el('span', { text: '接人顺序：' }));
        a.stops.forEach(function (st, i) {
          chain.appendChild(el('span', {
            class: 'pill ' + (st.highRisk ? 'pill-high' : (st.wheelchair ? 'pill-warn' : '')),
            style: 'margin:0 3px 3px 0',
            text: (i + 1) + '. ' + st.groupName + '（' + st.zoneId + '·' + st.people + '人' +
              (st.assisted ? '·需协助' : '') + (st.wheelchair ? '·无障碍' + st.wheelchair : '') + '）'
          }));
        });
        chain.appendChild(el('span', { class: 'pill pill-ok', style: 'margin-left:3px', text: '送往 ' + a.shelterName }));
        row.appendChild(chain);
        lines.appendChild(row);
      });
      host.appendChild(lines);

      // ---- 安置点负荷 ----
      var shelterBody = el('div', { class: 'card-body' });
      shelterBody.appendChild(el('div', { class: 'block-title', text: '安置点负荷与剩余容量' }));
      var t = el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: '安置点' }), el('th', { class: 'num', text: '容量' }),
          el('th', { class: 'num', text: '安排' }), el('th', { class: 'num', text: '剩余' })
        ])])
      ]);
      var tb = el('tbody');
      Object.keys(plan.shelterLoad).forEach(function (sid) {
        var l = plan.shelterLoad[sid];
        tb.appendChild(el('tr', {}, [
          el('td', { text: l.name }),
          el('td', { class: 'num', text: l.capacity }),
          el('td', { class: 'num', text: l.people }),
          el('td', { class: 'num', text: l.remaining })
        ]));
      });
      t.appendChild(tb);
      shelterBody.appendChild(t);
      host.appendChild(shelterBody);

      // ---- 优化前后对比 ----
      var cmp = el('div', { class: 'card-body' });
      cmp.appendChild(el('div', { class: 'block-title', text: '优化前后对比（同一输入快照 · 基线：明示规则）' }));
      var ct = el('table', { class: 'table' }, [
        el('thead', {}, [el('tr', {}, [
          el('th', { text: '指标' }), el('th', { class: 'num', text: '基线' }), el('th', { class: 'num', text: '优化' })
        ])])
      ]);
      var ctb = el('tbody');
      var labelMap = {
        servedPeople: '已安排人数', unassignedPeople: '未安排人数',
        weightedWait: '加权等待（人·分钟）', finishMinute: '完成时间（分钟）', driveMinutes: '总行驶时间（分钟）'
      };
      Object.keys(plan.comparison.metrics).forEach(function (k) {
        var mm = plan.comparison.metrics[k];
        ctb.appendChild(el('tr', {}, [
          el('td', { text: labelMap[k] || k }),
          el('td', { class: 'num', text: mm.baseline }),
          el('td', { class: 'num', text: mm.optimized })
        ]));
      });
      ct.appendChild(ctb);
      cmp.appendChild(ct);
      cmp.appendChild(el('div', { class: 'small muted mt6', text: plan.comparison.note }));
      host.appendChild(cmp);

      // ---- 未安排人员 ----
      if (plan.unassigned.length) {
        var un = el('div', { class: 'card-body' });
        un.appendChild(el('div', { class: 'block-title', text: '未安排人员（如实保留缺口，不宣称已全部解决）' }));
        plan.explanations.forEach(function (u) {
          un.appendChild(el('div', { style: 'padding:6px 0;border-bottom:1px dashed #eef2ef' }, [
            el('div', {}, [
              el('strong', { text: u.name }),
              el('span', { class: 'small muted', text: '　' + u.zoneId + ' · ' + u.people + ' 人 · 原因码 ' + u.code })
            ]),
            el('div', { class: 'small', style: 'color:#b45309', text: u.reason }),
            u.next ? el('div', { class: 'small muted', text: '建议：' + u.next }) : null
          ]));
        });
        host.appendChild(un);
      }
    }

    function stat(label, value, tone) {
      return el('div', { class: 'stat ' + (tone || '') }, [
        el('div', { class: 'v', text: String(value) }),
        el('div', { class: 'l', text: label })
      ]);
    }

    /* ------------------------------ 报告与文本 ------------------------------ */
    function renderReport(report) {
      var host = refs.report;
      if (!host) return;
      host.innerHTML = '';
      if (!report) {
        host.appendChild(el('div', {
          class: 'trace-empty',
          text: '尚无报告。点击「生成应急决策报告」可产出含数据来源与边界声明的完整报告。'
        }));
        return;
      }
      var head = el('div', { class: 'card-body' }, [
        el('div', { class: 'block-title', text: report.title }),
        el('div', { class: 'small muted', text: '生成时间 ' + FA.util.formatTime(report.at) + ' · 约 ' + report.bytes + ' 字符 · 含 ' + (report.markdown.match(/^## /gm) || []).length + ' 个章节' }),
        el('div', { class: 'action-row mt10' }, [
          el('button', { class: 'abtn', onclick: function () { FA.ui.download('城市韧性守护Agent_应急决策报告.md', report.markdown, 'text/markdown'); } }, ['导出 .md']),
          el('button', { class: 'abtn', onclick: function () { FA.ui.copyText(report.markdown).then(function (ok) { FA.ui.toast(ok ? '报告已复制到剪贴板' : '复制失败，请使用导出按钮', ok ? 'ok' : 'err'); }); } }, ['复制全文']),
          el('button', { class: 'abtn', onclick: function () { if (refs.reportText.classList.contains('hidden')) { refs.reportText.textContent = report.markdown; refs.reportText.classList.remove('hidden'); } else { refs.reportText.classList.add('hidden'); } } }, ['展开/收起预览'])
        ])
      ]);
      host.appendChild(head);
      refs.reportText.textContent = report.markdown;
      refs.reportText.classList.add('hidden');
    }

    function renderDoc(target, text, emptyText) {
      if (!target) return;
      target.innerHTML = '';
      if (!text) {
        target.appendChild(el('div', { class: 'trace-empty', text: emptyText || '暂无内容。' }));
        return;
      }
      var pre = el('pre', { class: 'doc' });
      pre.textContent = text;
      target.appendChild(pre);
      var row = el('div', { class: 'action-row mt10' }, [
        el('button', { class: 'abtn', onclick: function () { FA.ui.copyText(text).then(function (ok) { FA.ui.toast(ok ? '已复制' : '复制失败', ok ? 'ok' : 'err'); }); } }, ['复制文本']),
        el('button', { class: 'abtn', onclick: function () { FA.ui.download('政务通知_演练.txt', text, 'text/plain'); } }, ['导出 .txt'])
      ]);
      target.appendChild(row);
    }

    /* ------------------------------ 事件绑定 ------------------------------ */
    function handleActionClick(e) {
      var btn = e.target.closest ? e.target.closest('[data-action-id]') : null;
      if (!btn || btn.disabled) return;
      var action = actionMap[btn.getAttribute('data-action-id')];
      if (!action) return;
      if (callbacks.onAction) callbacks.onAction(action, btn);
    }
    if (refs.log) refs.log.addEventListener('click', handleActionClick);
    if (refs.quick) refs.quick.addEventListener('click', handleActionClick);

    return {
      pushUser: pushUser,
      pushSystem: pushSystem,
      pushTurn: pushTurn,
      pushBusy: pushBusy,
      clearBusy: clearBusy,
      renderPlan: renderPlan,
      renderReport: renderReport,
      renderDoc: renderDoc,
      clearLog: function () { refs.log.innerHTML = ''; },
      actionMap: actionMap,
      quickActions: function (actions) {
        if (!refs.quick) return;
        refs.quick.innerHTML = '';
        actions.forEach(function (a) {
          var b = actionButton(a);
          b.classList.add('quick-btn');
          refs.quick.appendChild(b);
        });
      }
    };
  }

  FA.ui.planner = { create: create };
})(window.FA = window.FA || {});
