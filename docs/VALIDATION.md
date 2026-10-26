# Validation evidence

Current work includes the finite-capacity physical-model extension based on
main `8a0a4de1989b8a7b4c66b37d356f692a64ae5cd1`. Earlier sections retain their
historical scope. Numerical consistency and public-record replay are not
validation of real-world energy savings or measured predictive accuracy.

## Finite-capacity physical model

Local verification passed **88 Python tests** and **63 Node tests**, all five
source/bundle checks, and a full fresh physical-protocol rerun. Compared
temperature, integrated-heat and other numeric values reproduced with zero
differences in this environment; all eight declared checks passed. Adversarial
tests found and corrected four failures involving output-window initialization,
callable heat input and an uncertifiable matrix-reference forcing assumption.

Independent checks cover counterflow enthalpy balance/bounds, exact discrete
and continuum equal-capacity limits, infinite-primary recovery of the legacy
bath, reduced-UA response, first-law closure for non-equilibrium states,
primary storage, reverse heat exchange, zero heat with facility-supplied
energy, explicit missing/invalid input rejection, convection applicability,
all-state time integration and rejection of corrupted saved heat/entropy/
temperature values. No new measurements or independent experimental calibration
are claimed. See [FINITE_CAPACITY_PHYSICS.md](FINITE_CAPACITY_PHYSICS.md).

A separate default-motion local browser run passed four invalid-input/reset
cycles, twelve recorded-flow selections, desktop/tablet/mobile layouts and
three exports without uncaught JavaScript errors. Full local long-session
runs encountered click/scroll timeouts in unchanged legacy controls (including
one reduced-motion attempt); these are **not counted as passes**. One interim
run was deliberately stopped before regenerating changed-source evidence.
Local Playwright 1.56 was using system Chromium 154 rather than supported
bundled Chromium 141; downloading the pinned browser was blocked by the
network proxy (HTTP 403, domain forbidden). This establishes an unsupported
local test configuration, not a definitive cause for every timeout.

The runners now prefer Playwright's pinned browser when installed and record
browser version/source. CI installs that browser and runs the **complete
website suite at default motion**, plus `tests/browser_physics.py`. No legacy
assertion was removed, forced clicks substituted, timeout increased or
motion preference relaxed for the release gate. A full CI pass is required
before main deployment; consult GitHub Actions / the release PR for that
independent result. `validation-browser.json` remains the last successful
local full-suite report from the preceding release, not evidence that these
new physical-model checks passed locally as a full suite.

## Public-workload extension

Final local verification passed **51 Python tests**, **55 Node tests** and
**30 Chromium check groups**, with no uncaught JavaScript errors. Existing
README, archive/PDF bytes, inline programs, evidence datasets and original
functions remain preserved. All four static bundles match their sources;
the complete Node workload sweep reproduces its saved summaries. A fresh
source-cache download and retraining reproduced the fitted model/scores
exactly locally, with identical frozen routing decisions. CLI full-record
export also passed inspection.

New adversarial checks flip test/calibration outcomes and alter test text:
training IDF/coefficients and calibration thresholds cannot read held-out
information. Group identity prevents normalized duplicates crossing splits.
Queue fixtures have independently calculated start/wait times; resource-time
is checked through a separate timeline integral and per-slot interval sweep.
All four policy combinations preserve identical requested work, including
original source failure labels. Zero-benefit and worse-tail cases stay visible.

Browser regression covers operating budgets, original/synthetic arrival
scenarios, GPU capacity controls, 24-case sweep, reset, JSON/CSV/SVG exports,
responsive layouts, version mismatch rejection, offline use and existing
website functions. Two additional 12-interaction runs passed, one after
responsive resizing. Two long-session runs timed out around real button
clicks without uncaught JS errors; the test now explicitly enters the panel
and settles the restored layout before interaction. The final full run passed
without forced clicks, relaxed assertions or increased timeouts. A definitive
root cause for the earlier timeouts is not claimed.

These are cached-outcome and counterfactual reservation experiments. They
add no measured inference energy, GPU execution times, hardware telemetry or
end-to-end thermal savings. See [PUBLIC_WORKLOADS.md](PUBLIC_WORKLOADS.md).

## Numerical verification extension

The final local release checks passed **43 Python tests**, **43 Node tests**
and **26 Chromium check groups**, with zero uncaught JavaScript errors.
`docs/validation-browser.json` records the browser groups and platform limit.
All three static-bundle checks passed; the original-file/program preservation
test still passes. Original README, PDFs, ZIP files, inline 3D programs,
external destinations and existing canonical evidence are preserved.

