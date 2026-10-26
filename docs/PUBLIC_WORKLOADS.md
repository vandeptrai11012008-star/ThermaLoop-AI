# Public-workload router and GPU reservation experiments

This additive lab evaluates public records. It does not execute GPT-4/Mixtral,
control a GPU cluster, measure energy/latency or validate the 3D campus. The
previous random-routing/static-packing controls and their data remain intact.

## Source identity and selection

The existing `science/data/sources.json` pins RouteLLM's GSM8K outcome CSV,
contamination list and Alibaba's v2023 pod trace to full upstream commits,
SHA-256 and byte lengths. Preparation rejects mismatched source bytes. The
Alibaba README snapshot in `science/workloads/alibaba-readme.md` documents
timestamps in seconds. Its source commit/hash is included with the results.
Retrieval dates in the earlier manifest are snapshot-retrieval dates, not
measurement dates or current telemetry. No new source freshness is implied.

RouteLLM code is Apache-2.0; upstream GSM8K is MIT. Existing attribution is in
`science/data/ATTRIBUTION.md`. Alibaba trace data has no explicit data license
located in the pinned material; public access/attribution is not a license
grant. The manifest retains this unresolved status. Full prompts/responses
are not bundled here; fitted hashed-feature coefficients, partition hashes,
test scores and attributed numerical reservation records are included.

## Frozen lightweight router

After the upstream 12 contamination exclusions, 1,307 paired correctness
records remain. Normalize prompt case/whitespace for group identity, order
groups by SHA-256 of `split-v1|521143|group`, and split 60%/20%/remainder:
784 training, 261 calibration, 262 test questions. Duplicate normalized
prompts cannot cross partitions. Only exact case/whitespace-normalized duplicates are grouped; semantic near
duplicates and undisclosed benchmark contamination are not ruled out.
This is a retrospective within-GSM8K split,
not an external dataset or a reproduction of RouteLLM's trained router.

Training uses scikit-learn's nonnegative 4,096-dimensional hashed word
unigram/bigram counts; sublinear TF, smoothed training-only IDF and L2
normalization; ridge regression with alpha 10, LSQR and tolerance 1e-10.
The score is an unconstrained advantage estimate, not a calibrated probability.
The target is `strong_correct − weak_correct`. A low predicted strong-model
advantage routes to the weak model. No fitted quantity reads test labels;
calibration labels are not used either. Hashing is data-independent; only
training documents set IDF and coefficients. Exact fitted arrays/intercept,
library versions and full partition identities are exported.

Calibration-score linear quantiles set thresholds at weak-share targets
20%, 40% (primary), 60%. Ties route weak. Realized test fractions can differ
from targets; they are reported, not forced to agree by changing thresholds.
The fixed protocol was implemented before its first evaluation in this
change, but is not an independently timestamped preregistration. No parameter
search, test-driven model/budget selection or best-split reporting is done.
All three budgets remain visible. Now that results are inspectable, future
tuning requires fresh evaluation data rather than calling this test untouched.

Compare always-strong, always-weak, learned routing and random routing at
the learned policy's exact realized weak-call quota. The **main random
baseline is its exact expectation**: with q = weak_calls / test_count,

```text
expected_random_accuracy = mean(q × weak_correct + (1−q) × strong_correct)
```

Uniform random assignment without replacement at a fixed quota has exactly
this expectation; selecting a favorable or unfavorable seed is unnecessary.
An explicit seed-0 assignment and all 20 fixed seeds are also reported.
Seed 0 happens to be the worst of those 20 in the primary case, so its larger
gap is not presented as the main result. Seed extrema are descriptive, not
confidence bounds. Call reduction is not a measured cost/energy reduction.

Accuracy is correct/test_count. Differences use paired per-question outcomes.
Two thousand deterministic percentile bootstrap resamples estimate 95%
question-sampling intervals with fixed fitted router/quota; expected-random
intervals do not include random-allocation variability. Training uncertainty,
split uncertainty, correlated questions and distribution shift are excluded.
An interval overlapping zero does not prove equivalence or non-inferiority.

## GPU-only reservation event replay

From 8,152 source tasks retain all single-GPU requests without type
constraints whose source phase is Succeeded or Failed, whose scheduled and
deletion times are finite with `creation <= scheduled < deletion`, and whose
request is 1–1,000 milli-GPUs. This yields **1,991 reservations: 178 Succeeded,
1,813 Failed**. Exclusion counts and source phases are exported. Running and
pending tasks are excluded because their complete residence is unavailable.
This strongly filtered subset is not representative of the full cluster.

