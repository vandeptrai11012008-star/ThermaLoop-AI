"""Declared physical-law and independent-solution checks; no experimental claims."""
import hashlib
import json
from pathlib import Path
import platform
import warnings

import numpy as np
import scipy

from .counterflow import Model, parameters, cdu_steady, simulate, exponential_reference
from research import verification as original
from research.thermal_reference import loop_1d as legacy

ROOT=Path(__file__).resolve().parents[1]


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def fingerprints():
    files=[*sorted((ROOT/"physics").glob("*.py")),ROOT/"physics/protocol.json",ROOT/"scripts/run_physics_verification.py",ROOT/"requirements-research.txt",
           ROOT/"science/physics/sources.json",ROOT/"science/physics/epsilon_ntuZ-upstream.mo",
           ROOT/"research/verification.py",ROOT/"research/thermal_reference/SOURCE_MANIFEST.json",
           *sorted((ROOT/"research/thermal_reference").glob("*.py"))]
    return {str(p.relative_to(ROOT)):sha(p.read_bytes()) for p in files}


def steady_record(m,power):
    p=m.p;state=m.steady(power);g=p["geom"];sec=state[3:3+m.n];pri=state[3+m.n:-1]
    hs,cs=cdu_steady(1,0,m.ch,m.cc,p["UA_hx_total"],m.m)
    effective=m.ch*(1-hs[-1])/min(m.ch,m.cc)
    continuum=m.continuum(power)
    return {"T_die_C":float(state[0]),"legacy_fixed_sink_die_C":float(original.steady_1d(p,power)[0]),
            "continuum":continuum,"discretization_error_C":float(abs(state[0]-continuum["T_die_C"])),
            "CDU_secondary_inlet_C":float(sec[g["idx_cdu"][0]-1]),"CDU_secondary_outlet_C":float(sec[g["idx_cdu"][-1]]),
            "CDU_primary_inlet_C":p["T_fac_in"],"CDU_primary_outlet_C":float(pri[0]),
            "return_buffer_C":float(state[-1]),"CDU_effectiveness_discrete":float(effective),
            "hot_capacity_W_K":m.ch,"primary_capacity_W_K":m.cc,"heat_rejected_W":float(m.rejected(state)),
            "max_steady_rate_K_s":float(np.max(np.abs(m.rates(state,power)))),
            "interfacial_entropy_generation_W_K":m.exchange_entropy(state)}


def energy_record(m,run,powers,input_times):
    from research.thermal_reference.numerics import power_signal
    power,_=power_signal(run["t"],powers,input_times)
    stored=m.weights@(run["temperatures"]-run["temperatures"][:,[0]])
    residual=run["input_J"]-run["rejected_J"]-stored
    rates=[];ratios=[];entropy=[]
    for i,t in enumerate(run["t"]):
        state=run["temperatures"][:,i];derivative=m.rates(state,power(t));pin=power(t)*m.p["n_gpus"];out=m.rejected(state)
        imbalance=abs(pin-out-float(m.weights@derivative))
        scale=max(1.,abs(pin)+abs(out)+float(np.sum(abs(m.weights*derivative))))
        budget=64*m.size*np.finfo(float).eps*scale
        rates.append(imbalance);ratios.append(imbalance/budget);entropy.append(m.exchange_entropy(state))
    supplied=float(run["input_J"][-1])
    return {"boundary":"Solids + closed secondary loop + finite primary CDU liquid + primary return buffer. External heat = primary enthalpy flow at return-buffer outlet relative to prescribed supply; signed, may be negative.",
            "input_J":supplied,"rejected_J":float(run["rejected_J"][-1]),"stored_change_J":float(stored[-1]),
            "max_integral_residual_J":float(np.max(abs(residual))),"relative_integral_residual":None if supplied==0 else float(np.max(abs(residual)))/supplied,
            "max_differential_residual_W":max(rates),"max_roundoff_budget_ratio":max(ratios),
            "min_interfacial_entropy_generation_W_K":min(entropy),"entropy_scope":"Only interfacial conductive exchange; not a whole-system entropy balance"}


