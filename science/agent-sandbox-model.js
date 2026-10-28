/* Uncalibrated, deterministic RC plant for pre-deployment controller experiments.
 * Shared by the offline web workspace and optional Node HTTP API. No device I/O. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ThermaAgentSandbox = api;
})(globalThis, function () {
  'use strict';
  const VERSION = '1.0.0';
  const clone = x => JSON.parse(JSON.stringify(x));
  const CONTROL_BOUNDS = {
    gpuPowerLimitPct:[40,100], pumpPct:[20,100], fanPct:[0,100],
    heatRecoveryPct:[0,100], heatingSetpointC:[16,25], ventilationACH:[0.2,3], lightingPct:[0,100]
  };
  const BASELINE = {gpuPowerLimitPct:100,pumpPct:75,fanPct:70,heatRecoveryPct:70,
    heatingSetpointC:21,ventilationACH:0.6,lightingPct:80};
  const PRESETS = {
    winter:{outsideC:2,loadFraction:0.65,occupants:40,solarKW:2,fault:'none'},
    burst:{outsideC:8,loadFraction:0.95,occupants:40,solarKW:2,fault:'none'},
    summer:{outsideC:32,loadFraction:0.8,occupants:40,solarKW:8,fault:'none'},
    'pump-fault':{outsideC:5,loadFraction:0.8,occupants:40,solarKW:2,fault:'pump-degradation'}
  };
  const PARAMETERS = {gpuCapacityKJK:120,coolantCapacityKJK:800,buildingCapacityKJK:25000,
    envelopeUAKWK:1.2,buildingVolumeM3:1200,gpuConductanceKWK:1.8,coolerConductanceKWK:3,
    recoveryConductanceKWK:2,heatExchangerApproachK:5,backupCapacityKW:50,
    coolingCapacityKW:60,coolingCOP:3,serverKW:2};
  const LIMITS = {gpuMaxC:85,coolantMaxC:50,occupiedMinC:18,occupiedMaxC:26,
    occupiedMinVentilationACH:0.5,siteMaxKW:100};
  const NOTICE = 'Uncalibrated reduced-order simulation. Passing these checks is not authorization or evidence of safety for real building control.';
  function object(x,name) {
    if (!x || typeof x!=='object' || Array.isArray(x)) throw new TypeError(name+' must be an object');
  }
  function keys(x,allowed,name) {
    object(x,name);
    for (const k of Object.keys(x)) if (!allowed.includes(k)) throw new RangeError('Unknown '+name+' field: '+k);
  }
  function number(x,name,lo,hi) {
    if (typeof x!=='number' || !Number.isFinite(x) || x<lo || x>hi) throw new RangeError(name+' must be a finite number in ['+lo+', '+hi+']');
    return x;
  }
  function controls(input,name='controls') {
    keys(input,Object.keys(CONTROL_BOUNDS),name);
    for (const [k,v] of Object.entries(input)) number(v,k,...CONTROL_BOUNDS[k]);
    return {...input};
  }
  function normalize(input={}) {
    keys(input,['schemaVersion','scenario','plan'],'request');
    if (input.schemaVersion!==undefined && input.schemaVersion!==1) throw new RangeError('Unsupported schemaVersion');
    const s=input.scenario??{};
    keys(s,['preset','seed','horizonMinutes','outsideC','loadFraction','occupants','solarKW','initialState'],'scenario');
    const preset=s.preset??'winter';
    if (!Object.hasOwn(PRESETS,preset)) throw new RangeError('Unknown scenario preset');
    const scenario={...PRESETS[preset],preset,seed:s.seed??42,horizonMinutes:s.horizonMinutes??120};
    for (const k of ['outsideC','loadFraction','occupants','solarKW']) if (s[k]!==undefined) scenario[k]=s[k];
    number(scenario.seed,'seed',0,4294967295);
    number(scenario.horizonMinutes,'horizonMinutes',1,360);
    if (!Number.isInteger(scenario.seed)||!Number.isInteger(scenario.horizonMinutes)) throw new RangeError('seed and horizonMinutes must be integers');
    number(scenario.outsideC,'outsideC',-20,40);number(scenario.loadFraction,'loadFraction',0,1);
    number(scenario.occupants,'occupants',0,200);number(scenario.solarKW,'solarKW',0,30);
    const state=s.initialState??{};
    keys(state,['gpuC','coolantC','buildingC'],'initialState');
    scenario.initialState={gpuC:55,coolantC:32,buildingC:21,...state};
    for (const [k,v] of Object.entries(scenario.initialState)) number(v,k,...(k==='gpuC'?[0,120]:k==='coolantC'?[5,70]:[5,40]));
    const plan=input.plan??[{atMinute:0,controls:{pumpPct:60,fanPct:55,heatRecoveryPct:90,heatingSetpointC:20.5}}];
    if (!Array.isArray(plan)||plan.length>50) throw new RangeError('plan must be an array of at most 50 actions');
    let previous=-1;
    const normalized=plan.map(a=>{
      keys(a,['atMinute','controls'],'action');number(a.atMinute,'atMinute',0,scenario.horizonMinutes-1);
      if (!Number.isInteger(a.atMinute)||a.atMinute<=previous) throw new RangeError('Action minutes must be unique, increasing integers');
      previous=a.atMinute;return {atMinute:a.atMinute,controls:controls(a.controls)};
    });
    return {schemaVersion:1,scenario,plan:normalized};
  }
  function random(seed) {
    let a=seed>>>0;
    return ()=>{a+=0x6D2B79F5;let t=Math.imul(a^a>>>15,a|1);t^=t+Math.imul(t^t>>>7,t|61);return ((t^t>>>14)>>>0)/4294967296;};
  }
  function profile(s) {
    const rng=random(s.seed);
    return Array.from({length:s.horizonMinutes},(_,minute)=>({
      load:Math.max(0,Math.min(1,s.loadFraction+(rng()-.5)*.08+(s.preset==='burst'&&minute>=20&&minute<50?.25:0))),
      outsideC:s.outsideC+Math.sin(minute/120*Math.PI)*1.5
    }));
  }
  function simulate(request,plan,parameterScale=1,stepSeconds=5) {
    const s=request.scenario,p={...PARAMETERS,envelopeUAKWK:PARAMETERS.envelopeUAKWK*parameterScale,
      gpuConductanceKWK:PARAMETERS.gpuConductanceKWK/parameterScale};
    const weather=profile(s),x={...s.initialState},c={...BASELINE};
    const initialEnergy=x.gpuC*p.gpuCapacityKJK+x.coolantC*p.coolantCapacityKJK+x.buildingC*p.buildingCapacityKJK;
    const trace=[],events=[],violations=new Map();let actionIndex=0,integratedNetKJ=0,maxResidualKJ=0;
    const metrics={siteElectricKWh:0,gpuElectricKWh:0,backupElectricKWh:0,usefulHeatKWh:0,
      rejectedHeatKWh:0,comfortDegreeHours:0,computeServiceProxyHours:0,throttledMinutes:0,
      peakGPUC:x.gpuC,peakCoolantC:x.coolantC,peakSiteKW:0};
    function check(code,violated,t,value,limit,dt) {
      if (!violated) return;
      if (!violations.has(code)) violations.set(code,{code,firstMinute:t/60,durationMinutes:0,firstValue:value,limit});
      violations.get(code).durationMinutes+=dt/60;
    }
    function checkTemperatures(t,dt) {
      check('gpu_over_temperature',x.gpuC>LIMITS.gpuMaxC,t,x.gpuC,LIMITS.gpuMaxC,dt);
      check('coolant_over_temperature',x.coolantC>LIMITS.coolantMaxC,t,x.coolantC,LIMITS.coolantMaxC,dt);
      if (s.occupants>0) {
        check('building_too_cold',x.buildingC<LIMITS.occupiedMinC,t,x.buildingC,LIMITS.occupiedMinC,dt);
        check('building_too_hot',x.buildingC>LIMITS.occupiedMaxC,t,x.buildingC,LIMITS.occupiedMaxC,dt);
      }
    }
    checkTemperatures(0,0);trace.push({minute:0,...x,siteKW:null,recoveredKW:null});
    for (let t=0;t<s.horizonMinutes*60;t+=stepSeconds) {
      while (actionIndex<plan.length && t>=plan[actionIndex].atMinute*60) {
        const a=plan[actionIndex++];Object.assign(c,a.controls);events.push({minute:t/60,type:'simulated_action',controls:{...a.controls}});
      }
      const boundary=weather[Math.floor(t/60)];
      const pumpHealth=s.fault==='pump-degradation'&&t>=30*60?.3:1;
      if (s.fault==='pump-degradation'&&t===30*60) events.push({minute:30,type:'fault',detail:'Pump effective flow reduced to 30% of command'});
      const flow=c.pumpPct/100*pumpHealth;
      const throttle=x.gpuC>80?Math.max(.25,1-(x.gpuC-80)/30):1;
      const served=boundary.load*c.gpuPowerLimitPct/100*throttle;
      const gpuKW=4+30*served;
      const pumpKW=.4*(c.pumpPct/100)**3,fanKW=1.2*(c.fanPct/100)**3;
      const lightingKW=1.5*c.lightingPct/100,peopleKW=.1*s.occupants;
      const gpuToLoopKW=p.gpuConductanceKWK*(.1+flow)*(x.gpuC-x.coolantC);
      const heatingDemandKW=Math.max(0,12*(c.heatingSetpointC-x.buildingC));
      const availableHeatKW=p.recoveryConductanceKWK*flow*c.heatRecoveryPct/100*
        Math.max(0,x.coolantC-x.buildingC-p.heatExchangerApproachK);
      const recoveredKW=Math.min(heatingDemandKW,availableHeatKW);
      const backupKW=Math.min(p.backupCapacityKW,heatingDemandKW-recoveredKW);
      const coolingKW=Math.min(p.coolingCapacityKW,12*Math.max(0,x.buildingC-25));
      const rejectedKW=p.coolerConductanceKWK*c.fanPct/100*flow*Math.max(0,x.coolantC-boundary.outsideC);
      const ventilationKW=1.2*1.005*p.buildingVolumeM3*c.ventilationACH/3600*(x.buildingC-boundary.outsideC);
      const envelopeKW=p.envelopeUAKWK*(x.buildingC-boundary.outsideC);
      const dGPU=gpuKW-gpuToLoopKW;
      const dLoop=gpuToLoopKW+p.serverKW+pumpKW-recoveredKW-rejectedKW;
      const dBuilding=recoveredKW+backupKW+lightingKW+peopleKW+s.solarKW-envelopeKW-ventilationKW-coolingKW;
      x.gpuC+=stepSeconds*dGPU/p.gpuCapacityKJK;
      x.coolantC+=stepSeconds*dLoop/p.coolantCapacityKJK;
      x.buildingC+=stepSeconds*dBuilding/p.buildingCapacityKJK;
      if (Object.values(x).some(v=>!Number.isFinite(v)||Math.abs(v)>500)) throw new RangeError('Simulation left numerical validity bounds');
      const siteKW=gpuKW+p.serverKW+pumpKW+fanKW+lightingKW+backupKW+coolingKW/p.coolingCOP;
      const h=stepSeconds/3600;
      metrics.siteElectricKWh+=siteKW*h;metrics.gpuElectricKWh+=gpuKW*h;metrics.backupElectricKWh+=backupKW*h;
      metrics.usefulHeatKWh+=recoveredKW*h;metrics.rejectedHeatKWh+=rejectedKW*h;
      metrics.computeServiceProxyHours+=served*h;
      metrics.throttledMinutes+=(throttle<1?stepSeconds/60:0);
      metrics.comfortDegreeHours+=(s.occupants>0?Math.max(0,LIMITS.occupiedMinC-x.buildingC,x.buildingC-LIMITS.occupiedMaxC):0)*h;
      metrics.peakGPUC=Math.max(metrics.peakGPUC,x.gpuC);metrics.peakCoolantC=Math.max(metrics.peakCoolantC,x.coolantC);
      metrics.peakSiteKW=Math.max(metrics.peakSiteKW,siteKW);
      // Fan heat and AC electrical work dissipate outside this three-node thermal boundary.
      integratedNetKJ+=stepSeconds*(gpuKW+p.serverKW+pumpKW+backupKW+lightingKW+peopleKW+s.solarKW-envelopeKW-ventilationKW-coolingKW-rejectedKW);
      const stored=x.gpuC*p.gpuCapacityKJK+x.coolantC*p.coolantCapacityKJK+x.buildingC*p.buildingCapacityKJK-initialEnergy;
      maxResidualKJ=Math.max(maxResidualKJ,Math.abs(stored-integratedNetKJ));
      checkTemperatures(t+stepSeconds,stepSeconds);
      check('site_power_limit',siteKW>LIMITS.siteMaxKW,t+stepSeconds,siteKW,LIMITS.siteMaxKW,stepSeconds);
      check('occupied_ventilation',s.occupants>0&&c.ventilationACH<LIMITS.occupiedMinVentilationACH,t,c.ventilationACH,LIMITS.occupiedMinVentilationACH,stepSeconds);
      if ((t+stepSeconds)%60===0) trace.push({minute:(t+stepSeconds)/60,...x,siteKW,recoveredKW,loadFraction:boundary.load,
        outsideC:boundary.outsideC,pumpHealth,computeServiceProxy:served});
    }
    return {metrics,finalState:x,trace,events,violations:[...violations.values()],maxEnergyResidualKJ:maxResidualKJ,
      parameterScale,parameters:p,stepSeconds};
  }
  function evaluate(input={}) {
    const request=normalize(input);
    const baseline=simulate(request,[]),candidate=simulate(request,request.plan);
    const stress=[.8,1.2].map(scale=>{
      const b=simulate(request,[],scale),c=simulate(request,request.plan,scale);
      return {parameterScale:scale,baselineMetrics:b.metrics,candidateMetrics:c.metrics,
        violations:c.violations,energySavedKWh:b.metrics.siteElectricKWh-c.metrics.siteElectricKWh,
        computeServiceRatio:b.metrics.computeServiceProxyHours>0?c.metrics.computeServiceProxyHours/b.metrics.computeServiceProxyHours:1};
    });
    const ratio=baseline.metrics.computeServiceProxyHours>0?candidate.metrics.computeServiceProxyHours/baseline.metrics.computeServiceProxyHours:1;
    const constraintsPassed=candidate.violations.length===0 && stress.every(x=>x.violations.length===0);
    const serviceMaintained=ratio>=.99 && stress.every(x=>x.computeServiceRatio>=.99);
    const conservationPassed=candidate.maxEnergyResidualKJ<1e-5&&baseline.maxEnergyResidualKJ<1e-5;
    return {schemaVersion:1,engineVersion:VERSION,mode:'simulation-only',notice:NOTICE,request,
      baseline,candidate,stressTests:stress,limits:clone(LIMITS),
      comparison:{energySavedKWh:baseline.metrics.siteElectricKWh-candidate.metrics.siteElectricKWh,
        usefulHeatDeltaKWh:candidate.metrics.usefulHeatKWh-baseline.metrics.usefulHeatKWh,computeServiceRatio:ratio},
      verdict:{status:constraintsPassed&&serviceMaintained&&conservationPassed?'within_tested_envelope':'needs_revision',
        constraintsPassed,serviceMaintained,conservationPassed,hardwareAuthorized:false,
        reasons:[...(!constraintsPassed?['One or more temperature, ventilation or power limits failed in nominal or stress runs.']:[]),
          ...(!serviceMaintained?['Compute-service proxy fell more than 1% below the paired baseline.']:[]),
          ...(!conservationPassed?['Thermal energy accounting failed.']:[]),
          'This result covers only the specified horizon and tested model parameters; real hardware remains disconnected.']},
      limitations:['All building/GPU plant parameters are synthetic and uncalibrated.',
        'Three lumped thermal states; no CFD, humidity, air quality, multi-zone flow or electrical network dynamics.',
        'Compute service is a utilization-hours proxy, not tokens, job completion, quality or SLA validation.',
        'Sensitivity cases vary envelope UA and GPU thermal conductance by prescribed factors; not confidence intervals or a separate validated plant.',
        'Direct heat exchanger plus resistive backup and fixed-COP room cooling; no heat-pump or storage model.',
        'This sandbox is separate from the legacy 3D campus and retained thermal-reference studies.']};
  }
  function schema() {
    return {schemaVersion:1,engineVersion:VERSION,mode:'simulation-only',notice:NOTICE,
      endpoints:{evaluate:'POST /api/v1/simulations/evaluate',schema:'GET /api/v1/schema',health:'GET /api/v1/health'},
      scenario:{presets:Object.keys(PRESETS),seed:'integer 0..4294967295',horizonMinutes:'integer 1..360',
        outsideC:[-20,40],loadFraction:[0,1],occupants:[0,200],solarKW:[0,30],
        initialState:{gpuC:[0,120],coolantC:[5,70],buildingC:[5,40]}},
      controls:clone(CONTROL_BOUNDS),baseline:clone(BASELINE),parameters:clone(PARAMETERS),limits:clone(LIMITS),
      plan:'At most 50 patches; unique increasing integer atMinute values within horizon. Omitted controls retain their previous values.',
      example:{schemaVersion:1,scenario:{preset:'winter',seed:42,horizonMinutes:120},
        plan:[{atMinute:0,controls:{pumpPct:60,fanPct:55,heatRecoveryPct:90,heatingSetpointC:20.5}}]}};
  }
  function openapi() {
    const numeric=(lo,hi,type='number')=>({type,minimum:lo,maximum:hi});
    const actionControls={type:'object',additionalProperties:false,properties:Object.fromEntries(
      Object.entries(CONTROL_BOUNDS).map(([k,v])=>[k,numeric(...v)]))};
    const request={type:'object',additionalProperties:false,properties:{schemaVersion:{type:'integer',const:1},
      scenario:{type:'object',additionalProperties:false,properties:{preset:{type:'string',enum:Object.keys(PRESETS)},
        seed:numeric(0,4294967295,'integer'),horizonMinutes:numeric(1,360,'integer'),outsideC:numeric(-20,40),
        loadFraction:numeric(0,1),occupants:numeric(0,200),solarKW:numeric(0,30),
        initialState:{type:'object',additionalProperties:false,properties:{gpuC:numeric(0,120),coolantC:numeric(5,70),buildingC:numeric(5,40)}}}},
      plan:{type:'array',maxItems:50,description:'Increasing unique minute offsets, each less than horizonMinutes. Empty array preserves baseline. Omitted plan uses the example candidate.',
        items:{type:'object',additionalProperties:false,required:['atMinute','controls'],properties:{atMinute:numeric(0,359,'integer'),controls:actionControls}}}}};
    const reportSchema={type:'object',required:['schemaVersion','engineVersion','mode','request','baseline','candidate','stressTests','verdict','limitations'],
      properties:{mode:{const:'simulation-only'},verdict:{type:'object',required:['status','hardwareAuthorized'],
        properties:{status:{enum:['within_tested_envelope','needs_revision']},hardwareAuthorized:{const:false}}}}};
    return {openapi:'3.1.0',info:{title:'ThermaLoop Agent Simulation API',version:VERSION,description:NOTICE},
      servers:[{url:'http://127.0.0.1:8787',description:'Optional local server; not the static website'}],
      paths:{'/api/v1/simulations/evaluate':{post:{operationId:'evaluateBuildingControlPlan',summary:'Simulate a proposed control plan against paired baselines',
        description:'No hardware action occurs. Body must be at most 64 KiB. Same engine as the browser workspace.',
        requestBody:{required:true,content:{'application/json':{schema:request,example:schema().example}}},
        responses:{'200':{description:'Simulation report, not a deployment approval',content:{'application/json':{schema:reportSchema}}},
          '400':{description:'Invalid JSON, scenario or action'},'401':{description:'API token missing or incorrect when configured'},
          '403':{description:'Cross-origin request refused'},'413':{description:'Request exceeds 64 KiB'},
          '415':{description:'JSON content type required'},'503':{description:'Simulation capacity reached'},'504':{description:'Simulation time budget exceeded'}}}}},
      components:{securitySchemes:{bearerAuth:{type:'http',scheme:'bearer',description:'Required when server token is configured; mandatory for non-loopback binding.'}}},
      security:[{}, {bearerAuth:[]}]};
  }
  return {VERSION,normalize,evaluate,schema,openapi,
    // Explicit numerical verification hook; same model, not independent field validation.
    verifyStep:(input,stepSeconds)=>{if (![1,2,5].includes(stepSeconds)) throw new RangeError('Verification step must be 1, 2 or 5 seconds');const r=normalize(input);return simulate(r,r.plan,1,stepSeconds);}};
});
