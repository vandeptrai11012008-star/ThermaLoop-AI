/* Bounded deterministic search over the synthetic ThermaLoop plant.
 * No LLM, telemetry, hardware I/O, external calls or claims of global optimality. */
(function (root, factory) {
  const model=typeof module==='object'&&module.exports
    ?require('./agent-sandbox-model.js'):root.ThermaAgentSandbox;
  const api=factory(model);
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ThermaAgentResearch=api;
})(globalThis,function (physics) {
  'use strict';
  const VERSION='1.3.0',MAX_TRIALS=30,MAX_HORIZON=120;
  const SCENARIO_FIELDS=['preset','seed','horizonMinutes','outsideC','loadFraction','occupants','solarKW','initialState'];
  function normalize(input={}) {
    if(!input||typeof input!=='object'||Array.isArray(input))throw new TypeError('Research request must be an object');
    for(const key of Object.keys(input))if(!['schemaVersion','scenario','trials'].includes(key))
      throw new RangeError('Unknown research request field: '+key);
    if(input.schemaVersion!==undefined&&input.schemaVersion!==1)throw new RangeError('Unsupported schemaVersion');
    const trials=input.trials??20;
    if(!Number.isInteger(trials)||trials<2||trials>MAX_TRIALS)throw new RangeError('trials must be an integer from 2 to 30');
    // Use the existing physical engine as the sole validator and source of defaults.
    const normalized=physics.normalize({schemaVersion:1,scenario:input.scenario??{},plan:[]});
    if(normalized.scenario.horizonMinutes>MAX_HORIZON)throw new RangeError('Research horizon is limited to 120 simulated minutes');
    const scenario=Object.fromEntries(SCENARIO_FIELDS.filter(k=>k in normalized.scenario)
      .map(k=>[k,structuredClone(normalized.scenario[k])]));
    return {schemaVersion:1,scenario,trials};
  }
  function halton(n,base) {
    let f=1,r=0;
    for(;n>0;n=Math.floor(n/base)){f/=base;r+=f*(n%base);}
    return r;
  }
  function candidatePlan(index,seed) {
    if(index===0)return [];
    // Fixed low-discrepancy exploration of pumps, fans, heat recovery and heating.
    // GPU power and occupied ventilation are not curtailed to game energy scores.
    const offset=(seed%199)+1,n=index+offset;
    const choose=(values,base)=>values[Math.min(values.length-1,Math.floor(halton(n,base)*values.length))];
    return [{atMinute:0,controls:{gpuPowerLimitPct:100,ventilationACH:0.6,
      pumpPct:choose([45,55,65,75,85,95,100],2),
      fanPct:choose([30,45,60,70,80,90,100],3),
      heatRecoveryPct:choose([45,65,80,95,100],5),
      heatingSetpointC:choose([19,19.5,20,20.5,21],7)}}];
  }
  const summary=(id,plan,result)=>({trial:id,plan,eligible:result.verdict.status==='within_tested_envelope',
    energySavedKWh:result.comparison.energySavedKWh,
    siteElectricKWh:result.candidate.metrics.siteElectricKWh,
    computeServiceRatio:result.comparison.computeServiceRatio,
    violations:result.candidate.violations.map(x=>x.code),verdict:result.verdict.status});
  function run(input={},options={}) {
    const config=normalize(input),rows=[];
    let best=null,bestReport=null;
    for(let i=0;i<config.trials;i++){
      if(options.shouldCancel?.())throw new Error('Research run cancelled');
      const plan=candidatePlan(i,config.scenario.seed);
      const report=physics.evaluate({schemaVersion:1,scenario:config.scenario,plan});
      const row=summary(i,plan,report);rows.push(row);
      if(row.eligible&&(!best||row.energySavedKWh>best.energySavedKWh+1e-10)){
        best=row;bestReport=report;
      }
      options.onProgress?.({completed:i+1,total:config.trials,latest:row,bestTrial:best?.trial??null});
    }
    const holdoutSeeds=[(config.scenario.seed+1973)>>>0,(config.scenario.seed+7919)>>>0];
    const holdouts=best?holdoutSeeds.map(seed=>{
      const scenario={...config.scenario,seed};
      const report=physics.evaluate({schemaVersion:1,scenario,plan:best.plan});
      return {seed,...summary(best.trial,best.plan,report)};
    }):[];
    const passedHoldouts=holdouts.length===2&&holdouts.every(x=>x.eligible);
    const positiveHoldoutSavings=passedHoldouts&&holdouts.every(x=>x.energySavedKWh>1e-9);
    return {version:VERSION,mode:'simulation-only',method:'bounded-deterministic-parameter-search',
      hardwareAuthorized:false,config,trialCount:rows.length,eligibleCount:rows.filter(x=>x.eligible).length,
      trials:rows,best,bestReport,holdouts,passedHoldouts,
      validatedImprovement:!!best&&best.energySavedKWh>1e-9&&positiveHoldoutSavings,
      limitations:['Synthetic, uncalibrated three-state thermal model; not a physical-facility validation.',
        'Search is a fixed deterministic sample of candidate controls, not an LLM, trained policy or global optimum.',
        'The winning plan is chosen on one seed. Two untouched holdout seeds are checked but not used for selection.',
        'Heat-recovery benefit and compute-service utilization are model proxies, not real-world guaranteed savings.',
        'No device connection or hardware command is available.']};
  }
  return {VERSION,MAX_TRIALS,MAX_HORIZON,normalize,candidatePlan,run};
});
