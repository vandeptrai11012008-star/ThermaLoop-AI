# Desktop workspace navigation

The website presents five focused workspaces instead of placing every lab in one
continuous document. The sidebar selects Overview, Experiments, Thermal models,
AI Research Lab or Scientific evidence. Section links within a workspace select one
panel at a time. A compact navigation row remains available when the original
responsive layout hides the sidebar.

## Content map

- Overview: original 3D scene and KPI cards; live analytics in a separate panel.
- Experiments: Before/After, strategy studio, GPU allocation, policies and
  diagnostics, and the public-workload lab.
- Thermal models: finite-capacity CDU, cooling validation and numerical
  verification. The heading explicitly distinguishes this 8-GPU reference
  from the conceptual 64-GPU campus.
- AI Research Lab: closed-loop control experiments and bounded autonomous searches.
- Scientific evidence: source/data connection status, scientific comparisons,
  editable assumptions, methods and source catalogue.

The former Economics workspace is removed from public navigation. Its original
source, synthetic assumptions and embedded DOM are retained but hidden for
research provenance and compatibility. It is no longer a supported end-user
workspace or downloadable report on the live website.

The active section IDs and linked destinations remain. Examples:
`#comparison`, `#diagnostics`, `#public-workloads`, `#physical-model` and
`#sciSourceDetails`. Direct source/method links open their enclosing `details`
element. Native fragment history supports browser Back/Forward. The main
navigation remembers the last section visited in each workspace during the
current page session. A full reload starts the models with their original
defaults; persistent parameter storage is not introduced.

The module moves existing DOM nodes into containers and toggles `hidden`.
It does not clone controls, recreate model instances, change model equations,
fit parameters or rerun experiments when selecting a view. Existing renderers
receive a resize event after a view becomes visible. Comparison/GPU/diagnostic
links into the 3D scene reveal that screen before the existing selection
handlers run. Shared simulation controls continue to have their original
cross-module effects. This is navigation state preservation, not a claim that
separate scientific models have become physically coupled.

The external navigation module and stylesheet are additive; the original
inline programs, README, ZIP/PDF files, model data and external destinations
are preserved. If the module is unavailable or required sections are missing,
the original long document remains available. Existing methods and source
`details` remain accessible; assumptions and scientific caveats are not
removed to shorten the view.

## Validation

```sh
node --test tests/*.test.cjs
python tests/browser_workspaces.py
python tests/browser_smoke.py
python tests/browser_physics.py
```

The new browser check covers screen/section routing, active deep links,
archived economics visibility, state/DOM identity across repeated switches, scientific
result identity, Back/Forward, direct nested-method reloads, keyboard entry,
3D cross-screen jumps, desktop screenshots at 1440/1920 px, and fallback when
the navigation module fails to load. The existing full regression now enters
the appropriate screen before using a control; its model, export and legacy
assertions are retained. Workflow dispatch also runs navigation verification
against the deployed main URL. A local system-browser result is identified
separately from the supported Playwright-pinned browser used in CI.
