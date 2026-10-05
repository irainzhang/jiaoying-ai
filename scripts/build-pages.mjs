import {readFile, writeFile, mkdir, cp, readdir} from 'node:fs/promises';
import {resolve, dirname, relative, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {integrationStatus, agentContract} from '../integrations.mjs';
import {createRequire} from 'node:module';
import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),capabilities=require('../dist/capabilities.js');

// Publish a separate browser build. Never copy running server snapshots or credentials.
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export const output=resolve(root,'tmp/pages-release');
const read=path=>readFile(resolve(root,path),'utf8');
const included=['place-directory.js','place-picker.js','place-picker.css','task-workbench.js','version-update.js','update.html','.nojekyll','index.html','engine.js','voice-input.js','transport-map.js','real-map.js','real-map.css','command-flow.css','weather-panel.js','weather-panel.css','review-form.js','review-form.css','workflow-ui.js','workflow-ui.css','workspace-app.js','workspace.css','command-theme.css','interface-motion.js','interface-motion.css','field-assistant.js','field-workspace.js','field-workspace.css','village-assistant.js','command-intake.js','intake-file.js','quick-context.js','intake-ui.js','village-workspace.js','village-workspace.css','pages-runtime.js','capabilities.js','evidence-library.js','operations-ui.js','operations-ui.css','start-page.js','start-page.css'];

export async function buildPages({outputDirectory=output,manifestPath=resolve(root,'tmp/pages-manifest.json')}={}){
  const buildOutput=resolve(outputDirectory);
  const write=(path,data)=>writeFile(resolve(buildOutput,path),data,'utf8');
  await mkdir(buildOutput,{recursive:true});
  for(const name of included)await cp(resolve(root,'dist',name),resolve(buildOutput,name));
  // Build the allowlist from current source, not an output tree left by an older run.
  const staticFiles=[];
  async function copyStatic(folder){for(const entry of await readdir(resolve(root,'dist',folder),{withFileTypes:true})){
    const path=folder+'/'+entry.name;
    if(entry.isSymbolicLink())throw new Error('Static publication does not allow symbolic links: '+path);
    if(entry.isDirectory())await copyStatic(path);
    else if(entry.isFile()){await mkdir(dirname(resolve(buildOutput,path)),{recursive:true});await cp(resolve(root,'dist',path),resolve(buildOutput,path));staticFiles.push(path);}
    else throw new Error('Unexpected static asset: '+path);
  }}
  for(const name of ['assets','vendor'])await copyStatic(name);
  // Enumerate current guardian source, never stale output files or test artifacts.
  const guardianFiles=[];
  async function copyGuardian(folder){for(const entry of await readdir(resolve(root,'dist',folder),{withFileTypes:true})){
    const path=folder+'/'+entry.name;
    if(entry.isSymbolicLink())throw new Error('Guardian publication does not allow symbolic links: '+path);
    if(entry.isDirectory())await copyGuardian(path);
    else if(/\.(?:js|css|html|md|json|svg|png)$/.test(entry.name)&&!entry.name.startsWith('.')){await mkdir(dirname(resolve(buildOutput,path)),{recursive:true});await cp(resolve(root,'dist',path),resolve(buildOutput,path));guardianFiles.push(path);}
    else throw new Error('Unexpected guardian asset: '+path);
  }}
  await copyGuardian('guardian');
  const modules=['ruian-directory.cjs','intake-location.cjs','village-ledger.cjs','dispatch-large.cjs','resilience.cjs','geo-scenario.cjs','lifecycle.cjs','exercise.cjs'];
  let bundle="/* Generated from the same audited exercise modules as the local server. */\n(()=>{'use strict';const factories=Object.create(null),cache={'./dist/engine.js':{exports:window.JiaoyingEngine}};\n";
  for(const name of modules)bundle+=`factories[${JSON.stringify('./'+name)}]=function(module,exports,require){\n${await read(name)}\n};\n`;
  bundle+=`cache['./dist/assets/maps/ruian-routing.json']={exports:${await read('dist/assets/maps/ruian-routing.json')}};\n`;
  bundle+=`cache['./dist/assets/maps/ruian-places.json']={exports:${await read('dist/assets/maps/ruian-places.json')}};\n`;
  bundle+="function require(id){if(cache[id])return cache[id].exports;if(!factories[id])throw new Error('Unavailable browser module: '+id);const m={exports:{}};cache[id]=m;factories[id](m,m.exports,require);return m.exports;}window.JiaoyingExercise=require('./exercise.cjs');\n";
  bundle+=`window.JiaoyingPagesIntegrations=${JSON.stringify({integrationStatus,agentContract})};})();\n`;
  await write('exercise-browser.js',bundle);
  let index=await read('dist/index.html');
  index=index.replace('<script defer src="engine.js"></script>','<script defer src="engine.js"></script><script defer src="exercise-browser.js"></script><script defer src="pages-runtime.js"></script>')
    .replace(/本地演练 <b>V\d+\.\d+(?:\.\d+)?<\/b>/,`在线分享 <b>V${capabilities.version}</b>`)
    .replace('href="start.html">入口与清单','href="start.html">分享入口与清单');
  await write('index.html',index);
  const start=await read('dist/start.html');
  await write('start.html',start);
  // Retain an explicit version marker for deployed-byte verification.
  await write('release.json',JSON.stringify({version:capabilities.version+'-pages',mode:'browser-exercise',scope:'same-browser-tabs',modelConnected:false,agentConnected:false,weatherConnected:false},null,2));
  await write('README.md','# 叫应 AI · 在线演练\n\n打开 start.html 查看入口和功能对照。GitHub Pages 只托管静态文件，状态与计算在访客浏览器中完成。同浏览器两个标签页共享演练，不同设备不共享。数据为合成演练，不用于真实应急指挥。\n\n公开底图来源与许可见 assets/maps/SOURCES.md；Leaflet 许可见 vendor/leaflet/LICENSE。\n');
  // Manifest is the publication allowlist, so stale files in tmp are never uploaded.
  const files=[];
  for(const name of included)files.push(name);
  files.push(...staticFiles);
  files.push('exercise-browser.js','start.html','release.json','README.md');
  files.push(...guardianFiles);
  const cached=[...new Set(files)].filter(path=>!['.nojekyll','README.md'].includes(path)).sort();
  const digest=createHash('sha256');for(const path of cached){digest.update(path);digest.update(await readFile(resolve(buildOutput,path)));}
  digest.update(await read('dist/guardian-offline-sw.js'));
  const guardianBuild=digest.digest('hex').slice(0,20);
  await write('guardian-cache-manifest.json',JSON.stringify({build:guardianBuild,version:capabilities.version,files:cached},null,2));
  await write('guardian-offline-sw.js',(await read('dist/guardian-offline-sw.js')).replace('__GUARDIAN_BUILD__',guardianBuild));
  files.push('guardian-cache-manifest.json','guardian-offline-sw.js');
  await writeFile(manifestPath,JSON.stringify({directory:relative(root,buildOutput).split(sep).join('/'),files:[...new Set(files)].sort()},null,2));
  return {directory:buildOutput,files:[...new Set(files)].length};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url))console.log(JSON.stringify(await buildPages()));
