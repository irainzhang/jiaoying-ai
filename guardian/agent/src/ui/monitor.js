/*!
 * 城市韧性守护 Agent · 左栏「实时监控」
 * 展示：风险分层表 / 智能体感知与执行轨迹 / 任务执行进度 / 关键指标
 *
 * 这一栏对应会议纪要「保留实时监控端，持续追踪人员位置与状态，
 * 确保调度闭环与动态调整」与「直观展示智能体感知与执行过程」。
 */
(function (FA) {
  'use strict';

  var el = FA.ui.el;

  function create(refs) {
    var traceAutoScroll = true;

    /* ------------------------------ 轨迹流水 ------------------------------ */
    function renderTrace(entries) {
      var host = refs.trace;
      if (!host) return;
      if (!entries || !entries.length) {
        host.innerHTML = '';
        host.appendChild(el('div', {
          class: 'trace-empty',
          text: '暂无轨迹。点击「完整研判」或向右侧对话框发出指令，这里会实时滚动显示智能体的每一次感知、工具调用与状态变更。'
        }));
        return;
      }
      var frag = document.createDocumentFragment();
      entries.forEach(function (t) {
        var body = el('div', { class: 'trace-body' });
        body.appendChild(el('strong', { text: t.title }));
        if (t.detail) body.appendChild(el('div', { class: 'detail', text: t.detail }));
        if (t.args && Object.keys(t.args).length) {
          body.appendChild(el('div', { class: 'detail', html: '参数 <code>' + FA.ui.escapeHtml(JSON.stringify(t.args)) + '</code>' }));
        }
        if (t.durationMs != null) {
          body.appendChild(el('div', { class: 'detail muted', text: '耗时 ' + t.durationMs + ' ms' }));
        }
        frag.appendChild(el('div', { class: 'trace-item' }, [
          el('div', { class: 't', text: t.clock || '' }),
          el('div', { class: 'trace-kind tone-' + (t.tone || 'result'), text: t.kindLabel || t.kind }),
          body
        ]));
      });
      host.innerHTML = '';
      host.appendChild(frag);
      if (traceAutoScroll) host.scrollTop = host.scrollHeight;
    }

    /* ------------------------------ 任务进度 ------------------------------ */
    function renderTasks(state) {
      var host = refs.tasks;
      if (!host) return;
      var plan = state.plan;
      var tasks = plan ? state.tasks.filter(function (t) { return t.planId === plan.id; }) : state.tasks;
      var stats = FA.tools.taskStats(tasks);

      host.innerHTML = '';
      if (!tasks.length) {
        host.appendChild(el('div', {
          class: 'trace-empty',
          text: '尚无转移任务。生成调度方案后点击「生成转移任务」，即可把方案落成可执行任务并跟踪到「已到达」。'
        }));
        return;
      }

      var peopleText = stats.people ? (stats.arrivedPeople + '/' + stats.people + ' 人已到达') : '—';
      host.appendChild(el('div', { class: 'card-body tight' }, [
        el('div', { class: 'stat-grid' }, [
          stat('任务总数', stats.total + ' 条', ''),
          stat('已到达', (stats.byStage.arrived || 0) + ' 条', (stats.byStage.arrived ? 'good' : '')),
          stat('人员进度', peopleText, stats.progress >= 1 ? 'good' : '')
        ]),
        el('div', { class: 'mt10' }, [
          el('div', { class: 'bar' }, [el('i', { style: 'width:' + Math.round((stats.progress || 0) * 100) + '%' })]),
          el('div', { class: 'small muted mt6', text: '闭环进度（按已到达人数计算）' })
        ])
      ]));

      var list = el('div', { class: 'scroll', style: 'max-height:250px' });
      tasks.forEach(function (t) {
        list.appendChild(el('div', { class: 'task-row' }, [
          el('span', { class: 'who', text: t.groupName }),
          el('span', { class: 'where', text: t.vehicleName + ' → ' + t.shelterName + ' · ' + t.people + ' 人' }),
          el('span', { class: 'stage stage-' + t.stage, text: FA.tools.stageLabel(t.stage) })
        ]));
      });
      host.appendChild(list);
    }

    function stat(label, value, tone) {
      return el('div', { class: 'stat ' + (tone || '') }, [
        el('div', { class: 'v', text: String(value) }),
        el('div', { class: 'l', text: label })
      ]);
    }

    /* ------------------------------ 风险分层表 ------------------------------ */
    function renderZones(state) {
      var host = refs.zones;
      if (!host) return;
      host.innerHTML = '';

      if (!state.risk) {
        host.appendChild(el('div', {
          class: 'trace-empty',
          text: '尚未评估。执行风险评估后这里会列出各网格的积水易发风险、社会脆弱性与响应优先级。'
        }));
        return;
      }

      var table = el('table', { class: 'table' });
      table.appendChild(el('thead', {}, [
        el('tr', {}, [
          el('th', { text: '网格' }),
          el('th', { text: '风险' }),
          el('th', { text: '脆弱性' }),
          el('th', { text: '优先级' }),
          el('th', { text: '判定' })
        ])
      ]));
      var tbody = el('tbody');

      var rMap = {}, sMap = {}, pMap = {};
      state.risk.zones.forEach(function (z) { rMap[z.zoneId] = z; });
      if (state.svi) state.svi.zones.forEach(function (z) { sMap[z.zoneId] = z; });
      if (state.priority) state.priority.zones.forEach(function (z) { pMap[z.zoneId] = z; });

      var order = state.priority ? state.priority.zones.map(function (z) { return z.zoneId; }) : state.risk.zones.map(function (z) { return z.zoneId; });

      order.forEach(function (zoneId) {
        var r = rMap[zoneId], s = sMap[zoneId], p = pMap[zoneId];
        if (!r) return;
        var zone = state.zones.find(function (z) { return z.id === zoneId; }) || {};
        tbody.appendChild(el('tr', {}, [
          el('td', {}, [
            el('div', { text: zone.alias || r.name }),
            el('div', { class: 'small muted', text: r.name })
          ]),
          el('td', {}, [
            el('span', { class: 'pill', style: 'background:' + chipBg(r.level) + ';color:#fff', text: r.levelLabel + ' ' + r.percent + '%' })
          ]),
          el('td', { text: s ? (s.levelLabel + ' ' + s.percent + '%') : '—' }),
          el('td', { text: p ? (p.priorityPercent + '') : '—' }),
          el('td', {}, [el('span', {
            class: 'small ' + (p && p.tag === '高风险 × 高脆弱' ? 'pill-high pill' : 'muted'),
            text: p ? p.tag : '—'
          })])
        ]));
      });
      table.appendChild(tbody);
      host.appendChild(el('div', { class: 'scroll', style: 'max-height:330px' }, [table]));
    }

    function chipBg(level) {
      return FA.ui.map.RISK_COLOR[level] || '#9aa8a2';
    }

    /* ------------------------------ 关键指标 ------------------------------ */
    function renderStats(state) {
      var host = refs.stats;
      if (!host) return;
      host.innerHTML = '';
      var plan = state.plan;
      var gap = state.resourceGap;
      var ev = FA.triggers.evaluate();

      var cards = [
        { label: '累计雨量', value: state.rainfallMm + ' mm', tone: '' },
        { label: '情景', value: (FA.data.scenarios.find(function (s) { return s.id === state.scenarioId; }) || {}).name || state.scenarioId, tone: '' },
        { label: '已安排 / 总需求', value: plan ? (plan.metrics.servedPeople + '/' + plan.metrics.totalPeople) : '—', tone: plan && plan.metrics.complete ? 'good' : (plan ? 'warn' : '') },
        { label: '未安排人数', value: plan ? (plan.metrics.unassignedPeople + ' 人') : '—', tone: plan ? (plan.metrics.unassignedPeople ? 'bad' : 'good') : '' },
        { label: '加权等待', value: plan ? (plan.metrics.weightedWait + '') : '—', tone: '' },
        { label: '资源缺口', value: gap ? (gap.gaps.length + ' 项') : '—', tone: gap ? (gap.gaps.length ? 'bad' : 'good') : '' },
        { label: '待处理变化', value: state.pendingChanges.count + ' 项', tone: state.pendingChanges.count ? 'warn' : '' },
        { label: '触发判定', value: ev.shouldReplan ? '建议重算' : (ev.level === 'watch' ? '观察中' : '无变化'), tone: ev.shouldReplan ? 'warn' : '' }
      ];

      host.appendChild(el('div', { class: 'stat-grid' }, cards.map(function (c) { return stat(c.label, c.value, c.tone); })));

      if (state.stale) {
        host.appendChild(el('div', { class: 'mt10 small', style: 'color:#b45309', text: '⚠ 输入已发生变化，部分分析结果已过期，界面不会用旧结论冒充新结果。' }));
      }
      if (plan) {
        host.appendChild(el('div', { class: 'mt10 small muted', text: '算法：' + plan.algorithm + '；约束校验' + (plan.validation.ok ? '通过' : '未通过') + '；局部搜索迭代 ' + (plan.search ? plan.search.iterations : '—') + ' 次。' }));
      }
      if (gap && gap.gaps.length) {
        var list = el('ul', { class: 'warn-list mt6' });
        gap.gaps.forEach(function (g) { list.appendChild(el('li', { text: g.label + '：需求 ' + g.demand + ' / 能力 ' + g.supply + ' ' + g.unit })); });
        host.appendChild(list);
      }
    }

    return {
      renderTrace: renderTrace,
      renderTasks: renderTasks,
      renderZones: renderZones,
      renderStats: renderStats,
      renderAll: function (state) {
        renderStats(state);
        renderZones(state);
        renderTasks(state);
      },
      setTraceAutoScroll: function (v) { traceAutoScroll = !!v; }
    };
  }

  FA.ui.monitor = { create: create };
})(window.FA = window.FA || {});
