/* Shared, deterministic public-workload evaluation. No access to hardware. */
(function(root,factory){const api=factory();if(typeof module==='object'&&module.exports)module.exports=api;else root.ThermaWorkloads=api;})(globalThis,function(){
  'use strict';
  const VERSION='1.0.0';
  function finite(x,name,min=0){if(!Number.isFinite(x)||x<min)throw new RangeError(name+' is outside its finite domain');return x;}
  function rng(seed){let a=seed>>>0;return()=>{a+=0x6D2B79F5;let t=Math.imul(a^a>>>15,a|1);t^=t+Math.imul(t^t>>>7,t|61);return((t^t>>>14)>>>0)/4294967296;};}
  const mean=xs=>xs.reduce((a,b)=>a+b,0)/xs.length;
  function quantile(xs,p){if(!xs.length)return null;const a=[...xs].sort((x,y)=>x-y),v=(a.length-1)*p,i=Math.floor(v);return a[i]+(a[Math.min(i+1,a.length-1)]-a[i])*(v-i);}
  function pairedInterval(differences,config){
    if(!differences.length)throw new RangeError('No paired test observations');
    const random=rng(config.bootstrapSeed),values=[];
    for(let b=0;b<config.bootstrapReplicates;b++){let sum=0;for(let i=0;i<differences.length;i++)sum+=differences[Math.floor(random()*differences.length)];values.push(sum/differences.length);}
    return {meanPP:mean(differences),lowPP:quantile(values,.025),highPP:quantile(values,.975),replicates:config.bootstrapReplicates,
      scope:'95% paired percentile bootstrap over held-out questions, conditional on this fitted router, split and fixed random control; excludes training/seed uncertainty and dataset shift'};
  }
  function matchedRandom(count,quota,seed){
    if(!Number.isInteger(count)||!Number.isInteger(quota)||count<1||quota<0||quota>count)throw new RangeError('Invalid matched routing quota');
    const random=rng(seed),indices=Array.from({length:count},(_,i)=>i);
    for(let i=indices.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[indices[i],indices[j]]=[indices[j],indices[i]];}
    const weak=new Set(indices.slice(0,quota));return indices.map((_,i)=>weak.has(i));
  }
  function routing(data,share){
    const threshold=data.routing.thresholds.find(t=>t.targetWeakShare===share);
    if(!threshold)throw new RangeError('Choose a predeclared calibration budget');
    const rows=data.routing.testRecords;if(!rows.length)throw new RangeError('Empty held-out evaluation');
    for(const r of rows){finite(r.score,'router score',-Number.MAX_VALUE);if(typeof r.strong!=='boolean'||typeof r.weak!=='boolean')throw new RangeError('Invalid cached correctness');}
    // Routing decisions depend only on frozen scores and calibration threshold.
    const decisions=rows.map(r=>r.score<=threshold.threshold),weakCalls=decisions.filter(Boolean).length;
    const randomDecision=matchedRandom(rows.length,weakCalls,data.protocol.randomSeeds[0]);
    const evaluate=choose=>rows.map((r,i)=>Number(choose[i]?r.weak:r.strong));
    const strong=rows.map(r=>+r.strong),weak=rows.map(r=>+r.weak),learned=evaluate(decisions),control=evaluate(randomDecision);
    // Exact expectation under a uniform random assignment with the same quota.
    // This avoids making an unusually lucky/unlucky fixed seed the main comparator.
    const q=weakCalls/rows.length,expectedRandom=rows.map(r=>q*Number(r.weak)+(1-q)*Number(r.strong));
    const accuracies=data.protocol.randomSeeds.map(seed=>100*mean(evaluate(matchedRandom(rows.length,weakCalls,seed))));
    const result={targetWeakShare:share,calibrationRealizedShare:threshold.calibrationRealizedShare,threshold:threshold.threshold,
      testCount:rows.length,weakCalls,strongCalls:rows.length-weakCalls,realizedWeakShare:weakCalls/rows.length,
      accuraciesPct:{strong:100*mean(strong),weak:100*mean(weak),random:100*mean(control),randomExpected:100*mean(expectedRandom),learned:100*mean(learned)},
      learnedMinusStrong:pairedInterval(learned.map((x,i)=>100*(x-strong[i])),data.protocol),
      learnedMinusRandom:pairedInterval(learned.map((x,i)=>100*(x-control[i])),data.protocol),
      learnedMinusExpectedRandom:{...pairedInterval(learned.map((x,i)=>100*(x-expectedRandom[i])),data.protocol),
        scope:'95% paired percentile bootstrap over questions versus the exact matched-quota random expectation; quota and fitted router held fixed. Does not include fitting, random-allocation or dataset-shift uncertainty.'},
      randomSeedVariation:{count:accuracies.length,meanAccuracyPct:mean(accuracies),minAccuracyPct:Math.min(...accuracies),maxAccuracyPct:Math.max(...accuracies),scope:'Descriptive variation over all predeclared matched-budget random seeds; not a confidence interval'},
      rows:rows.map((r,i)=>({id:r.id,row:r.row,score:r.score,useWeak:decisions[i],randomUseWeak:randomDecision[i],strongCorrect:strong[i],weakCorrect:weak[i],learnedCorrect:learned[i],randomCorrect:control[i]})),
      energyJ:null,latencyMs:null,scope:data.routing.scope};
    result.checks={sameTestQuestions:result.rows.length===rows.length,matchedWeakBudget:randomDecision.filter(Boolean).length===weakCalls,
      labelBlindDecision:true,noEnergyOrLatencyInvented:result.energyJ===null&&result.latencyMs===null};
    return result;
  }
  function selectSlot(remaining,request,placement){
    let slot=-1;
    for(let i=0;i<remaining.length;i++)if(remaining[i]>=request){
      if(slot<0||(placement==='best'&&remaining[i]<remaining[slot]))slot=i;
      if(placement==='first')break;
    }
    return slot;
  }
  function schedule(records,slots,arrivalScale,policy){
    if(!Number.isInteger(slots)||slots<1||slots>128)throw new RangeError('GPU slots must be an integer 1–128');
    finite(arrivalScale,'arrival scale',Number.MIN_VALUE);
    if(!['fifo_first','fifo_best','backfill_first','backfill_best'].includes(policy))throw new RangeError('Unknown scheduler policy');
    if(!records.length)throw new RangeError('Empty reservation workload');
    if(new Set(records.map(r=>r.id)).size!==records.length)throw new RangeError('Reservation IDs must be unique');
    const original=records.map(r=>{finite(r.creationSeconds,'arrival');finite(r.reservationSeconds,'reservation duration',Number.MIN_VALUE);if(!Number.isInteger(r.gpuMilli)||r.gpuMilli<1||r.gpuMilli>1000)throw new RangeError('Single-slot GPU request must be 1–1000 mGPU');return r;}).sort((a,b)=>a.creationSeconds-b.creationSeconds||a.id.localeCompare(b.id,'en'));
    const origin=original[0].creationSeconds;
    const arrivals=original.map(r=>{const arrival=(r.creationSeconds-origin)*arrivalScale;finite(arrival,'scaled arrival');return {...r,arrivalSeconds:arrival};});
    const remaining=Array(slots).fill(1000),pending=[],running=[],jobs=[],events=[];
    let next=0,now=0,peakPending=0,peakReserved=0,minResidual=1000;
    const placement=policy.endsWith('best')?'best':'first',backfill=policy.startsWith('backfill');
    while(next<arrivals.length||pending.length||running.length){
      for(let i=running.length-1;i>=0;i--)if(running[i].releaseSeconds<=now){remaining[running[i].slot]+=running[i].gpuMilli;running.splice(i,1);}
      while(next<arrivals.length&&arrivals[next].arrivalSeconds<=now)pending.push(arrivals[next++]);
      peakPending=Math.max(peakPending,pending.length);
      for(let i=0;i<pending.length;){
        const job=pending[i],slot=selectSlot(remaining,job.gpuMilli,placement);
        if(slot<0){if(!backfill)break;i++;continue;}
        const release=now+job.reservationSeconds;finite(release,'release');if(release<=now)throw new RangeError('Reservation interval is below floating-point time resolution');
        const assigned={id:job.id,sourcePhase:job.sourcePhase,gpuMilli:job.gpuMilli,slot,
          arrivalSeconds:job.arrivalSeconds,startSeconds:now,releaseSeconds:release,waitSeconds:now-job.arrivalSeconds,reservationSeconds:job.reservationSeconds};
        remaining[slot]-=job.gpuMilli;running.push(assigned);jobs.push(assigned);pending.splice(i,1);
      }
      minResidual=Math.min(minResidual,...remaining);
      const reserved=slots*1000-remaining.reduce((a,b)=>a+b,0);peakReserved=Math.max(peakReserved,reserved);
      events.push({timeSeconds:now,pending:pending.length,running:running.length,reservedMilli:reserved});
      const following=Math.min(next<arrivals.length?arrivals[next].arrivalSeconds:Infinity,...running.map(r=>r.releaseSeconds));
      if(!Number.isFinite(following)){if(pending.length)throw new Error('Pending reservations cannot be placed');break;}
      if(following<=now)throw new Error('Non-increasing scheduler event clock');now=following;
    }
    const waits=jobs.map(j=>j.waitSeconds),requestedGpuSeconds=jobs.reduce((sum,j)=>sum+j.gpuMilli/1000*j.reservationSeconds,0);
    const result={policy,slots,arrivalScale,reservations:records.length,released:jobs.length,pendingAtEnd:pending.length,
      meanWaitSeconds:mean(waits),p95WaitSeconds:quantile(waits,.95),maxWaitSeconds:Math.max(...waits),
      makespanSeconds:now,requestedGpuSeconds,meanReservedCapacityPct:100*requestedGpuSeconds/(slots*now),
      peakReservedCapacityPct:100*peakReserved/(slots*1000),peakPendingBeforeDispatch:peakPending,
      jobs:jobs.sort((a,b)=>a.id.localeCompare(b.id,'en')),timeline:events,
      scope:'GPU-only counterfactual reservation replay; recorded residence is a duration proxy, not service time. Released reservations are not successful completed jobs. Requested capacity is not measured utilization. Greedy backfill has no head-of-line start-time guarantee.'};
    result.checks={allReservationsAccounted:jobs.length===records.length&&pending.length===0&&running.length===0,
      noOversubscription:minResidual>=0&&remaining.every(r=>r===1000),nonnegativeWait:waits.every(w=>w>=0)};
    return result;
  }
  function experiment(data,parameters={}){
    const p={weakShare:data.protocol.primaryWeakShare,gpuSlots:data.protocol.primaryGpuSlots,arrivalScale:data.protocol.primaryArrivalScale,...parameters};
    if(!data.protocol.gpuSlots.includes(p.gpuSlots)||!data.protocol.arrivalScales.includes(p.arrivalScale))throw new RangeError('Choose declared scheduler settings');
    const router=routing(data,p.weakShare),scheduler=data.protocol.schedulerPolicies.map(policy=>schedule(data.scheduling.records,p.gpuSlots,p.arrivalScale,policy));
    return {schemaVersion:1,engineVersion:VERSION,kind:data.kind,parameters:p,routing:router,scheduling:scheduler,sources:data.sources,
      checks:{...router.checks,schedulerAccounting:scheduler.every(s=>Object.values(s.checks).every(Boolean)),
        equalRequestedWork:scheduler.every(s=>Math.abs(s.requestedGpuSeconds-scheduler[0].requestedGpuSeconds)<1e-6)}};
  }
  return {VERSION,routing,schedule,experiment,selectSlot,matchedRandom,quantile};
});
