/* Additive held-out routing / reservation replay UI; original engines are independent. */
(()=>{
  'use strict';
  const D=globalThis.ThermaWorkloadData,M=globalThis.ThermaWorkloads,B=globalThis.ThermaWorkloadBuild,S=globalThis.ThermaWorkloadSweep;
  const $=id=>document.getElementById(id),esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const num=(x,d=2)=>x==null?'Unavailable':Number(x).toLocaleString('en-US',{maximumFractionDigits:d});
  const signed=x=>(x>0?'+':'')+num(x);
  const names={fifo_first:'FIFO · first-fit',fifo_best:'FIFO · best-fit',backfill_first:'Greedy backfill · first-fit',backfill_best:'Greedy backfill · best-fit'};
  const field=(k,v)=>`<dt>${esc(k)}</dt><dd>${esc(v)}</dd>`;
  let current=null,charts={};
  function bars(title,values,unit,max){
    max=max??Math.max(1,...values.map(v=>v.value))*1.1;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 540 260" role="img" aria-label="${esc(title)}"><title>${esc(title)}</title><rect width="540" height="260" rx="10" fill="#0b1621"/><g font-family="Segoe UI,sans-serif" font-size="13" fill="#adc5d0"><text x="18" y="26">${esc(title)}</text>`+
      values.map((v,i)=>`<text x="18" y="${53+i*47}">${esc(v.label)}</text><text x="520" y="${53+i*47}" text-anchor="end" fill="#e5f4f3">${num(v.value)} ${esc(unit)}</text><rect x="18" y="${63+i*47}" width="502" height="10" rx="5" fill="#1b303e"/><rect x="18" y="${63+i*47}" width="${502*v.value/max}" height="10" rx="5" fill="${v.color}"/>`).join('')+
      `<text x="18" y="248">0</text><text x="520" y="248" text-anchor="end">Scale 0–${num(max)} ${esc(unit)}</text></g></svg>`;
  }
  function render(result){
    const r=result.routing,s=result.scheduling,a=r.accuraciesPct;
    $('wlRouterMetrics').innerHTML=field('Held-out questions',num(r.testCount,0))+field('Weak / strong calls',`${r.weakCalls} / ${r.strongCalls}`)+
      field('Calibration target → realized test weak share',`${num(r.targetWeakShare*100)}% → ${num(r.realizedWeakShare*100)}%`)+
      field('Learned − always strong',`${signed(r.learnedMinusStrong.meanPP)} pp · 95% [${num(r.learnedMinusStrong.lowPP)}, ${num(r.learnedMinusStrong.highPP)}]`)+
      field('Learned − expected matched-random accuracy',`${signed(r.learnedMinusExpectedRandom.meanPP)} pp · 95% [${num(r.learnedMinusExpectedRandom.lowPP)}, ${num(r.learnedMinusExpectedRandom.highPP)}]`);
    charts.routing=bars('Held-out cached-outcome accuracy',[
      {label:'Always strong · quality reference',value:a.strong,color:'#e5b78d'},
      {label:'Always weak · no strong-model calls',value:a.weak,color:'#8095b0'},
      {label:'Matched random · exact expectation',value:a.randomExpected,color:'#75c8ec'},
      {label:'Learned text router',value:a.learned,color:'#80ded2'}],'%',100);
    $('wlRouterChart').innerHTML=charts.routing;
    const v=r.randomSeedVariation;
    $('wlRouterNote').textContent=`Same ${r.weakCalls} weak calls for the learned and random controls. Main random baseline is its exact matched-quota expectation; fixed seed 0 gives ${num(a.random)}%. Across all ${v.count} declared seeds: mean ${num(v.meanAccuracyPct)}%, range ${num(v.minAccuracyPct)}–${num(v.maxAccuracyPct)}%; this range is not a confidence interval. Intervals condition on this split, fitted model and quota. A non-significant loss is not proof of equivalent quality. Call share is not measured energy, latency or cost saving.`;
    $('wlSchedulerRows').innerHTML=s.map(x=>`<tr><th scope="row">${esc(names[x.policy])}</th><td>${num(x.meanWaitSeconds)}</td><td>${num(x.p95WaitSeconds)}</td><td>${num(x.maxWaitSeconds)}</td><td>${num(x.meanReservedCapacityPct)}%</td><td>${x.released}/${x.reservations}</td></tr>`).join('');
    charts.scheduling=bars('Counterfactual mean reservation wait',s.map((x,i)=>({label:names[x.policy],value:x.meanWaitSeconds,color:['#e5b78d','#8095b0','#75c8ec','#80ded2'][i]})),'s');
    $('wlSchedulerChart').innerHTML=charts.scheduling;
    const baseline=s[0],candidate=s.find(x=>x.policy==='backfill_best');
    $('wlSchedulerNote').textContent=baseline.meanWaitSeconds===0&&candidate.meanWaitSeconds===0?
      'No waiting in either primary arm at this trace rate/capacity: no scheduling benefit is established here. A zero bar is a zero result. The 10× arrival option is a synthetic stress scenario, not an observed trace rate.':
      `Backfill + best-fit changes mean wait by ${signed(candidate.meanWaitSeconds-baseline.meanWaitSeconds)} s and maximum wait by ${signed(candidate.maxWaitSeconds-baseline.maxWaitSeconds)} s vs FIFO + first-fit. Lower mean wait need not improve the worst wait; greedy backfill has no head-of-line start guarantee.`;
    $('wlStatus').textContent=`${Object.values(result.checks).every(Boolean)?'Accounting checks passed':'Accounting check failed'} · ${result.parameters.gpuSlots} assumed identical GPU slots · ${result.parameters.arrivalScale===1?'original eligible-trace arrival spacing':'10× arrivals: synthetic stress; reservation lengths unchanged'}. These experiments do not establish end-to-end ThermaLoop savings.`;
    $('wlColumns').hidden=false;
    for(const id of ['wlExportJSON','wlExportCSV','wlExportSVG'])$(id).disabled=false;
  }
  function run(){
    try{
      const result=M.experiment(D,{weakShare:Number($('wlWeakShare').value),gpuSlots:Number($('wlGpuSlots').value),arrivalScale:Number($('wlArrivalScale').value)});
      current={...result,protocol:D.protocol,routerAudit:{method:D.routing.method,partitions:D.routing.partitions,fittedModel:D.routing.fittedModel},
        traceAudit:{originalCount:D.scheduling.originalCount,excluded:D.scheduling.excluded,sourcePhases:D.scheduling.sourcePhases,scope:D.scheduling.scope},
        sourceHashes:D.sourceHashes,build:B};
      render(current);
    }catch(error){current=null;$('wlColumns').hidden=true;$('wlStatus').textContent='Experiment unavailable: '+error.message;for(const id of ['wlExportJSON','wlExportCSV','wlExportSVG'])$(id).disabled=true;}
  }
  function csv(){
    if(!current)return null;
    const rows=[['# Public workload replay; no measured energy, latency or end-to-end savings'],['# Input SHA-256',B.inputSHA256],['# Engine SHA-256',B.engineSHA256],['# Parameters',JSON.stringify(current.parameters)],['# Scheduler scope',D.scheduling.scope],
      ['experiment','policy','record_id','source_phase','metric','value','unit']];
    for(const r of current.routing.rows){
      for(const [metric,value]of Object.entries({score:r.score,useWeak:+r.useWeak,randomUseWeak:+r.randomUseWeak,strongCorrect:r.strongCorrect,weakCorrect:r.weakCorrect,learnedCorrect:r.learnedCorrect,randomCorrect:r.randomCorrect}))rows.push(['held_out_routing','frozen_ridge_router',r.id,'cached_model_outcome',metric,value,'score_or_boolean']);
    }
    for(const s of current.scheduling){
      for(const metric of ['meanWaitSeconds','p95WaitSeconds','maxWaitSeconds'])rows.push(['reservation_replay',s.policy,'','all retained phases',metric,s[metric],'s']);
      for(const j of s.jobs){
        for(const metric of ['arrivalSeconds','startSeconds','releaseSeconds','waitSeconds','reservationSeconds'])rows.push(['reservation_replay',s.policy,j.id,j.sourcePhase,metric,j[metric],'s']);
        rows.push(['reservation_replay',s.policy,j.id,j.sourcePhase,'gpu_request',j.gpuMilli,'mGPU']);
        rows.push(['reservation_replay',s.policy,j.id,j.sourcePhase,'assigned_slot',j.slot,'zero-based index']);
      }
    }
    for(const [file,hash]of Object.entries(D.sourceHashes))rows.push(['source',file,'','','SHA-256',hash,'']);
    return rows.map(row=>row.map(x=>'"'+String(x??'').replaceAll('"','""')+'"').join(',')).join('\n');
  }
  function svg(){return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 310"><title>Public workload replay: cached accuracy and counterfactual reservation wait, not measured savings</title><rect width="1080" height="310" fill="#0b1621"/>${charts.routing.replace('<svg ','<svg x="0" y="0" width="540" height="260" ')}${charts.scheduling.replace('<svg ','<svg x="540" y="0" width="540" height="260" ')}<text x="18" y="283" fill="#adc5d0" font-size="12">Input SHA-256: ${B.inputSHA256}</text><text x="18" y="302" fill="#adc5d0" font-size="12">${esc(JSON.stringify(current.parameters))} · recorded residence is a reservation proxy; no measured energy or latency</text></svg>`;}
  function download(content,name,type){const url=URL.createObjectURL(new Blob([content],{type})),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),2000);}
  function setup(){
    const compatible=D?.schemaVersion===1&&B?.schemaVersion===1&&S?.inputSHA256===B.inputSHA256&&M?.VERSION==='1.0.0'&&D.routing?.testRecords?.length&&D.scheduling?.records?.length;
    if(!compatible){$('wlStatus').textContent='Workload artifacts have incompatible versions; results and exports are unavailable.';$('wlColumns').hidden=true;for(const id of ['wlRun','wlReset','wlExportJSON','wlExportCSV','wlExportSVG'])$(id).disabled=true;globalThis.ThermaWorkloadDashboard={status:'unavailable',getReport:()=>null,getCSV:()=>null};return;}
    const p=D.routing.partitions;
    $('wlSplitStatus').textContent=`${p.train.length} training · ${p.calibration.length} calibration · ${p.test.length} test questions. Normalized duplicate prompts stay in one partition. TF-IDF statistics and ridge coefficients use training only; score thresholds use calibration only. The three budgets were fixed before this evaluation; they are not test-set tuning controls.`;
    $('wlTraceStatus').textContent=`${D.scheduling.records.length} eligible terminated reservations from ${D.scheduling.originalCount} source tasks: ${D.scheduling.sourcePhases.Succeeded} Succeeded and ${D.scheduling.sourcePhases.Failed} Failed. Excluded running/pending tasks and invalid intervals are not fabricated. Deletion − scheduled time is a residence proxy; simulated release does not turn a failed task into successful work.`;
    $('wlSchedulerPhase').textContent=`Source phases: ${num(D.scheduling.sourcePhases.Succeeded,0)} Succeeded / ${num(D.scheduling.sourcePhases.Failed,0)} Failed. Resource release is not successful work completion.`;
    $('wlSweepRows').innerHTML=S.scheduling.map(s=>`<tr><td>${s.slots}</td><td>${s.arrivalScale===1?'Original spacing':'10× synthetic arrivals'}</td><td>${esc(names[s.policy])}</td><td>${num(s.meanWaitSeconds)}</td><td>${num(s.p95WaitSeconds)}</td><td>${num(s.maxWaitSeconds)}</td></tr>`).join('');
    $('wlSourceRows').innerHTML=D.sources.map(s=>`<li><a href="${esc(s.url)}" target="_blank" rel="noopener">${esc(s.id)}</a> · ${esc(s.kind)}<small>${esc(s.sha256)}<br>${esc(s.license)}</small></li>`).join('');
    $('wlInputHash').textContent='Input SHA-256: '+B.inputSHA256;
    $('wlRun').addEventListener('click',run);
    $('wlReset').addEventListener('click',()=>{$('wlWeakShare').value=String(D.protocol.primaryWeakShare);$('wlGpuSlots').value=String(D.protocol.primaryGpuSlots);$('wlArrivalScale').value=String(D.protocol.primaryArrivalScale);run();});
    $('wlExportJSON').addEventListener('click',()=>{if(current)download(JSON.stringify(current,null,2),'ThermaLoop_Public_Workload_Experiment.json','application/json');});
    $('wlExportCSV').addEventListener('click',()=>{if(current)download(csv(),'ThermaLoop_Public_Workload_Records.csv','text/csv;charset=utf-8');});
    $('wlExportSVG').addEventListener('click',()=>{if(current)download(svg(),'ThermaLoop_Public_Workload_Comparison.svg','image/svg+xml');});
    run();globalThis.ThermaWorkloadDashboard={status:'ready',getReport:()=>current,getCSV:csv};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
