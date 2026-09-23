import {readFile, writeFile, mkdir, cp, readdir} from 'node:fs/promises';
import {resolve, dirname, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {integrationStatus, agentContract} from '../integrations.mjs';

// Publish a separate browser build. Never copy running server snapshots or credentials.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const output=resolve(root,'tmp/pages-release');
const read=path=>readFile(resolve(root,path),'utf8');
const write=(path,data)=>writeFile(resolve(output,path),data,'utf8');
const included=['.nojekyll','index.html','engine.js','voice-input.js','real-map.js','real-map.css','workspace-app.js','workspace.css','command-theme.css','interface-motion.js','interface-motion.css','field-assistant.js','field-workspace.js','field-workspace.css','village-assistant.js','village-workspace.js','village-workspace.css','pages-runtime.js'];

export async function buildPages(){
  await mkdir(output,{recursive:true});
  for(const name of included)await cp(resolve(root,'dist',name),resolve(output,name));
  for(const name of ['assets','vendor'])await cp(resolve(root,'dist',name),resolve(output,name),{recursive:true});
  const modules=['village-ledger.cjs','dispatch-large.cjs','exercise.cjs'];
  let bundle="/* Generated from the same audited exercise modules as the local server. */\n(()=>{'use strict';const factories=Object.create(null),cache={'./dist/engine.js':{exports:window.JiaoyingEngine}};\n";
  for(const name of modules)bundle+=`factories[${JSON.stringify('./'+name)}]=function(module,exports,require){\n${await read(name)}\n};\n`;
  bundle+="function require(id){if(cache[id])return cache[id].exports;if(!factories[id])throw new Error('Unavailable browser module: '+id);const m={exports:{}};cache[id]=m;factories[id](m,m.exports,require);return m.exports;}window.JiaoyingExercise=require('./exercise.cjs');\n";
  bundle+=`window.JiaoyingPagesIntegrations=${JSON.stringify({integrationStatus,agentContract})};})();\n`;
  await write('exercise-browser.js',bundle);
  let index=await read('dist/index.html');
  index=index.replace('<script defer src="engine.js"></script>','<script defer src="engine.js"></script><script defer src="exercise-browser.js"></script><script defer src="pages-runtime.js"></script>')
    .replace('本地演练 <b>V3.4</b>','在线分享 <b>V3.4.1</b>')
    .replace('href="start.html">入口与清单','href="start.html">分享入口与清单');
  await write('index.html',index);
  let start=await read('dist/start.html');
  start=start.replace('本地网页 · V3.4','在线分享 · V3.4.1')
    .replace('使用下方入口打开新版；<b>当前服务地址为 8767，旧 8765 地址已停用。</b>','<b>打开链接即可体验，无需安装或启动本机服务。</b>同一浏览器内打开两个角色网页，即可演示现场上报与指挥台联动。')
    .replaceAll('http://127.0.0.1:8767/#','./#')
    .replace(/<div class="service" id="service"[\s\S]*?<div class="scope">/, '<div class="service"><div><strong>GitHub Pages 浏览器演练版</strong><p>每位访客拥有自己的模拟演练；同一浏览器、同一站点的两个标签页共享记录。不同设备、浏览器或隐私窗口不共享数据。</p><p>记录保存在当前浏览器中，清理网站数据会丢失。只填写演练信息，重要结果请导出 JSON。麦克风识别可能使用浏览器在线服务。</p></div></div><div class="scope">')
    .replace('“已完成”指当前本地演练范围内可操作；“部分完成”明确列出缺口。真正的 Agent、彩云实况与公网按此前约定暂缓接入。','下表保留 2026-09-23 本地 V3.4 的核对基准，标记不代表真实业务部署。<b>本次新增公开分享、浏览器保存与同浏览器双页联动；服务器自动保存与跨设备同步仍未完成。</b>真正的 Agent、彩云实况仍按此前约定暂缓接入。')
    .replace('核对日期：2026-09-23 · 基于逐字稿、会后确认及当前源码','本地版核对基准：2026-09-23 · 发布差异见上方说明')
    .replace('原8765入口无响应；现有8767的V3.4服务已读取核验。本轮增加统一入口，保留指挥台、现场端和需求清单网页。','本地版已修复入口；本次新增可直接分享的 GitHub Pages 网页，演练在访客浏览器内运行。')
    .replace('仍依赖本机服务；尚无数据库自动保存、网页导入或跨设备部署。','公开版增加浏览器保存，但尚无服务器备份、网页导入或跨设备共享。')
    .replace(/<details class="help" id="opening-help">[\s\S]*?<\/details>/,`<details class="help" id="opening-help"><summary>如何体验、保存和重新开始</summary><ol><li>点击“指挥工作台”和“现场反馈端”，让两个网页在同一个浏览器中同时打开。现场提交并确认后，返回指挥台查看待核实上报。</li><li>这是浏览器中的模拟演练，不依赖发布者的电脑开机。所有人员、村庄、资源和调度路网均为演示数据；瑞安底图来自公开地理快照。</li><li>同浏览器两个网页会联动；你与其他人的电脑、手机并不共享一场演练。不要把它作为真实应急指挥系统。</li><li>演练自动保存在此浏览器；浏览器清理、隐私窗口关闭或存储策略可能清除数据。重要记录可在“接口与范围”导出 JSON。</li><li>如需重新演示，在“接口与范围”选择“重置这场演练”并确认；仅影响你当前浏览器内的演练。</li><li>如浏览器阻止存储或加载失败，使用普通浏览窗口重试。语音不可用时可直接输入文字；尚未连接 DeepSeek 或彩云实况。</li></ol></details>`)
    .replace('本机访问；同机两个网页已联动，尚未开放手机到电脑的跨设备连接。','在线访问 · 同浏览器双页联动 · 跨设备数据共享尚未提供 · 无需登录')
    .replace(/const isLocalPage=[\s\S]*?check\(\);\}\)\(\);/,'document.querySelectorAll("[data-workspace]").forEach(a=>a.href="./#"+a.dataset.workspace);})();');
  await write('start.html',start);
  // Retain an explicit version marker for deployed-byte verification.
  await write('release.json',JSON.stringify({version:'3.4.1-pages',mode:'browser-exercise',scope:'same-browser-tabs',modelConnected:false,weatherConnected:false},null,2));
  await write('README.md','# 叫应 AI · 在线演练\n\n打开 start.html 查看入口和功能对照。GitHub Pages 只托管静态文件，状态与计算在访客浏览器中完成。同浏览器两个标签页共享演练，不同设备不共享。数据为合成演练，不用于真实应急指挥。\n\n公开底图来源与许可见 assets/maps/SOURCES.md；Leaflet 许可见 vendor/leaflet/LICENSE。\n');
  // Manifest is the publication allowlist, so stale files in tmp are never uploaded.
  const files=[];
  async function list(folder){for(const e of await readdir(resolve(output,folder),{withFileTypes:true})){const path=folder?folder+'/'+e.name:e.name;if(e.isDirectory())await list(path);else files.push(path);}}
  for(const name of included)files.push(name);
  for(const name of ['assets','vendor'])await list(name);
  files.push('exercise-browser.js','start.html','release.json','README.md');
  await writeFile(resolve(root,'tmp/pages-manifest.json'),JSON.stringify({directory:relative(root,output).split(sep).join('/'),files:[...new Set(files)].sort()},null,2));
  return {directory:output,files:[...new Set(files)].length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildPages()));
