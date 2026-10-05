import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),X=require('../exercise.cjs');

const source = await readFile(new URL('../dist/guardian/mount.js', import.meta.url), 'utf8');
const styles = await readFile(new URL('../dist/guardian/mount.css', import.meta.url), 'utf8');
const hostSource = await readFile(new URL('../dist/guardian/host-tools.js', import.meta.url),'utf8');

// This small DOM double exercises the actual shipped integration, including its
// async failure boundary. Browser QA separately checks layout and native focus.
function harness(options = {}) {
  class Element {
    constructor(tag, doc) { this.tagName=tag.toUpperCase();this.ownerDocument=doc;this.children=[];this.attrs={};this.events={};this.style={overflow:''};this.hidden=false;this.open=false;this.textContent=''; }
    setAttribute(k,v) { this.attrs[k]=String(v);if(k==='id')this.id=String(v);if(k==='src'||k==='href')this[k]=String(v); }
    getAttribute(k) { return this.attrs[k]??null; }
    appendChild(child) {
      if(child.parentNode)child.parentNode.children=child.parentNode.children.filter(x=>x!==child);
      child.parentNode=this;this.children.push(child);
      if(this.tagName==='HEAD'&&(child.tagName==='LINK'||child.tagName==='SCRIPT'))queueMicrotask(()=>{
        if(options.failAsset===child.tagName)child.onerror?.();else child.onload?.();
      });
      return child;
    }
    append(...children){for(const child of children)this.appendChild(child);}
    replaceChildren(...children){for(const child of this.children)child.parentNode=null;this.children=[];this.append(...children);}
    insertAdjacentElement(where,child) { assert.equal(where,'afterend');child.parentNode=this.parentNode;this.parentNode.children.splice(this.parentNode.children.indexOf(this)+1,0,child); }
    remove() { if(this.parentNode)this.parentNode.children.splice(this.parentNode.children.indexOf(this),1);this.parentNode=null; }
    addEventListener(k,fn) { (this.events[k]??=[]).push(fn); }
    removeEventListener(k,fn) { this.events[k]=(this.events[k]||[]).filter(x=>x!==fn); }
    emit(k,extras={}) { const event={key:'',preventDefault(){this.defaultPrevented=true;},stopPropagation(){this.stopped=true;},...extras};for(const fn of this.events[k]||[])fn(event);return event; }
    click() { this.emit('click'); }
    showModal() { if(options.failOpen)throw new Error('blocked dialog');this.open=true; }
    close() { this.open=false;this.emit('close'); }
    focus() { this.ownerDocument.activeElement=this; }
  }
  function doc() {
    const document={events:{},activeElement:null,createElement(tag){return new Element(tag,this);},
      getElementById(id){function find(node){if(node.id===id)return node;for(const c of node.children){const match=find(c);if(match)return match;}return null;}return find(this.head)||find(this.body);},
      addEventListener(k,fn){(this.events[k]??=[]).push(fn);},removeEventListener(k,fn){this.events[k]=(this.events[k]||[]).filter(x=>x!==fn);},
      querySelector(){return this.hasModal?{}:null;},emit(k,extras){const event={preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;},...extras};for(const fn of this.events[k]||[])fn(event);return event;}};
    document.head=new Element('head',document);document.body=new Element('body',document);return document;
  }
  const document=doc(), frameDocument=doc();
  const header=document.createElement('header'), anchor=document.createElement('button'), content=document.createElement('main'), originalDialog=document.createElement('dialog');
  anchor.setAttribute('id','assistant-launcher');anchor.setAttribute('data-ac','focus-ai');anchor.textContent='AI 对话';
  content.setAttribute('id','content');content.textContent='原业务内容';originalDialog.setAttribute('id','assistant-dialog');
  document.body.appendChild(header);header.appendChild(anchor);document.body.appendChild(content);document.body.appendChild(originalDialog);
  document.currentScript={src:'https://example.test/jiaoying-ai/guardian/mount.js?v=1'};
  const calls={mount:0,destroy:0,confirm:0,registration:[],messages:[]};let mounted,api,timer=0;
  const caps={tools:Array.from({length:21},(_,i)=>'tool-'+i),skills:Array.from({length:7},(_,i)=>'skill-'+i),provider:{provider:'offline',mode:'offline'}};
  const navigator={};
  if(options.sw){
    const worker={scriptURL:'https://example.test/jiaoying-ai/guardian-offline-sw.js?v=1',postMessage(x){calls.messages.push(x);},addEventListener(){}};
    const registration={active:worker};
    navigator.serviceWorker={events:{},getRegistration:async()=>options.otherWorker?{active:{scriptURL:'https://example.test/another.js'}}:undefined,
      register:async(url,opts)=>{calls.registration.push({url,...opts});if(options.failSW)throw new Error('SW denied');return registration;},ready:Promise.resolve(registration),
      addEventListener(k,fn){(this.events[k]??=[]).push(fn);},removeEventListener(){},emit(data,messageSource=worker){for(const fn of this.events.message||[])fn({data,source:messageSource});}};
  }
  const context={document,navigator,URL,location:{href:'https://example.test/jiaoying-ai/?v=3.7#command',protocol:'https:',hostname:'example.test'},
    setTimeout(){return ++timer;},clearTimeout(){},Promise,
    FloodAgent:{mount(opts){calls.mount++;mounted=opts;if(options.failMount)throw new Error('broken bridge');const iframe=document.createElement('iframe');iframe.contentDocument=frameDocument;
      document.getElementById('guardian-agent-body').appendChild(iframe);
      api={iframe,state:{scenario:'rain-120'},getCapabilities:()=>caps,destroy(){calls.destroy++;iframe.remove();},confirm(){calls.confirm++;},
        whenReady:async()=>{if(options.failReady)throw new Error('no ready');opts.onReady({version:'3.7.0-guardian',capabilities:caps});return caps;}};
      return api;}}
  };
  context.window=context;
  const events={};context.addEventListener=(type,fn)=>(events[type]??=[]).push(fn);context.removeEventListener=(type,fn)=>events[type]=(events[type]||[]).filter(x=>x!==fn);context.emit=type=>(events[type]||[]).forEach(fn=>fn());
  if(options.host)context.JiaoyingGuardianHost=options.host;
  vm.createContext(context);if(options.host)vm.runInContext(hostSource,context);vm.runInContext(source,context);
  return {document,frameDocument,anchor,content,originalDialog,calls,navigator,context,get mounted(){return mounted;},get api(){return api;},
    get:id=>document.getElementById(id),async settle(){for(let i=0;i<15;i++)await Promise.resolve();}};
}

