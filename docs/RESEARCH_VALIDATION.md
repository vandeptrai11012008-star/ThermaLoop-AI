# Cooling validation workspace: methods and research-report review

This additive workspace implements the supplied research report's observable-first method. It leaves the original 3D simulator, its inline programs, linked websites and existing evidence experiment engine unchanged. It does not import an operational digital twin or the complete `Walla17x/thermaloop` solver into this website.

## What the report supports and what is still unverified

The user-supplied brief has SHA-256 `41d477ed47f739955a9dc7167561b5beeb08a3ae4ef560b58f35929c961edb74`. Its unresolved `turn…search…` citation tokens are not independently accessible references. DOI/NSF/manufacturer/OCP URLs were extracted as candidate references. Attempts to retrieve Crossref metadata, OCP, NSF and Xylem material returned environment proxy HTTP 403. No primary PDF hash, independent digitization or raw-data license is therefore asserted for those references. This is a retrieval limitation of this environment, not a claim that the publications are unavailable publicly.

The report's illustrative YAML contains an arithmetic inconsistency: `Tin=32°C`, `surface=85°C`, `Q=750 W` imply `(85−32)/750 = 0.0706667 K/W`, whereas the example lists `0.085 K/W`. It is treated as an illustrative example to check, never imported as an experimental operating point. With those power/inlet values, `0.085 K/W` would imply a surface temperature of `95.75°C`.

The report's suggested future statement about multiple independent experimental sources is a goal, not a current result. Its example 24-point dataset, proposed acceptance thresholds, Morris/Sobol outputs, pump/system intersections, uncertainty coverage and four-week schedule are not implemented measurements or validation outcomes. No OCP/ASME conformity or certification is claimed. Different PG concentration bases (mass versus volume) are not silently interchanged.

## A reproducible, qualified cold-plate comparison

Three small repository snapshots are pinned to `Walla17x/thermaloop` commit `3a5ffe9fa127b5810b712fff2dcfe7e81f30753f`:

- `configs/validation/villanova_coldplate.yaml`: repository-supplied four-point digitization and source notes.
- `thermaloop/fluids.py`: the existing engineering water/PG25 property approximations.
- `LICENSE`: original MIT notice, retained verbatim as `science/validation/UPSTREAM-LICENSE`.

URLs, SHA-256 hashes, normalized point records, unavailable quantities and candidate-source statuses are in `science/validation/research.json`. The snapshots are preserved under `science/validation/`. Hash identity verifies repository content, not the original paper's measurements or their extraction. Underlying publication data rights are not established by the repository's software license.

The upstream digitization describes Cold Plate S plus TIM, using an inlet-referenced Fourier-extrapolated case temperature; it is not a GPU die resistance. Source figures, as reported by the repository, are 6(a)/8(a)/9(a), grease TIM, 15 PSI, 32°C inlet, 1000 W. The four reported pairs are `(1,0.0415)`, `(2,0.0370)`, `(3,0.0350)`, `(4,0.0340)` in L/min and K/W. Exact primary tables, PDF hash, digitizer version and raw extraction coordinates remain unavailable. Source estimates ±0.002 K/W digitization and ±10% measurement uncertainty are retained as **unverified reported estimates**, without an assumed confidence level or independent covariance model.

The fixed-property model is evaluated at 32°C using the pinned PG25 approximation, whose concentration is assumed 25% by mass. The paper's concentration basis is not independently confirmed. No measured property values or thermal conductivity are invented.

```text
m_dot[kg/s] = flow[L/min] × 1e-3 / 60 × rho[kg/m³]
UA_cal[W/K] = 1 / R_LMTD_reported[K/W]
epsilon = 1 − exp(−UA / (m_dot cp))
R_model = R_fixed + 1 / (epsilon m_dot cp)
UA(flow) = UA_cal × (m_dot/m_dot_cal)^exponent
```

`R_LMTD_reported=0.023 K/W` and the 2 L/min point determine `R_fixed`. This one calibration point is excluded from metric scoring. The three other points evaluate exponents 0, 1/3 and 0.8, **but are reused for model selection**. They are not an untouched validation set or an independent laboratory test. The website consequently displays one calibration point, three same-source evaluation points, and zero independent validation points.

Channel Re is derived using the declared 120 rectangular channels, width 0.2 mm, height 4 mm, length 43 mm, and the pinned viscosity approximation:

