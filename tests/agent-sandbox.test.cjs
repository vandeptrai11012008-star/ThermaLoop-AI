'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const M=require('../science/agent-sandbox-model.js');
test('same seed and request are reproducible and do not mutate caller state',()=>{
  const input=M.schema().example,before=structuredClone(input);
  assert.deepEqual(M.evaluate(input),M.evaluate(input));assert.deepEqual(input,before);
});
test('empty plan is an exact paired baseline, including perturbations',()=>{
  const r=M.evaluate({plan:[]});assert.deepEqual(r.baseline,r.candidate);
  assert.equal(r.comparison.energySavedKWh,0);assert.equal(r.comparison.computeServiceRatio,1);
  for(const s of r.stressTests)assert.deepEqual(s.baselineMetrics,s.candidateMetrics);
});
test('physics has explicit thermal conservation and no heat recovery without transfer',()=>{
  const r=M.evaluate({plan:[{atMinute:0,controls:{heatRecoveryPct:0}}]});
  assert.equal(r.candidate.metrics.usefulHeatKWh,0);
  assert.ok(r.candidate.maxEnergyResidualKJ<1e-5);
  assert.ok(r.candidate.metrics.siteElectricKWh>r.candidate.metrics.gpuElectricKWh);
});
test('nominal candidate passes the declared illustrative envelope, never authorizes hardware',()=>{
  const r=M.evaluate();assert.equal(r.verdict.status,'within_tested_envelope');
  assert.equal(r.verdict.hardwareAuthorized,false);assert.equal(r.mode,'simulation-only');
  assert.equal(r.candidate.trace.length,121);assert.ok(r.candidate.metrics.usefulHeatKWh>0);
});
test('less electricity from curtailed compute cannot masquerade as successful optimization',()=>{
  const r=M.evaluate({plan:[{atMinute:0,controls:{gpuPowerLimitPct:40}}]});
  assert.ok(r.comparison.energySavedKWh>0);assert.equal(r.verdict.serviceMaintained,false);
  assert.equal(r.verdict.status,'needs_revision');
});
test('fault propagation changes temperatures and is rejected despite electricity savings',()=>{
  const r=M.evaluate({scenario:{preset:'pump-fault'}});
  assert.ok(r.candidate.events.some(e=>e.type==='fault'&&e.minute===30));
  assert.ok(r.candidate.violations.some(v=>v.code==='gpu_over_temperature'));
  assert.equal(r.verdict.status,'needs_revision');
  assert.ok(r.candidate.trace[31].pumpHealth<r.candidate.trace[29].pumpHealth);
});
test('hot initial state and inadequate occupied ventilation are not hidden',()=>{
  const r=M.evaluate({scenario:{initialState:{gpuC:100}},plan:[{atMinute:0,controls:{ventilationACH:.2}}]});
  assert.equal(r.candidate.violations.find(v=>v.code==='gpu_over_temperature').firstMinute,0);
  assert.ok(r.candidate.violations.some(v=>v.code==='occupied_ventilation'));
  assert.equal(r.verdict.constraintsPassed,false);
});
test('scheduled patches act at the correct time and preserve earlier state',()=>{
  const r=M.evaluate({scenario:{horizonMinutes:20},plan:[{atMinute:10,controls:{fanPct:20}}]});
  assert.deepEqual(r.baseline.trace.slice(0,11),r.candidate.trace.slice(0,11));
  assert.notDeepEqual(r.baseline.trace[11],r.candidate.trace[11]);
  assert.equal(r.candidate.events[0].minute,10);
});
test('changing seed changes prescribed load, keeping baseline and candidate paired',()=>{
  const a=M.evaluate({scenario:{seed:1}}),b=M.evaluate({scenario:{seed:2}});
  assert.notDeepEqual(a.baseline.trace,b.baseline.trace);
  assert.deepEqual(a.baseline.trace.map(r=>r.loadFraction),a.candidate.trace.map(r=>r.loadFraction));
});
test('invalid and unbounded requests fail closed',()=>{
  for(const x of [null,[],{unknown:1},{schemaVersion:2},{scenario:{preset:'__proto__'}},
    {scenario:{horizonMinutes:361}},{scenario:{horizonMinutes:1.1}},{scenario:{seed:-1}},
    {scenario:{loadFraction:NaN}},{scenario:{occupants:'40'}},{scenario:{initialState:{gpuC:Infinity}}},
    {plan:[{atMinute:0,controls:{pumpPct:0}}]}, {plan:[{atMinute:0,controls:{execute:'shell'}}]},
    {plan:[{atMinute:120,controls:{}}]}, {plan:[{atMinute:1.1,controls:{}}]},
    {plan:[{atMinute:1,controls:{}},{atMinute:0,controls:{}}]},
    {plan:[{atMinute:1,controls:{}},{atMinute:1,controls:{}}]},
    {plan:Array.from({length:51},(_,atMinute)=>({atMinute,controls:{}}))}])assert.throws(()=>M.evaluate(x));
});
test('time-step refinement converges on nominal and fault trajectories',()=>{
  for(const preset of ['winter','pump-fault']){
    const input={scenario:{preset,horizonMinutes:60}};
    const a=M.verifyStep(input,5),b=M.verifyStep(input,2),reference=M.verifyStep(input,1);
    const error=r=>Math.max(...r.trace.flatMap((row,i)=>['gpuC','coolantC','buildingC'].map(k=>Math.abs(row[k]-reference.trace[i][k]))));
    assert.ok(error(b)<error(a),`${preset} failed refinement`);assert.ok(error(a)<.5,`${preset} >0.5 C step error`);
  }
});
test('maximum horizon is bounded and produces finite results',()=>{
  const r=M.evaluate({scenario:{horizonMinutes:360,preset:'summer'}});
  assert.equal(r.candidate.trace.length,361);
  for(const v of Object.values(r.candidate.metrics))assert.ok(Number.isFinite(v));
});
test('v1.2 OpenAPI example runs against the unchanged v1.1 physical engine',()=>{
  const api=M.openapi(),op=api.paths['/api/v1/simulations/evaluate'].post;
  assert.equal(api.info.version,'1.2.0');assert.equal(M.VERSION,'1.1.0');assert.equal(api.openapi,'3.1.0');
  assert.equal(M.evaluate(op.requestBody.content['application/json'].example).mode,'simulation-only');
});
test('closed-loop episode reproduces the identical batch trajectory without restarting physics',()=>{
  const scenario={preset:'pump-fault',seed:7,horizonMinutes:65};
  const e=M.startEpisode({scenario});
  assert.equal(M.observeEpisode(e).minute,0);
  M.stepEpisode(e,{minutes:10,controls:{pumpPct:80}});
  M.stepEpisode(e,{minutes:22,controls:{fanPct:90}});
  const partial=M.episodeReport(e),prefix=structuredClone(partial.replayRequest);
  prefix.scenario.horizonMinutes=partial.minute;
  assert.deepEqual(partial.trace,M.evaluate(prefix).candidate.trace);
  M.stepEpisode(e,{minutes:1,controls:{heatRecoveryPct:95}});
  const final=M.stepEpisode(e,{minutes:32});
  assert.equal(final.done,true);assert.equal(final.minute,65);
  assert.equal(final.hardwareAuthorized,false);
  const report=M.episodeReport(e),batch=M.evaluate(report.replayRequest).candidate;
  assert.deepEqual(report.trace,batch.trace);
  assert.deepEqual(report.metrics,batch.metrics);
  assert.deepEqual(report.violations,batch.violations);
  assert.deepEqual(report.events,batch.events);
  assert.ok(report.maxEnergyResidualKJ<1e-5);
  assert.equal(report.replayRequest.plan.length,3);
  assert.deepEqual(report.replayRequest.scenario.initialState,scenario.initialState??{gpuC:55,coolantC:32,buildingC:21});
});
test('episode patches are incremental, deterministic and do not mutate observations',()=>{
  const e=M.startEpisode({scenario:{horizonMinutes:4}}),initial=M.observeEpisode(e);
  const action={minutes:2,controls:{pumpPct:80,fanPct:70}};
  const first=M.stepEpisode(e,action);
  assert.equal(first.controls.pumpPct,80);
  first.state.gpuC=-999;first.events.push({type:'injected'});
  assert.notEqual(M.observeEpisode(e).state.gpuC,-999);
  assert.equal(e.request.plan.length,1);
  M.stepEpisode(e,{minutes:1,controls:{pumpPct:80}}); // no-op patch does not count
  assert.equal(e.request.plan.length,1);
  assert.throws(()=>M.stepEpisode(e,{expectedMinute:0,minutes:1}),/Stale episode observation/);
  assert.equal(M.observeEpisode(e).minute,3);
  M.stepEpisode(e,{minutes:1});
  assert.equal(M.observeEpisode(e).done,true);
  assert.equal(initial.minute,0);assert.equal(action.controls.pumpPct,80);
  const duplicate=M.startEpisode({scenario:{horizonMinutes:4}});
  M.stepEpisode(duplicate,action);M.stepEpisode(duplicate,{minutes:1,controls:{pumpPct:80}});M.stepEpisode(duplicate,{minutes:1});
  assert.deepEqual(M.episodeReport(e),M.episodeReport(duplicate));
});
test('episode refuses invalid actions, post-horizon steps, and action overflow without advancing state',()=>{
  for(const x of [{plan:[]},{scenario:{horizonMinutes:361}},{schemaVersion:2},null])assert.throws(()=>M.startEpisode(x));
  const e=M.startEpisode({scenario:{horizonMinutes:60}});
  for(const x of [{minutes:0},{minutes:2.5},{minutes:61},{controls:{pumpPct:0}},
    {controls:{unknownControl:1}},{extra:1},null])assert.throws(()=>M.stepEpisode(e,x));
  assert.equal(M.observeEpisode(e).minute,0);
  for(let i=0;i<50;i++)M.stepEpisode(e,{controls:{pumpPct:i%2?70:80}});
  assert.equal(e.request.plan.length,50);
  assert.throws(()=>M.stepEpisode(e,{controls:{pumpPct:75}}),/50 control changes/);
  assert.equal(M.observeEpisode(e).minute,50);
  M.stepEpisode(e,{minutes:10});
  assert.throws(()=>M.stepEpisode(e),/minutes/);
  assert.equal(M.observeEpisode(e).minute,60);
});
test('checkpoint continuation matches batch physics across scenarios and many step partitions',()=>{
  const presets=['winter','summer','burst','pump-fault'];
  for(let seed=0;seed<12;seed++){
    const scenario={preset:presets[seed%4],seed,horizonMinutes:61},e=M.startEpisode({scenario});
    let elapsed=0;
    for(const duration of [1,7,2,14,3,20,14]){
      const controls=elapsed%2===0?{pumpPct:60+seed,fanPct:50+seed}:{heatRecoveryPct:70+seed};
      M.stepEpisode(e,{minutes:duration,controls});elapsed+=duration;
    }
    assert.equal(elapsed,61);
    const episode=M.episodeReport(e),reference=M.evaluate(episode.replayRequest).candidate;
    assert.deepEqual(episode.trace,reference.trace,scenario.preset+' trace');
    assert.deepEqual(episode.metrics,reference.metrics,scenario.preset+' metrics');
    assert.deepEqual(episode.violations,reference.violations,scenario.preset+' violations');
  }
});
