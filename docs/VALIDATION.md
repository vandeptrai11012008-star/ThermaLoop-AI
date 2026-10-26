# Validation evidence

Validation applies to the current-instance branch implementation based on main commit `587661bc290e77a1dcbe895bf298e40856ef0e27`. It is development verification, not validation of real-world energy savings. No GitHub Actions result, public deployment, new cloud-task restoration or field measurement is implied by local tests.

## Active static website and scientific extension

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
