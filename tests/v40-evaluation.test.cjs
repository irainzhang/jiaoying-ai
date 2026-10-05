'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),crypto=require('node:crypto');
const evaluator=require('../scripts/evaluate-scenarios.cjs'),X=require('../exercise.cjs');

test('the 20+3 journey distinguishes unreviewed additions and conserves effective demand',()=>{
  const w=evaluator.intakeJourney();assert.equal(w.initialPeople,0);assert.equal(w.uploaded.people,20);assert.equal(w.pending.effectivePeople,20);assert.equal(w.pending.pendingReviewPeople,3);assert.equal(w.reviewed.people,23);assert.equal(w.reviewed.optimized.servedPeople+w.reviewed.optimized.unassignedPeople,23);assert.equal(w.passed,true);
  assert.ok(w.reviewed.optimized.unassignedPeople>0,'default resources must not claim all23 allocated');
});

test('two-trip evaluation retains destination occupancy and recognizes completion only after verification',()=>{
  const w=evaluator.multiTripJourney(20);assert.equal(w.final.people,8);assert.equal(w.final.vehicleTripCount,2);assert.equal(w.final.verifiedPeople,8);assert.equal(w.final.totalOccupancy,8);assert.equal(w.final.waitingPeople,0);assert.equal(w.final.complete,true);assert.equal(w.passed,true);assert.equal(w.rounds[1].fromNode,w.rounds[0].destination);
});

test('limited destination capacity remains an explicit failed coverage case after vehicle turnaround',()=>{
  const w=evaluator.multiTripJourney(6);assert.equal(w.passed,true);assert.equal(w.final.complete,false);assert.ok(w.final.waitingPeople>0);assert.ok(w.final.totalOccupancy<=6);assert.equal(w.final.verifiedPeople+w.final.waitingPeople,8);assert.ok(w.rounds.at(-1).unassignedPeople>0);
});

test('the published evaluation carries reproducible snapshots and a current product version',()=>{
  const stored=require('../dist/assets/evaluation.json');assert.equal(stored.productVersion,'4.0.0');assert.equal(stored.version,'4.0.0-evaluation');assert.equal(stored.passedConstraintChecks,true);
  for(const row of [...stored.cases,...stored.scale,stored.workflows.intake.uploaded,stored.workflows.intake.reviewed]){
    assert.equal(crypto.createHash('sha256').update(JSON.stringify(row.inputSnapshot)).digest('hex'),row.inputHash);
    const plan=X.solve(row.inputSnapshot).plan;assert.deepEqual(X.validate(row.inputSnapshot,plan),[]);assert.equal(plan.servedPeople,row.optimized.servedPeople);assert.equal(plan.wait,row.optimized.weightedWait);
  }
});
