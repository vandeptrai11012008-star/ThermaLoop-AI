/* Display verified offline artifacts; no numerical/experimental claims for the legacy 3D runtime. */
(() => {
  'use strict';
  const D=globalThis.ThermaNumericalData,B=globalThis.ThermaNumericalBuild;
  const $=id=>document.getElementById(id);
  const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(x,d=5)=>x==null?'Not applicable':Number(x).toLocaleString('en-US',{maximumFractionDigits:d});
  const sci=x=>x==null?'Not applicable':Number(x).toExponential(2);
  const field=(k,v)=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
  const tile=(k,v)=>`<div><small>${esc(k)}</small><strong>${esc(v)}</strong></div>`;
  let chart='';

  function gridChart() {
    const rows=D.spatial.rows,W=500,H=330,L=70,R=470,T=30,bot=260;
    const minCells=Math.min(...rows.map(r=>r.cells)),maxCells=Math.max(...rows.map(r=>r.cells));
    const x=n=>L+Math.log2(n/minCells)/Math.log2(maxCells/minCells)*(R-L);
    const low=Math.min(D.spatial.steady_target_C,...rows.map(r=>r.steady_continuum_error_C))*.6;
    const high=Math.max(...rows.map(r=>r.steady_continuum_error_C))*1.4;
    const lo=Math.log10(low),hi=Math.log10(high);
    const ticks=[];
    for(let decade=Math.floor(lo);decade<=Math.ceil(hi);decade++)for(const factor of [1,2,5]){const v=factor*10**decade;if(v>=low&&v<=high)ticks.push(v);}
    const y=e=>bot-(Math.log10(e)-lo)/(hi-lo)*(bot-T);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Steady spatial error against the same-equation continuum reference; not experimental accuracy"><title>1D steady discretization error; synthetic fixed-property case</title><rect width="500" height="330" rx="10" fill="#0b1621"/><g fill="#adc5d0" font-family="Segoe UI, sans-serif" font-size="14">`+
      ticks.map(e=>`<line x1="${L}" x2="${R}" y1="${y(e)}" y2="${y(e)}" stroke="#2b4350"/><text x="58" y="${y(e)+5}" text-anchor="end">${num(e,5)}</text>`).join('')+
      `<line x1="${L}" x2="${R}" y1="${y(D.spatial.steady_target_C)}" y2="${y(D.spatial.steady_target_C)}" stroke="#e4bc86" stroke-dasharray="5 6"/>`+
      `<path d="${rows.map((r,i)=>`${i?'L':'M'}${x(r.cells)},${y(r.steady_continuum_error_C)}`).join(' ')}" fill="none" stroke="#82ded5" stroke-width="2.5"/>`+
      rows.map(r=>`<circle cx="${x(r.cells)}" cy="${y(r.steady_continuum_error_C)}" r="5" fill="#82ded5"><title>N=${r.cells}, error=${r.steady_continuum_error_C} C</title></circle><text x="${x(r.cells)}" y="284" text-anchor="middle">${r.cells}</text>`).join('')+
      '<text x="275" y="316" text-anchor="middle">Cells · logarithmic spacing</text><text transform="translate(20 145) rotate(-90)" text-anchor="middle">Steady error · °C · log scale</text></g></svg>';
  }
  function update() {
    const model=$('numModel').value,s=D.models[model],clock=s.clock,e=s.energy;
    $('numClockMetrics').innerHTML=tile('Legacy clock-shift gap',num(clock.legacy_difference_C,3)+' °C')+
      tile('Corrected clock-shift gap',sci(clock.corrected_max_difference_C)+' °C');
    $('numEnergyMetrics').innerHTML=field('Input energy',num(e.input_energy_J/1000,3)+' kJ')+
      field('External rejected energy',num(e.final_rejected_energy_J/1000,3)+' kJ')+
      field('Stored energy increase',num(e.final_stored_energy_change_J/1000,3)+' kJ')+
      field('Max instantaneous closure residual',sci(e.max_differential_residual_W)+' W')+
      field('Max integrated closure residual',sci(e.max_integral_residual_J)+' J')+
      field('Max integrated residual / input',sci(e.max_integral_residual_pct_of_input)+'%')+
      field('Time-integrator error vs same-grid reference',sci(s.solver_errors.max_trajectory_error_C)+' °C');
    const controls=s.selected_solver_controls;
    $('numSelectedSolver').textContent=`Shown results: max_step ${controls.max_step} s, rtol ${sci(controls.rtol)}, atol ${sci(controls.atol)}.`;
    const rows=s[$('numStudy').value];
    $('numTimeRows').innerHTML=rows.map(r=>`<tr><td>${num(r.max_step,2)}</td><td>${sci(r.rtol)} / ${sci(r.atol)}</td><td>${sci(r.max_trajectory_error_C)}</td><td>${sci(r.threshold_error_s)}</td><td class="${r.max_trajectory_error_C<=D.protocol.temperature_target_C?'num-within':'num-above'}">${r.max_trajectory_error_C<=D.protocol.temperature_target_C?'Within':'Above'} declared ${D.protocol.temperature_target_C}°C</td></tr>`).join('');
  }
  function csv() {
    const quote=x=>'"'+String(x??'').replaceAll('"','""')+'"';
    const rows=[['study','model_or_cells','metric','value','unit','scope']];
    for(const r of D.spatial.rows) {
      rows.push(['spatial',r.cells,'steady_temperature',r.steady_temperature_C,'C','Synthetic discrete equations']);
      rows.push(['spatial',r.cells,'steady_continuum_error',r.steady_continuum_error_C,'C','Same-equation analytical limit; not measured error']);
      rows.push(['spatial',r.cells,'transient_peak_change',r.transient_peak_change_C,'C','Inter-grid difference; not a certified error bound']);
    }
    for(const [kind,s] of Object.entries(D.models)) {
      for(const study of ['step_limits','tolerance_levels'])for(const r of s[study]) {
        rows.push([study,kind,'max_step',r.max_step,'s','Fixed forcing and common observation grid']);
        rows.push([study,kind,'rtol',r.rtol,'relative','Adaptive solver control']);
        rows.push([study,kind,'max_trajectory_error',r.max_trajectory_error_C,'C','Matrix exponential of same equations']);
        rows.push([study,kind,'threshold_error',r.threshold_error_s,'s','Diagnostic '+D.protocol.diagnostic_threshold_C+' C threshold, not GPU throttle calibration']);
      }
      rows.push(['energy',kind,'max_integral_residual',s.energy.max_integral_residual_J,'J',s.energy.boundary]);
      rows.push(['clock',kind,'legacy_shift_gap',s.clock.legacy_difference_C,'C','Reproduced indexing defect, not measured cooling benefit']);
      rows.push(['clock',kind,'corrected_shift_gap',s.clock.corrected_max_difference_C,'C','Synthetic clock invariance']);
    }
    for(const [name,hash]of Object.entries(D.sourceHashes))rows.push(['source',name,'SHA-256',hash,'','Offline source/configuration identity']);
    return rows.map(r=>r.map(quote).join(',')).join('\n');
  }
  function download(content,name,type) {
    const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');
    a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function setup() {
    const compatible=D?.schemaVersion===2&&B?.schemaVersion===2&&D.protocol&&D.gates&&Number.isFinite(D.CDU?.mesh_cells)&&Array.isArray(D.spatial?.rows)&&D.spatial.rows.length>1&&
      ['lumped','1d'].every(k=>D.models?.[k]?.parameters&&D.models[k].selected_solver_controls);
    if(!compatible){
      $('numProtocolStatus').textContent='Numerical results unavailable: this page and its result artifact have incompatible versions. Reload the complete deployment. No current numerical export is available; the other website modules remain independent.';
      $('numProtocolStatus').dataset.tone='error';
      $('numerical-verification').querySelector('.validation-columns').hidden=true;
      for(const id of ['numExportJSON','numExportCSV','numExportSVG','numModel','numStudy'])$(id).disabled=true;
      globalThis.ThermaNumericalDashboard={status:'unavailable',getReport:()=>null,getCSV:()=>null};
      return;
    }
    const passed=Object.values(D.gates).filter(v=>v===true).length;
    const p=D.models.lumped.parameters;
    $('numProtocolStatus').textContent=`${passed}/${Object.keys(D.gates).length} numerical checks meet the declared targets. Recorded case: ${p.n_gpus} GPUs, ${p.T_fac_in}°C facility supply, imposed flow ${p.m_dot} kg/s, and ${D.protocol.power_per_gpu_W.slice(0,-1).join(' → ')} W/GPU. Offline synthetic results; experimental predictive accuracy remains unverified.`;
    $('numGridSummary').innerHTML=tile('First grid meeting steady '+num(D.spatial.steady_target_C,4)+'°C target',D.spatial.first_steady_grid_meeting_target+' cells')+
      tile('Same-equation continuum steady limit',num(D.spatial.rows[0].continuum_temperature_C,4)+' °C');
    chart=gridChart();$('numGridChart').innerHTML=chart;
    $('numSpatialRows').innerHTML=D.spatial.rows.map(r=>`<tr><th>${r.cells}</th><td>${num(r.steady_temperature_C,4)}</td><td>${num(r.steady_continuum_error_C,5)}</td><td>${r.transient_peak_change_C==null?'—':num(r.transient_peak_change_C,5)}</td><td>${r.integrated_vs_discrete_error_C==null?'Analytical discrete reference':'LSODA vs discrete: '+sci(r.integrated_vs_discrete_error_C)+' °C'}</td></tr>`).join('');
    $('numCDUMetrics').innerHTML=field('Legacy field value = NTU',num(D.CDU.NTU,6))+
      field('1D historical default · '+D.CDU.mesh_cells+' cells · effectiveness',num(D.CDU.isothermal_effectiveness,6))+
      field('Lumped counterflow effectiveness',num(D.CDU.lumped_counterflow_effectiveness,6));
    $('numSourceSummary').textContent=`Artifact SHA-256: ${B.sha256}\nPython ${D.environment.python} · NumPy ${D.environment.numpy} · SciPy ${D.environment.scipy}\nSource files/configurations checked: ${Object.keys(D.sourceHashes).length}\nReproduce: python scripts/run_numerical_verification.py --compare science/numerical/results.json`;
    $('numLimitations').innerHTML=D.limitations.map(x=>`<li>${esc(x)}</li>`).join('');
    $('numModel').addEventListener('change',update);$('numStudy').addEventListener('change',update);
    $('numExportJSON').addEventListener('click',()=>download(JSON.stringify(D,null,2),'ThermaLoop_Numerical_Verification.json','application/json'));
    $('numExportCSV').addEventListener('click',()=>download(csv(),'ThermaLoop_Numerical_Convergence.csv','text/csv;charset=utf-8'));
    $('numExportSVG').addEventListener('click',()=>download(chart,'ThermaLoop_Spatial_Error.svg','image/svg+xml'));
    $('numModel').querySelector('[value="1d"]').textContent='1D · '+D.protocol.temporal_model_cells+' cells · fixed-temperature CDU sink';
    globalThis.ThermaNumericalDashboard={status:'ready',getReport:()=>D,getCSV:csv};update();
    for(const id of ['numExportJSON','numExportCSV','numExportSVG'])$(id).disabled=false;
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
