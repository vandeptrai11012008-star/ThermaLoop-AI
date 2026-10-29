/* Physics Lab browser-only worker. Avoids compute-heavy unauthenticated server jobs. */
'use strict';
importScripts('/service/unified-physics.js','/service/unified-benchmark.js');
const B=self.ThermaUnifiedBenchmark;
self.onmessage=event=>{
  const mode=event.data?.mode;
  if(event.data?.type!=='run'||!['quick','full'].includes(mode)){
    self.postMessage({type:'error',message:'Unsupported benchmark request'});return;
  }
  try{
    const seeds=mode==='quick'?[B.DEFAULT_SEEDS[0]]:B.DEFAULT_SEEDS;
    const result=B.benchmark({seeds,onProgress:({done,total})=>{
      if(done%5===0||done===total)self.postMessage({type:'progress',done,total});
    }});
    self.postMessage({type:'result',result});
  }catch(error){self.postMessage({type:'error',message:error.message});}
};
