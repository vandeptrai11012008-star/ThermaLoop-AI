'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const research=require('../science/agent-research-model.js');
const physics=require('../science/agent-sandbox-model.js');

test('bounded research is deterministic and does not mutate its request',()=>{
  const input={scenario:{preset:'winter',horizonMinutes:35,seed:19},trials:8};
  const before=structuredClone(input),a=research.run(input),b=research.run(input);
  assert.deepEqual(a,b);assert.deepEqual(input,before);
  assert.equal(a.trialCount,8);assert.equal(a.trials[0].plan.length,0);
  assert.equal(a.hardwareAuthorized,false);assert.equal(a.mode,'simulation-only');
});
test('only physically eligible and service-preserving candidates can win',()=>{
  const r=research.run({scenario:{preset:'winter',seed:42,horizonMinutes:60},trials:30});
  assert.ok(r.best);assert.ok(r.best.eligible);
  assert.equal(r.bestReport.verdict.status,'within_tested_envelope');
  assert.ok(r.best.energySavedKWh>0);
  assert.ok(r.trials.every(x=>x.computeServiceRatio>=0));
  assert.equal(r.bestReport.verdict.hardwareAuthorized,false);
  assert.equal(r.bestReport.comparison.energySavedKWh,r.best.energySavedKWh);
  assert.deepEqual(physics.evaluate({scenario:r.config.scenario,plan:r.best.plan}),r.bestReport);
});
test('holdouts are untouched by selection and replay against the same physical engine',()=>{
  const r=research.run({scenario:{preset:'burst',seed:13,horizonMinutes:60},trials:10});
  assert.deepEqual(r.holdouts.map(x=>x.seed),[1986,7932]);
  for(const h of r.holdouts){
    const replay=physics.evaluate({scenario:{...r.config.scenario,seed:h.seed},plan:r.best.plan});
    assert.equal(h.energySavedKWh,replay.comparison.energySavedKWh);
    assert.equal(h.eligible,replay.verdict.status==='within_tested_envelope');
  }
  const rerun=research.run({scenario:{preset:'burst',seed:13,horizonMinutes:60},trials:10});
  assert.equal(r.best.trial,rerun.best.trial);
});
test('negative or failed holdout savings are never called validated improvements',()=>{
  const r=research.run({scenario:{preset:'summer',seed:42,horizonMinutes:60},trials:30});
  assert.equal(r.validatedImprovement,false);
  assert.ok(r.best);
  assert.ok(r.best.energySavedKWh<=0 || r.holdouts.some(x=>!x.eligible||x.energySavedKWh<=0));
});
test('research rejects unknown fields, oversized searches and invalid scenarios',()=>{
  for(const input of [null,[],{trials:1},{trials:31},{trials:3.3},{scenario:{horizonMinutes:121}},
    {scenario:{preset:'bad'}},{scenario:{seed:-1}},{scenario:{horizonMinutes:1.5}},
    {unexpected:1},{scenario:{exec:'shell'}},{schemaVersion:2}])assert.throws(()=>research.run(input));
  assert.equal(research.normalize({}).trials,20);
  assert.equal(research.MAX_TRIALS,30);
});
test('search only explores bounded control patches without reducing GPU or ventilation',()=>{
  for(let i=0;i<30;i++){
    const plan=research.candidatePlan(i,4294967295);
    physics.normalize({scenario:{horizonMinutes:60},plan});
    if(plan.length){assert.equal(plan[0].controls.gpuPowerLimitPct,100);
      assert.equal(plan[0].controls.ventilationACH,0.6);}
  }
});
