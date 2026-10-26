"""Reference-normalized convection scaling, not an absolute Nu correlation.

h = h0 * (plate_mass_flow / m_dot_ref)**exponent * property_factor

Numeric ``flow_exponent`` values preserve historical behavior (default 0.8).
Named choices state an intended regime; none is selected automatically. h0
must be calibrated for the plate, boundary condition and coolant. Rectangular
channel diagnostics assume identical parallel GPU plates and equal channel
flow. Missing geometry/properties remain unknown, never guessed from A_cp or
the 1-D loop mesh. See docs/NUMERICAL_VERIFICATION.md for validity and source limitations.
"""
import math
import numbers
import warnings

LAMINAR_RE = 2300.0
TRANSITION_END_RE = 4000.0
TURBULENT_RE = 1.0e4  # Dittus-Boelter applicability, not transition onset
EXPONENTS = {
    "laminar_developed": 0.0,
    "laminar_developing": 1.0 / 3.0,
    "turbulent_dittus_boelter": 0.8,
}


class ConvectionWarning(UserWarning):
    """Missing applicability evidence or explicitly permitted extrapolation."""


def _positive(value, name):
    if isinstance(value, bool) or not isinstance(value, numbers.Real):
        raise ValueError(f"{name} must be a finite positive number")
    value = float(value)
    if not math.isfinite(value) or value <= 0:
        raise ValueError(f"{name} must be a finite positive number")
    return value


def _count(value, name):
    val = _positive(value, name)
    if not val.is_integer():
        raise ValueError(f"{name} must be an integer")
    return val


def _selection(value):
    if isinstance(value, str):
        if value not in EXPONENTS:
            raise ValueError(f"unknown flow_exponent preset {value!r}; use {sorted(EXPONENTS)} or a nonnegative numeric exponent")
        return value, EXPONENTS[value], value
    if isinstance(value, bool) or not isinstance(value, numbers.Real) or not math.isfinite(value) or value < 0:
        raise ValueError("flow_exponent must be a finite nonnegative number or a named preset")
    family = next((name for name, exponent in EXPONENTS.items()
                   if math.isclose(value, exponent, rel_tol=0, abs_tol=1e-12)), "custom")
    return "legacy_power_law", float(value), family


def channel_reynolds(m_dot_total, n_channels, chan_w, chan_h, rho, mu):
    """Re in one rectangular channel; m_dot_total is kg/s per plate.

    Re = rho*v*Dh/mu = m_dot_plate*Dh/(N*Ac*mu); density cancels
    for mass-flow inputs. rho may be None, but is validated when supplied.
    """
    flow = _positive(m_dot_total, "plate mass flow")
    count = _count(n_channels, "n_channels")
    w, h = _positive(chan_w, "channel_width_m"), _positive(chan_h, "channel_height_m")
    if rho is not None:
        _positive(rho, "rho_fluid")
    viscosity = _positive(mu, "mu_fluid")
    dh = 2 * w * h / (w + h)
    return flow * dh / (count * w * h * viscosity)


def classify_regime(re):
    """Hydrodynamic screening for smooth internal flow, not microchannel proof."""
    re = _positive(re, "Reynolds number")
    if re < LAMINAR_RE:
        return "laminar"
    if re < TRANSITION_END_RE:
        return "transitional"
    return "turbulent"


def recommended_exponent(re, developing=None):
    """Legacy helper; refuses to guess entry state or transitional behavior."""
    regime = classify_regime(re)
    if regime == "laminar" and isinstance(developing, bool):
        return EXPONENTS["laminar_developing" if developing else "laminar_developed"]
    if re >= TURBULENT_RE:
        return EXPONENTS["turbulent_dittus_boelter"]
    raise ValueError("No justified exponent from Re alone: specify laminar entry conditions or provide a separately validated correlation outside the Dittus-Boelter range")


def check_regime(re, flow_exponent):
    """Re-only screening; True does not establish entry/Pr validity."""
    regime = classify_regime(re)
    _, _, family = _selection(flow_exponent)
    if regime == "transitional":
        return False, "Re is transitional (2300–4000); no supported scaling is justified. Supply a validated model for this operating envelope."
    if family == "turbulent_dittus_boelter" and re < TURBULENT_RE:
        return False, "Dittus-Boelter-type scaling requires Re >= 10000; choose a justified laminar preset or supply a validated correlation."
    if family.startswith("laminar") and regime != "laminar":
        return False, "Laminar scaling requires Re < 2300; supply a correlation validated for the actual operating range."
    if family == "custom":
        return False, "Custom exponent has no built-in applicability evidence; document calibration and its operating envelope."
    return True, "Re screening passed; entry length, Prandtl range and boundary conditions still need checking."


