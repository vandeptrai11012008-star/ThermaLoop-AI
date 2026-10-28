'use strict';
importScripts('agent-sandbox-model.js');
self.onmessage=event=>{
  try { self.postMessage({ok:true,result:self.ThermaAgentSandbox.evaluate(event.data)}); }
  catch(error) { self.postMessage({ok:false,error:error.message}); }
};
