'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../scripts/serve-agent-sandbox.cjs');
const model=require('../science/agent-sandbox-model.js');
async function withServer(options,fn){const server=createServer(options);await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{await fn(`http://127.0.0.1:${server.address().port}`);}finally{await new Promise(r=>server.close(r));}}
const post=body=>({method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(body)});
test('HTTP evaluation is identical to the browser/CommonJS engine; schema is discoverable',()=>withServer({},async base=>{
  const health=await (await fetch(base+'/api/v1/health')).json();assert.equal(health.hardwareConnected,false);
  assert.deepEqual(await(await fetch(base+'/api/v1/schema')).json(),model.schema());
  assert.equal((await(await fetch(base+'/api/v1/openapi.json')).json()).openapi,'3.1.0');
  const input={scenario:{horizonMinutes:10},plan:[]};const response=await fetch(base+'/api/v1/simulations/evaluate',post(input));
  assert.equal(response.status,200);assert.deepEqual(await response.json(),model.evaluate(input));
  assert.equal((await fetch(base+'/')).status,200);assert.equal((await fetch(base+'/science/agent-sandbox-worker.js')).status,200);
}));
test('API rejects invalid actions, malformed JSON, wrong methods and hardware requests',()=>withServer({},async base=>{
  const url=base+'/api/v1/simulations/evaluate';
  assert.equal((await fetch(url,post({plan:[{atMinute:0,controls:{pumpPct:500}}]}))).status,400);
  assert.equal((await fetch(url,{...post({}),body:'{broken'})).status,400);
  assert.equal((await fetch(url)).status,405);
  assert.equal((await fetch(url,{method:'POST',body:'{}'})).status,415);
  assert.equal((await fetch(base+'/api/v1/hardware/apply',post({}))).status,404);
  assert.equal((await fetch(base+'/.git/config')).status,404);
  assert.equal((await fetch(url,{...post({}),headers:{'content-type':'application/json',origin:'https://untrusted.example'}})).status,403);
}));
test('configured token protects simulation endpoints',()=>withServer({token:'test-only-token'},async base=>{
  const url=base+'/api/v1/simulations/evaluate';assert.equal((await fetch(url,post({}))).status,401);
  const options=post({scenario:{horizonMinutes:1}});options.headers.authorization='Bearer test-only-token';
  assert.equal((await fetch(url,options)).status,200);
}));
test('request size is bounded',()=>withServer({},async base=>{
  const r=await fetch(base+'/api/v1/simulations/evaluate',post({padding:'x'.repeat(70000)}));assert.equal(r.status,413);
}));
test('an agent can observe, act, step and export a faithful in-memory physical episode',()=>withServer({},async base=>{
  const scenario={preset:'pump-fault',seed:9,horizonMinutes:38};
  const started=await fetch(base+'/api/v1/episodes',post({scenario}));assert.equal(started.status,201);
  const initial=await started.json(),url=base+'/api/v1/episodes/'+initial.episodeId;
  assert.equal(initial.minute,0);assert.equal(initial.hardwareAuthorized,false);
  assert.deepEqual(await(await fetch(url)).json(),initial);
  const a=await fetch(url+'/step',post({expectedMinute:0,minutes:22,controls:{pumpPct:90,fanPct:85}}));
  assert.equal(a.status,200);assert.equal((await a.json()).minute,22);
  assert.equal((await fetch(url+'/step',post({expectedMinute:0,minutes:1}))).status,409);
  assert.equal((await(await fetch(url)).json()).minute,22);
  const b=await fetch(url+'/step',post({expectedMinute:22,minutes:16,controls:{heatRecoveryPct:95}}));
  assert.equal(b.status,200);assert.equal((await b.json()).done,true);
  const report=await(await fetch(url+'/report')).json();
  assert.equal(report.trace.length,39);
  const batch=model.evaluate(report.replayRequest).candidate;
  assert.deepEqual(report.trace,batch.trace);assert.deepEqual(report.metrics,batch.metrics);
  assert.deepEqual(report.events,batch.events);assert.deepEqual(report.violations,batch.violations);
  assert.equal((await fetch(url+'/step',post({expectedMinute:38,minutes:1}))).status,400);
  assert.equal((await fetch(url+'/hardware/apply',post({}))).status,404);
  assert.equal((await fetch(url,{method:'DELETE'})).status,200);
  assert.equal((await fetch(url)).status,404);
}));
test('episode API enforces bounds, token, cross-origin and a capacity ceiling',()=>withServer({token:'episode-token'},async base=>{
  const collection=base+'/api/v1/episodes';
  assert.equal((await fetch(collection,post({}))).status,401);
  const secured=body=>{const opts=post(body);opts.headers.authorization='Bearer episode-token';return opts;};
  assert.equal((await fetch(collection,{...secured({}),headers:{...secured({}).headers,origin:'https://other.example'}})).status,403);
  assert.equal((await fetch(collection,secured({plan:[]}))).status,400);
  const created=await fetch(collection,secured({scenario:{horizonMinutes:3}}));assert.equal(created.status,201);
  const url=collection+'/'+(await created.json()).episodeId;
  assert.equal((await fetch(url+'/step',secured({minutes:1}))).status,400);
  assert.equal((await fetch(url+'/step',secured({expectedMinute:0,minutes:0}))).status,400);
  assert.equal((await fetch(url+'/step',secured({expectedMinute:0,controls:{gpuPowerLimitPct:101}}))).status,400);
  assert.equal((await fetch(url+'/step',secured({expectedMinute:0,minutes:2}))).status,200);
  assert.equal((await fetch(url+'/step',secured({expectedMinute:0,minutes:1}))).status,409);
  assert.equal((await fetch(url+'/step',secured({expectedMinute:2,minutes:2}))).status,400);
  assert.equal((await(await fetch(url,{headers:{authorization:'Bearer episode-token'}})).json()).minute,2);
  for(let i=1;i<16;i++)assert.equal((await fetch(collection,secured({scenario:{horizonMinutes:1}}))).status,201);
  assert.equal((await fetch(collection,secured({}))).status,503);
}));
