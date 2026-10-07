'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../intake-audit.cjs'),X=require('../exercise.cjs'),UI=require('../dist/workflow-status.js'),Kit=require('../dist/entry-kit.js');
const row={villageId:'VA',pickupId:'P-A1',people:3,assistancePeople:0,wheelchairPeople:0,groupPolicy:'splittable',text:'演练新增三人'};
const provenance=()=>({kind:'demand',source:'voice',provider:'deepseek',mode:'online',model:'synthetic-test',requestId:'extract-test',utterance:row.text,modelRows:[{...row,people:30}],normalizedRows:[{...row,people:null}],confirmedRows:[row],sent:true});
test('confirmed intake provenance survives restore and task archival with original and corrected counts',()=>{
  const x=X.create(X.createBlank({mapMode:'same'}));
  x.action('command-intake',{rows:[row],source:'voice',semanticAudit:provenance()});
  const entry=x.data.intakeAudit[0];assert.equal(entry.modelRows[0].people,30);assert.equal(entry.confirmedRows[0].people,3);assert.equal(entry.changes.find(c=>c.field==='people').after,3);
  assert.ok(x.data.villageReports[0].intakeAuditIds.includes(entry.id));
  const restored=X.restore(JSON.parse(JSON.stringify(x.data)));assert.deepEqual(restored.intakeAudit,x.data.intakeAudit);
  x.action('end-task',{mode:'stopped'});x.action('new-task',{seedMode:'blank',mapMode:'same'});
  assert.equal(x.data.intakeAudit?.length||0,0);assert.equal(x.data.taskArchives[0].data.intakeAudit[0].requestId,'extract-test');
});
test('invalid provenance rolls back the entire action and cannot save an untracked batch',()=>{
  const x=X.create(X.createBlank({mapMode:'same'})),before=x.data;
  assert.throws(()=>x.action('command-intake',{rows:[row],source:'voice',semanticAudit:{kind:'chat',apiKey:'not-a-real-key'}}),/来源记录类型/);
  assert.deepEqual(x.data,before);
});
test('provenance strips arbitrary response/config keys and preserves explicit zero and false',()=>{
  const record=A.normalize({...provenance(),apiKey:'never-keep',headers:{Authorization:'never-keep'},modelRows:[{people:0,apiKey:'never-keep'}]});
  assert.equal(record.modelRows[0].people,0);assert.ok(!JSON.stringify(record).includes('never-keep'));
  const staff=A.normalize({kind:'staff',confirmedRows:[{id:'D01',available:false}],normalizedRows:[{id:'D01',available:true}]});assert.equal(staff.confirmedRows[0].available,false);assert.equal(staff.changes[0].after,false);
});
test('offline fallback and manual files cannot be recorded as successful model work',()=>{
  assert.equal(A.normalize({...provenance(),mode:'offline',provider:'offline',sent:true}).provider,'offline');
  assert.equal(A.normalize({kind:'demand',source:'file',confirmedRows:[row]}).mode,'offline');
  assert.throws(()=>A.normalize({kind:'staff',confirmedRows:Array.from({length:151},()=>({id:'D01'}))}),/单批限制/);
});
test('resource update diff is escaped and distinguishes false from missing',()=>{
  const schema={fields:[{key:'available',label:'到岗'},{key:'name',label:'名称'}]},row={available:false,name:'<script>',_resourceBefore:{id:'D01',available:true,name:'旧名'}};
  const html=Kit.changeHTML(schema,row);assert.match(html,/是 → <strong>否/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
});
test('capability hub separates model extraction from local help and hides command intake for field roles',()=>{
  const state={connection:{shared:true,roomId:'test-room',role:'field',staffId:'D01',vehicleId:'V1'},data:{taskLifecycle:{status:'active'}}};
  const html=UI.hub(state,{configured:true},false);assert.match(html,/DeepSeek 语义整理已配置/);assert.match(html,/现场补报新增人员/);assert.doesNotMatch(html,/data-ac="semantic-go-resources"/);assert.match(html,/本地规则/);
  assert.match(UI.connection(state),/现场人员 D01 \/ V1/);assert.match(UI.connection(state,true),/不与其他设备共享/);
});
test('receipt freshness uses actual field time and never labels initial position as a GPS location',()=>{
  assert.match(UI.receipt({fieldEvents:[]},'V1').label,/尚无现场回执/);
  const at='2026-10-06T00:00:00Z',d={fieldEvents:[{vehicleId:'V2',stage:'arrive',time:'2026-10-06T00:30:00Z'},{vehicleId:'V1',stage:'board',time:at}]};
  assert.equal(UI.receipt(d,'V1',Date.parse(at)+9*60000).stale,false);assert.equal(UI.receipt(d,'V1',Date.parse(at)+10*60000).stale,true);
  assert.match(UI.receipt(d,'V1',Date.parse(at)+11*60000).label,/非 GPS/);
});
