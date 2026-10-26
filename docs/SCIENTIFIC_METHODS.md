# Scientific evidence and reproducible experiments

This extension turns public records into inspectable experiments. It does **not** establish a field-validated operational digital twin. The earlier 3D model, GPU simulator, diagnostics, finance lab, and linked websites retain their existing behavior. The original README, PDFs, ZIPs, inline JavaScript programs and standalone scale files are unchanged.

## Reproduce locally

The website remains a static application. Open the root `index.html`, or run `python3 -m http.server 8000` in the repository. No API credentials, GPU, backend, npm install, build step, CDN or network is required to use the bundled scientific dashboard.

```sh
python3 scripts/build_evidence.py --check
node --test tests/science.test.cjs
node scripts/run_experiments.cjs --output /tmp/thermaloop-experiment
```

Python 3.12 and Node 22+ are supported. The last command writes the full paired records, hourly heat scenario, assumptions, source metadata, CSV and summary. The committed `science/results/default-summary.json` is the deterministic default result, not a measured ThermaLoop deployment. Browser controls recompute the same engine with their selected assumptions. Direct file:// startup is supported by the static design but could not be validated in this managed Chromium instance: administrator policy blocks local file navigation. Offline startup is separately checked in an offline browser context with local static resource fulfillment; no policy is bypassed. JSON is the full reproducibility export; CSV contains KPIs, all parameters and provenance. SVG exports a standalone heat-scenario plot.

For browser regression, install `requirements-dev.txt` in a virtual environment, then run `python tests/browser_smoke.py`. Use system Chromium when available; otherwise install the Playwright browser with `python -m playwright install chromium` (requires its download domains). The runner starts and stops its own local server. Screenshots, eight downloaded exports and the report go to `/tmp/thermaloop-browser-results`. CI runs the same checks. Local CI configuration has been added; a GitHub Actions run is not claimed until GitHub executes it.

## Provenance and refresh

The **Data connections** panel distinguishes the pinned scientific snapshot, the synthetic 3D campus, and disconnected field sensors. Its displayed retrieval date is when source files were downloaded, not when the upstream measurements were made. Historical benchmark and TMY records do not become current telemetry because they were recently downloaded.

**Check dataset sync** is an optional same-origin consistency check. Only a user click fetches `science/data/evidence.json` with browser cache bypass and a 10-second timeout. Web Crypto SHA-256 and byte length are compared against metadata generated alongside the loaded offline bundle. A match establishes byte identity with that served dataset, not upstream freshness, whole-site deployment identity, authenticity independent of the hosting origin, scientific correctness or hardware connectivity. Deployments or caches containing different snapshots produce a mismatch; HTTP, network, timeout and unsupported-browser failures are reported as unavailable. The check never imports the response or changes scientific inputs. Offline experiments continue to use their bundled data.

**Export data status · JSON** records the source catalogue and retrieval dates, expected and observed hashes/byte lengths, check state and client UTC timestamp, and explicit disconnected-telemetry status. It is a separate verification report; existing scientific-result exports and numerical experiments retain their schema and values.

`science/data/sources.json` pins eight source files to full upstream Git commits, with original byte counts, SHA-256, retrieval date, classification, caveats, attribution and research links. `scripts/build_evidence.py --refresh` retrieves those exact URLs, verifies the expected bytes, applies documented filters, and rebuilds the canonical `science/data/evidence.json` and offline script bundle. A mismatched checksum is an error; the importer does not update expected checksums. Default builds use committed numeric data and work offline. Source file hashes establish content identity, not correctness of the upstream science.

The small GPU, heat-pump and greenhouse reference files are preserved byte-for-byte. Bulky routing responses, original trace CSV and annual weather are reduced by the importer. Prompts and generated answers are omitted; routing records retain original zero-based row indices, prompt SHA-256 prefixes and both correctness outcomes. Selected scheduling records retain original IDs, requested milli-GPUs and creation times. Weather records retain source timestamps and unmodified selected values. The full annual input has 8,760 rows; this version uses 168 hours from January 1–7 and 168 from July 1–7. No request, climate, power or outcome record is invented to fill missing data.

Source research links were identified and cross-checked through the retrieved upstream repositories. This does not mean every linked paper or manufacturer PDF was independently downloaded: the environment initially blocked arXiv, DOI, 4TU and manufacturer destinations. Sources, limitations and licensing status are visible in the website. See `science/data/ATTRIBUTION.md` for notices.

## Additional public-workload lab

The additive [Routing & Scheduling Lab](PUBLIC_WORKLOADS.md) now trains a
small hashed-TF-IDF/ridge router on a separate training partition and evaluates
its frozen calibration thresholds on held-out cached GSM8K outcomes. It also
adds a time-dependent, four-policy GPU reservation replay using the Alibaba
trace's lifecycle intervals as explicitly qualified duration proxies. This is
separate from the original four experiments below: their data, defaults and
results remain unchanged. It is not a trained RouteLLM reproduction, measured
GPU execution or end-to-end deployment validation.

## Finite-capacity physical extension

