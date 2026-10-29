'use strict';
const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm'),fs=require('node:fs'),path=require('node:path');
const B=require('../scripts/benchmark_unified_physics.cjs');
const shared=require('../service/unified-benchmark.js');

const tiny=()=>B.benchmark({cases:B.CASES.slice(0,2),seeds:[3,11],horizonMinutes:10});

test('browser and CLI use exactly the same benchmark implementation',()=>{
  assert.strictEqual(B,shared);
  const events=[];
  const report=B.benchmark({cases:B.CASES.slice(0,1),seeds:[3],horizonMinutes:3,
    onProgress:e=>events.push(e.done)});
  assert.equal(report.episodeCount,3);assert.deepEqual(events,[1,2,3]);
});

test('browser worker loads shared UMD solver and runs a real 30-episode comparison',()=>{
  const messages=[],context={postMessage:m=>messages.push(m)};
  context.self=context;vm.createContext(context);
  context.importScripts=(...urls)=>{
    for(const url of urls){
      assert.match(url,/^\/service\/[a-z-]+\.js$/);
      const source=fs.readFileSync(path.join(__dirname,'..',url),'utf8');
      vm.runInContext(source,context,{filename:url});
    }
  };
  vm.runInContext(fs.readFileSync(path.join(__dirname,'../service/unified-benchmark-worker.js'),'utf8'),
    context,{filename:'unified-benchmark-worker.js'});
  context.onmessage({data:{type:'run',mode:'quick'}});
  const done=messages.find(m=>m.type==='result');
  assert.ok(done);assert.equal(done.result.episodeCount,30);
  assert.equal(done.result.summary.fixed.episodes,10);
  assert.ok(messages.some(m=>m.type==='progress'&&m.done===30));
  const node=B.benchmark({seeds:[B.DEFAULT_SEEDS[0]]});
  assert.equal(JSON.stringify(done.result.summary),JSON.stringify(node.summary));
  context.onmessage({data:{type:'run',mode:'unbounded'}});
  assert.equal(messages.at(-1).type,'error');
});

test('benchmark is deterministic and pairs three controllers on identical seeds and start',()=>{
  const a=tiny(),b=tiny();assert.deepEqual(a,b);assert.equal(a.episodeCount,12);
  for(const c of a.cases)for(const seed of a.seedValues){
    const runs=a.episodes.filter(r=>r.caseId===c.id&&r.seed===seed);
    assert.deepEqual(runs.map(r=>r.policy),B.POLICIES);
    assert.deepEqual(runs[0].initial,runs[1].initial);
    assert.deepEqual(runs[0].initial,runs[2].initial);
  }
});

test('policies are bounded, have sensor-only observations and do not alter input',()=>{
  const obs=Object.freeze({minute:42,gpuC:85,coolantC:48,buildingC:22,
    pumpPct:75,fanPct:70,recoveryPct:75,heatingSetpointC:21,gpuLoadPct:80,
    flowLps:2,outsideC:12});
  assert.deepEqual(Object.keys(B.observation(require('../service/unified-physics.js').createWorld())).sort(),
    Object.keys(obs).sort());
  for(const p of B.POLICIES){
    const controls=B.policy(p,obs);assert.ok(controls.gpuLoadPct>=0&&controls.gpuLoadPct<=100);
    assert.ok(controls.pumpPct>=0&&controls.pumpPct<=100);
  }
  assert.equal(obs.gpuLoadPct,80);
  assert.throws(()=>B.policy('learned_AI',obs),/Unknown policy/);
});

test('benchmark publishes physical residuals, violations and compute-service tradeoffs',()=>{
  const a=tiny();
  for(const ep of a.episodes){
    assert.equal(ep.horizonMinutes,10);assert.ok(Number.isFinite(ep.siteElectricKWh));
    assert.ok(ep.siteElectricKWh>0);assert.ok(ep.computeServiceHours>=0);
    assert.ok(ep.energyResidualKJ<.001,`energy residual ${ep.energyResidualKJ}`);
    assert.ok(ep.maxPressureResidualPa<.001,`pressure residual ${ep.maxPressureResidualPa}`);
    assert.ok(Array.isArray(ep.violationCodes));
  }
  assert.equal(a.summary.fixed.episodes,4);
  assert.match(a.validity,/neither experimental validation/);
  assert.ok(a.paired.threshold.siteElectricKWh.bootstrap95Pct.length===2);
});

test('benchmark rejects invalid or duplicate experimental sets',()=>{
  assert.throws(()=>B.benchmark({cases:[],seeds:[3]}),/Bounded cases/);
  assert.throws(()=>B.benchmark({cases:[B.CASES[0],B.CASES[0]],seeds:[3]}),/unique/);
  assert.throws(()=>B.runEpisode({...B.CASES[0],seed:3},'fixed',{horizonMinutes:121}),/horizonMinutes/);
});
