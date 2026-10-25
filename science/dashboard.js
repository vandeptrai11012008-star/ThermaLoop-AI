/* Additive UI: the original simulator, 3D renderer, exports and links stay independent. */
(() => {
  'use strict';
  const M = globalThis.ThermaScience, D = globalThis.ThermaEvidenceData;
  const $ = id => document.getElementById(id);
  const esc = x => String(x).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (x, digits = 2) => x == null ? 'Not available' : Number(x).toLocaleString('en-US', {maximumFractionDigits: digits});
  const metric = (name, value) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`;
  let current = null, charts = {}, timer;

  function bars(title, values, unit, max) {
    const width = 520, height = values.length * 44 + 62, end = 370;
    max = max || Math.max(1e-9, ...values.map(x => x.value)) * 1.05;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="science-chart" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><text x="12" y="20">${esc(title)} · ${esc(unit)}</text>` +
      values.map((r, i) => `<text x="12" y="${49 + i * 44}">${esc(r.label)}</text><rect x="112" y="${32 + i * 44}" width="${Math.max(0, r.value / max * (end - 112))}" height="26" fill="${i ? '#6bdce9' : '#f0ac82'}" rx="3"/><text x="380" y="${49 + i * 44}">${num(r.value)} ${esc(unit)}</text>`).join('') +
      `<text x="112" y="${height - 7}">0</text><text x="300" y="${height - 7}">Scale 0–${num(max)} ${esc(unit)}</text></svg>`;
  }
  function timeline(rows) {
    const W = 620, H = 215, L = 48, R = 601, T = 32, B = 173;
    const max = Math.max(1, ...rows.flatMap(r => [r.baselineKW, r.candidateKW])) * 1.05;
    const path = key => rows.map((r, i) => `${i ? 'L' : 'M'}${(L + i * (R - L) / (rows.length - 1)).toFixed(2)},${(B - r[key] / max * (B - T)).toFixed(2)}`).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="science-chart" role="img" aria-label="Modeled site electricity, same IT and greenhouse conditions, 168 hours"><title>Modeled site electricity; uncalibrated heat-recovery scenario</title><text x="8" y="17">Electricity (kW) · uncalibrated scenario</text>` +
      [0, 0.5, 1].map(f => `<line x1="${L}" x2="${R}" y1="${B - f * (B - T)}" y2="${B - f * (B - T)}" stroke="#284255"/><text x="5" y="${B - f * (B - T) + 4}">${num(f * max, 0)}</text>`).join('') +
      `<path d="${path('baselineKW')}" fill="none" stroke="#f0ac82" stroke-width="2"/><path d="${path('candidateKW')}" fill="none" stroke="#6bdce9" stroke-width="2"/>` +
      [0, 48, 96, 144, 167].map(i => `<text x="${L + i * (R - L) / 167 - 5}" y="192">${i}</text>`).join('') + `<text x="460" y="210">Hour of selected TMY week</text></svg>`;
  }

  function read() {
    const p = {...M.DEFAULTS};
    document.querySelectorAll('[data-science-param]').forEach(input => {
      p[input.dataset.scienceParam] = input.dataset.scienceType === 'string' ? input.value :
        (input.type === 'number' ? input.valueAsNumber : Number(input.value));
    });
    return p;
  }

  function render(result) {
    const {routing: r, scheduling: s, gpu: g, thermal: t, thermalSensitivity: sensitivity} = result;
    $('sciRoutingMetrics').innerHTML = metric('Published benchmark pairs', num(r.questions, 0)) +
      metric('Baseline · all GPT-4', num(r.baselineAccuracyPct) + '% correct') +
      metric('Candidate · seeded routing', num(r.candidateAccuracyPct) + '% correct') +
      metric('Actual Mixtral calls', `${num(r.weakCalls, 0)} / ${r.questions}`) +
      metric('Accuracy change', num(r.accuracyDeltaPP.mean) + ' pp') +
      metric('95% paired bootstrap', `[${num(r.accuracyDeltaPP.low)}, ${num(r.accuracyDeltaPP.high)}] pp`);
    $('sciRoutingNote').textContent = `${D.routing.originalCount} upstream questions; ${D.routing.excludedCount} contamination exclusions. Seed ${r.seed}. Decisions use a seeded random stream, not answers or a trained router. This control can lose quality; energy and latency are unavailable for this model pair. Bootstrap reflects question sampling only.`;
    charts.routing = bars('Replayed GSM8K accuracy', [
      {label: 'Baseline', value: r.baselineAccuracyPct}, {label: 'ThermaLoop', value: r.candidateAccuracyPct}], '%', 100);
    $('sciRoutingChart').innerHTML = charts.routing;

    $('sciSchedulingMetrics').innerHTML = metric('Same published requests', num(s.baseline.submitted, 0)) +
      metric('Baseline first-fit admitted / pending', `${s.baseline.admitted} / ${s.baseline.pending}`) +
      metric('Candidate best-fit admitted / pending', `${s.candidate.admitted} / ${s.candidate.pending}`) +
      metric('Baseline allocated capacity', num(s.baseline.allocationPct) + '%') +
      metric('Candidate allocated capacity', num(s.candidate.allocationPct) + '%') +
      metric('Allocation balance residual', num(Math.max(s.baseline.conservationResidualMilli, s.candidate.conservationResidualMilli)) + ' mGPU');
    charts.scheduling = bars('Requested GPU capacity admitted', [
      {label: 'Baseline', value: s.baseline.allocationPct}, {label: 'ThermaLoop', value: s.candidate.allocationPct}], '%', 100);
    $('sciSchedulingChart').innerHTML = charts.scheduling;

    $('sciGPUMetrics').innerHTML = metric('Same output-token budget', num(g.outputTokens, 0)) +
      metric('Baseline / selected max sequences', `${g.baselineBatch} / ${g.candidate?.max_num_seqs ?? 'Infeasible'}`) +
      metric('Baseline projected GPU energy', num(g.baseline.fixedTokenEnergyKWh, 4) + ' kWh') +
      metric('Candidate projected GPU energy', g.candidate ? num(g.candidate.fixedTokenEnergyKWh, 4) + ' kWh' : 'No feasible measured point') +
      metric('Baseline P95 ITL', num(g.baseline.p95_itl_ms) + ' ms/token') +
      metric('Candidate P95 ITL', g.candidate ? num(g.candidate.p95_itl_ms) + ' ms/token' : 'Not available') +
      metric('Baseline / candidate GPU power', `${num(g.baseline.avg_power_watts)} / ${g.candidate ? num(g.candidate.avg_power_watts) : '—'} W`) +
      metric('GPUs per measured replica', num(g.baseline.num_gpus, 0) + ' × H100');
    $('sciGPUNote').textContent = g.limitation + (g.baselineMeetsLimit ? '' : ' The baseline also exceeds the selected ITL limit.');
    charts.gpu = g.candidate ? bars('GPU energy per fixed output budget', [
      {label: 'Baseline', value: g.baseline.fixedTokenEnergyKWh}, {label: 'ThermaLoop', value: g.candidate.fixedTokenEnergyKWh}], 'kWh') : '';
    $('sciGPUChart').innerHTML = charts.gpu;
    $('sciGPUData').innerHTML = g.configurations.map(row => `<tr><td>${row.max_num_seqs}</td><td>${num(row.avg_power_watts)}</td><td>${num(row.output_throughput_tokens_per_sec)}</td><td>${num(row.energy_per_token_joules, 6)}</td><td>${num(row.p95_itl_ms)}</td><td>${row.p95_itl_ms <= g.itlLimitMs ? 'Within limit' : 'Exceeds limit'}</td></tr>`).join('');

    $('sciThermalMetrics').innerHTML = metric('Identical IT power in both arms', num(t.itKW) + ' kW') +
      metric('Baseline: IT + overhead + heating', num(t.baselineKWh) + ' kWh/week') +
      metric('Candidate: includes HP, pump, backup', num(t.candidateKWh) + ' kWh/week') +
      metric('Scenario electricity difference', num(t.savedKWh) + ' kWh/week') +
      metric('Heat demand / recovered delivery', `${num(t.demandKWh)} / ${num(t.usefulHeatKWh)} kWhₜₕ`) +
      metric('Heat-pump / secondary-pump electricity', `${num(t.hpElectricKWh)} / ${num(t.pumpKWh)} kWh`) +
      metric('Nominal COP used', num(t.cop, 4)) +
      metric('27-point sensitivity range', `${num(sensitivity.lowKWh)}–${num(sensitivity.highKWh)} kWh`) +
      metric('Max energy-balance residual', t.maxConservationResidualKW.toExponential(2) + ' kW') +
      metric('Measured greenhouse prediction MAE', 'Unavailable · no field series');
    $('sciThermalNote').textContent = t.limitation;
    charts.thermal = timeline(t.rows);
    $('sciThermalChart').innerHTML = charts.thermal;
    $('sciAssumptions').innerHTML = result.assumptions.map(a => `<tr><th scope="row">${esc(a.name)}</th><td>${esc(typeof a.value === 'object' ? JSON.stringify(a.value) : a.value)}</td><td>${esc(a.unit)}</td><td>${esc(a.status)}</td></tr>`).join('');
    $('sciChecks').innerHTML = Object.entries(result.checks).map(([k, v]) => `<li>${esc(k)}: <strong>${v ? 'PASS' : 'FAIL'}</strong></li>`).join('');
  }

  function run() {
    clearTimeout(timer);
    const status = $('sciStatus');
    try {
      const p = read();
      const invalid = [...document.querySelectorAll('[data-science-param]')].find(x => !x.checkValidity());
      if (invalid) throw new Error(`Check ${invalid.closest('label').textContent.trim()}`);
      current = M.experiment(D, p);
      document.querySelector('.science-grid').hidden = false;
      render(current);
      const passed = Object.values(current.checks).every(Boolean);
      status.classList.toggle('error', !passed);
      status.textContent = passed ? 'Recomputed · 4 consistency checks pass. Field validation remains unavailable.' : 'Consistency check failed; inspect exported checks.';
      $('sciExportJSON').disabled = false; $('sciExportCSV').disabled = false; $('sciExportSVG').disabled = false;
    } catch (error) {
      current = null; status.classList.add('error'); status.textContent = 'Experiment not run: ' + error.message;
      document.querySelector('.science-grid').hidden = true;
      $('sciChecks').textContent = 'No current run. Correct the inputs and recompute.';
      $('sciAssumptions').innerHTML = '<tr><td colspan="4">No current result. Correct the inputs and recompute.</td></tr>';
      $('sciExportJSON').disabled = true; $('sciExportCSV').disabled = true; $('sciExportSVG').disabled = true;
    }
  }
  function download(content, filename, type) {
    const url = URL.createObjectURL(new Blob([content], {type}));
    const link = document.createElement('a'); link.href = url; link.download = filename; link.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function setup() {
    if (!M || !D) { $('sciStatus').textContent = 'Evidence scripts unavailable. Check local files.'; return; }
    $('sciSources').innerHTML = D.sources.map(s => `<article class="science-source"><h4>${esc(s.id)} · ${esc(s.kind)}</h4><p><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Pinned source · ${esc(s.repository)}</a> · <a href="${esc(s.paper)}" target="_blank" rel="noopener noreferrer">Research / reference</a> · Retrieved ${esc(s.retrieved)}</p><p>${esc(s.limitations)}</p><p>License / attribution: ${esc(s.license)}</p><div class="science-hash">Commit ${esc(s.commit)}<br>Original file SHA-256 ${esc(s.sha256)}</div></article>`).join('');
    $('sciRun').addEventListener('click', run);
    $('sciReset').addEventListener('click', () => {
      document.querySelectorAll('[data-science-param]').forEach(input => { input.value = M.DEFAULTS[input.dataset.scienceParam]; });
      run();
    });
    document.querySelectorAll('[data-science-param]').forEach(input => input.addEventListener('input', () => {
      clearTimeout(timer); timer = setTimeout(run, 180);
    }));
    $('sciExportJSON').addEventListener('click', () => current && download(JSON.stringify(current, null, 2), 'ThermaLoop_Scientific_Evidence.json', 'application/json'));
    $('sciExportCSV').addEventListener('click', () => current && download(M.csv(current), 'ThermaLoop_Scientific_Evidence.csv', 'text/csv;charset=utf-8'));
    $('sciExportSVG').addEventListener('click', () => {
      if (!current) return;
      const svg = charts.thermal.replace('</svg>', '<text x="48" y="29">Baseline: orange · ThermaLoop candidate: cyan · NOT measured</text></svg>');
      download(svg, 'ThermaLoop_Heat_Recovery_Scenario.svg', 'image/svg+xml');
    });
    window.ThermaScientificDashboard = {run, getResult: () => current};
    run();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
