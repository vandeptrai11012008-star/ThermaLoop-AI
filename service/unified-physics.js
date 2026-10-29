/* ThermaLoop engineering world v1.5: one deterministic state for schematic, 3D
 * and remote agents. This is a reduced-order *uncalibrated* model, not CFD.
 * No hardware, sockets, filesystem or external dependencies. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;
  else root.ThermaUnifiedPhysics=api;})(globalThis,function(){
  'use strict';
  const VERSION='1.5.0';
  const WATER=Object.freeze({densityKgM3:997,cpKJKgK:4.18,viscosityPaS:0.00089});
  const AIR_CP=1.005;
  const BOUNDS={
    pump:{shutoffHeadKPa:[25,450],maxFlowLps:[1,20],efficiency:[.2,.95],lossK:[0,20],waterLiters:[1,100]},
    gpu:{thermalUAkWK:[.2,15],thermalCapacityKJK:[50,2000],lossK:[0,30],waterLiters:[1,100]},
    pipe:{lengthM:[.2,150],diameterMm:[15,150],roughnessMm:[.001,1],minorLossK:[0,40],uaWK:[0,200]},
    hx:{uaKWK:[.2,35],airMassFlowKgs:[.2,25],lossK:[0,40],waterLiters:[1,100]},
    cooler:{uaKWK:[.2,35],airMassFlowKgs:[.2,25],lossK:[0,40],waterLiters:[1,100]},
    tank:{waterLiters:[10,2000],lossK:[0,20],uaWK:[0,100]}
  };
  const DEFAULT_TOPOLOGY={nodes:[
    {id:'P-101',type:'pump',params:{shutoffHeadKPa:170,maxFlowLps:7,efficiency:.72,lossK:2,waterLiters:20}},
    {id:'GPU-001',type:'gpu',params:{thermalUAkWK:2.1,thermalCapacityKJK:180,lossK:4,waterLiters:12}},
    {id:'PIPE-A',type:'pipe',params:{lengthM:24,diameterMm:50,roughnessMm:.03,minorLossK:3,uaWK:12}},
    {id:'HX-101',type:'hx',params:{uaKWK:6,airMassFlowKgs:4,lossK:5,waterLiters:12}},
    {id:'PIPE-B',type:'pipe',params:{lengthM:18,diameterMm:50,roughnessMm:.03,minorLossK:2,uaWK:7}},
    {id:'DRY-101',type:'cooler',params:{uaKWK:7,airMassFlowKgs:5,lossK:6,waterLiters:12}}
  ],edges:[
    {from:'P-101',to:'GPU-001'},{from:'GPU-001',to:'PIPE-A'},
    {from:'PIPE-A',to:'HX-101'},{from:'HX-101',to:'PIPE-B'},
    {from:'PIPE-B',to:'DRY-101'},{from:'DRY-101',to:'P-101'}]};
  const BASE_CONTROLS={pumpPct:75,fanPct:70,recoveryPct:75,heatingSetpointC:21,gpuLoadPct:80};
  const CONTROL_BOUNDS={pumpPct:[0,100],fanPct:[0,100],recoveryPct:[0,100],heatingSetpointC:[16,25],gpuLoadPct:[0,100]};
  const SCENARIOS={winter:{outsideC:3,solarKW:2,occupants:40},summer:{outsideC:32,solarKW:8,occupants:40},
    burst:{outsideC:8,solarKW:2,occupants:40},'pump-fault':{outsideC:5,solarKW:2,occupants:40}};
  const LIMITS={gpuMaxC:85,coolantMaxC:50,occupiedMinC:18,occupiedMaxC:26,siteMaxKW:120};
  const copy=o=>JSON.parse(JSON.stringify(o));
  function obj(o,name){if(!o||typeof o!=='object'||Array.isArray(o))throw new TypeError(name+' must be an object');}
  function fields(o,allowed,name){obj(o,name);for(const key of Object.keys(o))if(!allowed.includes(key))
    throw new RangeError('Unknown '+name+' field: '+key);}
  function finite(v,name,lo,hi){if(typeof v!=='number'||!Number.isFinite(v)||v<lo||v>hi)
    throw new RangeError(name+' must be finite in ['+lo+', '+hi+']');return v;}
  function topology(input=DEFAULT_TOPOLOGY){
    // `order` is a derived field returned by this function. Always recompute it
    // from validated edges; never trust a caller-supplied traversal.
    fields(input,['nodes','edges','order'],'topology');const nodes=input.nodes,edges=input.edges;
    if(!Array.isArray(nodes)||!Array.isArray(edges)||nodes.length<4||nodes.length>12||edges.length!==nodes.length)
      throw new RangeError('A serial closed loop needs 4–12 nodes and exactly one edge per node');
    const seen=new Set(),count={};
    const normalized=nodes.map(n=>{
      fields(n,['id','type','params'],'node');if(typeof n.id!=='string'||!/^[A-Za-z][A-Za-z0-9_-]{1,23}$/.test(n.id)||seen.has(n.id))
        throw new RangeError('Node IDs must be unique ASCII identifiers (2–24 chars)');
      if(!Object.hasOwn(BOUNDS,n.type))throw new RangeError('Unsupported component type');
      seen.add(n.id);count[n.type]=(count[n.type]??0)+1;
      fields(n.params,Object.keys(BOUNDS[n.type]),n.type+' parameters');
      const params={};for(const [key,[lo,hi]]of Object.entries(BOUNDS[n.type])){
        if(n.params[key]===undefined)throw new RangeError('Missing '+n.type+'.'+key);
        params[key]=finite(n.params[key],n.type+'.'+key,lo,hi);}
      return {id:n.id,type:n.type,params};
    });
    for(const type of ['pump','gpu','hx','cooler'])if(count[type]!==1)
      throw new RangeError('Topology needs exactly one '+type);
    if((count.pipe??0)>6||(count.tank??0)>2)throw new RangeError('At most 6 pipes and 2 tanks');
    const next=new Map(),incoming=new Set();for(const e of edges){fields(e,['from','to'],'edge');
      if(!seen.has(e.from)||!seen.has(e.to)||e.from===e.to||next.has(e.from)||incoming.has(e.to))
        throw new RangeError('Edges must connect valid nodes with one incoming and outgoing connection');
      next.set(e.from,e.to);incoming.add(e.to);}
    if(next.size!==nodes.length||incoming.size!==nodes.length)throw new RangeError('Unconnected component');
    let id=normalized.find(n=>n.type==='pump').id;const order=[];
    for(let i=0;i<nodes.length;i++){if(order.includes(id))throw new RangeError('Disconnected sub-cycle');
      order.push(id);id=next.get(id);}
    if(id!==order[0])throw new RangeError('Topology must form exactly one closed serial circuit');
    // Preserve exact submitted edges and canonical order for replay and rendering.
    return {nodes:normalized,edges:edges.map(e=>({from:e.from,to:e.to})),order};
  }
  function controls(input={}){fields(input,Object.keys(CONTROL_BOUNDS),'controls');const result={...BASE_CONTROLS,...input};
    for(const [key,[lo,hi]]of Object.entries(CONTROL_BOUNDS))finite(result[key],key,lo,hi);return result;}
  function scenario(input={}){fields(input,['preset','seed','horizonMinutes','outsideC','solarKW','occupants'],'scenario');
    const preset=input.preset??'winter';if(!Object.hasOwn(SCENARIOS,preset))throw new RangeError('Unknown preset');
    const s={...SCENARIOS[preset],preset,seed:input.seed??42,horizonMinutes:input.horizonMinutes??60};
    for(const k of ['outsideC','solarKW','occupants'])if(input[k]!==undefined)s[k]=input[k];
    finite(s.seed,'seed',0,4294967295);finite(s.horizonMinutes,'horizonMinutes',1,120);
    if(!Number.isInteger(s.seed)||!Number.isInteger(s.horizonMinutes))throw new RangeError('Seed/horizon must be integers');
    finite(s.outsideC,'outsideC',-20,45);finite(s.solarKW,'solarKW',0,30);finite(s.occupants,'occupants',0,200);
    return s;}
  function waterCapacityKJK(t){let liters=0;for(const n of t.nodes){const p=n.params;
    if(n.type==='pipe')liters+=Math.PI*(p.diameterMm/2000)**2*p.lengthM*1000;
    else liters+=p.waterLiters;}
    return liters/1000*WATER.densityKgM3*WATER.cpKJKgK;}
  // Darcy-Weisbach pressure loss with an explicit turbulent approximation.
  function pressureDrop(t,qM3S){let total=0;const drops=[];
    for(const id of t.order){const n=t.nodes.find(v=>v.id===id),p=n.params;
      const D=n.type==='pipe'?p.diameterMm/1000:.05;
      const length=n.type==='pipe'?p.lengthM:0;
      const minor=n.type==='pipe'?p.minorLossK:p.lossK;
      const rough=n.type==='pipe'?p.roughnessMm/1000:0.00003;
      const area=Math.PI*D*D/4,v=qM3S/area,re=WATER.densityKgM3*v*D/WATER.viscosityPaS;
      const f=re<1e-12?0:re<2300?64/re:Math.pow(-1.8*Math.log10(Math.pow(rough/(3.7*D),1.11)+6.9/re),-2);
      const drop=(f*length/D+minor)*WATER.densityKgM3*v*v/2;
      total+=drop;drops.push({id,pressureDropPa:drop,reynolds:re,frictionFactor:f});}
    return {totalPa:total,components:drops};}
  function hydraulics(t,commandPct,health=1){const p=t.nodes.find(n=>n.type==='pump').params;
    const speed=commandPct/100*health,shutoff=p.shutoffHeadKPa*1000*speed*speed;
    if(speed<=0)return {flowLps:0,massFlowKgS:0,pumpHeadPa:0,pressureDropPa:0,
      pressureResidualPa:0,pumpElectricKW:0,components:pressureDrop(t,0).components};
    const qMax=p.maxFlowLps/1000*speed;
    const head=q=>Math.max(0,shutoff*(1-(q/qMax)**2));
    let lo=0,hi=qMax;for(let i=0;i<60;i++){const mid=(lo+hi)/2;
      if(pressureDrop(t,mid).totalPa>head(mid))hi=mid;else lo=mid;}
    const q=(lo+hi)/2,loss=pressureDrop(t,q),actualHead=head(q);
    const pumpKW=actualHead*q/(1000*p.efficiency);
    return {flowLps:q*1000,massFlowKgS:q*WATER.densityKgM3,pumpHeadPa:actualHead,
      pressureDropPa:loss.totalPa,pressureResidualPa:actualHead-loss.totalPa,
      pumpElectricKW:pumpKW,components:loss.components};}
  // Counter-flow epsilon-NTU model, C_hot/C_cold and UA in kW/K.
  function epsilonNTU(ua,C_hot,C_cold){if(ua<=0||C_hot<=0||C_cold<=0)return 0;
    const cMin=Math.min(C_hot,C_cold),cr=cMin/Math.max(C_hot,C_cold),ntu=ua/cMin;
    return Math.max(0,Math.min(1,Math.abs(1-cr)<1e-8?ntu/(1+ntu):
      (1-Math.exp(-ntu*(1-cr)))/(1-cr*Math.exp(-ntu*(1-cr)))));}
  function initialState(s){return {gpuC:55,coolantC:32,buildingC:21};}
  function forcingNoise(seed,minute){let z=(seed^Math.imul(minute+1,0x9e3779b1))>>>0;
    z^=z<<13;z^=z>>>17;z^=z<<5;return (z>>>0)/4294967296-.5;}
  function createWorld(input={}){fields(input,['topology','scenario','controls'],'world request');
    const t=topology(input.topology??DEFAULT_TOPOLOGY),s=scenario(input.scenario??{}),c=controls(input.controls??{});
    const state=initialState(s);return {version:VERSION,minute:0,topology:t,scenario:s,controls:c,
      state,metrics:{siteElectricKWh:0,pumpElectricKWh:0,recoveredHeatKWh:0,rejectedHeatKWh:0,
      gpuElectricKWh:0,computeServiceHours:0,throttledMinutes:0},trace:[{minute:0,...state}],actions:[],
      energyResidualKJ:0,maxPressureResidualPa:0,violations:[],last:null};}
  function checkWorld(w){obj(w,'world');if(w.version!==VERSION||!Number.isInteger(w.minute)||
      w.minute<0||w.minute>w.scenario.horizonMinutes)throw new RangeError('Invalid world checkpoint');}
  function advance(w,{minutes=1,controls:patch={},expectedMinute=w.minute,stepSeconds=5}={}){
    checkWorld(w);if(expectedMinute!==w.minute){const e=new RangeError('Stale world minute');e.status=409;throw e;}
    finite(minutes,'minutes',1,Math.min(15,w.scenario.horizonMinutes-w.minute));
    if(!Number.isInteger(minutes))throw new RangeError('Step minutes must be integer');
    finite(stepSeconds,'stepSeconds',1,10);
    if(!Number.isInteger(stepSeconds)||60%stepSeconds!==0)throw new RangeError('stepSeconds must be a divisor of 60');
    const c=controls({...w.controls,...patch}),s=w.scenario,t=w.topology;
    const cap={gpu:t.nodes.find(n=>n.type==='gpu').params.thermalCapacityKJK,
      coolant:waterCapacityKJK(t),building:25000};
    const x={...w.state},metrics={...w.metrics},trace=w.trace.slice(),actions=w.actions.slice();
    const violations=w.violations.slice(),dt=stepSeconds,
      initialStored=cap.gpu*x.gpuC+cap.coolant*x.coolantC+cap.building*x.buildingC;
    let integratedNet=0,maxResidual=w.energyResidualKJ,maxPressure=w.maxPressureResidualPa,last=w.last;
    for(let tick=0;tick<minutes*60;tick+=dt){const time=w.minute*60+tick,minute=time/60;
      const fault=s.preset==='pump-fault'&&minute>=30?.3:1;
      const h=hydraulics(t,c.pumpPct,fault),C=h.massFlowKgS*WATER.cpKJKgK;
      // Synthetic seed-keyed disturbance is piecewise constant per minute;
      // the same clock minute has identical forcing regardless of step calls.
      const perturb=forcingNoise(s.seed,Math.floor(minute));
      const forcingOutside=s.outsideC+1.5*Math.sin(minute/120*Math.PI)+.4*perturb;
      const burst=s.preset==='burst'&&minute>=20&&minute<50?1.18:1;
      // Illustrative protective derating/trip, so a stopped pump does not
      // create an arbitrarily unbounded fictitious GPU heat source.
      const throttle=Math.max(0,Math.min(1,(95-x.gpuC)/10));
      const demandFactor=1+.04*perturb;
      const gpuKW=(4+30*c.gpuLoadPct/100*demandFactor)*burst*throttle;
      const requestedKW=Math.max(0,12*(c.heatingSetpointC-x.buildingC));
      const serverKW=2;
      // One stream follows the actual graph order. Changes to the connection
      // order now affect HX inlet temperature, rejection and downstream pipe
      // conditions, while the total circuit retains a mixed thermal capacity.
      let streamC=x.coolantC,gpuToWaterKW=0,recoveredKW=0,rejectedKW=0,pipeLossKW=0;
      const componentTransfers=[];
      for(const id of t.order){const node=t.nodes.find(n=>n.id===id),p=node.params,inletC=streamC;
        let heatToWaterKW=0;
        if(node.type==='pump')heatToWaterKW=h.pumpElectricKW;
        else if(node.type==='gpu'){
          const thermUA=p.thermalUAkWK*(1-Math.exp(-C/1.8));
          gpuToWaterKW=Math.max(0,Math.min(thermUA*(x.gpuC-streamC),C*Math.max(0,x.gpuC-streamC)));
          heatToWaterKW=gpuToWaterKW+serverKW;
        }else if(node.type==='hx'){
          const airC=p.airMassFlowKgs*AIR_CP;
          const q=epsilonNTU(p.uaKWK,C,airC)*Math.min(C,airC)*Math.max(0,streamC-x.buildingC);
          recoveredKW=Math.min(requestedKW,q*c.recoveryPct/100);
          heatToWaterKW=-recoveredKW;
        }else if(node.type==='cooler'){
          const airC=p.airMassFlowKgs*AIR_CP*c.fanPct/100;
          rejectedKW=epsilonNTU(p.uaKWK,C,airC)*Math.min(C,airC)*Math.max(0,streamC-forcingOutside);
          heatToWaterKW=-rejectedKW;
        }else if(node.type==='pipe'||node.type==='tank'){
          const q=p.uaWK/1000*(streamC-forcingOutside);
          // Limit axial exchange to the flowing stream's available sensible
          // heat; a stagnant volume still exchanges through its wall.
          const exchanged=C>0?Math.sign(q)*Math.min(Math.abs(q),C*Math.abs(streamC-forcingOutside)):q;
          pipeLossKW+=exchanged;heatToWaterKW=-exchanged;
        }
        if(C>0)streamC+=heatToWaterKW/C;
        componentTransfers.push({id,type:node.type,inletC,outletC:streamC,heatToCoolantKW:heatToWaterKW});
      }
      const backupKW=Math.min(50,Math.max(0,requestedKW-recoveredKW));
      const fanKW=1.2*(c.fanPct/100)**3,lightingKW=1.2,peopleKW=.1*s.occupants;
      const envelopeKW=1.2*(x.buildingC-forcingOutside),ventilationKW=.22*(x.buildingC-forcingOutside);
      const coolingKW=Math.min(60,12*Math.max(0,x.buildingC-25));
      const dGpu=gpuKW-gpuToWaterKW;
      const dCoolant=gpuToWaterKW+serverKW+h.pumpElectricKW-recoveredKW-rejectedKW-pipeLossKW;
      const dRoom=recoveredKW+backupKW+peopleKW+lightingKW+s.solarKW-envelopeKW-ventilationKW-coolingKW;
      x.gpuC+=dt*dGpu/cap.gpu;x.coolantC+=dt*dCoolant/cap.coolant;x.buildingC+=dt*dRoom/cap.building;
      if(Object.values(x).some(v=>!Number.isFinite(v)||v< -100||v>200))throw new RangeError('Simulation escaped numerical envelope');
      const siteKW=gpuKW+serverKW+h.pumpElectricKW+fanKW+lightingKW+backupKW+coolingKW/3;
      metrics.siteElectricKWh+=siteKW*dt/3600;metrics.pumpElectricKWh+=h.pumpElectricKW*dt/3600;
      metrics.gpuElectricKWh+=gpuKW*dt/3600;metrics.recoveredHeatKWh+=recoveredKW*dt/3600;
      metrics.rejectedHeatKWh+=rejectedKW*dt/3600;metrics.computeServiceHours+=c.gpuLoadPct/100*demandFactor*throttle*dt/3600;
      if(throttle<1)metrics.throttledMinutes+=dt/60;
      integratedNet+=dt*(gpuKW+serverKW+h.pumpElectricKW+backupKW+peopleKW+lightingKW+s.solarKW-
        rejectedKW-pipeLossKW-envelopeKW-ventilationKW-coolingKW);
      const stored=cap.gpu*x.gpuC+cap.coolant*x.coolantC+cap.building*x.buildingC-initialStored;
      maxResidual=Math.max(maxResidual,Math.abs(stored-integratedNet));
      maxPressure=Math.max(maxPressure,Math.abs(h.pressureResidualPa));
      for(const [code,active,value,limit] of [
        ['gpu_hot',x.gpuC>LIMITS.gpuMaxC,x.gpuC,LIMITS.gpuMaxC],
        ['coolant_hot',x.coolantC>LIMITS.coolantMaxC,x.coolantC,LIMITS.coolantMaxC],
        ['room_cold',x.buildingC<LIMITS.occupiedMinC,x.buildingC,LIMITS.occupiedMinC],
        ['room_hot',x.buildingC>LIMITS.occupiedMaxC,x.buildingC,LIMITS.occupiedMaxC],
        ['site_overpower',siteKW>LIMITS.siteMaxKW,siteKW,LIMITS.siteMaxKW]])
        if(active&&!violations.some(v=>v.code===code))violations.push({code,atMinute:minute,value,limit});
      last={...h,siteKW,gpuKW,gpuToWaterKW,recoveredKW,rejectedKW,pipeLossKW,roomHeatingKW:backupKW,throttle,
        componentTransfers,
        outsideC:forcingOutside,waterCapacityKJK:cap.coolant};
      if((tick+dt)%60===0)trace.push({minute:w.minute+(tick+dt)/60,...x,
        flowLps:h.flowLps,pumpHeadKPa:h.pumpHeadPa/1000,siteKW});
    }
    actions.push({minute:w.minute,minutes,controls:c});
    return {...w,minute:w.minute+minutes,controls:c,state:x,metrics,trace,actions,
      energyResidualKJ:maxResidual,maxPressureResidualPa:maxPressure,violations,last};
  }
  function editTopology(w,newTopology){checkWorld(w);if(w.minute!==0)throw new RangeError('Reset before editing the physical circuit');
    return createWorld({topology:newTopology,scenario:w.scenario,controls:w.controls});}
  function report(w){checkWorld(w);return {schemaVersion:1,engineVersion:VERSION,mode:'simulation-only',
    hardwareAuthorized:false,minute:w.minute,remainingMinutes:w.scenario.horizonMinutes-w.minute,
    topology:w.topology,scenario:w.scenario,controls:w.controls,state:w.state,metrics:w.metrics,
    trace:w.trace,actions:w.actions,hydraulics:w.last,energyResidualKJ:w.energyResidualKJ,
    maxPressureResidualPa:w.maxPressureResidualPa,violations:w.violations,
    validity:'Uncalibrated single-circuit lumped model; physical equations are checked but field accuracy is not established.',
    limitations:['Fixed 25°C water properties; laminar/turbulent friction approximation.',
      'One incompressible steady hydraulic series circuit; no branching, cavitation, pump transients or stratification.',
      'One mixed coolant temperature, one aggregate GPU temperature and one occupied room.',
      'Air side, envelope and equipment curves are illustrative; not calibrated or independently validated.']};}
  function simulate(input={}){fields(input,['topology','scenario','controls'],'simulate request');
    let w=createWorld(input);while(w.minute<w.scenario.horizonMinutes)w=advance(w,{minutes:Math.min(15,w.scenario.horizonMinutes-w.minute)});
    return report(w);}
  function spliceAfter(input,newNode,after){const t=topology(input),n={...newNode};
    if(t.nodes.some(x=>x.id===n.id))throw new RangeError('Duplicate component id');
    const outgoing=t.edges.find(e=>e.from===after);if(!outgoing)throw new RangeError('Unknown insertion point');
    const edges=t.edges.filter(e=>e!==outgoing).concat([{from:after,to:n.id},{from:n.id,to:outgoing.to}]);
    return topology({nodes:t.nodes.concat([n]),edges});}
  function removeNode(input,id){const t=topology(input),n=t.nodes.find(x=>x.id===id);
    if(!n||!['pipe','tank'].includes(n.type))throw new RangeError('Only optional pipe/tank nodes can be removed');
    const incoming=t.edges.find(e=>e.to===id),outgoing=t.edges.find(e=>e.from===id);
    return topology({nodes:t.nodes.filter(x=>x.id!==id),edges:t.edges.filter(e=>e.from!==id&&e.to!==id)
      .concat([{from:incoming.from,to:outgoing.to}])});}
  function moveAfter(input,id,after){const t=topology(input);if(id===after)throw new RangeError('Move target differs from component');
    const n=t.nodes.find(x=>x.id===id);if(!n)throw new RangeError('Unknown component');
    const incoming=t.edges.find(e=>e.to===id),outgoing=t.edges.find(e=>e.from===id);
    let edges=t.edges.filter(e=>e.to!==id&&e.from!==id).concat([{from:incoming.from,to:outgoing.to}]);
    const successor=edges.find(e=>e.from===after);if(!successor)throw new RangeError('Unknown insertion point');
    edges=edges.filter(e=>e!==successor).concat([{from:after,to:id},{from:id,to:successor.to}]);
    return topology({nodes:t.nodes,edges});}
  return {VERSION,WATER,LIMITS,BOUNDS,DEFAULT_TOPOLOGY,BASE_CONTROLS,CONTROL_BOUNDS,SCENARIOS,
    topology,controls,scenario,waterCapacityKJK,pressureDrop,hydraulics,epsilonNTU,
    createWorld,advance,editTopology,report,simulate,spliceAfter,removeNode,moveAfter};
});
