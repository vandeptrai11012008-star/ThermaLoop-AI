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
    const width = 540, height = values.length * 60 + 68, left = 22, right = 518;
    max = max || Math.max(1e-9, ...values.map(x => x.value)) * 1.05;
    const precision = unit === 'kWh' ? 4 : 2;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" class="science-chart" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="${width}" height="${height}" rx="9" fill="#0b1621"/><g font-family="Segoe UI, sans-serif" font-size="11" fill="#aec2cd"><text x="${left}" y="25" class="chart-heading">${esc(title)}</text>` +
      values.map((r, i) => `<text x="${left}" y="${53 + i * 60}">${esc(r.label)}</text><text x="${right}" y="${53 + i * 60}" text-anchor="end" class="chart-number" fill="#e8f2f5" font-size="13">${num(r.value, precision)} ${esc(unit)}</text><rect x="${left}" y="${65 + i * 60}" width="${right - left}" height="13" rx="6.5" fill="#1a2c39"/><rect x="${left}" y="${65 + i * 60}" width="${Math.max(0, r.value / max * (right - left))}" height="13" fill="${i ? '#6bdce9' : '#f0ac82'}" rx="6.5"/>`).join('') +
      `<text x="${left}" y="${height - 13}" class="chart-axis">0</text><text x="${right}" y="${height - 13}" class="chart-axis" text-anchor="end">Scale 0–${num(max, precision)} ${esc(unit)}</text></g></svg>`;
  }
  function timeline(rows) {
    const W = 620, H = 260, L = 50, R = 594, T = 62, B = 206;
    const max = Math.max(1, ...rows.flatMap(r => [r.baselineKW, r.candidateKW])) * 1.05;
    const path = key => rows.map((r, i) => `${i ? 'L' : 'M'}${(L + i * (R - L) / (rows.length - 1)).toFixed(2)},${(B - r[key] / max * (B - T)).toFixed(2)}`).join(' ');
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" class="science-chart" role="img" aria-label="Modeled site electricity, same IT and greenhouse conditions, 168 hours"><title>Modeled site electricity; uncalibrated heat-recovery scenario</title><rect width="${W}" height="${H}" rx="9" fill="#0b1621"/><g font-family="Segoe UI, sans-serif" font-size="11" fill="#aec2cd"><text x="20" y="25" class="chart-heading">Site electricity · kW</text><text x="20" y="43" class="chart-note">Uncalibrated scenario · NOT measured</text>` +
      [0, 0.25, 0.5, 0.75, 1].map(f => `<line x1="${L}" x2="${R}" y1="${B - f * (B - T)}" y2="${B - f * (B - T)}" stroke="#263d4b" stroke-dasharray="3 5"/><text x="15" y="${B - f * (B - T) + 4}" class="chart-axis">${num(f * max, 0)}</text>`).join('') +
      `<path d="${path('candidateKW')} L${R},${B} L${L},${B} Z" fill="#6bdce9" fill-opacity="0.06"/><path d="${path('baselineKW')}" fill="none" stroke="#f0ac82" stroke-width="2.4" stroke-linejoin="round"/><path d="${path('candidateKW')}" fill="none" stroke="#6bdce9" stroke-width="2.4" stroke-linejoin="round"/>` +
      [0, 48, 96, 144, 167].map(i => `<text x="${L + i * (R - L) / 167}" y="226" text-anchor="middle" class="chart-axis">${i}</text>`).join('') + `<text x="${R}" y="247" text-anchor="end" class="chart-axis">Hour of selected TMY week</text></g></svg>`;
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
    const signed = (value, digits = 2) => (value > 0 ? '+' : '') + num(value, digits);
    $('sciRoutingHeadline').textContent = signed(r.accuracyDeltaPP.mean) + ' pp';
    $('sciRoutingSummary').dataset.tone = r.accuracyDeltaPP.mean < 0 ? 'caution' : 'neutral';
    $('sciSchedulingHeadline').textContent = signed(s.candidate.admitted - s.baseline.admitted, 0) + ' requests';
    $('sciSchedulingSummary').dataset.tone = 'neutral';
    $('sciGPUHeadline').textContent = g.candidate ? num(g.candidate.fixedTokenEnergyKWh, 4) + ' kWh' : 'No feasible point';
    $('sciGPUSummary').dataset.tone = g.candidate ? 'default' : 'caution';
    $('sciThermalHeadline').textContent = num(t.savedKWh) + ' kWh';
    $('sciThermalSummary').dataset.tone = 'caution';
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
    $('sciSourceCount').textContent = D.sources.length + ' pinned source files · offline ready';
    $('sciCoveragePairs').textContent = num(D.routing.records.length, 0);
    $('sciCoverageGPU').textContent = num(D.gpu.length, 0);
    $('sciCoverageRequests').textContent = num(D.scheduling.records.length, 0);
    $('sciCoverageHours').textContent = num(D.weather.winter.length + D.weather.summer.length, 0) + ' h';
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
      const svg = charts.thermal.replace('</g></svg>', '<text x="594" y="43" text-anchor="end" class="chart-note">Baseline: orange · Candidate: cyan</text></g></svg>');
      download(svg, 'ThermaLoop_Heat_Recovery_Scenario.svg', 'image/svg+xml');
    });
    window.ThermaScientificDashboard = {run, getResult: () => current};
    run();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', setup);
  else setup();
})();
