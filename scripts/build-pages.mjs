import {readFile, writeFile, mkdir, cp, readdir} from 'node:fs/promises';
import {resolve, dirname, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {integrationStatus, agentContract} from '../integrations.mjs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),capabilities=require('../dist/capabilities.js');

// Publish a separate browser build. Never copy running server snapshots or credentials.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const output=resolve(root,'tmp/pages-release');
const read=path=>readFile(resolve(root,path),'utf8');
const write=(path,data)=>writeFile(resolve(output,path),data,'utf8');
const included=['.nojekyll','index.html','engine.js','voice-input.js','real-map.js','real-map.css','workspace-app.js','workspace.css','command-theme.css','interface-motion.js','interface-motion.css','field-assistant.js','field-workspace.js','field-workspace.css','village-assistant.js','command-intake.js','intake-file.js','quick-context.js','intake-ui.js','village-workspace.js','village-workspace.css','pages-runtime.js','capabilities.js','evidence-library.js','operations-ui.js','operations-ui.css','start-page.js','start-page.css'];

export async function buildPages(){
  await mkdir(output,{recursive:true});
  for(const name of included)await cp(resolve(root,'dist',name),resolve(output,name));
  for(const name of ['assets','vendor'])await cp(resolve(root,'dist',name),resolve(output,name),{recursive:true});
  const modules=['village-ledger.cjs','dispatch-large.cjs','resilience.cjs','geo-scenario.cjs','exercise.cjs'];
  let bundle="/* Generated from the same audited exercise modules as the local server. */\n(()=>{'use strict';const factories=Object.create(null),cache={'./dist/engine.js':{exports:window.JiaoyingEngine}};\n";
  for(const name of modules)bundle+=`factories[${JSON.stringify('./'+name)}]=function(module,exports,require){\n${await read(name)}\n};\n`;
  bundle+=`cache['./dist/assets/maps/ruian-routing.json']={exports:${await read('dist/assets/maps/ruian-routing.json')}};\n`;
  bundle+="function require(id){if(cache[id])return cache[id].exports;if(!factories[id])throw new Error('Unavailable browser module: '+id);const m={exports:{}};cache[id]=m;factories[id](m,m.exports,require);return m.exports;}window.JiaoyingExercise=require('./exercise.cjs');\n";
  bundle+=`window.JiaoyingPagesIntegrations=${JSON.stringify({integrationStatus,agentContract})};})();\n`;
  await write('exercise-browser.js',bundle);
  let index=await read('dist/index.html');
  index=index.replace('<script defer src="engine.js"></script>','<script defer src="engine.js"></script><script defer src="exercise-browser.js"></script><script defer src="pages-runtime.js"></script>')
    .replace('本地演练 <b>V3.7</b>',`在线分享 <b>V${capabilities.version}</b>`)
    .replace('href="start.html">入口与清单','href="start.html">分享入口与清单');
  await write('index.html',index);
  const start=await read('dist/start.html');
  await write('start.html',start);
  // Retain an explicit version marker for deployed-byte verification.
  await write('release.json',JSON.stringify({version:capabilities.version+'-pages',mode:'browser-exercise',scope:'same-browser-tabs',modelConnected:false,agentConnected:false,weatherConnected:false},null,2));
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
