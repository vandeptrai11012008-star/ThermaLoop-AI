"""Offline, fixed-property linear thermal verification (never experimental data)."""
import hashlib
import importlib.metadata
import json
from pathlib import Path
import platform
import warnings

import numpy as np
from scipy import sparse
from scipy.optimize import brentq
from scipy.sparse.linalg import expm_multiply

from .thermal_reference import rc_network as rc, loop_1d as lp, convection as cv
from .thermal_reference.numerics import integrate, power_signal

ROOT = Path(__file__).resolve().parents[1]
CONFIG = ROOT / "research/verification-config.json"
TEMPERATURE_SCALE = 100.0
ENERGY_SCALE = 1e6


def aligned_params(cells, config):
    """Keep source/sink intervals, liquid mass, wetted area and total UA fixed."""
    g = lp.make_loop_geometry(N=cells,L_loop=config["loop_length_m"],V_loop=config["loop_volume_m3"])
    dx = config["loop_length_m"] / cells
    def zone(interval):
        bounds = np.asarray(interval)/dx
        if not np.allclose(bounds,np.round(bounds),atol=1e-10,rtol=0):
            raise ValueError("Verification meshes must align exactly with physical zone boundaries")
        return np.arange(int(round(bounds[0])),int(round(bounds[1])))
    g["idx_cp"],g["idx_cdu"] = zone(config["cp_interval_m"]),zone(config["cdu_interval_m"])
    g["N_cp"],g["N_cdu"] = len(g["idx_cp"]),len(g["idx_cdu"])
    return lp.default_params_1d(geom=g)


def system(kind, params):
    if kind == "lumped":
        weights = np.array([params[k] for k in ["C_die","C_ihs","C_cp","C_loop","C_fac"]])
        raw = rc.odes
    elif kind == "1d":
        g = params["geom"]
        weights = np.r_[[params[k] for k in ["C_die","C_ihs","C_cp"]],
                        np.full(g["N"],g["m_cell"]*params["cp_water"]),params["C_fac"]]
        raw = lp.thermal_odes_1d
    else:
        raise ValueError("Unknown reference model")
    return lambda t,y,power:np.asarray(raw(t,y,power,params)),weights


def steady_1d(params, power):
    """Independent steady recurrence for these same finite-volume equations."""
    if not np.isscalar(power) or not np.isfinite(power) or power<0:
        raise ValueError("Constant electrical power must be finite and nonnegative")
    g = params["geom"]; c = params["m_dot"]*params["cp_water"]
    h = cv.evaluate(params,emit_warnings=False)["h_W_m2K"]*params["A_cp"]*params["n_gpus"]
    ua = params["UA_hx_total"]
    if min(c,h,ua) <= 0:
        raise ValueError("A unique rejected-heat steady state needs positive flow, hA and UA")
    cp_attenuation = -g["N_cp"]*np.log1p(h/(g["N_cp"]*c))
    cdu_attenuation = -g["N_cdu"]*np.log1p(ua/(g["N_cdu"]*c))
    rise = power*params["n_gpus"]/c
    cold = params["T_fac_in"] + np.exp(cdu_attenuation)*rise/(-np.expm1(cdu_attenuation))
    plate = cold + rise/(-np.expm1(cp_attenuation))
    profile = np.empty(g["N"]); value = cold
    cp_cells,cdu_cells = set(g["idx_cp"]),set(g["idx_cdu"])
    for i in range(g["N"]):
        if i in cp_cells:
            value = (c*value + h/g["N_cp"]*plate)/(c+h/g["N_cp"])
        elif i in cdu_cells:
            value = (c*value + ua/g["N_cdu"]*params["T_fac_in"])/(c+ua/g["N_cdu"])
        profile[i] = value
    ihs = plate + power*params["R_ihs_cp"]
    die = ihs + power*params["R_j_ihs"]
    facility = params["T_fac_in"]+power*params["n_gpus"]/(params["m_dot_fac"]*params["cp_water"])
    return np.r_[die,ihs,plate,profile,facility]


def steady_state(kind,params,power):
    if kind == "1d":
        return steady_1d(params,power)
    r = rc.steady_state_closed_form(params,power)
    return np.array([r[k] for k in ["T_die","T_ihs","T_coldplate","T_loop"]]+
                    [params["T_fac_in"]+power*params["n_gpus"]/(params["m_dot_fac"]*params["cp_water"])])


