# ThermaLoop AI

**An AI-accessible physics sandbox for GPU cooling, liquid loops, heat recovery, and thermal experiments.**

ThermaLoop AI is a research-oriented Web Service where people and external AI agents can build a thermal circuit, change operating conditions, advance a deterministic simulation, inspect physical consequences, and repeat an experiment. The goal is to make physics **testable and interactive**, not simply to animate a dashboard.

## Live Web Service

| Open | Link |
| --- | --- |
| **Main ThermaLoop AI Web Service** | **https://thermaloop-agent-api.onrender.com/** |
| **Physics Lab** | **https://thermaloop-agent-api.onrender.com/physics-lab** |
| Remote agent documentation | [Setup and API access](docs/REMOTE_AGENT_ENVIRONMENT.md) |

> **Deployment:** The live product above is a **Render Node Web Service**, not the older Static Site. The repository's standalone `index.html` remains available as legacy source, but the new physics and API features are served through `scripts/serve-agent-sandbox.cjs`.

## What you can do

- **Build a circuit:** Inspect an isometric schematic generated from the validated topology. Add pipes or thermal tanks, edit component parameters, and reconnect nodes in one closed coolant circuit.
- **Run experiments:** Change GPU load, pump speed, cooling fan, heat recovery, and room setpoint. Step the world by 1, 5, or 10 simulated minutes and compare seeded scenarios.
- **Inspect one canonical state:** The Physics Lab schematic, temperatures, hydraulic flow, pressure, energy metrics, and chart all use the same simulation state.
- **Audit numerical consistency:** Review energy-balance and pressure residuals, limit violations, and downloadable experiment evidence.
- **Connect an AI agent:** Authenticated clients can create worlds, read state, step time, change topology before a run, and collect reports. No hardware is controlled.

**Try it:** Open the [Physics Lab](https://thermaloop-agent-api.onrender.com/physics-lab), insert a thermal tank, run **Step 5 min**, then reset and change the circuit to see how flow and temperatures respond.

## Physics model

The current solver is a **deterministic, reduced-order thermal-hydraulic model**:

| Subsystem | Implemented method |
| --- | --- |
| Pump and flow | Simplified centrifugal pump curve intersected with system pressure losses |
| Pipe friction | Darcy-Weisbach pressure drop, laminar and Haaland turbulent approximations |
| Heat exchangers | Counterflow effectiveness-NTU heat transfer |
| GPU, coolant, room | Lumped thermal capacities and time-stepped energy balances |
| Circuit topology | Validated directed series loop; component order changes stream outlet temperatures |
| Reproducibility | Seeded synthetic disturbances, action trace, residuals, and evidence export |

**Scientific limitations:** This is **not** CFD, a calibrated facility digital twin, or proof of real-world predictive accuracy. Water properties are fixed; one aggregate GPU, one mixed coolant state, and one room are modeled. Branched networks, pressure transients, stratification, experimentally validated component maps, and measured GPU/HX parameters are not yet implemented. Small conservation residuals confirm internal consistency, **not** agreement with real hardware.

The original 64-GPU dashboard includes **illustrative legacy signals**. The main Web Service shows a separately labeled canonical Physics Lab snapshot; legacy animations should not be treated as measured values from the new solver.

Read the [physics equations, assumptions, and validation limits](docs/UNIFIED_PHYSICS_V15.md).

## Remote Agent Environment

Authenticated simulation-only endpoints:

```http
POST   /api/v1/worlds
GET    /api/v1/worlds/{id}
POST   /api/v1/worlds/{id}/step
PUT    /api/v1/worlds/{id}/topology
GET    /api/v1/worlds/{id}/report
DELETE /api/v1/worlds/{id}
```

An external AI agent can **observe -> propose -> simulate -> evaluate -> retry**. Graph edits are validated, topology changes require minute 0, and step requests use `expectedMinute` to reject stale concurrent actions. The API applies Bearer authentication, quotas, and expiring in-memory sessions. Keep credentials **server-side**, never in public page JavaScript.

- [Remote agent setup and security](docs/REMOTE_AGENT_ENVIRONMENT.md)
- [Live OpenAPI contract (Bearer token required)](https://thermaloop-agent-api.onrender.com/api/v1/openapi.json)

## Run locally

Requires Node.js:

```bash
node scripts/serve-agent-sandbox.cjs
```

Open **http://127.0.0.1:8787/physics-lab**. For public hosting, bind `HOST=0.0.0.0` and configure a strong `THERMALOOP_API_TOKEN` in the hosting provider's secret settings. The server refuses unauthenticated public agent access.

## Verification

```bash
node --test tests/*.test.cjs
```

GitHub Actions also runs numerical and physics checks plus pinned-browser tests of the Web Service, topology editing, responsive layout, and experiment behavior. These protect against code regressions; they **do not replace** physical calibration and independent reference measurements.

## Research roadmap

1. **Validate:** Compare matched experiments with measured data and independent physics solvers; publish error metrics and holdout cases.
2. **Improve fidelity:** Add temperature-dependent fluid properties, measured pump/HX maps, explicit GPU/cold-plate thermal nodes, and uncertainty bands.
3. **Benchmark AI discovery:** Compare autonomous agents with PID/MPC or other baselines on repeatable, safety-constrained tasks.
4. **Scale after validation:** Add branched networks, multiple racks, and several building thermal zones.

**Attribution:** If you reuse or present this project, please credit **ThermaLoop AI** and link to this repository. Do not portray simulated results as measured facility data.
