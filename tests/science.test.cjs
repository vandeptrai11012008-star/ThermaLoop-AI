const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const M = require('../science/model.js');
const D = require('../science/data/evidence.json');
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, `${a} != ${b}`);

test('immutable small reference files match the verified upstream hashes', () => {
  for (const name of ['gpu-8b.json', 'gpu-70b.json', 'heat-pump.mo', 'greenhouse.json']) {
    const bytes = fs.readFileSync(path.join(__dirname, '../science/data', name));
    assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'), D.sources.find(s => s.id === name).sha256);
  }
});
test('import retains valid paired outcomes, exclusions, unique IDs and original indices', () => {
  const r = D.routing;
  assert.equal(r.originalCount, 1319); assert.equal(r.excludedCount, 12); assert.equal(r.records.length, 1307);
  assert.equal(new Set(r.records.map(x => x.id)).size, r.records.length);
  assert.ok(r.records.every(x => typeof x.weak === 'boolean' && typeof x.strong === 'boolean'));
  assert.ok(r.records.every((x, i) => !i || x.row > r.records[i - 1].row));
});
test('zero weak routing gives the identical baseline and zero paired interval', () => {
  const r = M.routing(D.routing, 0);
  assert.equal(r.baselineAccuracyPct, r.candidateAccuracyPct); assert.equal(r.weakCalls, 0);
  assert.equal(r.accuracyDeltaPP.low, 0); assert.equal(r.accuracyDeltaPP.high, 0);
});
test('all weak routing reproduces the supplied weak-model outcomes', () => {
  const r = M.routing(D.routing, 1);
  near(r.candidateAccuracyPct, D.routing.records.filter(x => x.weak).length / r.questions * 100);
  assert.equal(r.weakCalls, r.questions);
});
test('routing is reproducible, outcome blind, and never invents energy or latency', () => {
  const original = M.routing(D.routing, 0.5, 42), again = M.routing(D.routing, 0.5, 42);
  assert.deepEqual(original, again);
  const inverted = {records: D.routing.records.map(r => ({...r, weak: !r.weak, strong: !r.strong}))};
  assert.deepEqual(M.routing(inverted, 0.5, 42).rows.map(r => r.useWeak), original.rows.map(r => r.useWeak));
  assert.equal(original.energyJ, null); assert.equal(original.latencyMs, null);
  assert.ok(original.accuracyDeltaPP.low <= original.accuracyDeltaPP.mean);
  assert.ok(original.accuracyDeltaPP.mean <= original.accuracyDeltaPP.high);
});
test('packing allocates exact milli-GPUs and retains unschedulable requests', () => {
  const jobs = [600, 600, 400, 400, 1].map((gpuMilli, i) => ({id: i, gpuMilli}));
  for (const policy of ['first-fit', 'best-fit']) {
    const r = M.pack(jobs, 2, policy);
    assert.equal(r.admitted, 4); assert.equal(r.pending, 1); assert.equal(r.allocatedMilli, 2000);
    assert.equal(r.conservationResidualMilli, 0); assert.deepEqual(r.remaining, [0, 0]);
    assert.equal(r.rows.at(-1).slot, -1);
  }
});
test('real-trace packing preserves the input order and identical submitted work', () => {
  for (const policy of ['first-fit', 'best-fit']) {
    const r = M.pack(D.scheduling.records, 16, policy);
    assert.deepEqual(r.rows.map(x => x.id), D.scheduling.records.map(x => x.id));
    assert.equal(r.admitted + r.pending, 256); assert.ok(r.remaining.every(x => x >= 0));
  }
});
test('GPU projections match every preserved raw H100 measurement', () => {
  for (const row of D.gpu) {
    const raw = JSON.parse(fs.readFileSync(path.join(__dirname, '../science/data', row.source)));
    const source = raw.configurations.find(x => x.gpu_model === 'H100' && x.max_num_seqs === row.max_num_seqs);
    assert.equal(row.energy_per_token_joules, source.energy_per_token_joules);
    assert.equal(row.avg_power_watts, source.avg_power_watts);
    near(row.avg_power_watts / row.output_throughput_tokens_per_sec, row.energy_per_token_joules);
  }
});
test('candidate selection obeys ITL constraint and returns an actual measured point', () => {
  for (const model of new Set(D.gpu.map(x => x.model))) {
    const r = M.gpuExperiment(D.gpu, model, 8, 40, 1e6);
    assert.ok(r.candidate.p95_itl_ms <= 40);
    assert.ok(r.configurations.some(x => x.max_num_seqs === r.candidate.max_num_seqs));
    assert.ok(r.configurations.filter(x => x.p95_itl_ms <= 40).every(x => x.energy_per_token_joules >= r.candidate.energy_per_token_joules));
    near(r.baseline.fixedTokenEnergyKWh, 1e6 * r.baseline.energy_per_token_joules / 3.6e6);
    assert.equal(r.candidate.num_gpus, model.includes('70B') ? 4 : 1);
    assert.equal(r.candidate.measurementUncertainty, null);
  }
});
test('an infeasible ITL target stays infeasible rather than inventing a configuration', () => {
  const r = M.gpuExperiment(D.gpu, M.DEFAULTS.model, 8, 1);
  assert.equal(r.candidate, null); assert.equal(r.feasible, false); assert.equal(r.energySavedKWh, null);
  assert.equal(r.baselineMeetsLimit, false);
});
test('fixed-token energy and duration scale with the same workload in both arms', () => {
  const a = M.gpuExperiment(D.gpu, M.DEFAULTS.model, 8, 40, 1e6);
  const b = M.gpuExperiment(D.gpu, M.DEFAULTS.model, 8, 40, 2e6);
  for (const arm of ['baseline', 'candidate']) {
    near(2 * a[arm].fixedTokenEnergyKWh, b[arm].fixedTokenEnergyKWh);
    near(2 * a[arm].projectedSeconds, b[arm].projectedSeconds);
  }
});

