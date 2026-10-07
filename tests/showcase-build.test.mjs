import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve,dirname} from 'node:path';
import {buildPages,output} from '../scripts/build-pages.mjs';

test('showcase is a self-contained public build with independent cache and curated presentation',async t=>{
  const parent=resolve(output,'..'),folder=await mkdtemp(resolve(parent,'showcase-build-test-'));
  t.after(async()=>{assert.equal(dirname(folder),parent);await rm(folder,{recursive:true,force:true});});
  const built=resolve(folder,'release'),manifestPath=resolve(folder,'manifest.json');
  await buildPages({outputDirectory:built,manifestPath});
  const read=path=>readFile(resolve(built,path),'utf8');
  const publication=JSON.parse(await readFile(manifestPath,'utf8'));
  const base=JSON.parse(await read('guardian-cache-manifest.json')),showcase=JSON.parse(await read('showcase/guardian-cache-manifest.json'));
  assert.equal(base.files.some(x=>x.startsWith('showcase/')),false,'parent worker must not own child assets');
  assert.equal(showcase.channel,'showcase');assert.notEqual(showcase.build,base.build);
  for(const path of showcase.files){assert.ok(publication.files.includes('showcase/'+path),path);assert.doesNotMatch(path,/^\.\.\//);await readFile(resolve(built,'showcase',path));}
  const worker=await read('showcase/guardian-offline-sw.js');assert.match(worker,/PREFIX='jiaoying-showcase-'/);assert.doesNotMatch(worker,/jiaoying-guardian-/);
  const home=await read('showcase/start.html');assert.doesNotMatch(home,/优化清单|会议|修改过程|初稿|PPT|node lan-server|\.\.\//);
  for(const href of ['./#command','./#field','update.html','assets/demo-resources/01-staff.xlsx','assets/demo-resources/02-vehicles.xlsx','assets/demo-resources/03-shelters.xlsx'])assert.ok(home.includes(href));
  const context={window:{}};vm.runInNewContext(await read('showcase/capabilities.js'),context);const catalog=context.window.JiaoyingCapabilities;
  assert.equal(catalog.channel,'showcase');assert.equal(catalog.entries.length,5);assert.equal(catalog.modelConnected,false);
  assert.doesNotMatch(JSON.stringify(catalog),/O16|会议|初稿|优化清单/);
  for(const name of ['engine.js','exercise-browser.js','pages-runtime.js','workspace-app.js','resource-intake.js'])assert.equal(await read('showcase/'+name),await read(name),'business source must not diverge: '+name);
  const workspace=await read('showcase/index.html');assert.match(workspace,/作品首页/);assert.match(workspace,/参赛展示/);assert.doesNotMatch(workspace,/分享入口与清单/);
  for(const path of ['index.html','start.html'])for(const [,asset] of (await read('showcase/'+path)).matchAll(/(?:src|href)="([^"#]+\.(?:js|css|png))(?:\?[^"#]*)?"/g))await readFile(resolve(built,'showcase',asset));
  for(const path of ['guardian/mount.js','version-update.js','update.html'])assert.match(await read('showcase/'+path),/existing\.scope !== (scope|root\.href)/,'inherited parent registration must not block child: '+path);
});

test('same-origin base and showcase runtime use separate database and notification names',async()=>{
  const {createRequire}=await import('node:module'),require=createRequire(import.meta.url);
  const {createRuntime}=require('../dist/pages-runtime.js'),Exercise=require('../exercise.cjs');
  const databases=[],channels=[];
  for(const path of ['/jiaoying-ai/','/jiaoying-ai/showcase/']){
    const env={location:{href:'https://example.test'+path},Response,Headers,crypto:globalThis.crypto,
      indexedDB:{open(name){databases.push(name);throw Error('storage name probe');}},
      BroadcastChannel:class{constructor(name){channels.push(name);}close(){}},addEventListener(){},removeEventListener(){}};
    const runtime=createRuntime({Exercise,environment:env});const response=await runtime.fetch('/api/v3/state');assert.equal(response.status,503);await runtime.close();
  }
  assert.notEqual(databases[0],databases[1]);assert.deepEqual(databases,channels);
  assert.match(databases[1],/:\/jiaoying-ai\/showcase\/$/);
  const workspace=await readFile(new URL('../dist/workspace-app.js',import.meta.url),'utf8');assert.match(workspace,/jiaoying-draft-v35:'\+location\.pathname\+':'+/);
});
