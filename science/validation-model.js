/* Observable-first thermal checks; separate from the existing 3D and heat scenario.
 * PG25 formulas and relative-UA reference adapted from ThermaLoop,
 * Copyright (c) 2026 Travis Walla, MIT; see validation/UPSTREAM-LICENSE.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ThermaValidation = api;
})(globalThis, function () {
  'use strict';
  const VERSION = '1.0.0';
  function finite(x, name, positive = false) {
    if (!Number.isFinite(x) || (positive && x <= 0)) throw new RangeError(name + ' must be finite' + (positive ? ' and positive' : ''));
    return x;
  }
  function metrics(pairs, mapeFloor = 0) {
    if (!pairs.length) return {n:0,bias:null,mae:null,rmse:null,nrmseRange:null,mapePct:null};
    pairs.forEach(p => { finite(p.observed,'Observed value'); finite(p.predicted,'Prediction'); });
    const errors = pairs.map(p => p.predicted - p.observed), n = pairs.length;
    const rmse = Math.sqrt(errors.reduce((s,e) => s + e*e,0)/n);
    const span = Math.max(...pairs.map(p => p.observed)) - Math.min(...pairs.map(p => p.observed));
    return {n,bias:errors.reduce((s,e) => s+e,0)/n,mae:errors.reduce((s,e) => s+Math.abs(e),0)/n,rmse,
      nrmseRange:span > 0 ? rmse/span : null,
      mapePct:pairs.every(p => p.observed > mapeFloor) ? 100*errors.reduce((s,e,i) => s+Math.abs(e/pairs[i].observed),0)/n : null};
  }
  function pgProperties(T) {
    const cp = (4186 - 1100*.25) + 3*(T-37);
    const rho = (1000.6-.0128*T-.0035*T*T)+85*.25;
    const mu = 2.414e-5*10**(247.8/(T+273.15-140))*(1+6*.25);
    return {cp_J_kgK:cp,rho_kg_m3:rho,mu_Pa_s:mu,k_W_mK:null,temperature_C:T,
      kind:'Pinned upstream engineering PG25 approximation; composition basis assumed by mass'};
  }
  function benchmark(data, exponent = 0) {
    if (![0,1/3,.8].includes(exponent)) throw new RangeError('Select the explicit 0, 1/3 or 0.8 comparison');
    const a = data.anchor, properties = pgProperties(a.conditions.Tin_C), cp = properties.cp_J_kgK;
    const calibration = a.points.filter(p => p.role === 'calibration');
    if (calibration.length !== 1 || calibration[0].flow_L_min !== a.calibrationFlow_L_min) throw new RangeError('Exactly one declared calibration flow is required');
    const mdot = flow => finite(flow,'Flow',true)/1000/60*properties.rho_kg_m3;
    const mcal = mdot(a.calibrationFlow_L_min), uaCal = 1/finite(a.R_LMTD_K_W,'Reference R_LMTD',true);
    const resistance = (m,ua) => 1/(-Math.expm1(-ua/(m*cp))*m*cp);
    const rFixed = calibration[0].R_Tin_K_W - resistance(mcal,uaCal);
    if (!(rFixed > 0)) throw new RangeError('Calibration implies a nonpositive fixed resistance');
    const g = a.geometry, dh = 2*g.channel_width_m*g.channel_height_m/(g.channel_width_m+g.channel_height_m);
    const rows = a.points.map(p => {
      const m = mdot(p.flow_L_min), ua = uaCal*(m/mcal)**exponent;
      const predicted = rFixed + resistance(m,ua);
      return {...p,massFlow_kg_s:m,reynolds:m*dh/(g.n_channels*g.channel_width_m*g.channel_height_m*properties.mu_Pa_s),
        observed:p.R_Tin_K_W,predicted,residual_K_W:predicted-p.R_Tin_K_W,UA_W_K:ua};
    });
    const evaluation = rows.filter(p => p.role !== 'calibration');
    if (!evaluation.length) throw new RangeError('At least one evaluation point is required');
    const summary = metrics(evaluation,a.uncertainty.reportedDigitizationBound_K_W);
    summary.relativeRMSPct = 100*Math.sqrt(evaluation.reduce((s,p) => s+((p.predicted-p.observed)/p.observed)**2,0)/evaluation.length);
    return {schemaVersion:1,engineVersion:VERSION,kind:'Replay against repository-supplied digitization; no independent experimental validation',
      sourceAnchor:a.id,exponent,properties,rows,metrics:summary,provenance:data.provenance,calibrationCount:1,evaluationCount:evaluation.length,
      independentValidationCount:0,fixedResistance_K_W:rFixed,calibrationUA_W_K:uaCal,
      applicability:exponent === .8 ? 'Incompatible turbulent-flow exponent: deliberate falsification comparator at laminar Re' : 'Empirical UA scaling comparison; thermal development unknown without conductivity',
      predictionInterval:null,coverage:null,partitionNote:a.partitionNote,
      limitation:'Same-source evaluation points are reused for exponent comparison. Unverified digitization and property assumptions remain; no full-server temperatures or savings are validated.'};
  }
  function measurement(input) {
    const p = {...input};
    finite(p.Tin_C,'Inlet temperature'); finite(p.surface_C,'Surface temperature'); finite(p.electrical_W,'Electrical power',true);
    if (p.surface_C <= p.Tin_C) throw new RangeError('Heating case requires surface temperature above inlet');
    const present = key => p[key] !== null && p[key] !== undefined;
    for (const key of ['massFlow_kg_s','cp_J_kgK','reportedR_Tin_K_W']) if (present(key)) finite(p[key],key,true);
    const dtIn = p.surface_C-p.Tin_C;
    const rTin = finite(dtIn/p.electrical_W,'Derived R_Tin');
    let lmtd = null, qFluid = null, effectiveness = null;
    if (present('Tout_C')) {
      finite(p.Tout_C,'Outlet temperature');
      if (p.Tout_C < p.Tin_C || p.Tout_C >= p.surface_C) throw new RangeError('Heating case requires Tin ≤ Tout < surface temperature');
      const rise = p.Tout_C-p.Tin_C, dtOut = p.surface_C-p.Tout_C;
      lmtd = rise === 0 ? dtIn : rise/Math.log1p(rise/dtOut);
      effectiveness = rise/dtIn;
      if (present('massFlow_kg_s') && present('cp_J_kgK')) qFluid = finite(p.massFlow_kg_s*p.cp_J_kgK*rise,'Derived liquid heat');
    }
    const discrepancy = present('reportedR_Tin_K_W') ? p.reportedR_Tin_K_W-rTin : null;
    const arithmeticConsistent = discrepancy === null ? null : Math.abs(discrepancy) <= 1e-9*Math.max(rTin,p.reportedR_Tin_K_W);
    const result = {schemaVersion:1,engineVersion:VERSION,kind:'User-entered illustrative observable calculation; not imported measurement data',inputs:p,
      R_Tin_electrical_K_W:rTin,R_LMTD_electrical_K_W:lmtd === null ? null : lmtd/p.electrical_W,
      LMTD_K:lmtd,Q_fluid_W:qFluid,captureFraction:qFluid === null ? null : qFluid/p.electrical_W,
      heatBalanceResidual_W:qFluid === null ? null : qFluid-p.electrical_W,
      UA_liquid_W_K:qFluid === null || lmtd === null ? null : qFluid/lmtd,
      isothermalEffectiveness:effectiveness,reportedResistanceDiscrepancy_K_W:discrepancy,reportedResistanceArithmeticConsistent:arithmeticConsistent,
      uncertainty:null,limitation:'Assumes a single-phase heating case with an isothermal surface and constant cp. Resistances here use electrical power; liquid UA uses absorbed liquid heat. They are equivalent heat bases only when losses are negligible. Missing observables remain null. Arithmetic agreement is not field validation.'};
    for (const [key,value] of Object.entries(result)) if (typeof value === 'number') finite(value,'Derived '+key);
    return result;
  }
  function csv(result) {
    const q = x => '"'+String(x ?? '').replaceAll('"','""')+'"';
    const rows = [['point','role','flow_L_min','R_Tin_repository_K_W','R_Tin_predicted_K_W','residual_K_W','Re','status'],
      ...result.rows.map(p => [p.id,p.role,p.flow_L_min,p.observed,p.predicted,p.residual_K_W,p.reynolds,result.kind]),
      ['metadata','exponent',result.exponent,'evaluation_n',result.evaluationCount,'independent_validation_n',0,result.partitionNote]];
    for (const source of result.provenance.snapshots) rows.push(['source',source.file,source.url,'SHA-256',source.sha256,'primary_paper_verified',false,'Repository snapshot only']);
    return rows.map(r => r.map(q).join(',')).join('\n');
  }
  return {VERSION,metrics,benchmark,measurement,csv};
});
