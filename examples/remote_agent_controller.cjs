#!/usr/bin/env node
'use strict';
// Node 22+ demonstration of a remote, simulation-only closed-loop controller.
// No LLM or building equipment is accessed. Keep credentials outside source files.
const {chooseControls}=require('./closed_loop_controller.cjs');

const endpoint=(process.env.THERMALOOP_API_URL??'http://127.0.0.1:8787').replace(/\/$/,'');
const token=process.env.THERMALOOP_API_TOKEN??'';
if(!/^https:\/\//.test(endpoint)&&!/^http:\/\/(127\.0\.0\.1|localhost|\[::1\])(?::\d+)?$/.test(endpoint)){
  console.error('Use HTTPS for a remote API; only loopback may use HTTP.');process.exit(1);
}
if(!token&&!/^http:\/\//.test(endpoint)){
  console.error('Set THERMALOOP_API_TOKEN in the agent environment.');process.exit(1);
}
async function call(route,method='GET',body) {
  const response=await fetch(endpoint+route,{method,signal:AbortSignal.timeout(15000),
    headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok)throw new Error(`API ${response.status}: ${data.error??'request failed'}`);
  return data;
}
async function main(){
  const started=await call('/api/v1/episodes','POST',{scenario:{preset:'winter',seed:42,horizonMinutes:20}});
  const id=started.episodeId;
  let observation=started;
  try{
    while(!observation.done){
      observation=await call(`/api/v1/episodes/${id}/step`,'POST',{
        expectedMinute:observation.minute,minutes:1,controls:chooseControls(observation)});
      if(observation.violations.length){
        console.error('Stopping demo after a simulated constraint violation.');break;
      }
    }
    const report=await call(`/api/v1/episodes/${id}/report`);
    console.log(JSON.stringify({episodeId:id,minute:report.minute,done:report.done,
      state:report.state,metrics:report.metrics,violations:report.violations,
      hardwareAuthorized:report.hardwareAuthorized},null,2));
  }finally{
    await call(`/api/v1/episodes/${id}`,'DELETE').catch(()=>{});
  }
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
