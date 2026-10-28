/* A new workspace, independent of the retained campus and evidence dashboards. */
(()=>{
  'use strict';
  const M=globalThis.ThermaAgentSandbox,$=id=>document.getElementById(id);
  const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const fmt=(n,d=2)=>Number(n).toLocaleString('en-US',{maximumFractionDigits:d});
  let report=null,busy=false,episode=null,liveLog=[];
  function download(data,name){const u=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=u;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(u),1500);}
  function request(){return {schemaVersion:1,scenario:{preset:$('agentPreset').value,
    seed:Number($('agentSeed').value),horizonMinutes:Number($('agentHorizon').value)},plan:JSON.parse($('agentPlan').value)};}
  function invalidate(){report=null;$('agentResults').hidden=true;$('agentEmpty').hidden=false;$('agentExport').disabled=true;$('agentStatus').dataset.error='false';$('agentStatus').textContent='Inputs changed. Run a new comparison to produce matching evidence.';}
  function chart(title,key,unit,limits=[]){
    const traces=[{rows:report.baseline.trace,color:'#8cabc1',dash:true,name:'Baseline'},
      {rows:report.candidate.trace,color:'#8de9cb',name:'Candidate'}];
    const W=660,H=235,L=56,R=636,T=60,B=192;
    const values=traces.flatMap(t=>t.rows.map(r=>r[key]).filter(v=>v!==null)).concat(limits.map(l=>l.value));
    const pad=Math.max(1,(Math.max(...values)-Math.min(...values))*.12);
    const low=Math.min(...values)-pad,high=Math.max(...values)+pad;
    const px=t=>L+t/report.request.scenario.horizonMinutes*(R-L),py=v=>B-(v-low)/(high-low)*(B-T);
    return `<svg viewBox="0 0 ${W} ${H}" role="img" aria-label="${esc(title)} baseline and candidate over simulated minutes"><title>${esc(title)} — uncalibrated predictions</title><g font-family="Segoe UI,sans-serif" font-size="12" fill="#a9c2d0"><text x="18" y="24" fill="#d9ebf3" font-size="14">${esc(title)} · ${esc(unit)}</text><text x="380" y="24" fill="#8cabc1">-- Baseline</text><text x="495" y="24" fill="#8de9cb">— Candidate</text>`+
      [0,.5,1].map(f=>{const v=low+(high-low)*f;return `<line x1="${L}" x2="${R}" y1="${py(v)}" y2="${py(v)}" stroke="#253e4c"/><text x="45" y="${py(v)+4}" text-anchor="end">${fmt(v,1)}</text>`;}).join('')+
      limits.map(l=>`<line x1="${L}" x2="${R}" y1="${py(l.value)}" y2="${py(l.value)}" stroke="#b98e69" stroke-dasharray="3 5"/><text x="${R}" y="${py(l.value)-5}" text-anchor="end" fill="#d3ac85">${esc(l.label)}</text>`).join('')+
      traces.map(t=>`<path d="${t.rows.filter(r=>r[key]!==null).map((r,i)=>`${i?'L':'M'}${px(r.minute).toFixed(2)},${py(r[key]).toFixed(2)}`).join(' ')}" fill="none" stroke="${t.color}" stroke-width="2.2" ${t.dash?'stroke-dasharray="6 5"':''}/>`).join('')+
      [0,.25,.5,.75,1].map(f=>`<text x="${px(f*report.request.scenario.horizonMinutes)}" y="214" text-anchor="middle">${fmt(f*report.request.scenario.horizonMinutes,0)}</text>`).join('')+
      '<text x="640" y="231" text-anchor="end" font-size="10">Simulated minutes</text></g></svg>';
  }
  function scrub(){if(!report)return;const minute=Number($('agentMinute').value),r=report.candidate.trace[minute];$('agentMinuteLabel').textContent=`Inspect candidate · minute ${minute}`;$('agentState').textContent=`GPU ${fmt(r.gpuC)} °C  ·  Coolant ${fmt(r.coolantC)} °C  ·  Building ${fmt(r.buildingC)} °C${r.siteKW===null?'':`  ·  Site ${fmt(r.siteKW)} kW`}`;}
  function render(){
    const r=report,b=r.baseline.metrics,c=r.candidate.metrics;
    $('agentEmpty').hidden=true;$('agentResults').hidden=false;$('agentExport').disabled=false;
    $('agentVerdict').dataset.status=r.verdict.status;
    $('agentVerdict').textContent=r.verdict.status==='within_tested_envelope'?'Within tested envelope':'Needs revision';
    $('agentRunMeta').textContent=`${r.request.scenario.preset} · ${r.request.scenario.horizonMinutes} min · seed ${r.request.scenario.seed} · engine ${r.engineVersion}`;
    $('agentMetrics').innerHTML=[
      ['Site electricity',fmt(c.siteElectricKWh)+' kWh',`Baseline ${fmt(b.siteElectricKWh)} kWh · ${fmt(r.comparison.energySavedKWh)} kWh saved`],
      ['Compute-service ratio',fmt(100*r.comparison.computeServiceRatio,1)+'%', 'Candidate / baseline · utilization proxy, not a job SLA'],
      ['Useful recovered heat',fmt(c.usefulHeatKWh)+' kWh',`Baseline ${fmt(b.usefulHeatKWh)} kWh`]
    ].map(([label,value,note])=>`<div class="agent-metric"><small>${esc(label)}</small><strong>${esc(value)}</strong><span>${esc(note)}</span></div>`).join('');
    $('agentGPUChart').innerHTML=chart('GPU temperature','gpuC','°C',[{value:85,label:'85 °C limit'}]);
    $('agentBuildingChart').innerHTML=chart('Building temperature','buildingC','°C',[{value:18,label:'18 °C lower limit'},{value:26,label:'26 °C upper limit'}]);
    $('agentPowerChart').innerHTML=chart('Site electricity','siteKW','kW');
    $('agentMinute').max=String(r.request.scenario.horizonMinutes);$('agentMinute').value='0';scrub();
    const checks=[{text:r.verdict.constraintsPassed?'Temperature, ventilation and power limits passed in all three tested parameter cases.':'One or more physical constraints failed.',ok:r.verdict.constraintsPassed},
      {text:r.verdict.serviceMaintained?'Compute-service proxy retained at least 99% of each paired baseline.':'Electricity reduction includes a loss of compute-service proxy beyond the 1% tolerance.',ok:r.verdict.serviceMaintained},
      {text:`Nominal thermal energy residual: ${r.candidate.maxEnergyResidualKJ.toExponential(2)} kJ.`,ok:r.verdict.conservationPassed}];
    for(const v of r.candidate.violations)checks.push({text:`Nominal: ${v.code} · first at ${fmt(v.firstMinute)} min · duration ${fmt(v.durationMinutes)} min.`,ok:false});
    for(const test of r.stressTests)for(const v of test.violations)checks.push({text:`Sensitivity ×${test.parameterScale}: ${v.code} · first at ${fmt(v.firstMinute)} min.`,ok:false});
    $('agentChecks').innerHTML=checks.map(x=>`<li class="${x.ok?'':'agent-warning'}">${esc(x.text)}</li>`).join('');
    $('agentLimits').innerHTML=r.limitations.map(x=>`<li>${esc(x)}</li>`).join('');
    $('agentEvents').textContent=JSON.stringify(r.candidate.events,null,2);
    $('agentStatus').textContent='Comparison complete. Export the report to retain the exact request, time series and checks.';
    $('agentStatus').dataset.error='false';
  }
  function compute(input){
    if(location.protocol==='file:'||typeof Worker==='undefined')return new Promise((resolve,reject)=>setTimeout(()=>{try{resolve(M.evaluate(input));}catch(e){reject(e);}},0));
    return new Promise((resolve,reject)=>{
      const worker=new Worker('science/agent-sandbox-worker.js');
      const timer=setTimeout(()=>{worker.terminate();reject(new Error('Simulation time budget exceeded'));},15000);
      worker.onmessage=event=>{clearTimeout(timer);worker.terminate();event.data.ok?resolve(event.data.result):reject(new Error(event.data.error));};
      worker.onerror=()=>{clearTimeout(timer);worker.terminate();reject(new Error('Simulation worker unavailable. Check that the sandbox assets were deployed.'));};
      worker.postMessage(input);
    });
  }
  async function run(){
    if(busy)return;
    invalidate();let input;
    try{
      for(const id of ['agentSeed','agentHorizon'])if(!$(id).value.trim())throw new Error('Seed and horizon are required');
      input=request();M.normalize(input);
    }catch(e){$('agentStatus').textContent=e.message;$('agentStatus').dataset.error='true';return;}
    busy=true;const fields=$('agentSetup').querySelectorAll('input,select,textarea,button');fields.forEach(e=>e.disabled=true);
    $('agentStatus').textContent='Running paired baseline, candidate and sensitivity cases…';
    try{report=await compute(input);render();}catch(e){report=null;$('agentStatus').textContent=e.message;$('agentStatus').dataset.error='true';}
    finally{busy=false;fields.forEach(e=>e.disabled=false);}
  }
  function invalidateLive(){
    episode=null;liveLog=[];
    $('agentLiveStep').disabled=true;$('agentLiveAuto').disabled=true;$('agentLiveExport').disabled=true;
    $('agentLiveState').textContent='No active episode. Start a simulation to observe its initial state.';
    $('agentLiveHistory').textContent='';$('agentLiveStatus').textContent='Ready for a new simulated episode.';
    $('agentLiveStatus').dataset.error='false';
  }
  function renderLive(){
    const o=M.observeEpisode(episode),m=o.metrics;
    $('agentLiveState').innerHTML=`<div><small>Simulated minute</small><strong>${o.minute} / ${o.horizonMinutes}</strong></div>`+
      [['GPU',o.state.gpuC,'°C'],['Coolant',o.state.coolantC,'°C'],['Building',o.state.buildingC,'°C'],
        ['Site energy',m?.siteElectricKWh??0,'kWh']].map(([label,value,unit])=>`<div><small>${label}</small><strong>${fmt(value)} ${unit}</strong></div>`).join('');
    $('agentLiveStep').disabled=o.done;$('agentLiveAuto').disabled=o.done;$('agentLiveExport').disabled=false;
    $('agentLiveHistory').textContent=liveLog.slice(-12).map(x=>`Minute ${x.at}: ${x.action}\n  → GPU ${fmt(x.gpu)} °C · coolant ${fmt(x.coolant)} °C · building ${fmt(x.building)} °C`).join('\n');
    $('agentLiveStatus').dataset.error='false';
    $('agentLiveStatus').textContent=`${o.done?'Episode finished.':'Plant ready for the next action.'} ${o.violations.length} constraint type(s) violated so far · energy residual ${o.maxEnergyResidualKJ.toExponential(2)} kJ. Synthetic data; no hardware connected.`;
  }
  function startLive(){
    try{
      if(!$('agentSeed').value.trim()||!$('agentHorizon').value.trim())throw new Error('Seed and horizon are required');
      episode=M.startEpisode({schemaVersion:1,scenario:{preset:$('agentPreset').value,
        seed:Number($('agentSeed').value),horizonMinutes:Number($('agentHorizon').value)}});
      liveLog=[];renderLive();
    }catch(e){invalidateLive();$('agentLiveStatus').textContent=e.message;$('agentLiveStatus').dataset.error='true';}
  }
  function advanceLive(minutes,controls,label){
    const before=episode.minute;
    const o=M.stepEpisode(episode,{minutes,controls});
    liveLog.push({at:before,action:label,gpu:o.state.gpuC,coolant:o.state.coolantC,building:o.state.buildingC});
    renderLive();
    return o;
  }
  function stepLive(){
    try{
      if(!episode)throw new Error('Start an episode first');
      const minutes=Number($('agentLiveMinutes').value),controls=JSON.parse($('agentLiveControls').value);
      advanceLive(minutes,controls,`${minutes} min · ${JSON.stringify(controls)}`);
    }catch(e){$('agentLiveStatus').textContent=e.message;$('agentLiveStatus').dataset.error='true';}
  }
  function autoLive(){
    try{
      if(!episode)throw new Error('Start an episode first');
      // Transparent rule-based demonstration, not an LLM or learned optimal policy.
      for(let i=0;i<10&&!M.observeEpisode(episode).done;i++){
        const o=M.observeEpisode(episode);
        const controls={pumpPct:o.state.gpuC>75?100:o.state.gpuC>65?85:70,
          fanPct:o.state.coolantC>44?100:o.state.coolantC>38?90:70,
          heatRecoveryPct:o.state.buildingC<20.8?95:50,ventilationACH:.6};
        advanceLive(1,controls,'1 min · feedback demo');
      }
    }catch(e){$('agentLiveStatus').textContent=e.message;$('agentLiveStatus').dataset.error='true';}
  }
  function setup(){
    const container=$('agent-sandbox');if(!container)return;
    if(!M){container.textContent='Agent Sandbox model unavailable. Reload after all assets have been deployed.';return;}
    container.innerHTML=`
      <div class="agent-banner"><div><strong>PHYSICS BEFORE ACTION</strong><p>Test building-control proposals against a paired baseline. Inspect consequences before considering deployment.</p></div><span class="agent-chip">SIMULATION ONLY · NO DEVICES</span></div>
      <div class="agent-layout">
        <div class="agent-card" id="agentSetup"><p class="agent-kicker">01 / DEFINE THE EXPERIMENT</p><h2>Propose a control plan</h2>
          <label for="agentPreset">Environment<select id="agentPreset"><option value="winter">Winter · heat demand</option><option value="burst">Compute burst · high load</option><option value="summer">Summer · cooling pressure</option><option value="pump-fault">Pump degradation · at minute 30</option></select></label>
          <div class="agent-fields"><label for="agentHorizon">Horizon · minutes<input id="agentHorizon" type="number" min="1" max="360" step="1" value="120"></label><label for="agentSeed">Scenario seed<input id="agentSeed" type="number" min="0" max="4294967295" step="1" value="42"></label></div>
          <label for="agentPlan">Agent proposal · JSON action patches<textarea id="agentPlan" spellcheck="false" aria-describedby="agentPlanHelp"></textarea></label>
          <p id="agentPlanHelp" class="agent-muted">Actions apply at the specified minute. Omitted controls retain their previous value. Both runs use the same load, weather and initial temperatures.</p>
          <div class="agent-actions"><button id="agentExample" type="button">Load example</button><button id="agentBaselinePlan" type="button">Unchanged baseline</button></div>
          <button id="agentRun" class="agent-primary" type="button">Run physical comparison →</button>
          <p id="agentStatus" class="agent-status" role="status" aria-live="polite">Ready. This workspace runs locally in your browser.</p>
          <details><summary>Available controls & baseline</summary><pre id="agentControls"></pre><p>Model assumptions and thresholds are explicit, synthetic examples. They are not site-specific operating limits.</p></details>
        </div>
        <div><div id="agentEmpty" class="agent-card agent-empty"><p class="agent-kicker">02 / OBSERVE THE CONSEQUENCES</p><h2>A decision deserves a test.</h2><p>Compare electricity, GPU temperature and building comfort. A lower electricity bill does not count as an improvement if the proposal reduces compute service or violates a constraint.</p><div class="agent-steps"><span>Same initial state</span><span>Paired simulation</span><span>Evidence report</span></div><p>Try the pump-degradation scenario to see a proposal fail under a fault.</p></div>
        <div id="agentResults" class="agent-card" hidden><div class="agent-result-header"><div><p class="agent-kicker">02 / REVIEW THE EVIDENCE</p><span id="agentVerdict" class="agent-verdict"></span><p id="agentRunMeta" class="agent-muted"></p></div><button id="agentExport" type="button" disabled>Export report ↓</button></div>
          <p class="agent-muted">Passing the tested envelope does not authorize real building control.</p><div id="agentMetrics" class="agent-metrics"></div>
          <div class="agent-charts"><div id="agentGPUChart" class="agent-chart"></div><div id="agentBuildingChart" class="agent-chart"></div><div id="agentPowerChart" class="agent-chart"></div></div>
          <div class="agent-timeline"><label id="agentMinuteLabel" for="agentMinute">Inspect candidate · minute 0</label><input id="agentMinute" type="range" min="0" max="120" step="1" value="0"><div id="agentState" class="agent-state"></div></div>
          <h3 style="margin-top:22px">Constraint checks</h3><ul id="agentChecks" class="agent-checks"></ul>
          <details><summary>Simulated actions & fault events</summary><pre id="agentEvents"></pre></details>
          <details><summary>Scope, assumptions & missing evidence</summary><ul id="agentLimits"></ul><p>Sensitivity tests change envelope conductance and GPU heat transfer. They are not statistical confidence bounds or independent experimental validation.</p></details>
        </div></div>
      </div>
      <div class="agent-card agent-api"><p class="agent-kicker">03 / CONNECT AN AGENT</p><h2>One engine. Browser and API.</h2><p>The static website runs simulations in the browser. External agents can use the optional local Node server; it is not automatically hosted by Render Static Sites.</p><div class="agent-actions"><button id="agentExportRequest" type="button">Export request JSON ↓</button><button id="agentExportSchema" type="button">Export API contract ↓</button></div><details><summary>Agent integration & physical model</summary><pre>node scripts/serve-agent-sandbox.cjs

curl http://127.0.0.1:8787/api/v1/schema
curl -X POST http://127.0.0.1:8787/api/v1/simulations/evaluate \\
  -H 'Content-Type: application/json' \\
  --data-binary @thermaloop-agent-request.json</pre><p>JavaScript agents can call <code>ThermaAgentSandbox.evaluate(request)</code> in the browser or require <code>science/agent-sandbox-model.js</code> in Node. The result includes time series, violations, sensitivity cases and <code>hardwareAuthorized: false</code>.</p><p>Model: three thermal-capacitance states (GPU, coolant, building), direct heat recovery, resistive backup heating, fixed-COP room cooling and a prescribed synthetic compute load. The comparison above accepts an open-loop schedule; the live experiment below supports closed-loop interaction. There is no LLM, trained controller, real telemetry or hardware execution in this workspace.</p><p><a href="docs/AGENT_SANDBOX.md" target="_blank" rel="noopener">Read equations, API examples and deployment limits ↗</a></p></details></div>
      <div class="agent-card agent-api agent-live"><p class="agent-kicker">04 / INTERACTIVE PHYSICS ENVIRONMENT</p><h2>Observe → Act → Step → Repeat</h2><p>Run an experiment with persistent thermal states. Adjust a control based on the latest observation, advance simulated time, then inspect the consequence. The deterministic feedback demo is a sample rule-based controller—not a trained AI or an optimization claim.</p>
        <div class="agent-live-grid"><div><label for="agentLiveMinutes">Advance · minutes<input id="agentLiveMinutes" type="number" min="1" max="360" step="1" value="5"></label><label for="agentLiveControls">Control patch · JSON<textarea id="agentLiveControls" spellcheck="false">{"pumpPct":80,"fanPct":75,"heatRecoveryPct":85}</textarea></label><div class="agent-actions"><button id="agentLiveStart" type="button" class="agent-primary">Start / Reset episode</button><button id="agentLiveStep" type="button" disabled>Apply & step</button><button id="agentLiveAuto" type="button" disabled>Run 10 feedback steps</button><button id="agentLiveExport" type="button" disabled>Export episode ↓</button></div><p class="agent-muted">Uses the environment, seed and horizon selected above. Every step continues the same physical state. Controls carry forward until changed.</p></div>
          <div><div id="agentLiveState" class="agent-live-state" aria-live="polite"></div><p id="agentLiveStatus" class="agent-status" role="status" aria-live="polite"></p><h3>Recent simulated actions</h3><pre id="agentLiveHistory" aria-label="Recent episode actions"></pre></div></div>
        <details><summary>External agent: stateful episode API</summary><pre>POST   /api/v1/episodes
GET    /api/v1/episodes/{id}
POST   /api/v1/episodes/{id}/step
GET    /api/v1/episodes/{id}/report
DELETE /api/v1/episodes/{id}</pre><p>The optional local Node server holds up to 16 simultaneous sessions for 30 minutes of inactivity. Each one is bounded to 360 simulated minutes and 50 control changes. The static website runs its own browser-local episode; neither endpoint nor UI can operate real equipment.</p></details></div>`;
    $('agentPlan').value=JSON.stringify(M.schema().example.plan,null,2);
    $('agentControls').textContent=JSON.stringify({ranges:M.schema().controls,baseline:M.schema().baseline},null,2);
    $('agentRun').addEventListener('click',run);
    $('agentExample').addEventListener('click',()=>{$('agentPlan').value=JSON.stringify(M.schema().example.plan,null,2);invalidate();});
    $('agentBaselinePlan').addEventListener('click',()=>{$('agentPlan').value='[]';invalidate();});
    for(const id of ['agentPreset','agentHorizon','agentSeed','agentPlan'])$(id).addEventListener('input',invalidate);
    $('agentMinute').addEventListener('input',scrub);
    $('agentExport').addEventListener('click',()=>{if(report)download(report,'thermaloop-agent-report.json');});
    $('agentExportSchema').addEventListener('click',()=>download(M.openapi(),'thermaloop-agent-openapi.json'));
    $('agentExportRequest').addEventListener('click',()=>{try{const r=request();M.normalize(r);download(r,'thermaloop-agent-request.json');}catch(e){$('agentStatus').textContent=e.message;$('agentStatus').dataset.error='true';}});
    $('agentLiveStart').addEventListener('click',startLive);
    $('agentLiveStep').addEventListener('click',stepLive);
    $('agentLiveAuto').addEventListener('click',autoLive);
    $('agentLiveExport').addEventListener('click',()=>{if(episode)download(M.episodeReport(episode),'thermaloop-live-episode.json');});
    for(const id of ['agentPreset','agentHorizon','agentSeed'])$(id).addEventListener('input',invalidateLive);
    invalidateLive();
    globalThis.ThermaAgentSandboxDashboard={getReport:()=>report?JSON.parse(JSON.stringify(report)):null,run};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
