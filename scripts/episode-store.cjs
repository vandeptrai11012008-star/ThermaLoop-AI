'use strict';
// Optional single-instance, local-disk persistence for reproducible simulations.
// Stores replay inputs, not device commands or authentication secrets.
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const engine=require('../science/agent-sandbox-model.js');

function snapshotEpisode(episode) {
  const report=engine.episodeReport(episode);
  return {minute:report.minute,replayRequest:report.replayRequest};
}

function restoreEpisode(snapshot) {
  if(!snapshot||!Number.isInteger(snapshot.minute))throw new Error('Invalid persisted episode minute');
  const request=engine.normalize(snapshot.replayRequest);
  const minute=snapshot.minute;
  if(minute<0||minute>request.scenario.horizonMinutes)throw new Error('Invalid persisted episode horizon');
  if(request.plan.some(action=>action.atMinute>=minute))throw new Error('Persisted actions occur after episode minute');
  const episode=engine.startEpisode({scenario:snapshot.replayRequest.scenario});
  let cursor=0;
  for(let i=0;i<request.plan.length;i++){
    const action=request.plan[i];
    if(action.atMinute>cursor){engine.stepEpisode(episode,{minutes:action.atMinute-cursor});cursor=action.atMinute;}
    const until=request.plan[i+1]?.atMinute??minute;
    if(until<=cursor)throw new Error('Invalid persisted control schedule');
    engine.stepEpisode(episode,{minutes:until-cursor,controls:action.controls});cursor=until;
  }
  if(cursor<minute)engine.stepEpisode(episode,{minutes:minute-cursor});
  return episode;
}

function createEpisodeStore(storePath,root) {
  if(!storePath)return {load:()=>[],save:()=>{}};
  const file=path.resolve(storePath),publicRoot=path.resolve(root);
  if(file===publicRoot||file.startsWith(publicRoot+path.sep))
    throw new Error('Episode store must be outside the publicly served repository');
  const directory=path.dirname(file);
  fs.mkdirSync(directory,{recursive:true,mode:0o700});
  return {
    load() {
      if(!fs.existsSync(file))return [];
      const data=JSON.parse(fs.readFileSync(file,'utf8'));
      if(data.version!==1||!Array.isArray(data.episodes)||data.episodes.length>16)
        throw new Error('Unsupported or oversized episode store');
      return data.episodes.map(record=>{
        if(!/^[0-9a-f-]{36}$/.test(record.id)||typeof record.owner!=='string'||record.owner.length>128||
          !Number.isFinite(record.touched))throw new Error('Invalid persisted episode metadata');
        return {id:record.id,owner:record.owner,touched:record.touched,episode:restoreEpisode(record.snapshot)};
      });
    },
    save(episodes) {
      const entries=[...episodes.entries()].map(([id,entry])=>({id,owner:entry.owner,
        touched:entry.touched,snapshot:snapshotEpisode(entry.episode)}));
      if(entries.length>16)throw new Error('Episode store capacity exceeded');
      const temp=path.join(directory,'.thermaloop-'+crypto.randomUUID()+'.tmp');
      try{
        fs.writeFileSync(temp,JSON.stringify({version:1,episodes:entries}),{mode:0o600,flag:'wx'});
        fs.renameSync(temp,file);
      }finally{try{fs.unlinkSync(temp);}catch(e){if(e.code!=='ENOENT')throw e;}}
    }
  };
}
module.exports={snapshotEpisode,restoreEpisode,createEpisodeStore};
