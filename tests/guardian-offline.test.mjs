import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
const script=await readFile(new URL('../dist/guardian-offline-sw.js',import.meta.url),'utf8');
function harness(failure=''){
  const handlers={},entries=new Map(),requests=[],messages=[],actions=[];
  const root='https://example.test/jiaoying-ai/';
  const cache={match:async key=>entries.get(key)?.clone(),put:async(key,value)=>entries.set(key,value.clone())};
  const files=['index.html','guardian/agent/embed.html','guardian/mount.js'];
  const env={URL,Response,Promise,Error,Array,Object,console,caches:{open:async()=>cache,keys:async()=>[],delete:async()=>true},fetch:async request=>{const url=typeof request==='string'?request:request.url;requests.push(url);if(url.endsWith(failure)&&failure)throw Error('unavailable');return new Response(url.endsWith('guardian-cache-manifest.json')?JSON.stringify({build:'test',files}):'asset:'+url);},self:{location:{href:root+'guardian-offline-sw.js'},clients:{claim:async()=>actions.push('claim'),matchAll:async()=>[{postMessage:x=>messages.push(x)}]},skipWaiting:async()=>actions.push('skip'),addEventListener:(name,fn)=>handlers[name]=fn}};
  vm.runInNewContext(script,env);
  return {root,handlers,entries,requests,messages,actions,env,async run(type,extra={}){let wait;handlers[type]({...extra,waitUntil:p=>wait=p});await wait;},async request(path,method='GET'){let response;handlers.fetch({request:{url:root+path,method},respondWith:p=>response=p});return response?await response:undefined;}};
}
test('offline installation reports ready only after every file exists and serves query URLs after the network disappears',async()=>{
  const h=harness();await h.run('install');await h.run('activate');assert.deepEqual(h.actions,['skip','claim']);assert.ok(h.messages.some(x=>x.ready));
  h.env.fetch=async()=>{throw Error('offline');};
  assert.match(await (await h.request('?v=3.7')).text(),/index.html/);
  assert.match(await (await h.request('guardian/mount.js?v=1')).text(),/mount.js/);
  assert.match(await (await h.request('guardian/agent/embed.html?embed=1')).text(),/embed.html/);
});
test('partial download cannot activate a falsely complete offline cache',async()=>{
  const h=harness('embed.html');await assert.rejects(h.run('install'),/unavailable/);assert.deepEqual(h.actions,[]);await h.run('message',{data:{type:'GUARDIAN_CACHE_STATUS'},source:{postMessage:x=>h.messages.push(x)}});assert.equal(h.messages.at(-1).ready,false);
});
test('model requests, state APIs, and unrelated origins never go into offline cache',async()=>{
  const h=harness();await h.run('install');const count=h.entries.size;
  assert.equal(await h.request('api/v3/state'),undefined);assert.equal(await h.request('api/v3/agent/chat','POST'),undefined);
  let captured=false;h.handlers.fetch({request:{url:'https://api.deepseek.com/chat/completions',method:'POST'},respondWith:()=>captured=true});assert.equal(captured,false);assert.equal(h.entries.size,count);
});
