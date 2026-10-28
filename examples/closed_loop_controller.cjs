#!/usr/bin/env node
'use strict';
// A transparent, deterministic example controller. Replace chooseControls with
// an AI policy if desired. This code never contacts hardware or an LLM.
const engine=require('../science/agent-sandbox-model.js');

function chooseControls(observation) {
  const {gpuC,coolantC,buildingC}=observation.state;
  return {
    pumpPct:gpuC>75?100:gpuC>65?85:70,
    fanPct:coolantC>44?100:coolantC>38?90:70,
    heatRecoveryPct:buildingC<20.8?95:50,
    ventilationACH:0.6
  };
}

function run({preset='winter',seed=42,horizonMinutes=60}={}) {
  const episode=engine.startEpisode({scenario:{preset,seed,horizonMinutes}});
  while(!engine.observeEpisode(episode).done){
    const observation=engine.observeEpisode(episode);
    engine.stepEpisode(episode,{minutes:1,controls:chooseControls(observation)});
  }
  const report=engine.episodeReport(episode);
  const comparison=engine.evaluate(report.replayRequest);
  return {engineVersion:report.engineVersion,simulatedMinutes:report.minute,
    actions:report.replayRequest.plan.length,
    finalState:report.state,energyKWh:report.metrics.siteElectricKWh,
    baselineEnergyKWh:comparison.baseline.metrics.siteElectricKWh,
    computeServiceRatio:comparison.comparison.computeServiceRatio,
    violations:report.violations,pairedVerdict:comparison.verdict,
    hardwareAuthorized:false,notice:'Illustrative rule-based policy and uncalibrated plant; not an optimal/safe real controller.'};
}

if(require.main===module)process.stdout.write(JSON.stringify(run(),null,2)+'\n');
module.exports={chooseControls,run};
