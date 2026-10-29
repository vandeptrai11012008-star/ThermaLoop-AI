const test=require('node:test');
const assert=require('node:assert/strict');
const M=require('../service/unified-physics.js');
const approx=(a,b,tolerance=1e-7)=>assert.ok(Math.abs(a-b)<=tolerance,`${a} != ${b}`);

test('One canonical serial circuit is finite, pressure balanced and deterministic',()=>{
  const t=M.topology(),h=M.hydraulics(t,75),r=M.simulate({scenario:{seed:42,horizonMinutes:60}});
  assert.equal(t.order.length,t.nodes.length);
  assert.ok(h.flowLps>0&&h.pumpHeadPa>0&&h.pumpElectricKW>0);
  approx(h.pumpHeadPa,h.pressureDropPa,1e-6);
  assert.ok(r.energyResidualKJ<1e-5,`energy residual ${r.energyResidualKJ}`);
  assert.ok(r.maxPressureResidualPa<1e-6);
  assert.equal(r.minute,60);assert.equal(r.trace.length,61);
  assert.deepEqual(r,M.simulate({scenario:{seed:42,horizonMinutes:60}}));
  assert.equal(r.hardwareAuthorized,false);
  assert.match(r.validity,/Uncalibrated/);
  assert.notDeepEqual(r.state,M.simulate({scenario:{seed:43,horizonMinutes:60}}).state);
});

test('Pump curve, pipe pressure losses and electrical power respond to controls',()=>{
  const t=M.topology(),low=M.hydraulics(t,30),high=M.hydraulics(t,90);
  assert.ok(low.flowLps<high.flowLps);
  assert.ok(low.pumpElectricKW<high.pumpElectricKW);
  assert.deepEqual(M.hydraulics(t,0).flowLps,0);
  const narrow=structuredClone(t);narrow.nodes.find(n=>n.id==='PIPE-A').params.diameterMm=20;
  assert.ok(M.hydraulics(M.topology(narrow),75).flowLps< M.hydraulics(t,75).flowLps);
  const h=M.hydraulics(t,75);const p=t.nodes.find(n=>n.type==='pump').params;
  approx(h.pumpElectricKW,h.pumpHeadPa*(h.flowLps/1000)/(1000*p.efficiency));
});

test('Counter-flow epsilon-NTU respects limiting capacity rates and UA',()=>{
  assert.equal(M.epsilonNTU(0,2,3),0);
  assert.equal(M.epsilonNTU(4,0,3),0);
  assert.ok(M.epsilonNTU(4,2,3)>M.epsilonNTU(1,2,3));
  approx(M.epsilonNTU(2,2,2),0.5);
  approx(M.epsilonNTU(5,2,3),M.epsilonNTU(5,3,2));
  assert.ok(M.epsilonNTU(1e8,2,3)<=1);
});

test('Time-step refinement remains numerically consistent across normal and fault scenarios',()=>{
  for(const preset of ['winter','summer','pump-fault']){
    const w=M.createWorld({scenario:{preset,horizonMinutes:15}});
    const coarse=M.advance(w,{minutes:15,stepSeconds:5});
    const refined=M.advance(w,{minutes:15,stepSeconds:1});
    for(const key of ['gpuC','coolantC','buildingC'])
      assert.ok(Math.abs(coarse.state[key]-refined.state[key])<.25,preset+' '+key);
    assert.ok(coarse.energyResidualKJ<1e-5&&refined.energyResidualKJ<1e-5);
  }
  assert.throws(()=>M.advance(M.createWorld(),{stepSeconds:7}),/divisor of 60/);
});

