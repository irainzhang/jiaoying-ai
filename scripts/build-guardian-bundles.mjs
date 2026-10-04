/*!
 * 打包脚本：把 SKILL.md 与知识库 Markdown 内联成浏览器可直接加载的 bundle
 * ---------------------------------------------------------------
 * 为什么需要这一步：
 *   本项目的运行时是「经典脚本 + window.FA」，可以直接用 file:// 双击打开，
 *   不依赖任何服务器。但 file:// 下浏览器禁止 fetch 本地文件，
 *   所以技能与知识库必须在开发时内联成 .js。
 *
 * 用法（在项目根目录）：
 *   node scripts/build-bundles.mjs
 *
 * 什么时候要重跑：
 *   - 新增 / 修改了 agent/src/skills/<name>/SKILL.md
 *   - 新增 / 修改了 agent/assets/kb/*.md
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, '../dist/guardian');
const SKILLS_DIR = path.join(ROOT, 'agent', 'src', 'skills');
const KB_DIR = path.join(ROOT, 'agent', 'assets', 'kb');
const OUT_SKILLS = path.join(ROOT, 'agent', 'assets', 'skills-bundle.js');
const OUT_KB = path.join(ROOT, 'agent', 'assets', 'kb-bundle.js');

function rel(p) { return path.relative(ROOT, p).split(path.sep).join('/'); }

function readText(p) { return fs.readFileSync(p, 'utf8').replace(/^\uFEFF/, ''); }

/* ------------------------------ 技能 ------------------------------ */
function collectSkills() {
  if (!fs.existsSync(SKILLS_DIR)) return [];
  const out = [];
  for (const entry of fs.readdirSync(SKILLS_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const file = path.join(SKILLS_DIR, entry.name, 'SKILL.md');
    if (!fs.existsSync(file)) continue;
    out.push({ path: rel(file), text: readText(file) });
  }
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

/* ------------------------------ 知识库 ------------------------------ */
function pickField(text, names) {
  for (const name of names) {
    // 允许字段名与冒号之间出现少量标记字符，例如 **发布机构**：xxx 或 公开获取方式(URL)：xxx
    const re = new RegExp('(?:^|\\n)[^\\n]*?' + name + '[^\\n]{0,10}?[:：][^\\S\\n]*([^\\n]+)');
    const m = text.match(re);
    if (m) return m[1].trim().replace(/^[*_`\s]+|[*_`\s]+$/g, '');
  }
  return '';
}

function collectKb() {
  if (!fs.existsSync(KB_DIR)) return [];
  const files = fs.readdirSync(KB_DIR)
    .filter((f) => f.toLowerCase().endsWith('.md'))
    // 来源清单是索引文件，不作为可检索文档进入知识库
    .filter((f) => !/^sources\.md$/i.test(f))
    .sort();
  const docs = [];
  for (const f of files) {
    const abs = path.join(KB_DIR, f);
    const text = readText(abs);
    const id = f.replace(/\.md$/i, '');
    const isSources = /^sources$/i.test(id);
    const heading = (text.match(/^#\s+(.+)$/m) || [])[1] || id;
    const urlMatch = text.match(/https?:\/\/[^\s)>\]]+/);
    docs.push({
      id,
      file: rel(abs),
      title: pickField(text, ['文件名称', '名称', '标题']) || heading.replace(/^#\s*/, ''),
      publisher: pickField(text, ['发布机构', '发布单位', '制定机关', '机构']),
      url: pickField(text, ['公开获取方式', '获取方式', '来源链接', '来源']) || (urlMatch ? urlMatch[0] : ''),
      retrievedAt: pickField(text, ['本次检索日期', '检索日期', '日期']) || '2026-09-23',
      category: isSources ? 'source-index' : (pickField(text, ['类型', '文档类型']) || '预案与规范'),
      body: text
    });
  }
  return docs;
}

/* ------------------------------ 写出 ------------------------------ */
function writeBundle(target, globalName, payload, comment) {
  const js = `/*!\n * ${comment}\n *\n * 本文件由 scripts/build-bundles.mjs 自动生成，请勿手工修改。\n * 重新生成：node scripts/build-bundles.mjs\n */\n(function (FA) {\n  'use strict';\n  FA.${globalName} = ${JSON.stringify(payload, null, 2)};\n})(window.FA = window.FA || {});\n`;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, js, 'utf8');
  return Buffer.byteLength(js, 'utf8');
}

const skills = collectSkills();
const kb = collectKb();

const sizeSkills = writeBundle(OUT_SKILLS, 'skillSources', skills,
  `城市韧性守护 Agent · 技能包（${skills.length} 个 SKILL.md 内联，遵循 Anthropic Agent Skills 规范）`);
const sizeKb = writeBundle(OUT_KB, 'kbDocs', kb,
  `城市韧性守护 Agent · 知识库（${kb.length} 份公开文件摘要内联，供离线关键词检索）`);

/* ------------------------------ 校验与报告 ------------------------------ */
const problems = [];
if (!skills.length) problems.push('没有找到任何 SKILL.md（应位于 agent/src/skills/<name>/SKILL.md）');
if (!kb.length) problems.push('没有找到任何知识库 Markdown（应位于 agent/assets/kb/*.md）');

for (const s of skills) {
  const fm = s.text.match(/^---\s*\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) { problems.push(`${s.path}: 缺少 YAML frontmatter`); continue; }
  if (!/^name\s*:/m.test(fm[1])) problems.push(`${s.path}: frontmatter 缺少 name`);
  if (!/^description\s*:/m.test(fm[1])) problems.push(`${s.path}: frontmatter 缺少 description`);
}

for (const d of kb) {
  if (/^sources$/i.test(d.id)) continue;
  if (!d.url) problems.push(`${d.file}: 未解析到公开获取链接`);
  if (!d.publisher) problems.push(`${d.file}: 未解析到发布机构`);
}

console.log(`技能内联：${skills.length} 个 → ${rel(OUT_SKILLS)} (${(sizeSkills / 1024).toFixed(1)} KB)`);
skills.forEach((s) => console.log(`  - ${s.path} (${s.text.split(/\r?\n/).length} 行)`));
console.log(`知识库内联：${kb.length} 份 → ${rel(OUT_KB)} (${(sizeKb / 1024).toFixed(1)} KB)`);
kb.forEach((d) => console.log(`  - ${d.id}: ${d.title} | ${d.publisher || '（未解析机构）'} | ${d.url || '（未解析链接）'}`));

if (problems.length) {
  console.log('\n需要处理的问题：');
  problems.forEach((p) => console.log(`  ! ${p}`));
  process.exitCode = 1;
} else {
  console.log('\n校验通过：技能 frontmatter 完整，知识库均带机构与公开链接。');
}
