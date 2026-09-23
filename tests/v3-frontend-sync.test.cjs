const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {webcrypto} = require('node:crypto');
const Exercise = require('../exercise.cjs');

// Run the shipped controller with controlled network timing. Presentation is
// omitted here; browser QA covers rendering, while these tests force races that
// are too short or intermittent to reproduce reliably by clicking two pages.
function harness() {
  const listeners = {}, requests = [], streams = [];
  const classList = {add(){}, remove(){}, toggle(){}};
  const elements = {toast:{textContent:'', classList}, dialog:{addEventListener(){}}};
  class EventSource {
    static CLOSED = 2;
    constructor(url) { this.url = url; this.readyState = 1; this.listeners = {}; streams.push(this); }
    addEventListener(name, listener) { this.listeners[name] = listener; }
    close() { this.readyState = EventSource.CLOSED; }
    send(snapshot) { this.listeners.state({data:JSON.stringify(snapshot)}); }
  }
  const context = {
    document:{
      getElementById:id=>elements[id] || null,
      addEventListener:(name, listener)=>(listeners[name] ||= []).push(listener),
      querySelector:()=>null, querySelectorAll:()=>[], body:{classList}
    },
    location:{hash:'#field'},
    window:{isSecureContext:true, addEventListener(){}},
    JiaoyingVoice:{create:()=>({active:()=>false, state:()=>({}), cancel(){}})},
    crypto:webcrypto, AbortSignal, EventSource,
    fetch:(url, options)=>new Promise((resolve, reject)=>requests.push({url, options, resolve, reject})),
    setTimeout:()=>1, clearTimeout(){}, setInterval(){},
    matchMedia:()=>({matches:true})
  };
  const source = fs.readFileSync(path.join(__dirname, '../dist/workspace-app.js'), 'utf8');
  const bootstrap = 'render();poll();setInterval(poll,1200);';
  assert.ok(source.includes(bootstrap), 'frontend bootstrap must be located before executing the controller');
  const bridge = `window.testController={
    seed(snapshot,online=true){state=snapshot;connected=online},
    prepare(snapshot,origin='assistant'){
      fieldUtterance='第一条现场反馈';form.text='第一条现场反馈';fieldConfirmed=true;
      fieldPrepared={origin,session:snapshot.session,revision:snapshot.data.revision,requestId:'frontend-test-report',proposal:{action:'report',payload:{kind:'road',location:'east',text:'第一条现场反馈'}}};
      return fieldPrepared;
    },
    inspect(){return {state,connected,liveConnected,busy,fieldUtterance,fieldPrepared,fieldConfirmed,formText:form.text}},
    submitFieldPrepared,poll,connectEvents,acceptState
  };`;
  vm.createContext(context);
  vm.runInContext(source.replace(bootstrap, bridge), context, {filename:'workspace-app.js'});
  return {controller:context.window.testController, requests, streams,
    input(id, value) { for(const listener of listeners.input || []) listener({target:{id,value}}); }
  };
}

function fixture() {
  const store = Exercise.create(); store.action('generate');
  const snapshot = (session='frontend-session')=>{
    const data = store.data;
    return {session, data, metrics:Exercise.metrics(data), blockedVehicles:[], capabilities:{realtimeEvents:true}};
  };
  return {store, snapshot};
}

function respond(request, body, ok=true) { request.resolve({ok, json:async()=>body}); }

test('a successful submission cannot erase text entered after that submission began', async()=>{
  const h = harness(), f = fixture(), before = f.snapshot();
  h.controller.seed(before); h.controller.prepare(before);
  const pending = h.controller.submitFieldPrepared();
  assert.equal(h.controller.inspect().busy, true);
  h.input('field-utterance', '提交期间写下的新一条反馈');
  assert.equal(h.controller.inspect().fieldPrepared, null);
  f.store.action('report', {kind:'road', location:'east', text:'第一条现场反馈'});
  respond(h.requests[0], f.snapshot()); await pending;
  assert.equal(h.controller.inspect().fieldUtterance, '提交期间写下的新一条反馈');
  assert.equal(h.controller.inspect().busy, false);
  assert.equal(h.controller.inspect().state.data.reports.length, 1);
});

test('manual report edits made during an outstanding submission are preserved too', async()=>{
  const h = harness(), f = fixture(), before = f.snapshot();
  h.controller.seed(before); h.controller.prepare(before, 'manual');
  const pending = h.controller.submitFieldPrepared();
  h.input('report-text', '后来补充的现场说明');
  f.store.action('report', {kind:'road', location:'east', text:'第一条现场反馈'});
  respond(h.requests[0], f.snapshot()); await pending;
  assert.equal(h.controller.inspect().formText, '后来补充的现场说明');
  assert.equal(h.controller.inspect().fieldConfirmed, false);
});

test('confirmation from an older revision or a previous server session is rejected before sending', async()=>{
  for(const changedSession of [false, true]) {
    const h = harness(), f = fixture(), before = f.snapshot();
    h.controller.seed(before); h.controller.prepare(before);
    if(!changedSession) f.store.action('generate');
    h.controller.acceptState(f.snapshot(changedSession ? 'restarted-session' : before.session));
    await assert.rejects(h.controller.submitFieldPrepared(), /演练已更新/);
    assert.equal(h.requests.length, 0);
    assert.equal(h.controller.inspect().busy, false);
    assert.ok(h.controller.inspect().fieldPrepared, 'outdated input remains available for review');
  }
});

test('a late polling failure cannot mark a healthy reconnected SSE page offline', async()=>{
  const h = harness(), f = fixture(), before = f.snapshot();
  h.controller.seed(before, false); h.controller.connectEvents();
  const pending = h.controller.poll(true);
  assert.equal(h.requests.length, 1);
  h.streams[0].send(before);
  assert.equal(h.controller.inspect().connected, true);
  assert.equal(h.controller.inspect().liveConnected, true);
  h.requests[0].reject(new Error('an earlier poll timed out after SSE recovered'));
  await pending;
  assert.equal(h.controller.inspect().connected, true);
  assert.equal(h.controller.inspect().liveConnected, true);
});

test('failed submission restores idle state and keeps the confirmed draft for correction', async()=>{
  const h = harness(), f = fixture(), before = f.snapshot();
  h.controller.seed(before); const prepared = h.controller.prepare(before);
  const pending = h.controller.submitFieldPrepared();
  respond(h.requests[0], {error:'现场信息未通过校验'}, false);
  await assert.rejects(pending, /现场信息未通过校验/);
  const after = h.controller.inspect();
  assert.equal(after.busy, false); assert.equal(after.fieldPrepared, prepared);
  assert.equal(after.fieldUtterance, '第一条现场反馈'); assert.equal(after.connected, true);
});

test('an older SSE snapshot cannot roll back a newer committed response in the same session', ()=>{
  const h = harness(), f = fixture(), before = f.snapshot();
  h.controller.seed(before); h.controller.connectEvents();
  f.store.action('report', {kind:'road', location:'east', text:'已提交反馈'});
  const committed = f.snapshot(); h.controller.acceptState(committed);
  h.streams[0].send(before);
  assert.equal(h.controller.inspect().state.data.revision, committed.data.revision);
  assert.equal(h.controller.inspect().state.data.reports.length, 1);
});
