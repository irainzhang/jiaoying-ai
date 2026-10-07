import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';

const script=await readFile(new URL('../dist/version-update.js',import.meta.url),'utf8');
const recoveryHTML=await readFile(new URL('../dist/update.html',import.meta.url),'utf8');
const recoveryScript=recoveryHTML.match(/<script>([\s\S]*?)<\/script>/)[1];
const build='0123456789abcdefabcd';
function events(object={}) { object.events={};object.addEventListener=(name,fn)=>(object.events[name]??=[]).push(fn);object.emit=(name,event={})=>(object.events[name]||[]).forEach(fn=>fn(event));return object; }
function harness({recovery=false,offline=false,version='3.9.1',otherWorker=false}={}) {
  function element(tag) { return events({tag,children:[],style:{},textContent:'',disabled:false,setAttribute(key,value){this[key]=value;},appendChild(child){this.children.push(child);},insertBefore(child){this.children.unshift(child);},click(){this.emit('click');}}); }
  const document=events({currentScript:{src:'https://example.test/jiaoying-ai/version-update.js'},hidden:false,createElement:element});
  document.body=element('body');document.body.appendChild(element('original-workspace'));
  document.getElementById=id=>{function find(node){if(node.id===id)return node;for(const child of node.children){const result=find(child);if(result)return result;}}return find(document.body);};
  if(recovery)for(const id of ['status','open','retry']){const el=element('button');el.id=id;document.body.appendChild(el);}
  const calls={fetch:[],register:[],update:0,reload:0,messages:[],timers:[]};let now=0;
  const worker=events({scriptURL:'https://example.test/jiaoying-ai/guardian-offline-sw.js?v=1',postMessage:message=>calls.messages.push(message)});
  const registration=events({active:worker,update:async()=>{calls.update++;}});
  const sw=events({controller:worker,getRegistration:async()=>otherWorker?{active:{scriptURL:'https://example.test/other-sw.js'}}:registration,register:async(url,options)=>{calls.register.push({url,options});return registration;}});
  const location={href:'https://example.test/jiaoying-ai/'+(recovery?'update.html':'?v=3.9#command'),protocol:'https:',reload(){calls.reload++;}};
  const window=events({JiaoyingCapabilities:{version:'3.9.0'},setInterval(fn,ms){calls.timers.push({fn,ms});}});
  const context={window,document,navigator:{serviceWorker:sw},location,URL,fetch:async(url,options)=>{calls.fetch.push({url,options});if(offline)throw new Error('offline');return {ok:true,json:async()=>({version,build,files:['index.html']})};}};
  context.Date=class extends Date { static now(){return now;} };
  Object.defineProperty(context,'localStorage',{get(){throw new Error('Update flow must not access task storage');}});
  Object.defineProperty(context,'sessionStorage',{get(){throw new Error('Update flow must not access draft storage');}});
  vm.runInNewContext(recovery?recoveryScript:script,context);
  return {document,window,location,sw,worker,registration,calls,advance(ms){now+=ms;for(const timer of calls.timers)timer.fn();},get:id=>document.getElementById(id),async settle(){for(let i=0;i<30;i++)await Promise.resolve();},message(data,source=worker){sw.emit('message',{data:{type:'GUARDIAN_CACHE_STATUS',...data},source});}};
}

test('new-version notice waits for matching complete cache controlled by the new worker; reload is explicit',async()=>{
  const h=harness();await h.settle();const banner=h.get('version-update-notice'),button=banner.children[1];
  assert.ok(banner);assert.equal(button.disabled,true);assert.equal(h.calls.reload,0);
  assert.equal(h.calls.fetch[0].url,'https://example.test/jiaoying-ai/guardian-cache-manifest.json');assert.equal(h.calls.fetch[0].options.cache,'no-store');
  h.message({ready:true,build:'previous-build',version:'3.9.1'});assert.equal(button.disabled,true);
  h.message({ready:true,build,version:'3.9.1'},events({scriptURL:h.worker.scriptURL}));assert.equal(button.disabled,true);
  h.message({ready:true,build,version:'3.9.0'});assert.equal(button.disabled,true);
  h.message({ready:true,build,version:'3.9.1'});assert.equal(button.disabled,false);assert.equal(h.calls.reload,0);
  button.click();assert.equal(h.calls.reload,1);assert.equal(h.document.body.children[1].tag,'original-workspace');
  assert.match(banner.children[0].textContent,/未提交内容请先保存/);
});
test('offline, unchanged, and older versions never interrupt the workspace',async()=>{
  for(const option of [{offline:true},{version:'3.9.0'},{version:'3.8.0'}]){
    const h=harness(option);await h.settle();assert.equal(h.get('version-update-notice'),undefined);assert.equal(h.calls.reload,0);assert.equal(h.calls.register.length,0);
  }
});

