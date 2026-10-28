'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const fs=require('node:fs'),os=require('node:os'),path=require('node:path');
const {createServer,configuredKeys,validateRemoteConfig}=require('../scripts/serve-agent-sandbox.cjs');
const {snapshotEpisode,restoreEpisode,createEpisodeStore}=require('../scripts/episode-store.cjs');
const engine=require('../science/agent-sandbox-model.js');

async function withServer(options,fn){
  const server=createServer(options);
  await new Promise((resolve,reject)=>server.once('error',reject).listen(0,'127.0.0.1',resolve));
  try{await fn(`http://127.0.0.1:${server.address().port}`);}
  finally{await new Promise(resolve=>server.close(resolve));}
}
const post=(body,key)=>({method:'POST',headers:{'Content-Type':'application/json',
  ...(key?{Authorization:'Bearer '+key}:{})},body:JSON.stringify(body)});
const auth=key=>({headers:{Authorization:'Bearer '+key}});

test('public server config requires unique, strong named keys and refuses unauthenticated binding',()=>{
  assert.throws(()=>validateRemoteConfig('0.0.0.0',[]),/requires a random/);
  assert.throws(()=>validateRemoteConfig('0.0.0.0',[['owner','too-short']]),/32 bytes/);
  assert.doesNotThrow(()=>validateRemoteConfig('0.0.0.0',[['owner','a'.repeat(32)]]));
  assert.doesNotThrow(()=>validateRemoteConfig('127.0.0.1',[]));
  assert.throws(()=>configuredKeys('secret',{bob:'secret'}),/unique/);
  assert.throws(()=>configuredKeys('',{'bad name':'secret'}),/Invalid named/);
  assert.throws(()=>createServer({maxRequestsPerMinute:0}),/Invalid limit/);
});

test('remote agent keys cannot inspect, step or delete another principal episode',()=>withServer({
  apiKeys:{alice:'a'.repeat(40),bob:'b'.repeat(40)},maxEpisodesPerPrincipal:1
},async base=>{
  const alice='a'.repeat(40),bob='b'.repeat(40),create=base+'/api/v1/episodes';
  const liveness=await(await fetch(base+'/healthz')).json();
  assert.equal(liveness.apiVersion,'1.3.0');assert.equal(liveness.hardwareConnected,false);
  assert.equal((await fetch(base+'/api/v1/usage')).status,401);
  assert.equal((await fetch(create,post({scenario:{horizonMinutes:3}},alice))).status,201);
  const own=await(await fetch(base+'/api/v1/usage',auth(alice))).json();
  assert.equal(own.principal,'alice');assert.equal(own.activeEpisodes,1);
  const created=await fetch(create,post({scenario:{horizonMinutes:3}},bob));
  assert.equal(created.status,201);
  const b=await created.json(),url=create+'/'+b.episodeId;
  assert.equal((await fetch(url,auth(alice))).status,404);
  assert.equal((await fetch(url+'/report',auth(alice))).status,404);
  const attempt=post({expectedMinute:0,minutes:1},alice);
  assert.equal((await fetch(url+'/step',attempt)).status,404);
  assert.equal((await fetch(url,{method:'DELETE',...auth(alice)})).status,404);
  assert.equal((await fetch(create,post({},bob))).status,429);
  assert.equal((await fetch(url+'/step',post({expectedMinute:0,minutes:1},bob))).status,200);
  assert.equal((await(await fetch(url,auth(bob))).json()).minute,1);
  assert.equal((await fetch(url,{method:'DELETE',...auth(bob)})).status,200);
  assert.equal((await fetch(url,auth(bob))).status,404);
}));

test('request and evaluation quotas return 429 and Retry-After without executing excess work',()=>withServer({
  token:'owner-secret',maxRequestsPerMinute:7,maxEvaluationsPerMinute:1
},async base=>{
  const url=base+'/api/v1/simulations/evaluate',key='owner-secret';
  assert.equal((await fetch(url,post({scenario:{horizonMinutes:1},plan:[]},key))).status,200);
  const quota=await fetch(url,post({scenario:{horizonMinutes:1},plan:[]},key));
  assert.equal(quota.status,429);assert.ok(Number(quota.headers.get('retry-after'))>=1);
  for(let i=0;i<5;i++)assert.equal((await fetch(base+'/api/v1/health',auth(key))).status,200);
  const blocked=await fetch(base+'/api/v1/health',auth(key));
  assert.equal(blocked.status,429);
}));

