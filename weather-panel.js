/* Weather presentation only: no network, timers, state writes, or model calls. */
(function (root, factory) {
  'use strict';
  var api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.JiaoyingWeatherPanel = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';
  var LEVELS = {
    1: { label: '常态关注', tone: 'calm' },
    2: { label: '加强关注', tone: 'watch' },
    3: { label: '重点复核', tone: 'review' }
  };
  function escape(value) {
    return String(value == null ? '' : value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }
  function formatTime(value) {
    if (typeof value !== 'string' || !value.trim()) return '尚未更新';
    var date = new Date(value);
    if (!Number.isFinite(date.getTime())) return '更新时间待核对';
    return new Intl.DateTimeFormat('zh-CN', { timeZone: 'Asia/Shanghai', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).format(date);
  }
  function deriveWeather(state) {
    var data = state && state.data ? state.data : state || {};
    var weather = data.weather || {};
    var supportedUnit = weather.unit == null || weather.unit === 'mm';
    var rainfall = supportedUnit && typeof weather.rainfall === 'number' && Number.isFinite(weather.rainfall) && weather.rainfall >= 0
      ? weather.rainfall : null;
    var level = Number.isInteger(weather.level) && LEVELS[weather.level] ? weather.level
      : rainfall == null ? null : rainfall >= 80 ? 3 : rainfall >= 50 ? 2 : 1;
    var info = LEVELS[level] || { label: '待设置雨情', tone: 'unknown' };
    var isSimulation = !weather.sourceMode || weather.sourceMode === 'simulation';
    return {
      rainfall: rainfall, rainfallText: rainfall == null ? '—' : String(Math.round(rainfall * 10) / 10),
      unit: 'mm', windowLabel: '最近 1 小时累计（模拟）',
      level: level, levelLabel: level == null ? info.label : '演练等级 ' + level + ' · ' + info.label, tone: info.tone,
      updatedAt: typeof weather.updatedAt === 'string' ? weather.updatedAt : '', updatedLabel: formatTime(weather.updatedAt),
      sourceLabel: isSimulation ? '本地合成雨情 · 人工切换演练' : '来源待核对 · 实时天气接口未接入',
      isSimulation: isSimulation, apiConnected: false,
      trigger: typeof weather.trigger === 'string' ? weather.trigger : '选择一档雨情，查看任务安排如何变化。',
      dataIssue: !supportedUnit ? '当前数据单位不支持，不能将降水强度直接作为累计雨量。'
        : rainfall == null ? '尚无有效累计雨量，请启动雨情演练。' : '',
      markerPercent: rainfall == null ? 0 : Math.min(100, rainfall),
      // Reserved source / observedAt / forecast fields do not imply a live connection.
      integration: { status: 'reserved', source: weather.source || null, observedAt: weather.observedAt || null,
        forecast: weather.forecast || null }
    };
  }
  function render(state, options) {
    options = options || {};
    var view = deriveWeather(state);
    var disabled = options.disabled === true;
    function button(label, rain, kind) {
      var extra = 'data-rain="' + rain + '"' + (disabled ? ' disabled' : '');
      if (typeof options.btn === 'function') return options.btn(label, 'weather-demo', extra, kind || 'quiet');
      return '<button type="button" class="' + (kind || 'quiet') + '" data-ac="weather-demo" ' + extra + '>' + escape(label) + '</button>';
    }
    var icon = '<svg class="weather-icon" viewBox="0 0 96 80" aria-hidden="true"><path d="M26 48a17 17 0 1 1 3-34A24 24 0 0 1 74 24a13 13 0 0 1-2 26H26" fill="currentColor" opacity=".2"/><path d="M28 53 22 66m26-13-6 13m26-13-6 13" fill="none" stroke="currentColor" stroke-width="5" stroke-linecap="round"/></svg>';
    return '<section class="panel weather-panel weather-' + view.tone + '" id="weather-panel" aria-labelledby="weather-title">' +
      '<div class="weather-heading"><div><span class="weather-eyebrow">雨情与任务联动</span><h2 id="weather-title">先看雨情，再看安排</h2></div><span class="weather-demo-badge">模拟演练</span></div>' +
      '<div class="weather-body"><div class="weather-rain-card">' + icon + '<div><span class="weather-window">' + view.windowLabel + '</span>' +
      '<div class="weather-rain-number"><strong>' + escape(view.rainfallText) + '</strong><span>mm</span></div></div>' +
      '<span class="weather-level">' + escape(view.levelLabel) + '</span></div>' +
      '<div class="weather-scale" aria-hidden="true"><span></span><span></span><span></span><i style="left:' + view.markerPercent + '%"></i></div>' +
      '<div class="weather-scale-labels"><span>常态关注</span><span>加强关注</span><span>重点复核</span></div>' +
      '<p class="weather-trigger" role="status">' + escape(view.dataIssue || view.trigger) + '</p>' +
      '<div class="weather-actions" aria-label="切换模拟累计雨量">' + [20, 50, 80].map(function (rain) {
        return button(rain + ' mm', rain, view.rainfall === rain ? 'weather-choice is-selected' : 'weather-choice');
      }).join('') + button('启动雨情演练', 50, 'primary weather-start') + '</div>' +
      '<div class="weather-meta"><span>来源：' + escape(view.sourceLabel) + '</span><span>更新时间：' + escape(view.updatedLabel) + '（北京时间）</span></div>' +
      '<p class="weather-boundary">此处为合成演练雨情，等级不是官方预警。天气变化用于复核安排，不直接推断积水深度或自动封路；实时天气接口尚未接入。</p>' +
      '</div></section>';
  }
  return { render: render, deriveWeather: deriveWeather };
});