test('adds an isolated body dialog and adjacent entry, retaining the original AI and content',async()=>{
  const h=harness();await h.settle();
  assert.equal(h.calls.mount,1);assert.equal(h.get('guardian-agent-host').parentNode,h.document.body);
  assert.equal(h.get('guardian-launcher').parentNode.children[0],h.anchor);
  assert.equal(h.anchor.textContent,'AI 对话');assert.equal(h.anchor.getAttribute('data-ac'),'focus-ai');
  assert.equal(h.content.textContent,'原业务内容');assert.equal(h.originalDialog.open,false);
  assert.equal(h.get('guardian-launcher').hidden,false);
  assert.equal(h.get('guardian-capabilities').textContent,'21 个工具 · 7 个技能 · 独立演练');
  assert.match(h.get('guardian-provider').textContent,/离线规则引擎（API 接口已预留）/);
  assert.equal(h.mounted.agentUrl,'https://example.test/jiaoying-ai/guardian/agent/embed.html');
  assert.equal(h.get('guardian-launcher').getAttribute('data-ac'),null);
});

test('current-task mode uses actual host state, invalidates changed proposals and hands off human review',async()=>{
  const exercise=X.create();exercise.action('generate');let h,published=0;
  const snapshot=()=>({session:'test-session',data:exercise.data,metrics:X.metrics(exercise.data),taskSummary:X.taskSummary(exercise.data),villageLedger:X.villageMetrics(exercise.data)});
  const host={readState:snapshot,async calculateDraft(){exercise.action('generate');return snapshot();},openPublicationReview(){assert.equal(h.get('guardian-agent-panel').open,false);published++;}};
  h=harness({host});await h.settle();h.get('guardian-launcher').click();await h.settle();
  assert.match(h.get('guardian-capabilities').textContent,/3 个主台工具/);assert.equal(h.get('guardian-agent-body').hidden,true);assert.equal(h.get('guardian-current-task').hidden,false);
  const section=h.get('guardian-current-task'),actions=section.children.find(x=>x.className==='guardian-host-actions');
  const facts=section.children.find(x=>x.className==='guardian-host-facts');assert.equal(facts.children.length,5);assert.ok(facts.children.some(x=>x.children[0].textContent==='到达待核验'));
  const find=text=>actions.children.find(x=>x.textContent===text);
  assert.equal(find('回主台核对并发布').disabled,true);find('计算安排草案').click();await h.settle();assert.equal(find('回主台核对并发布').disabled,false);assert.equal(exercise.data.activePlan,null);
  exercise.action('weather',{rainfall:80});h.context.emit('jiaoying:state');await h.settle();assert.equal(find('回主台核对并发布').disabled,true);assert.match(section.children.find(x=>x.className==='guardian-host-status').textContent,/已同步/);
  find('计算安排草案').click();await h.settle();find('回主台核对并发布').click();await h.settle();assert.equal(published,1);assert.equal(exercise.data.activePlan,null);
  h.get('guardian-launcher').click();h.get('guardian-mode-sandbox').click();assert.equal(h.get('guardian-agent-body').hidden,false);assert.match(h.get('guardian-independence').textContent,/不是当前主台需求/);
  h.get('guardian-mode-current').click();await h.settle();assert.equal(h.get('guardian-agent-body').hidden,true);assert.match(h.get('guardian-provider').textContent,/主台本地规则/);
});

