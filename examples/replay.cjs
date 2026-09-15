// Recompute an exported synthetic exercise using its original planning snapshot.
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const E=require('../dist/engine.js');
const filename=process.argv[2]||path.join(__dirname,'default-exercise.json');
const saved=JSON.parse(fs.readFileSync(filename,'utf8'));
if(saved.schema!=='jiaoying-demo-v2')throw new Error('不是 V2 演练导出格式');
const input=saved.planInput||saved.scenario;
const plan=E.solve(input),baseline=E.baseline(input);
assert.deepEqual(E.validatePlan(input,plan),[]);
assert.deepEqual(E.validatePlan(input,baseline),[]);
if(saved.plan){assert.deepEqual(plan.routes,saved.plan.routes);assert.deepEqual(baseline.routes,saved.baseline.routes);}
console.log(JSON.stringify({dataNature:saved.dataNature,inputVersion:saved.planVersion||saved.version,totalPeople:plan.totalPeople,optimized:{people:plan.servedPeople,priorityAverage:plan.priorityAverage,finish:plan.finish},baseline:{people:baseline.servedPeople,priorityAverage:baseline.priorityAverage,finish:baseline.finish},samePeople:plan.mask===baseline.mask,validation:'passed',savedRoutesMatch:!!saved.plan},null,2));
