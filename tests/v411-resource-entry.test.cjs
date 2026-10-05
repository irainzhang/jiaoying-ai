'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const W=require('../dist/task-workbench.js'),E=require('../exercise.cjs');

test('first-time entry exposes add/import/demo actions before categorized form fields',()=>{
  const html=W.resourceForm({data:E.createBlank()}),editor=html.indexOf('id="resource-editor"');
  for(const marker of ['id="resource-staff-add"','data-resource-add="vehicle"','id="resource-seed"','id="resource-staff-import"'])assert.ok(html.indexOf(marker)>0&&html.indexOf(marker)<editor);
  assert.match(html,/data-registry-panel="staff" aria-label="工作人员" >/);
  assert.match(html,/data-registry-panel="vehicle" aria-label="车辆与编组" hidden/);
  assert.match(html,/data-registry-panel="shelter" aria-label="安置接收点" hidden/);
  assert.match(html,/总核载 8 − 司机 1 − 随车员 1 = 可接 6 人/);
  assert.match(html,/id="resource-save-state" data-state="clean"/);
});
test('saved registry opens vehicles without claiming unsaved edits',()=>{
  const data=E.createBlank();data.scenario.staff=[{id:'W001',role:'driver',available:true}];
  const html=W.resourceForm({data});assert.match(html,/data-registry-panel="vehicle" aria-label="车辆与编组" >/);
  assert.match(html,/已加载本场资源 · 尚未修改/);assert.doesNotMatch(html,/有未保存的修改/);
});
test('active readonly registry gives operational paths without editable actions',()=>{
  const html=W.resourceForm({data:E.createBlank()},{readonly:true});
  assert.match(html,/data-ac="resource-status-dialog"/);assert.match(html,/结束本场并登记下一场/);assert.match(html,/要录入新车辆或工作人员/);
  for(const marker of ['id="resource-seed"','id="resource-staff-add"','data-resource-add=','id="resource-staff-import"','type="submit"'])assert.ok(!html.includes(marker),marker);
});
test('closed readonly registry routes straight to creating next task, never changes old task status',()=>{
  const data=E.createBlank();data.taskLifecycle.status='completed';const before=JSON.stringify(data),html=W.resourceForm({data},{readonly:true});
  assert.match(html,/新建任务并录入资源/);assert.doesNotMatch(html,/data-ac="resource-status-dialog"/);assert.equal(JSON.stringify(data),before);
});

