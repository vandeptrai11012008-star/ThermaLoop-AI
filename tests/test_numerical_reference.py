"""Independent dimensional, analytical and metamorphic numerical checks."""
import json
import copy
from pathlib import Path

import numpy as np
import pytest
from scipy.linalg import expm

from research import verification as v
from research.thermal_reference import rc_network as rc,loop_1d as lp,convection as cv
from research.thermal_reference.numerics import integrate,power_signal,time_axis
from research.thermal_reference.epsilon_ntu import epsilon_ntu_counterflow

CONFIG=json.loads(v.CONFIG.read_text())
pytestmark=pytest.mark.filterwarnings("ignore::research.thermal_reference.convection.ConvectionWarning")


@pytest.fixture(params=["lumped","1d"])
def model(request):
    kind=request.param
    return kind,rc.default_params() if kind=="lumped" else v.aligned_params(20,CONFIG)


def test_power_timestamps_are_absolute_nonuniform_and_right_continuous():
    p,knots=power_signal(np.array([10.,12.]),[100,700,100],[10,10.3,12])
    assert [p(t) for t in [10,10.2,10.3,11,12]]==[100,100,700,700,100]
    assert knots==[10.3,12.]


@pytest.mark.parametrize("values",[[0,0],[1,0],[0,np.nan],[0],[0,np.inf],[[0,1]]])
def test_invalid_clocks_are_rejected(values):
    with pytest.raises(ValueError):time_axis(values)


@pytest.mark.parametrize("power,times",[([100],[0,1]),([100,-1],[0,1]),([100,np.nan],[0,1]),([100,700],[.1,.9])])
def test_bad_or_uncovered_power_samples_fail(power,times):
    with pytest.raises(ValueError):power_signal(np.array([0.,1.]),power,times)


def test_integration_clock_origin_invariance(model):
    kind,p=model;initial=v.steady_state(kind,p,100)
    simulate=rc.simulate if kind=="lumped" else lp.simulate_1d
    results=[simulate(np.array([origin,origin+1]),[100,700],p,T0=initial).y for origin in [0,10,1000]]
    for result in results[1:]:np.testing.assert_allclose(result,results[0],rtol=0,atol=1e-10)
    np.testing.assert_allclose(results[0][:,-1],initial,rtol=0,atol=1e-10)


def test_output_sampling_does_not_change_the_frozen_forcing_or_solver_path(model):
    kind,p=model;initial=v.steady_state(kind,p,100)
    simulate=rc.simulate if kind=="lumped" else lp.simulate_1d
    a=simulate([0.,2.],[100,700,700],p,T0=initial,input_times=[0,1,2])
    b=simulate(np.linspace(0,2,21),[100,700,700],p,T0=initial,input_times=[0,1,2])
    np.testing.assert_allclose(a.y[:,-1],b.y[:,-1],rtol=0,atol=1e-10)
    assert a.nfev==b.nfev


def test_input_discontinuity_is_split_not_smeared():
    p,knots=power_signal(np.linspace(0,2,21),[0,1,0],[0,1,2])
    sol=integrate(lambda t,y:[p(t)],np.linspace(0,2,21),[0],breakpoints=knots,rtol=1e-10,atol=1e-12)
    np.testing.assert_allclose(sol.y[0],np.maximum(0,sol.t-1),rtol=0,atol=1e-10)


def test_zero_power_equilibrium_and_zero_flow_domain_are_explicit(model):
    kind,p=model
    state=v.steady_state(kind,p,0)
    np.testing.assert_allclose(state,p["T_fac_in"],rtol=0,atol=1e-12)
    bad=dict(p,m_dot=0)
    with pytest.raises(ValueError,match="m_dot"):
        cv.evaluate(bad,emit_warnings=False)


def test_no_heat_rejection_has_no_unique_finite_steady_reference():
    p=rc.default_params();p["UA_hx"]=0
    with pytest.raises(ValueError,match="No unique"):
        rc.steady_state_closed_form(p,700)
    p=lp.default_params_1d();p["UA_hx_total"]=0
    with pytest.raises(ValueError,match="unique"):
        v.steady_1d(p,700)