function analyticalCase() {
  const d = structuredClone(D);
  d.gpu = [{model: M.DEFAULTS.model, max_num_seqs: 8, avg_power_watts: 1000}];
  d.greenhouseGeometry = {aFlr: {value: 100}, aCov: {value: 100}, hGh: {value: 1}};
  d.heatPump = {capacityW: 100000, electricW: 50000, massFlowKgS: 1, sourceC: 18, loadC: 53};
  d.weather = {winter: [{timeSeconds: 0, outsideC: 8, ghiWm2: 0}]};
  const p = {...M.DEFAULTS, replicas: 1, uValueWm2K: 10, airChangesPerHour: 0,
    setpointC: 18, captureFraction: 0.5, exchangerEffectiveness: 1, overheadFraction: 0, pumpKW: 0.2};
  return {d, p};
}
test('heat model agrees with an independent one-hour energy balance', () => {
  const {d, p} = analyticalCase(), r = M.thermal(d, p), h = r.rows[0];
  near(h.demandKW, 10); near(h.sourceKW, 0.5); near(h.hotKW, 1); near(h.hpElectricKW, 0.5);
  near(h.backupKW, 9); near(h.rejectedKW, 0.5);
  near(r.baselineKWh, 11); near(r.candidateKWh, 10.7); near(r.savedKWh, 0.3);
  near(h.waterDeltaK * d.heatPump.massFlowKgS * 4.18, h.hotKW);
});
test('zero heat capture cannot receive an electricity-saving credit', () => {
  const {d, p} = analyticalCase(), r = M.thermal(d, p, {captureFraction: 0});
  near(r.savedKWh, 0); near(r.usefulHeatKWh, 0); near(r.pumpKWh, 0);
  near(r.rows[0].rejectedKW, r.itKW);
});
test('no greenhouse demand switches off HP and secondary pump', () => {
  const {d, p} = analyticalCase(); d.weather.winter[0].outsideC = 25;
  const r = M.thermal(d, p);
  near(r.demandKWh, 0); near(r.hpElectricKWh, 0); near(r.pumpKWh, 0); near(r.savedKWh, 0);
});
test('efficient baseline heating can make heat recovery worse; negative outcomes remain visible', () => {
  const {d, p} = analyticalCase();
  assert.ok(M.thermal(d, p, {baselineHeatingCOP: 8}).savedKWh < 0);
});
test('both weather weeks preserve hourly bins and all three heat balances close', () => {
  for (const season of ['winter', 'summer']) {
    const r = M.thermal(D, {...M.DEFAULTS, season});
    assert.equal(r.rows.length, 168); assert.ok(r.maxConservationResidualKW < 1e-9);
    near(r.rows.reduce((s, x) => s + x.baselineKW, 0), r.baselineKWh);
    for (const h of r.rows) {
      near(h.hotKW + h.backupKW, h.demandKW);
      near(h.sourceKW + h.hpElectricKW, h.hotKW);
      near(h.sourceKW + h.rejectedKW, h.itKW);
      assert.ok(h.hotKW <= D.heatPump.capacityW / 1000 + 1e-9);
      assert.ok(h.sourceKW <= h.capturedKW + 1e-9);
      assert.ok(h.itKW >= 0 && h.backupKW >= 0 && h.rejectedKW >= 0);
    }
    assert.equal(r.measuredPredictionMAE, null);
  }
});
test('heat credits are not double counted against electricity', () => {
  const r = M.thermal(D, M.DEFAULTS);
  near(r.savedKWh, r.usefulHeatKWh - r.hpElectricKWh - r.pumpKWh, 1e-8);
});
test('27-point sensitivity is an assumption range, not statistical confidence', () => {
  const r = M.thermal(D, M.DEFAULTS), s = M.sensitivity(D, M.DEFAULTS);
  assert.equal(s.values.length, 27); assert.equal(s.isConfidenceInterval, false);
  assert.ok(s.lowKWh <= r.savedKWh && r.savedKWh <= s.highKWh);
});
test('invalid inputs fail clearly instead of returning NaN metrics', () => {
  assert.throws(() => M.routing(D.routing, NaN), RangeError);
  assert.throws(() => M.pack([], 0), RangeError);
  assert.throws(() => M.pack([{gpuMilli: 1001}], 2, 'first-fit'), RangeError);
  assert.throws(() => M.gpuExperiment(D.gpu, 'unknown'), RangeError);
  assert.throws(() => M.thermal(D, {...M.DEFAULTS, replicas: NaN}), RangeError);
  assert.throws(() => M.thermal(D, {...M.DEFAULTS, season: 'unknown'}), RangeError);
});
test('full export retains assumptions, provenance, unavailable measurements and paired traces', () => {
  const r = M.experiment(D), csv = M.csv(r);
  assert.ok(Object.values(r.checks).every(Boolean));
  assert.equal(r.routing.rows.length, 1307); assert.equal(r.thermal.rows.length, 168);
  assert.equal(r.sources.length, 8); assert.equal(r.thermal.measuredPredictionMAE, null);
  assert.ok(r.assumptions.every(x => x.unit && x.status));
  assert.ok(csv.includes('Uncalibrated scenario')); assert.ok(csv.includes(D.sources[0].sha256));
  assert.ok(csv.includes('Published-outcome replay')); assert.ok(csv.includes('baselineHeatingCOP'));
});
test('all original inline programs, file hashes, and external links are preserved', () => {
  const contract = require('./legacy-contract.json');
  const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(x =>
    crypto.createHash('sha256').update(x[1]).digest('hex'));
  assert.deepEqual(scripts, contract.inlineScriptSHA256);
  for (const [name, hash] of Object.entries(contract.unchangedFiles)) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname, '..', name))).digest('hex'), hash);
  }
  for (const href of contract.externalLinks) assert.ok(html.includes(`href="${href}"`));
});
