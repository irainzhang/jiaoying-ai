/*!
 * 城市韧性守护 Agent · 人工确认闸门
 * ---------------------------------------------------------------
 * 会议纪要原文：「调度方案需人工确认后执行」。
 * Word 文档边界：「不轻易宣称可精确预测……」。
 *
 * 这条规则是硬约束，不是 UI 装饰：
 *   - 需要确认的工具（publish_dispatch_plan、export_for_gov_channel 等）
 *     在没有「已批准的确认令牌」时一律拒绝执行并返回待确认状态；
 *   - 令牌与「工具名 + 参数指纹」绑定，换参数就换令牌，防止批准 A 执行 B；
 *   - 默认禁止程序自动确认（allowAutoConfirm=false），
 *     离线规则引擎无法自己给自己盖章，必须由界面上的真实点击触发。
 */
(function (FA) {
  'use strict';

  var pending = {};     // token -> request
  var approved = {};    // token -> {approvedAt, by, signature}
  var counter = 0;
  var TTL_MS = 10 * 60 * 1000;

  function clone(value) { return JSON.parse(JSON.stringify(value)); }
  function stateBinding() {
    var s = FA.store && FA.store.get ? FA.store.get() : {};
    // Bind the actual reviewed plan and execution facts, including calls that omit planId.
    return JSON.stringify({ inputRevision: s.inputRevision, scenarioId: s.scenarioId,
      rainfallMm: s.rainfallMm, plan: s.plan, tasks: s.tasks, roads: s.roads,
      vehicles: s.vehicles, shelters: s.shelters, groups: s.groups,
      publishedPlanId: s.publishedPlanId, publishedAt: s.publishedAt });
  }
  function current(req) {
    return !!req && Date.now() - req.createdMs < TTL_MS && req.stateBinding === stateBinding();
  }
  function humanClick(event) {
    return typeof Event !== 'undefined' && event instanceof Event && event.isTrusted === true && event.type === 'click';
  }

  function signature(toolName, args) {
    var clean = Object.assign({}, args || {});
    delete clean._confirmToken;
    delete clean._actor;
    var keys = Object.keys(clean).sort();
    var payload = keys.map(function (k) { return k + '=' + JSON.stringify(clean[k]); }).join('&');
    // 轻量哈希：仅用于绑定令牌与参数，不用于安全用途
    var h = 5381;
    for (var i = 0; i < payload.length; i++) h = ((h << 5) + h + payload.charCodeAt(i)) >>> 0;
    return toolName + '#' + h.toString(36) + '#' + payload.length;
  }

  FA.confirm = {
    list: function () {
      return Object.keys(pending).filter(function (k) {
        if (current(pending[k])) return true;
        delete pending[k];
        return false;
      }).map(function (k) { return clone(pending[k]); });
    },

    /**
     * 申请确认。
     * @param {string} toolName 需确认的工具
     * @param {object} args 参数
     * @param {object} meta { summary, detail, risk, actions }
     */
    request: function (toolName, args, meta) {
      counter += 1;
      var token = 'CF' + Date.now().toString(36) + counter.toString(36);
      var req = {
        token: token,
        toolName: toolName,
        args: clone(args || {}),
        signature: signature(toolName, args),
        summary: (meta && meta.summary) || ('执行 ' + toolName),
        detail: (meta && meta.detail) || '',
        risk: (meta && meta.risk) || 'normal',
        requestedAt: FA.util.nowIso(),
        createdMs: Date.now(),
        stateBinding: stateBinding(),
        status: 'pending'
      };
      pending[token] = req;
      FA.trace.push('confirm', '等待人工确认：' + req.summary, {
        detail: req.detail + '（需人工确认后执行，智能体不会自行批准）',
        meta: { token: token, tool: toolName }
      });
      FA.bus.emit('confirm:request', clone(req));
      return clone(req);
    },

    /** Only a trusted, explicit click in the confirmation modal may approve. */
    approve: function (token, actor, event) {
      var req = pending[token];
      if (!current(req)) {
        delete pending[token];
        return { ok: false, message: '确认请求已过期或方案依据已变化，请重新核对后申请确认。' };
      }
      var by = (typeof actor === 'string' ? actor.trim() : '') || '演练值守';
      if (!humanClick(event)) return { ok: false, message: '必须在人工确认框中亲自点击确认；禁止程序自动批准。' };
      req.status = 'approved';
      req.approvedBy = by;
      req.approvedAt = FA.util.nowIso();
      approved[token] = { approvedAt: req.approvedAt, by: by, signature: req.signature,
        stateBinding: req.stateBinding, createdMs: req.createdMs };
      delete pending[token];
      FA.trace.push('confirm', '人工已确认：' + req.summary, {
        detail: '确认人：' + by + '。确认后系统按方案执行，并可随时回退。'
      });
      FA.bus.emit('confirm:approved', clone(req));
      return { ok: true, request: clone(req) };
    },

    reject: function (token, actor, reason) {
      var req = pending[token];
      if (!req) return { ok: false, message: '确认请求不存在：' + token };
      req.status = 'rejected';
      delete pending[token];
      FA.trace.push('confirm', '人工驳回：' + req.summary, {
        detail: '驳回人：' + (actor || '未署名操作人') + '。原因：' + (reason || '未填写') + '。方案未发布，可调整后重新生成。'
      });
      FA.bus.emit('confirm:rejected', req);
      return { ok: true, request: req };
    },

    /** 校验令牌是否对该工具与参数有效 */
    verify: function (toolName, args) {
      var token = args && args._confirmToken;
      if (!token) return { ok: false, reason: 'missing' };
      var rec = approved[token];
      if (!rec) return { ok: false, reason: 'unknown-or-pending' };
      if (!current(rec)) { delete approved[token]; return { ok: false, reason: 'expired-or-state-changed' }; }
      if (rec.signature !== signature(toolName, args)) return { ok: false, reason: 'signature-mismatch' };
      delete approved[token]; // One approval authorizes one execution only.
      return { ok: true, by: rec.by, approvedAt: rec.approvedAt };
    },

    signature: signature,
    clear: function () { pending = {}; approved = {}; }
  };
  Object.defineProperty(FA.confirm, 'allowAutoConfirm', { value: false, enumerable: true });
})(window.FA = window.FA || {});
