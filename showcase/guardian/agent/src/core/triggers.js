/*!
 * 城市韧性守护 Agent · 动态触发标准
 * ---------------------------------------------------------------
 * 会议纪要原文：「允许用户在地图上长按提交险情修改，设定动态触发标准
 * 避免方案频繁变动」。
 *
 * 因此本模块把「输入变化」和「要不要重算方案」严格分开：
 *   - 输入变化一律被记录（pendingChanges）；
 *   - 只有命中阈值才建议重算；
 *   - 未命中阈值时只提示并累积，绝不静默重算 —— 否则现场方案会跳来跳去。
 *   - 即使命中阈值，也只是「建议」，重算仍需一次动作按钮（人工确认）。
 */
(function (FA) {
  'use strict';

  function thresholds() {
    return FA.data.modelWeights.trigger.thresholds;
  }

  function minutesSince(iso) {
    if (!iso) return Infinity;
    return (Date.now() - new Date(iso).getTime()) / 60000;
  }

  FA.triggers = {
    thresholds: thresholds,

    /**
     * 评估当前累积变化是否需要重算方案。
     * @param {object} [opts] opts.force 强制判定（用于「重新研判」按钮）
     * @returns {{
     *   shouldReplan:boolean, forced:boolean, level:'none'|'watch'|'trigger',
     *   hits:Array, missed:Array, reasons:string[], recommendation:string,
     *   cooldownActive:boolean, cooldownRemainMinutes:number
     * }}
     */
    evaluate: function (opts) {
      opts = opts || {};
      var pc = FA.store.peekPendingChanges();
      var th = thresholds();
      var hits = [], missed = [], reasons = [];

      // ---- 逐条比对阈值 ----
      if (pc.rainfallDeltaMm >= th.rainfallDeltaMm) {
        hits.push({ key: 'rainfallDeltaMm', label: '累计雨量增量', value: pc.rainfallDeltaMm, threshold: th.rainfallDeltaMm, unit: 'mm' });
        reasons.push('累计雨量较上次方案增加 ' + FA.util.round(pc.rainfallDeltaMm, 1) + ' mm，达到重算阈值 ' + th.rainfallDeltaMm + ' mm');
      } else {
        missed.push({ key: 'rainfallDeltaMm', label: '累计雨量增量', value: pc.rainfallDeltaMm, threshold: th.rainfallDeltaMm, unit: 'mm' });
      }

      if (pc.maxSeverity >= th.newHazardSeverity) {
        hits.push({ key: 'newHazardSeverity', label: '险情严等级', value: pc.maxSeverity, threshold: th.newHazardSeverity, unit: '级' });
        reasons.push('出现严等级 ' + pc.maxSeverity + ' 级的险情，达到重算阈值 ' + th.newHazardSeverity + ' 级');
      } else {
        missed.push({ key: 'newHazardSeverity', label: '险情严等级', value: pc.maxSeverity, threshold: th.newHazardSeverity, unit: '级' });
      }

      if (pc.hazardCount >= th.hazardCount) {
        hits.push({ key: 'hazardCount', label: '新增险情条数', value: pc.hazardCount, threshold: th.hazardCount, unit: '条' });
        reasons.push('新增险情 ' + pc.hazardCount + ' 条，达到重算阈值 ' + th.hazardCount + ' 条');
      } else {
        missed.push({ key: 'hazardCount', label: '新增险情条数', value: pc.hazardCount, threshold: th.hazardCount, unit: '条' });
      }

      if (pc.closedRoadCount >= th.closedRoadCount) {
        hits.push({ key: 'closedRoadCount', label: '新增阻断路段', value: pc.closedRoadCount, threshold: th.closedRoadCount, unit: '条' });
        reasons.push('新增 ' + pc.closedRoadCount + ' 条阻断路段，达到重算阈值 ' + th.closedRoadCount + ' 条');
      } else {
        missed.push({ key: 'closedRoadCount', label: '新增阻断路段', value: pc.closedRoadCount, threshold: th.closedRoadCount, unit: '条' });
      }

      if (pc.affectedPeopleDelta >= th.affectedPeopleDelta) {
        hits.push({ key: 'affectedPeopleDelta', label: '受影响人数增量', value: pc.affectedPeopleDelta, threshold: th.affectedPeopleDelta, unit: '人' });
        reasons.push('受影响人数增加 ' + pc.affectedPeopleDelta + ' 人，达到重算阈值 ' + th.affectedPeopleDelta + ' 人');
      } else {
        missed.push({ key: 'affectedPeopleDelta', label: '受影响人数增量', value: pc.affectedPeopleDelta, threshold: th.affectedPeopleDelta, unit: '人' });
      }

      // ---- 冷却期：防止连续重算抖动 ----
      var sinceReplan = minutesSince(pc.lastReplanAt);
      var cooldownActive = sinceReplan < th.minReplanIntervalMinutes;
      var cooldownRemain = cooldownActive ? FA.util.round(th.minReplanIntervalMinutes - sinceReplan, 1) : 0;

      // ---- 方案静默超时：方案放久了要提示复核 ----
      var plan = FA.store.get().plan;
      var planAge = plan ? minutesSince(plan.at) : Infinity;
      var planStale = plan ? planAge >= th.planAgeMinutes : false;

      var shouldReplan = false;
      var level = 'none';
      if (hits.length > 0) {
        if (cooldownActive && !opts.force) {
          level = 'watch';
          reasons.push('但距上次重算仅 ' + FA.util.round(sinceReplan, 1) + ' 分钟，处于 ' + th.minReplanIntervalMinutes + ' 分钟冷却期内，暂不重算，仅提示');
        } else {
          shouldReplan = true;
          level = 'trigger';
        }
      } else if (pc.count > 0 || planStale) {
        level = 'watch';
      }

      var recommendation;
      if (opts.force) {
        recommendation = '已按指挥员要求强制执行一次重新研判（忽略阈值与冷却期）。';
        shouldReplan = true;
        level = 'trigger';
      } else if (shouldReplan) {
        recommendation = '建议重新研判并生成新方案。为避免方案频繁变动，请由指挥员确认后再执行。';
      } else if (cooldownActive && hits.length > 0) {
        recommendation = '变化已记录，但仍在冷却期内。可继续观察，或手动触发一次强制重算。';
      } else if (pc.count > 0) {
        var accumulate = FA.data.modelWeights.trigger.belowThresholdAction === 'accumulate';
        recommendation = '变化已记录，尚未达到重算阈值；' +
          (accumulate ? '系统只累积并提示，不重算方案。' : '系统将累积后统一重算。');
      } else if (planStale) {
        recommendation = '输入无新变化，但当前方案已生成超过 ' + th.planAgeMinutes + ' 分钟，建议复核一次。';
      } else {
        recommendation = '当前无待处理变化。';
      }

      return {
        shouldReplan: shouldReplan,
        forced: !!opts.force,
        level: level,
        hits: hits,
        missed: missed,
        reasons: reasons,
        recommendation: recommendation,
        cooldownActive: cooldownActive,
        cooldownRemainMinutes: cooldownRemain,
        sinceReplanMinutes: isFinite(sinceReplan) ? FA.util.round(sinceReplan, 1) : null,
        planAgeMinutes: isFinite(planAge) ? FA.util.round(planAge, 1) : null,
        pendingCount: pc.count,
        belowThresholdAction: FA.data.modelWeights.trigger.belowThresholdAction
      };
    },

    /** 供界面显示的阈值表 */
    table: function () {
      var th = thresholds();
      return [
        { label: '累计雨量增量', threshold: th.rainfallDeltaMm, unit: 'mm' },
        { label: '险情严等级', threshold: th.newHazardSeverity, unit: '级' },
        { label: '新增险情条数', threshold: th.hazardCount, unit: '条' },
        { label: '新增阻断路段', threshold: th.closedRoadCount, unit: '条' },
        { label: '受影响人数增量', threshold: th.affectedPeopleDelta, unit: '人' },
        { label: '方案静默时长', threshold: th.planAgeMinutes, unit: '分钟' },
        { label: '最短重算间隔', threshold: th.minReplanIntervalMinutes, unit: '分钟' }
      ];
    }
  };
})(window.FA = window.FA || {});