def case(config,flow,volume=None,with_legacy=True):
    m=Model(parameters(config,primary_flow=flow,primary_volume=volume));p=m.p
    times=np.linspace(0,config["duration_s"],int(round(config["duration_s"]/config["output_spacing_s"]))+1)
    powers=config["power_per_gpu_W"];knots=config["power_times_s"]
    run=simulate(m,times,powers,knots,config["solver"])
    ref=exponential_reference(m,times,powers,knots)
    old_curve=None
    if with_legacy:
        with warnings.catch_warnings():
            warnings.simplefilter("ignore")
            old_run=legacy.simulate_1d(times,powers,p,T0=original.steady_1d(p,powers[0]),input_times=knots,**config["solver"])
        old_curve=old_run.y[0].tolist()
    return {"primary_flow_kg_s":float(flow),"primary_volume_m3":p["primary_volume_m3"],
            "cells":m.n,"primary_cells":m.m,"state_count":m.size,
            "steady":steady_record(m,config["steady_power_per_gpu_W"]),
            "energy":energy_record(m,run,powers,knots),"convection":m.convection,
            "solver":{"controls":config["solver"],"evaluations":run["evaluations"],
                      "max_all_state_error_C":float(np.max(abs(run["temperatures"]-ref["temperatures"]))),
                      "max_integrated_heat_error_J":float(np.max(abs(run["rejected_J"]-ref["rejected_J"])))},
            "peak_die_C":float(np.max(run["temperatures"][0])),
            "trace":{"time_s":times.tolist(),"die_C":run["temperatures"][0].tolist(),"legacy_die_C":old_curve,
                     "primary_CDU_out_C":run["temperatures"][3+m.n].tolist(),"primary_return_buffer_C":run["temperatures"][-1].tolist()},
            "initialization":"Each model starts from its own 100 W/GPU steady equilibrium; same prescribed power trace, different CDU boundary/primary storage"}


def run_suite():
    config=json.loads((ROOT/"physics/protocol.json").read_text())
    sources=json.loads((ROOT/"science/physics/sources.json").read_text())
    for s in sources:
        raw=(ROOT/"science/physics"/s["id"]).read_bytes()
        if len(raw)!=s["bytes"] or sha(raw)!=s["sha256"]:raise ValueError("Theoretical source snapshot differs: "+s["id"])
    cases=[case(config,flow) for flow in config["primary_flows_kg_s"]]
    sensitivity=[case(config,config["primary_design_flow_kg_s"],volume,with_legacy=False) for volume in config["primary_volume_sensitivity_m3"]]
    spatial=[]
    for cells in config["spatial_cells"]:
        m=Model(parameters(config,cells));r=steady_record(m,config["steady_power_per_gpu_W"])
        spatial.append({"cells":cells,"primary_cells":m.m,**r})
    accepted=[r["cells"] for r in spatial if r["discretization_error_C"]<=config["steady_discretization_target_C"]]
    gates={"conservative_energy":all(c["energy"]["max_roundoff_budget_ratio"]<=1 for c in cases+sensitivity),
           "integrated_energy":all(c["energy"]["relative_integral_residual"]<=config["relative_integral_energy_target"] for c in cases+sensitivity),
           "independent_time_solution":all(c["solver"]["max_all_state_error_C"]<=config["temporal_temperature_target_C"] for c in cases+sensitivity),
           "independent_heat_integral":all(c["solver"]["max_integrated_heat_error_J"]<=config["relative_integral_energy_target"]*c["energy"]["input_J"] for c in cases+sensitivity),
           "steady_spatial_target":bool(accepted),
           "bounded_CDU_effectiveness":all(0<c["steady"]["CDU_effectiveness_discrete"]<1 for c in cases),
           "sampled_interfacial_entropy_nonnegative":all(c["energy"]["min_interfacial_entropy_generation_W_K"]>=0 for c in cases),
           "primary_storage_does_not_change_steady":max(c["steady"]["T_die_C"] for c in sensitivity)-min(c["steady"]["T_die_C"] for c in sensitivity)<1e-10}
    example=Model(parameters(config));p=example.p
    return {"schemaVersion":1,"kind":config["kind"],"protocol":config,"sources":sources,"sourceHashes":fingerprints(),
            "environment":{"python":platform.python_version(),"numpy":np.__version__,"scipy":scipy.__version__},
            "parameters":{k:v for k,v in p.items() if k!="geom"},
            "geometry":{"secondary_volume_m3":.00287,"loop_length_m":4,"source_interval_m":[0,.8],"CDU_interval_m":[1.6,2.4],"status":"Declared reference discretization, not measured channel geometry"},
            "cases":cases,"primary_volume_sensitivity":sensitivity,"spatial":spatial,"first_grid_meeting_target":min(accepted) if accepted else None,"gates":gates,
            "measured_prediction_MAE_C":None,
            "limitations":["No independent experimental validation or field savings. New temperatures are predictions, not measurements.",
                "Cold-plate h0, conductive resistances, capacitances, UA and equal GPU/channel distribution remain reference assumptions; channel regime is unknown.",
                "UA and fluid properties are held constant across the primary-flow sweep; this is not a calibrated off-design exchanger curve.",
                "Primary liquid hold-up is an explicit unmeasured 1 L example; volume sensitivity is not a probability/confidence interval.",
                "Negligible wall heat capacity, fixed supply and ideal 1D upwind mixing. No pressure drop/pump-flow solve, phase change, axial conduction, CFD, hardware control or 3D validation.",
                "Reported 80-cell transient/steady predictions retain spatial error; the 0.05 C target applies to a separate declared steady refinement case.",
                "Theoretical source documents equations; Modelica is not executed. Its near-equal capacity smoothing is not copied: the exact Cr=1 limit is used here."]}