The complete fixed-input protocol was rerun against the saved artifact.
Maximum differences in compared temperature, timing, integrated heat and CDU
metrics were all zero in this environment; all eight numerical gates passed.
Cross-environment budgets and the exact protocol are documented in
[NUMERICAL_VERIFICATION.md](NUMERICAL_VERIFICATION.md). CI independently reruns
the protocol with pinned dependencies; no CI pass is inferred from local tests.

Browser regression covers new model/solver controls, deliberately above-target
coarse results, correct NTU/effectiveness definitions, JSON/CSV/SVG exports,
desktop/tablet/mobile layouts, injected incompatible artifact versions,
offline resource fulfillment and all existing simulation groups. Dataset
verification recovery is exercised through four disconnection/recovery cycles.
An initial recovery timeout did not reproduce in the final run; it is not
claimed to have an established root cause. A hidden-details test interaction
was corrected to open the panel before selecting its control. Mixed-version
artifacts are now explicitly rejected and their exports disabled.

The recorded same-equation continuum steady limit is about 71.1206°C.
Of the tested physically aligned grids, 640 cells is the first to meet the
**declared case-specific** 0.05°C steady discretization target. This is not a
recommendation for every simulation. Small time-integration and conservation
residuals establish neither measured predictive accuracy nor transient
continuum convergence. No new experimental observations are added.

## Active static website and scientific extension

### Observable-first research workspace

The supplied research report is applied through `science/validation-model.js`,
the Cooling Validation Workspace and `docs/RESEARCH_VALIDATION.md`. Local
verification passes **35 Node tests** (21 existing + 14 new), **22 Chromium
check groups**, both offline-bundle checks, duplicate-ID and whitespace checks.
The original-file preservation test still passes. The existing scientific
engine and canonical evidence bytes are unchanged.

New checks cover source snapshot identity; calibration/evaluation separation;
unknown measurements/intervals; independent Python-reference predictions;
laminar Re and deliberately incompatible exponent comparison; MAE/RMSE/bias
definitions; stable LMTD and zero-rise limits; separate electrical/liquid heat
bases; missing/invalid inputs; the report's arithmetic inconsistency; and
new JSON/CSV/SVG exports. Real-browser tests also exercise new controls,
source/coverage labels and desktop/tablet/mobile layouts, with zero uncaught
JavaScript errors. `validation-browser.json` records the current check groups.
The managed browser's direct-file restriction remains explicitly unverified.

Pinned repository snapshots establish content provenance, not independent
verification of paper figures. Primary sources/uncertainty remain unverified;
three same-source points are reused for model comparison. There is no claim
of independent experimental validation, new field telemetry, OCP conformity,
new Morris/Sobol results or a deployed release until separately verified.

### Dataset-status improvement based on main `222c65d`

The data-connections panel adds explicit snapshot/simulation/disconnected-telemetry labels, source retrieval dates, a user-requested dataset identity check and a separate JSON verification export. It does not connect hardware, refresh upstream data, modify the scientific engine or change the original simulator programs.

Local verification: all 21 scientific tests pass; `build_evidence.py --check` passes with the unchanged canonical dataset SHA-256; the real Chromium runner passes 19 check groups with zero uncaught JavaScript exceptions. The new browser group verifies no automatic dataset request, independent SHA-256 agreement, JSON-report content, detection of changed bytes even for equivalent JSON, HTTP 503, a disconnected request, recovery, and unchanged scientific inputs/results through all checks. Desktop/tablet/mobile layouts and the existing website regression groups also pass. See `validation-browser.json`. Direct `file://` navigation remains unverified under this environment's administrator restriction. These are local verification results, not a claim that this improvement is deployed or field calibrated.

