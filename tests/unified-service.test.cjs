'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const {createServer}=require('../scripts/serve-agent-sandbox.cjs');
const M=require('../service/unified-physics.js');
async function serve(options,fn){const server=createServer(options);
  await new Promise((ok,no)=>server.once('error',no).listen(0,'127.0.0.1',ok));
  try{await fn('http://127.0.0.1:'+server.address().port);}finally{await new Promise(ok=>server.close(ok));}}
const auth=token=>({Authorization:'Bearer '+token});
const req=(method,data,token)=>({method,headers:{'Content-Type':'application/json',...auth(token)},body:JSON.stringify(data)});

test('v1.5 engineering lab is served only by Web Service, with shared canonical source',()=>serve({},async base=>{
  const homeResponse=await fetch(base+'/');
  assert.equal(homeResponse.headers.get('cache-control'),'no-store');
  const home=await homeResponse.text();
  assert.match(home,/PHYSICS LAB ↗/);assert.match(home,/unified-bridge\.js/);
  const lab=await(await fetch(base+'/physics-lab')).text();
  assert.match(lab,/<title>ThermaLoop AI · Physics Lab<\/title>/);
  assert.doesNotMatch(lab,/physics-lab-v14/);
  assert.match(lab,/unified-physics\.js/);
  assert.match(lab,/Controller benchmark/);
  assert.match(lab,/id="benchmarkRun"/);
  const archive=await(await fetch(base+'/physics-lab-v14')).text();
  assert.match(archive,/v1\.4/);
  for(const asset of ['unified-physics.js','unified-lab.js','unified-lab.css','unified-bridge.js',
    'unified-benchmark.js','unified-benchmark-worker.js']){
    assert.equal((await fetch(base+'/service/'+asset)).status,200);}
  const h=await(await fetch(base+'/healthz')).json();assert.equal(h.apiVersion,'1.5.0');
}));

test('Remote AI can safely construct, modify, step and export bounded serial worlds',()=>serve({token:'a'.repeat(32)},async base=>{
  const key='a'.repeat(32),url=base+'/api/v1/worlds';
  assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,401);
  const response=await fetch(url,req('POST',{scenario:{seed:13,horizonMinutes:12}},key));
  assert.equal(response.status,201);const created=await response.json();const id=created.worldId;
  assert.equal(created.engineVersion,'1.5.0');assert.equal(created.hardwareAuthorized,false);
  assert.equal(created.minute,0);assert.equal(created.topology.nodes.length,6);
  const worldUrl=url+'/'+id;
  const badGraph=structuredClone(M.DEFAULT_TOPOLOGY);badGraph.edges[0].to='INVALID';
  const invalid=await fetch(worldUrl+'/topology',req('PUT',badGraph,key));assert.equal(invalid.status,400);
  assert.equal((await(await fetch(worldUrl,{headers:auth(key)})).json()).minute,0);
  const modified=M.spliceAfter(M.DEFAULT_TOPOLOGY,{id:'TES-001',type:'tank',params:{waterLiters:200,lossK:1,uaWK:5}},'PIPE-A');
  const rewired=await fetch(worldUrl+'/topology',req('PUT',modified,key));assert.equal(rewired.status,200);
  assert.equal((await rewired.json()).topology.nodes.length,7);
  const advanced=await fetch(worldUrl+'/step',req('POST',{expectedMinute:0,minutes:3,controls:{pumpPct:85}},key));
  assert.equal(advanced.status,200);const stepped=await advanced.json();
  assert.equal(stepped.minute,3);assert.equal(stepped.trace.length,4);
  assert.ok(stepped.hydraulics.flowLps>0);assert.ok(stepped.energyResidualKJ<1e-5);
  assert.equal((await fetch(worldUrl+'/step',req('POST',{expectedMinute:0,minutes:1},key))).status,409);
  const concurrent=await Promise.all([
    fetch(worldUrl+'/step',req('POST',{expectedMinute:3,minutes:1},key)),
    fetch(worldUrl+'/step',req('POST',{expectedMinute:3,minutes:1},key))]);
  assert.deepEqual(concurrent.map(r=>r.status).sort(),[200,409]);
  assert.equal((await fetch(worldUrl+'/topology',req('PUT',M.DEFAULT_TOPOLOGY,key))).status,400);
  const report=await(await fetch(worldUrl+'/report',{headers:auth(key)})).json();
  assert.deepEqual(report.topology,stepped.topology);assert.equal(report.minute,4);
  assert.equal((await fetch(worldUrl+'/report',{headers:auth('b'.repeat(32))})).status,401);
  const spec=await(await fetch(base+'/api/v1/openapi.json',{headers:auth(key)})).json();
  assert.ok(spec.paths['/api/v1/worlds/{id}/topology']);
  assert.equal((await fetch(worldUrl,{method:'DELETE',headers:auth(key)})).status,200);
  assert.equal((await fetch(worldUrl,{headers:auth(key)})).status,404);
}));

test('Worlds enforce per-principal count and topology capacity bounds',()=>serve({maxRequestsPerMinute:50},async base=>{
  const baseUrl=base+'/api/v1/worlds',ids=[];
  for(let i=0;i<4;i++){const r=await fetch(baseUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});
    assert.equal(r.status,201);ids.push((await r.json()).worldId);}
  assert.equal((await fetch(baseUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,429);
  const r=await fetch(baseUrl+'/'+ids[0],{method:'DELETE'});assert.equal(r.status,200);
  assert.equal((await fetch(baseUrl,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'})).status,201);
}));