def _flow_details(plate_flow, geometry, params):
    result = dict(reynolds=None, regime="unknown", prandtl=None,
                  hydraulic_diameter_m=None, velocity_m_s=None,
                  hydraulic_entry_length_m=None, thermal_entry_length_m=None,
                  thermal_development="unknown")
    missing = []
    if geometry is None:
        return result, ["Supply channel_geometry to calculate Reynolds number; wetted area and loop cells do not determine channel geometry."]
    if not isinstance(geometry, dict):
        raise ValueError("channel_geometry must be a mapping with n_channels, channel_width_m, channel_height_m and optional channel_length_m")
    required = ("n_channels", "channel_width_m", "channel_height_m")
    for key in (*required, "channel_length_m"):
        if key in geometry:
            (_count if key == "n_channels" else _positive)(geometry[key], key)
    absent = [key for key in required if key not in geometry]
    if absent:
        return result, ["Incomplete channel_geometry; supply " + ", ".join(absent) + ". No dimensions were inferred."]
    w, h = geometry["channel_width_m"], geometry["channel_height_m"]
    dh = result["hydraulic_diameter_m"] = 2 * w * h / (w + h)
    if "mu_fluid" not in params:
        return result, ["Supply mu_fluid (Pa s), or call apply_fluid, to calculate Reynolds number."]
    re = channel_reynolds(plate_flow, geometry["n_channels"], w, h,
                          params.get("rho_fluid"), params["mu_fluid"])
    result.update(reynolds=re, regime=classify_regime(re))
    if "rho_fluid" in params:
        result["velocity_m_s"] = plate_flow / (geometry["n_channels"] * w * h * params["rho_fluid"])
    if "k_fluid" in params:
        result["prandtl"] = params["cp_water"] * params["mu_fluid"] / params["k_fluid"]
    else:
        missing.append("Supply k_fluid (W/m/K) to check Prandtl number and laminar thermal entry length; no conductivity is inferred.")
    length = geometry.get("channel_length_m")
    if length is None:
        missing.append("Supply channel_length_m (heated length) to check entrance effects.")
    if result["regime"] == "laminar":
        result["hydraulic_entry_length_m"] = 0.05 * re * dh
        if result["prandtl"] is not None:
            lth = result["thermal_entry_length_m"] = 0.05 * re * result["prandtl"] * dh
            if length is not None:
                result["thermal_development"] = "developing" if length < lth else "entry_length_exceeded"
                if length < lth:
                    result["regime"] = "developing_laminar"
    return result, missing


