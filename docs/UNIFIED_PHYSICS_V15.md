# ThermaLoop AI v1.5 — Unified Physics and Topology Agents

Deployment target: **Node Web Service only** at `/physics-lab`. The old Static
Site and the repository's `index.html` are not edited. The prior v1.4 laboratory
remains runnable at `/physics-lab-v14`; the API v1.1 thermal plant and v1.3/v1.4
research contracts are unchanged for existing agents.

## 1. One canonical world

`service/unified-physics.js` is a dependency-free, deterministic UMD module,
used in both the Web Service and the browser. Its `createWorld`, `advance` and
`report` functions are the **only** source of numerical readings in the v1.5
isometric 3D circuit, telemetry cards and trace chart. The original dashboard's
3D legacy view gets a read-only snapshot of the same browser world through a
Web Service-only bridge and clearly labels its own 64-GPU signals as *legacy
illustration*. This does **not** make the legacy device sensors calibrated.

The world contains one aggregate GPU thermal node, one completely mixed water
thermal node, and one occupied-room thermal node, plus a validated graph of
physical **components** (pump, aggregate GPU, pipes, heat-recovery HX, dry
cooler, optional tank). There is only one closed, serial, incompressible
coolant loop. Components have separate *parameters*, but not separate CFD
fluid-cell temperatures.

## 2. New physical equations

### Hydraulics

- Water constants at an illustrative nominal temperature: density 997 kg/m³,
  heat capacity 4.18 kJ/(kg K), dynamic viscosity 0.00089 Pa s. No properties
  vary with temperature or pressure. NIST has authoritative property data;
  **these constants are approximations, not NIST-interpolated evaluations**.
- A centrifugal-pump curve is approximated by
  `Δp_pump = p_shutoff * speed² * (1 - (Q/(Q_max*speed))²)`.
- Serial-circuit loss uses Darcy–Weisbach:
  `Δp = (f L/D + ΣK) ρv²/2`, `Re = ρvD/μ`. For `Re < 2300`, `f = 64/Re`;
  otherwise an explicit Haaland approximation. The 60-iteration bisection
  intersection solves pump versus system head.
- Pump electric power `P = Δp Q / η` and the corresponding energy is tracked.
  This idealization assumes electrical pump work heats the fluid boundary.

### Thermal transfer

- Counterflow HX effectiveness `ε = (1-exp[-NTU(1-Cr)]) /
  (1-Cr*exp[-NTU(1-Cr)])`, with equal-capacity limit `ε=NTU/(1+NTU)`.
  Heat transfer is bounded by `ε * C_min * ΔT`, then by the room heat request.
- GPU heat transfer uses a bounded lumped UA that responds to the water
  heat-capacity rate. Dry-cooler effectiveness responds to fan flow and ambient
  temperature; pipe/tank skin loses `UA*(Twater-Toutside)`.
- The fluid **outlet temperature** of each graph component is calculated in
  directed edge order using its heat rate and `ṁ cp`. Rewiring the path changes
  physical outcomes (e.g., HX inlet temperature), not just its 3D position.
  These are algebraic stream temperatures, not independently stored CFD cells.
- Dynamic thermal state is integrated by explicit Euler at 5-second steps,
  with integrated heat-sum reconciliation. The maximum residual over a run is
  reported. **Small conservation residuals establish coding consistency, not
  the accuracy of UA, pump curves, or loads.**
- A separate numerical refinement test checks a 1-second step against the
  production 5-second step across winter, summer and fault scenarios. This
  constrains time-discretization error, **not** component-model error.
- A deterministic, minute-keyed, **synthetic** seed disturbance changes
  ambient temperature slightly and GPU demand; it is reproducible across step
  partitions and not a measured weather or workload distribution.

Reference materials for the formulations:

- U.S. DOE, [Improving Pumping System Performance](https://www.energy.gov/sites/prod/files/2014/05/f16/pump.pdf), affinity behavior and pump/system curves.
- U.S. DOE/NREL, [LDV HVAC Model Development and Validation](https://www.energy.gov/sites/prod/files/2014/03/f11/vss045_rugh_2011_o.pdf), Darcy friction and Reynolds regimes.
- NIST, [Thermophysical Properties of Fluid Systems](https://webbook.nist.gov/chemistry/fluid/), source for independently checking temperature-dependent fluid properties in the next version.

### Limitations on physics fidelity

The world is not a distributed fluid network, full HVAC model, stratified
storage plant or CFD solver. It has neither pressure dynamics nor branched
networks; no measured calibration, no thermodynamic variation of water
properties, no experimentally verified component maps, no building humidity
or multi-zone airflow. Pump/GPU/HX default parameters remain synthetic.
Do not claim 8/10 **real-world predictive accuracy** from these equations.

## 3. Agents may alter a physical graph

The browser and authenticated API both validate that each proposal contains:

- One pump, GPU heat source, heat exchanger and dry cooler.
- Up to 6 pipes and 2 tanks, and 4–12 total nodes.
- Exactly one closed directed cycle, one incoming/outgoing edge per node, no
  disconnected sub-circuits or branching, finite bounded component parameters.
- Changes only at minute 0. Mid-run topology edits are rejected rather than
  inventing/destroying thermal energy from an altered water volume.

The new authenticated endpoints are:

```
POST   /api/v1/worlds
GET    /api/v1/worlds/{id}
POST   /api/v1/worlds/{id}/step
PUT    /api/v1/worlds/{id}/topology
GET    /api/v1/worlds/{id}/report
DELETE /api/v1/worlds/{id}
```

World sessions are simulation-only, in-memory, limited to 16 globally, 4 per
principal, and expire after 30 minutes of idleness. All endpoints inherit
Bearer authentication, same-origin API checks, 64 KiB request bodies, and
global per-principal request quotas. `expectedMinute` is required for steps
to prevent stale concurrent control changes.

There is no LLM inside the solver; agents use the API to propose graph edits
and observe physical consequences. The browser demo stores a read-only latest
world snapshot in the same-origin localStorage to show across its two Web
Service views. This snapshot is convenient UI state, **not tamper-resistant
scientific evidence**.

## Verification, not field validation

- `node --test tests/*.test.cjs` tests the old API and new solver invariants,
  determinism, topology guards, hydraulic response and remote ownership.
- `python tests/browser_unified_lab_service.py` verifies UI topology editing,
  correct state sharing, export, mobile widths, and old-site integration.
- The GitHub workflow repeats tests on pinned Chromium.

The next physical milestone requires measured pump/fan/UA maps, independent
Modelica/BOPTEST runs using matched boundary conditions, holdout measurement
errors and uncertainty bands before a defensible 8/10 physics rating.
