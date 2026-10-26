const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const M=require('../science/workload-model.js'),D=require('../science/workloads/data.json');
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-7,`${a} != ${b}`);

test('held-out router decisions remain identical after test outcome inversion',()=>{
  const a=M.routing(D,.4),changed=structuredClone(D);
  for(const r of changed.routing.testRecords){r.strong=!r.strong;r.weak=!r.weak;}
  const b=M.routing(changed,.4);
  assert.deepEqual(a.rows.map(r=>r.useWeak),b.rows.map(r=>r.useWeak));
  assert.deepEqual(a.rows.map(r=>r.randomUseWeak),b.rows.map(r=>r.randomUseWeak));
  assert.notDeepEqual(a.accuraciesPct,b.accuraciesPct);
});
test('random controls match the learned weak-call budget at every declared operating point',()=>{
  for(const share of D.protocol.weakShares){const r=M.routing(D,share);assert.equal(r.rows.filter(x=>x.randomUseWeak).length,r.weakCalls);assert.equal(r.weakCalls+r.strongCalls,262);assert.equal(r.energyJ,null);assert.equal(r.latencyMs,null);assert.equal(r.randomSeedVariation.count,20);near(r.accuraciesPct.randomExpected,r.realizedWeakShare*r.accuraciesPct.weak+(1-r.realizedWeakShare)*r.accuraciesPct.strong);}
});
test('no difference yields a zero paired interval and score ties have an explicit policy',()=>{
  const d=structuredClone(D);d.routing.testRecords=d.routing.testRecords.slice(0,12).map(r=>({...r,score:0,strong:true,weak:true}));d.routing.thresholds=d.routing.thresholds.map(t=>({...t,threshold:0}));
  const r=M.routing(d,.4);assert.equal(r.weakCalls,12);assert.equal(r.learnedMinusStrong.lowPP,0);assert.equal(r.learnedMinusStrong.highPP,0);assert.equal(r.learnedMinusRandom.meanPP,0);
});
test('reservation queue has independently calculable head-of-line blocking and backfill',()=>{
  const jobs=[{id:'a',creationSeconds:0,gpuMilli:600,reservationSeconds:10},{id:'b',creationSeconds:1,gpuMilli:1000,reservationSeconds:1},{id:'c',creationSeconds:2,gpuMilli:400,reservationSeconds:1}];
  const fifo=M.schedule(jobs,1,1,'fifo_first'),backfill=M.schedule(jobs,1,1,'backfill_first');
  assert.deepEqual(fifo.jobs.map(j=>j.startSeconds),[0,10,11]);
  assert.deepEqual(backfill.jobs.map(j=>j.startSeconds),[0,10,2]);
  near(fifo.meanWaitSeconds,6);near(backfill.meanWaitSeconds,3);near(fifo.requestedGpuSeconds,7.4);near(backfill.requestedGpuSeconds,7.4);
  assert.equal(fifo.makespanSeconds,12);assert.equal(backfill.makespanSeconds,11);
});
test('release-before-arrival and finite fractional reservations preserve capacity',()=>{
  const jobs=[{id:'a',creationSeconds:0,gpuMilli:1000,reservationSeconds:2},{id:'b',creationSeconds:2,gpuMilli:500,reservationSeconds:1},{id:'c',creationSeconds:2,gpuMilli:500,reservationSeconds:1}];
  for(const policy of D.protocol.schedulerPolicies){const r=M.schedule(jobs,1,1,policy);assert.ok(Object.values(r.checks).every(Boolean));assert.equal(r.meanWaitSeconds,0);near(r.meanReservedCapacityPct,100);assert.equal(r.jobs.length,3);}
});
test('placement uses only current capacities and requests, without durations or outcomes',()=>{
  assert.equal(M.selectSlot([500,400],400,'first'),0);assert.equal(M.selectSlot([500,400],400,'best'),1);assert.equal(M.selectSlot([100,200],300,'best'),-1);
});
test('scheduler input permutation, clock origin and future arrivals do not change earlier decisions',()=>{
  const jobs=[{id:'a',creationSeconds:3,gpuMilli:600,reservationSeconds:10},{id:'b',creationSeconds:4,gpuMilli:1000,reservationSeconds:1},{id:'c',creationSeconds:5,gpuMilli:400,reservationSeconds:1}];
  const a=M.schedule(jobs,1,1,'backfill_best');
  assert.deepEqual(M.schedule([...jobs].reverse(),1,1,'backfill_best'),a);
  assert.deepEqual(M.schedule(jobs.map(r=>({...r,creationSeconds:r.creationSeconds+1000})),1,1,'backfill_best'),a);
  const b=M.schedule([...jobs,{id:'future',creationSeconds:103,gpuMilli:1000,reservationSeconds:10}],1,1,'backfill_best');
  assert.deepEqual(b.jobs.filter(j=>j.id!=='future'),a.jobs);
});
test('invalid scheduler inputs fail explicitly and cannot enter a stalled event loop',()=>{
  const job={id:'a',creationSeconds:0,gpuMilli:1000,reservationSeconds:1};
  for(const records of [[],[job,job],[{...job,gpuMilli:1001}],[{...job,reservationSeconds:0}],[{...job,creationSeconds:NaN}],[{...job,reservationSeconds:Infinity}]])assert.throws(()=>M.schedule(records,1,1,'fifo_first'));
  for(const slots of [0,1.5,Infinity])assert.throws(()=>M.schedule([job],slots,1,'fifo_first'));
  for(const scale of [0,-1,Infinity])assert.throws(()=>M.schedule([job],1,scale,'fifo_first'));
  assert.throws(()=>M.schedule([job],1,1,'invented'));
  assert.throws(()=>M.experiment(D,{weakShare:.3}));
});
test('real trace release accounting retains source failures and all four policy combinations',()=>{
  const results=M.experiment(D);
  assert.equal(results.scheduling.length,4);
  for(const s of results.scheduling){assert.equal(s.reservations,1991);assert.equal(s.released,1991);assert.equal(s.jobs.filter(r=>r.sourcePhase==='Failed').length,1813);assert.ok(Object.values(s.checks).every(Boolean));near(s.requestedGpuSeconds,results.scheduling[0].requestedGpuSeconds);}
  assert.ok(results.scheduling.every(s=>s.meanWaitSeconds===0),'The default trace window has no waiting; do not invent an improvement');
});
test('compressed-arrival stress cases preserve work and expose a worse tail rather than hiding it',()=>{
  const a=M.schedule(D.scheduling.records,16,.1,'fifo_first'),b=M.schedule(D.scheduling.records,16,.1,'backfill_best');
  near(a.requestedGpuSeconds,b.requestedGpuSeconds);assert.ok(b.meanWaitSeconds<a.meanWaitSeconds);assert.ok(b.maxWaitSeconds>a.maxWaitSeconds);
});
test('per-job intervals independently reproduce requested resource-time without overlapping capacity',()=>{
  const s=M.schedule(D.scheduling.records,8,.1,'backfill_best');
  let integral=0;
  for(let i=0;i<s.timeline.length-1;i++)integral+=s.timeline[i].reservedMilli/1000*(s.timeline[i+1].timeSeconds-s.timeline[i].timeSeconds);
  assert.ok(Math.abs(integral-s.requestedGpuSeconds)<1e-5);
  for(let slot=0;slot<8;slot++){
    const events=s.jobs.filter(j=>j.slot===slot).flatMap(j=>[{t:j.startSeconds,delta:j.gpuMilli},{t:j.releaseSeconds,delta:-j.gpuMilli}]).sort((a,b)=>a.t-b.t||a.delta-b.delta);
    let occupied=0;for(const e of events){occupied+=e.delta;assert.ok(occupied>=0&&occupied<=1000);}assert.equal(occupied,0);
  }
});
test('source fingerprints and browser input bytes match the active protocol',()=>{
  const root=path.join(__dirname,'..'),hash=b=>crypto.createHash('sha256').update(b).digest('hex');
  for(const [name,expected]of Object.entries(D.sourceHashes))assert.equal(hash(fs.readFileSync(path.join(root,name))),expected,name);
  const context={};vm.runInNewContext(fs.readFileSync(path.join(root,'science/workload-data.js'),'utf8'),context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.ThermaWorkloadData)),D);
  assert.equal(context.ThermaWorkloadBuild.inputSHA256,hash(fs.readFileSync(path.join(root,'science/workloads/data.json'))));
});
