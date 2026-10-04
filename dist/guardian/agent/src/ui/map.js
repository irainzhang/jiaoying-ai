/*!
 * 城市韧性守护 Agent · 实时监控地图（本地 SVG）
 * ---------------------------------------------------------------
 * 合规说明（务必保留）：
 *   本演示「地图数据直接写死」（会议纪要决定），是一张本地 SVG 示意图，
 *   不加载任何在线底图、不请求任何瓦片服务，因此不涉及底图来源合规问题。
 *   正式提交若使用真实底图，须按赛事要求使用合规数据来源与底图。
 *
 * 交互（对应会议纪要「允许用户在地图上长按提交险情修改」）：
 *   - 长按网格 600ms → 弹出险情上报表单（同时也支持右键）
 *   - 单击网格 → 显示该网格的风险、脆弱性、优先级与可达性详情
 *   - 图层：风险分层 / 车辆线路 / 险情标记 可切换
 */
(function (FA) {
  'use strict';

  var NS = 'http://www.w3.org/2000/svg';
  var RISK_COLOR = {
    'low': '#2f855a',
    'medium': '#c99a12',
    'high': '#dd6b20',
    'very-high': '#c53030',
    'unknown': '#9aa8a2'
  };
  var RISK_LABEL = { low: '低', medium: '中', high: '高', 'very-high': '极高', unknown: '未评估' };
  var VEHICLE_COLOR = ['#1d4ed8', '#0f6f5c', '#6d28d9', '#b45309', '#0e7490'];

  function svgEl(tag, attrs) {
    var n = document.createElementNS(NS, tag);
    Object.keys(attrs || {}).forEach(function (k) {
      if (attrs[k] != null) n.setAttribute(k, attrs[k]);
    });
    return n;
  }

  function create(container, handlers) {
    handlers = handlers || {};
    var svg = svgEl('svg', { class: 'map-svg', viewBox: '0 0 460 470', preserveAspectRatio: 'xMidYMid meet' });
    var tooltip = FA.ui.el('div', { class: 'map-tooltip hidden' });
    container.appendChild(svg);
    container.appendChild(tooltip);

    var pressTimer = null;
    var pressedZone = null;
    var longPressed = false;
    var lastState = null;
    var layers = { risk: true, routes: true, hazards: true };
    var selectedZoneId = null;

    var LONG_PRESS_MS = 600;

    function setLayers(next) {
      Object.assign(layers, next || {});
      if (lastState) render(lastState);
    }

    function riskOf(state, zoneId) {
      if (!state.risk) return null;
      return state.risk.zones.find(function (z) { return z.zoneId === zoneId; }) || null;
    }
    function sviOf(state, zoneId) {
      if (!state.svi) return null;
      return state.svi.zones.find(function (z) { return z.zoneId === zoneId; }) || null;
    }
    function prioOf(state, zoneId) {
      if (!state.priority) return null;
      return state.priority.zones.find(function (z) { return z.zoneId === zoneId; }) || null;
    }

    function showTooltip(zoneId, x, y, state) {
      var zone = state.zones.find(function (z) { return z.id === zoneId; });
      if (!zone) return;
      var r = riskOf(state, zoneId), s = sviOf(state, zoneId), p = prioOf(state, zoneId);
      var rows = [
        ['人口', zone.population + ' 人'],
        ['老龄占比', Math.round(zone.elderlyRatio * 100) + '%'],
        ['需协助', zone.assisted + ' 人'],
        ['历史易涝', zone.history + ' 次'],
        ['高程', zone.elevationM + ' m'],
        ['积水易发风险', r ? (r.levelLabel + '（' + r.percent + '%）') : '未评估'],
        ['社会脆弱性', s ? (s.levelLabel + '（' + s.percent + '%）') : '未评估'],
        ['响应优先级', p ? (p.priorityPercent + '，' + p.tag) : '未评估']
      ];
      if (state.access && state.access.shelterMinutes) {
        var m = state.access.shelterMinutes[zoneId];
        rows.push(['避难点可达', m == null ? '不可达' : (m + ' 分钟')]);
      }
      tooltip.innerHTML = '<strong>' + FA.ui.escapeHtml(zone.name + '（' + zone.alias + '）') + '</strong>' +
        '<dl>' + rows.map(function (row) {
          return '<dt>' + FA.ui.escapeHtml(row[0]) + '</dt><dd>' + FA.ui.escapeHtml(row[1]) + '</dd>';
        }).join('') + '</dl>' +
        '<div class="small muted mt6">长按可提交险情修改</div>';
      tooltip.classList.remove('hidden');
      var rect = container.getBoundingClientRect();
      var left = Math.min(Math.max(6, x + 12), rect.width - 240);
      var top = Math.min(Math.max(6, y + 12), Math.max(6, rect.height - 210));
      tooltip.style.left = left + 'px';
      tooltip.style.top = top + 'px';
    }

    function hideTooltip() { tooltip.classList.add('hidden'); }

    function render(state) {
      lastState = state;
      while (svg.firstChild) svg.removeChild(svg.firstChild);

      var defs = svgEl('defs');
      var marker = svgEl('marker', { id: 'fa-arrow', viewBox: '0 0 10 10', refX: '8', refY: '5', markerWidth: '5', markerHeight: '5', orient: 'auto-start-reverse' });
      marker.appendChild(svgEl('path', { d: 'M 0 0 L 10 5 L 0 10 z', fill: 'context-stroke' }));
      defs.appendChild(marker);
      svg.appendChild(defs);

      svg.appendChild(svgEl('rect', { x: 0, y: 0, width: 460, height: 470, fill: '#f8fbfa' }));

      // 演练背景示意：河流（仅表达相对位置关系，不是真实水系）
      svg.appendChild(svgEl('path', {
        d: 'M 20 300 C 120 250, 180 360, 300 300 S 420 340, 460 300',
        fill: 'none', stroke: '#cfe3ec', 'stroke-width': 12,
        'stroke-linecap': 'round', opacity: .75
      }));
      svg.appendChild(svgEl('text', { x: 26, y: 322, fill: '#7fa3b5', 'font-size': '9' }, [])).textContent = '演练背景水系（示意）';

      var roads = state.roads || [];
      var zoneById = {};
      (state.zones || []).forEach(function (z) { zoneById[z.id] = z; });

      // ---------- 路网 ----------
      var gRoads = svgEl('g', { class: 'layer-roads' });
      roads.forEach(function (r) {
        var a = zoneById[r.from], b = zoneById[r.to];
        if (!a || !b) return;
        gRoads.appendChild(svgEl('line', {
          x1: a.x, y1: a.y, x2: b.x, y2: b.y,
          stroke: r.closed ? '#c53030' : '#c9d6d1',
          'stroke-width': r.closed ? 2.4 : 2,
          'stroke-dasharray': r.closed ? '5 4' : null,
          'stroke-linecap': 'round'
        }));
        if (r.closed) {
          var mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
          gRoads.appendChild(svgEl('circle', { cx: mx, cy: my, r: 5.5, fill: '#c53030' }));
          var t = svgEl('text', { x: mx, y: my + 3, 'text-anchor': 'middle', 'font-size': '8', fill: '#fff' });
          t.textContent = '断';
          gRoads.appendChild(t);
        }
      });
      svg.appendChild(gRoads);

      // ---------- 车辆线路 ----------
      if (layers.routes && state.plan) {
        var gRoutes = svgEl('g', { class: 'layer-routes' });
        (state.plan.assignments || []).forEach(function (a, idx) {
          var color = VEHICLE_COLOR[idx % VEHICLE_COLOR.length];
          var pts = [a.baseZoneId].concat(a.stops.map(function (s) { return s.zoneId; }));
          if (a.shelterId) {
            var sh = (state.shelters || []).find(function (s) { return s.id === a.shelterId; });
            if (sh) pts.push(sh.zoneId);
          }
          for (var i = 0; i < pts.length - 1; i++) {
            var f = zoneById[pts[i]], t2 = zoneById[pts[i + 1]];
            if (!f || !t2) continue;
            gRoutes.appendChild(svgEl('line', {
              x1: f.x, y1: f.y, x2: t2.x, y2: t2.y,
              stroke: color, 'stroke-width': 2.6, 'stroke-linecap': 'round',
              'marker-end': 'url(#fa-arrow)', opacity: .92
            }));
          }
          // 线路序号标签
          var first = zoneById[pts[0]];
          if (first) {
            var label = svgEl('text', { x: first.x + 9, y: first.y - 9, 'font-size': '10', fill: color, 'font-weight': '700' });
            label.textContent = a.vehicleName;
            gRoutes.appendChild(label);
          }
        });
        svg.appendChild(gRoutes);
      }

      // ---------- 网格 ----------
      var gZones = svgEl('g', { class: 'layer-zones' });
      (state.zones || []).forEach(function (z) {
        var r = riskOf(state, z.id);
        var level = (layers.risk && r) ? r.level : 'unknown';
        var color = RISK_COLOR[level] || RISK_COLOR.unknown;
        var radius = 9 + Math.sqrt(z.population) / 3.4;
        var g = svgEl('g', { 'data-zone': z.id, style: 'cursor:pointer' });

        if (selectedZoneId === z.id) {
          g.appendChild(svgEl('circle', { cx: z.x, cy: z.y, r: radius + 5, fill: 'none', stroke: '#0f6f5c', 'stroke-width': 2, 'stroke-dasharray': '4 3' }));
        }

        g.appendChild(svgEl('circle', {
          cx: z.x, cy: z.y, r: radius,
          fill: color, 'fill-opacity': layers.risk && r ? 0.82 : 0.3,
          stroke: '#fff', 'stroke-width': 1.6
        }));

        // 优先级标记：高风险 × 高脆弱
        var p = prioOf(state, z.id);
        if (p && (p.tag === '高风险 × 高脆弱')) {
          g.appendChild(svgEl('circle', { cx: z.x, cy: z.y, r: radius + 3.5, fill: 'none', stroke: '#b91c1c', 'stroke-width': 1.6, 'stroke-dasharray': '3 2' }));
        }

        var t = svgEl('text', { x: z.x, y: z.y + radius + 11, 'text-anchor': 'middle', 'font-size': '9.5', fill: '#3c4b45' });
        t.textContent = z.id;
        g.appendChild(t);

        if (r && layers.risk) {
          var tp = svgEl('text', { x: z.x, y: z.y + 3.4, 'text-anchor': 'middle', 'font-size': '9', fill: '#fff', 'font-weight': '700' });
          tp.textContent = r.percent + '';
          g.appendChild(tp);
        }

        gZones.appendChild(g);
      });
      svg.appendChild(gZones);

      // ---------- 安置点 ----------
      var gShelters = svgEl('g', { class: 'layer-shelters' });
      (state.shelters || []).forEach(function (s) {
        var open = s.status === 'open';
        gShelters.appendChild(svgEl('rect', {
          x: s.x - 7, y: s.y - 7, width: 14, height: 14, rx: 3,
          fill: open ? '#0f6f5c' : '#9aa8a2', stroke: '#fff', 'stroke-width': 1.6
        }));
        var t = svgEl('text', { x: s.x, y: s.y - 11, 'text-anchor': 'middle', 'font-size': '9.5', fill: '#0f6f5c', 'font-weight': '700' });
        t.textContent = s.name.replace('演练安置点 ', '点');
        gShelters.appendChild(t);
        if (!open) {
          var c = svgEl('text', { x: s.x, y: s.y + 3.4, 'text-anchor': 'middle', 'font-size': '8', fill: '#fff' });
          c.textContent = '停';
          gShelters.appendChild(c);
        }
      });
      svg.appendChild(gShelters);

      // ---------- 险情标记 ----------
      if (layers.hazards) {
        var gHz = svgEl('g', { class: 'layer-hazards' });
        var offset = {};
        (state.hazards || []).forEach(function (h) {
          var z = zoneById[h.zoneId];
          if (!z) return;
          offset[h.zoneId] = (offset[h.zoneId] || 0) + 1;
          var dx = z.x + 13 + (offset[h.zoneId] - 1) * 11;
          var dy = z.y - 13;
          var pts = (dx) + ',' + (dy - 6) + ' ' + (dx + 6) + ',' + (dy + 5) + ' ' + (dx - 6) + ',' + (dy + 5);
          gHz.appendChild(svgEl('polygon', {
            points: pts, fill: h.severity >= 4 ? '#b91c1c' : '#dd6b20', stroke: '#fff', 'stroke-width': 1.2
          }));
          var t = svgEl('text', { x: dx, y: dy + 3.6, 'text-anchor': 'middle', 'font-size': '7.5', fill: '#fff', 'font-weight': '700' });
          t.textContent = h.severity;
          gHz.appendChild(t);
        });
        svg.appendChild(gHz);
      }

      // 标题
      var title = svgEl('text', { x: 12, y: 18, 'font-size': '11', fill: '#6b7a73' });
      title.textContent = '演练区域示意图 · ' + FA.data.region.name + ' · ' + FA.data.region.dataModeLabel +
        (state.risk ? '（' + state.risk.rainfallMm + ' mm）' : '（未评估）');
      svg.appendChild(title);
    }

    /* ------------------------------ 交互 ------------------------------ */
    function zoneIdFrom(target) {
      var node = target;
      while (node && node !== svg) {
        if (node.getAttribute && node.getAttribute('data-zone')) return node.getAttribute('data-zone');
        node = node.parentNode;
      }
      return null;
    }

    function pointInContainer(e) {
      var rect = container.getBoundingClientRect();
      return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    }

    function beginPress(zoneId) {
      pressedZone = zoneId;
      longPressed = false;
      clearTimeout(pressTimer);
      pressTimer = setTimeout(function () {
        longPressed = true;
        hideTooltip();
        if (handlers.onLongPress) handlers.onLongPress(zoneId);
      }, LONG_PRESS_MS);
    }

    function endPress(allowClick) {
      clearTimeout(pressTimer);
      pressTimer = null;
      var zoneId = pressedZone;
      pressedZone = null;
      if (allowClick && !longPressed && zoneId) {
        selectedZoneId = (selectedZoneId === zoneId) ? null : zoneId;
        if (handlers.onSelect) handlers.onSelect(zoneId);
        if (lastState) render(lastState);
      }
    }

    svg.addEventListener('pointerdown', function (e) {
      var zid = zoneIdFrom(e.target);
      if (!zid) return;
      e.preventDefault();
      beginPress(zid);
      showTooltip(zid, pointInContainer(e).x, pointInContainer(e).y, lastState || FA.store.get());
    });
    svg.addEventListener('pointerup', function () { endPress(true); });
    svg.addEventListener('pointerleave', function () { endPress(false); hideTooltip(); });
    svg.addEventListener('pointercancel', function () { endPress(false); });
    svg.addEventListener('pointermove', function (e) {
      if (!pressedZone) return;
      // 手指/鼠标移动过多则视为拖动而非长按
      var zid = zoneIdFrom(e.target);
      if (!zid || zid !== pressedZone) endPress(false);
    });
    svg.addEventListener('contextmenu', function (e) {
      var zid = zoneIdFrom(e.target);
      if (!zid) return;
      e.preventDefault();
      if (handlers.onLongPress) handlers.onLongPress(zid);
    });

    return {
      render: render,
      setLayers: setLayers,
      layers: function () { return Object.assign({}, layers); },
      selectedZone: function () { return selectedZoneId; },
      clearSelection: function () { selectedZoneId = null; if (lastState) render(lastState); },
      RISK_COLOR: RISK_COLOR,
      RISK_LABEL: RISK_LABEL,
      VEHICLE_COLOR: VEHICLE_COLOR,
      LONG_PRESS_MS: LONG_PRESS_MS
    };
  }

  FA.ui.map = { create: create, RISK_COLOR: RISK_COLOR, RISK_LABEL: RISK_LABEL, VEHICLE_COLOR: VEHICLE_COLOR };
})(window.FA = window.FA || {});