| Check | Outcome | What it demonstrates |
|---|---|---|
| `python3 scripts/build_evidence.py --check` | PASS | Canonical evidence and offline browser bundle match |
| `python3 scripts/build_evidence.py --refresh --check` with the verified download cache | PASS | All eight pinned upstream file hashes verified; transformations reproduce identical dataset SHA-256 `30e9f847861ef53bda3ed9272ea820914aba57840463a5c2db7c20840ae05e6e` |
| `node --test tests/science.test.cjs` | 21 passed; zero failed/skipped | Paired routing and exclusions; outcome-blind decisions; measured configuration selection and infeasibility; equal-token energy; admission accounting; independent analytical heat balance; zero-demand/capture cases; negative benefit retained; conservation, sensitivity and exports |
| Default CLI experiment repeated and `cmp` against committed summary | PASS | Deterministic parameters/results reproduce the saved default result |
| `node --check science/model.js` and `science/dashboard.js` | PASS | New application scripts parse |
| `tests/browser_smoke.py` with pinned Playwright 1.56.0 and system Chromium | PASS | See `validation-browser.json` for the exact check groups and any platform limitations |
| Local HTTP startup and requests to `/`, evidence bundle, model and dashboard scripts | All 200 | Actual prepared server serves this checkout and required assets |
| `git diff --check`, duplicate static IDs | PASS; no duplicate static IDs | No whitespace errors or duplicate identifiers introduced |
| Original-file/program preservation | PASS | Original README, PDFs, four ZIPs, scale source companions, every original inline JS program and all three external destinations retain their recorded hashes/URLs |

The browser runner verifies existing DOM IDs; live pause/step/restart; three speeds; 3D WebGL and camera/orbit controls; all five scenarios with complete 60-minute A/B histories; all four live parameter sliders; individual strategy switches and enable-all; six experiment presets; minute scrubbing/playback; rack/device selection, GPU maps, history and inspector; thermal cascade; fault injection/reset; finance tabs/calculations; all five original exports and three new scientific exports; all sidebar destinations; scientific inputs, infeasible targets, invalid-input rejection and reset; 1440/768/390-pixel layouts; local documentation/data links; offline startup via local static resource fulfillment; and uncaught JS errors. Existing external sites are not deployed or behaviorally modified by this branch; URL preservation is checked, not their remotely hosted implementations.

Invalid scientific parameters hide stale results and disable exports until valid parameters are supplied. The legacy application programs remain unchanged.

Direct `file://` navigation is blocked by the current system Chromium administrator policy (`ERR_BLOCKED_BY_ADMINISTRATOR`). It is reported as an unverified file-loader check, not a passed direct-file test. Offline tests instead load the exact local static files into an offline browser context through Playwright resource fulfillment; they do not bypass that browser policy. No server/CDN/API is required by the application code. CI may support direct file loading and records its own outcome.

## Archived projects

All archive work was performed in temporary directories. Original ZIP bytes and the active 3D website were not replaced.

| Archived component | Command / scope | Outcome |
|---|---|---|
| Complete outer SEED-cube frontend | `npm ci` using its existing lockfile, then `npm run build` in `SEED-cube/frontend` | PASS: TypeScript + Vite build, 642 modules; existing large-chunk and deprecated three-mesh-bvh warnings retained |
| Complete outer backend | Existing `tests` with its pinned backend requirements | 6 passed |
| Outer backend API | FastAPI 0.115.6 TestClient GET health/config/scene/state, POST simplified-physics simulation | All 200; simulation explicitly reports `is_measured_data: false` |
| Four test files shipped in nested export, against the complete outer backend | Physics/simulation/digital-twin-contract/API suites | 38 tests passed; this is compatibility evidence for the outer backend, not the nested package identity |
| Nested backend reconstructed separately from its own flattened files and configs | Its physics/simulation/digital-twin-contract tests | 30 passed |
| Nested API export | Import/collection of its API suite against its own reconstructed package | **BLOCKED by existing archive defect:** empty `__init__.py` omits `__version__`, while `app.py` imports it. API test collection fails before execution. No nested API tests are claimed passed. |
| OpenModelica, EnergyPlus, coupled solver execution, Docker deployment, real GPU/IoT | Outside the selected static website workflow / not executed | Not claimed validated. Archived solver modes explicitly expose solver-not-executed status. |

The nested package defect is isolated to an untouched archived export and does not affect the root website. It is diagnosed and documented rather than silently patched inside a ZIP or hidden by using the outer package's version metadata.

## Scientific evidence limits

GPU aggregate identities and heat residuals are consistency checks, not independent prediction accuracy. The routing interval is a paired bootstrap over published question outcomes. The heat range is assumption sensitivity, not a confidence interval. No full-site power, greenhouse measured heat series, operational router or hydraulic calibration is available, so field MAE/RMSE remains unavailable. The inaccessible 4TU greenhouse dataset is referenced but has not been imported.

The saved `install_script` and `start_skill` describe the tested static startup, pinned optional browser runner and checks. Draft persistence is confirmed separately from execution in this instance; publishing and startup in a new cloud task still require the platform's review/publish workflow. The GitHub API and 4TU domains were requested in the saved network draft because runtime requests initially received outbound-policy 403 responses.
