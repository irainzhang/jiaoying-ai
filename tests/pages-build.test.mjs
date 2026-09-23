import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile,access} from 'node:fs/promises';
import {resolve} from 'node:path';
import {buildPages,output} from '../scripts/build-pages.mjs';
await buildPages();
const read=name=>readFile(resolve(output,name),'utf8');

test('published build loads the real solver and supports its dynamic large-dispatch module',async()=>{
  const context=vm.createContext({window:{},console});
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
  assert.ok(index.indexOf('exercise-browser.js')<index.indexOf('pages-runtime.js'));
  assert.ok(index.indexOf('pages-runtime.js')<index.indexOf('workspace-app.js'));
  const start=await read('start.html');
  assert.match(start,/不同设备、浏览器或隐私窗口不共享数据/);
  assert.match(start,/capabilities.js/);
  const catalog=await read('capabilities.js');assert.equal((catalog.match(/id:'O\d+'/g)||[]).length,18);
});

test('publication allowlist excludes local snapshots, credentials, transcripts and unused legacy app',async()=>{
  const manifest=JSON.parse(await readFile(new URL('../tmp/pages-manifest.json',import.meta.url),'utf8'));
  assert.ok(manifest.files.includes('assets/maps/SOURCES.md'));
  assert.ok(manifest.files.includes('vendor/leaflet/LICENSE'));
  assert.ok(manifest.files.includes('pages-runtime.js'));
  for(const path of manifest.files)assert.doesNotMatch(path,/(?:^|\/)(?:\.env|tmp|\.git|node_modules)|before-v3|\.docx$|\.pdf$|legacy\.html$|meeting-status\.json$/);
  for(const path of manifest.files.filter(p=>p.endsWith('.js')))new vm.Script(await read(path),{filename:path});
});
