"""Validated clocks, zero-order-held inputs and explicit adaptive-solver controls.

Output sampling is independent of forcing timestamps and solver step limits.
Known input discontinuities split the integration; the preceding interval uses
the left limit, while the following interval starts with the new input value.
"""
from types import SimpleNamespace
import numpy as np
from scipy.integrate import solve_ivp


def time_axis(values, name="output times"):
    t = np.asarray(values, dtype=float)
    if t.ndim != 1 or t.size < 2 or not np.isfinite(t).all() or not (np.diff(t) > 0).all():
        raise ValueError(f"{name} must contain at least two finite, strictly increasing times")
    return t


def power_signal(output_times, values, input_times=None):
    """Return a nonnegative power callable and its actual change times."""
    if callable(values):
        if input_times is not None:
            raise ValueError("input_times apply to sampled traces, not callable power")
        def checked(t):
            value = float(values(t))
            if not np.isfinite(value) or value < 0:
                raise ValueError("Power must be finite and nonnegative")
            return value
        return checked, []
    t = time_axis(output_times if input_times is None else input_times, "power input times")
    p = np.asarray(values, dtype=float)
    if p.ndim != 1 or p.shape != t.shape or not np.isfinite(p).all() or (p < 0).any():
        raise ValueError("Power samples must be finite, nonnegative and aligned with input_times")
    if t[0] > output_times[0] or t[-1] < output_times[-1]:
        raise ValueError("Power input timestamps must cover the requested output interval")
    def sample(now):
        i = np.searchsorted(t, now, side="right") - 1
        return float(p[np.clip(i, 0, len(p)-1)])
    return sample, t[1:][p[1:] != p[:-1]].tolist()


def integrate(rhs, times, initial, *, breakpoints=(), rtol=1e-6, atol=1e-8,
              max_step=1.0, events=None):
    t = time_axis(times)
    y0 = np.asarray(initial, dtype=float)
    if y0.ndim != 1 or not np.isfinite(y0).all():
        raise ValueError("Initial state must be a finite one-dimensional vector")
    for name, value in (("rtol",rtol),("atol",atol),("max_step",max_step)):
        if not np.isscalar(value) or not np.isfinite(value) or value <= 0:
            raise ValueError(f"{name} must be a finite positive scalar")
    knots = np.asarray(list(breakpoints),dtype=float)
    if knots.ndim != 1 or not np.isfinite(knots).all():
        raise ValueError("Integration breakpoints must be finite times")
    edges = np.unique(np.r_[t[0],knots[(knots > t[0]) & (knots < t[-1])],t[-1]])
    result = np.empty((len(y0),len(t)))
    event_functions = [] if events is None else ([events] if callable(events) else list(events))
    if any(getattr(e,"terminal",False) for e in event_functions):
        raise ValueError("Verification integration supports non-terminal events only")
    event_times = [[] for _ in event_functions]
    counts = dict(nfev=0,njev=0,nlu=0)
    for a,b in zip(edges[:-1],edges[1:]):
        left_b = np.nextafter(b,a)
        def local_rhs(now,state):
            return rhs(min(now,left_b),state)
        sol = solve_ivp(local_rhs,(a,b),y0,method="LSODA",dense_output=True,
                        rtol=rtol,atol=atol,max_step=max_step,
                        events=event_functions or None)
        if not sol.success or not np.isfinite(sol.y).all():
            raise RuntimeError("Reference integration failed: " + sol.message)
        mask = (t >= a) & (t <= b)
        result[:,mask] = sol.sol(t[mask])
        y0 = sol.y[:,-1]
        for key in counts:
            counts[key] += getattr(sol,key,0)
        for collected, found in zip(event_times,sol.t_events or []):
            for value in found:
                if not collected or value != collected[-1]:
                    collected.append(float(value))
    return SimpleNamespace(t=t,y=result,success=True,message="All fixed-input intervals integrated",
                           t_events=[np.asarray(x) for x in event_times],
                           controls=dict(rtol=rtol,atol=atol,max_step=max_step),**counts)
