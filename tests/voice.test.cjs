const test=require('node:test');
const assert=require('node:assert/strict');
const {create}=require('../dist/voice-input.js');
function harness(text='',options={}){
  const instances=[],timers=new Map();let next=0;
  class Recognition{constructor(){instances.push(this);}start(){this.started=true;}stop(){this.stopped=true;}abort(){this.aborted=true;}}
  const voice=create({Recognition,secure:true,getText:()=>text,onText:value=>text=value,schedule:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},unschedule:id=>timers.delete(id),...options});
  const emit=(rec,parts)=>rec.onresult({results:parts.map(([transcript,isFinal])=>Object.assign([{transcript}],{isFinal}))});
  return {voice,instances,timers,emit,text:()=>text,edit:value=>text=value,fire:ms=>{const item=[...timers.entries()].find(([,t])=>t.ms===ms);assert.ok(item);timers.delete(item[0]);item[1].fn();}};
}
test('final transcript is appended once only after end; interim text stays out of the draft',()=>{
  const h=harness('原有问题');h.voice.start();const r=h.instances[0];r.onstart();
  h.emit(r,[['南湾',false]]);assert.equal(h.text(),'原有问题');assert.equal(h.voice.state().preview,'南湾');
  h.voice.stop();assert.equal(h.voice.state().phase,'stopping');assert.equal(r.stopped,true);h.voice.start();assert.equal(h.instances.length,1);
  h.emit(r,[['南湾户需要轮椅。',true],['其余',false]]);h.emit(r,[['南湾户需要轮椅。',true],['其余',false]]);r.onend();
  assert.equal(h.text(),'原有问题\n南湾户需要轮椅。');assert.equal(h.voice.active(),false);assert.equal(h.timers.size,0);
});
test('cancel during permission wait aborts and ignores every late callback',()=>{
  const h=harness('保留草稿');h.voice.start();const old=h.instances[0];h.voice.stop();assert.equal(old.aborted,true);
  h.voice.start();const current=h.instances[1];current.onstart();h.emit(old,[['旧结果',true]]);old.onend();old.onerror({error:'network'});
  assert.equal(h.voice.state().phase,'listening');assert.equal(h.text(),'保留草稿');
  h.emit(current,[['新反馈',true]]);current.onend();assert.equal(h.text(),'保留草稿\n新反馈');
});
test('permission, network and microphone failures preserve input and remain visible after end',()=>{
  for(const error of ['not-allowed','network','audio-capture','service-not-allowed','no-speech']){
    const h=harness('保留草稿');h.voice.start();const r=h.instances[0];r.onstart();h.emit(r,[['未完成反馈',false]]);
    r.onerror({error});const note=h.voice.state().note;r.onend();assert.equal(h.voice.state().note,note);assert.equal(h.voice.active(),false);assert.equal(h.text(),'保留草稿');assert.equal(r.aborted,true);
  }
});
test('natural end without final text does not submit partial speech',()=>{
  const h=harness('保留');h.voice.start();const r=h.instances[0];r.onstart();h.emit(r,[['临时识别',false]]);r.onend();
  assert.equal(h.text(),'保留');assert.match(h.voice.state().note,/没有得到完整/);
});
test('speech never overwrites a changed draft or silently truncates beyond 2000 characters',()=>{
  const h=harness('原稿');h.voice.start();const r=h.instances[0];r.onstart();h.emit(r,[['识别文字',true]]);h.edit('新的手动内容');r.onend();assert.equal(h.text(),'新的手动内容');assert.match(h.voice.state().note,/已变化/);
  const long=harness('文'.repeat(1998));long.voice.start();const rec=long.instances[0];rec.onstart();long.emit(rec,[['超过长度',true]]);rec.onend();assert.equal(long.text().length,1998);assert.match(long.voice.state().note,/超过 2000/);
});
test('unsupported and insecure environments stay usable and do not instantiate recognition',()=>{
  for(const options of [{Recognition:undefined},{secure:false}]){const h=harness('原稿',options);h.voice.start();h.voice.cancel('重置提示');assert.equal(h.instances.length,0);assert.equal(h.voice.state().supported,false);assert.equal(h.voice.active(),false);assert.doesNotMatch(h.voice.state().note,/重置提示/);}
});
test('startup exception and hung services release timers and do not lose typed input',()=>{
  class Broken{start(){throw new Error('not available');}abort(){}}
  const broken=harness('草稿',{Recognition:Broken});broken.voice.start();assert.equal(broken.voice.active(),false);assert.equal(broken.timers.size,0);assert.equal(broken.text(),'草稿');
  const waiting=harness('草稿');waiting.voice.start();waiting.fire(30000);assert.equal(waiting.voice.active(),false);assert.equal(waiting.instances[0].aborted,true);
  const listening=harness('草稿');listening.voice.start();listening.instances[0].onstart();listening.fire(60000);assert.equal(listening.voice.state().phase,'stopping');listening.fire(8000);assert.equal(listening.voice.active(),false);assert.equal(listening.text(),'草稿');
});
