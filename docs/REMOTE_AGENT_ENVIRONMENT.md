# ThermaLoop v1.3 — Remote Agent Environment + Research Lab

The **Remote Agent Environment** is a Node 22+ API for synthetic, deterministic thermal-control experiments. The new Render Web Service can serve **both the website and API on the same origin**; the older Static Site can still run the browser-only simulation. A static site by itself **does not run** the Node API and adding `render.yaml` to GitHub does **not provision** a service by itself.

There is **no physical hardware access**, trained controller, verified building model, or real GPU telemetry. All results are from an uncalibrated three-temperature RC plant. The numerical engine remains v1.1; the remote HTTP interface is now v1.3, with bounded deterministic research searches. See [Autonomous Research Lab](AUTONOMOUS_RESEARCH_LAB.md).

## Deploy safely on Render

1. In your Render account, select **New → Blueprint** and connect this repository's `main` branch with the root `render.yaml`. Review the service, billing/usage and region before approving. It describes a **new** `thermaloop-agent-api` Node web service; it does not replace the existing static site.
2. Render generates a random 256-bit `THERMALOOP_API_TOKEN` secret and sets `HOST=0.0.0.0`. Never put the token in a public web page, git commit, issue, screenshots, or logs. Render terminates HTTPS at its edge. Use its HTTPS domain for agents.
3. Once provisioned, verify `https://YOUR-API.onrender.com/healthz` returns `{"status":"ready",...}`. This unauthenticated probe proves process availability, **not** model validity. Verify `/api/v1/health` with the token and then run the loopback/remote example below.
4. From a trusted **server-side** AI agent, configure `THERMALOOP_API_URL=https://YOUR-API.onrender.com` and `THERMALOOP_API_TOKEN` using secret storage. Use `node examples/remote_agent_controller.cjs` to run a bounded 20-minute demonstration.

The free service is a low-budget research configuration: it sleeps when idle, has shared instance-hour limits and loses memory/local files on restart, sleep and redeploy. It is **not** suitable for durable experiment archives or a production SLA. Download a report before an experiment expires, or use an externally backed durable store in a later release. A paid Render instance with a persistent disk can enable `THERMALOOP_EPISODE_STORE=/var/data/episodes.json` (single process only). Do **not** set this path inside the public git checkout.

For a manually created Render **Web Service**, use the same repository/branch, runtime **Node**, start command `node scripts/serve-agent-sandbox.cjs`, bind `HOST=0.0.0.0`, `PORT` from Render, health check `/healthz`, and set a random 32-byte-or-longer secret via `THERMALOOP_API_TOKEN`. If no strong secret is configured, the process refuses public binding.

## API contract

All `/api/v1/*` routes require a Bearer token on a public service; `/healthz` is a safe unauthenticated liveness check. Browser cross-origin API requests are denied by design. **Do not** send a privileged token to the static website or put it in client-side JavaScript. Remote agents should call the API from a private/server-side environment.

| Method & route | Operation |
| --- | --- |
| `GET /healthz` | Public liveness status (no secret). |
| `GET /api/v1/health` | Version and storage-mode status. |
| `GET /api/v1/schema` | Valid scenarios and controls. |
| `GET /api/v1/openapi.json` | OpenAPI 3.1 contract. |
| `GET /api/v1/usage` | Per-principal quotas and current episode count. |
| `POST /api/v1/simulations/evaluate` | Bounded paired baseline/candidate comparison. |
| `POST /api/v1/research/optimize` | Up to 30 bounded deterministic candidate trials, best eligible training plan and two untouched holdout checks. |
| `POST /api/v1/episodes` | Start a private, bounded simulation episode. |
| `GET /api/v1/episodes/{id}` | Observe an episode you own. |
| `POST /api/v1/episodes/{id}/step` | Mutate controls and advance simulation, using `expectedMinute`. |
| `GET /api/v1/episodes/{id}/report` | Export trace and exact replay request. |
| `DELETE /api/v1/episodes/{id}` | Discard episode. |

Example (use a secure terminal, where environment variables contain the URL and secret):

```sh
curl -fsS "$THERMALOOP_API_URL/api/v1/health" \
  -H "Authorization: Bearer $THERMALOOP_API_TOKEN"

curl -fsS -X POST "$THERMALOOP_API_URL/api/v1/episodes" \
  -H "Authorization: Bearer $THERMALOOP_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"scenario":{"preset":"winter","seed":42,"horizonMinutes":20}}'

# Supply the returned episodeId and observed minute; the first expectedMinute is 0.
curl -fsS -X POST "$THERMALOOP_API_URL/api/v1/episodes/EPISODE_ID/step" \
  -H "Authorization: Bearer $THERMALOOP_API_TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"expectedMinute":0,"minutes":1,"controls":{"pumpPct":85}}'
```

Do not assume an episode ID is sufficient authorization. Every request checks the API key's principal ownership and returns **404** for someone else's or an expired episode. Re-fetch after **409 Conflict** before proposing another action. `429` means an account quota was reached; obey `Retry-After`. `503` means global simulation capacity or optional storage is unavailable. `403` means the browser Origin is not allowed; remote agents must run server-side.

## Session limits and secrets

- Global maximum **16 episodes**; idle expiry **30 minutes**; each experiment up to **360 simulated minutes** and **50 effective control changes**.
- Default **120 API requests/minute**, **12 evaluation requests/minute**, and **2 research searches/minute** per principal. The Render Blueprint limits each token to **4 active episodes**; local default is 16. In-memory quota counters reset after each 60-second window and after process restart. These are research safeguards, not distributed-scale abuse protection.
- Maximum JSON request body **64 KiB**, maximum **2 concurrent** evaluation workers, and **15-second** evaluation timeout. Step requests execute a bounded 5-second-increment thermal model in-process.
- For separate researchers, set `THERMALOOP_API_KEYS` to a JSON object such as `{"alice":"RANDOM_SECRET_32_BYTES_OR_LONGER","bob":"ANOTHER_RANDOM_SECRET_32_BYTES_LONG"}` **in Render's secret configuration**. Each named key owns its own episodes. `THERMALOOP_API_TOKEN` (if set) is the separate `owner` principal. Values must be unique; key names are identifiers and are not sensitive.
- An optional local file path via `THERMALOOP_EPISODE_STORE` saves only per-session owner ID, last-access time, minute and a deterministic replay request, with atomic replacement on successful writes. This supports **single-instance** restarts only when the filesystem itself is persistent. The API restores physical checkpoints by deterministic re-simulation. It is **not a distributed database**, and offers no guarantee against disk loss or corruption.
- Neither APIs nor reports give real equipment commands. `hardwareAuthorized` is always `false`. Review thermal constraints and synthetic assumptions before interpreting any result.

## Verify locally

```sh
node scripts/build_agent_contract.cjs --check
node --test tests/*.test.cjs
node scripts/serve-agent-sandbox.cjs
# In another terminal:
node examples/remote_agent_controller.cjs
```

Run the remote API on a single process behind trusted HTTPS termination. Never expose the Node port without a strong Bearer secret. Multi-instance sessions, durable Postgres records, production audit logging, true per-user authentication, billing quotas and physical validation remain future work.