[The two-stream CDU model](FINITE_CAPACITY_PHYSICS.md) replaces the ideal
primary bath in a separate explicit 1D reference option. It includes finite
primary enthalpy flow/storage, counterflow transport and a declared return
buffer; paired model cases, analytical limits, energy accounting and grid
error are inspectable on the website. The earlier engines/results below
remain unchanged. This supplies no new field observations or 3D validation.

## Four independent experiments

### 1. Routing: published outcome replay

Source: RouteLLM GSM8K response CSV, following its upstream prompt-contamination exclusions. The input has 1,319 questions; 12 are excluded, leaving 1,307 matched GPT-4-1106-preview / Mixtral-8x7B-Instruct-v0.1 correctness records. These are cached benchmark evaluation outcomes, not new inference measurements made here.

Baseline uses the GPT-4 result for every question. The candidate chooses Mixtral with a user-selected probability using a fixed pseudorandom stream. Decisions have no access to either correctness label. This is a **random-routing control**, not a trained RouteLLM router, a complexity predictor, or a reproduction of the paper's learned-router results. No trained-router score cache was bundled upstream. Random routing offers a truthful counterfactual with the available paired outcomes; learned routing requires its model, embeddings, calibration and held-out evaluation in a future experiment.

Accuracy is correct questions / all questions. Differences are paired per question. A deterministic 1,000-resample percentile bootstrap reports the 95% interval for the mean accuracy difference, conditional on the routing decisions. It reflects question-sampling variability, not deployment shift, router-seed variability or judge uncertainty. There is no training on this test set. The default control degrades accuracy; this is retained rather than hidden. No energy, API cost or request latency is assigned to GPT-4/Mixtral using the separate Llama benchmark.

### 2. GPU scheduling: resource-packing ablation

Source: Alibaba GPU trace v2023, accompanying Weng et al., USENIX ATC 2023, *Beware of Fragmentation*. Of the source's 8,152 task rows, select requests with exactly one GPU, no GPU-type constraint, and a valid request in 1–1,000 milli-GPUs. Sort by creation time and then ID; retain the first 256. The same ordered requests enter both arms.

Baseline is first-fit admission into identical 1,000-mGPU slots; candidate uses best-fit. Rejected admission means pending, not completed, failed or dropped work. We report submitted/admitted/pending counts and allocated requested capacity. Check allocated + residual capacity = installed capacity, nonnegative per-GPU residuals, and submitted = admitted + pending.

This is a static packing ablation. It does not run jobs, replay departures, enforce CPU/RAM/GPU-memory requirements, implement fractional-GPU isolation, measure utilization or energy, or reproduce a thermal scheduler. It does not establish the original paper's FGD results. Equal and worse outcomes are valid. There is no duration-to-energy conversion from this trace and no claim that the 64-GPU campus has these Alibaba devices.

### 3. GPU power and batching: measured operating envelope

Source: ML.ENERGY benchmark/leaderboard, NeurIPS Datasets and Benchmarks 2025, arXiv:2505.06371. Retain all 23 H100 configurations for `meta-llama/Llama-3.1-8B-Instruct` (one H100 per replica) and `meta-llama/Llama-3.1-70B-Instruct` (four H100 per replica), `lm-arena-chat` task. Raw exports also contain B200 measurements, which are not silently mixed into these experiments.

Baseline is the selected measured max-sequences setting. Candidate minimizes published GPU J/output-token among measured settings whose published P95 inter-token latency meets the selected limit. An impossible limit returns **no feasible configuration**. ITL is not TTFT or end-to-end request latency.

Both arms project to exactly the same output-token budget:

```
E_GPU[kWh] = N_output_tokens × published_J_per_output_token / 3,600,000
t[s]      = N_output_tokens / published_output_tokens_per_second
check: J/output_token ≈ aggregate_GPU_W / output_tokens_per_second
```

This substitutes published operating points for invented power/throughput curves **within this source-specific experiment**. It does not transplant H100 measurements into the unidentified synthetic GPU model in the legacy 3D campus. GPU power is aggregate board power for the measured GPU group, not full-site power. Energy includes the measured benchmark's prefill/amortized operating cost, normalized by generated output tokens. Model output lengths vary with configuration; equal-token projection is not identical per-prompt quality or identical end-to-end workload. Selection on the same runs is optimistic and is explicitly not held-out validation. Replicate distributions, calibration error and measurement uncertainty are absent from the leaderboard export; we do not fabricate error bars.

### 4. Heat recovery and greenhouse: explicit reduced-order scenario

The published geometry from GreenLight/Katzin 2020 Table 1 is floor 144 m², cover 216.6 m² and mean height 6.2 m. Applying it to Chicago TMY3 is a counterfactual, not the original Bleiswijk experiment. TMY3 is an assembled historical typical year, not a simultaneous continuous weather measurement from a ThermaLoop site.

The envelope U value, infiltration, solar transmission, air setpoint, heat-capture fraction, exchanger effectiveness, continuously busy replica count, common electrical overhead and pump power are editable assumptions. Approximate air density is 1.2 kg/m³ and specific heat is 1.005 kJ/(kg K). Water specific heat is approximated as 4.18 kJ/(kg K).

