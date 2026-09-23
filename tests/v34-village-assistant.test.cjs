const test = require('node:test');
const assert = require('node:assert/strict');
const assistant = require('../dist/village-assistant.js');

function context(extra = {}) {
  return {
    data: {
      villages: [
        {id:'VA',name:'演示村 A',township:'演示乡镇',synthetic:true,pickups:[{id:'P-A1',name:'村委会集合点（演示）',node:'H1'},{id:'P-A2',name:'备用集合点（演示）',node:'H2'}]},
        {id:'VB',name:'演示村 B',township:'演示乡镇',synthetic:true,pickups:[{id:'P-B1',name:'村委会集合点（演示）',node:'H3'}]}
      ],
      villageReports:[{id:'VR1',villageId:'VA',mode:'increment',status:'accepted',people:20,householdIds:['VH1']}],
      stage:{VH1:'waiting'}
    },
    villageId:'VA',pickupId:'',mode:'increment',reporter:'村级联络员',source:'voice',
    observedAt:'2026-09-22T10:15:00.000Z',
    ...extra
  };
}
const draft = (text, extra) => assistant.prepare(text, context(extra));

test('Chinese total, assisted subset and wheelchair subset are not added together', () => {
  const out = draft('演示村 A 新增二十人，其中三人需要搀扶，含一名轮椅，在村委会集合点，可按人数拆分');
  assert.deepEqual(out.questions, []);
  assert.equal(out.proposal.payload.people, 20);
  assert.equal(out.proposal.payload.assistancePeople, 3);
  assert.equal(out.proposal.payload.wheelchairPeople, 1);
  assert.equal(out.proposal.payload.pickupId, 'P-A1');
  assert.equal(out.proposal.payload.groupPolicy, 'splittable');
  assert.equal(out.proposal.payload.source, 'voice');
});

test('missing point, needs, and grouping stay unknown but a report may be drafted', () => {
  const out = draft('新增25人，集合点待定');
  assert.equal(out.proposal.payload.pickupId, '');
  assert.equal(out.proposal.payload.assistancePeople, null);
  assert.equal(out.proposal.payload.wheelchairPeople, null);
  assert.equal(out.proposal.payload.groupPolicy, 'unknown');
  assert.ok(out.warnings.some(s => s.includes('不会默认填零')));
});

test('explicitly no assistance and no wheelchair become zero, not omitted values', () => {
  const out = draft('新增十人，无需特殊协助，无轮椅需求，都是独立人员');
  assert.equal(out.proposal.payload.assistancePeople, 0);
  assert.equal(out.proposal.payload.wheelchairPeople, 0);
  assert.equal(out.proposal.payload.groupPolicy, 'splittable');
});

test('together family is not parsed as splittable through negative substring', () => {
  const out = draft('新增五人，是一家人，不可拆分');
  assert.deepEqual(out.questions, []);
  assert.equal(out.proposal.payload.groupPolicy, 'together');
});

test('explicit current waiting snapshot overrides UI mode and requires timestamp', () => {
  const out = draft('目前待转移共二十人');
  assert.equal(out.proposal.payload.mode, 'snapshot');
  assert.equal(out.proposal.payload.scope, 'waiting');
  assert.equal(out.proposal.payload.observedAt, '2026-09-22T10:15:00.000Z');
  assert.ok(out.warnings.some(s => s.includes('不会自动加减')));
  assert.equal(draft('目前待转移二十人', {observedAt:''}).proposal, null);
});

test('still waiting wording is snapshot, never additional demand', () => {
  assert.equal(draft('还有20人需要转移').proposal.payload.mode, 'snapshot');
});

test('zero snapshot and correction are valid; zero increment is not', () => {
  assert.equal(draft('目前待转移零人').proposal.payload.people, 0);
  assert.equal(draft('更正为零人', {targetId:'VR1'}).proposal.payload.people, 0);
  assert.equal(draft('新增零人').proposal, null);
});

test('Chinese hundreds and digit-by-digit numbers parse within the report bound', () => {
  assert.equal(draft('新增一百零二人').proposal.payload.people, 102);
  assert.equal(draft('新增五百人').proposal.payload.people, 500);
  assert.equal(draft('新增二〇人').proposal.payload.people, 20);
  assert.equal(draft('新增五百零一人').proposal, null);
});

