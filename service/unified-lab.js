/* Browser-local v1.5 world editor. All physics and topology rules are owned by
 * unified-physics.js; SVG, fields and charts are read-only projections. */
(()=>{'use strict';
  const M=globalThis.ThermaUnifiedPhysics,$=id=>document.getElementById(id);
  if(!M){document.body.textContent='Unified physics solver failed to load';return;}
  const KEY='thermaloop-unified-world-v15';let world=null,selected='P-101';
  let benchmarkWorker=null,benchmarkReport=null;
  const names={pump:'Pump',gpu:'Aggregate GPU',pipe:'Pipe',hx:'Heat exchanger',cooler:'Dry cooler',tank:'Thermal tank'};
  const colors={pump:'#57c8e5',gpu:'#f0a376',pipe:'#65aed8',hx:'#91e7cd',cooler:'#a99ef0',tank:'#ebc783'};
  const fmt=(v,n=2)=>Number.isFinite(v)?v.toFixed(n):'—';
  const ns='http://www.w3.org/2000/svg';
  function element(tag,attrs={},value){const e=document.createElementNS(ns,tag);
    for(const [k,v]of Object.entries(attrs))e.setAttribute(k,String(v));if(value!==undefined)e.textContent=String(value);return e;}
  function controlsFromUI(){return {pumpPct:Number($('pump').value),fanPct:Number($('fan').value),
    recoveryPct:Number($('recovery').value),gpuLoadPct:Number($('load').value),
    heatingSetpointC:Number($('setpoint').value)};}
  function scenarioFromUI(){return {preset:$('preset').value,seed:Number($('seed').value),
    horizonMinutes:Number($('horizon').value)};}
  function status(id,message,error=false){$(id).textContent=message;$(id).className='status '+(error?'error':'good');}
  function labelControls(){for(const [id,label,suffix]of [['pump','pumpLabel','%'],['fan','fanLabel','%'],
    ['recovery','recoveryLabel','%'],['load','loadLabel','%'],['setpoint','setpointLabel','°C']])
    $(label).textContent=$(id).value+suffix;}
  function publish(){try{localStorage.setItem(KEY,JSON.stringify({version:M.VERSION,updatedAt:Date.now(),
    world:M.report(world)}));}catch{ /* storage is optional */ }}
  function showWorld(){const t=world.topology,x=world.state,svg=$('worldSvg');svg.replaceChildren();
    const order=t.order,n=order.length,cols=n<=6?3:4;
    const canvasHeight=n<=6?515:n<=8?460:565;
    svg.setAttribute('viewBox',`0 0 980 ${canvasHeight}`);
    const coords=order.map((id,i)=>({id,x:165+(i%cols)*((980-330)/Math.max(1,cols-1)),
      y:115+Math.floor(i/cols)*(n<=6?176:122)}));
    const defs=element('defs'),marker=element('marker',{id:'flowArrow',markerWidth:8,markerHeight:8,refX:5,refY:3,orient:'auto'});
    marker.append(element('path',{d:'M0,0 L6,3 L0,6 Z',fill:'#7adbd9'}));defs.append(marker);svg.append(defs);
    const byId=Object.fromEntries(coords.map(c=>[c.id,c]));
    for(const edge of t.edges){const a=byId[edge.from],b=byId[edge.to];
      svg.append(element('path',{class:'connection',d:`M ${a.x} ${a.y+12} L ${b.x} ${b.y+12}`,
        'marker-end':'url(#flowArrow)'}));}
    const stored=world.last,flow=stored?.flowLps??M.hydraulics(t,world.controls.pumpPct).flowLps;
    for(const pos of coords){const node=t.nodes.find(z=>z.id===pos.id),type=node.type,sel=selected===node.id;
      const g=element('g',{class:'node'+(sel?' selected':''),tabindex:0,role:'button',
        'aria-label':`Inspect ${node.id} ${names[type]}`});
      const {x:cx,y:cy}=pos,color=colors[type],top=element('polygon',{points:
        `${cx-68},${cy-10} ${cx},${cy-46} ${cx+68},${cy-10} ${cx},${cy+26}`,fill:color,opacity:.95});
      const left=element('polygon',{points:`${cx-68},${cy-10} ${cx},${cy+26} ${cx},${cy+91} ${cx-68},${cy+54}`,fill:color,opacity:.61});
      const right=element('polygon',{points:`${cx},${cy+26} ${cx+68},${cy-10} ${cx+68},${cy+54} ${cx},${cy+91}`,fill:color,opacity:.78});
      g.append(left,right,top);
      g.append(element('text',{x:cx,y:cy+115,'text-anchor':'middle',class:'node-id'},node.id));
      g.append(element('text',{x:cx,y:cy+132,'text-anchor':'middle',class:'node-label'},names[type]));
      const outlet=stored?.componentTransfers?.find(v=>v.id===node.id)?.outletC;
      const temp=type==='gpu'?x.gpuC:Number.isFinite(outlet)?outlet:x.coolantC;
      g.append(element('text',{x:cx,y:cy+149,'text-anchor':'middle',class:'node-temp'},fmt(temp)+'°C'));
      const pick=()=>{selected=node.id;showWorld();renderEditor();};
      g.addEventListener('click',pick);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();pick();}});
      svg.append(g);}
    const info=element('text',{x:22,y:canvasHeight-17,class:'canvas-note'},
      `${n} connected components · ${fmt(flow)} L/s · stream outlet readings follow graph order · not CFD`);
    svg.append(info);
  }
  function showChart(){const svg=$('chart'),rows=world.trace;svg.replaceChildren();
    const L=45,R=790,T=15,B=190,lo=Math.min(0,...rows.flatMap(r=>[r.coolantC,r.buildingC,r.gpuC]))-2,
      hi=Math.max(55,...rows.flatMap(r=>[r.coolantC,r.buildingC,r.gpuC]))+2;
    const x=m=>L+(R-L)*m/world.scenario.horizonMinutes,y=v=>B-(B-T)*(v-lo)/(hi-lo);
    for(let i=0;i<5;i++){const v=lo+(hi-lo)*i/4,yy=y(v);svg.append(element('line',{class:'gridline',x1:L,x2:R,y1:yy,y2:yy}));
      svg.append(element('text',{class:'axis',x:1,y:yy+4},fmt(v,0)+'°'));}
    for(const [key,kind]of [['gpuC','gpu'],['coolantC','coolant'],['buildingC','room']]){
      const d=rows.map((r,i)=>(i?'L':'M')+fmt(x(r.minute))+','+fmt(y(r[key]))).join(' ');
      svg.append(element('path',{class:'trace '+kind,d}));}
    svg.append(element('text',{class:'axis',x:L,y:222},'0 min'));
    svg.append(element('text',{class:'axis',x:R-44,y:222},world.scenario.horizonMinutes+' min'));
  }
  function showMetrics(){const x=world.state,hyd=world.last??M.hydraulics(world.topology,world.controls.pumpPct);
    const entries=[['GPU temperature',x.gpuC,'°C'],['Coolant temperature',x.coolantC,'°C'],
      ['Occupied room',x.buildingC,'°C'],['Hydraulic flow',hyd.flowLps,'L/s']];
    $('readings').replaceChildren(...entries.map(([name,val,unit])=>{
      const div=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');
      small.textContent=name;strong.textContent=fmt(val)+' '+unit;div.append(small,strong);return div;}));
    const audits=[['Pump head',hyd.pumpHeadPa/1000,'kPa'],['Pump electrical',hyd.pumpElectricKW,'kW'],
      ['Energy residual',world.energyResidualKJ,'kJ'],['Pressure residual',world.maxPressureResidualPa,'Pa'],
      ['Site electricity',world.metrics.siteElectricKWh,'kWh'],['Recovered heat',world.metrics.recoveredHeatKWh,'kWh'],
      ['Water capacity',M.waterCapacityKJK(world.topology),'kJ/K'],['Violations',world.violations.length,'']];
    $('audit').replaceChildren(...audits.map(([name,val,unit])=>{
      const div=document.createElement('div'),small=document.createElement('small'),strong=document.createElement('strong');
      small.textContent=name;strong.textContent=(name==='Violations'?String(val):
        val<1e-6&&val!==0?val.toExponential(2):fmt(val))+(unit?' '+unit:'');
      div.append(small,strong);return div;}));
    $('minute').textContent=world.minute+' / '+world.scenario.horizonMinutes;
    $('traceNote').textContent=`${world.trace.length} exact shared-state observations · ${world.violations.length} limit types violated. Model accuracy outside the synthetic envelope is unverified.`;
    for(const id of ['stepOne','stepFive','stepTen'])$(id).disabled=world.minute===world.scenario.horizonMinutes;
  }
  function renderEditor(){const t=world.topology,$n=$('nodeSelect'),previous=$n.value;
    $n.replaceChildren(...t.nodes.map(n=>new Option(n.id+' · '+names[n.type],n.id)));
    if(t.nodes.some(n=>n.id===selected))$n.value=selected;else{selected=t.nodes[0].id;$n.value=selected;}
    const node=t.nodes.find(n=>n.id===selected),$p=$('paramSelect'),oldParam=$p.value;
    $p.replaceChildren(...Object.keys(M.BOUNDS[node.type]).map(k=>new Option(k,k)));
    $p.value=Object.hasOwn(node.params,oldParam)?oldParam:Object.keys(node.params)[0];
    const [min,max]=M.BOUNDS[node.type][$p.value];$('paramValue').value=String(node.params[$p.value]);
    $('paramValue').min=min;$('paramValue').max=max;
    for(const id of ['insertAfter','moveAfter']){
      const e=$(id),old=e.value;e.replaceChildren(...t.order.map(n=>new Option(n,n)));
      e.value=t.order.includes(old)?old:selected;}
    const editable=world.minute===0;
    for(const id of ['editParam','removeNode','addPipe','addTank','rewire'])$(id).disabled=!editable;
    $('removeNode').disabled=!editable||!['pipe','tank'].includes(node.type);
  }
  function refresh(){showWorld();showMetrics();showChart();renderEditor();publish();}
  function reset(){try{world=M.createWorld({topology:world?.topology,scenario:scenarioFromUI(),controls:controlsFromUI()});
    status('controlStatus','New episode started. All views use the same physical checkpoint.');refresh();}
    catch(e){status('controlStatus',e.message,true);}}
  function step(minutes){try{if(!world)throw Error('Start first');
    world=M.advance(world,{minutes:Math.min(minutes,world.scenario.horizonMinutes-world.minute),
      expectedMinute:world.minute,controls:controlsFromUI()});refresh();
    status('controlStatus',`Minute ${world.minute}: ${fmt(world.last.flowLps)} L/s, ${fmt(world.last.pumpHeadPa/1000)} kPa; ${world.violations.length} warnings.`);}
    catch(e){status('controlStatus',e.message,true);}}
  function edit(change){try{if(world.minute!==0)throw Error('Reset before modifying physical connections');
    const graph=change(structuredClone(world.topology));world=M.editTopology(world,M.topology(graph));
    status('topologyStatus','Validated and connected. Circuit recalculated; no fake energy created.');refresh();}
    catch(e){status('topologyStatus',e.message,true);}}
  function add(kind){edit(t=>{const used=new Set(t.nodes.map(n=>n.id)),prefix=kind==='pipe'?'PIPE-X':'TES-X';
    let seq=1;while(used.has(prefix+seq))seq++;
    const params=kind==='pipe'?{lengthM:12,diameterMm:50,roughnessMm:.03,minorLossK:2,uaWK:7}:
      {waterLiters:200,lossK:1,uaWK:5};
    const node={id:prefix+seq,type:kind,params};const newT=M.spliceAfter(t,node,$('insertAfter').value);
    selected=node.id;return newT;});}
  function exportReport(){const json=JSON.stringify(M.report(world),null,2),url=URL.createObjectURL(new Blob([json],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download='thermaloop-unified-world-v15.json';a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);}
  function benchmarkBusy(busy){$('benchmarkRun').disabled=busy;$('benchmarkSize').disabled=busy;
    $('benchmarkStop').disabled=!busy;$('benchmarkExport').disabled=busy||!benchmarkReport;}
  function stopBenchmark(message='Benchmark cancelled.'){
    if(benchmarkWorker){benchmarkWorker.terminate();benchmarkWorker=null;}
    benchmarkBusy(false);$('benchmarkProgress').hidden=true;
    if(message)status('benchmarkStatus',message);
  }
  function showBenchmark(result){
    const labels={fixed:'Fixed baseline',threshold:'Temperature threshold',trend:'Temperature trend'};
    $('benchmarkRows').replaceChildren(...['fixed','threshold','trend'].map(id=>{
      const r=result.summary[id],tr=document.createElement('tr');
      const cells=[labels[id],fmt(r.meanSiteElectricKWh,3),fmt(r.meanComputeServiceHours,4),
        fmt(r.meanRecoveredHeatKWh,4),r.episodesWithViolations+' / '+r.episodes];
      for(const v of cells){const cell=document.createElement('td');cell.textContent=v;tr.append(cell);}return tr;
    }));
    $('benchmarkMeta').textContent=`${result.episodeCount} paired simulation episodes · ${result.cases.length} scenarios · ${result.seedValues.length} seed(s) · ${result.horizonMinutes} simulated minutes each · engine ${result.engineVersion}`;
    const base=result.summary.fixed,trend=result.summary.trend;
    const saved=base.meanSiteElectricKWh-trend.meanSiteElectricKWh;
    const work=trend.meanComputeServiceHours-base.meanComputeServiceHours;
    const violationMessage=trend.episodesWithViolations===base.episodesWithViolations?
      'The trend controller did not reduce the number of episodes with violations.':
      `Violating episodes: fixed ${base.episodesWithViolations}, trend ${trend.episodesWithViolations}.`;
    $('benchmarkInsight').textContent=`Trend vs fixed: ${saved>=0?'saved':'used an extra'} ${fmt(Math.abs(saved),3)} kWh/episode; ${work<0?'lost':'gained'} ${fmt(Math.abs(work),4)} compute-service hours/episode. ${violationMessage} No real-world accuracy or trained AI superiority is established.`;
    $('benchmarkResults').hidden=false;
  }
  function runBenchmark(){
    if(benchmarkWorker)return;
    if(typeof Worker!=='function'){status('benchmarkStatus','This browser does not support Web Workers.',true);return;}
    const mode=$('benchmarkSize').value,total=mode==='full'?150:30;
    if(!['quick','full'].includes(mode)){status('benchmarkStatus','Unknown benchmark size.',true);return;}
    benchmarkReport=null;$('benchmarkResults').hidden=true;$('benchmarkProgress').hidden=false;
    $('benchmarkProgress').max=total;$('benchmarkProgress').value=0;
    benchmarkBusy(true);status('benchmarkStatus',`Running 0 / ${total} identical-condition experiments in this browser…`);
    try{
      const worker=new Worker('/service/unified-benchmark-worker.js');benchmarkWorker=worker;
      worker.onmessage=event=>{
        if(benchmarkWorker!==worker)return;
        const m=event.data;
        if(m?.type==='progress'){$('benchmarkProgress').value=m.done;
          status('benchmarkStatus',`Running ${m.done} / ${m.total} episodes…`);}
        else if(m?.type==='result'){
          benchmarkReport=m.result;showBenchmark(m.result);
          stopBenchmark(`Complete: ${m.result.episodeCount} reproducible simulated episodes. No remote API calls or hardware control.`);
        }else if(m?.type==='error'){
          stopBenchmark('');status('benchmarkStatus',m.message||'Benchmark failed',true);
        }
      };
      worker.onerror=event=>{if(benchmarkWorker!==worker)return;
        stopBenchmark('');status('benchmarkStatus',event.message||'Benchmark worker failed',true);};
      worker.postMessage({type:'run',mode});
    }catch(e){stopBenchmark('');status('benchmarkStatus',e.message,true);}
  }
  function exportBenchmark(){
    if(!benchmarkReport)return;
    const url=URL.createObjectURL(new Blob([JSON.stringify(benchmarkReport,null,2)],{type:'application/json'}));
    const a=document.createElement('a');a.href=url;a.download=`thermaloop-physics-benchmark-${benchmarkReport.episodeCount}-episodes.json`;a.click();
    setTimeout(()=>URL.revokeObjectURL(url),2000);
  }
  function initialize(){for(const id of ['pump','fan','recovery','load','setpoint'])$(id).addEventListener('input',labelControls);
    $('reset').addEventListener('click',reset);$('stepOne').addEventListener('click',()=>step(1));
    $('stepFive').addEventListener('click',()=>step(5));$('stepTen').addEventListener('click',()=>step(10));
    $('export').addEventListener('click',exportReport);$('nodeSelect').addEventListener('change',e=>{selected=e.target.value;showWorld();renderEditor();});
    $('paramSelect').addEventListener('change',()=>{const n=world.topology.nodes.find(n=>n.id===selected),key=$('paramSelect').value;
      const [min,max]=M.BOUNDS[n.type][key];$('paramValue').min=min;$('paramValue').max=max;$('paramValue').value=n.params[key];});
    $('editParam').addEventListener('click',()=>edit(t=>{t.nodes.find(n=>n.id===selected).params[$('paramSelect').value]=Number($('paramValue').value);return t;}));
    $('removeNode').addEventListener('click',()=>edit(t=>{const newT=M.removeNode(t,selected);selected=newT.order[0];return newT;}));
    $('addPipe').addEventListener('click',()=>add('pipe'));$('addTank').addEventListener('click',()=>add('tank'));
    $('rewire').addEventListener('click',()=>edit(t=>M.moveAfter(t,selected,$('moveAfter').value)));
    $('benchmarkRun').addEventListener('click',runBenchmark);
    $('benchmarkStop').addEventListener('click',()=>stopBenchmark());
    $('benchmarkExport').addEventListener('click',exportBenchmark);
    labelControls();reset();
    globalThis.ThermaUnifiedLab={getReport:()=>structuredClone(M.report(world)),getWorld:()=>structuredClone(world),
      getBenchmark:()=>benchmarkReport?structuredClone(benchmarkReport):null};
  }
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',initialize);else initialize();
})();