def output_times(config):
    return np.linspace(0,config["duration_s"],int(round(config["duration_s"]/config["output_spacing_s"]))+1)


def augmented_rhs(kind,params,power):
    rhs,weights = system(kind,params)
    def augmented(t,y):
        thermal = y[:-2]
        rejected = params["m_dot_fac"]*params["cp_water"]*(thermal[-1]-params["T_fac_in"])
        return np.r_[rhs(t,thermal,power),rejected/ENERGY_SCALE,power(t)*params["n_gpus"]/ENERGY_SCALE]
    return augmented,weights


def trajectory(kind,params,config,controls,initial=None):
    t = output_times(config)
    power,changes = power_signal(t,config["power_per_gpu_W"],config["power_change_times_s"])
    if initial is None:
        initial = steady_state(kind,params,config["power_per_gpu_W"][0])
    rhs,_ = augmented_rhs(kind,params,power)
    def crossing(now,state):
        return state[0]-config["diagnostic_threshold_C"]
    crossing.direction = 1
    sol = integrate(rhs,t,np.r_[initial,0.,0.],breakpoints=changes,events=crossing,**controls)
    first = float(t[0]) if initial[0]>=config["diagnostic_threshold_C"] else float(sol.t_events[0][0]) if len(sol.t_events[0]) else None
    return {"t":t,"temperatures":sol.y[:-2],"E_out_J":sol.y[-2]*ENERGY_SCALE,
            "E_in_J":sol.y[-1]*ENERGY_SCALE,"threshold_s":first,
            "controls":controls,"evaluations":sol.nfev}


def linear_generator(kind,params,power):
    """Matrix representation from the same RHS; a different solution algorithm.

    Temperatures are offset/scaled and energy integrals normalized to avoid
    an ill-scaled augmented matrix. This is not a second physical model.
    """
    rhs,weights = system(kind,params); n = len(weights)
    origin = np.full(n,params["T_fac_in"])
    zero = lambda t:0.
    A = np.column_stack([rhs(0,origin+np.eye(1,n,i)[0],zero) for i in range(n)])
    A = sparse.csc_matrix(A)
    forcing = rhs(0,origin,lambda t:power)/TEMPERATURE_SCALE
    q = np.zeros(n);q[-1] = params["m_dot_fac"]*params["cp_water"]*TEMPERATURE_SCALE/ENERGY_SCALE
    top=sparse.hstack([A,sparse.csc_matrix((n,2)),sparse.csc_matrix(forcing[:,None])])
    out=sparse.hstack([sparse.csc_matrix(q[None,:]),sparse.csc_matrix((1,3))])
    supplied=sparse.csc_matrix(([power*params["n_gpus"]/ENERGY_SCALE],([0],[n+2])),shape=(1,n+3))
    return sparse.vstack([top,out,supplied,sparse.csc_matrix((1,n+3))],format="csc")


def matrix_reference(kind,params,config,initial=None):
    """Sparse exponential propagation of fixed-flow linear equations at steps."""
    t = output_times(config);_,weights = system(kind,params);n=len(weights)
    if initial is None:
        initial=steady_state(kind,params,config["power_per_gpu_W"][0])
    state=np.r_[(np.asarray(initial)-params["T_fac_in"])/TEMPERATURE_SCALE,0.,0.,1.]
    result=np.empty((n+3,len(t)))
    crossing=float(t[0]) if initial[0]>=config["diagnostic_threshold_C"] else None
    knots=config["power_change_times_s"];powers=config["power_per_gpu_W"]
    for a,b,power in zip(knots[:-1],knots[1:],powers[:-1]):
        mask=(t>=a)&(t<=b);local=t[mask]-a
        if len(local)<2 or not np.allclose(local,np.linspace(0,b-a,len(local)),atol=1e-10,rtol=0):
            raise ValueError("Matrix reference requires the declared common output grid aligned with input steps")
        G=linear_generator(kind,params,power);trace=float(G.diagonal().sum())
        values=expm_multiply(G,state,start=0,stop=b-a,num=len(local),endpoint=True,traceA=trace)
        result[:,mask]=values.T
        die=params["T_fac_in"]+values[:,0]*TEMPERATURE_SCALE
        if crossing is None:
            indices=np.flatnonzero((die[:-1]<config["diagnostic_threshold_C"])&(die[1:]>=config["diagnostic_threshold_C"]))
            if len(indices):
                i=int(indices[0]);initial_segment=state.copy()
                def event(s):
                    v=expm_multiply(G*s,initial_segment,traceA=trace*s)
                    return params["T_fac_in"]+v[0]*TEMPERATURE_SCALE-config["diagnostic_threshold_C"]
                crossing=float(a+brentq(event,local[i],local[i+1],xtol=1e-12))
        state=values[-1]
    return {"t":t,"temperatures":params["T_fac_in"]+result[:n]*TEMPERATURE_SCALE,
            "E_out_J":result[n]*ENERGY_SCALE,"E_in_J":result[n+1]*ENERGY_SCALE,
            "threshold_s":crossing,"method":"Sparse matrix exponential of the same linear equations; independent integration algorithm"}


