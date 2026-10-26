# Finite-capacity counterflow CDU: equations, checks and limits

This extension improves one identifiable model-form simplification: the old
1D CDU exchanges heat with a prescribed-temperature bath, irrespective of
primary mass flow. `physics/counterflow.py` adds a coupled, finite-capacity
primary stream flowing opposite to the secondary CDU cells. It is a reduced
simulation model, not CFD, hardware control or new experimental validation.
The 3D campus, historical reference code/results and other experiments remain
unchanged. The new model is a separate explicit option, not an undocumented
replacement of legacy temperatures.

## Parameter and source status

`physics/protocol.json` declares eight reference GPUs, prescribed heat input,
fixed secondary flow, primary-flow cases, explicit primary liquid hold-up and
solver settings. The solid resistances/capacitances, h0, wetted area and total
UA are inherited from the MIT reference under `research/thermal_reference/`.
They are engineering examples, not independently calibrated measurements.
The original license and source manifest are retained there.

Model instances copy input parameters and assume them fixed within a run;
construct a new instance for changed conditions rather than editing internal
attributes.

All runs prescribe heat **deposited into the aggregate solids**; this is not
measured electrical board/site power. Pump work, host/network power and
ambient losses are excluded. Fluid properties are fixed within and across
runs. Secondary flow stays at its design value, so no new off-design
cold-plate correlation is claimed. Existing convection applicability checks
remain active; unknown channel geometry/regime stays unknown.

The primary-side CDU liquid volume is explicitly supplied as **0.001 m³
(1 L), unmeasured**. No hold-up is inferred from UA, wetted area or the
secondary-loop mesh. The model rejects missing/nonpositive physical inputs.
Density 1000 kg/m³ and specific heat 4186 J/(kg K) are fixed reference water
approximations. A sensitivity comparison uses 0.25, 1 and 4 L. These are
assumptions, not measured volumes or uncertainty probabilities.

Theoretical equations are corroborated with a pinned copy of Modelica
Buildings `epsilon_ntuZ.mo`, with commit, original bytes/SHA-256 and license
reference in `science/physics/sources.json`. This is a published equation
implementation, not an experimental dataset; Modelica is not executed here.
That function smooths the capacity ratio above 0.97. This extension instead
uses the exact equal-capacity limit; bitwise agreement with the smoothing
is not claimed. No primary PDF, calibration dataset or field accuracy is
invented from this source.

## Conservative state model

State order:

```text
[die, IHS, plate, secondary_loop[0:N], primary_CDU[0:M], return_buffer]
```

The same secondary loop has a source interval [0,0.8] m and a CDU interval
[1.6,2.4] m in a 4 m reference loop. All meshes align these intervals exactly;
secondary liquid volume stays 2.87 L, wetted area and total UA stay fixed.
This declared geometry is not inferred microchannel or 3D campus geometry.
Primary hold-up is distributed among M co-located CDU cells.

With C_h = m_dot_secondary cp_secondary, C_c = m_dot_primary cp_primary,
K = UA/M, co-located temperatures s_j/p_j and capacitances H:

```text
q_j = K (s_j − p_j)
H_secondary,j ds_j/dt = C_h(s_upstream − s_j) − q_j
H_primary,j   dp_j/dt = C_c(p_(j+1) − p_j) + q_j
p_M = prescribed primary supply
H_return dT_return/dt = C_c(p_0 − T_return)
```

Secondary flow advances toward increasing index; primary flow advances toward
decreasing index. Every interfacial flux is applied with equal/opposite signs.
No clipping suppresses reverse heat exchange. A warmer primary can heat the
secondary. Mass-flow reversal and pump shutdown remain outside the model's
positive imposed-flow domain and are rejected rather than guessed.

The conductive solid path and distributed cold-plate transfer are the same
reference equations. The secondary loop is closed with first-order upwind
advection; primary inlet/outlet are open boundaries. The return buffer retains
the old assumed 80 kJ/K storage and does not feed back into the prescribed
supply. Wall heat capacity, axial conduction and ambient losses are omitted.

For the complete modeled boundary:

```text
P_injected − C_c(T_return − T_supply) = d/dt(sum_i H_i T_i)
E_injected − E_outlet = sum_i H_i (T_i,end − T_i,start)
```

The sum includes primary CDU liquid and return-buffer storage. External heat
is signed and can be negative when the facility supplies heat. Input/output
integrals are integrated as solver states, not trapezoidal approximations of
discontinuous forcing. A small residual verifies model accounting, not the
physical accuracy of its assumptions or a complete site energy audit.

For positive absolute temperatures, an interfacial conductance has
`S_generation = K (T_a−T_b)²/(T_a T_b) >= 0`, using kelvin. The reported sum
covers solid/plate/CDU conductive interfaces only; it excludes advective
mixing and boundary entropy flux and is **not a full entropy balance**.

## Independent references and limiting cases