test('a visible page periodically checks publication while hidden pages and unsaved work are undisturbed',async()=>{
  const h=harness({version:'3.9.0'});await h.settle();assert.equal(h.calls.fetch.length,1);
  assert.equal(h.calls.timers[0].ms,60000);h.advance(30000);await h.settle();assert.equal(h.calls.fetch.length,1);
  h.document.hidden=true;h.advance(60000);await h.settle();assert.equal(h.calls.fetch.length,1);
  h.document.hidden=false;h.advance(60000);await h.settle();assert.equal(h.calls.fetch.length,2);assert.equal(h.calls.reload,0);
});
test('changing controller revokes readiness until it confirms the expected build',async()=>{
  const h=harness();await h.settle();const button=h.get('version-update-notice').children[1];
  h.message({ready:true,build,version:'3.9.1'});assert.equal(button.disabled,false);
  h.sw.emit('controllerchange');assert.equal(button.disabled,true);button.click();assert.equal(h.calls.reload,0);
});
test('self-contained recovery page enables navigation only for the complete intended build',async()=>{
  const h=harness({recovery:true});await h.settle();const initial=h.location.href;
  assert.equal(h.get('open').disabled,true);h.get('open').click();assert.equal(h.location.href,initial);
  h.message({ready:true,build:'old',version:'3.9.1'});assert.equal(h.get('open').disabled,true);
  h.message({ready:true,build,version:'3.9.1'});assert.equal(h.get('open').disabled,false);assert.equal(h.location.href,initial);
  h.get('open').click();assert.equal(h.location.href,'https://example.test/jiaoying-ai/?v=3.9.1#command');
  assert.doesNotMatch(recoveryHTML,/<script[^>]+src=/);
});
test('recovery failure preserves records and does not replace unrelated service workers',async()=>{
  const offline=harness({recovery:true,offline:true});await offline.settle();assert.equal(offline.get('open').disabled,true);assert.match(offline.get('status').textContent,/offline/);
  const other=harness({recovery:true,otherWorker:true});await other.settle();assert.equal(other.calls.register.length,0);assert.equal(other.get('open').disabled,true);assert.match(other.get('status').textContent,/其他离线服务/);
});

test('old controller READY never overwrites matching target download progress or enables navigation',async()=>{
  const h=harness({recovery:true});await h.settle();
  h.message({ready:true,build:'older-same-version-build',version:'3.9.1',message:'离线文件已就绪；可断网刷新。在线 API 仍需网络。'});
  assert.equal(h.get('open').disabled,true);assert.match(h.get('status').textContent,/旧网页控制/);assert.doesNotMatch(h.get('status').textContent,/已就绪/);
  const next=events({scriptURL:h.worker.scriptURL,postMessage:()=>{}});h.registration.installing=next;h.registration.emit('updatefound');
  h.message({ready:false,build,version:'3.9.1',message:'正在准备 V3.9.1 离线文件 6/104'},next);
  assert.match(h.get('status').textContent,/6\/104/);
  h.message({ready:true,build:'old',version:'3.9.1',message:'离线文件已就绪'});assert.match(h.get('status').textContent,/6\/104/);assert.equal(h.get('open').disabled,true);
  h.message({ready:true,build,version:'3.9.1',message:'下载完成'},next);assert.match(h.get('status').textContent,/等待新网页接管/);assert.equal(h.get('open').disabled,true);
  h.sw.controller=next;h.registration.active=next;h.registration.installing=null;h.sw.emit('controllerchange');
  h.message({ready:true,build,version:'3.9.1'},next);assert.equal(h.get('open').disabled,false);assert.match(h.get('status').textContent,/已完整下载/);
  h.message({ready:true,build:'old',version:'3.9.1',message:'旧缓存完成'});assert.equal(h.get('open').disabled,false);assert.match(h.get('status').textContent,/已完整下载/);
});

test('rechecking attaches to an already-installing worker and reports a failed download accurately',async()=>{
  const h=harness({recovery:true});await h.settle();
  const next=events({scriptURL:h.worker.scriptURL,state:'installing',postMessage:()=>{}});h.registration.installing=next;
  h.get('retry').click();await h.settle();assert.equal(next.events.statechange.length,1);
  next.state='redundant';next.emit('statechange');assert.match(h.get('status').textContent,/下载未完成/);assert.equal(h.get('open').disabled,true);
  h.message({ready:true,build:'old',version:'3.9.1',message:'离线文件已就绪'});assert.match(h.get('status').textContent,/下载未完成/);
});
