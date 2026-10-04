/*!
 * 无依赖脚本加载器
 * ---------------------------------------------------------------
 * 本项目的运行时代码是「经典脚本 + window.FA 命名空间」，这样既能被
 * GitHub Pages 直接托管，也能双击用 file:// 打开（ES Module 在 file:// 下
 * 会被浏览器的同源策略拦掉，演示现场不能冒这个风险）。
 *
 * 因此 Node 端测试需要一个等价的小加载器：在一个隔离的 vm 上下文里
 * 按顺序执行同样的脚本，拿到同一个 window.FA。
 */
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(here, '../../dist/guardian');

/** 全部运行时脚本，顺序即依赖顺序 */
export const SCRIPTS = [
  'agent/assets/data/region-config.js',
  'agent/assets/data/ruian-scenario.js',
  'agent/assets/skills-bundle.js',
  'agent/assets/kb-bundle.js',
  'agent/api-config.js',
  'agent/src/core/bus.js',
  'agent/src/core/store.js',
  'agent/src/core/triggers.js',
  'agent/src/core/confirm.js',
  'agent/src/core/analytics.js',
  'agent/src/core/optimizer.js',
  'agent/src/core/actions.js',
  'agent/src/skills/registry.js',
  'agent/src/tools/registry.js',
  'agent/src/tools/risk.js',
  'agent/src/tools/knowledge.js',
  'agent/src/tools/optimize.js',
  'agent/src/tools/workflow.js',
  'agent/src/tools/deliver.js',
  'agent/src/llm/adapter.js',
  'agent/src/llm/offline.js',
  'agent/src/llm/openai-compatible.js',
  'agent/src/core/agent-loop.js'
];

/** 只加载「核心 + 分析」的最小集合（用于算法单元测试） */
export const CORE_SCRIPTS = SCRIPTS.slice(0, SCRIPTS.indexOf('agent/src/core/optimizer.js') + 1);

/** 可选：由 scripts/build-bundles.mjs 生成；缺失时相关测试会标记为跳过 */
export const BUNDLE_SCRIPTS = [
  'agent/assets/skills-bundle.js',
  'agent/assets/kb-bundle.js'
];

/**
 * 在隔离上下文中按顺序执行脚本。
 * @param {string[]} files 相对 ROOT 的路径
 * @param {object} [extra] 额外注入到上下文的全局变量
 * @returns {object} FA 命名空间
 */
export function loadFA(files = SCRIPTS, extra = {}) {
  // 主脚本列表默认带上可选 bundle（存在才加载），这样测试与浏览器行为一致
  const list = files;

  const sandbox = Object.assign({
    console,
    URL, AbortController, setTimeout, clearTimeout,
    // 浏览器环境提供 fetch；Node 端注入一个「一定失败」的桩，
    // 用于验证在线路径失败时能正确回落到离线规则引擎。
    fetch: () => Promise.reject(new Error('network unreachable (test stub)'))
  }, extra);
  sandbox.window = sandbox;
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);

  const missing = [];
  for (const rel of list) {
    const abs = path.join(ROOT, rel);
    if (!fs.existsSync(abs)) { missing.push(rel); continue; }
    const code = fs.readFileSync(abs, 'utf8');
    try {
      vm.runInContext(code, sandbox, { filename: rel });
    } catch (err) {
      const e = new Error(`加载 ${rel} 失败：${err.message}`);
      e.stack = err.stack;
      throw e;
    }
  }
  if (missing.length) {
    const e = new Error('缺少脚本：' + missing.join(', '));
    e.missing = missing;
    throw e;
  }
  if (!sandbox.FA) throw new Error('脚本执行完毕但没有产生 window.FA 命名空间');
  sandbox.FA.__missing = missing;
  sandbox.FA.__loadedBundles = BUNDLE_SCRIPTS.filter((f) => list.indexOf(f) >= 0);
  return sandbox.FA;
}

/** 构造一个 optimizer 需要的 world 快照 */
export function worldFrom(FA, overrides = {}) {
  const s = FA.store.raw();
  return Object.assign({
    zones: s.zones,
    groups: s.enableVillageGrowth ? FA.store.activeGroups() : s.groups,
    shelters: FA.store.activeShelters(),
    vehicles: FA.store.activeVehicles(),
    roads: s.roads,
    rainfallMm: s.rainfallMm
  }, overrides);
}
