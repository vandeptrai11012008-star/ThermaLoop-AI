#!/usr/bin/env node
// Optional local agent API. Render Static Site continues to use index.html as before.
'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const {Worker,isMainThread,parentPort,workerData} = require('node:worker_threads');
const engine = require('../science/agent-sandbox-model.js');
const ROOT = path.resolve(__dirname,'..');
const MAX_BODY = 65536;
function equalToken(a,b) {
  const x=Buffer.from(a),y=Buffer.from(b);
  return x.length===y.length && crypto.timingSafeEqual(x,y);
}
function createServer({token=process.env.THERMALOOP_API_TOKEN??'',maxWorkers=2}={}) {
  let active=0;
  const workers=new Set();
  const server=http.createServer(async (req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');
    const json=(status,value)=>{if(!res.destroyed){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value));}};
    let pathname;
    try {pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);} catch {json(400,{error:'Invalid URL'});return;}
    if (pathname.startsWith('/api/')) {
      if (req.headers.origin) {
        let same=false;try{same=new URL(req.headers.origin).host===req.headers.host;}catch{}
        if(!same){json(403,{error:'Cross-origin API access is disabled'});return;}
      }
      if (token && !equalToken(req.headers.authorization??'','Bearer '+token)) {json(401,{error:'Bearer token required'});return;}
      if(req.method==='GET'&&pathname==='/api/v1/health'){json(200,{status:'ready',engineVersion:engine.VERSION,mode:'simulation-only',hardwareConnected:false});return;}
      if(req.method==='GET'&&pathname==='/api/v1/schema'){json(200,engine.schema());return;}
      if(req.method==='GET'&&pathname==='/api/v1/openapi.json'){json(200,engine.openapi());return;}
      if(pathname!=='/api/v1/simulations/evaluate'){json(404,{error:'Unknown endpoint; no hardware control endpoints exist'});return;}
      if(req.method!=='POST'){res.setHeader('Allow','POST');json(405,{error:'Use POST'});return;}
      if(!(req.headers['content-type']??'').toLowerCase().startsWith('application/json')){json(415,{error:'Content-Type must be application/json'});return;}
      if(active>=maxWorkers){json(503,{error:'Simulation capacity reached; retry later'});return;}
      let size=0,body='';
      try {
        for await(const chunk of req){size+=chunk.length;if(size>MAX_BODY){json(413,{error:'Request exceeds 64 KiB'});return;}body+=chunk.toString('utf8');}
        const input=JSON.parse(body);
        engine.normalize(input); // reject invalid actions before reserving a worker
        if(active>=maxWorkers){json(503,{error:'Simulation capacity reached; retry later'});return;}
        const worker=new Worker(__filename,{workerData:{input}});active++;workers.add(worker);
        let settled=false;
        const finish=(status,data)=>{if(settled)return;settled=true;clearTimeout(timer);active--;workers.delete(worker);json(status,data);worker.terminate();};
        const timer=setTimeout(()=>finish(504,{error:'Simulation time budget exceeded'}),15000);
        worker.once('message',m=>finish(m.ok?200:400,m.ok?m.result:{error:m.error}));
        worker.once('error',()=>finish(500,{error:'Simulation worker failed'}));
        worker.once('exit',()=>{if(!settled)finish(500,{error:'Simulation worker exited without a result'});});
        res.once('close',()=>{if(!settled)finish(499,{error:'Client disconnected'});});
      } catch(e){json(400,{error:e.message});}
      return;
    }
    if(!['GET','HEAD'].includes(req.method)){json(405,{error:'Read-only static server'});return;}
    const relative=pathname==='/'?'index.html':pathname.replace(/^\//,'');
    const ext=path.extname(relative).toLowerCase();
    const mime={'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json','.svg':'image/svg+xml','.md':'text/plain','.txt':'text/plain'};
    if(relative.split('/').some(p=>p.startsWith('.'))||!mime[ext]){json(404,{error:'Not found'});return;}
    try {
      const target=await fs.realpath(path.resolve(ROOT,relative));
      if(!target.startsWith(ROOT+path.sep)){json(404,{error:'Not found'});return;}
      const content=await fs.readFile(target);
      res.writeHead(200,{'Content-Type':mime[ext]+'; charset=utf-8'});res.end(req.method==='HEAD'?undefined:content);
    } catch{json(404,{error:'Not found'});}
  });
  server.headersTimeout=10000;server.requestTimeout=20000;
  server.on('close',()=>{for(const w of workers)w.terminate();});
  return server;
}
if(!isMainThread){
  try{parentPort.postMessage({ok:true,result:engine.evaluate(workerData.input)});}catch(e){parentPort.postMessage({ok:false,error:e.message});}
} else if(require.main===module){
  const host=process.env.HOST??'127.0.0.1',port=Number(process.env.PORT??8787);
  if(!['127.0.0.1','localhost','::1'].includes(host)&&!process.env.THERMALOOP_API_TOKEN){
    console.error('Set THERMALOOP_API_TOKEN before binding beyond loopback. Use TLS termination for remote access.');process.exit(1);
  }
  createServer().listen(port,host,()=>console.log(`ThermaLoop simulation API: http://${host}:${port} — no hardware connection`));
}
module.exports={createServer};