test('Replay by minute is identical to one advance; pipe/tank volumes use water heat capacity',()=>{
  const w=M.createWorld({scenario:{seed:13,horizonMinutes:20}});
  const direct=M.advance(w,{minutes:4});let steps=w;
  for(let i=0;i<4;i++)steps=M.advance(steps,{minutes:1});
  for(const k of ['gpuC','coolantC','buildingC'])approx(direct.state[k],steps.state[k],1e-11);
  approx(direct.metrics.siteElectricKWh,steps.metrics.siteElectricKWh,1e-11);
  const more=M.spliceAfter(w.topology,{id:'TES-001',type:'tank',params:{waterLiters:250,lossK:1,uaWK:3}},'PIPE-A');
  approx(M.waterCapacityKJK(more)-M.waterCapacityKJK(w.topology),250/1000*M.WATER.densityKgM3*M.WATER.cpKJKgK,1e-9);
});

test('Agents can add/move/edit/remove serial components, but cannot create invalid physical graphs',()=>{
  let t=M.topology();t=M.spliceAfter(t,{id:'TES-001',type:'tank',params:{waterLiters:200,lossK:1,uaWK:5}},'GPU-001');
  assert.equal(t.nodes.length,7);assert.equal(t.order[2],'TES-001');
  t=M.moveAfter(t,'TES-001','HX-101');assert.equal(t.order[4],'TES-001');
  t.nodes.find(n=>n.id==='TES-001').params.waterLiters=500;
  t=M.topology(t);assert.ok(M.simulate({topology:t,scenario:{horizonMinutes:4}}).state.coolantC>0);
  t=M.removeNode(t,'TES-001');assert.equal(t.nodes.length,6);
  const broken=structuredClone(t);broken.edges[0].to='NO_SUCH_ID';
  assert.throws(()=>M.topology(broken),/Edges/);
  const duplicate=structuredClone(t);duplicate.edges[1].to=duplicate.edges[0].to;
  assert.throws(()=>M.topology(duplicate),/Edges/);
  assert.throws(()=>M.removeNode(t,'P-101'),/Only optional/);
  const invalid=structuredClone(t);invalid.nodes.find(n=>n.type==='pipe').params.diameterMm=1;
  assert.throws(()=>M.topology(invalid),/diameterMm/);
  const advanced=M.advance(M.createWorld(),{minutes:1});
  assert.throws(()=>M.editTopology(advanced,t),/Reset/);
  const rearranged=M.moveAfter(M.DEFAULT_TOPOLOGY,'DRY-101','P-101');
  const originalRun=M.simulate({scenario:{horizonMinutes:15}});
  const movedRun=M.simulate({topology:rearranged,scenario:{horizonMinutes:15}});
  // A graph edit has real downstream consequences, not only a visual rearrangement.
  assert.ok(Math.abs(originalRun.state.coolantC-movedRun.state.coolantC)>.1);
  assert.equal(movedRun.hydraulics.componentTransfers.length,rearranged.nodes.length);
  assert.ok(movedRun.energyResidualKJ<1e-5);
});

test('Controls, checkpoint validation and fault consequences are bounded',()=>{
  assert.throws(()=>M.controls({pumpPct:200}),/pumpPct/);
  assert.throws(()=>M.createWorld({scenario:{horizonMinutes:121}}),/horizonMinutes/);
  assert.throws(()=>M.advance(M.createWorld(),{expectedMinute:1}),/Stale/);
  const good=M.simulate({scenario:{preset:'winter',seed:8,horizonMinutes:60}});
  const fault=M.simulate({scenario:{preset:'pump-fault',seed:8,horizonMinutes:60}});
  assert.ok(fault.hydraulics.flowLps<good.hydraulics.flowLps);
  assert.ok(Number.isFinite(fault.state.gpuC));
  assert.ok(good.energyResidualKJ<1e-5&&fault.energyResidualKJ<1e-5);
  const stopped=M.simulate({scenario:{horizonMinutes:60},controls:{pumpPct:0}});
  assert.equal(stopped.hydraulics.flowLps,0);
  assert.ok(stopped.violations.some(v=>v.code==='gpu_hot'));
  assert.ok(stopped.metrics.throttledMinutes>0);
  assert.ok(stopped.energyResidualKJ<1e-5);
});
