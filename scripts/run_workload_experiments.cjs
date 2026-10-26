#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const ROOT=path.join(__dirname,'..'),M=require('../science/workload-model.js');
const input=path.join(ROOT,'science/workloads/data.json'),D=JSON.parse(fs.readFileSync(input));
const hash=bytes=>crypto.createHash('sha256').update(bytes).digest('hex');
const defaultResult=M.experiment(D),routing=D.protocol.weakShares.map(share=>{
  const {rows,...result}=M.routing(D,share);return result;
});
const scheduling=[];
for(const slots of D.protocol.gpuSlots)for(const scale of D.protocol.arrivalScales)for(const policy of D.protocol.schedulerPolicies){
  const {jobs,timeline,...result}=M.schedule(D.scheduling.records,slots,scale,policy);scheduling.push(result);
}
const compactScheduler=defaultResult.scheduling.map(({jobs,timeline,...summary})=>summary);
const {rows,...compactRouter}=defaultResult.routing;
const output={schemaVersion:1,inputSHA256:hash(fs.readFileSync(input)),engineSHA256:hash(fs.readFileSync(path.join(ROOT,'science/workload-model.js'))),
  defaultResult:{...defaultResult,routing:compactRouter,scheduling:compactScheduler},routing,scheduling};
if(!Object.values(defaultResult.checks).every(Boolean)||!scheduling.every(s=>Object.values(s.checks).every(Boolean)))throw new Error('Workload accounting check failed');
const serialized=JSON.stringify(output,null,2)+'\n',file=path.join(ROOT,'science/workloads/results.json');
if(process.argv.includes('--check')){if(fs.readFileSync(file,'utf8')!==serialized)throw new Error('Saved workload experiment is stale');}
else fs.writeFileSync(file,serialized);
const outputIndex=process.argv.indexOf('--output');
if(outputIndex>=0){
  if(!process.argv[outputIndex+1])throw new Error('--output requires a destination file');
  fs.writeFileSync(path.resolve(process.argv[outputIndex+1]),JSON.stringify({...defaultResult,inputSHA256:output.inputSHA256,engineSHA256:output.engineSHA256},null,2)+'\n');
}
console.log(JSON.stringify({router:defaultResult.routing.accuraciesPct,weakCalls:defaultResult.routing.weakCalls,
  scheduler:defaultResult.scheduling.map(({policy,meanWaitSeconds,p95WaitSeconds,maxWaitSeconds})=>({policy,meanWaitSeconds,p95WaitSeconds,maxWaitSeconds})),checks:defaultResult.checks},null,2));
