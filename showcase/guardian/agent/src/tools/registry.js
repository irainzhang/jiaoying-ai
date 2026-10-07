/*!
 * 城市韧性守护 Agent · 工具注册表
 * ---------------------------------------------------------------
 * 对应 Word 文档「AI智能体 = LLM + Tool Calling」与会议纪要
 * 「智能体需调用工具修改状态并推动工作流」。
 *
 * 每一项工具都以「可被大模型理解的描述 + JSON Schema 参数」声明，
 * 因此同一套工具既能被离线规则引擎调用，也能直接交给大模型做 function calling：
 *
 *   FA.tools.execute('optimize_dispatch', { objective: 'risk_first' })
 *
 * 统一契约（所有工具必须遵守）：
 *   返回值 { ok, tool, summary, data?, actions?, citations?, warnings?, needConfirm? }
 *   - summary  一句可直接放进对话的话
 *   - actions  建议的下一步动作按钮（会议纪要硬要求）
 *   - warnings 边界与免责提示
 *   - 需要人工确认的工具在未获批准时返回 needConfirm + confirmRequest
 */
(function (FA) {
  'use strict';

  var defs = {};
  var order = [];

  var STAGE_LABELS = {
    created: '已生成',
    published: '已发布',
    notified: '已通知',
    received: '已接收',
    contacted: '已联系',
    boarded: '已上车',
    arrived: '已到达',
    held: '待增援',
    cancelled: '已取消'
  };

  FA.tools = {
    /** 注册一个工具 */
    register: function (def) {
      if (!def || !def.name) throw new Error('工具必须有 name');
      if (defs[def.name]) throw new Error('工具重复注册：' + def.name);
      if (!def.description) throw new Error('工具必须有 description（大模型据此决定是否调用）：' + def.name);
      defs[def.name] = Object.assign({
        parameters: { type: 'object', properties: {}, required: [] },
        requiresConfirm: false,
        mutates: false,
        group: '其他'
      }, def);
      order.push(def.name);
      return defs[def.name];
    },

    get: function (name) { return defs[name] || null; },
    has: function (name) { return !!defs[name]; },
    names: function () { return order.slice(); },
    all: function () { return order.map(function (n) { return defs[n]; }); },

    /** OpenAI / Codex 兼容的 function-calling 工具声明 */
    toOpenAiSchema: function () {
      return order.map(function (n) {
        var d = defs[n];
        return {
          type: 'function',
          function: {
            name: d.name,
            description: d.description,
            parameters: d.parameters
          }
        };
      });
    },

    /** 供界面/文档展示的精简工具目录 */
    catalog: function () {
      return order.map(function (n) {
        var d = defs[n];
        return {
          name: d.name,
          label: d.label || d.name,
          group: d.group,
          description: d.description,
          requiresConfirm: !!d.requiresConfirm,
          mutates: !!d.mutates,
          parameters: d.parameters
        };
      });
    },

    stageLabel: function (stage) { return STAGE_LABELS[stage] || stage; },
    stageLabels: function () { return STAGE_LABELS; },

    /* ------------------------------ 参数校验 ------------------------------ */
    validateArgs: function (def, args) {
      var errors = [];
      var schema = def.parameters || {};
      var props = schema.properties || {};
      var required = schema.required || [];
      args = args || {};

      required.forEach(function (key) {
        var v = args[key];
        if (v === undefined || v === null || v === '') errors.push('缺少必填参数 ' + key);
      });

      Object.keys(props).forEach(function (key) {
        var v = args[key];
        if (v === undefined || v === null) return;
        var spec = props[key];
        var type = spec.type;
        if (type === 'number' || type === 'integer') {
          if (typeof v !== 'number' || !isFinite(v)) errors.push('参数 ' + key + ' 必须是数字');
          else if (spec.minimum != null && v < spec.minimum) errors.push('参数 ' + key + ' 不能小于 ' + spec.minimum);
          else if (spec.maximum != null && v > spec.maximum) errors.push('参数 ' + key + ' 不能大于 ' + spec.maximum);
        } else if (type === 'array') {
          if (!Array.isArray(v)) errors.push('参数 ' + key + ' 必须是数组');
          else if (spec.maxItems != null && v.length > spec.maxItems) errors.push('参数 ' + key + ' 最多 ' + spec.maxItems + ' 项');
        } else if (type === 'string') {
          if (typeof v !== 'string') errors.push('参数 ' + key + ' 必须是字符串');
          else if (spec.enum && spec.enum.indexOf(v) < 0) errors.push('参数 ' + key + ' 只允许：' + spec.enum.join(' / '));
        } else if (type === 'boolean') {
          if (typeof v !== 'boolean') errors.push('参数 ' + key + ' 必须是布尔值');
        }
      });
      return { ok: errors.length === 0, errors: errors };
    },

    /* ------------------------------ 执行入口 ------------------------------ */
    /**
     * 唯一的工具调用入口。同步工具直接返回结果对象；
     * 异步工具（需要联网的天气适配器）返回 Promise，由调用方 await。
     */
    execute: function (name, args, ctx) {
      ctx = ctx || {};
      var def = defs[name];
      if (!def) {
        return {
          ok: false,
          tool: name,
          summary: '未知工具 ' + name,
          warnings: ['可用工具：' + order.join('、')]
        };
      }
      args = Object.assign({}, args || {});

      var check = this.validateArgs(def, args);
      if (!check.ok) {
        FA.trace.push('error', '工具参数校验失败：' + (def.label || name), { detail: check.errors.join('；') });
        return { ok: false, tool: name, summary: '参数不完整：' + check.errors.join('；'), warnings: check.errors };
      }

      // ---- 确认闸门：需要人工确认的工具必须先拿到令牌 ----
      if (def.requiresConfirm) {
        var verdict = FA.confirm.verify(name, args);
        if (!verdict.ok) {
          var existing = FA.confirm.list().find(function (r) {
            return r.toolName === name && r.signature === FA.confirm.signature(name, args);
          });
          var req = existing || FA.confirm.request(name, args, {
            summary: (def.label || name) + (args.summary ? '（' + args.summary + '）' : ''),
            detail: def.confirmDetail || '该操作会改变执行状态并对外发布，需人工确认后执行。',
            risk: 'high'
          });
          return {
            ok: false,
            tool: name,
            needConfirm: true,
            confirmRequest: req,
            summary: '这一步需要人工确认后执行：' + (def.label || name) + '。智能体不会自行批准。',
            warnings: ['调度方案需人工确认后执行（方案边界要求）。'],
            actions: [
              FA.actions.make({
                label: '确认并执行',
                kind: 'confirm',
                tone: 'danger',
                args: { token: req.token, tool: name, params: this.publicArgs(args) },
                group: '人工确认',
                hint: '以当前操作人身份确认该项操作'
              }),
              FA.actions.make({
                label: '先不执行',
                kind: 'prompt',
                prompt: '暂不发布，先说明方案的风险与未安排人员。',
                group: '人工确认',
                hint: '保留方案但不发布'
              })
            ]
          };
        }
        FA.trace.push('confirm', '确认令牌校验通过：' + (def.label || name), {
          detail: '确认人：' + verdict.by + '，确认时间 ' + FA.util.formatTime(verdict.approvedAt)
        });
        args._confirmedBy = verdict.by;
      }

      // ---- 执行并记录轨迹（进入/返回成对） ----
      var startedAt = Date.now();
      FA.trace.toolStart(name, def.label, this.publicArgs(args));
      var result;
      try {
        result = def.handler(args, ctx);
      } catch (err) {
        FA.trace.toolEnd(name, def.label, { error: String(err && err.message || err) }, startedAt, false);
        return {
          ok: false,
          tool: name,
          summary: '工具执行失败：' + String(err && err.message || err),
          warnings: ['该步骤未完成，后续结论不应基于此步。']
        };
      }

      if (result && typeof result.then === 'function') {
        return result.then(function (r) {
          return finalize(name, def, r, startedAt, ctx);
        }, function (err) {
          FA.trace.toolEnd(name, def.label, { error: String(err && err.message || err) }, startedAt, false);
          return {
            ok: false,
            tool: name,
            summary: '工具执行失败：' + String(err && err.message || err),
            warnings: ['该步骤未完成，后续结论不应基于此步。']
          };
        });
      }
      return finalize(name, def, result, startedAt, ctx);
    },

    /** 去掉内部下划线参数，避免泄漏到轨迹与报告里 */
    publicArgs: function (args) {
      var out = {};
      Object.keys(args || {}).forEach(function (k) {
        if (k.charAt(0) === '_') return;
        out[k] = args[k];
      });
      return out;
    }
  };

  function finalize(name, def, raw, startedAt, ctx) {
    var res = Object.assign({
      ok: true,
      tool: name,
      toolLabel: def.label || name,
      summary: '',
      data: null,
      actions: [],
      citations: [],
      warnings: []
    }, raw || {});

    FA.trace.toolEnd(name, def.label, {
      ok: res.ok,
      summary: res.summary,
      stateChanged: !!def.mutates,
      source: ctx.source || 'agent'
    }, startedAt, res.ok !== false);

    if (res.ok && def.mutates) {
      FA.bus.emit('tool:mutation', { tool: name, label: def.label, at: FA.util.nowIso(), summary: res.summary });
    }
    return res;
  }
})(window.FA = window.FA || {});