def quantities(run):
    die=run["temperatures"][0];i=int(np.argmax(die))
    return {"peak_temperature_C":float(die[i]),"final_temperature_C":float(die[-1]),
            "sampled_time_to_peak_s":float(run["t"][i]),"threshold_crossing_s":run["threshold_s"],
            "integrated_external_heat_J":float(run["E_out_J"][-1])}


def error_metrics(run,reference):
    q=quantities(run);r=quantities(reference)
    return dict(**q,max_trajectory_error_C=float(np.max(np.abs(run["temperatures"][0]-reference["temperatures"][0]))),
                peak_temperature_error_C=abs(q["peak_temperature_C"]-r["peak_temperature_C"]),
                final_temperature_error_C=abs(q["final_temperature_C"]-r["final_temperature_C"]),
                threshold_error_s=None if q["threshold_crossing_s"] is None or r["threshold_crossing_s"] is None else abs(q["threshold_crossing_s"]-r["threshold_crossing_s"]),
                integrated_heat_error_J=abs(q["integrated_external_heat_J"]-r["integrated_external_heat_J"]))


def conservation(kind,params,run,config):
    _,weights=system(kind,params)
    stored=weights @ (run["temperatures"]-run["temperatures"][:,[0]])
    integral=run["E_in_J"]-run["E_out_J"]-stored
    power,_=power_signal(run["t"],config["power_per_gpu_W"],config["power_change_times_s"])
    rhs,_=augmented_rhs(kind,params,power)
    residuals=[];roundoff=[];storage_rates=[]
    for i,t in enumerate(run["t"]):
        state=np.r_[run["temperatures"][:,i],0.,0.]
        derivative=rhs(t,state)
        storage_rate=float(weights @ derivative[:-2])
        pin=power(t)*params["n_gpus"];pout=derivative[-2]*ENERGY_SCALE
        residuals.append(abs(pin-pout-storage_rate));storage_rates.append(abs(storage_rate))
        scale=max(1.,abs(pin)+abs(pout)+float(np.sum(np.abs(weights*derivative[:-2]))))
        roundoff.append(64*len(weights)*np.finfo(float).eps*scale)
    input_total=float(run["E_in_J"][-1])
    return {"boundary":"Whole modeled system including facility-return storage; external heat is facility outlet enthalpy flow",
            "max_differential_residual_W":max(residuals),"differential_roundoff_budget_W":max(roundoff),
            "max_residual_to_roundoff_budget_ratio":max(r/b for r,b in zip(residuals,roundoff)),
            "max_integral_residual_J":float(np.max(np.abs(integral))),
            "max_integral_residual_pct_of_input":None if input_total==0 else float(np.max(np.abs(integral)))/input_total*100,
            "max_transient_storage_rate_W":max(storage_rates),"input_energy_J":input_total,
            "final_rejected_energy_J":float(run["E_out_J"][-1]),"final_stored_energy_change_J":float(stored[-1])}


