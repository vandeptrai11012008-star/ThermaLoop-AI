/* ThermaLoop Web Service v1.4 — stricter, bounded research on the unchanged
 * synthetic three-state physics engine. Browser and API use identical code. */
(function (root, factory) {
  const isNode=typeof module==='object'&&module.exports;
  const physics=isNode?require('../science/agent-sandbox-model.js'):root.ThermaAgentSandbox;
  const search=isNode?require('../science/agent-research-model.js'):root.ThermaAgentResearch;
  const api=factory(physics,search);
  if(isNode)module.exports=api;else root.ThermaValidatedResearch=api;
})(globalThis,function (physics,search) {
  'use strict';
  const VERSION='1.4.0';
  // Illustrative end-state comparison bands, not sensor accuracy or facility limits.
  const TOLERANCE_C=Object.freeze({gpuC:5,coolantC:5,buildingC:0.5});
  function terminalFairness(report) {
    const b=report.baseline.finalState,c=report.candidate.finalState;
    const deltaC=Object.fromEntries(Object.keys(TOLERANCE_C).map(k=>[k,c[k]-b[k]]));
    const capacities=report.candidate.parameters;
    const thermalCarryoverKWh={
      buildingHeatDeficit:Math.max(0,b.buildingC-c.buildingC)*capacities.buildingCapacityKJK/3600,
      gpuExtraHeat:Math.max(0,c.gpuC-b.gpuC)*capacities.gpuCapacityKJK/3600,
      coolantExtraHeat:Math.max(0,c.coolantC-b.coolantC)*capacities.coolantCapacityKJK/3600
    };
    return {passed:Object.keys(deltaC).every(k=>Math.abs(deltaC[k])<=TOLERANCE_C[k]+1e-9),
      deltaC,thermalCarryoverKWh,tolerancesC:{...TOLERANCE_C},
      explanation:'Terminal temperatures must stay within declared comparison bands. Heat carryover is reported, not converted into fictitious electric savings.'};
  }
  function evaluateCandidate(scenario,plan,trial) {
    const report=physics.evaluate({schemaVersion:1,scenario,plan});
    const terminal=terminalFairness(report);
    const physicalEnvelopePassed=report.verdict.status==='within_tested_envelope';
    return {report,row:{trial,plan,eligible:physicalEnvelopePassed&&terminal.passed,
      physicalEnvelopePassed,terminalEquivalent:terminal.passed,
      energySavedKWh:report.comparison.energySavedKWh,
      siteElectricKWh:report.candidate.metrics.siteElectricKWh,
      computeServiceRatio:report.comparison.computeServiceRatio,
      terminal,violations:[...report.candidate.violations.map(v=>v.code),
        ...(!terminal.passed?['terminal_state_mismatch']:[])]}};
  }
  function run(input={},options={}) {
    const config=search.normalize(input),trials=[];
    let best=null,bestReport=null;
    for(let trial=0;trial<config.trials;trial++){
      if(options.shouldCancel?.())throw new Error('Research cancelled');
      const plan=search.candidatePlan(trial,config.scenario.seed);
      const {report,row}=evaluateCandidate(config.scenario,plan,trial);
      trials.push(row);
      if(row.eligible&&(!best||row.energySavedKWh>best.energySavedKWh+1e-10)){
        best=row;bestReport=report;
      }
      options.onProgress?.({completed:trial+1,total:config.trials,bestTrial:best?.trial??null});
    }
    const holdoutSeeds=[(config.scenario.seed+1973)>>>0,(config.scenario.seed+7919)>>>0];
    const holdouts=best?holdoutSeeds.map(seed=>{
      const {row}=evaluateCandidate({...config.scenario,seed},best.plan,best.trial);
      return {seed,...row};
    }):[];
    const passedHoldouts=holdouts.length===2&&holdouts.every(x=>x.eligible);
    return {version:VERSION,engineVersion:physics.VERSION,mode:'simulation-only',
      method:'terminal-matched-bounded-parameter-search',hardwareAuthorized:false,
      config,trialCount:trials.length,eligibleCount:trials.filter(x=>x.eligible).length,
      trials,best,bestReport,holdouts,passedHoldouts,
      validatedImprovement:!!best&&best.energySavedKWh>1e-9&&passedHoldouts&&
        holdouts.every(x=>x.energySavedKWh>1e-9),
      limitations:[
        'Uncalibrated three-temperature synthetic model; this is not field validation.',
        'Terminal match is evaluated in the nominal plant; sensitivity variants are checked by the underlying physical envelope, not matched at terminal state.',
        'Temperature tolerances are declared illustrative heuristics; matching final temperatures is not proof of equal future energy.',
        'Two untouched seeds are replay checks, not independent data or statistical confidence.',
        'Fixed low-discrepancy parameter search is not an LLM, learned policy or global optimum.',
        'No live measurements, hardware commands or physical deployment authorization.']};
  }
  return {VERSION,TOLERANCE_C,terminalFairness,evaluateCandidate,run,normalize:search.normalize};
});