def test_rc_analytic_reference_matches_unchanged_historical_design_temperature():
    r=rc.steady_state_closed_form(rc.default_params(),700)
    assert r["T_die"]==pytest.approx(74.11830791035723,abs=1e-10)
    assert r["epsilon"]==pytest.approx(.8215411783257714,abs=1e-12)
    assert r["convection"]["operating"]["regime"]=="unknown"


def test_instantaneous_energy_storage_closes_at_non_equilibrium(model):
    kind,p=model;rhs,weights=v.system(kind,p)
    rng=np.random.default_rng(20261026)
    state=rng.uniform(30,80,len(weights));power=350.
    derivative=rhs(0,state,lambda t:power)
    supplied=power*p["n_gpus"]
    rejected=p["m_dot_fac"]*p["cp_water"]*(state[-1]-p["T_fac_in"])
    terms=weights*derivative
    budget=64*len(weights)*np.finfo(float).eps*max(1,abs(supplied)+abs(rejected)+sum(abs(terms)))
    assert abs(supplied-rejected-sum(terms))<=budget
    assert abs(sum(terms))>1  # A steady-state-only check would be wrong here.


def test_steady_recurrence_matches_cell_equations_and_cdu_epsilon():
    for cells in [10,20,40,80]:
        p=v.aligned_params(cells,CONFIG);state=v.steady_1d(p,700);rhs,_=v.system("1d",p)
        np.testing.assert_allclose(rhs(0,state,lambda t:700.),0,rtol=0,atol=1e-9)
        g=p["geom"];loop=state[3:-1];C=p["m_dot"]*p["cp_water"]
        Tin=loop[g["idx_cdu"][0]-1];Tout=loop[g["idx_cdu"][-1]]
        eps=(Tin-Tout)/(Tin-p["T_fac_in"])
        expected=1-(1+p["UA_hx_total"]/(g["N_cdu"]*C))**(-g["N_cdu"])
        assert eps==pytest.approx(expected,abs=1e-12)
        assert C*(Tin-Tout)==pytest.approx(5600,abs=1e-8)
        assert 0<=eps<=1
        assert p["UA_hx_total"]/C>1  # NTU is a different quantity.


def test_matrix_generator_matches_original_rhs_after_scaling(model):
    kind,p=model;rhs,weights=v.system(kind,p)
    initial=np.linspace(31,61,len(weights));G=v.linear_generator(kind,p,700)
    z=np.r_[(initial-p["T_fac_in"])/v.TEMPERATURE_SCALE,0.,0.,1.]
    dz=G@z
    np.testing.assert_allclose(dz[:len(weights)]*v.TEMPERATURE_SCALE,rhs(0,initial,lambda t:700),rtol=1e-12,atol=1e-11)


def test_sparse_exponential_reference_matches_dense_exponential():
    p=rc.default_params();G=v.linear_generator("lumped",p,700)
    state=v.steady_state("lumped",p,100)
    z=np.r_[(state-p["T_fac_in"])/v.TEMPERATURE_SCALE,0.,0.,1.]
    from scipy.sparse.linalg import expm_multiply
    a=expm_multiply(G,z,traceA=float(G.diagonal().sum()))
    b=expm(G.toarray())@z
    np.testing.assert_allclose(a,b,rtol=1e-12,atol=1e-12)


def test_adaptive_solver_agrees_with_matrix_oracle_and_event_time(model):
    kind,p=model
    config=dict(CONFIG,duration_s=40,power_change_times_s=[0,10,40],power_per_gpu_W=[100,700,700])
    oracle=v.matrix_reference(kind,p,config)
    run=v.trajectory(kind,p,config,dict(max_step=.25,rtol=1e-8,atol=1e-10))
    errors=v.error_metrics(run,oracle)
    assert errors["max_trajectory_error_C"]<=CONFIG["temperature_target_C"]
    assert errors["threshold_error_s"]<=CONFIG["threshold_time_target_s"]
    balance=v.conservation(kind,p,run,config)
    assert balance["max_differential_residual_W"]<=balance["differential_roundoff_budget_W"]
    assert balance["max_integral_residual_J"]<=CONFIG["integrated_heat_relative_target"]*balance["input_energy_J"]