```text
Dh = 2 width height / (width + height)
Re = m_dot Dh / (N_channels width height mu)
```

The envelope is laminar under that model. Exponent 0.8 is an explicitly labeled incompatible turbulent comparator. Exponents 0 and 1/3 compare empirical UA sensitivities; the absence of conductivity prevents thermal entrance-state determination. A successful constant-UA fit does not establish fully developed flow or a universal laminar law. No model choice changes the earlier 3D campus.

## Residual definitions and plots

Only the three same-source evaluation points contribute to:

```text
e_i = prediction_i − repository_digitization_i
bias = mean(e_i)
MAE = mean(abs(e_i))
RMSE = sqrt(mean(e_i²))
NRMSE_range = RMSE / (max(observed) − min(observed))
relative_RMS[%] = 100 sqrt(mean((e_i/observed_i)²))
```

Range-normalized RMSE and relative RMS are different quantities and are labeled separately. A zero observed range makes NRMSE unavailable; MAPE is unavailable when observations are at or below the declared digitization floor. No numerical error bars, bootstrap confidence interval, statistical coverage or prediction interval are fabricated from three reused evaluation points.

The predicted-versus-reported SVG uses a square for calibration, circles for evaluation, and a 1:1 line. It deliberately does not display the unverified uncertainty estimates as confidence/prediction intervals. Exports contain point roles, units, residuals, source URLs, hashes and scientific limitations.

## Interactive observable calculations

The default calculator values are an explicitly illustrative case, not an experiment. Optional blank values remain `null`. Heating requires `Ts > Tin` and, if outlet temperature is supplied, `Tin ≤ Tout < Ts`.

```text
R_Tin,electrical[K/W] = (Ts − Tin) / Q_electrical
Delta_in = Ts − Tin; Delta_out = Ts − Tout
LMTD[K] = (Delta_in − Delta_out) / ln(Delta_in/Delta_out)
R_LMTD,electrical[K/W] = LMTD / Q_electrical
Q_liquid[W] = m_dot cp (Tout − Tin)
heat_capture_fraction = Q_liquid / Q_electrical
UA_liquid[W/K] = Q_liquid / LMTD
epsilon_isothermal = (Tout − Tin) / (Ts − Tin)
```

LMTD uses `log1p` and the equal-temperature limit for numerical stability. Liquid and electrical heat bases are kept separate; `1/R_LMTD,electrical` equals liquid UA only when absorbed liquid heat equals electrical input. Heat capture above 100% remains visible as an inconsistency to investigate, without clipping or silently inventing a heat-loss correction. Agreement is arithmetic consistency, not experimental validation. No tolerance is attributed to an authority when sensor/experimental uncertainty is missing.

An invalid input clears the current calculator result; JSON exports then carry a null calculation and an explicit error rather than stale values. The separate point-comparison export remains available. The main evidence experiment inputs/results are independent.

## Reproduce and verify

```sh
python3 scripts/build_evidence.py --check
python3 scripts/build_validation.py --check
node --test tests/*.test.cjs
```

The validation builder verifies the immutable snapshots and normalized point/geometry/calibration values before checking the offline bundle. It never executes downloaded Python source. No new runtime dependency or scientific CDN is required.

To reproduce the three comparisons without the browser:

```sh
node - <<'JS'
const V = require('./science/validation-model.js');
const D = require('./science/validation/research.json');
for (const n of [0,1/3,0.8]) {
  console.log(JSON.stringify(V.benchmark(D,n),null,2));
}
JS
```

`tests/validation.test.cjs` checks analytical heat/LMTD limits, missing data, overflow, the illustrative-report inconsistency, partition separation, independent Python-reference predictions, dimensional Re, metric definitions, source hashes and exports. The existing Chromium regression additionally exercises new controls, null/invalid states, all new exports and responsive layout alongside the original 3D/controls/GPU/finance/export tests. Historical README, PDFs, ZIPs, linked destinations and original inline programs are preserved.

## Remaining work

Primary-paper retrieval and extraction review come before promoting a reference into verified experimental coverage. Independent thermal/hydraulic datasets and synchronized transient measurements are still missing. Pressure boundary/tare tests, measured pump curves, coolant-specific calibration and interval coverage cannot be inferred from the source registry or numerical heat balance. Candidate references and research recommendations remain clearly distinct from implemented evidence.
