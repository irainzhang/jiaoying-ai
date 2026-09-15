const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {create}=require('../dist/state.js');
const C=require('../dist/assistant-core.js');
function harness(fetch,hostname='127.0.0.1'){
  const handlers={},window={JiaoyingAssistantCore:C};
  const document={addEventListener:(name,fn)=>handlers[name]=fn,getElementById:()=>null};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/assistant.js'),'utf8'),{window,document,location:{hash:'#assistant',protocol:'http:',hostname},fetch,AbortSignal,AbortController,setTimeout,clearTimeout,queueMicrotask:()=>{},requestAnimationFrame:fn=>fn()});
  const assistant=window.JiaoyingAssistant.create({store:create(),render:()=>{},notify:()=>{}});
  return {assistant,input:value=>handlers.input({target:{id:'chat-input',value}}),click:ai=>handlers.click({target:{closest:()=>({dataset:{ai}})}})};
}
test('late status response cannot override a user switch to local guide',async()=>{
  let count=0,release;
  const h=harness(async()=>{if(++count===1)return Response.json({configured:true,model:'test'});return new Promise(resolve=>release=()=>resolve(Response.json({configured:true,model:'test'})));});
  await h.assistant.check();assert.equal(h.assistant.serialize().modelConfigured,true);
  const pending=h.assistant.check();await h.click('local');release();await pending;
  assert.equal(h.assistant.serialize().modelConfigured,false);
});
test('reset discards a late model reply even if upstream ignores cancellation',async()=>{
  let release;
  const h=harness(async url=>url.endsWith('/status')?Response.json({configured:true,model:'test'}):new Promise(resolve=>release=()=>resolve(Response.json({reply:'旧演练的迟到回复'}))));
  await h.assistant.check();h.input('总结当前情况');const sending=h.click('send');
  h.assistant.reset();release();await sending;assert.equal(h.assistant.serialize().messages.length,0);
});
test('GitHub Pages does not probe an unavailable model backend',async()=>{
  const h=harness(async()=>assert.fail('static site must not request a model endpoint'),'irainzhang.github.io');
  await h.assistant.check();h.input('总结当前情况');await h.click('send');
  const result=h.assistant.serialize();assert.equal(result.modelConfigured,false);
  assert.equal(result.messages.at(-1).mode,'local');assert.match(result.messages.at(-1).text,/6 户 15 人/);
});
