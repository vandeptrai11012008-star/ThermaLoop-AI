#!/usr/bin/env node
'use strict';
// Runs the exact same benchmark implementation used by the Physics Lab worker.
const B=require('../service/unified-benchmark.js');
if(require.main===module){
  try{process.stdout.write(JSON.stringify(B.benchmark(),null,2)+'\n');}
  catch(error){process.stderr.write(error.stack+'\n');process.exitCode=1;}
}
module.exports=B;
