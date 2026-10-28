'use strict';
const fs=require('node:fs'),path=require('node:path');
const model=require('../science/agent-sandbox-model.js');
const target=path.resolve(__dirname,'../science/agent-sandbox-openapi.json');
const content=JSON.stringify(model.openapi(),null,2)+'\n';
if(process.argv.includes('--check')){
  if(fs.readFileSync(target,'utf8')!==content)throw new Error('Agent OpenAPI contract is stale. Run node scripts/build_agent_contract.cjs');
  console.log('Agent OpenAPI contract matches engine.');
}else{fs.writeFileSync(target,content);console.log('Built science/agent-sandbox-openapi.json');}
