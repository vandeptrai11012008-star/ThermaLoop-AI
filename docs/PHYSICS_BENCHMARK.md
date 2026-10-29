# ThermaLoop Physics Lab — Reproducible Controller Benchmark

This benchmark is a **synthetic experiment**, not evidence that ThermaLoop
predicts real-world equipment accurately. It uses the same production
`service/unified-physics.js` solver and explicitly reports its version.

## Research question

Given the same virtual circuit, initial conditions, disturbances and action
bounds, how do three transparent control policies trade off simulated
electricity, compute service, useful recovered heat and thermal violations?

## Protocol

Open the public Web Service's **Physics Lab → Controller benchmark** to run
the short 30-episode preview or full 150-episode comparison directly in a
browser worker, inspect the table and download the full JSON evidence. The
browser and CLI share the exact same `service/unified-benchmark.js` code and
`service/unified-physics.js` engine. No Bearer token is embedded in browser
JavaScript, and running the benchmark does not change the interactive world's
state or submit expensive unauthenticated server tasks. It always uses the
standard reference topology; user-edited circuits are not benchmarked.

Alternatively, run `node scripts/benchmark_unified_physics.cjs` from the repository root. It
prints a machine-readable JSON report. The default matrix has **10 scenario
configurations × 5 seeds × 3 policies = 150 paired episodes**, each 60 simulated
minutes. The configurations are predefined winter, summer, workload-burst and
pump-degradation variants. Each seed/preset pair is identical across policies.

- `fixed`: fixed nominal pump, fan, heat recovery and GPU-load settings.
- `threshold`: observes current GPU/coolant temperatures and reacts at fixed
  thresholds. This is a rules-based comparator, **not** a trained AI agent.
- `trend`: uses only the current and previous observed temperatures for a
  bounded five-minute linear extrapolation. This is neither a learned agent
  nor a formal Model Predictive Controller.

All policies observe the **same filtered sensor fields**. The evaluator does
not reveal future forcing, simulator seed, preset or heat-capacity parameters
to them. The script is self-contained and does not use OpenAI/Kiro credits,
external data, paid services or real hardware. Its deterministic tests are in
`tests/unified-benchmark.test.cjs`; the browser flow is checked in
`tests/browser_unified_lab_service.py`.

Reported metrics include electricity (kWh), compute-service hours, recovered
heat (kWh), peak temperatures, safety-limit violation codes, energy balance
residual (kJ) and hydraulic pressure residual (Pa). The report includes every
episode and scenario-clustered paired bootstrap intervals. A lower electricity
number is **not automatically an improvement** if a controller sacrifices
compute service or thermal safety; interpret all metrics together.

## Fairness and limitations

1. Different controllers act on the *same* seeded world for each pair. No
   controller reads hidden scenario names, seeds or future disturbances.
2. Episodes advance one simulated minute per decision; controller logic is
   deterministic, inspectable and has no external knowledge access.
3. This is an **in-model comparison**. Because the virtual world and its
   defaults remain uncalibrated, low residuals and paired confidence intervals
   do not establish accuracy in °C, kW or Pa on real equipment.
4. Scenario clusters are resampled for intervals to avoid treating five seeds
   from one scenario as independent real experimental setups. Ten scenarios
   still provide limited coverage.
5. The current solver describes one serial fluid circuit, one aggregate GPU
   and one occupied room. Results do not transfer automatically to the separate
   six-floor Digital Twin or to physical hardware.
6. This benchmark does **not** test autonomous learning, LLM planning, or
   generalization to unknown hardware. Those require separate controlled
   experiments and independent validation.

## Next research milestones

1. Include a constrained MPC and a *real* remotely acting agent under this
   exact input/action/budget protocol, then evaluate on untouched holdout cases.
2. Calibrate pump/heat-exchanger/building parameters against measured or
   independently simulated reference trajectories, reporting RMSE/MAE and
   uncertainty bands on held-out time periods.
3. Replace the single-loop approximation with a verified multi-branch,
   two-circuit model before claiming six-floor Digital Twin parity.
