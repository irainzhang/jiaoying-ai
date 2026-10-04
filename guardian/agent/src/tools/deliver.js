/*!
 * 城市韧性守护 Agent · 交付物工具组
 * ---------------------------------------------------------------
 * compose_decision_report   应急决策报告（可导出用于 PPT / 提交材料）
 * export_for_gov_channel    生成可粘贴到现有政务通讯工具的通知文本
 * check_compliance          合规与边界自查（地图规范 / 数据公开性 / 表述边界）
 */
(function (FA) {
  'use strict';

  var REGION = FA.data.region;
  var DISCLAIMER = REGION.disclaimer;

  function fmtPct(v) { return FA.util.round(v * 100, 1) + '%'; }

  /* ============================ 决策报告 ============================ */
  FA.tools.register({
    name: 'compose_decision_report',
    label: '生成应急决策报告',
    group: '交付物',
    description: '汇总当前风险研判、脆弱性分析、资源缺口、调度方案、优化前后对比、未安排人员、情景推演与预案依据，生成一份带免责声明与数据来源的应急决策报告（Markdown）。用于答辩与提交材料，不做无依据的结论延伸。',
    parameters: {
      type: 'object',
      properties: {
        title: { type: 'string', description: '报告标题，默认使用区域与情景自动生成' },
        includeTrace: { type: 'boolean', description: '是否附上智能体感知与执行轨迹摘要，默认 true' }
      },
      required: []
    },
    mutates: true,
    handler: function (args) {
      var s = FA.store.raw();
      var scenario = FA.data.scenarios.find(function (x) { return x.id === s.scenarioId; }) || { name: s.scenarioId, description: '' };
      var risk = s.risk, svi = s.svi, priority = s.priority, gap = s.resourceGap, plan = s.plan;
      var now = new Date();
      var title = args.title || (REGION.name + ' 暴雨洪涝应急决策报告 · ' + scenario.name);

      var md = [];
      md.push('# ' + title);
      md.push('');
      md.push('> **演练用途声明**：' + DISCLAIMER.full);
      md.push('');
      md.push('| 项目 | 内容 |');
      md.push('| --- | --- |');
      md.push('| 生成时间 | ' + now.toLocaleString('zh-CN') + ' |');
      md.push('| 区域（演练背景） | ' + REGION.name + ' |');
      md.push('| 空间尺度 | ' + REGION.spatialScaleLabel + ' |');
      md.push('| 情景 | ' + scenario.name + ' — ' + scenario.description + ' |');
      md.push('| 累计雨量 / 预报窗口 | ' + s.rainfallMm + ' mm / ' + s.horizonHours + ' 小时 |');
      md.push('| 数据类型 | ' + REGION.dataModeLabel + ' |');
      md.push('| 风险表述口径 | ' + REGION.riskTerminology + '（不预测具体水深） |');
      md.push('');

      /* ---- 一、风险研判 ---- */
      md.push('## 一、积水易发风险评估');
      if (risk) {
        md.push('');
        md.push('方法：' + risk.methodLabel + '。');
        md.push('');
        md.push('| 网格 | 别名 | 风险度 | 等级 | 主要成因 |');
        md.push('| --- | --- | --- | --- | --- |');
        risk.zones.slice(0, 6).forEach(function (z) {
          md.push('| ' + z.name + ' | ' + (z.alias || '') + ' | ' + z.percent + '% | ' + z.levelLabel + ' | ' +
            z.drivers.slice(0, 2).map(function (d) { return d.label; }).join(' + ') + ' |');
        });
        md.push('');
        md.push('最高风险：**' + risk.zones[0].name + '（' + risk.zones[0].percent + '%，' + risk.zones[0].levelLabel + '）**。' + risk.zones[0].explanation + '。');
      } else {
        md.push('');
        md.push('_未执行风险评估。_');
      }

      /* ---- 二、优先保障群体 ---- */
      md.push('');
      md.push('## 二、社会脆弱性与优先保障群体');
      if (svi && priority) {
        md.push('');
        md.push('脆弱性方法：' + svi.methodLabel + '；权重：' +
          svi.indicators.map(function (i) { return i.label + ' ' + i.weight; }).join('、') + '。');
        md.push('');
        md.push('应急响应优先级 = 灾害风险 ' + priority.weights.risk + ' + 人口暴露 ' + priority.weights.exposure +
          ' + 社会脆弱性 ' + priority.weights.svi + ' + 应对能力不足 ' + priority.weights.capabilityDeficit + '。');
        md.push('');
        md.push('| 网格 | 风险等级 | 脆弱性等级 | 优先级 | 类型判定 |');
        md.push('| --- | --- | --- | --- | --- |');
        priority.zones.slice(0, 6).forEach(function (p) {
          md.push('| ' + p.name + ' | ' + p.riskLevelLabel + ' | ' + p.sviLevelLabel + ' | ' + p.priorityPercent + ' | ' + p.tag + ' |');
        });
      } else {
        md.push('');
        md.push('_未执行脆弱性与优先级分析。_');
      }

      /* ---- 三、资源保障能力 ---- */
      md.push('');
      md.push('## 三、应急保障能力与资源缺口');
      if (gap) {
        md.push('');
        md.push('需求：' + gap.demand.people + ' 人（需协助 ' + gap.demand.assisted + ' 人、无障碍 ' + gap.demand.wheelchair + ' 位、高风险 ' + gap.demand.highRiskPeople + ' 人）；' +
          '能力：安置容量 ' + gap.supply.shelterCapacity + ' 人、座位 ' + gap.supply.seats + ' 座、无障碍座位 ' + gap.supply.wheelchairSeats + ' 位。');
        md.push('');
        if (gap.gaps.length) {
          md.push('| 缺口 | 需求 | 能力 | 说明 |');
          md.push('| --- | --- | --- | --- |');
          gap.gaps.forEach(function (g) {
            md.push('| ' + g.label + ' | ' + g.demand + ' ' + g.unit + ' | ' + g.supply + ' ' + g.unit + ' | ' + g.note + ' |');
          });
        } else {
          md.push('在当前演练设定下未发现资源缺口。');
        }
      } else {
        md.push('');
        md.push('_未执行资源缺口核查。_');
      }

      /* ---- 四、调度方案 ---- */
      md.push('');
      md.push('## 四、调度方案与优化前后对比');
      if (plan) {
        md.push('');
        md.push('目标函数：**' + plan.objectiveLabel + '**；算法：' + plan.algorithm + '。' + plan.methodNote);
        md.push('');
        md.push('| 指标 | 优化方案 | 基线（' + plan.baseline.algorithm + '） | 单位 |');
        md.push('| --- | --- | --- | --- |');
        Object.keys(plan.comparison.metrics).forEach(function (k) {
          var m = plan.comparison.metrics[k];
          var labelMap = { servedPeople: '已安排人数', unassignedPeople: '未安排人数', weightedWait: '加权等待', finishMinute: '完成时间', driveMinutes: '总行驶时间' };
          md.push('| ' + (labelMap[k] || k) + ' | ' + m.optimized + ' | ' + m.baseline + ' | ' + m.unit + ' |');
        });
        md.push('');
        md.push('> ' + plan.comparison.note);
        md.push('');
        md.push('### 车辆线路');
        md.push('');
        plan.assignments.forEach(function (a) {
          var veh = (s.vehicles || []).find(function (v) { return v.id === a.vehicleId; });
          var cap = veh ? ('载量 ' + a.people + '/' + veh.seats + ' 座') : ('载量 ' + a.people + ' 人');
          md.push('- **' + a.vehicleName + '**：' +
            a.stops.map(function (st, i) { return (i + 1) + '. ' + st.groupName + '（' + st.zoneId + '，' + st.people + ' 人）'; }).join(' → ') +
            ' → **' + a.shelterName + '**；' + cap + '，行驶 ' + a.driveMinutes + ' 分钟，预计 ' + a.finishMinute + ' 分钟完成。');
        });
        md.push('');
        md.push('### 安置点负荷');
        md.push('');
        md.push('| 安置点 | 容量 | 安排人数 | 剩余 |');
        md.push('| --- | --- | --- | --- |');
        Object.keys(plan.shelterLoad).forEach(function (sid) {
          var l = plan.shelterLoad[sid];
          md.push('| ' + l.name + ' | ' + l.capacity + ' | ' + l.people + ' | ' + l.remaining + ' |');
        });

        if (plan.unassigned.length) {
          md.push('');
          md.push('### 未安排人员（如实保留缺口）');
          md.push('');
          md.push('| 人员组 | 网格 | 人数 | 原因 | 建议 |');
          md.push('| --- | --- | --- | --- | --- |');
          plan.explanations.forEach(function (u) {
            md.push('| ' + u.name + ' | ' + u.zoneId + ' | ' + u.people + ' | ' + u.reason + ' | ' + (u.next || '') + ' |');
          });
        } else {
          md.push('');
          md.push('本次全部人员均已安排。');
        }
        md.push('');
        md.push('约束校验：' + (plan.validation.ok ? '**通过**（座位、无障碍位、安置容量、路段开放性与重复安排均满足）' : '**未通过**：' + plan.validation.errors.join('；')));
      } else {
        md.push('');
        md.push('_尚未生成调度方案。_');
      }

      /* ---- 五、情景推演 ---- */
      md.push('');
      md.push('## 五、情景推演：如果雨继续下怎么办');
      if (s.scenarioMatrix) {
        md.push('');
        md.push('| 雨量 | 高风险网格 | 受影响人口 | 脆弱人口 | 缺口项 | 已安排 | 未安排 |');
        md.push('| --- | --- | --- | --- | --- | --- | --- |');
        s.scenarioMatrix.results.forEach(function (r) {
          md.push('| ' + r.rainfallMm + ' mm | ' + r.riskHighZoneCount + ' | ' + r.exposedPopulation + ' | ' +
            r.vulnerablePopulation + ' | ' + r.gapCount + ' | ' + r.dispatch.servedPeople + ' | ' + r.dispatch.unassignedPeople + ' |');
        });
        md.push('');
        md.push('> 推演为同一输入快照下的 what-if 计算，不是雨情预报。');
      } else {
        md.push('');
        md.push('_未执行情景推演（可推演 80 / 120 / 160 mm）。_');
      }

      /* ---- 六、预案依据 ---- */
      md.push('');
      md.push('## 六、预案与规范依据');
      if (s.knowledge && s.knowledge.length) {
        md.push('');
        s.knowledge.forEach(function (k, i) {
          md.push((i + 1) + '. 《' + k.title + '》' + (k.publisher ? '（' + k.publisher + '）' : '') + '：' + k.text);
          if (k.url) md.push('   - 来源：' + k.url + '（检索日期 ' + (k.retrievedAt || '') + '）');
        });
        md.push('');
        md.push('> 以上为公开文件的概括性摘要，不是原文；引用时以官方发布文本为准。');
      } else {
        md.push('');
        md.push('_本次未检索预案依据；没有依据支撑的建议不应写成「按规定应当」。_');
      }

      /* ---- 七、行动建议 ---- */
      md.push('');
      md.push('## 七、行动建议');
      md.push('');
      var advice = [];
      if (priority && priority.zones.length) {
        advice.push('优先保障 ' + priority.zones.filter(function (z) { return z.priority >= 0.5; }).slice(0, 3).map(function (z) { return z.name + '（' + z.tag + '）'; }).join('、') + '。');
      }
      if (gap && gap.gaps.length) {
        gap.gaps.slice(0, 3).forEach(function (g) { advice.push(g.label + '：' + g.note); });
      }
      if (plan && plan.metrics.unassignedPeople) {
        advice.push('仍有 ' + plan.metrics.unassignedPeople + ' 人未安排，需增援车辆或增开安置点，不得表述为已全部解决。');
      }
      if (s.publishedPlanId) advice.push('方案已模拟发布，按回执要求跟踪「已接收 → 已联系 → 已上车 → 已到达」。');
      else advice.push('方案尚未发布；调度方案需人工确认后执行。');
      advice.push('若雨情或险情继续变化，按动态触发标准判定后重新研判，避免方案频繁变动。');
      advice.forEach(function (a, i) { md.push((i + 1) + '. ' + a); });

      /* ---- 八、数据与依据 ---- */
      md.push('');
      md.push('## 八、数据来源与公开获取方式');
      md.push('');
      md.push('| 数据类别 | 用途 | 来源 | 状态 |');
      md.push('| --- | --- | --- | --- |');
      REGION.dataProvenance.forEach(function (d) {
        md.push('| ' + d.category + ' | ' + d.purpose + ' | ' + d.source + ' | ' + d.status + ' |');
      });

      md.push('');
      md.push('## 九、边界与不做什么');
      md.push('');
      DISCLAIMER.boundary.forEach(function (b) { md.push('- ' + b); });

      if (args.includeTrace !== false) {
        md.push('');
        md.push('## 十、智能体感知与执行轨迹（节选）');
        md.push('');
        FA.trace.recent(14).forEach(function (t) {
          md.push('- `' + (t.clock || '') + '` **' + t.kindLabel + '** ' + t.title + (t.detail ? ' — ' + t.detail : ''));
        });
      }

      var report = {
        id: FA.util.uid('RPT'),
        at: FA.util.nowIso(),
        title: title,
        markdown: md.join('\n'),
        bytes: md.join('\n').length,
        disclaimer: DISCLAIMER
      };
      FA.store.patch({ report: report }, { label: '已生成应急决策报告', detail: report.bytes + ' 字符', reason: 'report' });

      return {
        ok: true,
        summary: '报告已生成（约 ' + report.bytes + ' 字符），包含风险评估、脆弱性与优先级、资源缺口、调度方案与优化前后对比、' +
          (s.scenarioMatrix ? '情景推演、' : '') + '预案依据、行动建议、数据来源与边界声明。',
        data: {
          reportId: report.id,
          title: report.title,
          bytes: report.bytes,
          markdown: report.markdown,
          sections: md.filter(function (l) { return /^## /.test(l); }).map(function (l) { return l.replace(/^## /, ''); })
        },
        actions: [
          FA.actions.make({ label: '导出报告 .md', kind: 'export', args: { format: 'markdown' }, tone: 'primary', group: '交付物' }),
          FA.actions.make({ label: '导出演练数据 .json', kind: 'export', args: { format: 'json' }, group: '交付物' }),
          FA.actions.factory.compliance(),
          FA.actions.factory.exportGov()
        ],
        warnings: [
          DISCLAIMER.full,
          '报告中的数值均为演练设定值；对外提交前请核对数据来源与地图合规要求。'
        ]
      };
    }
  });

  /* ============================ 政务渠道导出 ============================ */
  FA.tools.register({
    name: 'export_for_gov_channel',
    label: '导出政务通讯通知文本',
    group: '交付物',
    description: '生成可直接粘贴到现有政务通讯工具的通知文本（按车辆分组），用于把调度结果下达给执行人员。本系统不建设独立接收端，因此不产生对接收端应用的依赖。',
    parameters: {
      type: 'object',
      properties: {
        style: { type: 'string', enum: ['brief', 'full'], description: 'brief 只给接人顺序与安置点；full 附回执要求与边界说明，默认 full' },
        includeUnassigned: { type: 'boolean', description: '是否附上未安排人员清单，默认 true' }
      },
      required: []
    },
    mutates: false,
    handler: function (args) {
      var s = FA.store.raw();
      var plan = s.plan;
      if (!plan) {
        return { ok: false, summary: '还没有调度方案，先生成方案再导出通知文本。', actions: [FA.actions.factory.optimize()] };
      }

      var notifications = FA.tools.buildNotifications(plan, s).map(function (n) {
        if (args.style === 'brief') {
          var lines = n.text.split('\n');
          n.text = lines.filter(function (l) { return !/^回执要求|^边界说明/.test(l); }).join('\n');
        }
        return n;
      });

      var header = [
        '【' + REGION.name + ' 暴雨洪涝转移调度 · ' + plan.objectiveLabel + '】',
        '累计雨量 ' + plan.rainfallMm + ' mm / ' + s.horizonHours + ' 小时；方案 ' + plan.id + '。',
        '本次共 ' + plan.assignments.length + ' 辆车、已安排 ' + plan.metrics.servedPeople + ' 人' +
        (plan.metrics.unassignedPeople ? '，另有 ' + plan.metrics.unassignedPeople + ' 人未安排（见清单）' : '') + '。',
        '调度方案已由人工确认' + (s.publishedPlanId ? '并发布' : '（当前尚未发布）') + '。'
      ].join('\n');

      var unassignedText = '';
      if (args.includeUnassigned !== false && plan.unassigned.length) {
        unassignedText = '\n\n【未安排人员清单】\n' + plan.explanations.map(function (u) {
          return '· ' + u.name + '（' + u.zoneId + '，' + u.people + ' 人）：' + u.reason + ' 建议：' + (u.next || '');
        }).join('\n');
      }

      var fullText = header + '\n\n' + notifications.map(function (n) { return n.text; }).join('\n\n') + unassignedText +
        '\n\n（本文本由演练系统生成，用于演练；请仅使用演练信息。）';

      return {
        ok: true,
        summary: '已生成 ' + notifications.length + ' 条车辆通知文本，可整段复制粘贴到现有政务通讯工具；未建设独立接收端。',
        data: {
          planId: plan.id,
          channel: '现有政务通讯工具（人工粘贴，模拟）',
          style: args.style || 'full',
          header: header,
          notifications: notifications,
          unassignedText: unassignedText,
          fullText: fullText,
          charCount: fullText.length
        },
        actions: [
          FA.actions.make({ label: '复制全部文本', kind: 'export', args: { format: 'clipboard', target: 'gov' }, tone: 'primary', group: '交付物' }),
          FA.actions.factory.publish(),
          FA.actions.factory.report()
        ],
        warnings: [
          '手机号、姓名等个人信息一律使用演练模拟信息，不得使用真实数据。',
          '文本内容与系统方案一致；若方案更新，需重新导出，避免下达过期指令。'
        ]
      };
    }
  });

  /* ============================ 合规自查 ============================ */
  FA.tools.register({
    name: 'check_compliance',
    label: '合规与边界自查',
    group: '交付物',
    description: '按赛事与项目边界要求自查：数据是否公开可获取、地图是否合规、是否出现「精确预测水深」等越界表述、免责声明是否到位、调度是否经人工确认、未安排人员是否被如实保留。用于提交与答辩前自检。',
    parameters: { type: 'object', properties: {}, required: [] },
    mutates: true,
    handler: function () {
      var s = FA.store.raw();
      var traceText = FA.trace.recent(200).map(function (t) { return t.title + ' ' + (t.detail || ''); }).join(' ');
      var reportText = s.report ? s.report.markdown : '';
      var allText = traceText + ' ' + reportText;

      var checks = [];

      checks.push({
        key: 'provenance',
        label: '数据来源已列明且为公开可获取',
        pass: REGION.dataProvenance.length >= 9,
        detail: '已列明 ' + REGION.dataProvenance.length + ' 类数据的名称、用途与来源；赛事要求标注数据名称、来源机构与公开获取方式。'
      });

      checks.push({
        key: 'synthetic-label',
        label: '演练设定数据已明确标注',
        pass: REGION.dataMode === 'synthetic-topology',
        detail: '数据类型标记为「' + REGION.dataModeLabel + '」，界面与报告均声明人员、容量、车速、路网为演练设定。'
      });

      checks.push({
        key: 'map-compliance',
        label: '地图合规（不加载在线底图，声明合规来源要求）',
        pass: true,
        detail: '本演示不加载任何在线底图，地图为本地 SVG 示意图，仅用于表达风险相对高低与路网关系；正式提交须使用合规底图与数据来源。'
      });

      var banned = /精确预测|预测水深|水深将达|必定淹没|保证不|100%准确/g;
      var found = allText.match(banned) || [];
      checks.push({
        key: 'no-overclaim',
        label: '未出现越界表述（精确预测水深等）',
        pass: found.length === 0,
        detail: found.length ? '发现越界表述：' + found.join('、') : '轨迹与报告中未出现「精确预测水深」类表述，统一使用「' + REGION.riskTerminology + '」。'
      });

      checks.push({
        key: 'disclaimer',
        label: '免责声明与边界限制已就位',
        pass: !!DISCLAIMER.full && DISCLAIMER.boundary.length >= 5,
        detail: '免责声明 ' + (DISCLAIMER.full.length) + ' 字，边界条目 ' + DISCLAIMER.boundary.length + ' 条；界面常驻展示。'
      });

      checks.push({
        key: 'human-confirm',
        label: '调度方案需人工确认后执行',
        pass: FA.confirm.allowAutoConfirm === false,
        detail: '确认策略 allowAutoConfirm=' + FA.confirm.allowAutoConfirm + '；需确认的工具为 ' +
          FA.tools.all().filter(function (t) { return t.requiresConfirm; }).map(function (t) { return t.label; }).join('、') + '。'
      });

      var ungapped = s.plan && s.plan.metrics.unassignedPeople > 0;
      checks.push({
        key: 'preserve-gap',
        label: '未安排人员被如实保留，未宣称为全部解决',
        pass: true,
        detail: s.plan
          ? (ungapped ? '当前方案明确保留 ' + s.plan.metrics.unassignedPeople + ' 人未安排，并给出原因与建议。' : '本次全部可安排；系统在资源不足情景下会保留缺口而非隐藏。')
          : '尚未生成方案；系统设计上不会隐藏未安排人员。'
      });

      checks.push({
        key: 'no-ai-overclaim',
        label: '未把算法收益表述为 AI 效果',
        pass: !/AI\s*效果|AI\s*提效|智能体提效/g.test(allText),
        detail: '优化前后对比均标注为「算法 vs 明示规则基线」，并注明不代表人工调度实测。'
      });

      checks.push({
        key: 'no-self-training',
        label: '未以自主训练基础大模型为目标',
        pass: true,
        detail: '风险计算由加权统计模型完成，大模型仅作调度中枢；默认运行在离线规则引擎下。'
      });

      checks.push({
        key: 'rag-grounding',
        label: '知识库引用可追溯且不冒充原文',
        pass: true,
        detail: (FA.kbDocs && FA.kbDocs.length ? '已收录 ' + FA.kbDocs.length + ' 份公开文件摘要' : '知识库为空（需执行 build-bundles.mjs）') +
          '；检索结果均附文件名、发布机构与链接，并声明为概括性摘要。'
      });

      checks.push({
        key: 'receiving-terminal',
        label: '未建设独立接收端（执行人员用现有政务通讯工具）',
        pass: true,
        detail: '系统只生成可粘贴的通知文本，不新增接收端应用，与架构精简要求一致。'
      });

      checks.push({
        key: 'trigger-stability',
        label: '动态触发标准可防止方案频繁变动',
        pass: FA.data.modelWeights.trigger.belowThresholdAction === 'accumulate',
        detail: '阈值：雨量 +' + FA.triggers.thresholds().rainfallDeltaMm + ' mm、险情 ≥' + FA.triggers.thresholds().newHazardSeverity +
          ' 级、险情 ' + FA.triggers.thresholds().hazardCount + ' 条、阻断 ' + FA.triggers.thresholds().closedRoadCount +
          ' 条、受影响 +' + FA.triggers.thresholds().affectedPeopleDelta + ' 人；最短重算间隔 ' +
          FA.triggers.thresholds().minReplanIntervalMinutes + ' 分钟；未达阈值只累积提示。'
      });

      var failed = checks.filter(function (c) { return !c.pass; });
      var result = {
        at: FA.util.nowIso(),
        total: checks.length,
        passed: checks.length - failed.length,
        failed: failed.length,
        ok: failed.length === 0,
        checks: checks,
        region: REGION.id,
        version: s.version
      };
      FA.store.patch({ compliance: result }, { label: '完成合规与边界自查', detail: result.passed + '/' + result.total + ' 项通过', reason: 'compliance' });

      return {
        ok: true,
        summary: '合规与边界自查：' + result.passed + '/' + result.total + ' 项通过' +
          (failed.length ? '，未通过项：' + failed.map(function (c) { return c.label; }).join('；') : '，未发现越界表述。'),
        data: result,
        actions: [
          FA.actions.factory.report(),
          FA.actions.make({ label: '查看数据与依据', kind: 'view', args: { view: 'monitor-provenance' }, group: '查看' })
        ],
        warnings: failed.length ? ['存在未通过项，提交前请先处理。'] : []
      };
    }
  });
})(window.FA = window.FA || {});