```
V = A_floor × mean_height
UA[kW/K] = U[W/(m² K)] × A_cover[m²] / 1000
ventilation[kW/K] = rho_air × cp_air × ACH × V / 3600
Q_demand[kW] = max(0, (UA + ventilation) × max(0, T_set − T_out)
                       − solar_transmission × GHI[W/m²] × A_floor / 1000)
```

The weather source labels hourly GHI as Wh/m²; for one-hour bins its numerical value is the mean W/m². The source timestamps are copied exactly. The source contains repeated initial weather values; they are retained, not interpolated. There is no crop-yield, latent-heat, transpiration, screen, soil thermal mass, actively controlled ventilation or greenhouse temperature-prediction model here. The heat demand is a steady balance at an assumed setpoint.

The LBNL Modelica Buildings Trane Axiom EXW240 record supplies nominal heat output 77,000 W and electric input 18,000 W at source 18°C and load 53°C, water flow 1.893 kg/s. Their ratio is COP 4.2777778. **The record's prose comment states COP 4.10; we disclose this disagreement and use Q/P from the actual record fields.** We do not imply a new manufacturer measurement. Constant use of this nominal point away from the reference temperatures is an assumption. The legacy simulator's 3.4 COP is left visibly synthetic because the new catalogue unit does not establish its actual equipment or 64°C operation.

Baseline and candidate have identical continuous IT power, calculated from the selected *baseline* GPU measurement × assumed replicas, and identical weather/heat demand. The thermal scenario deliberately isolates heat recovery from routing and batching changes. With the 70B selection, 64 replicas means 256 GPUs, which is disclosed and does not alter the 3D campus.

```
Q_captured = P_GPU × capture_fraction × exchanger_effectiveness
Q_hot = min(Q_demand, 77 kW, Q_captured × COP/(COP−1))
W_HP = Q_hot / COP
Q_source = Q_hot − W_HP
Q_backup = Q_demand − Q_hot
Q_rejected = P_GPU − Q_source
E_baseline = sum(P_GPU + common_overhead + Q_demand/COP_baseline) × 1 h
E_candidate = sum(P_GPU + common_overhead + W_HP + secondary_pump
                  + Q_backup/COP_baseline) × 1 h
```

The secondary pump runs only while delivering recovered heat. The default baseline is resistance heating at COP 1; an efficient electric heat-pump baseline can reverse the apparent benefit. Recoverable source heat is constrained, the nameplate output is capped, backup supplies residual demand, and heat is not subtracted from the electric budget a second time. No tank is present in this separate experiment. The model does not establish off-design heat-pump capacity, hydraulic delivery feasibility or actual temperature lift. The original serial 3D cascade is preserved and is not represented as validated by this energy balance.

For every hour check: GPU power = used source heat + rejected heat; source heat + HP electricity = hot output; hot output + backup = demanded heat. A residual under 1e-9 kW is a numerical consistency check, not field accuracy. No greenhouse prediction MAE, RMSE or confidence interval is asserted without measured targets.

A 27-point sensitivity grid multiplies U value, liquid capture fraction and nominal COP independently by 0.8, 1.0 and 1.2 (capture capped at 1). The resulting extrema are assumption sensitivity, **not a statistical confidence interval or a guaranteed bound**. Other assumptions, including greenhouse physics and actual heat-pump lift, remain unquantified.

## Default results and interpretation

The committed summary gives the exact current output. Rounded default outputs:

| Experiment | Baseline | ThermaLoop candidate | Interpretation |
|---|---:|---:|---|
| Routing accuracy | 85.77% | 74.37% | Seeded random-routing control loses 11.40 percentage points; no learned-router claim |
| Static packing | 23 admitted / 233 pending | 23 admitted / 233 pending | No admission improvement at 16 assumed GPU slots |
| 1 million projected output tokens, Llama 8B | 0.12633 kWh at max-seqs 8 | 0.02129 kWh at max-seqs 256 | GPU-only operating-point projection; P95 ITL 8.00 → 38.75 ms; not site savings |
| January heat scenario, 168 hours | 10,923.23 kWh | 7,697.97 kWh | Uncalibrated scenario; nominal reference COP, identical IT, resistance-heating baseline |

The heat scenario's modeled electricity difference is 3,225.26 kWh/week; the specified sensitivity range is 2,402.51–4,058.51 kWh. These are **not measured savings** and must not be annualized or combined with the routing or GPU projection. Results can change sign under different baseline heating assumptions.

## Outstanding measured validation

The upstream GreenLight project identifies the Bleiswijk measured data at <https://data.4tu.nl/datasets/78968e1b-eaea-4f37-89f9-2b98ba3ed865>. Access was blocked by the environment's outbound policy during this implementation, so the greenhouse measured energy series has **not** been imported. The dashboard says so. It uses published geometry and historical weather without claiming calibrated greenhouse performance.

A field twin still needs synchronized GPU and site meters, validated serving measurements, independently measured primary/secondary heat and flow, actual pump/COP curves, greenhouse demand/temperature records and sensor error specifications. Use held-out periods for MAE/RMSE and confidence analysis. No secret values, invented sensors, fake GPU traces or paper headline savings are substituted for these missing measurements.
