#!/usr/bin/env node
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const M = require('../science/model.js');
const D = require('../science/data/evidence.json');
const args = process.argv.slice(2);
if (args.length && (args[0] !== '--output' || args.length !== 2)) {
  console.error('Usage: node scripts/run_experiments.cjs [--output DIRECTORY]'); process.exit(2);
}
const output = path.resolve(args[1] || '/tmp/thermaloop-experiment');
const r = M.experiment(D);
const summary = {engineVersion: r.engineVersion, claim: r.claim,
  parameters: r.parameters, checks: r.checks,
  routing: {questions: r.routing.questions, baselineAccuracyPct: r.routing.baselineAccuracyPct,
    candidateAccuracyPct: r.routing.candidateAccuracyPct, deltaPP: r.routing.accuracyDeltaPP,
    energyJ: null, latencyMs: null, policy: r.routing.policy},
  scheduling: Object.fromEntries(['baseline', 'candidate'].map(arm => [arm,
    Object.fromEntries(['policy', 'submitted', 'admitted', 'pending', 'allocatedMilli'].map(k => [k, r.scheduling[arm][k]]))])),
  gpu: {kind: r.gpu.kind, baselineBatch: r.gpu.baselineBatch, candidateBatch: r.gpu.candidate?.max_num_seqs,
    baselineFixedTokenKWh: r.gpu.baseline.fixedTokenEnergyKWh, candidateFixedTokenKWh: r.gpu.candidate?.fixedTokenEnergyKWh,
    uncertainty: null, limitation: r.gpu.limitation},
  thermal: Object.fromEntries(['kind', 'period', 'hours', 'itKW', 'cop', 'baselineKWh', 'candidateKWh',
    'savedKWh', 'demandKWh', 'usefulHeatKWh', 'hpElectricKWh', 'pumpKWh', 'maxConservationResidualKW',
    'measuredPredictionMAE', 'limitation'].map(k => [k, r.thermal[k]])),
  sensitivity: {method: r.thermalSensitivity.method, isConfidenceInterval: false,
    lowKWh: r.thermalSensitivity.lowKWh, highKWh: r.thermalSensitivity.highKWh}, sources: r.sources};
fs.mkdirSync(output, {recursive: true});
fs.writeFileSync(path.join(output, 'experiment.json'), JSON.stringify(r, null, 2) + '\n');
fs.writeFileSync(path.join(output, 'kpis.csv'), M.csv(r) + '\r\n');
fs.writeFileSync(path.join(output, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({output, checks: r.checks, routingAccuracyDeltaPP: summary.routing.deltaPP.mean,
  gpuKWh: [summary.gpu.baselineFixedTokenKWh, summary.gpu.candidateFixedTokenKWh],
  heatScenarioKWh: [r.thermal.baselineKWh, r.thermal.candidateKWh]}, null, 2));
if (!Object.values(r.checks).every(Boolean)) process.exitCode = 1;
