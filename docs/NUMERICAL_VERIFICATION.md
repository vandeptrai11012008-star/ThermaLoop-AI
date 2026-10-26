# Numerical verification: scope, methods and iteration record

This website now publishes reproducible **offline numerical reference results**.
It does not replace the original 3D simulation, connect sensors, calibrate a
server, or add independent experimental observations. A small error against a
solution of the same equations is not evidence of equally small physical error.

## Source and unchanged behavior

The MIT thermal reference is included under `research/thermal_reference/` with
the original license. `SOURCE_MANIFEST.json` identifies upstream
`Walla17x/thermaloop` main commit `3a5ffe9` and the earlier local convection
review `10954f4`. The latter was not published upstream. This repository contains
the adapted source and records all active Python/configuration hashes with the
results, rather than implying that Walla17x's upstream code was changed.

The reference retains its historical empirical convection parameters and
design-point temperatures. Channel geometry/regime remain unspecified. It
contains a lumped five-node model and a finite-volume 1D loop. Both use fixed
properties and linear state equations for the selected, fixed-flow cases.
Existing browser inline programs, README, PDFs, ZIP files, linked websites,
previous evidence engine and previous evidence datasets are unchanged.

## Corrections made in the offline reference

1. **Time origin and input clocks.** The former `int(t/dt)` indexing used an
   absolute clock as an array index and assumed uniform sampling. Prescribed
   samples now use actual, validated timestamps and a right-continuous
   zero-order hold. Input timestamps can be separate from output observations.
   Unknown coverage, nonfinite values, negative electrical power and invalid
   clocks raise errors. Known power changes split integration intervals; the
   previous interval uses the left limit at the change.
2. **Explicit adaptive controls.** `max_step`, `rtol` and `atol` are separate
   parameters. Output spacing does not set the adaptive integration step.
3. **CDU metric definition.** The former 1D `eps_effective` algebraically equals
   `UA/(m_dot cp)`, i.e. NTU. The legacy alias is retained with a deprecation
   description; `cdu_ntu` and `cdu_effectiveness_isothermal` are explicit.
   Effectiveness uses actual CDU inlet/outlet temperatures, not the mean cell
   temperature. It is undefined at zero driving temperature. Values are not
   clipped into an artificial physical bound.
4. **Counterflow evaluation.** `expm1` evaluates the exact finite-capacity
   counterflow formula near equal capacity rates; the Cr=1 limit is used only
   at equality. Nonfinite/negative flow, UA or specific heat is rejected.
   Zero flow/UA gives no heat transfer; zero secondary flow remains outside
   the forced-convection model's supported domain. A finite rejected-heat
   equilibrium is not invented when there is no rejection path.
5. **Threshold edge cases.** A trajectory already at/above the diagnostic
   threshold reports its starting time. An absent crossing stays null. The
   numerical event-time check is not a calibrated GPU throttle prediction.

The 1D fixed-temperature sink differs from the lumped finite-capacity
counterflow CDU. Equal UA does not make these boundary conditions equivalent;
their temperature difference cannot be attributed only to spatial resolution.
The standalone CDU metric example uses the historical 50-cell default
(10 CDU cells), explicitly labeled separately from the 20-cell temporal test.

## Protocol

`research/verification-config.json` declares the test case and numerical
targets. Eight GPUs use the historical water/reference parameters. Per-GPU
power is 100 W until 30 s, 700 W until 90 s, then 100 W until 150 s. The same
forcing is used for every temporal run. Observations are fixed at 0.1 s;
60°C is an illustrative event threshold, not the device's throttle limit.

Temporal refinement uses:

- max_step = 1, 0.5, 0.25 s with fixed rtol/atol;
- rtol = 1e-4, 1e-6, 1e-8, with atol = 0.01 × rtol and max_step fixed at 0.5 s;
- a selected run at max_step 0.25 s, rtol 1e-8, atol 1e-10.

Reference: sparse matrix-exponential propagation of the same fixed-property
linear state equations, split at the same input discontinuities. Temperature
offset/scaling and normalized energy integrals avoid an ill-scaled augmented
matrix. Sparse propagation is checked against a dense matrix exponential;
the matrix derivative is independently checked against the original RHS.
This is an independent **solution algorithm**, not an independent physical
model or experiment. LSODA events and matrix-reference bracketed roots give
threshold times; sampled time-to-peak uses the common observation grid.

The declared selected-run targets are 0.001°C trajectory error, 0.001 s event
time error, and 1e-5 relative integrated heat error. These are chosen numerical
resolution targets, not field accuracy or externally prescribed standards.
Coarser settings are reported even when they fail the target. A max-step
plateau is retained; no formal convergence order is invented from it.

## Transient energy and its boundary

For the modeled system including facility-return storage:

```text
P_in − P_external_out − dE_stored/dt = differential residual [W]
integral(P_in dt) − integral(P_external_out dt) − (E_end − E_start)
    = integral residual [J]
```

Cold-plate/CDU transfers are internal to this boundary. The external output is
the facility-outlet enthalpy flow above its fixed supply. Energy storage uses
every node/cell capacitance; closed-loop advection sums to zero.

