/* Browser-local research workspace. API secrets never enter this page. */
(()=>{
  'use strict';
  const R=globalThis.ThermaAgentResearch,$=id=>document.getElementById(id);
  const fmt=(n,d=2)=>Number(n).toLocaleString('en-US',{maximumFractionDigits:d});
  const esc=x=>String(x).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let current=null,worker=null,busy=false;
  function download(data){const url=URL.createObjectURL(new Blob([JSON.stringify(data,null,2)],{type:'application/json'}));
    const link=document.createElement('a');link.href=url;link.download='thermaloop-research-v1.3.json';link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1500);}
  function setStatus(message,error=false){$('researchStatus').textContent=message;$('researchStatus').dataset.error=String(error);}
  function controls(disabled){busy=disabled;for(const field of $('researchSetup').querySelectorAll('input,select'))field.disabled=disabled;
    $('researchRun').disabled=disabled;$('researchCancel').disabled=!disabled;}
  function request(){return R.normalize({schemaVersion:1,scenario:{preset:$('researchPreset').value,
    horizonMinutes:Number($('researchHorizon').value),seed:Number($('researchSeed').value)},
    trials:Number($('researchTrials').value)});}
  function render(result){
    current=result;$('researchResults').hidden=false;$('researchEmpty').hidden=true;$('researchExport').disabled=false;
    $('researchReplay').disabled=!result.best;
    $('researchCount').textContent=`${result.trialCount} tested`;
    $('researchValid').textContent=`${result.eligibleCount} eligible`;
    $('researchSavings').textContent=result.best?`${fmt(result.best.energySavedKWh)} kWh`:'No eligible plan';
    $('researchVerdict').textContent=!result.best?'No eligible candidate found':result.validatedImprovement
      ?'Improvement passed both untouched holdout seeds':result.passedHoldouts
        ?'Valid candidate; savings not positive across all holdouts':'Holdout check failed — not verified';
    $('researchVerdict').dataset.ok=String(result.validatedImprovement);
    $('researchHoldouts').textContent=result.holdouts.length?result.holdouts.map(h=>
      `Seed ${h.seed}: ${h.eligible?'passed limits':'failed limits'} · ${fmt(h.energySavedKWh)} kWh saved · service ${fmt(h.computeServiceRatio*100,1)}%`).join('\n'):
      'No qualified training candidate; no holdout experiment was selected.';
    $('researchCandidates').innerHTML=result.trials.map(row=>`<tr class="${row.trial===result.best?.trial?'research-winner':''}">
      <td>${row.trial+1}</td><td>${row.eligible?'Eligible':'Rejected'}</td>
      <td>${esc(fmt(row.energySavedKWh,3))} kWh</td><td>${esc(fmt(row.computeServiceRatio*100,1))}%</td></tr>`).join('');
    $('researchPlan').textContent=result.best?JSON.stringify(result.best.plan,null,2):'No plan passed the training-seed constraints.';
    setStatus('Search complete. Export the evidence before leaving; browser results are not stored on the server.');
  }
  function start(){
    if(busy)return;let input;
    try{for(const id of ['researchSeed','researchHorizon','researchTrials'])if(!$(id).value.trim())throw new Error('All numeric inputs are required');
      input=request();}catch(e){setStatus(e.message,true);return;}
    current=null;$('researchResults').hidden=true;$('researchEmpty').hidden=false;
    $('researchExport').disabled=true;$('researchReplay').disabled=true;
    $('researchProgress').max=input.trials;$('researchProgress').value=0;
    $('researchProgressLabel').textContent=`0 / ${input.trials} tested`;controls(true);
    setStatus('Running a bounded deterministic search inside this browser…');
    if(typeof Worker==='undefined'||location.protocol==='file:'){
      // Offline preview fallback; no remote calls or extra privileges.
      $('researchCancel').disabled=true;
      setTimeout(()=>{try{render(R.run(input));}catch(e){setStatus(e.message,true);}finally{controls(false);}},10);
      return;
    }
    worker=new Worker('science/agent-research-worker.js');
    const active=worker;
    const timeout=setTimeout(()=>{if(worker!==active)return;active.terminate();worker=null;controls(false);
      setStatus('Search exceeded the 15-second browser time budget. Reduce the horizon or trials.',true);},15000);
    const finish=()=>{clearTimeout(timeout);active.terminate();if(worker===active)worker=null;controls(false);};
    active.onmessage=event=>{
      if(event.data.type==='progress'){
        $('researchProgress').value=event.data.progress.completed;
        $('researchProgressLabel').textContent=`${event.data.progress.completed} / ${input.trials} tested`;
      }else if(event.data.type==='complete'){render(event.data.result);finish();}
      else if(event.data.type==='error'){setStatus(event.data.error,true);finish();}
    };
    active.onerror=()=>{setStatus('Research worker could not load. Verify the deployed research assets.',true);finish();};
    active.postMessage(input);
  }
  function cancel(){if(!worker)return;worker.terminate();worker=null;controls(false);setStatus('Search cancelled. No partial result was claimed.');}
  function replay(){if(!current?.best)return;
    const plan=$('agentPlan');if(!plan)return;
    plan.value=JSON.stringify(current.best.plan,null,2);plan.dispatchEvent(new Event('input',{bubbles:true}));
    $('agentPreset').value=current.config.scenario.preset;
    $('agentSeed').value=String(current.config.scenario.seed);
    $('agentHorizon').value=String(current.config.scenario.horizonMinutes);
    for(const id of ['agentPreset','agentSeed','agentHorizon'])$(id).dispatchEvent(new Event('input',{bubbles:true}));
    if(globalThis.ThermaWorkspaces)globalThis.ThermaWorkspaces.navigate('#agent-sandbox',true);
    else location.hash='agent-sandbox';
  }
  function setup(){
    const panel=$('agent-research');if(!panel)return;
    if(!R){panel.textContent='Research model unavailable; refresh the deployed assets.';return;}
    panel.innerHTML=`<div class="agent-banner"><div><strong>v1.3 / AUTONOMOUS RESEARCH LAB</strong>
      <p>Explore candidate thermal controls, rank only physically eligible plans, then check untouched seeds.</p></div>
      <span class="agent-chip">SYNTHETIC · BROWSER LOCAL · NO DEVICES</span></div>
      <div class="agent-layout"><div class="agent-card" id="researchSetup">
      <p class="agent-kicker">01 / DEFINE A SEARCH</p><h2>Research settings</h2>
      <p class="agent-muted">This is a bounded deterministic parameter search, not an LLM, reinforcement learning or proven global optimization.</p>
      <label for="researchPreset">Environment<select id="researchPreset"><option value="winter">Winter · heating demand</option>
      <option value="burst">Compute burst</option><option value="summer">Summer · cooling</option>
      <option value="pump-fault">Pump degradation</option></select></label>
      <div class="agent-fields"><label for="researchHorizon">Horizon · minutes<input id="researchHorizon" type="number" min="1" max="120" step="1" value="60"></label>
      <label for="researchSeed">Training seed<input id="researchSeed" type="number" min="0" max="4294967295" step="1" value="42"></label></div>
      <label for="researchTrials">Candidate count · 2–30<input id="researchTrials" type="number" min="2" max="30" step="1" value="20"></label>
      <button id="researchRun" class="agent-primary" type="button">Start bounded search →</button>
      <button id="researchCancel" type="button" disabled>Cancel search</button>
      <div class="research-progress"><label id="researchProgressLabel" for="researchProgress">0 / 20 tested</label>
      <progress id="researchProgress" max="20" value="0"></progress></div>
      <p class="agent-status" id="researchStatus" role="status" aria-live="polite">Ready. No API token or network connection is needed here.</p>
      <details><summary>Search method and safeguards</summary><p>Fixed low-discrepancy sampling modifies pump, fan, heat-recovery fraction and heating setpoint. GPU power and minimum occupied ventilation are preserved. Each plan is compared with an identical-load baseline on its training seed plus sensitivity cases. Two holdout seeds are not used to select the winner. Neither passed checks nor sample savings imply safety or savings on actual equipment.</p></details>
      </div><div class="agent-card research-output"><p class="agent-kicker">02 / OBSERVE THE EVIDENCE</p>
      <h2>Search results</h2><p class="agent-muted">A candidate is eligible only if physical constraints, compute-service retention and energy accounting all pass. Electricity savings can be negative.</p>
      <div id="researchResults" hidden><div class="research-stats"><div><small>Explored</small><strong id="researchCount"></strong></div>
      <div><small>Eligible</small><strong id="researchValid"></strong></div>
      <div><small>Training saving</small><strong id="researchSavings"></strong></div></div>
      <p class="research-verdict" id="researchVerdict"></p><h3>Untouched holdout checks</h3><pre id="researchHoldouts"></pre>
      <div class="agent-actions"><button id="researchExport" type="button" disabled>Export full evidence ↓</button>
      <button id="researchReplay" type="button" disabled>Open best plan in Control experiments ↗</button></div>
      <details><summary>All trials and their eligibility</summary><div class="research-table-wrap"><table><thead><tr><th>Trial</th><th>Status</th><th>Training saving</th><th>Service</th></tr></thead>
      <tbody id="researchCandidates"></tbody></table></div></details>
      <details><summary>Best candidate's action plan</summary><pre id="researchPlan"></pre></details></div>
      <p id="researchEmpty" class="agent-muted">Start a research run to evaluate the sampled candidates. Results and reports stay in your browser until you export them.</p></div></div>
      <div class="agent-card agent-api"><p class="agent-kicker">03 / REMOTE RESEARCH API</p>
      <h2>Available to authenticated external agents</h2>
      <p>The same bounded search can run on the Node Web Service via <code>POST /api/v1/research/optimize</code> using a private Bearer token. The browser research workspace runs locally and <strong>never receives that token</strong>. Remote runs are stateless and rate-limited; neither mode controls real equipment.</p>
      <p><a href="docs/AUTONOMOUS_RESEARCH_LAB.md" target="_blank" rel="noopener">Research protocol, test criteria and limitations ↗</a></p></div>`;
    $('researchRun').addEventListener('click',start);$('researchCancel').addEventListener('click',cancel);
    $('researchExport').addEventListener('click',()=>{if(current)download(current);});
    $('researchReplay').addEventListener('click',replay);
    globalThis.ThermaAgentResearchDashboard={getResult:()=>current?structuredClone(current):null,start};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',setup);else setup();
})();