test('village is mandatory and spoken village must agree with selected village', () => {
  assert.equal(draft('新增20人', {villageId:''}).proposal, null);
  assert.equal(draft('演示村 B 新增20人').proposal, null);
  assert.equal(draft('演示村 B 新增20人', {villageId:''}).proposal.payload.villageId, 'VB');
  assert.equal(draft('演示村 A 和演示村 B 新增20人').proposal, null);
});

test('unregistered real village is not silently mapped to the selected demo village', () => {
  const out = draft('塘下镇幸福村新增20人');
  assert.equal(out.proposal, null);
  assert.ok(out.questions.some(s => s.includes('真实地名')));
});

test('pickup conflicts and foreign pickup IDs cannot be silently assigned', () => {
  assert.equal(draft('新增20人，在备用集合点', {pickupId:'P-A1'}).proposal, null);
  assert.equal(draft('新增20人', {pickupId:'P-B1'}).proposal, null);
  assert.equal(draft('新增20人，集合点待定', {pickupId:'P-A1'}).proposal, null);
  assert.equal(draft('新增20人，在 P-B1', {pickupId:'P-A1'}).proposal, null);
});

test('unregistered collection point remains unlocated and conflicts with selected point', () => {
  assert.equal(draft('新增20人，在学校门口集合').proposal.payload.pickupId, '');
  assert.equal(draft('新增20人，在学校门口集合', {pickupId:'P-A1'}).proposal, null);
});

test('ambiguous abbreviated Chinese hundred count requires clarification', () => {
  assert.equal(draft('新增三百五人').proposal, null);
  assert.equal(draft('新增三百五十人').proposal.payload.people, 350);
  assert.equal(draft('新增三百零五人').proposal.payload.people, 305);
});

test('conflicting totals and separate increment plus snapshot require clarification', () => {
  assert.equal(draft('新增20人，总计30人').proposal, null);
  assert.equal(draft('新增20人，30人').proposal, null);
  assert.equal(draft('新增20人，目前待转移30人').proposal, null);
});

test('ambiguous counts, uncertainty, cumulative totals and negation are not confirmed', () => {
  for (const text of ['新增大约20人','预计新增20人','新增二十点五人','新增-5人','新增20到30人','新增20人左右','不新增20人','不要上报20人','累计转移20人','已上车20人','新增20人？']) {
    assert.equal(draft(text).proposal, null, text);
  }
});

test('special-needs values must be internally consistent subsets', () => {
  for (const text of ['新增3人，其中5人需要协助','新增3人，4人使用轮椅','新增20人，其中2人需要协助，3人使用轮椅','新增20人，其中3人需要协助，无需协助','新增20人，1名轮椅，无轮椅需求']) {
    assert.equal(draft(text).proposal, null, text);
  }
});

test('assistance and wheelchair label-first wording is supported', () => {
  const out = draft('新增20人，需要协助3人，轮椅人数1人');
  assert.equal(out.proposal.payload.assistancePeople, 3);
  assert.equal(out.proposal.payload.wheelchairPeople, 1);
});

test('correction binds the selected original batch and uses new value only', () => {
  const out = draft('更正 VR1，原来报了20人，改为18人', {targetId:'VR1'});
  assert.equal(out.proposal.payload.mode, 'correction');
  assert.equal(out.proposal.payload.targetId, 'VR1');
  assert.equal(out.proposal.payload.people, 18);
  assert.equal(out.proposal.payload.duplicateAcknowledged, false);
  assert.equal(draft('更正为18人').proposal, null);
});

test('invalid, superseded, foreign-village or already-boarded correction target is blocked', () => {
  assert.equal(draft('更正为18人', {targetId:'VR99'}).proposal, null);
  for (const delta of [{supersededBy:'VR2'},{status:'rejected'},{villageId:'VB'},{mode:'snapshot'}]) {
    const c = context({targetId:'VR1'}); Object.assign(c.data.villageReports[0],delta);
    assert.equal(assistant.prepare('更正为18人',c).proposal, null);
  }
  const c = context({targetId:'VR1'}); c.data.stage.VH1 = 'boarded';
  assert.equal(assistant.prepare('更正为18人',c).proposal,null);
});

test('parser is pure and preserves the original utterance without side effects', () => {
  const c = context(), original = JSON.stringify(c);
  const out = assistant.prepare('  新增20人  ',c);
  assert.equal(JSON.stringify(c), original);
  assert.equal(out.proposal.payload.text, '新增20人');
  assert.equal(out.mode, 'local-rules');
  assert.ok(out.evidence.some(s => s.includes('未调用大模型')));
});
