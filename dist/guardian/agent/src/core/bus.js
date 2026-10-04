/*!
 * 城市韧性守护 Agent · 基础设施
 * 事件总线 + 通用工具 + 截图式回放日志
 * 零依赖：不引入任何外部库，保证断网、离线、file:// 直接打开都能跑。
 */
(function (FA) {
  'use strict';

  FA.util = FA.util || {};

  /* ------------------------------ 通用工具 ------------------------------ */
  var seq = 0;
  FA.util.uid = function (prefix) {
    seq += 1;
    return (prefix || 'id') + '-' + Date.now().toString(36) + '-' + seq.toString(36);
  };

  FA.util.nowIso = function () { return new Date().toISOString(); };

  /** 演练时钟：以会话开始为 T-00:00，便于演示时表述「降雨在推进」 */
  var clockStart = Date.now();
  FA.util.elapsed = function () {
    var s = Math.floor((Date.now() - clockStart) / 1000);
    var mm = String(Math.floor(s / 60)).padStart(2, '0');
    var ss = String(s % 60).padStart(2, '0');
    return 'T-' + mm + ':' + ss;
  };
  FA.util.resetClock = function () { clockStart = Date.now(); };

  FA.util.clamp = function (v, lo, hi) { return Math.max(lo, Math.min(hi, v)); };

  /** 归一化到 [0,1]，区间非法时返回 0，避免 NaN 污染下游 */
  FA.util.norm = function (v, range) {
    if (!range || range.length !== 2) return 0;
    var lo = range[0], hi = range[1];
    if (hi === lo) return 0;
    return FA.util.clamp((Number(v) - lo) / (hi - lo), 0, 1);
  };

  FA.util.round = function (v, digits) {
    var f = Math.pow(10, digits == null ? 2 : digits);
    return Math.round((Number(v) + Number.EPSILON) * f) / f;
  };

  FA.util.sum = function (arr, pick) {
    return (arr || []).reduce(function (a, b) { return a + (pick ? pick(b) : b); }, 0);
  };

  FA.util.groupBy = function (arr, keyFn) {
    var out = {};
    (arr || []).forEach(function (item) {
      var k = keyFn(item);
      (out[k] = out[k] || []).push(item);
    });
    return out;
  };

  /** 线性同余伪随机：确定性，便于「同一输入 → 同一输出」的可复现评估 */
  FA.util.seededRandom = function (seed) {
    var s = (seed >>> 0) || 20261010;
    return function () {
      s = (s * 1664525 + 1013904223) >>> 0;
      return s / 4294967296;
    };
  };

  FA.util.levelOf = function (score, levels) {
    var hit = (levels || [])[0] || { key: 'low', label: '低' };
    (levels || []).forEach(function (lv) { if (score >= lv.min) hit = lv; });
    return { key: hit.key, label: hit.label };
  };

  FA.util.pad2 = function (n) { return String(n).padStart(2, '0'); };

  FA.util.formatTime = function (iso) {
    var d = iso ? new Date(iso) : new Date();
    return FA.util.pad2(d.getHours()) + ':' + FA.util.pad2(d.getMinutes()) + ':' + FA.util.pad2(d.getSeconds());
  };

  FA.util.escapeHtml = function (s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  };

  /* ------------------------------ 事件总线 ------------------------------ */
  var listeners = {};

  FA.bus = {
    /** 订阅；返回取消订阅函数 */
    on: function (type, fn) {
      (listeners[type] = listeners[type] || []).push(fn);
      return function () { FA.bus.off(type, fn); };
    },
    off: function (type, fn) {
      listeners[type] = (listeners[type] || []).filter(function (f) { return f !== fn; });
    },
    /** 单个订阅者抛错不影响其它订阅者 —— 演示现场不能被一个 UI 异常打断 */
    emit: function (type, payload) {
      var errors = [];
      (listeners[type] || []).slice().forEach(function (fn) {
        try { fn(payload); } catch (e) { errors.push({ type: type, message: String(e && e.message || e) }); }
      });
      (listeners['*'] || []).slice().forEach(function (fn) {
        try { fn({ type: type, payload: payload }); } catch (e) { errors.push({ type: type, message: String(e && e.message || e) }); }
      });
      if (errors.length) {
        (listeners['error'] || []).slice().forEach(function (fn) {
          try { fn(errors); } catch (e) { /* 忽略：错误处理本身失败时不再递归 */ }
        });
      }
      return errors;
    },
    clear: function () { listeners = {}; }
  };

  /* ------------------------------ 感知执行轨迹 ------------------------------ */
  /**
   * 左栏「实时监控」的数据源：把智能体每一步感知、判断、工具调用与状态改动
   * 记录成一条可回放的流水，用于向评委直观展示「智能体在做什么」。
   */
  var KIND_META = {
    perceive: { label: '感知', tone: 'perceive' },
    plan: { label: '规划', tone: 'plan' },
    tool: { label: '工具调用', tone: 'tool' },
    result: { label: '结果', tone: 'result' },
    decision: { label: '决策', tone: 'decision' },
    state: { label: '状态变更', tone: 'state' },
    confirm: { label: '人工确认', tone: 'confirm' },
    publish: { label: '发布', tone: 'publish' },
    warn: { label: '边界提示', tone: 'warn' },
    error: { label: '异常', tone: 'error' }
  };

  FA.trace = {
    MAX: 400,
    entries: [],

    push: function (kind, title, extra) {
      var meta = KIND_META[kind] || { label: kind, tone: 'result' };
      var entry = Object.assign({
        id: FA.util.uid('tr'),
        at: FA.util.nowIso(),
        clock: FA.util.elapsed(),
        kind: kind,
        kindLabel: meta.label,
        tone: meta.tone,
        title: title || '',
        detail: '',
        ok: true
      }, extra || {});
      this.entries.push(entry);
      if (this.entries.length > this.MAX) this.entries = this.entries.slice(-this.MAX);
      FA.bus.emit('trace', entry);
      return entry;
    },

    /** 记录一次工具调用：进入与返回成对出现，耗时可见 */
    toolStart: function (name, label, args) {
      return this.push('tool', '调用工具 ' + (label || name), {
        tool: name,
        args: args,
        phase: 'start'
      });
    },
    toolEnd: function (name, label, result, startedAt, ok) {
      return this.push('result', (label || name) + (ok === false ? ' 未完成' : ' 完成'), {
        tool: name,
        phase: 'end',
        durationMs: Date.now() - startedAt,
        result: result,
        ok: ok !== false
      });
    },

    recent: function (n) { return this.entries.slice(-(n || 30)); },
    since: function (id) {
      var idx = this.entries.findIndex(function (e) { return e.id === id; });
      return idx < 0 ? this.entries.slice() : this.entries.slice(idx + 1);
    },
    clear: function () { this.entries = []; FA.bus.emit('trace:clear', null); },
    kindMeta: KIND_META
  };
})(window.FA = window.FA || {});
