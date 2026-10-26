const {test}=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const crypto=require('node:crypto');
const vm=require('node:vm');
const D=require('../science/numerical/results.json');
const root=path.join(__dirname,'..');

test('numerical evidence identifies its synthetic scope and real source/configuration bytes',()=>{
  assert.equal(D.schemaVersion,2);
  assert.match(D.kind,/Numerical verification only/);
  assert.ok(D.limitations.some(x=>x.includes('browser 3D')));
  assert.ok(D.warnings.some(x=>x.includes('channel_geometry')));
  for(const [name,hash]of Object.entries(D.sourceHashes)){
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(root,name))).digest('hex'),hash,name);
  }
});
test('the browser bundle is an exact representation of the checked result file',()=>{
  const context={};vm.runInNewContext(fs.readFileSync(path.join(root,'science/numerical-data.js'),'utf8'),context);
  assert.deepEqual(JSON.parse(JSON.stringify(context.ThermaNumericalData)),D);
  assert.equal(context.ThermaNumericalBuild.schemaVersion,D.schemaVersion);
  assert.equal(context.ThermaNumericalBuild.sha256,crypto.createHash('sha256').update(fs.readFileSync(path.join(root,'science/numerical/results.json'))).digest('hex'));
});
test('both corrected reference models pass clock invariance without hiding the reproduced defect',()=>{
  for(const m of Object.values(D.models)){
    assert.deepEqual(m.clock.clock_origins_s,[0,10,1000]);
    assert.ok(m.clock.legacy_difference_C>19);
    assert.ok(m.clock.corrected_max_difference_C<=D.protocol.temperature_target_C);
    assert.match(m.clock.scope,/not a measured/);
  }
});
test('NTU and fixed-sink effectiveness retain different definitions and bounds',()=>{
  assert.equal(D.CDU.legacy_eps_effective,D.CDU.NTU);
  assert.ok(D.CDU.NTU>1);
  assert.ok(D.CDU.isothermal_effectiveness>=0&&D.CDU.isothermal_effectiveness<=1);
  const expected=1-(1+D.CDU.NTU/D.CDU.cdu_cells)**(-D.CDU.cdu_cells);
  assert.ok(Math.abs(D.CDU.isothermal_effectiveness-expected)<1e-12);
  assert.equal(D.CDU.mesh_cells,50);
  assert.ok(D.CDU.lumped_counterflow_effectiveness>=0&&D.CDU.lumped_counterflow_effectiveness<=1);
  assert.notEqual(D.CDU.isothermal_effectiveness,D.CDU.lumped_counterflow_effectiveness);
  assert.match(D.CDU.definition,/Different CDU boundary/);
});
test('mesh rows preserve physical parameters and identify the first declared steady target honestly',()=>{
  const rows=D.spatial.rows;
  assert.deepEqual(rows.map(r=>r.cells),D.protocol.spatial_cells);
  for(const r of rows){assert.equal(r.liquid_mass_kg,2.87);assert.equal(r.wetted_area_m2,.032);assert.equal(r.UA_W_K,2400);}
  const first=rows.find(r=>r.steady_continuum_error_C<=D.spatial.steady_target_C);
  assert.equal(first.cells,D.spatial.first_steady_grid_meeting_target);
  assert.ok(rows.find(r=>r.cells===80).steady_continuum_error_C>D.spatial.steady_target_C);
  assert.ok(rows.filter(r=>r.integrated_steady_temperature_C===null).length>0);
  assert.match(D.spatial.scope,/not an error bound/);
});
test('adaptive refinement exposes a step-limit plateau and rejects a too-loose tolerance for the target',()=>{
  for(const s of Object.values(D.models)){
    assert.equal(s.step_limits.length,3);assert.equal(s.tolerance_levels.length,3);
    assert.ok(Math.abs(s.step_limits[0].max_trajectory_error_C-s.step_limits[1].max_trajectory_error_C)<D.protocol.temperature_target_C*.01);
    assert.ok(s.tolerance_levels[0].max_trajectory_error_C>D.protocol.temperature_target_C);
    assert.ok(s.solver_errors.max_trajectory_error_C<=D.protocol.temperature_target_C);
    assert.deepEqual(s.selected_solver_controls,D.protocol.selected_solver);
  }
});
test('reported energy includes nonzero transient storage and explicit integral/differential residuals',()=>{
  for(const s of Object.values(D.models)){
    const e=s.energy;
    assert.ok(e.max_transient_storage_rate_W>4000);
    assert.ok(Math.abs(e.input_energy_J-e.final_rejected_energy_J-e.final_stored_energy_change_J)<1e-4);
    assert.ok(e.max_residual_to_roundoff_budget_ratio<=1);
    assert.ok(e.max_integral_residual_J<=D.protocol.integrated_heat_relative_target*e.input_energy_J);
  }
  assert.ok(Object.values(D.gates).every(x=>x===true));
});
test('the published artifact contains no nonfinite numeric values',()=>{
  function walk(value){if(typeof value==='number')assert.ok(Number.isFinite(value));else if(value&&typeof value==='object')Object.values(value).forEach(walk);}
  walk(D);
});