def evaluate(params, *, emit_warnings=True):
    """Return h and screening diagnostics; reject established incompatibility.

    ``convection_validation: warn`` explicitly permits labeled extrapolation.
    Both reference and operating flows are screened; properties are fixed at
    their declared representative temperature. No exponent is auto-selected.
    """
    policy = params.get("convection_validation", "error")
    if policy not in ("error", "warn"):
        raise ValueError("convection_validation must be 'error' or 'warn'")
    mode, exponent, family = _selection(params.get("flow_exponent", 0.8))
    n = _count(params["n_gpus"], "n_gpus")
    flow = _positive(params["m_dot"], "m_dot") / n
    ref = _positive(params["m_dot_ref"], "m_dot_ref")
    h0 = _positive(params["h0"], "h0")
    factor = _positive(params.get("h_property_factor", 1.0), "h_property_factor")
    _positive(params["cp_water"], "cp_water")
    for key in ("rho_fluid", "mu_fluid", "k_fluid"):
        if key in params:
            _positive(params[key], key)
    if mode != "legacy_power_law" and params.get("h_property_model") == "legacy_dittus_boelter_ratio" and not math.isclose(factor, 1):
        raise ValueError("Named flow scaling requires h0 for the selected coolant, not an inherited legacy property ratio. Select flow_exponent before apply_fluid, or explicitly supply a calibrated property factor.")
    geometry = params.get("channel_geometry")
    operating, notes = _flow_details(flow, geometry, params)
    reference, _ = _flow_details(ref, geometry, params)
    problems = []
    if mode == "legacy_power_law":
        notes.append("Numeric exponent retains legacy empirical flow/property scaling; it is not a validated cold-plate correlation.")
    if family == "custom":
        notes.append("Custom exponent: applicability is unverified; supply independent calibration and an operating envelope.")
    for label, details in (("operating", operating), ("reference", reference)):
        re = details["reynolds"]
        if re is None:
            continue
        ok, message = check_regime(re, exponent)
        if not ok and family != "custom":
            problems.append(f"{label} Re={re:.6g}: {message}")
        length = geometry.get("channel_length_m")
        if family == "turbulent_dittus_boelter":
            pr = details["prandtl"]
            if pr is not None and not 0.7 <= pr <= 160:
                problems.append(f"{label} Pr={pr:.6g} outside the stated Dittus-Boelter screening range 0.7–160.")
            if length is not None and length / details["hydraulic_diameter_m"] < 10:
                problems.append(f"{label} channel L/Dh < 10: fully developed turbulent scaling is not justified.")
        if family.startswith("laminar") and re < LAMINAR_RE:
            lth, lh = details["thermal_entry_length_m"], details["hydraulic_entry_length_m"]
            if length is not None and lth is not None:
                if family == "laminar_developed" and length < lth:
                    problems.append(f"{label} heated length is below the estimated thermal entry length: developed-laminar scaling is incompatible; consider a developing-flow model.")
                if family == "laminar_developing" and length >= lth:
                    problems.append(f"{label} heated length exceeds thermal entry estimate: pure one-third entry scaling is unsupported; assess mixed/developed heat transfer.")
                if family == "laminar_developed" and lth <= length < 10 * lth:
                    notes.append("Thermal entry length is a significant part of the heated channel; a constant-Nu mean coefficient needs independent justification.")
            if length is not None and length < lh:
                problems.append(f"{label} flow is hydrodynamically developing: neither developed-laminar nor thermally developing one-third scaling alone is justified.")
    if problems and policy == "error":
        raise ValueError("Convection scaling incompatible: " + " ".join(problems) + " Set convection_validation: warn only for explicitly labeled reproduction/extrapolation.")
    if problems:
        notes.append("INCOMPATIBLE extrapolation explicitly allowed by convection_validation: warn. " + " ".join(problems))
    notes = list(dict.fromkeys(notes))
    if emit_warnings:
        for note in notes:
            # Do not emit a different warning for every Re in a ramp.
            message = ("INCOMPATIBLE convection extrapolation explicitly allowed by convection_validation: warn; inspect returned convection diagnostics for the operating/reference conditions."
                       if note.startswith("INCOMPATIBLE") else note)
            warnings.warn(message, ConvectionWarning, stacklevel=2)
    return dict(h_W_m2K=h0 * (flow / ref) ** exponent * factor,
                h0_W_m2K=h0, channel_geometry=dict(geometry) if geometry is not None else None,
                fluid_properties=dict(cp_J_kgK=float(params["cp_water"]),
                                      rho_kg_m3=params.get("rho_fluid"),
                                      mu_Pa_s=params.get("mu_fluid"),
                                      k_W_mK=params.get("k_fluid")),
                selection=mode, flow_exponent=exponent, scaling_family=family,
                property_factor=factor, property_model=params.get("h_property_model", "explicit_or_unity"),
                property_temperature_C=params.get("fluid_T_ref_C"),
                plate_mass_flow_kg_s=flow, reference_plate_mass_flow_kg_s=ref,
                flow_distribution="Identical parallel GPU plates; equal split among channels within each plate",
                operating=operating, reference=reference,
                applicability=("incompatible_extrapolation" if problems else "unverified"
                               if operating["reynolds"] is None or reference["reynolds"] is None or family == "custom"
                               else "partially_screened" if notes else "screened_not_validated"),
                validation_policy=policy, warnings=notes,
                limitation="Normalized flow scaling only. h0, boundary conditions, equal flow split and channel correlations require independent validation; entry criteria are engineering estimates.")


def heat_transfer_coefficient(params):
    """Coupling shared by lumped/1-D RHS and steady-state accounting."""
    return evaluate(params)["h_W_m2K"]
