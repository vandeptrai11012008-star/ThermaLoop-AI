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