test('v1.3 research is authenticated, bounded, replayable and independently rate limited',()=>withServer({
  token:'research-private-key',maxResearchesPerMinute:1,maxEvaluationsPerMinute:2
},async base=>{
  const endpoint=base+'/api/v1/research/optimize',token='research-private-key';
  const input={scenario:{preset:'winter',horizonMinutes:20,seed:15},trials:5};
  assert.equal((await fetch(endpoint,post(input))).status,401);
  assert.equal((await fetch(endpoint,post({...input,trials:31},token))).status,400);
  const response=await fetch(endpoint,post(input,token));assert.equal(response.status,200);
  const result=await response.json();assert.equal(result.version,'1.3.0');
  assert.equal(result.hardwareAuthorized,false);assert.equal(result.trialCount,5);
  assert.ok(result.bestReport);assert.deepEqual(result.bestReport,
    engine.evaluate({scenario:result.config.scenario,plan:result.best.plan}));
  const usage=await(await fetch(base+'/api/v1/usage',auth(token))).json();
  assert.equal(usage.researchesInWindow,1);assert.equal(usage.evaluationsInWindow,0);
  const blocked=await fetch(endpoint,post(input,token));assert.equal(blocked.status,429);
  assert.ok(Number(blocked.headers.get('retry-after'))>=1);
  assert.equal((await fetch(base+'/api/v1/simulations/evaluate',post({scenario:{horizonMinutes:1},plan:[]},token))).status,200);
}));

test('optional replay store recovers exact physical trajectory and preserves session ownership after restart',async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'thermaloop-agent-test-'));
  try{
    const storePath=path.join(dir,'episodes.json'),token='saved-token';let id,firstReport;
    await withServer({token,storePath},async base=>{
      const started=await(await fetch(base+'/api/v1/episodes',post({scenario:{preset:'pump-fault',seed:10,horizonMinutes:38}},token))).json();
      id=started.episodeId;
      const url=base+'/api/v1/episodes/'+id;
      assert.equal((await fetch(url+'/step',post({expectedMinute:0,minutes:22,controls:{pumpPct:92}},token))).status,200);
      assert.equal((await fetch(url+'/step',post({expectedMinute:22,minutes:13,controls:{fanPct:84}},token))).status,200);
      firstReport=await(await fetch(url+'/report',auth(token))).json();
      assert.equal(firstReport.minute,35);
      assert.equal(fs.existsSync(storePath),true);
    });
    await withServer({token,storePath},async base=>{
      const url=base+'/api/v1/episodes/'+id;
      const saved=await(await fetch(url+'/report',auth(token))).json();
      assert.deepEqual(saved,firstReport);
      assert.equal((await fetch(url+'/step',post({expectedMinute:35,minutes:3},token))).status,200);
      const done=await(await fetch(url+'/report',auth(token))).json();
      assert.deepEqual(done.trace,engine.evaluate(done.replayRequest).candidate.trace);
      assert.deepEqual(done.metrics,engine.evaluate(done.replayRequest).candidate.metrics);
    });
    await withServer({token,storePath},async base=>{
      const url=base+'/api/v1/episodes/'+id;
      assert.equal((await(await fetch(url,auth(token))).json()).minute,38);
      assert.equal((await fetch(url,{method:'DELETE',...auth(token)})).status,200);
    });
    await withServer({token,storePath},async base=>{
      assert.equal((await fetch(base+'/api/v1/episodes/'+id,auth(token))).status,404);
    });
  }finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('serialized episode replay is exact and storage rejects public checkout paths',()=>{
  const e=engine.startEpisode({scenario:{preset:'winter',seed:7,horizonMinutes:12}});
  engine.stepEpisode(e,{minutes:3,controls:{pumpPct:85}});
  engine.stepEpisode(e,{minutes:4});
  engine.stepEpisode(e,{minutes:5,controls:{fanPct:90}});
  const cloned=restoreEpisode(snapshotEpisode(e));
  assert.deepEqual(engine.episodeReport(cloned),engine.episodeReport(e));
  assert.throws(()=>createEpisodeStore(path.join(__dirname,'../science/private.json'),path.resolve(__dirname,'..')),
    /outside the publicly served/);
});
