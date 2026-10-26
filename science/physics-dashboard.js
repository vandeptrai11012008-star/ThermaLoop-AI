/* Saved, independently checked physical-model cases; no change to the 3D engine. */
(()=>{
  'use strict';
  const D=globalThis.ThermaPhysicsData,B=globalThis.ThermaPhysicsBuild,$=id=>document.getElementById(id);
  const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(x,d=2)=>x==null?'Unavailable':Number(x).toLocaleString('en-US',{maximumFractionDigits:d});
  const sci=x=>x==null?'Unavailable':Number(x).toExponential(2);
  const field=(k,v)=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
  let selected=null,charts={};
  function lineChart(title,series,xLabel){
    const W=560,H=360,L=84,R=536,T=115,bot=295;
    const values=series.flatMap(s=>s.points),xs=values.map(p=>p[0]),ys=values.map(p=>p[1]);
    const loX=Math.min(...xs),hiX=Math.max(...xs),pad=Math.max(1,(Math.max(...ys)-Math.min(...ys))*.12);
    const loY=Math.min(...ys)-pad,hiY=Math.max(...ys)+pad;
    const x=v=>L+(v-loX)/(hiX-loX)*(R-L),y=v=>bot-(v-loY)/(hiY-loY)*(bot-T);
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)}; synthetic model predictions"><title>${esc(title)}; not measured temperatures</title><rect width="${W}" height="${H}" rx="10" fill="#0b1621"/><g fill="#adc5d0" font-family="Segoe UI,sans-serif" font-size="13"><text x="16" y="24">${esc(title)}</text>`+
      series.map((s,i)=>`<line x1="16" x2="33" y1="${46+i*21}" y2="${46+i*21}" stroke="${s.color}" stroke-width="2" ${s.dashed?'stroke-dasharray="4 4"':''}/><text x="40" y="${50+i*21}" font-size="13">${esc(s.label)}</text>`).join('')+
      [0,.25,.5,.75,1].map(f=>{const v=loY+f*(hiY-loY);return `<line x1="${L}" x2="${R}" y1="${y(v)}" y2="${y(v)}" stroke="#29424f"/><text x="73" y="${y(v)+4}" text-anchor="end">${num(v,1)}</text>`;}).join('')+
      series.map(s=>`<path d="${s.points.map((p,i)=>`${i?'L':'M'}${x(p[0]).toFixed(3)},${y(p[1]).toFixed(3)}`).join(' ')}" fill="none" stroke="${s.color}" stroke-width="2.3" ${s.dashed?'stroke-dasharray="5 5"':''}/>`).join('')+
      [0,.25,.5,.75,1].map(f=>`<text x="${L+f*(R-L)}" y="319" text-anchor="middle">${num(loX+f*(hiX-loX),3)}</text>`).join('')+
      `<text x="${(L+R)/2}" y="347" text-anchor="middle">${esc(xLabel)}</text><text transform="translate(18 205) rotate(-90)" text-anchor="middle">GPU die · °C</text></g></svg>`;
  }
  function update(){
    selected=D.cases.find(c=>c.primary_flow_kg_s===Number($('physFlow').value));
    if(!selected)throw new Error('Select a recorded primary-flow case');
    const c=selected,s=c.steady,e=c.energy;
    charts.steady=lineChart(`Steady predictions · ${c.cells} loop cells`,[
      {label:'Finite primary · FV',color:'#83dfd4',points:D.cases.map(x=>[x.primary_flow_kg_s,x.steady.T_die_C])},
      {label:'Legacy fixed bath',color:'#e6b58b',points:D.cases.map(x=>[x.primary_flow_kg_s,x.steady.legacy_fixed_sink_die_C])},
      {label:'Finite · continuum',color:'#9ca9ed',dashed:true,points:D.cases.map(x=>[x.primary_flow_kg_s,x.steady.continuum.T_die_C])}
    ],'Primary mass flow · kg/s');
    charts.transient=lineChart(`Identical prescribed heat pulse · ${num(c.primary_flow_kg_s,3)} kg/s`,[
      {label:'Finite primary',color:'#83dfd4',points:c.trace.time_s.map((t,i)=>[t,c.trace.die_C[i]])},
      {label:'Legacy fixed bath',color:'#e6b58b',points:c.trace.time_s.map((t,i)=>[t,c.trace.legacy_die_C[i]])}
    ],'Time · s');
    $('physSteadyChart').innerHTML=charts.steady;$('physTransientChart').innerHTML=charts.transient;
    $('physSteadyMetrics').innerHTML=field('Finite-primary steady die · same grid',num(s.T_die_C)+' °C')+
      field('Legacy fixed-bath steady die · same grid',num(s.legacy_fixed_sink_die_C)+' °C')+
      field('Finite-primary analytical continuum limit',num(s.continuum.T_die_C)+' °C')+
      field('Retained steady discretization error',num(s.discretization_error_C,3)+' °C')+
      field('Primary supply → CDU outlet',`${num(s.CDU_primary_inlet_C)} → ${num(s.CDU_primary_outlet_C)} °C`)+
      field('CDU effectiveness · finite grid / continuum',`${num(s.CDU_effectiveness_discrete,4)} / ${num(s.continuum.effectiveness,4)}`);
    $('physTransientMetrics').innerHTML=field('Finite-primary pulse peak die',num(c.peak_die_C)+' °C')+
      field('Primary CDU liquid hold-up · assumed',num(c.primary_volume_m3*1000)+' L')+
      field('All-state time-integrator error vs same-grid exponential',sci(c.solver.max_all_state_error_C)+' °C')+
      field('Heat input / rejected / stored increase',`${num(e.input_J/1000,3)} / ${num(e.rejected_J/1000,3)} / ${num(e.stored_change_J/1000,3)} kJ`)+
      field('Max integrated conservation residual',sci(e.max_integral_residual_J)+' J')+
      field('Min sampled interfacial entropy generation',num(e.min_interfacial_entropy_generation_W_K,5)+' W/K');
    $('physStatus').textContent=`${Object.values(D.gates).filter(Boolean).length}/${Object.keys(D.gates).length} declared checks passed. Selected: ${num(c.primary_flow_kg_s,3)} kg/s primary, ${num(D.parameters.m_dot,3)} kg/s secondary, ${c.cells} secondary / ${c.primary_cells} primary CDU cells. These predictions are not measured accuracy or demonstrated cooling savings.`;
    for(const id of ['physExportJSON','physExportCSV','physExportSVG'])$(id).disabled=false;
    $('physColumns').hidden=false;
  }
  function csv(){
    if(!selected)return null;
    const rows=[['# Finite-capacity CDU physical-model predictions; not measurements'],['# Result SHA-256',B.sha256],['# Power scope',D.protocol.power_scope],['study','primary_flow_kg_s','metric','time_s','value','unit']];
    for(const c of D.cases)for(const metric of ['T_die_C','legacy_fixed_sink_die_C','discretization_error_C','CDU_primary_outlet_C'])rows.push(['steady',c.primary_flow_kg_s,metric,'',c.steady[metric],'C']);
    for(let i=0;i<selected.trace.time_s.length;i++)for(const metric of ['die_C','legacy_die_C','primary_CDU_out_C','primary_return_buffer_C'])rows.push(['transient',selected.primary_flow_kg_s,metric,selected.trace.time_s[i],selected.trace[metric][i],'C']);
    for(const r of D.spatial)rows.push(['steady_mesh',D.protocol.primary_design_flow_kg_s,'error_'+r.cells+'_cells','',r.discretization_error_C,'C']);
    for(const r of D.primary_volume_sensitivity)rows.push(['primary_hold_up_assumption',r.primary_flow_kg_s,'peak_at_'+r.primary_volume_m3*1000+'_L','',r.peak_die_C,'C']);
    for(const [name,hash]of Object.entries(D.sourceHashes))rows.push(['source',name,'SHA-256','',hash,'']);
    return rows.map(r=>r.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\n');
  }
  function svg(){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1120 405"><title>Finite-capacity counterflow predictions; not experimental validation</title><rect width="1120" height="405" fill="#0b1621"/>${charts.steady.replace('<svg ','<svg x="0" y="0" width="560" height="360" ')}${charts.transient.replace('<svg ','<svg x="560" y="0" width="560" height="360" ')}<text x="18" y="381" fill="#adc5d0" font-size="12">Result SHA-256: ${B.sha256}</text><text x="18" y="399" fill="#adc5d0" font-size="12">Primary flow ${selected.primary_flow_kg_s} kg/s; primary hold-up ${selected.primary_volume_m3*1000} L assumed. Fixed properties/UA; retained grid error. No new measurements.</text></svg>`;}
  function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  function setup(){
    const compatible=D?.schemaVersion===1&&B?.schemaVersion===1&&Array.isArray(D.cases)&&D.cases.length>1&&D.cases.every(c=>c.steady?.continuum&&c.trace?.die_C&&c.energy)&&D.protocol&&D.gates;
    if(!compatible){$('physStatus').textContent='Physical-model artifacts have incompatible versions; results and exports are unavailable.';$('physColumns').hidden=true;for(const id of ['physFlow','physReset','physExportJSON','physExportCSV','physExportSVG'])$(id).disabled=true;globalThis.ThermaPhysicsDashboard={status:'unavailable',getReport:()=>null,getCSV:()=>null};return;}
    $('physFlow').innerHTML=D.cases.map(c=>`<option value="${c.primary_flow_kg_s}">${num(c.primary_flow_kg_s,3)} kg/s${c.primary_flow_kg_s===D.protocol.primary_design_flow_kg_s?' · design example':''}</option>`).join('');
    $('physFlow').value=String(D.protocol.primary_design_flow_kg_s);
    $('physAssumptions').textContent=`${D.protocol.n_gpus} reference GPUs; ${D.protocol.steady_power_per_gpu_W} W injected heat/GPU for steady comparison; ${D.protocol.power_per_gpu_W.filter((p,i,a)=>!i||p!==a[i-1]).join(' → ')} W/GPU pulse. UA ${num(D.parameters.UA_hx_total)} W/K and properties held fixed. ${num(D.protocol.primary_volume_m3*1000)} L primary CDU hold-up is assumed, not measured. Prescribed pumping work, host/network power and ambient losses are outside this heat ledger.`;
    $('physMeshRows').innerHTML=D.spatial.map(r=>`<tr><td>${r.cells} / ${r.primary_cells}</td><td>${num(r.T_die_C,4)}</td><td>${num(r.discretization_error_C,5)}</td><td>${r.discretization_error_C<=D.protocol.steady_discretization_target_C?'Within':'Above'} declared target</td></tr>`).join('');
    $('physMeshNote').textContent=`The first tested grid meeting the declared ${D.protocol.steady_discretization_target_C}°C steady target is ${D.first_grid_meeting_target} secondary cells. This applies to the design-flow steady case, not the displayed ${D.protocol.reported_cells}-cell transients or every operating condition.`;
    $('physVolumeRows').innerHTML=D.primary_volume_sensitivity.map(c=>`<tr><td>${num(c.primary_volume_m3*1000)} L · assumed</td><td>${num(c.steady.T_die_C,4)}</td><td>${num(c.peak_die_C,4)}</td></tr>`).join('');
    $('physLimits').innerHTML=D.limitations.map(s=>`<li>${esc(s)}</li>`).join('');
    $('physSources').innerHTML=D.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.id)}</a> · ${esc(s.kind)}<small>${esc(s.sha256)}<br>${esc(s.limitation)}</small></li>`).join('');
    $('physHash').textContent='Result SHA-256: '+B.sha256;
    $('physFlow').addEventListener('change',update);$('physReset').addEventListener('click',()=>{$('physFlow').value=String(D.protocol.primary_design_flow_kg_s);update();});
    $('physExportJSON').addEventListener('click',()=>{if(selected)download(JSON.stringify({selectedPrimaryFlow_kg_s:selected.primary_flow_kg_s,build:B,evidence:D},null,2),'ThermaLoop_Finite_Capacity_Physics.json','application/json');});
    $('physExportCSV').addEventListener('click',()=>{if(selected)download(csv(),'ThermaLoop_Finite_Capacity_Physics.csv','text/csv;charset=utf-8');});
    $('physExportSVG').addEventListener('click',()=>{if(selected)download(svg(),'ThermaLoop_Finite_Capacity_Physics.svg','image/svg+xml');});
    update();globalThis.ThermaPhysicsDashboard={status:'ready',getReport:()=>selected?{selectedPrimaryFlow_kg_s:selected.primary_flow_kg_s,build:B,evidence:D}:null,getCSV:csv};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
