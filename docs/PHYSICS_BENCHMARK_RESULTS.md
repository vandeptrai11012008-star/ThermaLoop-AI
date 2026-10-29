# Physics Lab controller benchmark — initial published run

Generated with `node scripts/benchmark_unified_physics.cjs` using the default
matrix, `unified-physics.js` engine `1.5.0`. All 150 60-minute episodes ran
successfully. The ten cases and five seeds are enumerated in the protocol;
all controllers received the same initial state and disturbances in each
paired experiment. This is a **simulation-only software result**.

| Controller | Mean site electricity (kWh) | Mean compute service (h) | Mean recovered heat (kWh) | Cases with any violation / 50 |
| --- | ---: | ---: | ---: | ---: |
| Fixed baseline | 37.744 | 0.7997 | 0.0973 | 5 |
| Current-temperature threshold | 37.002 | 0.7711 | 0.0973 | 5 |
| Five-minute temperature trend | 36.865 | 0.7657 | 0.0973 | 5 |

Scenario-clustered paired differences from fixed baseline (mean; 95% bootstrap
range, 1000 deterministic replicates):

| Controller | Electricity difference (kWh) | Compute-service difference (h) |
| --- | ---: | ---: |
| Threshold | -0.742 [-2.140, 0.000] | -0.0286 [-0.0822, 0.0000] |
| Trend | -0.879 [-2.423, 0.000] | -0.0340 [-0.0930, 0.0000] |

**Interpretation:** lower electricity is accompanied by lower compute service;
both candidates had **exactly the same violation incidence** as baseline. The
results therefore **do not demonstrate a safety improvement or a generally
superior AI control strategy**. Both candidates are transparent rules, not
trained machine-learning agents. The bootstrap ranges include zero, and the
underlying world is uncalibrated, so no real-world prediction claim is justified.

Absolute internal conservation checks were tiny (worst reported numerical
energy residual below `4e-10 kJ`, hydraulic head residual below `1e-10 Pa`).
These are equation/implementation closure checks, **not field validation**.

For the full per-episode results, rerun the command above; it emits all case
IDs, seeds, initial states, temperatures, violations, energy, compute and
residuals as JSON. Re-running on the same engine must produce byte-for-byte
equivalent data. The full report is intentionally generated on demand so
derived snapshots cannot silently become stale after engine changes.

## What remains before a research-grade claim

- More meaningful safety and throughput objective functions, with explicit
  Pareto analysis rather than selecting a low-energy winner by itself.
- Untouched, varied holdout cases for an actual external AI agent and an MPC
  controller under an identical action and observation protocol.
- Independent thermal/hydraulic reference comparisons and real measurements,
  with MAE/RMSE and quantified uncertainty.
- A validated multiple-loop engine before relating any result to the separate
  six-floor Digital Twin.

See [benchmark protocol](PHYSICS_BENCHMARK.md).
