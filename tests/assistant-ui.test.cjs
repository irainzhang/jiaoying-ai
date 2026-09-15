const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {create}=require('../dist/state.js');
const C=require('../dist/assistant-core.js');
const Voice=require('../dist/voice-input.js');
function harness(fetch,hostname='127.0.0.1',extras={}){
  const handlers={},lifecycle={},window={JiaoyingAssistantCore:C,JiaoyingVoice:Voice,isSecureContext:true,addEventListener:(name,fn)=>lifecycle[name]=fn,...extras};let renders=0;
  const document={addEventListener:(name,fn)=>handlers[name]=fn,getElementById:()=>null};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/assistant.js'),'utf8'),{window,document,location:{hash:'#assistant',protocol:'http:',hostname},fetch,AbortSignal,AbortController,setTimeout,clearTimeout,queueMicrotask:()=>{},requestAnimationFrame:fn=>fn()});
  const assistant=window.JiaoyingAssistant.create({store:create(),render:()=>{renders++;},notify:()=>{}});
  return {assistant,renders:()=>renders,lifecycle:name=>lifecycle[name]?.({persisted:true}),input:value=>handlers.input({target:{id:'chat-input',value}}),key:()=>handlers.keydown({target:{id:'chat-input'},key:'Enter',preventDefault:()=>{}}),click:ai=>handlers.click({target:{closest:()=>({dataset:{ai,index:'0'}})}})};
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
test('voice blocks send and examples, retains the draft across renders and waits for manual send',async()=>{
  let rec;
  class Recognition{constructor(){rec=this;}start(){}stop(){}abort(){}}
  const h=harness(async()=>assert.fail('no model calls'),'irainzhang.github.io',{webkitSpeechRecognition:Recognition});
  h.input('请核实：');await h.click('voice');rec.onstart();await h.click('send');h.key();await h.click('prompt');assert.equal(h.assistant.serialize().messages.length,0);
  assert.match(h.assistant.page(),/readonly/);await h.click('voice');assert.match(h.assistant.page(),/正在整理/);
  rec.onresult({results:[Object.assign([{transcript:'南湾户需要陪同接送。'}],{isFinal:true})]});rec.onend();
  await h.assistant.check();assert.match(h.assistant.page(),/请核实：\n南湾户需要陪同接送。/);
  assert.equal(h.assistant.serialize().messages.filter(m=>m.role==='user').length,0);
  h.input('核对后：南湾户需要陪同接送。');await h.click('send');assert.equal(h.assistant.serialize().messages.find(m=>m.role==='user').text,'核对后：南湾户需要陪同接送。');
});
test('leaving the assistant or resetting aborts speech and prevents late text from returning',async()=>{
  let rec;
  class Recognition{constructor(){rec=this;}start(){}stop(){}abort(){this.aborted=true;}}
  const h=harness(async()=>assert.fail('no model calls'),'irainzhang.github.io',{SpeechRecognition:Recognition});
  h.input('原有草稿');await h.click('voice');const old=rec;h.assistant.navigation('ledger');assert.equal(old.aborted,true);old.onresult({results:[Object.assign([{transcript:'旧语音'}],{isFinal:true})]});old.onend();assert.match(h.assistant.page(),/原有草稿/);assert.doesNotMatch(h.assistant.page(),/旧语音/);
  await h.click('voice');const second=rec;h.assistant.reset();second.onresult({results:[Object.assign([{transcript:'重置前语音'}],{isFinal:true})]});second.onend();assert.equal(second.aborted,true);assert.doesNotMatch(h.assistant.page(),/原有草稿|重置前语音/);
});
test('restoring a cached page redraws the composer after speech was cancelled on pagehide',async()=>{
  let rec;
  class Recognition{constructor(){rec=this;}start(){}abort(){this.aborted=true;}}
  const h=harness(async()=>assert.fail('no model calls'),'irainzhang.github.io',{SpeechRecognition:Recognition});
  h.input('返回后继续编辑');await h.click('voice');rec.onstart();assert.match(h.assistant.page(),/readonly/);
  h.lifecycle('pagehide');assert.equal(rec.aborted,true);const before=h.renders();h.lifecycle('pageshow');
  assert.ok(h.renders()>before);assert.doesNotMatch(h.assistant.page(),/readonly/);assert.match(h.assistant.page(),/返回后继续编辑/);
});