def test_mesh_changes_resolution_without_changing_physical_geometry_or_mass():
    for cells in CONFIG["spatial_cells"]:
        p=v.aligned_params(cells,CONFIG);g=p["geom"]
        assert g["m_cell"]*cells==pytest.approx(2.87)
        assert g["idx_cp"][0]*g["dx"]==pytest.approx(0)
        assert (g["idx_cp"][-1]+1)*g["dx"]==pytest.approx(.8)
        assert g["idx_cdu"][0]*g["dx"]==pytest.approx(1.6)
        assert (g["idx_cdu"][-1]+1)*g["dx"]==pytest.approx(2.4)
        assert p["UA_hx_total"]==2400
        assert p["A_cp"]*p["n_gpus"]==pytest.approx(.032)


def test_threshold_already_exceeded_is_reported_at_the_start_not_missing():
    p=rc.default_params()
    config=dict(CONFIG,duration_s=2,power_change_times_s=[0,2],power_per_gpu_W=[100,100],diagnostic_threshold_C=30)
    oracle=v.matrix_reference("lumped",p,config)
    run=v.trajectory("lumped",p,config,dict(max_step=.25,rtol=1e-8,atol=1e-10))
    assert oracle["threshold_s"]==0
    assert run["threshold_s"]==0


def test_no_threshold_crossing_is_null_in_both_solutions():
    p=rc.default_params()
    config=dict(CONFIG,duration_s=2,power_change_times_s=[0,2],power_per_gpu_W=[100,100],diagnostic_threshold_C=100)
    assert v.matrix_reference("lumped",p,config)["threshold_s"] is None
    assert v.trajectory("lumped",p,config,dict(max_step=.25,rtol=1e-8,atol=1e-10))["threshold_s"] is None


@pytest.mark.parametrize("mhot,mcold,cp,ua",[(-1,.48,4186,2400),(.24,.48,-1,2400),(.24,.48,4186,-1),(.24,.48,np.nan,2400)])
def test_invalid_heat_exchanger_inputs_are_rejected(mhot,mcold,cp,ua):
    with pytest.raises(ValueError):epsilon_ntu_counterflow(mhot,mcold,cp,cp,ua)


def test_nearly_equal_capacity_rates_use_exact_counterflow_not_a_broad_limit_approximation():
    # Ch=0.9995 W/K, Cc=1 W/K, NTU=2. The Cr=1 limit is not exact here.
    cr=.9995;ntu=2.
    numerator=-np.expm1(-ntu*(1-cr))
    expected=numerator/((1-cr)+cr*numerator)
    actual,_=epsilon_ntu_counterflow(cr,1.,1.,1.,ntu*cr)
    assert actual==pytest.approx(expected,abs=1e-12)


@pytest.mark.parametrize("power",[-1,np.nan,np.inf])
def test_unphysical_constant_power_is_rejected_in_analytical_references(power):
    with pytest.raises(ValueError):rc.steady_state_closed_form(rc.default_params(),power)
    with pytest.raises(ValueError):v.steady_1d(lp.default_params_1d(),power)


@pytest.mark.parametrize("quantity",["heat","threshold","CDU"])
def test_reproduction_check_detects_stale_quantities_even_when_temperatures_match(quantity):
    from scripts.run_numerical_verification import compare_runs
    original=json.loads((Path(__file__).parents[1]/"science/numerical/results.json").read_text())
    changed=copy.deepcopy(original)
    if quantity=="heat":changed["models"]["lumped"]["energy"]["final_rejected_energy_J"]+=100
    elif quantity=="threshold":changed["models"]["lumped"]["reference"]["threshold_crossing_s"]+=1
    else:changed["CDU"]["NTU"]+=.01
    with pytest.raises(ValueError):compare_runs(original,changed)


def test_reproduction_rejects_a_mismatched_artifact_schema():
    from scripts.run_numerical_verification import compare_runs
    original=json.loads((Path(__file__).parents[1]/"science/numerical/results.json").read_text())
    changed=copy.deepcopy(original);changed["schemaVersion"]=-1
    with pytest.raises(ValueError,match="schema"):compare_runs(original,changed)
