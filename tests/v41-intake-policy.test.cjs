'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const I=require('../dist/command-intake.js'),E=require('../exercise.cjs');
const columns=['村庄','集合点','人数','需协助人数','轮椅人数','同行关系'];
test('quick-entry label 须同行 parses and saves a complete group without losing people or wheelchair counts',()=>{
  const store=E.create(E.createBlank({mapMode:'same'}));
  const draft=I.parseRows([columns,['VA','P-A1','4','2','1','须同行']],{data:store.data});
  assert.deepEqual(draft.errors,[]);assert.equal(draft.rows.length,1);
  const row=draft.rows[0];assert.equal(row.groupPolicy,'together');assert.equal(row.people,4);assert.equal(row.assistancePeople,2);assert.equal(row.wheelchairPeople,1);assert.equal(row.villageId,'VA');assert.equal(row.pickupId,'P-A1');
  store.action('command-intake',{source:'text',rows:draft.rows});
  const report=store.data.villageReports[0],households=store.data.scenario.households;
  assert.equal(E.metrics(store.data).people,4);assert.equal(report.groupPolicy,'together');assert.equal(report.people,4);assert.equal(report.assistancePeople,2);assert.equal(report.wheelchairPeople,1);assert.equal(households.length,1);assert.equal(households[0].people,4);assert.equal(households[0].wheelchairPeople,1);
});
test('quick-entry and spreadsheet grouping labels normalize identically while unrecognized policy remains an error',()=>{
  const data=E.createBlank({mapMode:'same'}),parse=label=>I.parseRows([columns,['VA','P-A1',3,1,1,label]],{data});
  for(const label of ['须同行','必须同行','together']){const draft=parse(label);assert.deepEqual(draft.errors,[]);assert.equal(draft.rows[0].groupPolicy,'together');assert.equal(draft.rows[0].people,3);assert.equal(draft.rows[0].wheelchairPeople,1);}
  assert.equal(parse('可分组').rows[0].groupPolicy,'splittable');assert.ok(parse('随便安排').errors.length>0);
});
