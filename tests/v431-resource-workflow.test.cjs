'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const W=require('../dist/task-workbench.js'),X=require('../exercise.cjs'),I=require('../dist/resource-intake.js');

function boundRegistry(){
  const events={},panels=['staff','vehicle','shelter'].map(kind=>({dataset:{registryPanel:kind},hidden:kind!=='staff',scrollIntoView(){}}));
  const buttons=panels.map(p=>({dataset:{registrySection:p.dataset.registryPanel},setAttribute(k,v){this[k]=v;}}));
  const indicator={dataset:{},textContent:''},error={textContent:''};
  const editor={dataset:{resourceVersion:'1',readonly:'false',resourceCatalog:'[]'},querySelector:()=>null,querySelectorAll:()=>[]};
  const container={ownerDocument:{},contains:()=>true,querySelector:s=>s==='#resource-editor'?editor:s==='#resource-capture'?{}:s==='#resource-save-state'?indicator:s==='#resource-editor-error'?error:s.startsWith('[data-registry-panel=')?panels.find(p=>s.includes('"'+p.dataset.registryPanel+'"')):null,querySelectorAll:s=>s==='[data-registry-panel]'?panels:s==='[data-registry-section][aria-pressed]'?buttons:[],addEventListener:(k,f)=>events[k]=f,removeEventListener:k=>delete events[k]};
  let config,kind='staff',pending=false,disposed=false;
  const fakeKit={bind(_container,options){config=options;const dispose=()=>{disposed=true;};dispose.hasPending=()=>pending;dispose.setKind=next=>{if(pending&&next!==kind)return false;kind=next;config.onKindChange(next);return true;};return dispose;}};
  const context={JiaoyingEntryKit:fakeKit,JiaoyingResourceIntake:I,JiaoyingResourceRegistry:require('../dist/resource-registry.js')};
  vm.runInNewContext(fs.readFileSync(require.resolve('../dist/task-workbench.js'),'utf8'),context);
  const dispose=context.JiaoyingTaskWorkbench.bindResources(container);
  return {panels,buttons,events,config,dispose,get kind(){return kind;},get disposed(){return disposed;},set pending(value){pending=value;},click(next){const button=buttons.find(b=>b.dataset.registrySection===next);events.click({target:{closest:()=>button}});}};
}

test('resource tabs drive the same intake kind used for Excel and protect pending previews',()=>{
  const f=boundRegistry();f.click('vehicle');assert.equal(f.kind,'vehicle');assert.equal(f.panels[1].hidden,false);assert.equal(f.buttons[1]['aria-pressed'],'true');
  f.pending=true;f.click('shelter');assert.equal(f.kind,'vehicle');assert.equal(f.panels[1].hidden,false);assert.equal(f.panels[2].hidden,true);
  f.click('vehicle');assert.equal(f.panels[1].hidden,false);
  f.pending=false;f.click('shelter');assert.equal(f.kind,'shelter');assert.equal(f.panels[2].hidden,false);
  f.dispose();assert.equal(f.disposed,true);assert.deepEqual(Object.keys(f.events),[]);
});
test('intake selector and detected file type show their matching resource panel',()=>{
  const f=boundRegistry();f.config.onKindChange('shelter');assert.equal(f.panels[2].hidden,false);assert.equal(f.panels[0].hidden,true);
  assert.equal(f.config.detectKind([['安置点名称','可接收人数','地图位置'],['演练点',20,'S1']]),'shelter');
  assert.equal(f.config.detectKind([['车辆名称','总核载人数'],['演练车',8]]),'vehicle');f.dispose();
});
test('manual registry shows required labels and keeps false availability and missing driver valid for registration',()=>{
  const data=X.createBlank();data.scenario.staff=[{id:'D01',role:'driver',available:false}];const html=W.resourceForm({data});
  assert.match(html,/为保存必填/);assert.match(html,/没有轮椅位请填 0/);assert.match(html,/查看本类必填 \/ 选填清单/);
  for(const label of ['人员编号','岗位','是否到岗','车辆名称','车辆型号','车辆类型','总核载人数（含工作人员）','核定轮椅位','车辆出发位置','安置点名称','可接收人数','地图位置']){
    const labels=[...html.matchAll(/<label(?:\s[^>]*)?>([\s\S]*?)<\/(?:label)>/g)].map(m=>m[1]);assert.ok(labels.some(text=>text.includes(label)&&text.includes('aria-label="必填"')),label);
  }
  for(const select of html.matchAll(/<select[^>]*data-resource-field="driverId"[^>]*>/g))assert.doesNotMatch(select[0],/\brequired(?:\s|=|>)/);
  for(const box of html.matchAll(/<input[^>]*(?:data-staff-field|data-resource-field)="available"[^>]*>/g))assert.doesNotMatch(box[0],/\brequired(?:\s|=|>)/);
  assert.match(html,/参与接送前必须配齐/);
});
