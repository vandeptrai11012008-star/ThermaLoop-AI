/* Shared reproducible benchmark for Node and the Web Service's browser worker.
 * All simulations run using ThermaUnifiedPhysics; no server secrets or hardware. */
(function(root,factory){
  const engine=typeof module==='object'&&module.exports?require('./unified-physics.js'):root.ThermaUnifiedPhysics;
  const api=factory(engine);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ThermaUnifiedBenchmark=api;
})(globalThis,function(physics){
  'use strict';
  if(!physics)throw new Error('Unified physics solver is required');
const DEFAULT_SEEDS=Object.freeze([3,11,17,29,47]);
const CASES=Object.freeze([
  {id:'winter_nominal',preset:'winter'},
  {id:'winter_cold',preset:'winter',outsideC:-8},
  {id:'winter_crowded',preset:'winter',occupants:120},
  {id:'summer_nominal',preset:'summer'},
  {id:'summer_hot',preset:'summer',outsideC:42},
  {id:'summer_mild',preset:'summer',outsideC:23},
  {id:'burst_nominal',preset:'burst'},
  {id:'burst_hot',preset:'burst',outsideC:25},
  {id:'pump_fault',preset:'pump-fault'},
  {id:'pump_fault_cold',preset:'pump-fault',outsideC:-2}
]);
const POLICIES=Object.freeze(['fixed','threshold','trend']);
const BASE=Object.freeze({...physics.BASE_CONTROLS});

function observation(world){
  const h=world.last??{};
  return Object.freeze({
    minute:world.minute,
    gpuC:world.state.gpuC,coolantC:world.state.coolantC,buildingC:world.state.buildingC,
    pumpPct:world.controls.pumpPct,fanPct:world.controls.fanPct,
    recoveryPct:world.controls.recoveryPct,heatingSetpointC:world.controls.heatingSetpointC,
    gpuLoadPct:world.controls.gpuLoadPct,
    flowLps:h.flowLps??null,outsideC:h.outsideC??null
  });
}

function policy(name,now,previous=null){
  if(!POLICIES.includes(name))throw new RangeError('Unknown policy');
  if(name==='fixed')return {...BASE};
  const forecast=(key)=>now[key]+(previous?Math.max(-4,Math.min(4,now[key]-previous[key]))*5:0);
  const g=name==='trend'?forecast('gpuC'):now.gpuC;
  const c=name==='trend'?forecast('coolantC'):now.coolantC;
  // Deliberately simple public-sensor controllers, not learned AI or MPC.
  if(g>82||c>47)return {...BASE,pumpPct:100,fanPct:100,gpuLoadPct:50};
  if(g>74||c>41)return {...BASE,pumpPct:90,fanPct:90,gpuLoadPct:70};
  return {...BASE};
}

function runEpisode(config,policyName,{horizonMinutes=60}={}){
  if(!POLICIES.includes(policyName))throw new RangeError('Unknown policy');
  if(!Number.isInteger(horizonMinutes)||horizonMinutes<1||horizonMinutes>120)
    throw new RangeError('horizonMinutes must be an integer in [1,120]');
  const {id,seed,...scenarioFields}=config;
  if(typeof id!=='string'||!Number.isInteger(seed))throw new TypeError('Missing case id or seed');
  const scenario={...scenarioFields,seed,horizonMinutes};
  let world=physics.createWorld({scenario,controls:BASE});
  const initial={...world.state};let previous=null;
  for(let minute=0;minute<horizonMinutes;minute++){
    const now=observation(world),controls=policy(policyName,now,previous);
    world=physics.advance(world,{expectedMinute:minute,minutes:1,controls});
    previous=now;
  }
  const r=physics.report(world);
  return {
    caseId:id,seed,policy:policyName,horizonMinutes,initial,
    siteElectricKWh:r.metrics.siteElectricKWh,
    gpuElectricKWh:r.metrics.gpuElectricKWh,
    pumpElectricKWh:r.metrics.pumpElectricKWh,
    recoveredHeatKWh:r.metrics.recoveredHeatKWh,
    computeServiceHours:r.metrics.computeServiceHours,
    throttledMinutes:r.metrics.throttledMinutes,
    maxGpuC:Math.max(...r.trace.map(p=>p.gpuC)),
    maxCoolantC:Math.max(...r.trace.map(p=>p.coolantC)),
    maxBuildingC:Math.max(...r.trace.map(p=>p.buildingC)),
    minBuildingC:Math.min(...r.trace.map(p=>p.buildingC)),
    violationCodes:r.violations.map(v=>v.code).sort(),
    energyResidualKJ:r.energyResidualKJ,
    maxPressureResidualPa:r.maxPressureResidualPa
  };
}

const sum=(rows,key)=>rows.reduce((v,r)=>v+r[key],0);
const mean=(rows,key)=>sum(rows,key)/rows.length;
function summarize(rows){
  const out={};
  for(const name of POLICIES){
    const selected=rows.filter(r=>r.policy===name);
    out[name]={
      episodes:selected.length,
      meanSiteElectricKWh:mean(selected,'siteElectricKWh'),
      meanComputeServiceHours:mean(selected,'computeServiceHours'),
      meanRecoveredHeatKWh:mean(selected,'recoveredHeatKWh'),
      meanMaxGpuC:mean(selected,'maxGpuC'),
      episodesWithViolations:selected.filter(r=>r.violationCodes.length>0).length,
      peakAbsoluteEnergyResidualKJ:Math.max(...selected.map(r=>r.energyResidualKJ)),
      peakAbsolutePressureResidualPa:Math.max(...selected.map(r=>r.maxPressureResidualPa))
    };
  }
  return out;
}

// Bootstrap over scenarios (not individual seeds) so seeds of one scenario
// are not misleadingly treated as independent physical experiments.
function ciByScenario(rows,comparison,field){
  const ids=[...new Set(rows.map(r=>r.caseId))];
  const deltas=ids.map(id=>{
    const selected=rows.filter(r=>r.caseId===id);
    return mean(selected.filter(r=>r.policy===comparison),field)-
      mean(selected.filter(r=>r.policy==='fixed'),field);
  });
  let state=0x59cafe21;
  function random(){state^=state<<13;state^=state>>>17;state^=state<<5;return (state>>>0)/4294967296;}
  const samples=[];
  for(let b=0;b<1000;b++){
    let total=0;for(let i=0;i<deltas.length;i++)total+=deltas[Math.floor(random()*deltas.length)];
    samples.push(total/deltas.length);
  }
  samples.sort((a,b)=>a-b);
  return {meanDelta:deltas.reduce((a,b)=>a+b,0)/deltas.length,
    bootstrap95Pct:[samples[24],samples[974]],unit:field};
}

function benchmark({cases=CASES,seeds=DEFAULT_SEEDS,horizonMinutes=60,onProgress=null}={}){
  if(!Array.isArray(cases)||cases.length<1||cases.length>20||
     !Array.isArray(seeds)||seeds.length<1||seeds.length>10)
    throw new RangeError('Bounded cases (1–20) and seeds (1–10) required');
  if(onProgress!==null&&typeof onProgress!=='function')throw new TypeError('onProgress must be a function');
  if(new Set(cases.map(c=>c.id)).size!==cases.length||new Set(seeds).size!==seeds.length)
    throw new RangeError('Case IDs and seeds must be unique');
  const episodes=[],total=cases.length*seeds.length*POLICIES.length;
  for(const c of cases)for(const seed of seeds)for(const name of POLICIES){
    episodes.push(runEpisode({...c,seed},name,{horizonMinutes}));
    if(onProgress)onProgress({done:episodes.length,total});
  }
  const paired={};
  for(const name of POLICIES.filter(n=>n!=='fixed')){
    paired[name]={};
    for(const field of ['siteElectricKWh','computeServiceHours','recoveredHeatKWh','maxGpuC'])
      paired[name][field]=ciByScenario(episodes,name,field);
  }
  return {schemaVersion:1,engineVersion:physics.VERSION,
    validity:'Synthetic software benchmark; neither experimental validation nor demonstrated AI/ML performance.',
    policies:{fixed:'Fixed nominal controls',threshold:'Current-temperature threshold controller',
      trend:'Five-minute linear extrapolation from previous observed temperatures'},
    observationFields:Object.keys(observation(physics.createWorld())),
    cases,seedValues:seeds,horizonMinutes,episodeCount:episodes.length,
    summary:summarize(episodes),paired,episodes};
}

  return {DEFAULT_SEEDS,CASES,POLICIES,BASE,observation,policy,runEpisode,summarize,
  ciByScenario,benchmark};
});
