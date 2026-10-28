'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const {createServer}=require('../scripts/serve-agent-sandbox.cjs');
const M=require('../science/agent-sandbox-model.js'),oldResearch=require('../science/agent-research-model.js');
const fair=require('../service/validated-research.js');

async function withServer(opts,fn){
  const server=createServer(opts);
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${server.address().port}`);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
const body=(input,token)=>({method:'POST',headers:{'Content-Type':'application/json',
  ...(token?{Authorization:'Bearer '+token}:{})},body:JSON.stringify(input)});

test('v1.4 terminal-matched researcher rejects deferred thermal-state savings',()=>{
  const s={preset:'winter',seed:42,horizonMinutes:60},original=oldResearch.run({scenario:s,trials:30});
  const guarded=fair.run({scenario:s,trials:30});
  assert.equal(guarded.version,'1.4.0');assert.equal(guarded.hardwareAuthorized,false);
  assert.equal(original.best.energySavedKWh>9,true);
  assert.equal(original.best.trial,14);
  const problematic=fair.evaluateCandidate(s,original.best.plan,original.best.trial);
  assert.equal(problematic.row.physicalEnvelopePassed,true);
  assert.equal(problematic.row.terminalEquivalent,false);
  assert.ok(problematic.row.terminal.thermalCarryoverKWh.buildingHeatDeficit>8);
  assert.ok(guarded.best);assert.equal(guarded.best.eligible,true);
  assert.ok(guarded.best.energySavedKWh<original.best.energySavedKWh);
  assert.deepEqual(guarded.bestReport,M.evaluate({scenario:guarded.config.scenario,plan:guarded.best.plan}));
  assert.ok(guarded.holdouts.every(h=>h.terminalEquivalent&&h.eligible));
  assert.deepEqual(guarded,fair.run({scenario:s,trials:30}));
});

test('v1.4 research preserves negative outcomes, nominal seed isolation and schema bounds',()=>{
  const r=fair.run({scenario:{preset:'summer',seed:42,horizonMinutes:60},trials:30});
  assert.equal(r.validatedImprovement,false);
  assert.ok(r.best.energySavedKWh<0);
  assert.deepEqual(r.holdouts.map(x=>x.seed),[2015,7961]);
  assert.equal(fair.TOLERANCE_C.buildingC,0.5);
  for(const x of [{trials:31},{trials:1},{scenario:{horizonMinutes:121}},
    {scenario:{invalid:1}},{unexpected:'command'}])assert.throws(()=>fair.run(x));
});

test('Web Service serves its own v1.4 laboratory without changing static index source',()=>withServer({},async base=>{
  const staticHTML=fs.readFileSync(path.join(__dirname,'../index.html'),'utf8');
  assert.ok(!staticHTML.includes('PHYSICS LAB v1.4'));
  const homepage=await(await fetch(base+'/')).text();
  assert.ok(homepage.includes('href="/physics-lab"'));
  const lab=await fetch(base+'/physics-lab');assert.equal(lab.status,200);
  const html=await lab.text();assert.ok(html.includes('Thermal world'));
  assert.ok(html.includes('/service/physics-lab-worker.js')===false);
  for(const asset of ['/service/physics-lab.js','/service/physics-lab.css',
    '/service/physics-lab-worker.js','/service/validated-research.js']){
    const response=await fetch(base+asset);assert.equal(response.status,200,asset);
    assert.ok((await response.text()).length>100);
  }
}));

test('authenticated v1.4 research enforces bounds, quotas and OpenAPI documentation',()=>withServer({
  token:'private-service-token',maxResearchesPerMinute:1
},async base=>{
  const endpoint=base+'/api/v1/research/validated',key='private-service-token';
  assert.equal((await fetch(endpoint,body({trials:4}))).status,401);
  assert.equal((await fetch(endpoint,body({trials:31},key))).status,400);
  const health=await(await fetch(base+'/api/v1/health',{headers:{Authorization:'Bearer '+key}})).json();
  assert.equal(health.apiVersion,'1.4.0');assert.equal(health.engineVersion,'1.1.0');
  const schema=await(await fetch(base+'/api/v1/schema',{headers:{Authorization:'Bearer '+key}})).json();
  assert.deepEqual(schema,M.schema());
  const spec=await(await fetch(base+'/api/v1/openapi.json',{headers:{Authorization:'Bearer '+key}})).json();
  assert.equal(spec.info.version,'1.4.0');assert.ok(spec.paths['/api/v1/research/validated']);
  const input={schemaVersion:1,scenario:{preset:'winter',seed:42,horizonMinutes:60},trials:30};
  const response=await fetch(endpoint,body(input,key));assert.equal(response.status,200);
  const report=await response.json();assert.deepEqual(report,fair.run(input));
  assert.equal(report.hardwareAuthorized,false);
  const blocked=await fetch(endpoint,body(input,key));assert.equal(blocked.status,429);
  assert.ok(Number(blocked.headers.get('retry-after'))>=1);
}));