Heat-input and external-output integrals are additional solver states, rather
than a trapezoidal estimate that smears a step input. Their independent matrix
reference is checked against the prescribed heat input. Residual percentages
use total input energy; a zero denominator is undefined, not zero percent.
The protocol's input is 408,000 J. About 4,800 W can temporarily enter storage,
so checking only P_in=P_out during the transient would be incorrect.
This input is GPU electrical heat only; pump work and other site loads are
not included in this reference boundary.

Differential closure is compared at each observation with a documented
floating-point budget proportional to machine epsilon, number of terms and
the absolute energy-rate terms (`64 × terms × eps × scale`). The maximum
residual/budget ratio is checked; comparing only two separate maxima could
hide a local failure. Integral closure has the declared relative numerical
energy target. Observed roundoff-scale residuals are not measurement accuracy.

## Spatial convergence

Meshes use 10, 20, 40, 80, 160, 320 and 640 cells with exactly aligned physical
zones: cold plate [0, 0.8] m and CDU [1.6, 2.4] m in a 4 m loop. Total liquid
mass stays 2.87 kg, effective wetted area 0.032 m² and CDU UA 2400 W/K. This
avoids moving the CDU boundary through integer rounding during refinement.

The discrete steady cell recurrences provide an independent steady solution;
LSODA steady runs are checked against them at 10/20/40/80 cells. The continuum
steady limit uses attenuation factors exp(−hA/C) and exp(−UA/C), where C=m_dot cp.
No parameter is refitted when the mesh changes.

In this case the continuum steady die temperature is about 71.12061°C. The
80-cell steady error is about 0.27155°C. The first tested mesh below the
declared 0.05°C steady target is 640 cells (about 0.03400°C error). This is a
case-specific resolution assessment, not a universal optimal mesh.

Transient mesh rows use uniform initial temperature at the facility supply
for all meshes. Large-grid trajectories use matrix propagation of the discrete
equations; they are not claimed to be large-grid LSODA runs. Inter-grid peak
and event-time changes are displayed, but are **not certified error bounds
against a continuum transient solution**. No complete transient mesh
certification or measured time-series agreement is claimed.

## Iterative checks performed

- A fresh website baseline passed 35 Node tests; the existing main CI was green.
- First numerical round added 29 checks for timestamps, discontinuities,
  frozen forcing/output independence, steady references, zero-power/flow
  domain, physical-zone alignment, storage closure and matrix equivalence.
- Additional adversarial checks exposed nine failures: initial-over-threshold
  handling, invalid exchanger parameters, the broad equal-capacity
  approximation, and invalid constant-power analytical inputs. These were
  corrected; the expanded round passed 39 tests.
- Reproduction review then added three tests that corrupt saved heat, timing
  or CDU values while leaving temperatures unchanged. The comparison now
  checks those quantities too, using explicit reproduction budgets.
- An artifact-version mismatch found during browser checks is rejected with
  a visible status and disabled numerical exports. It cannot cause an
  unhandled exception or silently reuse old results. Other website modules
  remain independent. The browser regression explicitly injects this fault.
- Website tests verify source/bundle identity, finite results, declared-target
  selection, intentionally failing coarse settings, export labels, controls,
  offline use and preservation of the old simulation. CI reruns the Python
  protocol and checks its artifacts in a separate environment.

The final local checks passed 43 Python tests, 43 Node tests and 26 Chromium
check groups, with no uncaught browser errors. All three static bundles matched
their sources; original-file preservation passed. A fresh full-protocol rerun
matched compared temperature, event-time, heat and CDU values exactly in this
environment, and all eight numerical gates passed. This does not imply exact
bitwise reproduction on every platform. `VALIDATION.md` and
`validation-browser.json` record scope and browser limitations. Public release
and CI results are verified separately from these local results.

## Reproduction and artifact identity

```sh
python3 -m venv .venv-research
.venv-research/bin/python -m pip install -r requirements-research.txt
OPENBLAS_NUM_THREADS=1 .venv-research/bin/python -m pytest -q tests/test_numerical_reference.py
OPENBLAS_NUM_THREADS=1 .venv-research/bin/python scripts/run_numerical_verification.py --compare science/numerical/results.json
python3 scripts/build_numerical.py --check
node --test tests/*.test.cjs
```

To generate a new, reviewable artifact after a source/configuration change:

```sh
OPENBLAS_NUM_THREADS=1 .venv-research/bin/python scripts/run_numerical_verification.py
python3 scripts/build_numerical.py
```

The JSON includes environment versions, configuration, actual observations,
all numerical gates and SHA-256 hashes of the active Python/configuration
files. The browser bundle has a separate canonical-result hash. The display
does not run SciPy in the browser. Exported CSV/SVG are numerical research
artifacts, not laboratory observations.

Cross-environment reproduction budgets are 1% of the declared temperature,
event-time and relative heat targets, and 1e-10 for the dimensionless CDU
metrics. Exact matching of roundoff-level noise or solver step counts is not
claimed. Source/configuration changes require regenerated, reviewed artifacts;
they cannot quietly reuse a stale result file.

## Remaining limitations

The convection correlation and several capacitances remain empirical,
properties are frozen, and hydraulic flow is prescribed. Independent
experimental thermal/hydraulic/transient datasets, sensor uncertainty and
validated predictive-interval coverage remain unavailable. Parametric UQ
cannot remove these structural limits. No numerical score such as 9.2/10,
physical accuracy certification, or new real-world energy saving follows
from these tests.
