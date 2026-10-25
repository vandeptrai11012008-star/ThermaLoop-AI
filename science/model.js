/* Evidence experiments: pure functions shared by the offline UI and Node tests. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ThermaScience = api;
})(globalThis, function () {
  'use strict';
  const VERSION = '1.0.0';
  const mean = xs => xs.reduce((a, b) => a + b, 0) / xs.length;
  function bounded(value, name, low, high) {
    if (!Number.isFinite(value) || value < low || value > high) {
      throw new RangeError(`${name} must be between ${low} and ${high}`);
    }
    return value;
  }
  function random(seed) {
    let a = seed >>> 0;
    return () => {
      a += 0x6D2B79F5;
      let t = Math.imul(a ^ a >>> 15, a | 1);
      t ^= t + Math.imul(t ^ t >>> 7, t | 61);
      return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
  }
  function pairedBootstrap(differences, seed = 821, repeats = 1000) {
    if (!differences.length) throw new RangeError('No paired observations');
    const r = random(seed), estimates = [];
    for (let b = 0; b < repeats; b++) {
      let sum = 0;
      for (let i = 0; i < differences.length; i++) sum += differences[Math.floor(r() * differences.length)];
      estimates.push(sum / differences.length);
    }
    estimates.sort((a, b) => a - b);
    return {mean: mean(differences), low: estimates[24], high: estimates[974],
      repeats, method: 'Paired percentile bootstrap over benchmark questions; 95%; fixed routing decisions',
      scope: 'Question-sampling variability only; excludes router-seed variability, judge error, and deployment shift'};
  }

  function routing(data, weakShare = 0.5, seed = 521143) {
    bounded(weakShare, 'Weak-model share', 0, 1);
    const r = random(seed), rows = data.records.map(row => {
      // Decision uses only the seeded stream, never either model's outcome.
      const useWeak = r() < weakShare;
      return {id: row.id, row: row.row, useWeak, baselineCorrect: Number(row.strong),
        candidateCorrect: Number(useWeak ? row.weak : row.strong)};
    });
    if (!rows.length) throw new RangeError('No routing records');
    const n = rows.length;
    return {kind: 'Published-outcome replay, not new inference', policy: 'Seeded random-routing control; no trained RouteLLM router',
      seed, requestedWeakShare: weakShare, questions: n, weakCalls: rows.filter(r => r.useWeak).length,
      baselineAccuracyPct: 100 * mean(rows.map(r => r.baselineCorrect)),
      candidateAccuracyPct: 100 * mean(rows.map(r => r.candidateCorrect)),
      accuracyDeltaPP: pairedBootstrap(rows.map(r => 100 * (r.candidateCorrect - r.baselineCorrect))),
      energyJ: null, latencyMs: null, rows,
      limitation: 'No API cost, GPU energy, or latency is inferred for GPT-4/Mixtral from the separate Llama/H100 dataset.'};
  }

  function pack(requests, capacity, policy) {
    if (!Number.isInteger(capacity) || capacity < 1 || capacity > 64) throw new RangeError('GPU count must be an integer 1–64');
    if (!['first-fit', 'best-fit'].includes(policy)) throw new RangeError('Unknown placement policy');
    const remaining = Array(capacity).fill(1000), rows = [];
    for (const row of requests) {
      bounded(row.gpuMilli, 'GPU request (mGPU)', 1, 1000);
      let slot = -1;
      for (let i = 0; i < remaining.length; i++) {
        if (remaining[i] < row.gpuMilli) continue;
        if (slot < 0 || (policy === 'best-fit' && remaining[i] < remaining[slot])) slot = i;
        if (policy === 'first-fit') break;
      }
      if (slot >= 0) remaining[slot] -= row.gpuMilli;
      rows.push({...row, slot, admitted: slot >= 0});
    }
    const admitted = rows.filter(r => r.admitted).length;
    const allocatedMilli = capacity * 1000 - remaining.reduce((a, b) => a + b, 0);
    return {policy, submitted: rows.length, admitted, pending: rows.length - admitted,
      allocatedMilli, remaining, allocationPct: 100 * allocatedMilli / (capacity * 1000), rows,
      conservationResidualMilli: capacity * 1000 - allocatedMilli - remaining.reduce((a, b) => a + b, 0)};
  }

  function gpuExperiment(records, model, baselineBatch = 8, itlLimitMs = 40, outputTokens = 1e6) {
    bounded(itlLimitMs, 'P95 ITL limit', 1, 1000);
    bounded(outputTokens, 'Fixed output-token budget', 1, 1e10);
    const configs = records.filter(r => r.model === model);
    const baseline = configs.find(r => r.max_num_seqs === baselineBatch);
    if (!baseline) throw new RangeError('No measured baseline for this model/batch');
    const feasible = configs.filter(r => r.p95_itl_ms <= itlLimitMs);
    // Select a measured configuration; never interpolate or fabricate GPU samples.
    const selected = feasible.slice().sort((a, b) => a.energy_per_token_joules - b.energy_per_token_joules
      || a.max_num_seqs - b.max_num_seqs)[0];
    const project = record => record ? ({...record,
      fixedTokenEnergyKWh: outputTokens * record.energy_per_token_joules / 3.6e6,
      projectedSeconds: outputTokens / record.output_throughput_tokens_per_sec,
      identityRelativeError: Math.abs(record.avg_power_watts / record.output_throughput_tokens_per_sec
        - record.energy_per_token_joules) / record.energy_per_token_joules,
      measurementUncertainty: null}) : null;
    const b = project(baseline), a = project(selected);
    return {kind: 'In-sample selection from published GPU measurements; fixed-token projection',
      model, baselineBatch, itlLimitMs, outputTokens, configurations: configs, baseline: b, candidate: a,
      feasible: Boolean(a), baselineMeetsLimit: baseline.p95_itl_ms <= itlLimitMs,
      energySavedKWh: a ? b.fixedTokenEnergyKWh - a.fixedTokenEnergyKWh : null,
      limitation: 'ITL is inter-token latency, not request latency or TTFT. No queueing, cold-start, CPU, network, cooling, idle-fleet energy, or quality guarantee. Output lengths vary. Selecting and reporting on the same runs is optimistic; no held-out validation or replicate error bars.'};
  }

  const DEFAULTS = Object.freeze({weakShare: 0.5, seed: 521143, gpuCount: 16,
    model: 'meta-llama/Llama-3.1-8B-Instruct', baselineBatch: 8, itlLimitMs: 40, outputTokens: 1e6,
    season: 'winter', replicas: 64, uValueWm2K: 6, airChangesPerHour: 0.5,
    solarTransmission: 0.6, setpointC: 18, captureFraction: 0.82, exchangerEffectiveness: 0.92,
    overheadFraction: 0.1, pumpKW: 0.2, baselineHeatingCOP: 1});

  function thermal(data, p, overrides = {}) {
    const c = {...DEFAULTS, ...p, ...overrides};
    bounded(c.replicas, 'Replicas', 1, 64);
    if (!Number.isInteger(c.replicas)) throw new RangeError('Replica count must be an integer');
    bounded(c.uValueWm2K, 'Cover U value', 0, 20);
    bounded(c.airChangesPerHour, 'Air changes/h', 0, 10);
    bounded(c.solarTransmission, 'Solar transmission', 0, 1);
    bounded(c.captureFraction, 'Capture fraction', 0, 1);
    bounded(c.exchangerEffectiveness, 'Exchanger effectiveness', 0, 1);
    bounded(c.overheadFraction, 'IT overhead', 0, 1);
    bounded(c.pumpKW, 'Pump power', 0, 20);
    bounded(c.baselineHeatingCOP, 'Baseline heater COP', 1, 10);
    bounded(c.setpointC, 'Greenhouse setpoint', 0, 30);
    const g = data.greenhouseGeometry, hp = data.heatPump;
    const cop = overrides.cop ?? hp.capacityW / hp.electricW;
    bounded(cop, 'Heating COP', 1.01, 15);
    const weather = data.weather[c.season];
    if (!weather?.length) throw new RangeError('Unknown/empty weather period');
    // Fixed IT in both arms isolates heat recovery; independent of the routing/packing experiment.
    const record = data.gpu.find(r => r.model === c.model && r.max_num_seqs === c.baselineBatch);
    if (!record) throw new RangeError('Unknown thermal IT operating point');
    const itKW = record.avg_power_watts * c.replicas / 1000;
    const capturedKW = itKW * c.captureFraction * c.exchangerEffectiveness;
    const uaKWK = c.uValueWm2K * g.aCov.value / 1000;
    // rho_air=1.2 kg/m3 and cp_air=1.005 kJ/(kg K), approximate engineering properties.
    const ventilationKWK = 1.2 * 1.005 * c.airChangesPerHour * g.aFlr.value * g.hGh.value / 3600;
    const rows = weather.map((w, index) => {
      const deltaK = Math.max(0, c.setpointC - w.outsideC);
      const solarKW = c.solarTransmission * w.ghiWm2 * g.aFlr.value / 1000;
      const demandKW = Math.max(0, (uaKWK + ventilationKWK) * deltaK - solarKW);
      const hotKW = Math.min(demandKW, hp.capacityW / 1000, capturedKW * cop / (cop - 1));
      const hpElectricKW = hotKW / cop, sourceKW = hotKW - hpElectricKW;
      const backupKW = demandKW - hotKW;
      const secondaryPumpKW = hotKW > 0 ? c.pumpKW : 0;
      const rejectedKW = itKW - sourceKW;
      const commonKW = itKW * (1 + c.overheadFraction);
      const baselineKW = commonKW + demandKW / c.baselineHeatingCOP;
      const candidateKW = commonKW + hpElectricKW + secondaryPumpKW + backupKW / c.baselineHeatingCOP;
      return {hour: index, timeSeconds: w.timeSeconds, outsideC: w.outsideC, ghiWm2: w.ghiWm2,
        demandKW, itKW, capturedKW, hotKW, hpElectricKW, sourceKW, backupKW, secondaryPumpKW,
        rejectedKW, baselineKW, candidateKW,
        waterDeltaK: hotKW / (hp.massFlowKgS * 4.18),
        sourceResidualKW: itKW - sourceKW - rejectedKW,
        hpResidualKW: hotKW - hpElectricKW - sourceKW,
        demandResidualKW: demandKW - hotKW - backupKW};
    });
    const sum = key => rows.reduce((s, r) => s + r[key], 0); // exact hourly bins: kW × 1 h
    const residual = Math.max(...rows.flatMap(r => [Math.abs(r.sourceResidualKW),
      Math.abs(r.hpResidualKW), Math.abs(r.demandResidualKW)]));
    const baselineKWh = sum('baselineKW'), candidateKWh = sum('candidateKW');
    return {kind: 'Uncalibrated reduced-order scenario; NOT measured heat savings',
      period: c.season, hours: rows.length, cop, itKW, gpuRecord: record,
      baselineKWh, candidateKWh, savedKWh: baselineKWh - candidateKWh,
      demandKWh: sum('demandKW'), usefulHeatKWh: sum('hotKW'), hpElectricKWh: sum('hpElectricKW'),
      backupHeatKWh: sum('backupKW'), pumpKWh: sum('secondaryPumpKW'),
      maxConservationResidualKW: residual, measuredPredictionMAE: null, rows,
      limitation: 'Published geometry is transplanted into Chicago TMY weather as a counterfactual. No measured greenhouse heat validation, plant-yield model, latent heat, screens, soil storage, hydraulic/temperature feasibility, off-design heat-pump curve, or connection to the legacy 3D campus. Catalogue COP is held constant at its nominal reference point. Replicas run continuously at the measured GPU point by assumption.'};
  }

  function sensitivity(data, p) {
    const nominalCOP = data.heatPump.capacityW / data.heatPump.electricW;
    const values = [];
    for (const u of [0.8, 1, 1.2]) for (const capture of [0.8, 1, 1.2]) for (const cop of [0.8, 1, 1.2]) {
      const result = thermal(data, p, {uValueWm2K: p.uValueWm2K * u,
        captureFraction: Math.min(1, p.captureFraction * capture), cop: nominalCOP * cop});
      values.push({uMultiplier: u, captureMultiplier: capture, copMultiplier: cop, savedKWh: result.savedKWh});
    }
    return {method: '27-point sensitivity grid: cover U value, capture fraction, nominal COP each ×0.8/1/1.2; capture capped at 1',
      isConfidenceInterval: false, lowKWh: Math.min(...values.map(x => x.savedKWh)),
      highKWh: Math.max(...values.map(x => x.savedKWh)), values};
  }

  function assumptions(data, p) {
    const units = {weakShare: 'fraction of calls', seed: 'dimensionless', gpuCount: 'GPUs',
      model: 'model identifier', baselineBatch: 'max concurrent sequences', itlLimitMs: 'ms/token',
      outputTokens: 'output tokens', season: 'TMY week', replicas: 'benchmark replicas',
      uValueWm2K: 'W/(m² K)', airChangesPerHour: 'h⁻¹', solarTransmission: 'fraction', setpointC: '°C',
      captureFraction: 'fraction', exchangerEffectiveness: 'fraction', overheadFraction: 'fraction of GPU power',
      pumpKW: 'kW', baselineHeatingCOP: 'kW heat/kW electricity'};
    const scenario = new Set(['weakShare', 'seed', 'gpuCount', 'model', 'baselineBatch', 'itlLimitMs', 'outputTokens', 'season']);
    return Object.entries(p).map(([name, value]) => ({name, value, unit: units[name],
      status: scenario.has(name) ? 'Experiment design choice' : 'Unvalidated deployment assumption'})).concat([
      {name: 'Greenhouse floor/cover area and mean height', value: data.greenhouseGeometry, unit: 'm², m',
        status: 'Published research parameters; not ThermaLoop site measurements', source: 'greenhouse.json'},
      {name: 'Heat-pump nominal capacity/electric input', value: data.heatPump, unit: 'W, °C, kg/s',
        status: 'Catalogue operating point; constant off-design use is an assumption', source: 'heat-pump.mo'},
      {name: 'Water specific heat', value: 4.18, unit: 'kJ/(kg K)', status: 'Engineering approximation; temperature-independent'},
      {name: 'Air density / specific heat', value: [1.2, 1.005], unit: 'kg/m³; kJ/(kg K)', status: 'Engineering approximations'},
      {name: 'Measured greenhouse / full-site telemetry', value: null, unit: 'kW, °C', status: 'Missing; no calibration or prediction error claimed'},
      {name: 'Scheduling boundary', value: 'Static single-GPU resource packing; CPU, RAM, GPU types, durations, and thermal state omitted', unit: 'mGPU', status: 'Reduced replay; pending requests retained'},
    ]);
  }

  function experiment(data, parameters = {}) {
    const p = {...DEFAULTS, ...parameters};
    const result = {schemaVersion: 1, engineVersion: VERSION,
      claim: 'Evidence-informed research experiments, not a validated operational digital twin',
      parameters: p, sources: data.sources, assumptions: assumptions(data, p),
      routing: routing(data.routing, p.weakShare, p.seed),
      scheduling: {kind: 'Static admission replay of published resource requests; no execution/energy claims',
        baseline: pack(data.scheduling.records, p.gpuCount, 'first-fit'),
        candidate: pack(data.scheduling.records, p.gpuCount, 'best-fit')},
      gpu: gpuExperiment(data.gpu, p.model, p.baselineBatch, p.itlLimitMs, p.outputTokens),
      thermal: thermal(data, p)};
    result.thermalSensitivity = sensitivity(data, p);
    result.checks = {
      routingPairs: result.routing.rows.length === data.routing.records.length,
      schedulingConservation: [result.scheduling.baseline, result.scheduling.candidate].every(r =>
        r.conservationResidualMilli === 0 && r.admitted + r.pending === r.submitted && r.remaining.every(x => x >= 0)),
      thermalConservation: result.thermal.maxConservationResidualKW < 1e-9,
      measuredGPUIdentity: result.gpu.configurations.every(r => Math.abs(r.avg_power_watts /
        r.output_throughput_tokens_per_sec - r.energy_per_token_joules) / r.energy_per_token_joules < 0.02),
    };
    return result;
  }

  function csv(result) {
    const quote = x => '"' + String(x ?? '').replaceAll('"', '""') + '"';
    const rows = [['experiment', 'arm', 'metric', 'value', 'unit', 'status']];
    for (const [arm, key] of [['baseline', 'baselineAccuracyPct'], ['candidate', 'candidateAccuracyPct']]) {
      rows.push(['routing', arm, 'accuracy', result.routing[key], '%', 'Published-outcome replay; seeded random control']);
    }
    for (const arm of ['baseline', 'candidate']) {
      const s = result.scheduling[arm], g = result.gpu[arm];
      rows.push(['scheduling', arm, 'admitted', s.admitted, 'requests', 'Static packing replay']);
      rows.push(['scheduling', arm, 'pending', s.pending, 'requests', 'Static packing replay']);
      rows.push(['gpu', arm, 'fixed_token_energy', g?.fixedTokenEnergyKWh, 'kWh', g ? 'Projection from GPU-only benchmark' : 'No feasible measured configuration']);
      rows.push(['thermal', arm, 'site_energy', result.thermal[arm + 'KWh'], 'kWh', 'Uncalibrated scenario']);
    }
    rows.push(['metadata', '', 'engine_version', result.engineVersion, '', result.claim]);
    for (const a of result.assumptions) rows.push(['assumption', '', a.name,
      typeof a.value === 'object' ? JSON.stringify(a.value) : a.value, a.unit, a.status]);
    for (const source of result.sources) rows.push(['source', '', source.id, source.url, 'SHA-256: ' + source.sha256, source.kind]);
    return rows.map(r => r.map(quote).join(',')).join('\r\n');
  }
  return {VERSION, DEFAULTS, random, routing, pack, gpuExperiment, thermal, sensitivity, experiment, csv};
});
