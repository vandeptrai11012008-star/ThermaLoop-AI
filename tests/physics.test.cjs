const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto'),vm=require('node:vm');
const D=require('../science/physics/results.json'),root=path.join(__dirname,'..');
const sha=raw=>crypto.createHash('sha256').update(raw).digest('hex');
test('physical-model inputs, source snapshots and offline bundle match recorded bytes',()=>{
  for(const [name,hash]of Object.entries(D.sourceHashes))assert.equal(sha(fs.readFileSync(path.join(root,name))),hash,name);
  for(const s of D.sources)assert.equal(sha(fs.readFileSync(path.join(root,'science/physics',s.id))),s.sha256);
  const context={};vm.runInNewContext(fs.readFileSync(path.join(root,'science/physics-data.js'),'utf8'),context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.ThermaPhysicsData)),D);
  assert.equal(context.ThermaPhysicsBuild.sha256,sha(fs.readFileSync(path.join(root,'science/physics/results.json'))));
});
test('finite primary capacity changes die temperature without relabeling legacy bath results',()=>{
  const first=D.cases[0],last=D.cases.at(-1);
  assert.ok(first.steady.T_die_C>last.steady.T_die_C+10);
  assert.ok(D.cases.every(c=>c.steady.legacy_fixed_sink_die_C===first.steady.legacy_fixed_sink_die_C));
  assert.ok(D.cases.every(c=>c.cells===D.protocol.reported_cells&&c.primary_cells===c.cells/5));
});
test('both heat-capacity rates and finite-stream enthalpy rise are physically consistent',()=>{
  for(const c of D.cases){const s=c.steady,q=D.protocol.n_gpus*D.protocol.steady_power_per_gpu_W;
    assert.ok(Math.abs((s.CDU_primary_outlet_C-s.CDU_primary_inlet_C)*s.primary_capacity_W_K-q)<1e-7);
    assert.ok(Math.abs(s.heat_rejected_W-q)<1e-7);
    assert.ok(s.CDU_effectiveness_discrete>0&&s.CDU_effectiveness_discrete<1);
    assert.ok(s.CDU_effectiveness_discrete<s.continuum.effectiveness);
  }
});
test('energy includes primary liquid and return-buffer storage instead of equating transient input/output',()=>{
  for(const c of D.cases){const e=c.energy;
    assert.ok(Math.abs(e.input_J-e.rejected_J-e.stored_change_J)<1e-4);
    assert.ok(e.stored_change_J>1000);
    assert.match(e.boundary,/finite primary CDU liquid/);
    assert.ok(e.max_roundoff_budget_ratio<=1);
    assert.ok(e.min_interfacial_entropy_generation_W_K>=0);
    assert.match(e.entropy_scope,/not a whole-system/);
  }
});
test('unmeasured primary hold-up affects the transient but cannot change steady predictions',()=>{
  const rows=D.primary_volume_sensitivity;
  assert.deepEqual(rows.map(r=>r.primary_volume_m3),D.protocol.primary_volume_sensitivity_m3);
  assert.ok(rows.every(r=>r.steady.T_die_C===rows[0].steady.T_die_C));
  assert.ok(Math.max(...rows.map(r=>r.peak_die_C))-Math.min(...rows.map(r=>r.peak_die_C))>.001);
  assert.match(D.protocol.primary_volume_assumption,/unmeasured/);
});
test('reported grid error stays visible and refinement identifies a case-specific target',()=>{
  assert.ok(D.spatial.find(r=>r.cells===D.protocol.reported_cells).discretization_error_C>D.protocol.steady_discretization_target_C);
  assert.equal(D.spatial.find(r=>r.discretization_error_C<=D.protocol.steady_discretization_target_C).cells,D.first_grid_meeting_target);
  for(let i=1;i<D.spatial.length;i++)assert.ok(D.spatial[i].discretization_error_C<D.spatial[i-1].discretization_error_C);
});
test('time-solution checks cover all temperatures and heat integrals, without fabricated measurement accuracy',()=>{
  for(const c of D.cases){assert.ok(c.solver.max_all_state_error_C<D.protocol.temporal_temperature_target_C);assert.ok(c.solver.max_integrated_heat_error_J<D.protocol.relative_integral_energy_target*c.energy.input_J);}
  assert.equal(D.measured_prediction_MAE_C,null);
  assert.ok(D.limitations.some(s=>s.includes('unknown')));
  assert.ok(D.limitations.some(s=>s.includes('held constant')));
  assert.ok(D.limitations.some(s=>s.includes('not copied')));
  assert.match(D.protocol.power_scope,/Pump work/);
  assert.ok(Object.values(D.gates).every(Boolean));
});
test('all artifact numeric fields are finite',()=>{
  function walk(x){if(typeof x==='number')assert.ok(Number.isFinite(x));else if(x&&typeof x==='object')Object.values(x).forEach(walk);}
  walk(D);
});
