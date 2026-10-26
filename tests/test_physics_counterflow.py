"""Physical-law, analytical-limit and off-design checks for the coupled CDU."""
import json
from pathlib import Path

import numpy as np
import pytest

from physics.counterflow import Model, parameters, cdu_steady, simulate, exponential_reference
from research import verification as legacy_check
from research.thermal_reference import loop_1d as old

CONFIG=json.loads((Path(__file__).resolve().parents[1]/"physics/protocol.json").read_text())


def model(cells=20,flow=.48,volume=.001):
    return Model(parameters(CONFIG,cells,flow,volume))


@pytest.mark.parametrize("ch,cc",[(1000,1000),(1000,2000),(2000,500)])
def test_independent_component_conserves_both_enthalpy_flows_and_inlet_bounds(ch,cc):
    hot,cold=cdu_steady(60,25,ch,cc,2400,20)
    qh=ch*(60-hot[-1]);qc=cc*(cold[0]-25)
    assert qh==pytest.approx(qc,rel=1e-12)
    assert np.all(hot>=25) and np.all(hot<=60)
    assert np.all(cold>=25) and np.all(cold<=60)
    assert np.all(hot>=cold)  # Co-located cells, not non-colocated outlet temperatures.


def test_equal_capacity_exact_discrete_solution_and_continuum_limit():
    ntu=2.4
    for cells in [1,4,20,100]:
        hot,cold=cdu_steady(1,0,1000,1000,2400,cells)
        assert 1-hot[-1]==pytest.approx(ntu/(1+ntu+ntu/cells),abs=2e-13)
    m=model(flow=.24)
    assert m.continuum(700)["effectiveness"]==pytest.approx((2400/m.ch)/(1+2400/m.ch))


def test_reverse_temperature_drive_reverses_heat_without_clipping():
    h,c=cdu_steady(20,40,1000,2000,2400,8)
    assert h[-1]>20 and c[0]<40
    assert 1000*(20-h[-1])==pytest.approx(2000*(c[0]-40),rel=1e-12)


@pytest.mark.parametrize("flow",[.06,.24,.48,.96])
def test_full_steady_matches_conservative_rhs_and_facility_enthalpy(flow):
    m=model(flow=flow);state=m.steady(700)
    np.testing.assert_allclose(m.rates(state,700),0,atol=2e-10,rtol=0)
    assert m.rejected(state)==pytest.approx(5600,abs=1e-9)
    assert state[3+m.n]==pytest.approx(30+5600/m.cc,abs=1e-9)


def test_arbitrary_nonequilibrium_states_satisfy_first_law_including_primary_storage():
    rng=np.random.default_rng(20261026);m=model()
    for _ in range(12):
        t=30+rng.uniform(-10,30,m.size);p=float(rng.uniform(0,900))
        assert m.weights@m.rates(t,p)==pytest.approx(p*8-m.rejected(t),abs=1e-9)
        assert m.exchange_entropy(t)>=0


def test_primary_storage_is_explicit_and_not_borrowed_from_secondary_liquid():
    a,b=model(volume=.00025),model(volume=.004)
    np.testing.assert_array_equal(a.weights[:3+a.n],b.weights[:3+b.n])
    assert b.weights[3+b.n:-1].sum()/a.weights[3+a.n:-1].sum()==16
    np.testing.assert_allclose(a.steady(700),b.steady(700),rtol=0,atol=0)
    t=np.full(a.size,30.);t[3+a.p["geom"]["idx_cdu"]]=50
    da,db=a.rates(t,0),b.rates(t,0)
    np.testing.assert_allclose(da[3+a.n:-1],db[3+b.n:-1]*16,atol=1e-12)


def test_reduced_UA_raises_steady_die_temperature_without_changing_supplied_heat():
    base=model();p=parameters(CONFIG,20);p["UA_hx_total"]*=.5;fouled=Model(p)
    a,b=base.steady(700),fouled.steady(700)
    assert b[0]>a[0]
    assert base.rejected(a)==pytest.approx(fouled.rejected(b),abs=1e-8)


def test_warm_facility_can_supply_energy_with_zero_injected_GPU_heat():
    from physics.verification import energy_record
    m=model();times=np.linspace(0,2,9)
    r=simulate(m,times,[0,0],[0,2],CONFIG["solver"],initial=np.full(m.size,20.))
    e=energy_record(m,r,[0,0],[0,2])
    assert e["input_J"]==0 and e["relative_integral_residual"] is None
    assert e["rejected_J"]<0 and e["stored_change_J"]>0
    assert abs(e["rejected_J"]+e["stored_change_J"])<1e-6


def test_facility_flow_changes_secondary_prediction_while_legacy_sink_does_not():
    low,high=model(flow=.06),model(flow=.96)
    assert low.steady(700)[0]>high.steady(700)[0]+10
    old_low=legacy_check.steady_1d(low.p,700)[0]
    old_high=legacy_check.steady_1d(high.p,700)[0]
    assert old_low==old_high


def test_infinite_primary_capacity_recovers_same_mesh_legacy_fixed_sink():
    m=model(flow=1e9);state=m.steady(700)
    expected=legacy_check.steady_1d(m.p,700)
    np.testing.assert_allclose(state[:3+m.n],expected[:3+m.n],atol=1e-8,rtol=0)


def test_zero_power_uniform_equilibrium_and_zero_UA_unavailable_steady_state():
    m=model();np.testing.assert_allclose(m.steady(0),30,atol=1e-12)
    np.testing.assert_array_equal(m.rates(np.full(m.size,30.),0),0)
    p=parameters(CONFIG,20);p["UA_hx_total"]=0;m=Model(p)
    with pytest.raises(ValueError,match="unique"):m.steady(700)
    t=np.full(m.size,30.);assert m.weights@m.rates(t,700)==pytest.approx(5600)