def clock_probe(kind,params):
    initial=steady_state(kind,params,100)
    simulate=rc.simulate if kind=="lumped" else lp.simulate_1d
    outcomes=[]
    for origin in [0.,10.,1000.]:
        sol=simulate(np.array([origin,origin+1]),np.array([100.,700.]),params,T0=initial)
        outcomes.append(float(sol.y[0,-1]))
    rhs,_=system(kind,params)
    before=[]
    for origin in [0.,10.]:
        def legacy_power(t):
            return [100.,700.][min(int(t),1)]
        sol=integrate(lambda t,y:rhs(t,y,legacy_power),[origin,origin+1],initial)
        before.append(float(sol.y[0,-1]))
    return {"model":kind,"clock_origins_s":[0,10,1000],"corrected_final_temperatures_C":outcomes,
            "corrected_max_difference_C":max(outcomes)-min(outcomes),
            "legacy_difference_C":abs(before[1]-before[0]),
            "scope":"Synthetic identical sampled inputs and initial state shifted together; not a measured temperature improvement"}


def spatial_study(config):
    rows=[];previous=None
    for cells in config["spatial_cells"]:
        power=config["steady_power_per_gpu_W"]
        p=aligned_params(cells,config);state=steady_1d(p,power);c=p["m_dot"]*p["cp_water"]
        h=cv.evaluate(p,emit_warnings=False)["h_W_m2K"]*p["A_cp"]*p["n_gpus"]
        rise=power*p["n_gpus"]/c
        cold=p["T_fac_in"]+np.exp(-p["UA_hx_total"]/c)*rise/(-np.expm1(-p["UA_hx_total"]/c))
        limit=cold+rise/(-np.expm1(-h/c))+power*(p["R_j_ihs"]+p["R_ihs_cp"])
        row={"cells":cells,"steady_temperature_C":float(state[0]),"continuum_temperature_C":float(limit),
             "steady_continuum_error_C":float(abs(state[0]-limit)),
             "liquid_mass_kg":float(p["geom"]["m_cell"]*cells),"wetted_area_m2":p["A_cp"]*p["n_gpus"],"UA_W_K":p["UA_hx_total"],
             "integrated_steady_temperature_C":None,"integrated_vs_discrete_error_C":None}
        if cells in config["integrated_steady_cells"]:
            integrated=lp.steady_state_1d(p,power)
            row.update(integrated_steady_temperature_C=float(integrated["T_die"]),
                       integrated_vs_discrete_error_C=float(abs(integrated["T_die"]-state[0])))
        transient=matrix_reference("1d",p,config,initial=np.full(cells+4,p["T_fac_in"]))
        row["transient"]=quantities(transient)
        row["transient_peak_change_C"]=None if previous is None else abs(row["transient"]["peak_temperature_C"]-previous["transient"]["peak_temperature_C"])
        row["transient_threshold_change_s"]=(None if previous is None or row["transient"]["threshold_crossing_s"] is None or previous["transient"]["threshold_crossing_s"] is None
                                               else abs(row["transient"]["threshold_crossing_s"]-previous["transient"]["threshold_crossing_s"]))
        rows.append(row);previous=row
    qualified=[r["cells"] for r in rows if r["steady_continuum_error_C"]<=config["steady_grid_target_C"]]
    return {"rows":rows,"first_steady_grid_meeting_target":min(qualified) if qualified else None,
            "steady_target_C":config["steady_grid_target_C"],
            "scope":"Fixed physical zones/mass/hA/UA. Discrete and continuum steady references are derived from the same equations. Transient inter-grid changes are not an error bound against a continuous transient solution."}


def fingerprints():
    files=[*sorted((ROOT/"research").rglob("*.py")),
           ROOT/"research/thermal_reference/SOURCE_MANIFEST.json",CONFIG,
           ROOT/"requirements-research.txt",ROOT/"scripts/run_numerical_verification.py"]
    return {str(p.relative_to(ROOT)):hashlib.sha256(p.read_bytes()).hexdigest() for p in files}


