import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,access,mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {buildPages,output} from '../scripts/build-pages.mjs';
await buildPages();
const read=name=>readFile(resolve(output,name),'utf8');

test('stale assets and vendor output files never enter the publication or offline manifests',async t=>{
  const tempRoot=resolve(output,'..');
  const folder=await mkdtemp(resolve(tempRoot,'guardian-publish-test-'));
  // Only this fresh, isolated test directory can be removed; never the shared preview.
  t.after(async()=>{assert.equal(dirname(folder),tempRoot);await rm(folder,{recursive:true,force:true});});
  const isolated=resolve(folder,'release'),manifestPath=resolve(folder,'manifest.json');
  const stale=['assets/removed-private-draft.json','vendor/unused/old-debug.js'];
  for(const path of stale){await mkdir(dirname(resolve(isolated,path)),{recursive:true});await writeFile(resolve(isolated,path),'stale test fixture');}
  await buildPages({outputDirectory:isolated,manifestPath});
  const manifest=JSON.parse(await readFile(manifestPath,'utf8'));
  const offline=JSON.parse(await readFile(resolve(isolated,'guardian-cache-manifest.json'),'utf8'));
  for(const path of stale){
    assert.equal(manifest.files.includes(path),false,path+' must not be published');
    assert.equal(offline.files.includes(path),false,path+' must not be cached');
    assert.equal(await readFile(resolve(isolated,path),'utf8'),'stale test fixture','build excludes old output without deleting it');
  }
  for(const path of ['assets/logo-mark.png','assets/maps/SOURCES.md','vendor/leaflet/leaflet.js','vendor/leaflet/LICENSE']){
    assert.ok(manifest.files.includes(path),path+' remains in the current source allowlist');
    assert.deepEqual(await readFile(resolve(isolated,path)),await readFile(new URL('../dist/'+path,import.meta.url)));
  }
});

test('published build loads the real solver and supports its dynamic large-dispatch module',async()=>{
  const context=vm.createContext({window:{},console,TextEncoder});
  vm.runInContext(await read('engine.js'),context);
  // UMD engine attaches to globalThis in a browser (window === globalThis).
  context.window.JiaoyingEngine=context.JiaoyingEngine;
  vm.runInContext(await read('exercise-browser.js'),context);
  const engine=context.window.JiaoyingExercise,x=engine.create();
  x.action('generate');
  assert.equal(engine.metrics(x.data).people,15);
  assert.ok(x.data.plan.routes.length>0);
  assert.ok(x.data.baseline);
  x.action('confirm');
  assert.equal(x.data.activePlan.id,x.data.plan.id);
  x.action('end-task',{mode:'stopped'});
  x.action('new-task');
  const restored=engine.create(x.data);
  assert.equal(restored.data.taskArchives.length,1);
  assert.equal(restored.data.taskArchives[0].data.taskLifecycle.status,'stopped');
  assert.equal(restored.data.taskLifecycle.status,'active');
  assert.equal(context.window.JiaoyingPagesIntegrations.integrationStatus.agent.connected,false);
});

test('public pages retain repo-relative links and every referenced script and stylesheet exists',async()=>{
  for(const name of ['index.html','start.html']){
    const html=await read(name);
    assert.doesNotMatch(html,/href="\/(?!\/)/);
    assert.doesNotMatch(html,/127\.0\.0\.1|8767|启动V3\.4演示\.cmd/);
    for(const [,path] of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png))"/g))await access(resolve(output,path));
    for(const [,script] of html.matchAll(/<script>([\s\S]*?)<\/script>/g))new vm.Script(script);
  }
  const index=await read('index.html');
  assert.equal((index.match(/guardian\/mount\.js\?v=1/g)||[]).length,1);
  assert.ok(index.indexOf('workspace-app.js')<index.indexOf('guardian/mount.js'));
  assert.ok(index.indexOf('exercise-browser.js')<index.indexOf('pages-runtime.js'));
  assert.ok(index.indexOf('pages-runtime.js')<index.indexOf('workspace-app.js'));
  const start=await read('start.html');
  assert.match(start,/公开版各设备的数据独立/);
  assert.match(start,/同 Wi-Fi/);
  assert.match(start,/capabilities.js/);
  const catalog=await read('capabilities.js');assert.equal((catalog.match(/id:'O\d+'/g)||[]).length,18);
});

test('guardian and the host shell are fully listed for offline installation without backend or secrets',async()=>{
  const manifest=JSON.parse(await read('guardian-cache-manifest.json'));
  assert.ok(manifest.files.includes('index.html'));
  for(const path of ['guardian/mount.js','guardian/bridge/flood-agent-bridge.js','guardian/agent/embed.html','guardian/agent/api-config.js','guardian/agent/assets/kb-bundle.js','guardian/agent/assets/skills-bundle.js'])assert.ok(manifest.files.includes(path),path);
  for(const path of manifest.files){assert.doesNotMatch(path,/^(?:https?:|\/)|(?:^|\/)(?:api|tests|tmp|\.env)(?:\/|$)/);await access(resolve(output,path));}
  for(const name of ['index.html','embed.html']){
    const html=await read('guardian/agent/'+name);assert.doesNotMatch(html,/<script[^>]+type=["']module/);
    assert.ok(html.indexOf('api-config.js')>html.indexOf('ruian-scenario.js'));
    assert.ok(html.indexOf('api-config.js')<html.indexOf('src/core/bus.js'));
    for(const [,asset] of html.matchAll(/(?:src|href)="([^"#]+\.(?:js|css))(?:\?[^"#]*)?"/g))assert.ok(manifest.files.includes('guardian/agent/'+asset),asset);
  }
  const worker=await read('guardian-offline-sw.js');assert.doesNotMatch(worker,/__GUARDIAN_BUILD__/);assert.ok(worker.includes(manifest.build));
});

test('publication allowlist excludes local snapshots, credentials, transcripts and unused legacy app',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../tmp/pages-manifest.json',import.meta.url),'utf8'));
  assert.ok(manifest.files.includes('assets/maps/SOURCES.md'));
  assert.ok(manifest.files.includes('vendor/leaflet/LICENSE'));
  assert.ok(manifest.files.includes('pages-runtime.js'));
  for(const path of manifest.files)assert.doesNotMatch(path,/(?:^|\/)(?:\.env|tmp|\.git|node_modules)|before-v3|\.docx$|\.pdf$|legacy\.html$|meeting-status\.json$|lan-server|room-access|同WiFi协同/);
  for(const path of manifest.files.filter(p=>p.endsWith('.js')))new vm.Script(await read(path),{filename:path});
});