The continuum steady reference uses exact counterflow effectiveness:

```text
C_min = min(C_h,C_c); C_r = C_min/max(C_h,C_c); NTU = UA/C_min
epsilon = (1−exp(−NTU(1−C_r))) / (1−C_r exp(−NTU(1−C_r)))
C_r=1: epsilon = NTU/(1+NTU)
```

Numerically stable `expm1` handling is reused from the licensed reference.
Finite-cell steady CDU profiles are independently solved from a sparse
two-stream boundary system; the full steady loop follows cold-plate cell
recurrences. Neither uses transient settling. Their states are checked
against the conservative ODE. At equal capacity rates, the exact discrete
effectiveness is `NTU/(1+NTU+NTU/M)` and approaches the continuum expression.
At infinite primary capacity the same-mesh legacy fixed bath is recovered.
Non-colocated hot/cold outlet temperatures may cross in counterflow; the
tests do not incorrectly forbid this physically valid situation.

Transient LSODA results are checked against an independently computed dense
matrix exponential of the same linear fixed-property equations. This is a
different solution algorithm, not independent physical/experimental evidence.
Forcing uses actual timestamps and splits at power discontinuities. Default
initialization uses the checked heat input at the first requested output time,
not the first sample of a possibly longer input history. Supply an initial
state when prior thermal history matters. Adaptive integration also supports
callable heat input with explicit known breakpoints; the matrix reference
rejects callables whose constant segments cannot be certified. The
matrix check requires an aligned uniform observation grid and rejects
unaligned changes rather than silently smearing them. All thermal states,
not only die temperature, and integrated external heat are compared.

Declared targets are 0.001°C temporal error and 1e-7 relative heat/integral
closure. The steady refinement target is 0.05°C against the analytical
continuum limit, at the declared design flow/power. Of the tested meshes,
640 secondary cells first meet that target. The displayed **80-cell** cases
retain about 0.394°C steady discretization error at design flow; they are not
silently relabeled as 640-cell or experimentally accurate predictions. Other
operating conditions need their own refinement. No complete transient
continuum certification, GCI estimate or measured prediction MAE is asserted.

## Interpretation

At 700 W injected heat/GPU, same 80-cell secondary grid, primary flow
0.48 kg/s gives about 72.16°C die in the coupled model versus 71.39°C with
the legacy bath. At 0.06 kg/s the coupled steady prediction rises to about
87.53°C; the legacy die result remains 71.39°C because that boundary ignores
primary capacity. These are model predictions, not new measured errors or
equipment performance. A more complete model can predict a higher temperature.

The pulse is 100 → 700 → 100 W/GPU over 150 s, with changes at 30 and 90 s.
Both models start at their own 100 W/GPU equilibrium. The low-flow pulse peak
is not the infinite-time 700 W steady temperature. Adding primary hold-up
changes transient storage/response but cannot change steady temperatures.

UA is held constant across primary flow: a controlled capacity sensitivity,
**not a calibrated off-design exchanger curve**. Real h/UA versus flow,
resistance/material properties, primary liquid volume, maldistribution,
pressure losses, wall mass and temperature-dependent/phase-change behavior
still need suitable data. This extension establishes internal physical-law
consistency and numerical behavior, not improved measured predictive accuracy.

## Reproduce

```sh
python3 -m venv .venv-physics
.venv-physics/bin/python -m pip install -r requirements-research.txt
OPENBLAS_NUM_THREADS=1 .venv-physics/bin/python -m pytest -q tests/test_physics_counterflow.py
OPENBLAS_NUM_THREADS=1 .venv-physics/bin/python scripts/run_physics_verification.py --compare science/physics/results.json
python3 scripts/build_physics.py --check
node --test tests/physics.test.cjs
```

For deliberate regeneration after reviewing a source/protocol change, run
the verification command without `--compare`, then `build_physics.py` without
`--check`. Sources/configuration are fingerprinted; historical numerical and
workload artifacts are not regenerated or overwritten. Source/result hashes,
all cases, solver controls, primary-volume sensitivity, mesh refinement and
remaining limitations are in the JSON artifact and browser exports.

Cross-environment reproduction budgets are 1e-5°C, 0.01 J and 1e-8 absolute
for other compared numeric diagnostics. Roundoff-budget ratios must remain
within [0,1]; exact solver evaluation counts and roundoff-level steady RHS
rates are not promised bitwise portable. Browser results are saved Python
cases, not a SciPy runtime, sensor feed or validated 3D temperature field.


The browser runners prefer the browser installed by the pinned Playwright
package. CI's manual `workflow_dispatch` reruns the same full default-motion
suite against the deployed main URL using `--base-url`; byte/provenance and
behavior assertions still refer to the checked-out main revision. Offline
checks continue to fulfill exact local files and are labeled separately.
This allows a supported-browser release check when the local system browser
is incompatible and the proxy blocks downloading the supported binary.
