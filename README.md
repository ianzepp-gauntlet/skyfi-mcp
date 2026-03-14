# SkyFi MCP Server

An MCP (Model Context Protocol) server that exposes the [SkyFi](https://skyfi.com) satellite imagery platform to AI agents. Enables conversational search, ordering, pricing, feasibility checks, and area-of-interest monitoring — all through standard MCP tool calls.

## Technical Decisions

This project keeps Cloudflare as the primary remote deployment target rather than Railway. Railway would be a feasible host for the Bun HTTP server, but Cloudflare is more directly aligned with the current MCP ecosystem: it has stronger market recognition as an MCP-focused platform, first-party support for remote MCP patterns, and a deployment model that maps cleanly onto multi-user hosted MCP servers.

Cloudflare also fits the transport direction we want to follow. The MCP ecosystem has moved away from older SSE-oriented remote patterns toward modern Streamable HTTP, and Cloudflare's MCP tooling is built around that newer model. Railway remains a reasonable general-purpose hosting option, but Cloudflare is the better fit when the goal is to ship a production remote MCP server on infrastructure that is already associated with MCP-specific workflows and transport conventions.

For scenario-based manual testing and LLM tool-flow validation, see [`docs/test-scenarios.md`](docs/test-scenarios.md).
For an executable eval harness built around those scenarios, see [`evals/README.md`](evals/README.md).

## Eval Framework

This repo now includes a real eval harness that exercises the MCP server through an actual LLM tool loop instead of grading static text. The harness is intentionally biased toward production-stable signals: correct tool choice, forbidden-tool avoidance, useful tool outputs, and basic non-empty final responses. Exact wording is treated as low-signal because production users may connect many different LLMs to the same MCP server.

The eval corpus is YAML-defined under [`evals/scenarios`](evals/scenarios), suite definitions live in [`evals/suites.yaml`](evals/suites.yaml), and the runner is [`scripts/run-evals.ts`](scripts/run-evals.ts). Fixture-backed planner cases validate tool routing and confirmation-gate safety without depending on live SkyFi data, while live suites validate read-only end-to-end behavior against the real server. Failed deterministic cases can receive a secondary OpenRouter judge pass, but deterministic grading remains the primary pass/fail source.

Current passing smoke suites:

- `planner-smoke` — fixture-backed tool-planning and confirmation-gate coverage
- `live-integration-smoke` — account, pricing, place-name search, and exact-address lookup
- `live-feasibility-smoke` — live feasibility checks
- `live-opportunity-smoke` — next-pass lookup, including an expected-failure too-soon case
- `live-orders-smoke` — read-only order history checks
- `live-monitoring-smoke` — read-only AOI monitor review

Useful commands:

```bash
bun run evals --list
bun run evals:planner-smoke --server-url http://localhost:8787/mcp
bun run evals --suite live-integration-smoke --server-url http://localhost:8787/mcp
```

See [`evals/README.md`](evals/README.md) for environment variables, suite details, and artifact locations under `evals/results/`.

## Tools

| Tool                     | Description                                                                                 |
| ------------------------ | ------------------------------------------------------------------------------------------- |
| `archives_search`        | Search the SkyFi satellite imagery catalog by area, date range, cloud cover, and resolution |
| `archive_get`            | Get full metadata for a single archive scene by archive ID                                  |
| `passes_predict`         | Predict upcoming satellite passes over an AOI and time window                               |
| `feasibility_check`      | Check whether a new satellite tasking capture is feasible for a given area and time window  |
| `pricing_get`            | Get the SkyFi pricing matrix, optionally scoped to a specific area                          |
| `account_whoami`         | Get account identity, budget usage, and payment readiness                                   |
| `orders_list`            | List your previous SkyFi orders                                                             |
| `orders_get`             | Get detailed status and history for a specific order                                        |
| `orders_redeliver`       | Re-trigger delivery for an order with new delivery settings                                 |
| `orders_deliverable_get` | Get the signed download URL for an order deliverable                                        |
| `orders_prepare`         | Prepare an order and get pricing — does NOT place the order (returns a confirmation token)  |
| `orders_confirm`         | Execute a prepared order using a confirmation token from `orders_prepare`                   |
| `notifications_create`   | Create an Area of Interest monitor with webhook notifications for new imagery               |
| `notifications_list`     | List all active AOI monitors                                                                |
| `notifications_get`      | Get details for a specific AOI monitor, including recent webhook alerts                     |
| `notifications_delete`   | Delete an AOI monitor                                                                       |
| `alerts_list`            | Retrieve recent webhook alerts for AOI monitors                                             |
| `location_resolve`       | Resolve a place name to coordinates and WKT polygon via OpenStreetMap                       |

## API Coverage

The SkyFi Platform API (v2.0.0) spec is saved locally at [`docs/openapi.json`](docs/openapi.json). The table below maps every API endpoint to its MCP tool, and calls out gaps.

### Endpoint Mapping

| Method   | Path                                    | MCP Tool                 | Notes                                                         |
| -------- | --------------------------------------- | ------------------------ | ------------------------------------------------------------- |
| `POST`   | `/archives`                             | `archives_search`        | Initial search                                                |
| `GET`    | `/archives`                             | `archives_search`        | Pagination via cursor                                         |
| `GET`    | `/archives/{archive_id}`                | `archive_get`            |                                                               |
| `GET`    | `/auth/whoami`                          | `account_whoami`         |                                                               |
| `POST`   | `/demo-delivery`                        | —                        | **Not exposed** — demo-only feature, low priority             |
| `POST`   | `/feasibility`                          | `feasibility_check`      | Submit step (polled internally)                               |
| `GET`    | `/feasibility/{feasibility_id}`         | _(internal)_             | Only called by the polling loop inside `feasibility_check`    |
| `POST`   | `/feasibility/pass-prediction`          | `passes_predict`         | Use with `orders_prepare.providerWindowId` for pass targeting |
| `GET`    | `/health_check`                         | —                        | Infrastructure; not useful as an MCP tool                     |
| `POST`   | `/notifications`                        | `notifications_create`   |                                                               |
| `GET`    | `/notifications`                        | `notifications_list`     |                                                               |
| `GET`    | `/notifications/{notification_id}`      | `notifications_get`      |                                                               |
| `DELETE` | `/notifications/{notification_id}`      | `notifications_delete`   |                                                               |
| `POST`   | `/order-archive`                        | `orders_confirm`         | Executed only after `orders_prepare`                          |
| `POST`   | `/order-tasking`                        | `orders_confirm`         | Executed only after `orders_prepare`                          |
| `GET`    | `/orders`                               | `orders_list`            |                                                               |
| `GET`    | `/orders/{order_id}`                    | `orders_get`             |                                                               |
| `POST`   | `/orders/{order_id}/redelivery`         | `orders_redeliver`       |                                                               |
| `GET`    | `/orders/{order_id}/{deliverable_type}` | `orders_deliverable_get` | Returns a signed URL for `image`, `payload`, or `cog`         |
| `POST`   | `/pricing`                              | `pricing_get`            | Also called internally by `orders_prepare`                    |
| `GET`    | `/ping`                                 | —                        | Infrastructure                                                |

### Pass-Targeted Tasking

Pass-level targeting is now exposed end-to-end:

1. `passes_predict` → get candidate passes and `providerWindowId` values
2. `feasibility_check` → verify the requested collection window and constraints
3. `orders_prepare` with `providerWindowId` set → prepare a tasking order pinned to that pass
4. `orders_confirm` → execute the prepared tasking order

## Tech Stack

- **Runtimes**: [Cloudflare Workers](https://developers.cloudflare.com/workers/) (production) / [Bun](https://bun.sh) (local development)
- **MCP SDK**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **HTTP Framework**: [Hono](https://hono.dev) (runs on both runtimes)
- **Validation**: [Zod](https://zod.dev)
- **Database**: SQLite (lightweight; used for AOI alert persistence if enabled)
- **Observability**: LangSmith tracing (planned at tool-call boundary)
- **Deployment**: Cloudflare Workers (primary); Bun self-hosting supported
- **External APIs**: [SkyFi Platform API](https://app.skyfi.com/platform-api/redoc), [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org)

## Architecture

The codebase is designed for **dual-runtime deployment** — all tools, clients, and types are shared between Cloudflare Workers and Bun. Only the entry point and config sourcing differ:

```
┌─────────────────────────────────────┐
│  Tools / Client / Types / Config    │  ← 100% shared
├─────────────────────────────────────┤
│  MCP Server wiring (mcp.ts)         │  ← 100% shared
├─────────────────────────────────────┤
│  Hono transport (transport.ts)      │  ← Bun / local self-hosting
│    └─ stateful                      │
├─────────────────────────────────────┤
│  Agents transport                   │  ← Cloudflare Workers
│    ├─ agent_transport.ts            │
│    ├─ worker_routes.ts              │
│    └─ Durable Objects               │
│       ├─ SkyFiMcpAgent              │
│       └─ SkyFiAlertStore            │
├─────────────────────────────────────┤
│  Entry point                        │
│    ├─ src/worker.ts (Workers)       │
│    └─ src/index.ts  (Bun)           │
└─────────────────────────────────────┘
```

The Workers entry point now runs on **Cloudflare Agents** with stateful Durable Object-backed MCP sessions. Per-request `x-skyfi-api-key` credentials are bound to the MCP session during initialization so multi-user remote access still works, while AOI webhook alerts are stored in a separate shared Durable Object. The Bun entry point remains **stateful** with in-memory session tracking and optional `~/.skyfi/config.json` support for local developer convenience.

## Implementation Status

Core MCP surface is implemented for the supported SkyFi account, archive, pricing, feasibility, ordering, notification, and location workflows. The only Platform API endpoints intentionally not exposed are infrastructure-only (`/ping`, `/health_check`), demo-only (`/demo-delivery`), and the internal feasibility polling endpoint (`GET /feasibility/{feasibility_id}`), which is wrapped by `feasibility_check`.

### Phase 1 — Scaffold & SkyFi Client ✅ COMPLETE

- TypeScript project setup with Bun
- Typed HTTP client covering all SkyFi API endpoints (archives, orders, pricing, feasibility, notifications)
- Config loader supporting env variables, request headers, and `~/.skyfi/config.json` (Bun only)

### Phase 2 — MCP Server + Core Read-Only Tools ✅ COMPLETE

- MCP transport (Bun via Hono, Workers via Cloudflare Agents Durable Objects): done
- Dual-runtime support (Cloudflare Workers + Bun): done
- Read-only tools implemented: `archives_search` (with pagination), `archive_get`, `passes_predict`, `feasibility_check` (async polling), `pricing_get`, `account_whoami`, `orders_list`, `orders_get`, `orders_deliverable_get`: done
- Unit and contract test suite: done
- Real SkyFi API smoke test: done
- End-to-end validation with a live MCP client: done (deployed on Cloudflare Workers)
- Executable eval harness with fixture-backed planner suites and live smoke suites: done
- LangSmith tracing at tool-call boundary: not started

### Phase 3 — Conversational Ordering ✅ COMPLETE

- `orders_prepare` validates parameters, fetches pricing, returns a summary with a single-use confirmation token (5-minute TTL)
- `orders_confirm` accepts the token and executes the purchase
- `orders_redeliver` re-triggers delivery for an existing order using new delivery settings
- Tasking orders can be pinned to a specific pass by supplying `providerWindowId` to `orders_prepare`
- Tokens are random UUIDs, single-use, session-isolated
- `ConfirmationStore` class (`src/tools/confirmation.ts`) implements the token store with lazy TTL expiry and injectable clock for deterministic testing

### Phase 4 — AOI Monitoring ✅ COMPLETE

- `notifications_create`, `notifications_list`, `notifications_get`, `notifications_delete`: done
- `alerts_list`: done — retrieves alerts per monitor or across all monitors
- Inbound webhook receiver at `POST /webhooks/aoi`: done — persists payloads to a shared Durable Object alert store on Workers and to an in-memory store on Bun
- `AlertStore` class (`src/tools/alerts.ts`) implements the in-memory keyed alert store used by Bun and tests
- `SkyFiAlertStore` Durable Object (`src/alerts_object.ts`) provides shared cross-session alert persistence for Cloudflare Workers
- AOI alerts are readable from any MCP session on Workers because they are no longer tied to per-session in-memory state

### Phase 5 — OpenStreetMap Integration ✅ COMPLETE

- Nominatim client with `User-Agent` header for polite usage
- `location_resolve` tool converts place names to bounding boxes and WKT polygons for use with SkyFi

### Phase 6 — CLI Interface ✅ COMPLETE (separate repo)

Implemented in a standalone repository: [skyfi-cli](https://github.com/ianzepp/skyfi-cli).

### Related Project: `skyfi-cli`

If you want a terminal-first interface to the same SkyFi Platform API workflows, see the companion Rust CLI at [`~/github/ianzepp/skyfi-cli`](/Users/ianzepp/github/ianzepp/skyfi-cli).

Install options:

```bash
brew install ianzepp/tap/skyfi-cli
curl -fsSL https://raw.githubusercontent.com/ianzepp/skyfi-cli/master/install.sh | bash
```

Current command groups include:

- `config` — store and inspect API key and base URL settings
- `ping` / `whoami` — verify connectivity, auth, org, and remaining budget
- `archives` — search the archive catalog and retrieve archive metadata
- `orders` — create, list, inspect, and download orders
- `notifications` — manage AOI webhook monitors
- `feasibility` — check capture feasibility and predict satellite passes
- `pricing` — inspect provider pricing tiers

Example CLI flows:

```bash
skyfi-cli whoami
skyfi-cli archives search --aoi 'POLYGON ((-122.4 37.7, -122.3 37.7, -122.3 37.8, -122.4 37.8, -122.4 37.7))'
skyfi-cli orders order-archive --aoi 'POLYGON ((-122.4 37.7, -122.3 37.7, -122.3 37.8, -122.4 37.8, -122.4 37.7))' --archive-id <ARCHIVE_ID>
skyfi-cli feasibility check --aoi 'POLYGON ((-122.4 37.7, -122.3 37.7, -122.3 37.8, -122.4 37.8, -122.4 37.7))' --product-type day --resolution HIGH --start-date 2025-04-01 --end-date 2025-04-15
```

The CLI also supports `--json` on commands for machine-readable output:

```bash
skyfi-cli --json orders list
```

### Phase 7 — Documentation ✅ COMPLETE

- General README and quick start: done
- Platform-specific integration guides: done — see `docs/integrations/`
  - [Google ADK](docs/integrations/adk.md)
  - [LangChain / LangGraph](docs/integrations/langchain.md)
  - [Vercel AI SDK](docs/integrations/ai-sdk.md)
  - [Claude Web](docs/integrations/claude-web.md)
  - [Claude Code](docs/integrations/claude-code.md)
  - [OpenAI](docs/integrations/openai.md)
  - [Gemini](docs/integrations/gemini.md)
- Integration guide code examples for OpenAI and LangChain are backed by checked-in files under `examples/` and can be verified locally with `bun run docs:verify`
- Cloudflare Workers deployment instructions: done

## Stretch Goals

- **Demo Agent — Geospatial Deep Research**: A polished, open-source-ready agent using this MCP for geospatial-supported deep research (LangGraph or similar); LangSmith tracing included
- **PostgreSQL migration**: Swap SQLite for PostgreSQL if AOI monitoring state or multi-user demand grows
- **Rich notification delivery**: Slack, email, or webhook forwarding for AOI alerts beyond console logging
- **Payments integration**: In-MCP payment flow beyond credential-based API key usage

## Design Decisions

### Two-Tool Confirmation Gate

Ordering satellite imagery costs real money. The server enforces a hard human-in-the-loop confirmation before any purchase:

1. **`orders_prepare`** validates parameters, fetches pricing, and returns a summary with a single-use confirmation token (5-minute TTL).
2. **`orders_confirm`** accepts the token and executes the purchase. Invalid or expired tokens are rejected.

This two-tool pattern is intentionally safer than a single tool with a `confirmed: true` flag. The agent must make two separate calls, and the human sees the full price between them. Even if an agent tries to chain calls autonomously, the token mechanism ensures the prepare step visibly completed first.

### Dual-Runtime Session Management

- **Stateful Bun transport**: The Bun/self-hosted path uses `createApp()` and tracks each MCP client session in an in-memory `Map`, keyed by `mcp-session-id`. This keeps pending order tokens isolated per client while still allowing local config-file auth.
- **Stateful Cloudflare Agents transport**: The Workers path uses `SkyFiMcpAgent`, a Durable Object-backed `McpAgent`. MCP session state survives across HTTP requests, and the initial `x-skyfi-api-key` header is persisted into session props so multi-user remote auth still works after the initialization handshake.
- **Shared webhook storage on Workers**: AOI webhook alerts are stored in a separate `SkyFiAlertStore` Durable Object so they are visible across MCP sessions instead of being trapped inside one agent instance.

### No Muninn Framework (PoC)

The project scope describes using `muninn-kernel-ts` and `muninn-frames-ts` as internal dispatch layers. These packages are not published to npm — they exist only as architectural concepts from a prior project. For this PoC, tools are registered directly with the MCP SDK's `McpServer.registerTool()` API. The Muninn patterns (prefix-based syscall routing, frame lifecycle) can be layered in later without changing the external tool surface.

### Direct MCP SDK Transport

The server uses `WebStandardStreamableHTTPServerTransport` from the MCP TypeScript SDK, served through Hono. This gives us:

- HTTP + SSE transport (the current MCP standard)
- Works on Bun, Node.js, Cloudflare Workers, and Deno without changes
- Session resumability support on runtimes that support it (Bun/Node)

### SkyFi API as WKT

The SkyFi API uses WKT (Well-Known Text) polygons for areas of interest rather than GeoJSON. The `location_resolve` tool bridges this by converting OpenStreetMap bounding boxes to WKT polygons automatically, so users can say "search imagery near downtown Kyiv" without knowing the coordinate format.

### Config Precedence

API key resolution follows this order:

1. `x-skyfi-api-key` request header (for cloud/multi-user deployment)
2. `SKYFI_API_KEY` environment variable (or Worker env binding on Cloudflare)
3. `~/.skyfi/config.json` file (Bun/Node only — not available on Workers)

## Local Development

### Prerequisites

- [Bun](https://bun.sh) runtime
- A SkyFi API key ([get one here](https://app.skyfi.com))

### Install and Run

```bash
bun install
```

Set your API key via environment variable:

```bash
export SKYFI_API_KEY=your-key-here
bun run dev
```

Or create `~/.skyfi/config.json`:

```json
{
  "apiKey": "your-key-here",
  "baseUrl": "https://app.skyfi.com/platform-api"
}
```

Both `apiKey`/`api_key` and `baseUrl`/`base_url` spellings are accepted.

The server starts at `http://localhost:3000/mcp`.

### Scripts

```bash
bun run dev      # Start Bun dev server with hot reload
bun run start    # Start Bun production server
bun run check    # TypeScript type check
bun run docs:verify        # Verify synced integration doc examples
bun run docs:sync-examples # Refresh doc snippets from examples/
bun test         # Run unit tests
bun run dev:cf   # Start Cloudflare Workers local dev server (wrangler)
bun run deploy   # Deploy to Cloudflare Workers
```

### Docs Verification

The integration guides in [`docs/integrations/`](docs/integrations/) remain the human-facing documentation source, but the primary OpenAI and LangChain code snippets are mirrored from runnable files in [`examples/`](examples/).

Use:

```bash
bun run docs:verify
```

This checks that the marked snippets in [`docs/integrations/openai.md`](docs/integrations/openai.md) and [`docs/integrations/langchain.md`](docs/integrations/langchain.md) still match the checked-in example files, and syntax-checks those example files. After editing example files, run:

```bash
bun run docs:sync-examples
```

to refresh the embedded Markdown snippets.

### Testing

The project has two test layers: **unit tests** that mock the SkyFi API and test internal logic, and **contract tests** that validate request/response shapes against the published OpenAPI spec via a Prism mock server.

#### Unit Tests

Co-located with each module (files ending in `_test.ts`). Use Bun's built-in test runner. No API key or network access required.

```bash
bun test                # Run all unit tests
bun test --coverage     # Run with line/function coverage report
```

Unit tests mock `fetch` or inject fake client objects so they run fast and offline. They verify:

- **SkyFi client** (`src/client/skyfi_test.ts`, `skyfi_more_test.ts`): HTTP method/path routing for every endpoint, auth header injection, Content-Type conditional on body presence, error throw on non-2xx, empty-body throw on unexpected 2xx, feasibility poll/timeout behavior, query param serialization, 204/205 handling.
- **Transport layer** (`src/server/transport_test.ts`, `agent_transport_test.ts`, `worker_test.ts`): Bun session creation/lookup/deletion, API key propagation from request headers, worker route behavior, Agents session prop binding, health endpoint, webhook receiver, and alert persistence.
- **Tool handlers** (`src/tools/*_test.ts`): each tool's happy path, error paths, and edge cases:
  - `archives_search`: Zod cross-field validation (aoi+dates required unless page cursor provided), response projection (curated fields, human-readable units), pagination cursor passthrough.
  - `feasibility_check`: submit-then-poll flow, response shape.
  - `pricing_get`: with and without AOI, verbatim passthrough.
  - `orders_list` / `orders_get`: response projection (summary vs. full detail), pagination params.
  - `orders_prepare` / `orders_confirm`: two-step confirmation gate — token generation, pricing fetch, archive vs. tasking param validation, token consumption, expired/invalid token rejection, exact param forwarding to API client (camelCase field names verified).
  - `notifications_create` / `notifications_list` / `notifications_get` / `notifications_delete`: CRUD operations, alert inclusion on get, alertStore cleanup on delete.
  - `alerts_list`: per-monitor and cross-monitor retrieval, limit parameter.
  - `location_resolve`: successful geocode with WKT polygon, no-results handling.
- **AlertStore** (`src/tools/alerts_test.ts`): add/get/getAll/clear semantics, per-monitor cap enforcement, cross-monitor chronological sorting.
- **ConfirmationStore** (`src/tools/confirmation_test.ts`): token generation, single-use consumption, TTL expiry with injectable clock, size tracking.
- **Config** (`src/config/config_test.ts`, `local_test.ts`): precedence order (header > env > file), camelCase/snake_case field normalization, malformed JSON fallback, missing file warning.
- **OSM client** (`src/client/osm_test.ts`, `osm_more_test.ts`): bboxToWkt coordinate conversion, resolveLocation integration, error handling for not-found.

#### Contract Tests (Prism)

Validate that `SkyFiClient` sends requests the real API would accept and can parse the responses it would return. A [Prism](https://stoplight.io/open-source/prism) mock server reads the OpenAPI spec (`docs/openapi.json`) and validates every request (field names, types, required fields, path param formats) against the published schemas. Any mismatch returns a 422 → test failure.

**Start Prism** (in a separate terminal):

```bash
bunx prism mock docs/openapi.json --port 4010 --host 127.0.0.1 --errors
```

**Run contract tests:**

```bash
bun test src/client/contract_test.ts
```

The `--errors` flag is required — it enables strict request validation. Without it, Prism accepts any request body and returns mock data regardless.

Contract test coverage:

| Group         | Endpoints tested                                                                                                      |
| ------------- | --------------------------------------------------------------------------------------------------------------------- |
| Auth          | `GET /auth/whoami`                                                                                                    |
| Archives      | `POST /archives` (search), `GET /archives` (pagination), `GET /archives/{id}`                                         |
| Pricing       | `POST /pricing` (with and without AOI)                                                                                |
| Feasibility   | `POST /feasibility`, `GET /feasibility/{id}`, `POST /feasibility/pass-prediction`                                     |
| Orders        | `GET /orders`, `GET /orders/{id}`, `POST /orders/{order_id}/redelivery`, `POST /order-archive`, `POST /order-tasking` |
| Notifications | `POST /notifications`, `GET /notifications`, `GET /notifications/{id}`, `DELETE /notifications/{id}`                  |

Contract tests require Prism to be running. If Prism is not reachable, the test file fails immediately with a startup error message. They are excluded from `bun test` by default (no `contract` in the grep pattern) — run them explicitly.

#### Coverage

Use Bun's built-in coverage reporter for the current numbers:

```bash
bun test --coverage
```

Coverage changes as the suite evolves, so the README does not pin exact percentages or test counts.

### Connect from Claude Code

```bash
claude mcp add skyfi -- http://localhost:3000/mcp
```

### Connect from Claude Desktop

Add to your Claude Desktop MCP config:

```json
{
  "mcpServers": {
    "skyfi": {
      "url": "http://localhost:3000/mcp"
    }
  }
}
```

## Endpoints

| Path            | Method          | Purpose                                                    |
| --------------- | --------------- | ---------------------------------------------------------- |
| `/mcp`          | POST/GET/DELETE | MCP protocol (tool calls, SSE streams, session management) |
| `/health`       | GET             | Health check                                               |
| `/webhooks/aoi` | POST            | Inbound webhook receiver for AOI notifications             |

## Deployment

### Cloudflare Workers (recommended)

Cloudflare Workers is the primary deployment target. The server runs on Cloudflare Agents with stateful Durable Object-backed MCP sessions on Workers.

**Prerequisites:**

- [Wrangler CLI](https://developers.cloudflare.com/workers/wrangler/) (included as a devDependency)
- A Cloudflare account

**Set secrets:**

```bash
bunx wrangler secret put SKYFI_API_KEY
```

Optional environment variables (set in `wrangler.jsonc` or via `wrangler secret put`):

- `SKYFI_BASE_URL` — override the SkyFi API base URL (defaults to `https://app.skyfi.com/platform-api`)
- `LANGCHAIN_API_KEY` — LangSmith API key (when tracing is enabled)

Workers also declare two Durable Object bindings:

- `MCP_OBJECT` — per-session MCP agent instances
- `ALERT_STORE` — shared AOI webhook alert persistence across sessions

**Deploy:**

```bash
bun run deploy
```

The server deploys to `https://skyfi-mcp.ian-zepp.workers.dev/mcp`.

**Local Workers dev server:**

```bash
bun run dev:cf
```

This starts a local Wrangler dev server that simulates the Workers runtime, useful for testing Workers-specific behavior without deploying.

**Connect a remote MCP client:**

```bash
claude mcp add skyfi -- https://skyfi-mcp.ian-zepp.workers.dev/mcp
```

### Bun Self-Hosting

For self-hosted deployments (Railway, VPS, Docker, etc.), use the Bun entry point:

```bash
export SKYFI_API_KEY=your-key-here
bun run start
```

Environment variables:

- `SKYFI_API_KEY` — your SkyFi API key
- `SKYFI_BASE_URL` — override the SkyFi API base URL (optional)
- `PORT` — listening port (default: 3000)

The inbound webhook endpoint (`POST /webhooks/aoi`) requires a stable public URL. For local development with webhooks, use a tunnel (e.g., ngrok).

## Project Structure

```
src/
├── index.ts              # Bun entry point — stateful sessions, local config file
├── worker.ts             # Cloudflare Workers entry point — Agents wrapper + routes
├── worker_routes.ts      # Worker route handler for /mcp, /health, /webhooks/aoi
├── alerts_object.ts      # Durable Object alert persistence + client wrapper
├── config/
│   ├── index.ts          # Portable config loader (env, headers) — no Node.js imports
│   ├── local.ts          # Local config file loader (~/.skyfi/config.json) — Bun only
│   └── config_test.ts    # Config priority order tests (header > env > local)
├── client/
│   ├── types.ts          # SkyFi API request/response types
│   ├── skyfi.ts          # Typed SkyFi HTTP client
│   ├── skyfi_test.ts     # SkyFiClient tests (204/205 handling)
│   ├── skyfi_more_test.ts # Extended client tests (serialization, polling, errors, endpoints)
│   ├── osm.ts            # OpenStreetMap Nominatim client
│   ├── osm_test.ts       # bboxToWkt coordinate tests
│   └── osm_more_test.ts  # Extended OSM tests (resolveLocation, error handling)
├── server/
│   ├── mcp.ts            # MCP server factory — registers all tools
│   ├── transport.ts      # Hono app with HTTP+SSE transport (stateful/stateless)
│   ├── agent_transport.ts      # Custom Agents streamable HTTP handler with session props
│   ├── agent_transport_test.ts # Agents transport tests (header-derived session props)
│   └── transport_test.ts       # Bun transport tests (API key propagation, session modes, lifecycle)
└── tools/
    ├── test_harness.ts        # Shared test helper — creates mock MCP server + client
    ├── search.ts              # archives_search
    ├── search_test.ts         # Schema cross-field validation tests
    ├── search_handler_test.ts # archives_search handler tests (projection, pagination)
    ├── feasibility.ts         # feasibility_check
    ├── feasibility_test.ts    # Feasibility handler tests (submit + poll flow)
    ├── pricing.ts             # pricing_get
    ├── pricing_test.ts        # Pricing handler tests (with/without AOI)
    ├── orders.ts              # orders_list, orders_get, orders_prepare, orders_confirm
    ├── orders_test.ts         # Order handler tests (prepare/confirm flow, validation, errors)
    ├── confirmation.ts        # ConfirmationStore — single-use token store for ordering
    ├── confirmation_test.ts   # ConfirmationStore tests (TTL, single-use)
    ├── alerts.ts              # AlertStore — in-memory AOI webhook alert storage
    ├── alerts_test.ts         # AlertStore tests (add, get, limit, clear)
    ├── aoi.ts                 # create/list/get/delete AOI monitors + get alerts
    ├── aoi_test.ts            # AOI handler tests (CRUD, alerts integration)
    ├── location.ts            # location_resolve (OSM geocoding)
    └── location_test.ts       # Location handler tests (results, no-match)
docs/
└── integrations/
    ├── adk.md               # Google ADK integration guide
    ├── ai-sdk.md            # Vercel AI SDK integration guide
    ├── claude-code.md       # Claude Code integration guide
    ├── claude-web.md        # Claude Web integration guide
    ├── gemini.md            # Google Gemini integration guide
    ├── langchain.md         # LangChain / LangGraph integration guide
    └── openai.md            # OpenAI integration guide
wrangler.jsonc             # Cloudflare Workers deployment config
```

## Next Steps

These are the remaining items needed to bring the implementation in line with `REQUIREMENTS.md`:

1. Build the demo agent. The requirements call for a polished geospatial deep research agent using this MCP server, ready to be open-sourced.
2. Add LangSmith tracing at the tool-call boundary (Phase 2 stretch goal).