function validationDOM(){
  const panels=['staff','vehicle','shelter'].map(kind=>({dataset:{registryPanel:kind},hidden:kind!=='staff'}));
  const buttons=panels.map(p=>({dataset:{registrySection:p.dataset.registryPanel},setAttribute(k,v){this[k]=v;}}));
  const box={textContent:'',focus(){this.focused=true;},scrollIntoView(){this.scrolled=true;}};
  const field={value:'',disabled:false,validity:{valid:false},getAttribute:()=> '车辆2总核载',setAttribute(k,v){this[k]=v;},closest:s=>s==='[data-registry-panel]'?panels[1]:null,scrollIntoView(){this.scrolled=true;},focus(){this.focused=true;}};
  const editor={dataset:{readonly:'false'},querySelectorAll:s=>s==='input,select,textarea'?[field]:[]};
  const container={querySelector:s=>s==='#resource-editor'?editor:s==='#resource-editor-error'?box:null,querySelectorAll:s=>s==='[data-registry-panel]'?panels:s==='[data-registry-section][aria-pressed]'?buttons:[]};
  return {panels,buttons,box,field,editor,container};
}
test('invalid input in hidden vehicle section is revealed and focused before error is returned',()=>{
  const d=validationDOM();let error;try{W.checkResourceFields(d.container);}catch(e){error=e;}
  assert.match(error.message,/车辆2总核载/);W.showResourceError(d.container,error);
  assert.equal(d.panels[0].hidden,true);assert.equal(d.panels[1].hidden,false);assert.equal(d.buttons[1]['aria-pressed'],'true');
  assert.equal(d.field.focused,true);assert.equal(d.field.scrolled,true);assert.equal(d.field['aria-invalid'],'true');assert.match(d.box.textContent,/车辆2总核载/);
});
test('switching categories preserves unsaved form values and ignores invalid category names',()=>{
  const d=validationDOM();d.field.value='17';W.showResourceSection(d.container,'vehicle');W.showResourceSection(d.container,'staff');
  assert.equal(d.field.value,'17');assert.equal(d.panels[0].hidden,false);assert.equal(d.panels[1].hidden,true);
  W.showResourceSection(d.container,'<bad>');assert.equal(d.panels[0].hidden,false);
});
test('readonly and disabled controls never block viewing a historical registry',()=>{
  const d=validationDOM();d.editor.dataset.readonly='true';assert.doesNotThrow(()=>W.checkResourceFields(d.container));
  d.editor.dataset.readonly='false';d.field.disabled=true;assert.doesNotThrow(()=>W.checkResourceFields(d.container));
});
test('server validation without a field match still presents and focuses an actionable error',()=>{
  const d=validationDOM();d.field.validity.valid=true;W.showResourceError(d.container,'本场依据已变化，请刷新后核对');
  assert.equal(d.box.focused,true);assert.match(d.box.textContent,/依据已变化/);
});
test('dirty state follows resource edits and clears on exact reversion, independent of section switches',()=>{
  const events={},id={value:'W001',hasAttribute:k=>k==='data-staff-field',removeAttribute(){}},role={value:'driver'},available={checked:true};
  const staffRow={querySelector:s=>s.includes('="id"')?id:s.includes('="role"')?role:available};
  const label={dataset:{},textContent:''},empty={hidden:false},innerError={textContent:'旧资源错误'},hostError={textContent:'旧宿主错误'},counts=Object.fromEntries(['staff','vehicle','shelter'].map(k=>[k,{textContent:''}]));
  const editor={dataset:{resourceVersion:'1',readonly:'false'},querySelector:s=>s==='.registry-staff-empty'?empty:null,querySelectorAll:s=>s==='[data-staff-row]'?[staffRow]:[]};
  const container={ownerDocument:{},querySelector:s=>s==='#resource-editor'?editor:s==='#resource-save-state'?label:s==='#resource-editor-error'?innerError:s==='#modal-error'?hostError:s.startsWith('[data-registry-count=')?counts[s.match(/="([^"]+)"/)[1]]:null,querySelectorAll:s=>s==='[data-staff-row]'?[staffRow]:[],addEventListener:(k,fn)=>events[k]=fn,removeEventListener:k=>delete events[k]};
  const unbind=W.bindResources(container);assert.equal(label.dataset.state,'clean');assert.equal(counts.staff.textContent,'1 人');
  events.input({target:{id:'unrelated-field',hasAttribute:()=>false}});assert.equal(innerError.textContent,'旧资源错误');assert.equal(hostError.textContent,'旧宿主错误');
  id.value='W002';events.input({target:id});assert.equal(label.dataset.state,'dirty');assert.match(label.textContent,/未保存/);assert.equal(innerError.textContent,'');assert.equal(hostError.textContent,'');
  W.showResourceSection(container,'vehicle');assert.equal(label.dataset.state,'dirty');assert.equal(id.value,'W002');
  id.value='W001';events.change({target:id});assert.equal(label.dataset.state,'clean');
  innerError.textContent=hostError.textContent='人员表格式错误';events.input({target:{id:'resource-staff-csv',hasAttribute:()=>false}});assert.equal(innerError.textContent,'');assert.equal(hostError.textContent,'');assert.equal(label.dataset.state,'clean');
  unbind();assert.deepEqual(Object.keys(events),[]);
});
