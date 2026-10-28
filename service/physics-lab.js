/* Web Service-only physical laboratory. Every number comes from the same
 * simulation state/trace; this visualizer does not integrate physics itself. */
(()=>{
  'use strict';
  const M=globalThis.ThermaAgentSandbox,R=globalThis.ThermaValidatedResearch;
  const $=id=>document.getElementById(id),fmt=(x,n=2)=>Number.isFinite(x)?x.toFixed(n):'—';
  if(!M||!R){document.body.textContent='Physics engine unavailable. Please refresh the Web Service.';return;}
  let episode=null,report=null,displayed=null,selected='gpu',researchResult=null,worker=null;
  const labels={pump:'pumpLabel',fan:'fanLabel',recovery:'recoveryLabel',setpoint:'setpointLabel'};
  const descriptions={
    gpu:'Aggregate GPU thermal-capacitance state; one modeled temperature, not 64 independent GPU measurements.',
    coolant:'Single mixed coolant-loop thermal-capacitance state; no pressure, pipe network or spatial temperature field.',
    building:'Single occupied-room thermal-capacitance state; no humidity, air quality or multi-zone airflow.'
  };
  const values={gpu:'gpuC',coolant:'coolantC',building:'buildingC'};
  const stateFrom=(observation)=>({minute:observation.minute,horizonMinutes:observation.horizonMinutes,
    state:observation.state,siteKW:observation.lastPowerKW,recoveredKW:observation.lastRecoveredHeatKW,
    energyKWh:observation.metrics?.siteElectricKWh??0,controls:observation.controls,
    violations:observation.violations??[]});
  function updateInspector(){if(!displayed)return;
    const v=displayed.state[values[selected]];
    $('nodeInspector').textContent=`${selected.toUpperCase()} · ${fmt(v)} °C. ${descriptions[selected]}`;
  }
  function drawWorld(snapshot){
    displayed=snapshot;
    $('minuteBadge').textContent=`${snapshot.minute} / ${snapshot.horizonMinutes} min`;
    $('svgGpu').textContent=fmt(snapshot.state.gpuC)+' °C';
    $('svgCoolant').textContent=fmt(snapshot.state.coolantC)+' °C';
    $('svgBuilding').textContent=fmt(snapshot.state.buildingC)+' °C';
    $('svgGpu').style.fill=snapshot.state.gpuC>85?'#f9a59e':'#e8faf4';
    $('svgCoolant').style.fill=snapshot.state.coolantC>50?'#f9a59e':'#e8faf4';
    $('svgBuilding').style.fill=snapshot.state.buildingC<18||snapshot.state.buildingC>26?'#f9a59e':'#e8faf4';
    for(const [node,key,lo,hi] of [['gpu','gpuC',-Infinity,85],['coolant','coolantC',-Infinity,50],['building','buildingC',18,26]]){
      const g=document.querySelector(`[data-node="${node}"]`),v=snapshot.state[key];
      g.dataset.violation=String(v<lo||v>hi);
      g.setAttribute('aria-label',`Inspect ${node} node, ${fmt(v)} degrees Celsius`);
    }
    const readings=[['GPU junction proxy',snapshot.state.gpuC,'°C',snapshot.state.gpuC>85],
      ['Coolant',snapshot.state.coolantC,'°C',snapshot.state.coolantC>50],
      ['Room',snapshot.state.buildingC,'°C',snapshot.state.buildingC<18||snapshot.state.buildingC>26],
      ['Site electricity',snapshot.energyKWh,'kWh',false]];
    $('stateReadings').replaceChildren(...readings.map(([name,val,unit,warn])=>{
      const box=document.createElement('div');if(warn)box.className='warn';
      const label=document.createElement('small'),strong=document.createElement('strong');
      label.textContent=name;strong.textContent=`${fmt(val)} ${unit}`;box.append(label,strong);return box;
    }));
    updateInspector();
  }
  function drawTrace(){
    if(!report)return;
    const rows=report.trace,svg=$('traceChart'),min= Math.min(15,...rows.flatMap(r=>[r.gpuC,r.coolantC,r.buildingC])),
      max=Math.max(55,...rows.flatMap(r=>[r.gpuC,r.coolantC,r.buildingC]));
    const L=45,RX=776,T=18,B=196,lo=Math.floor(min/5)*5-2,hi=Math.ceil(max/5)*5+2;
    const x=m=>L+(m/report.horizonMinutes)*(RX-L),y=v=>B-(v-lo)/(hi-lo)*(B-T);
    const ns='http://www.w3.org/2000/svg';svg.replaceChildren();
    const add=(tag,attrs,text)=>{const e=document.createElementNS(ns,tag);for(const [k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;svg.append(e);return e;};
    for(let i=0;i<5;i++){const value=lo+(hi-lo)*i/4,yy=y(value);
      add('line',{class:'gridline',x1:L,x2:RX,y1:yy,y2:yy});add('text',{x:4,y:yy+4},fmt(value,0)+'°');}
    for(const [key,cls] of [['gpuC','gpu'],['coolantC','coolant'],['buildingC','building']]){
      const d=rows.map((r,i)=>`${i?'L':'M'}${fmt(x(r.minute),2)},${fmt(y(r[key]),2)}`).join(' ');
      add('path',{class:'trace '+cls,d});
    }
    add('text',{x:L,y:221},'0 min');add('text',{x:RX-44,y:221},`${report.horizonMinutes} min`);
  }
  function showTraceMinute(minute){if(!report)return;
    const r=report.trace[minute];if(!r)return;
    $('replayLabel').textContent=String(minute);
    drawWorld({minute:r.minute,horizonMinutes:report.horizonMinutes,
      state:{gpuC:r.gpuC,coolantC:r.coolantC,buildingC:r.buildingC},
      siteKW:r.siteKW,recoveredKW:r.recoveredKW,
      energyKWh:minute===report.minute?report.metrics.siteElectricKWh:null,
      controls:null,violations:[]});
    $('traceMessage').textContent=`Historical observation at minute ${minute}. Active episode remains at minute ${report.minute}.`;
  }
  function refresh(){
    const o=M.observeEpisode(episode);report=M.episodeReport(episode);
    drawWorld(stateFrom(o));drawTrace();
    $('replayMinute').max=String(o.minute);$('replayMinute').value=String(o.minute);
    $('replayLabel').textContent=String(o.minute);
    $('traceMessage').textContent=`${report.trace.length} observations recorded · ${o.violations.length} constraint type(s) violated · max energy residual ${o.maxEnergyResidualKJ.toExponential(2)} kJ.`;
    for(const id of ['stepOne','stepFive','feedback'])$(id).disabled=o.done;
    $('exportEpisode').disabled=false;
    $('controlStatus').textContent=o.done?'Episode complete. Reset to start a new physical experiment.':
      `Minute ${o.minute}. Controls affect the next step; no hardware is connected.`;
    $('controlStatus').dataset.error=String(o.violations.length>0);
  }
  function readScenario(){
    for(const id of ['seed','horizon'])if(!$(id).value.trim())throw Error('Seed and horizon are required');
    const scenario={preset:$('preset').value,seed:Number($('seed').value),horizonMinutes:Number($('horizon').value)};
    M.startEpisode({scenario});R.normalize({scenario,trials:2});return scenario;
  }
  function readControls(){return {gpuPowerLimitPct:100,ventilationACH:0.6,
    pumpPct:Number($('pump').value),fanPct:Number($('fan').value),
    heatRecoveryPct:Number($('recovery').value),heatingSetpointC:Number($('setpoint').value)};}
  function setControls(c){for(const [id,key]of [['pump','pumpPct'],['fan','fanPct'],['recovery','heatRecoveryPct'],['setpoint','heatingSetpointC']]){
    if(c[key]!==undefined)$(id).value=String(c[key]);}updateLabels();}
  function updateLabels(){for(const [id,label]of Object.entries(labels))$(label).textContent=
    $(id).value+(id==='setpoint'?' °C':'%');}
  function start(){
    try{episode=M.startEpisode({schemaVersion:1,scenario:readScenario()});refresh();}
    catch(e){$('controlStatus').textContent=e.message;$('controlStatus').dataset.error='true';}
  }
  function advance(minutes,controls){
    if(!episode)throw Error('Start an episode first');
    const o=M.observeEpisode(episode);if(o.done)return;
    M.stepEpisode(episode,{minutes:Math.min(minutes,o.horizonMinutes-o.minute),
      expectedMinute:o.minute,controls});refresh();
  }
  function step(minutes){try{advance(minutes,readControls());}
    catch(e){$('controlStatus').textContent=e.message;$('controlStatus').dataset.error='true';}}
  function feedback(){
    try{if(!episode)throw Error('Start an episode first');
      for(let i=0;i<10;i++){
        const o=M.observeEpisode(episode);if(o.done)break;
        const patch={gpuPowerLimitPct:100,ventilationACH:0.6,
          pumpPct:o.state.gpuC>75?100:o.state.gpuC>65?85:70,
          fanPct:o.state.coolantC>44?100:o.state.coolantC>38?90:70,
          heatRecoveryPct:o.state.buildingC<20.8?95:50,
          heatingSetpointC:21};
        M.stepEpisode(episode,{expectedMinute:o.minute,minutes:1,controls:patch});
        setControls(patch);
      }
      refresh();$('controlStatus').textContent+=' Ten steps used a transparent fixed feedback rule, not a trained AI.';
    }catch(e){$('controlStatus').textContent=e.message;$('controlStatus').dataset.error='true';}
  }
  function download(data,name){const blob=new Blob([JSON.stringify(data,null,2)],{type:'application/json'}),url=URL.createObjectURL(blob);
    const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function renderResearch(result){
    researchResult=result;$('researchResults').hidden=false;$('exportResearch').disabled=false;
    $('loadWinner').disabled=!result.best;
    $('researchStats').innerHTML=`<div><small>Trials</small><strong>${result.trialCount}</strong></div><div><small>Fair candidates</small><strong>${result.eligibleCount}</strong></div>`;
    $('researchVerdict').textContent=!result.best?'No terminal-matched candidate found':
      `${result.best.energySavedKWh>=0?'+':''}${fmt(result.best.energySavedKWh)} kWh on training seed · ${result.validatedImprovement?'passed':'did not pass'} both held-out checks`;
    $('researchVerdict').style.color=result.validatedImprovement?'#a6edd3':'#f3b791';
    $('researchHoldouts').textContent=result.holdouts.map(h=>`Seed ${h.seed}: ${h.eligible?'eligible':'rejected'} · ${fmt(h.energySavedKWh)} kWh · room Δ ${fmt(h.terminal.deltaC.buildingC)} °C`).join('\n')||'No holdout runs selected.';
    $('researchRows').replaceChildren(...result.trials.map(r=>{
      const tr=document.createElement('tr');for(const val of [String(r.trial+1),r.eligible?'Yes':'No',fmt(r.energySavedKWh),fmt(r.terminal.deltaC.buildingC)]){
        const td=document.createElement('td');td.textContent=val;tr.append(td);}return tr;
    }));
    $('researchStatus').textContent='Search complete. Export the full report to preserve every trial and declared tolerance.';
  }
  function runResearch(){
    if(worker)return;
    let config;try{config=R.normalize({schemaVersion:1,scenario:readScenario(),trials:Number($('trials').value)});}
    catch(e){$('researchStatus').textContent=e.message;$('researchStatus').dataset.error='true';return;}
    $('runResearch').disabled=true;$('cancelResearch').disabled=false;$('exportResearch').disabled=true;
    $('researchResults').hidden=true;$('researchProgress').max=config.trials;$('researchProgress').value=0;
    $('researchStatus').textContent='Evaluating candidate plans against paired thermal states…';
    const active=new Worker('/service/physics-lab-worker.js');worker=active;
    const timer=setTimeout(()=>{if(worker!==active)return;active.terminate();worker=null;
      $('runResearch').disabled=false;$('cancelResearch').disabled=true;$('researchStatus').textContent='Time budget exceeded. Try fewer trials.';},15000);
    const done=()=>{clearTimeout(timer);active.terminate();if(worker===active)worker=null;
      $('runResearch').disabled=false;$('cancelResearch').disabled=true;};
    active.onmessage=e=>{
      if(e.data.type==='progress'){$('researchProgress').value=e.data.progress.completed;
        $('researchStatus').textContent=`${e.data.progress.completed} / ${config.trials} plans tested`;}
      else if(e.data.type==='complete'){renderResearch(e.data.result);done();}
      else if(e.data.type==='error'){$('researchStatus').textContent=e.data.error;done();}
    };
    active.onerror=()=>{$('researchStatus').textContent='Research worker could not load. Verify Web Service assets.';done();};
    active.postMessage(config);
  }
  function cancelResearch(){if(!worker)return;worker.terminate();worker=null;
    $('runResearch').disabled=false;$('cancelResearch').disabled=true;$('researchStatus').textContent='Search cancelled; no partial result claimed.';}
  function initialize(){
    for(const id of Object.keys(labels))$(id).addEventListener('input',updateLabels);
    $('start').addEventListener('click',start);$('stepOne').addEventListener('click',()=>step(1));
    $('stepFive').addEventListener('click',()=>step(5));$('feedback').addEventListener('click',feedback);
    $('exportEpisode').addEventListener('click',()=>{if(report)download(report,'thermaloop-physics-episode-v14.json');});
    $('replayMinute').addEventListener('input',()=>showTraceMinute(Number($('replayMinute').value)));
    $('runResearch').addEventListener('click',runResearch);$('cancelResearch').addEventListener('click',cancelResearch);
    $('exportResearch').addEventListener('click',()=>{if(researchResult)download(researchResult,'thermaloop-fair-research-v14.json');});
    $('loadWinner').addEventListener('click',()=>{if(!researchResult?.best?.plan[0])return;
      setControls(researchResult.best.plan[0].controls);$('controlStatus').textContent='Winning controls loaded. Reset and step to replay them.';});
    document.querySelectorAll('[data-node]').forEach(el=>{
      const inspect=()=>{selected=el.dataset.node;updateInspector();};el.addEventListener('click',inspect);
      el.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect();}});
    });
    updateLabels();start();
    globalThis.ThermaPhysicsLab={getEpisodeReport:()=>report?structuredClone(report):null,
      getResearchResult:()=>researchResult?structuredClone(researchResult):null,
      getDisplayedState:()=>displayed?structuredClone(displayed):null};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();