Use `deletion_time − scheduled_time` as a **fixed reservation-duration
proxy**. It may include failure handling, idle residence and other lifecycle
time; it is not observed useful GPU execution. Counterfactual placement does
not change that proxy. Changes in failure behavior/residence caused by a
different schedule are outside this assumption. Simulated release is never called successful work
completion, and source failures never become successes.

Use source creation-time differences for arrivals. Configured capacities of
8/16/32 identical 1,000-mGPU slots are assumptions, not reconstructed source
hardware. Every arm starts with an empty assumed reservation pool; omitted
running tasks do not consume its slots. This filtering/initialization can
understate contention and does not reconstruct the actual cluster state.
Original spacing is the primary case. Separately, arrival offsets
multiplied by 0.1 create a synthetic 10×-arrival stress case while keeping
reservation lengths unchanged. It is not a measured overloaded trace.

Four policies form a 2×2 ablation: strict FIFO / greedy backfill, each with
first-fit / best-fit placement. Release resources before arrivals/dispatch
at the same timestamp; tie-break by source ID. Strict FIFO stops at a blocked
head. Greedy backfill scans waiting requests for ones that fit; it is not
EASY/conservative backfill and gives no head-job start guarantee. Dispatch
uses current requests/capacity, not future arrivals, durations or phase labels.
No preemption, migration, CPU/RAM/VRAM limits, device-speed heterogeneity,
interference or hardware fractional-GPU isolation is modeled.

Drain every admitted reservation until resource release. Report mean/P95/max
wait, makespan, requested-capacity occupancy and release accounting. Quantiles
use linear interpolation (R7). Requested occupancy is requested GPU-seconds /
(slots × makespan), not measured utilization. Resource-time is independently
checked using a timeline integral and per-slot interval sweeps. All policies
receive identical work; waiting/release timestamps are counterfactual outputs.
There is no fabricated scheduler confidence interval from one trace.

## Findings and limits

At the primary 40% calibration target, the router sends 89/262 held-out
questions to Mixtral (33.97%), obtaining 81.68% accuracy versus 83.97% for
always GPT-4 and 64.12% for always Mixtral. The exact matched-random expectation is 77.23%; the learned-minus-expectation
difference is +4.45 percentage points with a conditional question-bootstrap
95% interval of approximately [1.04, 7.76] pp. The learned-minus-always-strong
difference is −2.29 pp, interval [−6.11, 1.53] pp; this is not a demonstration
of non-inferior quality. All budget results are in `results.json`. These cached
outcomes do not establish deployment quality or energy/latency savings.

At 16 slots and original filtered arrival spacing, all four schedulers have
zero wait: no advantage is established. At 10× arrivals, backfill + best-fit
reduces mean wait from about 941.91 to 874.37 s but increases maximum wait
from 4,452 to 4,855.2 s. Backfill + first-fit has a lower mean than best-fit
in that case. These unfavorable comparisons remain visible. No universal
policy ranking or thermal scheduling claim follows.

## Reproduce and inspect

```sh
python3 -m venv .venv-workloads
.venv-workloads/bin/python -m pip install -r requirements-workloads.txt
OPENBLAS_NUM_THREADS=1 .venv-workloads/bin/python scripts/prepare_workloads.py --compare science/workloads/data.json
node scripts/run_workload_experiments.cjs --check
python3 scripts/build_workloads.py --check
OPENBLAS_NUM_THREADS=1 .venv-workloads/bin/python -m pytest -q tests/test_workload_router.py
node --test tests/workloads.test.cjs
node scripts/run_workload_experiments.cjs --check --output /tmp/thermaloop-workload-records.json
```

The preparer downloads missing pinned raw files into its cache. Sources must
be reachable on a fresh reproduction machine; cached verified files permit
offline reruns. The browser uses the committed static bundle and runs both
evaluation engines locally without ML services, API keys or upstream fetches.
To deliberately regenerate after a reviewed source/protocol change, omit
`--compare`, run the Node script without `--check`, then rebuild the bundle.
Cross-environment fit tolerance is 1e-8 for scores/coefficients; partition,
outcome and routing-decision identity must still match exactly.

Browser JSON exports include the fitted model, partition manifest, selected
configuration, per-question/per-reservation records, original phase labels,
source hashes and limitations. CSV preserves per-record results; SVG is a
standalone comparison with source identity. Saved summaries cover every
declared budget and scheduler case. None of these artifacts adds new field
observations or certifies predictive thermal accuracy.