test('closing and reopening preserves the same iframe, in-memory state, and returns focus',async()=>{
  const h=harness();await h.settle();const iframe=h.api.iframe;h.document.body.style.overflow='auto';
  h.get('guardian-launcher').click();assert.equal(h.get('guardian-agent-panel').open,true);
  assert.equal(h.document.body.style.overflow,'hidden');assert.equal(h.document.activeElement,h.get('guardian-close'));
  h.api.state.scenario='rain-160';h.get('guardian-close').click();
  assert.equal(h.document.body.style.overflow,'auto');assert.equal(h.document.activeElement,h.get('guardian-launcher'));
  h.get('guardian-launcher').click();assert.equal(h.api.iframe,iframe);assert.equal(h.api.state.scenario,'rain-160');
  assert.equal(h.calls.mount,1);assert.equal(h.calls.destroy,0);assert.equal(h.calls.confirm,0);
});

test('API help is prominent, uses the single config file, and Escape first returns to the panel',async()=>{
  const h=harness();await h.settle();h.get('guardian-launcher').click();h.get('guardian-api-button').click();
  assert.equal(h.get('guardian-api-help').hidden,false);assert.equal(h.get('guardian-agent-body').hidden,true);
  assert.equal(h.document.activeElement,h.get('guardian-api-title'));
  h.get('guardian-agent-panel').emit('cancel');assert.equal(h.get('guardian-api-help').hidden,true);
  assert.equal(h.get('guardian-agent-panel').open,true);assert.equal(h.document.activeElement,h.get('guardian-api-button'));
  h.get('guardian-agent-panel').emit('cancel');assert.equal(h.get('guardian-agent-panel').open,false);
  assert.match(source,/dist\/guardian\/agent\/api-config\.js/);
  assert.match(source,/服务端转发端点尚未实现/);assert.match(source,/JIAOYING_AI_KEY/);
  assert.match(source,/本地服务的同源网页/);assert.doesNotMatch(source,/\.confirm\s*\(/);
});

test('Escape in frame does not bypass or dismiss its inner human-confirmation dialog',async()=>{
  const h=harness();await h.settle();h.get('guardian-launcher').click();h.frameDocument.hasModal=true;
  const inner=h.frameDocument.emit('keydown',{key:'Escape'});assert.equal(h.get('guardian-agent-panel').open,true);assert.equal(inner.prevented,undefined);
  h.frameDocument.hasModal=false;const outer=h.frameDocument.emit('keydown',{key:'Escape'});
  assert.equal(outer.prevented,true);assert.equal(h.get('guardian-agent-panel').open,false);assert.equal(h.calls.confirm,0);
});

for(const failure of ['failMount','failReady','failOpen'])test(failure+' cleans only integration DOM and preserves the workspace',async()=>{
  const h=harness({[failure]:true});await h.settle();if(failure==='failOpen')h.get('guardian-launcher').click();
  assert.equal(h.get('guardian-launcher'),null);assert.equal(h.get('guardian-agent-host'),null);
  assert.equal(h.content.textContent,'原业务内容');assert.equal(h.anchor.textContent,'AI 对话');assert.equal(h.originalDialog.open,false);
  assert.equal(h.document.body.style.overflow,'');
});

for(const asset of ['LINK','SCRIPT'])test(asset+' loading failure leaves the original page usable',async()=>{
  const h=harness({failAsset:asset});await h.settle();
  assert.equal(h.get('guardian-launcher'),null);assert.equal(h.calls.mount,0);assert.equal(h.content.textContent,'原业务内容');
});

test('only the actual provider returned by the agent changes the host run-path badge',async()=>{
  const h=harness();await h.settle();h.mounted.onTurn({provider:{provider:'local-gateway',mode:'online'}});
  assert.equal(h.get('guardian-provider').textContent,'运行路径：本机代理');
  h.mounted.onTurn({provider:{provider:'offline',mode:'offline'}});assert.match(h.get('guardian-provider').textContent,/离线规则引擎/);
  h.mounted.onPublished({});assert.match(h.get('guardian-independence').textContent,/没有写入叫应任务/);assert.equal(h.calls.confirm,0);
});

test('the host preserves explicit pending, fallback and mixed provenance supplied by the agent',async()=>{
  const h=harness();await h.settle();
  for(const provider of [
    {provider:'local-gateway',mode:'online',badgeLabel:'运行路径：本机代理（待首次调用）'},
    {provider:'offline',mode:'offline',badgeLabel:'运行路径：离线规则引擎（本轮在线失败回落）'},
    {provider:'local-gateway',mode:'online',badgeLabel:'运行路径：在线 + 离线回落（混合）'}
  ]){
    h.mounted.onTurn({provider});
    assert.equal(h.get('guardian-provider').textContent,provider.badgeLabel);
  }
});

test('optional worker is scoped to this repository and its status stays honest',async()=>{
  const h=harness({sw:true});await h.settle();assert.equal(h.calls.registration.length,1);
  assert.equal(h.calls.registration[0].scope,'https://example.test/jiaoying-ai/');
  assert.equal(h.calls.registration[0].url,'https://example.test/jiaoying-ai/guardian-offline-sw.js?v=1');
  assert.equal(h.calls.messages[0].type,'GUARDIAN_CACHE_STATUS');
  h.navigator.serviceWorker.emit({type:'GUARDIAN_CACHE_STATUS',ready:true});
  assert.match(h.get('guardian-offline-status').textContent,/守护面板已缓存/);assert.match(h.get('guardian-offline-status').textContent,/在线底图不在离线范围/);
});

test('cache status messages from an unrelated worker are ignored',async()=>{
  const h=harness({sw:true});await h.settle();
  const before=h.get('guardian-offline-status').textContent;
  h.navigator.serviceWorker.emit({type:'GUARDIAN_CACHE_STATUS',ready:true},{scriptURL:'https://example.test/another-worker.js'});
  assert.equal(h.get('guardian-offline-status').textContent,before);
  h.navigator.serviceWorker.emit({type:'OTHER_CACHE_STATUS',ready:true});
  assert.equal(h.get('guardian-offline-status').textContent,before);
});

test('worker failure and an unrelated existing worker never remove the usable agent entry',async()=>{
  for(const options of [{sw:true,failSW:true},{sw:true,otherWorker:true}]){
    const h=harness(options);await h.settle();assert.equal(h.get('guardian-launcher').hidden,false);
    assert.match(h.get('guardian-offline-status').textContent,/未启用|未接管/);
    if(options.otherWorker)assert.equal(h.calls.registration.length,0);
  }
});

test('scoped CSS gives the iframe the remaining height and keeps boundary text outside its scroll',()=>{
  assert.match(styles,/#guardian-agent-panel \.guardian-panel-content\{[^}]*flex:1;min-height:0;overflow:hidden/);
  assert.match(styles,/#guardian-agent-panel #guardian-boundary\{flex:none/);
  assert.match(styles,/#guardian-agent-panel #guardian-agent-body iframe\{[^}]*height:100%!important/);
  assert.match(styles,/height:100dvh/);assert.match(styles,/prefers-reduced-motion/);
});
