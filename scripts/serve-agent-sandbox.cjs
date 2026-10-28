#!/usr/bin/env node
// Local or separately hosted simulation-only API; never connects to hardware.
'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {Worker,isMainThread,parentPort,workerData} = require('node:worker_threads');
const engine = require('../science/agent-sandbox-model.js');
const research = require('../science/agent-research-model.js');
const validatedResearch = require('../service/validated-research.js');
const {createEpisodeStore,restoreEpisode,snapshotEpisode} = require('./episode-store.cjs');
const ROOT = path.resolve(__dirname,'..');
const MAX_BODY = 65536;
const MAX_EPISODES = 16;
const EPISODE_IDLE_MS = 30*60*1000;
const API_VERSION='1.4.0';
function equalToken(a,b) {
  const x=crypto.createHash('sha256').update(a).digest(),y=crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(x,y);
}
function configuredKeys(token,apiKeys) {
  const keys=[];
  if(token)keys.push(['owner',token]);
  if(apiKeys){
    if(typeof apiKeys!=='object'||Array.isArray(apiKeys))throw new Error('THERMALOOP_API_KEYS must be a JSON object');
    for(const [name,value] of Object.entries(apiKeys)){
      if(!/^[a-zA-Z0-9_-]{1,48}$/.test(name)||typeof value!=='string'||!value)
        throw new Error('Invalid named API key');
      if(name==='owner'||keys.some(([id])=>id===name))throw new Error('Duplicate API key name');
      keys.push([name,value]);
    }
  }
  if(new Set(keys.map(([,value])=>value)).size!==keys.length)throw new Error('API key values must be unique');
  return keys;
}
function validateRemoteConfig(host,keys) {
  if(['127.0.0.1','localhost','::1'].includes(host))return;
  if(!keys.length||keys.some(([,value])=>Buffer.byteLength(value,'utf8')<32))
    throw new Error('Public binding requires a random API secret of at least 32 bytes for every principal');
}
function createServer({token=process.env.THERMALOOP_API_TOKEN??'',apiKeys=process.env.THERMALOOP_API_KEYS?
  JSON.parse(process.env.THERMALOOP_API_KEYS):{},maxWorkers=2,maxRequestsPerMinute=120,
  maxEvaluationsPerMinute=12,maxResearchesPerMinute=2,maxEpisodesPerPrincipal=16,
  storePath=process.env.THERMALOOP_EPISODE_STORE??''}={}) {
  for(const [name,n] of Object.entries({maxWorkers,maxRequestsPerMinute,maxEvaluationsPerMinute,maxResearchesPerMinute,maxEpisodesPerPrincipal}))
    if(!Number.isInteger(n)||n<1||n>10000)throw new Error('Invalid limit: '+name);
  const keys=configuredKeys(token,apiKeys);
  let active=0;
  const workers=new Set();
  const persistence=createEpisodeStore(storePath,ROOT);
  let episodes=new Map(persistence.load().filter(e=>Date.now()-e.touched<=EPISODE_IDLE_MS).map(e=>[e.id,e]));
  const quotas=new Map();
  const server=http.createServer(async (req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('X-Frame-Options','DENY');
    const json=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
    const readJSON=async()=>{
      if(!(req.headers['content-type']??'').toLowerCase().startsWith('application/json')){
        const e=new Error('Content-Type must be application/json');e.status=415;throw e;
      }
      let size=0;const chunks=[];
      for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){
        const e=new Error('Request exceeds 64 KiB');e.status=413;throw e;
      }chunks.push(chunk);}
      return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    };
    let pathname;
    try {pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);} catch {json(400,{error:'Invalid URL'});return;}
    if(pathname==='/healthz'&&req.method==='GET'){
      json(200,{status:'ready',apiVersion:API_VERSION,mode:'simulation-only',hardwareConnected:false});return;
    }
    if (pathname.startsWith('/api/')) {
      if (req.headers.origin) {
        let same=false;try{same=new URL(req.headers.origin).host===req.headers.host;}catch{}
        if(!same){json(403,{error:'Cross-origin API access is disabled'});return;}
      }
      let owner='local';
      if(keys.length){
        const authorization=req.headers.authorization??'';
        const matched=keys.find(([,value])=>equalToken(authorization,'Bearer '+value));
        if(!matched){json(401,{error:'Bearer token required'});return;}
        owner=matched[0];
      }
      const now=Date.now(),bucket=quotas.get(owner);
      const usage=bucket&&now-bucket.started<60000?bucket:{started:now,requests:0,evaluations:0,researches:0};
      quotas.set(owner,usage);
      res.setHeader('RateLimit-Limit',String(maxRequestsPerMinute));
      res.setHeader('RateLimit-Remaining',String(Math.max(0,maxRequestsPerMinute-usage.requests-1)));
      if(usage.requests>=maxRequestsPerMinute){
        res.setHeader('Retry-After',String(Math.max(1,Math.ceil((60000-(now-usage.started))/1000))));
        json(429,{error:'Agent request quota reached; retry later'});return;
      }
      usage.requests++;
      if(req.method==='GET'&&pathname==='/api/v1/health'){
        json(200,{status:'ready',apiVersion:API_VERSION,engineVersion:engine.VERSION,
          mode:'simulation-only',hardwareConnected:false,persistence:storePath?'local-file':'memory'});return;
      }
      if(req.method==='GET'&&pathname==='/api/v1/schema'){json(200,engine.schema());return;}
      if(req.method==='GET'&&pathname==='/api/v1/openapi.json'){
        const document=engine.openapi();document.info.version=API_VERSION;
        const entry=structuredClone(document.paths['/api/v1/research/optimize']);
        entry.post.operationId='runTerminalMatchedResearch';
        entry.post.summary='Bounded research requiring comparable terminal thermal states';
        entry.post.description='Web Service v1.4 research: nominal final GPU, coolant and building temperatures must match the paired baseline within explicit illustrative bands; synthetic and uncalibrated, no hardware access.';
        document.paths['/api/v1/research/validated']=entry;
        document.paths['/physics-lab']={get:{operationId:'openWebServicePhysicsLab',
          summary:'Web Service-only browser-local physical experiment laboratory',security:[],
          responses:{'200':{description:'Isometric thermal-state experiment website; not a hardware control interface'}}}};
        json(200,document);return;
      }
      if(req.method==='GET'&&pathname==='/api/v1/usage'){
        json(200,{apiVersion:API_VERSION,principal:owner,requestsInWindow:usage.requests,
          requestsPerMinute:maxRequestsPerMinute,evaluationsInWindow:usage.evaluations,
          evaluationsPerMinute:maxEvaluationsPerMinute,researchesInWindow:usage.researches??0,
          researchesPerMinute:maxResearchesPerMinute,activeEpisodes:[...episodes.values()].filter(e=>e.owner===owner).length,
          maxEpisodesPerPrincipal,globalEpisodes:episodes.size,maxGlobalEpisodes:MAX_EPISODES,
          windowResetsInSeconds:Math.max(1,Math.ceil((60000-(now-usage.started))/1000))});return;
      }
      const episodeCollection=pathname==='/api/v1/episodes';
      const episodeMatch=/^\/api\/v1\/episodes\/([0-9a-f-]{36})(?:\/(step|report))?$/.exec(pathname);
      if(episodeCollection||episodeMatch){
        // A session is an ephemeral simulation, never a durable device-control handle.
        const live=new Map([...episodes].filter(([,entry])=>now-entry.touched<=EPISODE_IDLE_MS));
        if(live.size!==episodes.size){try{persistence.save(live);episodes=live;}
          catch{json(503,{error:'Episode storage temporarily unavailable'});return;}}
        if(episodeCollection){
          if(req.method!=='POST'){res.setHeader('Allow','POST');json(405,{error:'Use POST to create an episode'});return;}
          if(episodes.size>=MAX_EPISODES){json(503,{error:'Episode capacity reached'});return;}
          if([...episodes.values()].filter(e=>e.owner===owner).length>=maxEpisodesPerPrincipal){
            json(429,{error:'Principal episode quota reached'});return;
          }
          try{
            const input=await readJSON(),episode=engine.startEpisode(input),id=crypto.randomUUID();
            const updated=new Map(episodes);updated.set(id,{episode,owner,touched:Date.now()});
            persistence.save(updated);episodes=updated;
            json(201,{episodeId:id,...engine.observeEpisode(episode)});
          }catch(e){json(e.status??(e instanceof TypeError||e instanceof RangeError||e instanceof SyntaxError?400:503),
            {error:e.status||e instanceof TypeError||e instanceof RangeError||e instanceof SyntaxError?e.message:'Episode storage temporarily unavailable'});}
          return;
        }
        const [ ,id,action]=episodeMatch;
        const entry=episodes.get(id);
        if(!entry||entry.owner!==owner){json(404,{error:'Episode not found or expired'});return;}
        if(action==='step'&&req.method==='POST'){
          try{
            const input=await readJSON();
            if(!input||!Number.isInteger(input.expectedMinute))throw new RangeError('HTTP step requires integer expectedMinute');
            // Persist before replacing the live session, so a failed disk write never advances it.
            const draft=storePath?restoreEpisode(snapshotEpisode(entry.episode)):entry.episode;
            const observation=engine.stepEpisode(draft,input);
            const updated=new Map(episodes);updated.set(id,{episode:draft,owner,touched:Date.now()});
            persistence.save(updated);episodes=updated;
            json(200,{episodeId:id,...observation});
          }catch(e){const bad=e instanceof TypeError||e instanceof RangeError||e instanceof SyntaxError;
            json(e.status??(bad?400:503),{error:bad?e.message:'Episode storage temporarily unavailable'});}
          return;
        }
        if(!action&&req.method==='DELETE'){
          try{const updated=new Map(episodes);updated.delete(id);persistence.save(updated);episodes=updated;
            json(200,{episodeId:id,discarded:true});}
          catch{json(503,{error:'Episode storage temporarily unavailable'});}return;
        }
        // Read access also renews idle expiry. Only commit it once persistence succeeds.
        if(req.method==='GET'){
          try{const updated=new Map(episodes);updated.set(id,{...entry,touched:Date.now()});
            persistence.save(updated);episodes=updated;}
          catch{json(503,{error:'Episode storage temporarily unavailable'});return;}
        }
        if(!action&&req.method==='GET'){json(200,{episodeId:id,...engine.observeEpisode(entry.episode)});return;}
        if(action==='report'&&req.method==='GET'){
          json(200,{episodeId:id,...engine.episodeReport(entry.episode)});return;
        }
        json(405,{error:'Unsupported episode method'});return;
      }
      const isValidatedResearch=pathname==='/api/v1/research/validated';
      const isResearch=isValidatedResearch||pathname==='/api/v1/research/optimize';
      if(!isResearch&&pathname!=='/api/v1/simulations/evaluate'){
        json(404,{error:'Unknown endpoint; no hardware control endpoints exist'});return;}
      if(req.method!=='POST'){res.setHeader('Allow','POST');json(405,{error:'Use POST'});return;}
      if(isResearch?(usage.researches??0)>=maxResearchesPerMinute:usage.evaluations>=maxEvaluationsPerMinute){
        res.setHeader('Retry-After',String(Math.max(1,Math.ceil((60000-(now-usage.started))/1000))));
        json(429,{error:(isResearch?'Research':'Evaluation')+' quota reached; retry later'});return;}
      if(active>=maxWorkers){json(503,{error:'Simulation capacity reached; retry later'});return;}
      try {
        const input=await readJSON();
        if(isResearch)research.normalize(input);else engine.normalize(input); // reject before reserving a worker
        if(active>=maxWorkers){json(503,{error:'Simulation capacity reached; retry later'});return;}
        if(isResearch)usage.researches=(usage.researches??0)+1;else usage.evaluations++;
        const worker=new Worker(__filename,{workerData:{input,
          kind:isValidatedResearch?'validated':isResearch?'research':'evaluate'}});active++;workers.add(worker);
        let settled=false;
        const finish=(status,data)=>{if(settled)return;settled=true;clearTimeout(timer);active--;workers.delete(worker);json(status,data);worker.terminate();};
        const timer=setTimeout(()=>finish(504,{error:'Simulation time budget exceeded'}),15000);
        worker.once('message',m=>finish(m.ok?200:400,m.ok?m.result:{error:m.error}));
        worker.once('error',()=>finish(500,{error:'Simulation worker failed'}));
        worker.once('exit',()=>{if(!settled)finish(500,{error:'Simulation worker exited without a result'});});
        res.once('close',()=>{if(!settled)finish(499,{error:'Client disconnected'});});
      } catch(e){json(e.status??400,{error:e.message});}
      return;
    }
    if(!['GET','HEAD'].includes(req.method)){json(405,{error:'Read-only static server'});return;}
    const relative=pathname==='/'?'index.html':pathname==='/physics-lab'?'service/physics-lab.html':pathname.replace(/^\//,'');
    const ext=path.extname(relative).toLowerCase();
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.md':'text/plain','.txt':'text/plain'};
    if(relative.split('/').some(p=>p.startsWith('.'))||!mime[ext]){json(404,{error:'Not found'});return;}
    try {
      const target=await fs.realpath(path.resolve(ROOT,relative));
      if(!target.startsWith(ROOT+path.sep)){json(404,{error:'Not found'});return;}
      let content=await fs.readFile(target);
      if(relative==='index.html'){
        // This shortcut exists only in the Web Service response; the legacy
        // Static Site index.html and its pinned inline scripts stay untouched.
        const label='<a class="btn btn-primary" href="/physics-lab" style="font-size:10px;white-space:nowrap">PHYSICS LAB v1.4 ↗</a>';
        content=Buffer.from(content.toString('utf8').replace('<div class="top-right">','<div class="top-right">'+label));
      }
      res.writeHead(200,{'Content-Type':mime[ext]+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:content);
    } catch{json(404,{error:'Not found'});}
  });
  server.headersTimeout=10000;server.requestTimeout=20000;
  server.on('close',()=>{for(const w of workers)w.terminate();});
  return server;
}
if(!isMainThread){
  try{parentPort.postMessage({ok:true,result:workerData.kind==='validated'?
    validatedResearch.run(workerData.input):workerData.kind==='research'?
      research.run(workerData.input):engine.evaluate(workerData.input)});}catch(e){parentPort.postMessage({ok:false,error:e.message});}
} else if(require.main===module){
  const host=process.env.HOST??'127.0.0.1',port=Number(process.env.PORT??8787);
  try{
    const token=process.env.THERMALOOP_API_TOKEN??'';
    const apiKeys=process.env.THERMALOOP_API_KEYS?JSON.parse(process.env.THERMALOOP_API_KEYS):{};
    validateRemoteConfig(host,configuredKeys(token,apiKeys));
    createServer({token,apiKeys,maxEpisodesPerPrincipal:Number(process.env.THERMALOOP_MAX_EPISODES_PER_AGENT??16)})
      .listen(port,host,()=>console.log(`ThermaLoop v${API_VERSION} simulation API listening on ${host}:${port} — no hardware connection`));
  }catch(e){console.error('Refusing to start: '+e.message);process.exit(1);}
}
module.exports={createServer,validateRemoteConfig,configuredKeys};
