'use strict';
importScripts('agent-sandbox-model.js','agent-research-model.js');
self.onmessage=event=>{
  try{
    const result=self.ThermaAgentResearch.run(event.data,{onProgress:progress=>self.postMessage({type:'progress',progress})});
    self.postMessage({type:'complete',result});
  }catch(error){self.postMessage({type:'error',error:error.message});}
};
