/* Web Service-only browser worker: no network, credentials or hardware calls. */
importScripts('/science/agent-sandbox-model.js','/science/agent-research-model.js','/service/validated-research.js');
self.onmessage=e=>{
  try{
    const result=ThermaValidatedResearch.run(e.data,{onProgress:progress=>postMessage({type:'progress',progress})});
    postMessage({type:'complete',result});
  }catch(error){postMessage({type:'error',error:error.message});}
};
