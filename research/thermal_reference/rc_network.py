"""Lumped 5-node RC thermal network for a D2C-cooled GPU server.

State vector: [T_die, T_ihs, T_coldplate, T_loop, T_facility_return]

Historical reference output (8 GPUs, 700 W each, design flow, 30 C facility supply):
    CDU effectiveness  ~ 0.82   (Heydari et al. 2024 anchor: 0.82-0.83)
    T_die              ~ 74 C
    loop dT vs facility~ 6.8 K
    heat balance closure 100 %

See docs/VALIDATION.md and docs/ASSUMPTIONS.md.
"""
import numpy as np
from .numerics import integrate, power_signal, time_axis

from .epsilon_ntu import epsilon_ntu_counterflow
from . import convection


def default_params(n_gpus=8):
    """Reference server parameters; channel geometry/regime is unspecified."""
    return dict(
        n_gpus=n_gpus,
        # Conductive resistances (K/W per GPU); sum ~0.045 -> typical H100 R_jc
        R_j_ihs=0.025,
        R_ihs_cp=0.020,
        # Numeric 0.8 retains the legacy empirical power law; absent channel
        # geometry does NOT establish turbulent (or microchannel) flow.
        # Named flow_exponent choices and applicability: docs/NUMERICAL_VERIFICATION.md.
        h0=30000.0,            # W/m^2/K reference convection coefficient
        A_cp=0.004,            # m^2 wetted area per cold plate
        m_dot_ref=0.03,        # kg/s reference flow per GPU
        flow_exponent=0.8,     # regime-dependent; see thermal/convection.py
        # Capacitances (J/K, per server)
        C_die=5.0 * n_gpus,
        C_ihs=80.0 * n_gpus,
        C_cp=900.0 * n_gpus,
        C_loop=12000.0,
        C_fac=80000.0,
        # Flows (per server)
        m_dot=0.03 * n_gpus,       # secondary loop, kg/s (~1.8 L/min/GPU water)
        m_dot_fac=0.06 * n_gpus,   # facility/primary side, kg/s
        cp_water=4186.0,
        # CDU conductance calibrated so eps ~ 0.82 at design flow
        UA_hx=300.0 * n_gpus,
        # Facility supply temperature (warm-water cooling)
        T_fac_in=30.0,
    )


def _odes(t, T, P_func, p):
    T_j, T_ihs, T_cp, T_loop, T_fac = T
    P_total = P_func(t) * p['n_gpus']

    q_j_ihs = (T_j - T_ihs) / (p['R_j_ihs'] / p['n_gpus'])
    q_ihs_cp = (T_ihs - T_cp) / (p['R_ihs_cp'] / p['n_gpus'])
    h_eff = convection.heat_transfer_coefficient(p)
    q_cp_loop = h_eff * (p['A_cp'] * p['n_gpus']) * (T_cp - T_loop)

    eps, C_min = epsilon_ntu_counterflow(
        p['m_dot'], p['m_dot_fac'], p['cp_water'], p['cp_water'], p['UA_hx'])
    Q_hx = eps * C_min * (T_loop - p['T_fac_in'])
    q_fac_out = p['m_dot_fac'] * p['cp_water'] * (T_fac - p['T_fac_in'])

    return [
        (P_total - q_j_ihs) / p['C_die'],
        (q_j_ihs - q_ihs_cp) / p['C_ihs'],
        (q_ihs_cp - q_cp_loop) / p['C_cp'],
        (q_cp_loop - Q_hx) / p['C_loop'],
        (Q_hx - q_fac_out) / p['C_fac'],
    ]


def simulate(t_axis, P_per_gpu, params, T0=None, *, input_times=None,
             rtol=1e-6, atol=1e-8, max_step=1.0, breakpoints=()):
    """Integrate the lumped model over a per-GPU power trace.

    `P_per_gpu` may be an array aligned to `t_axis` or a callable P(t).
    Returns sampled adaptive-integration states and explicit solver controls.
    """
    t_axis = time_axis(t_axis)
    diagnostic = convection.evaluate(params)
    if T0 is None:
        T0 = [params['T_fac_in'] + 25, params['T_fac_in'] + 20,
              params['T_fac_in'] + 15, params['T_fac_in'] + 8,
              params['T_fac_in'] + 4]

    P_func, changes = power_signal(t_axis,P_per_gpu,input_times)
    sol = integrate(lambda t,y:_odes(t,y,P_func,params),t_axis,T0,
                    breakpoints=[*changes,*breakpoints],rtol=rtol,atol=atol,max_step=max_step)
    sol.convection = diagnostic
    return sol


def steady_state_closed_form(params, P_per_gpu_const=700.0):
    """Analytic steady state (no integration).

    Used as an analytical reference for this offline solver; it does not
    establish measured accuracy or replace the website 3D simulation.
    """
    if not np.isscalar(P_per_gpu_const) or not np.isfinite(P_per_gpu_const) or P_per_gpu_const<0:
        raise ValueError("Constant electrical power must be finite and nonnegative")
    n = params['n_gpus']
    cp = params['cp_water']
    diagnostic = convection.evaluate(params)
    Q = P_per_gpu_const * n
    eps, C_min = epsilon_ntu_counterflow(
        params['m_dot'], params['m_dot_fac'], cp, cp, params['UA_hx'])
    if eps * C_min <= 0:
        raise ValueError("No unique rejected-heat steady state with zero CDU conductance/capacity")
    h_eff = diagnostic['h_W_m2K']
    T_loop = params['T_fac_in'] + Q / (eps * C_min)
    T_cp = T_loop + Q / (h_eff * params['A_cp'] * n)
    T_ihs = T_cp + Q * (params['R_ihs_cp'] / n)
    T_die = T_ihs + Q * (params['R_j_ihs'] / n)
    return dict(T_die=T_die, T_ihs=T_ihs, T_coldplate=T_cp, T_loop=T_loop,
                epsilon=eps, Q_die_W=Q, convection=diagnostic)


def steady_state(params, P_per_gpu_const=700.0, settle_s=2400.0):
    """Drive at constant power to steady state; return node temps + heat balance."""
    t_axis = np.arange(0, settle_s, 1.0)
    P = np.full_like(t_axis, P_per_gpu_const, dtype=float)
    sol = simulate(t_axis, P, params)
    T_j, T_ihs, T_cp, T_loop, T_fac = sol.y[:, -1]
    eps, C_min = epsilon_ntu_counterflow(
        params['m_dot'], params['m_dot_fac'],
        params['cp_water'], params['cp_water'], params['UA_hx'])
    Q_hx = eps * C_min * (T_loop - params['T_fac_in'])
    Q_die = P_per_gpu_const * params['n_gpus']
    return dict(T_die=T_j, T_ihs=T_ihs, T_coldplate=T_cp, T_loop=T_loop,
                T_fac_return=T_fac, Q_die_W=Q_die, Q_hx_W=Q_hx, epsilon=eps,
                deltaT_loop=T_loop - params['T_fac_in'],
                closure=Q_hx / Q_die if Q_die else None,
                convection=sol.convection)


# Public alias so the scenario engine can reuse the validated RHS
# with time-varying parameters without duplicating the physics.
odes = _odes
