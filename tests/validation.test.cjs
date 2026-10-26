const {test} = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const vm = require('node:vm');
const V = require('../science/validation-model.js');
const D = require('../science/validation/research.json');
const near = (a,b,t=1e-10) => assert.ok(Math.abs(a-b)<=t,`${a} != ${b}`);
const example = {Tin_C:30,Tout_C:35,surface_C:45,electrical_W:1000,massFlow_kg_s:.05,cp_J_kgK:4000,reportedR_Tin_K_W:null};

test('reference snapshot hashes and generated research bundle agree exactly', () => {
  for(const s of D.provenance.snapshots) {
    assert.equal(crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../science/validation',s.file))).digest('hex'),s.sha256);
  }
  const sandbox={};vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../science/validation-data.js'),'utf8'),sandbox);
  assert.deepEqual(JSON.parse(JSON.stringify(sandbox.ThermaValidationData)),D);
  assert.equal(sandbox.ThermaValidationBuild.researchSHA256,crypto.createHash('sha256').update(fs.readFileSync(path.join(__dirname,'../science/validation/research.json'))).digest('hex'));
});
test('primary references, missing measurements and uncertainty are never promoted to verified data', () => {
  assert.equal(D.anchor.primarySourceVerified,false);
  assert.ok(D.sources.every(s => s.primaryDocumentSHA256===null&&s.rawDataLicense===null&&s.status==='primary_not_retrieved'));
  assert.ok(D.anchor.points.every(p => p.case_C===null&&p.die_C===null&&p.Tout_C===null&&p.delta_p_Pa===null));
  assert.equal(D.anchor.points.filter(p=>p.role==='calibration').length,1);
});
test('constant-UA evaluation reproduces independently recorded Python anchor predictions', () => {
  const r=V.benchmark(D,0);
  const expected=[.04139908784728065,.037,.03562424656199209,.03495355058139696];
  r.rows.forEach((p,i)=>near(p.predicted,expected[i],1e-14));
  near(r.metrics.relativeRMSPct,1.924039106944864,1e-10);
  assert.equal(r.metrics.n,3);assert.equal(r.calibrationCount,1);assert.equal(r.independentValidationCount,0);
  assert.equal(r.predictionInterval,null);assert.equal(r.coverage,null);
});
test('comparison exposes the invalid turbulent assumption instead of claiming a universal winning correlation', () => {
  const r=V.benchmark(D,.8);
  near(r.metrics.relativeRMSPct,29.070075596072137,1e-10);
  assert.match(r.applicability,/Incompatible/);
  assert.ok(r.rows.every(p=>p.reynolds<2300));
  assert.match(V.benchmark(D,1/3).applicability,/unknown without conductivity/);
  assert.throws(()=>V.benchmark(D,.7),RangeError);
});
test('calibration is frozen at 2 L/min; evaluation outcomes cannot alter fitted fixed resistance', () => {
  const edited=structuredClone(D);edited.anchor.points[0].R_Tin_K_W*=2;
  near(V.benchmark(edited).fixedResistance_K_W,V.benchmark(D).fixedResistance_K_W);
  near(V.benchmark(D,.8).fixedResistance_K_W,V.benchmark(D,0).fixedResistance_K_W);
  const invalid=structuredClone(D);invalid.anchor.points=invalid.anchor.points.filter(p=>p.role==='calibration');
  assert.throws(()=>V.benchmark(invalid),/evaluation point/);
});
test('mass conversion and Reynolds calculation follow dimensions independently of the thermal fit', () => {
  const r=V.benchmark(D),p=r.rows[0],rho=1017.8564;
  near(p.massFlow_kg_s,1e-3/60*rho,1e-14);
  const velocity=p.massFlow_kg_s/(rho*120*.0002*.004);
  const dh=2*.0002*.004/(.0002+.004);
  near(p.reynolds,rho*velocity*dh/r.properties.mu_Pa_s);
  assert.equal(r.properties.k_W_mK,null);
});
test('error metrics distinguish relative RMS from range-normalized RMSE and retain bias', () => {
  const m=V.metrics([{observed:2,predicted:3},{observed:4,predicted:3}]);
  near(m.bias,0);near(m.mae,1);near(m.rmse,1);near(m.nrmseRange,.5);near(m.mapePct,37.5);
  assert.notEqual(V.benchmark(D).metrics.nrmseRange*100,V.benchmark(D).metrics.relativeRMSPct);
  assert.equal(V.metrics([{observed:2,predicted:3}]).nrmseRange,null);
  assert.equal(V.metrics([{observed:0,predicted:1}]).mapePct,null);
  assert.equal(V.metrics([]).rmse,null);
});
test('electrical resistance, LMTD, absorbed heat and isothermal effectiveness agree analytically', () => {
  const r=V.measurement(example),lmtd=5/Math.log(1.5);
  near(r.R_Tin_electrical_K_W,.015);near(r.LMTD_K,lmtd);near(r.R_LMTD_electrical_K_W,lmtd/1000);
  near(r.Q_fluid_W,1000);near(r.captureFraction,1);near(r.heatBalanceResidual_W,0);
  near(r.UA_liquid_W_K,1000/lmtd);near(r.isothermalEffectiveness,1/3);
  const ntu=r.UA_liquid_W_K/(.05*4000);
  near(r.isothermalEffectiveness,1-Math.exp(-ntu));
});
test('near-equal temperatures and zero coolant rise use the stable LMTD limit', () => {
  const equal=V.measurement({...example,Tout_C:30});
  near(equal.LMTD_K,15);near(equal.Q_fluid_W,0);near(equal.isothermalEffectiveness,0);
  const nearEqual=V.measurement({...example,Tout_C:30+1e-10});
  near(nearEqual.LMTD_K,15,1e-9);
});
test('missing optional observables remain null rather than fabricated fluid heat or UA', () => {
  const r=V.measurement({...example,Tout_C:null,massFlow_kg_s:null,cp_J_kgK:null});
  near(r.R_Tin_electrical_K_W,.015);
  for(const key of ['LMTD_K','Q_fluid_W','captureFraction','UA_liquid_W_K','isothermalEffectiveness'])assert.equal(r[key],null,key);
  assert.equal(V.measurement({...example,cp_J_kgK:null}).Q_fluid_W,null);
});
test('electrical and liquid heat bases remain separate and overcapture is visible', () => {
  const r=V.measurement({...example,massFlow_kg_s:.1});
  near(r.Q_fluid_W,2000);near(r.captureFraction,2);near(r.heatBalanceResidual_W,1000);
  near(r.UA_liquid_W_K*r.R_LMTD_electrical_K_W,2);
});
test('the report illustrative YAML inconsistency is flagged without importing a new measurement', () => {
  const r=V.measurement({Tin_C:32,surface_C:85,electrical_W:750,reportedR_Tin_K_W:.085});
  near(r.R_Tin_electrical_K_W,53/750);assert.equal(r.reportedResistanceArithmeticConsistent,false);
  assert.equal(r.Q_fluid_W,null);assert.match(r.kind,/illustrative/);
});
test('invalid heating states and arithmetic overflow fail explicitly', () => {
  for(const override of [{electrical_W:0},{surface_C:29},{Tout_C:46},{Tout_C:29},{massFlow_kg_s:-1},{cp_J_kgK:NaN},{electrical_W:1e-320}]) {
    assert.throws(()=>V.measurement({...example,...override}),RangeError);
  }
});
test('CSV preserves evaluation partition, source links, hashes and scope', () => {
  const csv=V.csv(V.benchmark(D));
  assert.match(csv,/same_source_evaluation/);assert.match(csv,/independent_validation_n/);
  assert.ok(csv.includes(D.provenance.snapshots[0].sha256));assert.match(csv,/not an independent experimental|no independent experimental/);
});
