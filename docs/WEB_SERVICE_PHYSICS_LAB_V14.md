# ThermaLoop Web Service v1.4 — Physical Simulation Lab

Only the Node **Web Service** serves the new `/physics-lab` route. The original
`index.html`, old Static Site frontend and `science/` physics/model source files
are unchanged by this release. The Node server injects a shortcut into its own
homepage response. A previous Render Static Site is **not a deployment target**.
If it tracks the same Git branch, it can receive repository files automatically,
but its original navigation never loads or links this Web Service-only lab.

## What the lab is

The lab is a stateful browser-local experiment driven exclusively by
`ThermaAgentSandbox.startEpisode`, `observeEpisode`, `stepEpisode` and
`episodeReport`. Its isometric topology shows **one aggregate GPU temperature,
one well-mixed coolant temperature, and one room temperature**. These are the
three numbers calculated by the synthetic plant, not 64 separately simulated
GPU thermistors, distributed fluid temperatures or CFD. It supports:

- Start/reset with preset, seed and 1–120 simulated minute horizon.
- Step by 1 or 5 minutes with explicit pump, fan, heat recovery and heating
  setpoint patches; GPU power remains 100% and ventilation remains 0.6 ACH.
- Run ten explicit rule-based feedback steps, inspect an exact trace and export
  the replayable episode report. Historical inspection does **not** modify the
  active episode. An unavailable historical cumulative electricity reading is
  rendered as unavailable, never substituted with the final total.
- Run a deterministic bounded, **terminal-matched** candidate search in a
  disposable Web Worker and export full evidence.

The old 64-GPU campus still uses its own illustrative model. It is not
relabelled as physically synchronized with the three-state Agent plant.

## Fairer research comparison

`service/validated-research.js` uses the **same** synthetic physics engine and
candidate generator as v1.3. It adds nominal end-state matching against the
identical-seed baseline, with intentionally declared tolerances:

| Thermal state | Maximum absolute final temperature difference |
| --- | ---: |
| Aggregate GPU | 5 °C |
| Mixed coolant loop | 5 °C |
| Occupied room | 0.5 °C |

Candidates need to pass the existing physical envelope (nominal plus two model
sensitivity cases), retain compute-service proxy and meet these **nominal**
terminal tolerances. The holdouts must also meet all those conditions and have
positive electricity savings to claim an improvement within the tested model.
This is a **comparability guard, not validated site physics**. Stress-case
terminal temperatures are not supplied by v1.1.0 engine, so terminal matching
is not yet checked across the stress variants. The report includes final
temperature differences and a transparent thermal carryover calculation,
without converting stored thermal energy into invented electrical savings.

On a fixed illustrative 60-minute winter scenario with seed 42 and 30 sampled
candidates, v1.3's largest *raw* energy reduction is about 9.70 kWh, whereas
the best nominal end-state-matched eligible candidate is about 2.92 kWh. Neither
value should be extrapolated to an actual facility.

## Remote AI API

The Web Service exposes the new authenticated endpoint:

`POST /api/v1/research/validated`

Request format matches `/api/v1/research/optimize`:

```json
{"schemaVersion":1,"scenario":{"preset":"winter","seed":42,"horizonMinutes":60},"trials":30}
```

The new endpoint shares the old **2 research requests/minute/principal** quota,
64 KiB body limit, two global workers and 15-second worker timeout. It is
included in the Web Service-generated `/api/v1/openapi.json` and cannot be
called without the Bearer secret on a protected public deployment. The browser
lab does not receive or need any API secret. Existing v1.3 endpoints remain
available and keep their original response semantics.

The health route advertises **API v1.4.0** and the numerical plant still
advertises **engine v1.1.0**. No physical engine equations have changed.

## Reproduction

```sh
node --test tests/*.test.cjs
node scripts/build_agent_contract.cjs --check
python tests/browser_physics_lab_service.py
node scripts/serve-agent-sandbox.cjs
```

Visit `http://127.0.0.1:8787/physics-lab` locally or `/physics-lab` on the
HTTPS Render Web Service. The browser test launches a disposable localhost
Web Service and verifies state/trace identity, controller steps, replay,
research holdouts, exports and mobile layout. It is also included in GitHub CI.

## What is required before a credible 9/10 scientific environment

- **Measured calibration**: source-identified facility or component data,
  fitted on a training partition and evaluated on unseen measured conditions.
- **Independent solver comparison**: reference Modelica/BOPTEST or comparable
  thermal solver with explicit parameter and boundary equivalence.
- **One physical state across all views**: retire the illustrative legacy
  campus signals or rebuild them from the canonical plant state.
- **Physical topology builder**: user-defined components/connections with
  fluid flow, pressure, heat-exchanger curves and energy-storage models.
- **Research reproducibility**: durable multi-user experiment records,
  independent held-out datasets, and calibrated error/uncertainty reporting.
- **Real autonomous researcher**: constrained experiment planning and
  reproducible adaptive search, evaluated against fixed conventional controls.

Until those gates are met, ThermaLoop remains a useful **synthetic physical
experiment environment**, not a 9/10 validated simulator and not authorized to
control real equipment.