def run_suite():
    config=json.loads(CONFIG.read_text())
    if config["temporal_initialization"]!="steady_at_initial_power" or config["spatial_transient_initialization"]!="uniform_facility_temperature":
        raise ValueError("Unsupported initial-state protocol; implement and verify it explicitly")
    study={}
    with warnings.catch_warnings(record=True) as caught:
        warnings.simplefilter("once",cv.ConvectionWarning)
        for kind in ["lumped","1d"]:
            params=rc.default_params() if kind=="lumped" else aligned_params(config["temporal_model_cells"],config)
            reference=matrix_reference(kind,params,config)
            steps=[];tolerances=[]
            for step in config["solver_max_steps_s"]:
                controls=dict(max_step=step,rtol=1e-6,atol=1e-8)
                run=trajectory(kind,params,config,controls)
                steps.append(dict(**controls,**error_metrics(run,reference)))
            for tol in config["solver_relative_tolerances"]:
                controls=dict(max_step=.5,rtol=tol,atol=tol*.01)
                run=trajectory(kind,params,config,controls)
                tolerances.append(dict(**controls,**error_metrics(run,reference)))
            final=trajectory(kind,params,config,config["selected_solver"])
            study[kind]={"reference":quantities(reference),"step_limits":steps,"tolerance_levels":tolerances,
                         "parameters":{k:value for k,value in params.items() if k!="geom"},
                         "initial_condition":config["temporal_initialization"],
                         "convection":cv.evaluate(params,emit_warnings=False),
                         "energy":conservation(kind,params,final,config),"clock":clock_probe(kind,params),
                         "selected_solver_controls":final["controls"],
                         "solver_errors":error_metrics(final,reference)}
        spatial=spatial_study(config)
        p=lp.default_params_1d();nt=lp.steady_state_1d(p)
        ntu={"legacy_eps_effective":float(nt["eps_effective"]),"NTU":float(nt["cdu_ntu"]),
             "mesh_cells":int(p["geom"]["N"]),"cdu_cells":int(p["geom"]["N_cdu"]),
             "isothermal_effectiveness":float(nt["cdu_effectiveness_isothermal"]),
             "lumped_counterflow_effectiveness":float(rc.steady_state_closed_form(rc.default_params())["epsilon"]),
             "definition":"Legacy eps_effective equals UA/(mass_flow*cp), i.e. NTU. New effectiveness uses CDU inlet/outlet temperatures for the fixed-temperature sink. Different CDU boundary models are not matched by equal UA."}
    gates={
        "clock_invariance":all(s["clock"]["corrected_max_difference_C"]<=config["temperature_target_C"] for s in study.values()),
        "temporal_temperature_target":all(s["solver_errors"]["max_trajectory_error_C"]<=config["temperature_target_C"] for s in study.values()),
        "temporal_threshold_target":all((s["solver_errors"]["threshold_crossing_s"] is None if s["reference"]["threshold_crossing_s"] is None else
                                         s["solver_errors"]["threshold_error_s"] is not None and s["solver_errors"]["threshold_error_s"]<=config["threshold_time_target_s"]) for s in study.values()),
        "integrated_heat_target":all(s["solver_errors"]["integrated_heat_error_J"]<=config["integrated_heat_relative_target"]*s["energy"]["input_energy_J"] for s in study.values()),
        "integral_energy_balance":all(s["energy"]["max_integral_residual_J"]<=config["integrated_heat_relative_target"]*s["energy"]["input_energy_J"] for s in study.values()),
        "differential_energy_roundoff":all(s["energy"]["max_residual_to_roundoff_budget_ratio"]<=1 for s in study.values()),
        "steady_spatial_target":spatial["first_steady_grid_meeting_target"] is not None,
        "CDU_metric_definition":ntu["NTU"]>1 and 0<=ntu["isothermal_effectiveness"]<=1,
    }
    return {"schemaVersion":2,"kind":"Numerical verification only; no measured experimental accuracy or field calibration",
            "protocol":config,"sourceHashes":fingerprints(),
            "environment":{"python":platform.python_version(),**{k:importlib.metadata.version(k) for k in ["numpy","scipy"]}},
            "models":study,"spatial":spatial,"CDU":ntu,"gates":gates,
            "warnings":sorted({str(w.message) for w in caught}),
            "limitations":["Convection remains an empirical legacy scaling with unspecified channel geometry.",
                           "Properties are fixed; reference cases are linear and synthetic.",
                           "The lumped CDU has finite-capacity counterflow boundaries; the 1D CDU has a fixed-temperature sink.",
                           "Steady spatial error has an analytical continuum reference; transient mesh differences alone are not certified bounds.",
                           "No independent thermal/hydraulic/transient dataset or calibrated predictive interval is added.",
                           "These artifacts do not replace or validate the existing browser 3D simulation."]}
