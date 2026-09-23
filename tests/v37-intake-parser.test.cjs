const test=require('node:test');
const assert=require('node:assert/strict');
const intake=require('../dist/command-intake.js');

const context=()=>({data:{villages:['A','B','C'].map((letter,index)=>({id:'V'+letter,name:'演示村 '+letter,synthetic:true,pickups:[{id:'P-'+letter+'1',name:'村委会集合点（演示）',node:'H'+(index*2+1)},{id:'P-'+letter+'2',name:'备用集合点（演示）',node:'H'+(index*2+2)}]})),villageReports:[]},reporter:'指挥员'});
const columns=['村庄','集合点','人数','需协助人数','轮椅人数','同行关系'];

test('CSV supports BOM, CRLF, quoted commas, escaped quotes and multiline cells',()=>{
  assert.deepEqual(intake.parseCSV('\uFEFF村庄,备注\r\n演示村 A,"名单,核实"\r\n演示村 B,"第一行\n第二行"\r\n演示村 C,"他说""确认"""\r\n'),[['村庄','备注'],['演示村 A','名单,核实'],['演示村 B','第一行\n第二行'],['演示村 C','他说"确认"']]);
});
test('CSV detects tab-separated spreadsheets and explicit separator declarations',()=>{
  assert.deepEqual(intake.parseCSV('村庄\t人数\nVA\t6'),[['村庄','人数'],['VA','6']]);
  assert.deepEqual(intake.parseCSV('sep=;\r\n村庄;人数\r\nVA;6'),[['村庄','人数'],['VA','6']]);
  assert.deepEqual(intake.parseCSV(''),[]);
});
test('malformed CSV is rejected rather than silently joining rows or columns',()=>{
  for(const text of ['a,b\nVA,"6','a,b\nVA,"6"oops','a,b\nV"A,6'])assert.throws(()=>intake.parseCSV(text),/CSV/);
});
test('spreadsheet normalization uses registered village and pickup aliases with explicit subsets',()=>{
  const out=intake.parseRows([columns,['村A','村委会集合点',6,1,0,'可拆分'],['VB','P-B2',3,1,1,'必须同行']],context());
  assert.deepEqual(out.errors,[]);
  assert.deepEqual(out.rows.map(({villageId,pickupId,people,assistancePeople,wheelchairPeople,groupPolicy,rowIndex})=>({villageId,pickupId,people,assistancePeople,wheelchairPeople,groupPolicy,rowIndex})),[{villageId:'VA',pickupId:'P-A1',people:6,assistancePeople:1,wheelchairPeople:0,groupPolicy:'splittable',rowIndex:2},{villageId:'VB',pickupId:'P-B2',people:3,assistancePeople:1,wheelchairPeople:1,groupPolicy:'together',rowIndex:3}]);
});
test('blank needs and missing pickup stay unknown without preventing a human-reviewed draft',()=>{
  const out=intake.parseRows([['村庄','人数'],['VA',5]],context());
  assert.deepEqual(out.errors,[]);assert.equal(out.rows[0].pickupId,'');
  assert.equal(out.rows[0].assistancePeople,null);assert.equal(out.rows[0].wheelchairPeople,null);assert.equal(out.rows[0].groupPolicy,'unknown');
  assert.ok(out.warnings.some(w=>w.includes('不默认填零')));
});
test('individual name rows imply one person only when a nonempty name exists',()=>{
  const out=intake.parseRows([['所属村','姓名','需协助人数','轮椅人数'],['VA','张甲',1,1],['VA','李乙',0,0],['VA','','','']],context());
  assert.deepEqual(out.rows.map(r=>r.people),[1,1]);assert.ok(out.errors.some(e=>e.includes('第 4 行')));
});
test('blank counts without a name, invalid counts, and inconsistent subsets are errors',()=>{
  for(const values of [['VA','','','','',''],['VA','',0,0,0,''],['VA','',-1,0,0,''],['VA','',1.5,0,0,''],['VA','',501,0,0,''],['VA','',2,3,0,''],['VA','',2,0,1,''],['VA','',2,'可能1',0,'']]){
    const out=intake.parseRows([columns,values],context());assert.ok(out.errors.length,JSON.stringify(values));assert.equal(out.rows.length,0);
  }
});
test('unknown villages, foreign pickups, unknown grouping and duplicate semantic columns require correction',()=>{
  for(const values of [['瑞安幸福村','',5,'','',''],['VA','P-B1',5,'','',''],['VA','学校门口',5,'','',''],['VA','',5,'','','自行处理']])assert.ok(intake.parseRows([columns,values],context()).errors.length);
  assert.ok(intake.parseRows([['村庄','人数','总人数'],['VA',1,2]],context()).errors.some(e=>e.includes('重复')));
});
test('row errors retain physical spreadsheet positions and cannot look like full success',()=>{
  const out=intake.parseRows([[],columns,[],['VA','P-A1',6,0,0,'可拆分'],['坏村','',2,'','','']],context());
  assert.equal(out.rows[0].rowIndex,4);assert.ok(out.errors.some(e=>e.includes('第 5 行')));
  assert.ok(intake.parseRows([['村庄','人数'],['VA',6,'extra']],context()).errors.some(e=>e.includes('超出表头')));
});
test('empty sheets, missing headers and excessive batches are rejected',()=>{
  for(const input of [[],[[]],[['备注'],['hello']],[columns], [columns,...Array.from({length:101},()=>['VA','',1,'','',''])]])assert.ok(intake.parseRows(input,context()).errors.length);
});
test('speech can draft several village batches and preserve special-needs subclauses',()=>{
  const text='演示村 A，村委会集合点（演示），新增 6 人，其中 1 人需要协助，包含 0 人轮椅，独立人员，可以分组。演示村 B 在备用集合点，安排三人，无需协助，无轮椅需求，可拆分';
  const out=intake.parseText(text,context());assert.deepEqual(out.errors,[]);
  assert.deepEqual(out.rows.map(r=>[r.villageId,r.pickupId,r.people,r.assistancePeople,r.wheelchairPeople,r.groupPolicy]),[['VA','P-A1',6,1,0,'splittable'],['VB','P-B2',3,0,0,'splittable']]);
  assert.equal(out.sourceText,text);
});
test('comma between village names begins another batch but shared village totals stay ambiguous',()=>{
  const out=intake.parseText('村A新增六人，其中一人需协助，村B新增二人',context());
  assert.deepEqual(out.errors,[]);assert.deepEqual(out.rows.map(r=>[r.villageId,r.people]),[['VA',6],['VB',2]]);
  assert.ok(intake.parseText('演示村 A 和演示村 B 新增六人',context()).errors.length);
});
test('semicolon-separated needs are kept with their parent batch',()=>{
  const out=intake.parseText('演示村A新增六人；其中一人需要协助；轮椅零人；可拆分',context());
  assert.deepEqual(out.errors,[]);assert.equal(out.rows.length,1);assert.equal(out.rows[0].assistancePeople,1);assert.equal(out.rows[0].wheelchairPeople,0);
});
test('command verbs draft added demand without rewriting total or correction semantics',()=>{
  for(const text of ['请安排演示村 A 转移六人','演示村A接送六人','请将演示村A六人转移'])assert.equal(intake.parseText(text,context()).rows[0]?.people,6,text);
  for(const text of ['演示村A目前待转移共六人','演示村A还有六人需要转移','演示村A总计六人','演示村A共计六人','演示村A共有六人','演示村A更正为六人','演示村A已转移六人'])assert.ok(intake.parseText(text,context()).errors.length,text);
});
test('negative, estimated, conflicting and unregistered voice input is never accepted',()=>{
  for(const text of ['演示村A不要转移六人','演示村A不转移六人','演示村A无需再转移六人','演示村A预计新增六人','演示村A新增大约六人','演示村A新增三百五人','演示村A新增六人，总计八人','演示村A新增六人，需协助七人','幸福村新增六人','演示村AA新增六人','演示村A新增六人，在P-B1','演示村A新增六人，在学校门口集合'])assert.ok(intake.parseText(text,context()).errors.length,text);
});
test('context fallback supports quick field use without guessing registered locations',()=>{
  const out=intake.parseText('新增六人',{...context(),villageId:'VA',pickupId:'P-A1'});
  assert.deepEqual(out.errors,[]);assert.equal(out.rows[0].pickupId,'P-A1');assert.equal(out.rows[0].assistancePeople,null);
  assert.ok(intake.parseText('演示村B新增六人',{...context(),villageId:'VA'}).errors.length);
});
test('one invalid section keeps errors visible alongside valid rows and parsing is pure',()=>{
  const ctx=context(),before=JSON.stringify(ctx),text='演示村A新增六人；未知村新增七人';
  const out=intake.parseText(text,ctx);assert.equal(out.rows.length,1);assert.ok(out.errors.length);assert.equal(JSON.stringify(ctx),before);
});