@pytest.mark.parametrize("key,value",[("m_dot_fac",0),("m_dot",-1),("primary_volume_m3",0),("primary_volume_m3",np.nan),("primary_cp",np.inf),("UA_hx_total",-1),("C_fac",-1)])
def test_invalid_or_missing_physical_inputs_are_not_inferred(key,value):
    p=parameters(CONFIG,20);p[key]=value
    with pytest.raises(ValueError):Model(p)
    p=parameters(CONFIG,20);del p["primary_volume_m3"]
    with pytest.raises(ValueError,match="explicitly"):Model(p)


def test_invalid_topology_is_rejected_before_wrong_steady_recurrence():
    p=parameters(CONFIG,20);p["geom"]["idx_cp"]=np.array([0,1,2,18])
    with pytest.raises(ValueError,match="topology"):Model(p)


def test_coupled_transient_matches_independent_exponential_and_energy_integrals():
    m=model();times=np.linspace(0,20,81);powers=[100,700,100];knots=[0,5,20]
    r=simulate(m,times,powers,knots,CONFIG["solver"])
    e=exponential_reference(m,times,powers,knots)
    np.testing.assert_allclose(r["temperatures"],e["temperatures"],atol=1e-4,rtol=0)
    np.testing.assert_allclose(r["rejected_J"],e["rejected_J"],atol=1e-3,rtol=0)
    stored=m.weights@(r["temperatures"]-r["temperatures"][:,[0]])
    np.testing.assert_allclose(r["input_J"]-r["rejected_J"],stored,atol=1e-5,rtol=0)


def test_exponential_check_cannot_silently_smear_unaligned_changes():
    with pytest.raises(ValueError,match="discontinuity"):
        exponential_reference(model(),[0,1,2],[100,700,100],[0,.1,2])


@pytest.mark.parametrize("algorithm",["adaptive","exponential"])
def test_default_equilibrium_uses_power_at_output_start_not_first_input_sample(algorithm):
    m=model();times=[10.,10.25,10.5];powers=[100,700,700];knots=[0,5,20]
    if algorithm=="adaptive":r=simulate(m,times,powers,knots,CONFIG["solver"])
    else:r=exponential_reference(m,times,powers,knots)
    np.testing.assert_allclose(r["temperatures"],np.repeat(m.steady(700)[:,None],3,axis=1),atol=1e-9,rtol=0)


def test_adaptive_callable_power_initialization_uses_actual_start_time():
    m=model();r=simulate(m,[10,10.25],lambda t:700.,None,CONFIG["solver"])
    np.testing.assert_allclose(r["temperatures"],np.repeat(m.steady(700)[:,None],2,axis=1),atol=1e-9,rtol=0)


def test_matrix_reference_rejects_callable_forcing_without_certified_constant_segments():
    with pytest.raises(ValueError,match="sampled"):
        exponential_reference(model(),[0,.25,.5],lambda t:100+40*t,None)


def test_interfacial_entropy_uses_kelvin_and_reverse_flux_keeps_nonnegative_production():
    m=model();t=np.full(m.size,20.);t[3+m.n:-1]=40
    assert m.exchange_entropy(t)>0
    assert (m.rates(t,0)[3+m.p["geom"]["idx_cdu"]]>0).all()
    with pytest.raises(ValueError):m.exchange_entropy(np.full(m.size,-273.15))


def test_steady_refinement_converges_to_analytical_finite_counterflow_limit():
    errors=[]
    for cells in [20,40,80,160]:
        m=model(cells=cells)
        errors.append(m.steady(700)[0]-m.continuum(700)["T_die_C"])
    assert all(e>0 for e in errors)
    assert all(1.8<a/b<2.2 for a,b in zip(errors[:-1],errors[1:]))


def test_new_model_cannot_bypass_known_convection_incompatibility():
    p=parameters(CONFIG,20)
    p.update(channel_geometry={"n_channels":120,"channel_width_m":.0002,"channel_height_m":.004,"channel_length_m":.043},
             rho_fluid=1000.,mu_fluid=.001,k_fluid=.6)
    with pytest.raises(ValueError,match="incompatible"):Model(p)


def test_continuum_agrees_with_unsmoothed_published_counterflow_equation():
    for flow in [.06,.12,.48,.96]:
        m=model(flow=flow);cmin=min(m.ch,m.cc);cr=cmin/max(m.ch,m.cc);ntu=m.p["UA_hx_total"]/cmin
        assert cr<.97  # The pinned Modelica function smooths above this range.
        e=np.exp(-ntu*(1-cr));expected=(1-e)/(1-cr*e)
        assert m.continuum(700)["effectiveness"]==pytest.approx(expected,abs=1e-14)


@pytest.mark.parametrize("path",["heat","entropy","temperature"])
def test_saved_result_corruption_is_rejected_without_changing_metadata(path):
    from scripts.run_physics_verification import compare
    import copy
    saved=json.loads((Path(__file__).resolve().parents[1]/"science/physics/results.json").read_text())
    changed=copy.deepcopy(saved)
    if path=="heat":changed["cases"][0]["energy"]["rejected_J"]+=1
    elif path=="entropy":changed["cases"][0]["energy"]["min_interfacial_entropy_generation_W_K"]=-1
    else:changed["cases"][0]["trace"]["die_C"][1]+=.01
    with pytest.raises(ValueError,match="reproduction"):compare(changed,saved)
