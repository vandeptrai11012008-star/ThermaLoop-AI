# Source and ZIP audit

Baseline: `587661bc290e77a1dcbe895bf298e40856ef0e27`. This audit distinguishes the running root website from source snapshots stored in archives. No archive is extracted into or made active in the repository. No original file has been deleted, and the README, archive/PDF bytes and legacy inline JavaScript programs remain unchanged; regression checks enforce those identities.

## Inventory and method

`python3 scripts/audit_archives.py` recursively reads every root ZIP and the nested ZIP, validates paths, inventories all 174 file entries, records SHA-256 and byte sizes, and AST-parses all Python modules. `docs/archive-inventory.json` contains the complete per-file inventory and Python symbols. Four root ZIPs include an additional nested ZIP; none is skipped. During review, source, config and documentation were also scanned for imports, symbols, external dependencies, scientific parameters and solver capabilities. That scan covered 143 source/config/documentation files and 20,086 lines in the extracted archive tree. This is a structural/module audit and focused review of scientific calculations, API contracts, state and visualization behavior; it does not imply formal verification of every bundled vendor-library statement.

## Running root website

`index.html` implements the deployed static website with native WebGL and no external runtime library. Its inline modules provide the deterministic 64-GPU simulator, 3D campus renderer, live controls/diagnostics, 60-minute baseline/candidate comparison, experiment presets and time scrubbing, per-GPU histories, scale/economics and sidebar navigation. `scale_lab.js` and `scale_lab.css` are source companions; the active scale module is already inline in the HTML. In particular, the standalone JS companion contains HTML script wrappers and should not be added as a raw external JS dependency.

Scientific assumptions include invented GPU idle/dynamic power and per-request GPU-seconds, synthetic model-quality probabilities, scheduler/DVFS and disaggregation multipliers, synthetic thermal dynamics and fault signatures, heat-capture/exchanger fractions, fixed 3.4 COP, heating load proxies, zero-cost migration, synthetic arrivals, financial prices and fleet extrapolations. The existing code does label those limitations. These unidentified hypothetical devices cannot be calibrated simply by replacing their constants with unrelated H100 benchmark points.

The extension adds `science/model.js`, `science/dashboard.js`, its scoped stylesheet and a locally bundled dataset. The original inline programs are byte-for-byte preserved. Source-specific measured power/throughput and published correctness outcomes replace invented proxies in the **new evidence experiments**; the earlier labs remain clearly labeled as synthetic. Existing camera models, GPU mesh/pipe code, external destinations and earlier exports remain active.

## Additional workload evaluation

The separate `workloads/` preparer uses the pinned raw routing/trace sources,
with a committed Alibaba timestamp-documentation snapshot. Its source hashes,
fitted router, split manifest and numerical reservation subset are published
under `science/workloads/`. `science/workload-model.js` is shared by Node and
the new browser lab. Previously archived modules and the original four
scientific experiments are not replaced; see `PUBLIC_WORKLOADS.md` for the
new holdout and residence-proxy limits.

## Finite-capacity thermal extension

`physics/counterflow.py` provides the new conservative two-stream CDU model,
using the licensed reference's geometry/parameter helpers, convection checks,
clock integration and exact epsilon-NTU limit. Its separate result/source
fingerprints are in `science/physics/`. A pinned Modelica Buildings equation
snapshot corroborates the continuum relationship; it is not executed here or
treated as experimental data. Historical thermal/workload artifacts and the
3D programs are unchanged. See `FINITE_CAPACITY_PHYSICS.md` for assumptions.

## Archive modules

| Archive | Modules and purpose | Scientific findings / integration decision |
|---|---|---|
| `ThermaLoop_Scale_Economics_Source.zip` | Static HTML, source scale JS/CSS, archived README | Earlier root-site snapshot. Uses synthetic daily arrivals, queue/latency/VRAM envelopes, assumed prices, static tariffs and financial extrapolations. Preserve; do not promote its annual numbers to measured results. |
| `ThermalLoop_Scheduling.zip` | Standalone offline scheduling HTML | Three hypothetical GPUs, abstract compute units, fixed speeds/powers, thermal RC approximation, synthetic deadlines and 80% assumed recoverability. Compares FCFS/SJF/EDF/thermal heuristics; no measured token throughput or actual cluster energy. Use real resource requests only in the new scoped packing replay. |
| `neuralroute3d-web.zip` | HTML + bundled/minified React app and CSS | Demonstrates a small bundled classifier, feature/activation visualization and training history; the visible energy/latency profiles remain illustrative. Validation uses only 12 examples; no executed downstream LLM or measured GPU energy. Bundled React/vendor runtime is distinguishable from application routing logic. Preserve linked website and show a separate reproducible published-outcome control; no claim this classifier becomes RouteLLM. |
| `Thermaloop real scale.zip` | `SEED-cube` FastAPI backend, typed React/Three frontend, shared config, tests, Docker/Render/CI setup | Detailed component model and scene: primary/secondary circuits, exchanger epsilon-NTU, pump/pipe losses, tank, soil node, configurable heat demand, scene geometry, branch/flow records, API schemas and result store. Engineering parameters are config assumptions, not measurements. `openmodelica`, `energyplus` and `coupled` modes explicitly return solver-not-executed status; their presence is not independent physics validation. |
| Nested `SEED-cube/thermal-loop-render.zip` | Additional flattened source/config/test/model-generation export | Includes older/alternate physics and simulation, API tests, frontend component snapshots, GLB/IDF/model-generation and validation helpers. Flattened paths mean this is not a self-contained canonical project checkout. It is inventoried separately; the complete outer project is used for its documented build. Its tests are also exercised against the archived backend, with the tested code version stated in the validation report. |

### SEED-cube backend

`physics.py` defines unit conversions, sensible heat, flow/temperature inverses, epsilon-NTU exchange, pump power, pipe pressure and heat loss, tank and greenhouse soil dynamics, demand and heat-pump primitives. `simulation.py` couples source heat, ambient rejection, thermal storage and building/lab/seed/greenhouse loads; model parameters are loaded from seven JSON configs. `app.py`, `schemas.py`, `config_loader.py`, `results_store.py` and `scene.py` define the API, bounded simulation requests, shared configuration, stored runs and 3D scene contract. There is no live GPU or greenhouse measurement ingestion.

### SEED-cube frontend

`App`, API client/types, store and timeline/panels form the simulation workflow. The Three components cover architecture, buildings, GPU hall, hydronics, greenhouse, vegetation, camera, labels, textures and coordinates. Presentation, mini charts and result export visualize backend model outputs. Builds use the existing npm lockfile. Changes are kept additive in the root website; archived components are not silently swapped into the active scene.

### Research PDFs

The two root PDFs were text-extracted and reviewed for equations, proposed protocols and references. They explicitly describe conceptual/synthetic research and unvalidated assumptions, including routing, disaggregation, heat-balance and future measurements. They are kept intact and are not treated as independent experimental proof. Their RouteLLM/DistServe/DCGM references provide context; a referenced paper alone supplies no calibrated ThermaLoop parameter.

## Preservation contract and tests

`tests/legacy-contract.json` records the initial rendered IDs, original external URLs and SHA-256 for original inline programs, README, PDFs, ZIPs and standalone scale files. The Node suite checks preservation; the real-browser runner additionally exercises existing controls, cameras, scenarios, presets, GPU histories, diagnostics, finance tabs and exports. The complete validation results and limitations belong in `docs/VALIDATION.md`.
