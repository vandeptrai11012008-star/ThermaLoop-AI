"""Coolant Distribution Unit (CDU) heat-exchanger model.

Counterflow effectiveness-NTU. UA is calibrated so that effectiveness lands
at ~0.82 at design flow, matching the experimental anchor in Heydari et al.,
Applied Thermal Engineering 239 (2024).
"""
import numpy as np


def epsilon_ntu_counterflow(m_hot, m_cold, cp_hot, cp_cold, UA):
    """Counterflow heat-exchanger effectiveness and minimum heat-capacity rate.

    Parameters
    ----------
    m_hot, m_cold : float
        Mass flow rates (kg/s) of the hot (secondary loop) and cold
        (facility) streams.
    cp_hot, cp_cold : float
        Specific heats (J/kg/K).
    UA : float
        Overall conductance (W/K).

    Returns
    -------
    eps : float
        Effectiveness in [0, 1].
    C_min : float
        Minimum heat-capacity rate (W/K).
    """
    values=np.asarray([m_hot,m_cold,cp_hot,cp_cold,UA],dtype=float)
    if not np.isfinite(values).all() or min(m_hot,m_cold,UA)<0 or min(cp_hot,cp_cold)<=0:
        raise ValueError("Heat exchanger needs finite nonnegative flows/UA and positive specific heats")
    C_hot = float(m_hot) * float(cp_hot)
    C_cold = float(m_cold) * float(cp_cold)
    if not np.isfinite([C_hot,C_cold]).all():
        raise ValueError("Heat-capacity rates must remain finite")
    C_min = min(C_hot, C_cold)
    C_max = max(C_hot, C_cold)
    if C_min==0 or UA==0:
        return 0.0,C_min  # No transfer; epsilon=0 is a reporting convention.
    Cr = C_min / C_max
    with np.errstate(over="ignore"):
        NTU = np.float64(UA)/C_min
    if np.isinf(NTU):
        return 1.0,C_min  # Analytic positive-conductance limit, not clipping.
    if Cr==1:
        eps = NTU / (1.0 + NTU)
    else:
        numerator=-np.expm1(-NTU*(1.0-Cr))
        eps=numerator/((1.0-Cr)+Cr*numerator)
    return eps, C_min


def heat_rejected(T_loop, T_fac_in, m_loop, m_fac, cp_water, UA):
    """Heat removed from the secondary loop by the CDU (W)."""
    eps, C_min = epsilon_ntu_counterflow(m_loop, m_fac, cp_water, cp_water, UA)
    return eps * C_min * (T_loop - T_fac_in)
