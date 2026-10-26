(() => {
  'use strict';
  const V = globalThis.ThermaValidation, D = globalThis.ThermaValidationData;
  const $ = id => document.getElementById(id);
  const esc = x => String(x).replace(/[&<>"']/g,c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num = (x,d=5) => x == null ? 'Unavailable' : Number(x).toLocaleString('en-US',{maximumFractionDigits:d});
  const field = (name,value) => `<dt>${esc(name)}</dt><dd>${esc(value)}</dd>`;
  const example = {Tin_C:30,Tout_C:35,surface_C:45,electrical_W:1000,massFlow_kg_s:.05,cp_J_kgK:4000,reportedR_Tin_K_W:null};
  let comparison = null, calculation = null, calculationError = null, svg = '';

  function plot(result) {
    const W=480,H=360,L=68,R=450,T=32,B=292;
    const values=result.rows.flatMap(p=>[p.observed,p.predicted]);
    const low=Math.min(...values)*.93, high=Math.max(...values)*1.07;
    const x=v=>L+(v-low)/(high-low)*(R-L), y=v=>B-(v-low)/(high-low)*(B-T);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Predicted versus repository-digitized cold-plate resistance, calibration separated from same-source evaluation"><title>Repository digitization replay; primary source unverified</title><rect width="480" height="360" rx="10" fill="#0b1621"/><g fill="#abc2ce" font-family="Segoe UI, sans-serif" font-size="14">`+
      [0,1,2,3].map(i=>{const v=low+(high-low)*i/3;return `<line x1="${x(v)}" x2="${x(v)}" y1="${T}" y2="${B}" stroke="#263f4d"/><line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="#263f4d"/><text x="${x(v)}" y="314" text-anchor="middle" class="val-axis">${v.toFixed(3)}</text><text x="58" y="${y(v)+5}" text-anchor="end" class="val-axis">${v.toFixed(3)}</text>`;}).join('')+
      `<line x1="${L}" x2="${R}" y1="${B}" y2="${T}" stroke="#d1dee3" stroke-dasharray="6 7"/>`+
      result.rows.map(p=>p.role==='calibration'?`<rect x="${x(p.observed)-6}" y="${y(p.predicted)-6}" width="12" height="12" fill="#edbb83"><title>${esc(p.id)}: calibration, ${p.flow_L_min} L/min</title></rect>`:`<circle cx="${x(p.observed)}" cy="${y(p.predicted)}" r="6" fill="${result.exponent===.8?'#edbb83':'#80dfd6'}"><title>${esc(p.id)}: same-source evaluation, ${p.flow_L_min} L/min</title></circle>`).join('')+
      '<text x="255" y="344" text-anchor="middle">Repository R_Tin · K/W</text><text transform="translate(20 166) rotate(-90)" text-anchor="middle">Predicted R_Tin · K/W</text></g></svg>';
  }
  function updateComparison() {
    comparison = V.benchmark(D,Number($('valExponent').value));
    const m = comparison.metrics;
    $('valApplicability').textContent = comparison.applicability;
    $('valApplicability').dataset.tone = comparison.exponent === .8 ? 'error' : 'caution';
    $('valMetrics').innerHTML = [['Evaluation MAE',num(m.mae)+' K/W'],['Evaluation RMSE',num(m.rmse)+' K/W'],['Evaluation bias',num(m.bias)+' K/W'],['NRMSE · evaluation range',num(100*m.nrmseRange,2)+'%']].map(([k,v])=>`<div><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`).join('');
    svg=plot(comparison); $('valFitChart').innerHTML=svg;
    $('valPoints').innerHTML=comparison.rows.map(p=>`<tr><th>${esc(p.id)} · ${p.role==='calibration'?'Calibration':'Same-source evaluation'}</th><td>${num(p.flow_L_min,0)}</td><td>${num(p.observed)}</td><td>${num(p.predicted)}</td><td>${num(p.residual_K_W)}</td><td>${num(p.reynolds,1)}</td></tr>`).join('');
    const re=comparison.rows.map(p=>p.reynolds);
    $('valPropertyNote').textContent=`PG25 engineering property approximation at 32°C: cp ${num(comparison.properties.cp_J_kgK,0)} J/kg/K; density ${num(comparison.properties.rho_kg_m3,2)} kg/m³. Channel Re ${num(Math.min(...re),1)}–${num(Math.max(...re),1)} is laminar; thermal entry state is unknown without conductivity. Reported ±0.002 K/W digitization and ±10% measurement estimates are unverified and are not prediction intervals. Relative RMS: ${num(m.relativeRMSPct,2)}%; this differs from range-normalized RMSE.`;
  }
  function updateMeasurement() {
    try {
      const inputs=[...document.querySelectorAll('[data-validation-param]')];
      const invalid=inputs.find(e=>!e.checkValidity());
      if(invalid)throw new RangeError('Check '+invalid.closest('label').textContent.trim());
      const p=Object.fromEntries(inputs.map(e=>[e.dataset.validationParam,e.value.trim()===''?null:e.valueAsNumber]));
      calculation=V.measurement(p); calculationError=null;
      const r=calculation;
      $('valMeasurementMetrics').innerHTML=field('R_Tin · electrical basis',num(r.R_Tin_electrical_K_W)+' K/W')+
        field('R_LMTD · electrical basis',r.R_LMTD_electrical_K_W==null?'Unavailable':num(r.R_LMTD_electrical_K_W)+' K/W')+
        field('Log-mean temperature difference',r.LMTD_K==null?'Unavailable':num(r.LMTD_K,3)+' K')+
        field('Absorbed liquid heat',r.Q_fluid_W==null?'Unavailable':num(r.Q_fluid_W,2)+' W')+
        field('Liquid heat / electrical input',r.captureFraction==null?'Unavailable':num(100*r.captureFraction,2)+'%')+
        field('Liquid minus electrical heat',r.heatBalanceResidual_W==null?'Unavailable':num(r.heatBalanceResidual_W,2)+' W')+
        field('UA · liquid heat basis',r.UA_liquid_W_K==null?'Unavailable':num(r.UA_liquid_W_K,3)+' W/K')+
        field('Isothermal-surface effectiveness',r.isothermalEffectiveness==null?'Unavailable':num(100*r.isothermalEffectiveness,2)+'%');
      const inconsistent=r.reportedResistanceArithmeticConsistent===false;
      const unbalanced=r.captureFraction!==null&&Math.abs(r.captureFraction-1)>1e-9;
      $('valMeasurementStatus').dataset.tone=inconsistent||unbalanced?'error':'neutral';
      $('valMeasurementStatus').textContent=inconsistent?`Reported resistance is inconsistent with these inputs by ${num(r.reportedResistanceDiscrepancy_K_W,7)} K/W. Review the temperature and power definition; no measurement uncertainty was supplied.`:unbalanced?'Liquid and electrical heat differ. Check heat losses, sensor uncertainty, steady-state conditions and the measurement boundary. No tolerance or physical validation is assumed.':'Illustrative arithmetic only. Missing measurements and experimental uncertainty remain unavailable.';
    } catch(error) {
      calculation=null; calculationError=error.message;
      $('valMeasurementMetrics').textContent='No current calculation. Correct the inputs.';
      $('valMeasurementStatus').dataset.tone='error';
      $('valMeasurementStatus').textContent=error.message;
    }
  }
  function load(values) {
    document.querySelectorAll('[data-validation-param]').forEach(e=>e.value=values[e.dataset.validationParam]??'');
    updateMeasurement();
  }
  function download(content,name,type) {
    const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  const report = () => ({schemaVersion:1,engineVersion:V.VERSION,registryBuild:globalThis.ThermaValidationBuild,
    comparison,illustrativeMeasurement:calculation,illustrativeMeasurementError:calculationError,registry:D,
    boundary:'Separate research calculations; no sensor connection, calibration of the 3D campus, independent laboratory validation or operational savings claim.'});
  function setup() {
    if(!V||!D)return;
    $('valCoverage').innerHTML=D.coverage.map(r=>`<tr><th>${esc(r.layer)}<br><small>${esc(r.observable)}</small></th><td>${esc(r.status)}</td><td>${esc(r.current)}</td><td>${esc(r.gap)}</td></tr>`).join('');
    $('valSources').innerHTML=D.sources.map(s=>`<article class="validation-source"><h4><a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.title)} ↗</a></h4><p><strong>Primary source not retrieved</strong> · ${esc(s.observable)}</p><p>${esc(s.limitation)}</p><p>Primary document hash: unavailable · Raw experimental data license: unknown</p></article>`).join('');
    $('valExponent').addEventListener('change',updateComparison);
    document.querySelectorAll('[data-validation-param]').forEach(e=>e.addEventListener('input',updateMeasurement));
    $('valResetExample').addEventListener('click',()=>load(example));
    $('valReportExample').addEventListener('click',()=>load({Tin_C:32,surface_C:85,electrical_W:750,reportedR_Tin_K_W:.085}));
    $('valExportJSON').addEventListener('click',()=>download(JSON.stringify(report(),null,2),'ThermaLoop_Validation_Workspace.json','application/json'));
    $('valExportCSV').addEventListener('click',()=>download(V.csv(comparison),'ThermaLoop_Coldplate_Comparison.csv','text/csv;charset=utf-8'));
    $('valExportSVG').addEventListener('click',()=>download(svg,'ThermaLoop_Coldplate_Comparison.svg','image/svg+xml'));
    globalThis.ThermaValidationDashboard={getReport:report};
    updateComparison();updateMeasurement();
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
