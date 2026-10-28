# ThermaLoop v1.3 — Autonomous Research Lab

v1.3 adds a **bounded, deterministic parameter-search agent** to the existing synthetic thermal sandbox. It evaluates 2–30 candidate control configurations and selects the strongest **eligible** training-seed result. Eligible means: no declared temperature, ventilation or power violations in the nominal run and two model-parameter sensitivity runs; at least 99% of baseline compute-service proxy retained in all three; and thermal energy accounting passed. A lower electricity result alone is **not** a valid solution.

This release does **not** contain a large language model, learned controller, Bayesian optimizer, reinforcement learner, building telemetry, high-fidelity thermofluid solver or real equipment connection. The numerical physics engine is still v1.1.0, an uncalibrated three-temperature RC plant. `hardwareAuthorized` remains `false` in every report.

## Browser research workspace

Open the main website and visit `#agent-research` under **AI Research Lab → Autonomous research**. Set the scenario, seed, horizon (maximum 120 simulated minutes) and number of trials (maximum 30). Press **Start bounded search**. The research engine runs in a disposable Web Worker and reports trial progress; **Cancel search** terminates the worker. This website mode is **browser-local**: it does not call a hosted API, need or read an API key, save a permanent report to Render, or run server-side AI work.

The output explicitly lists every candidate, eligibility, training-seed electricity difference, service ratio and two held-out seed checks. A positive training outcome is not called an independently validated improvement unless both holdouts also pass the declared envelope and achieve strictly positive energy savings. Two seeds cannot establish statistical confidence or real-world safety. The best plan can be copied into **Control experiments** for interactive inspection and its complete report exported as JSON.

The first candidate is the unchanged baseline. Remaining candidates use deterministic, low-discrepancy parameter sampling of GPU cooling-pump percentage, dry-cooler fan percentage, heat-recovery percentage, and heating setpoint. This is a sampled search, **not a proof of optimality**. GPU power limit stays at 100%; ventilation stays at 0.6 ACH to avoid claiming savings from curtailed computational work or deficient occupied ventilation. Any chosen plan is evaluated against the same baseline load and weather seed. The training seed alone selects a winner; two untouched seeds are then evaluated without changing that selection.

## Authenticated Remote Research API

The optional Node Web Service exposes `POST /api/v1/research/optimize` to trusted agents with the same Bearer-key authentication as the other `/api/v1` routes. It runs in a bounded worker with a 15-second timeout and global concurrent-worker limit, at most **2 research requests per minute per principal**, and 64 KiB maximum JSON body. It returns complete JSON evidence without persistent server research-job storage.

Example body:

```json
{
  "schemaVersion": 1,
  "scenario": { "preset": "winter", "seed": 42, "horizonMinutes": 60 },
  "trials": 20
}
```

Use a **server-side private client** to call this endpoint over HTTPS with `Authorization: Bearer YOUR_SECRET`. Never embed the secret in the website, browser code, screenshots, logs or a Git commit. The browser page uses the same physics/research JavaScript locally; it does **not** gain access to your protected server API when you load the site.

The response includes `trialCount`, `eligibleCount`, `trials`, `best`, `bestReport`, `holdouts`, `passedHoldouts`, `validatedImprovement`, `limitations` and `hardwareAuthorized:false`. A result can have `best:null` when no candidate is eligible; negative electricity savings may be reported honestly. Callers must not interpret a non-null `best` as global optimum or physical deployment approval.

## Reproduction and limits

```sh
node scripts/build_agent_contract.cjs --check
node --test tests/*.test.cjs
node -e "const r=require('./science/agent-research-model.js').run({scenario:{preset:'winter',seed:42,horizonMinutes:60},trials:20}); console.log(r.best?.energySavedKWh,r.validatedImprovement)"
```

The entire result is reproducible from its `config` and selected plan. Holdouts use seed `(trainingSeed + 1973) modulo 2^32` and `(trainingSeed + 7919) modulo 2^32` on the same preset and horizon. The printed metric is an illustrative energy difference in a synthetic, uncalibrated plant; it is not calibrated GPU or building field evidence.

Render Free Web Services may sleep or restart; API episodes and research requests are not durable research archives. Export reports, and use durable storage, authentication for human web users, and controlled background job scheduling before enabling longer and more expensive runs. Future work includes an optional LLM research planner and independent validation against measured data or reference simulators (such as BOPTEST). No LLM credentials are required for v1.3.
