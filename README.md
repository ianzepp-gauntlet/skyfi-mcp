# SkyFi MCP Server

An MCP (Model Context Protocol) server that exposes the [SkyFi](https://skyfi.com) satellite imagery platform to AI agents. Enables conversational search, ordering, pricing, feasibility checks, and area-of-interest monitoring — all through standard MCP tool calls.

## Tools

| Tool | Description |
|------|-------------|
| `archives_search` | Search the SkyFi satellite imagery catalog by area, date range, cloud cover, and resolution |
| `feasibility_check` | Check whether a new satellite tasking capture is feasible for a given area and time window |
| `pricing_get` | Get the SkyFi pricing matrix, optionally scoped to a specific area |
| `orders_list` | List your previous SkyFi orders |
| `orders_get` | Get detailed status and history for a specific order |
| `orders_prepare` | Prepare an order and get pricing — does NOT place the order (returns a confirmation token) |
| `orders_confirm` | Execute a prepared order using a confirmation token from `orders_prepare` |
| `notifications_create` | Create an Area of Interest monitor with webhook notifications for new imagery |
| `notifications_list` | List all active AOI monitors |
| `notifications_get` | Get details for a specific AOI monitor, including recent webhook alerts |
| `notifications_delete` | Delete an AOI monitor |
| `alerts_list` | Retrieve recent webhook alerts for AOI monitors |
| `location_resolve` | Resolve a place name to coordinates and WKT polygon via OpenStreetMap |

## API Coverage

The SkyFi Platform API (v2.0.0) spec is saved locally at [`docs/openapi.json`](docs/openapi.json). The table below maps every API endpoint to its MCP tool, and calls out gaps.

### Endpoint Mapping

| Method | Path | MCP Tool | Notes |
|--------|------|----------|-------|
| `POST` | `/archives` | `archives_search` | Initial search |
| `GET` | `/archives` | `archives_search` | Pagination via cursor |
| `GET` | `/archives/{archive_id}` | — | **Not exposed** — no tool to look up a single archive by ID |
| `GET` | `/auth/whoami` | — | **Not exposed** — account info and budget balance not accessible |
| `POST` | `/demo-delivery` | — | **Not exposed** — demo-only feature, low priority |
| `POST` | `/feasibility` | `feasibility_check` | Submit step (polled internally) |
| `GET` | `/feasibility/{feasibility_id}` | *(internal)* | Only called by the polling loop inside `feasibility_check` |
| `POST` | `/feasibility/pass-prediction` | — | **Not exposed** — see note below |
| `GET` | `/health_check` | — | Infrastructure; not useful as an MCP tool |
| `POST` | `/notifications` | `notifications_create` | |
| `GET` | `/notifications` | `notifications_list` | |
| `GET` | `/notifications/{notification_id}` | `notifications_get` | |
| `DELETE` | `/notifications/{notification_id}` | `notifications_delete` | |
| `POST` | `/order-archive` | `orders_confirm` | Archive path |
| `POST` | `/order-tasking` | `orders_confirm` | Tasking path |
| `GET` | `/orders` | `orders_list` | |
| `GET` | `/orders/{order_id}` | `orders_get` | |
| `POST` | `/orders/{order_id}/redelivery` | — | **Not exposed** — no tool to re-trigger delivery |
| `GET` | `/orders/{order_id}/{deliverable_type}` | — | **Not exposed** — no tool to get download URLs |
| `POST` | `/pricing` | *(internal)* | Only called inside `orders_prepare`; not exposed standalone |
| `GET` | `/ping` | — | Infrastructure |

### Missing Gaps

**`POST /feasibility/pass-prediction` — not exposed.**
This is the intended first step in the tasking workflow: find upcoming satellite passes over an AOI, then pin a tasking order to a specific pass via `providerWindowId`. Without this tool, agents cannot use pass-level targeting. The full workflow is:
1. `POST /feasibility/pass-prediction` → get candidate passes with `provider_window_id` values
2. `POST /feasibility` → verify feasibility for a specific pass
3. `POST /order-tasking` with `providerWindowId` set → lock the order to that pass

Currently step 1 is not available, and `orders_prepare` does not accept `providerWindowId` even if it were obtained externally.

**`GET /archives/{archive_id}` — not exposed.**
An agent that has an `archiveId` from a prior session or external source cannot look it up directly; it must re-run a full catalog search.

**`GET /auth/whoami` — not exposed.**
Exposes account balance (`currentBudgetUsage`, `budgetAmount`), demo account flag, and org membership. Useful for an agent to check remaining budget before preparing a costly order.

**`POST /orders/{order_id}/redelivery` — not exposed.**
Allows re-triggering delivery of a completed order to a new destination. Useful when a delivery destination was misconfigured.

**`GET /orders/{order_id}/{deliverable_type}` — not exposed.**
Returns a redirect URL to download the actual imagery file. Without this, an agent can confirm an order was delivered but cannot produce a download link for the user.

**`POST /pricing` — internal only.**
Currently called only inside `orders_prepare` to show pricing before confirmation. It cannot be called standalone, so an agent cannot get pricing estimates without also constructing a full order payload.

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

Overall: ~90% complete.

### Phase 1 — Scaffold & SkyFi Client ✅ COMPLETE

- TypeScript project setup with Bun
- Typed HTTP client covering all SkyFi API endpoints (archives, orders, pricing, feasibility, notifications)
- Config loader supporting env variables, request headers, and `~/.skyfi/config.json` (Bun only)

### Phase 2 — MCP Server + Core Read-Only Tools 🚧 PARTIAL

- MCP transport (Bun via Hono, Workers via Cloudflare Agents Durable Objects): done
- Dual-runtime support (Cloudflare Workers + Bun): done
- Tools implemented: `archives_search` (with pagination), `feasibility_check` (async polling), `pricing_get`, `orders_list`, `orders_get`: done
- Unit and contract test suite: done
- LangSmith tracing at tool-call boundary: not started
- Real SkyFi API smoke test: not done
- End-to-end validation with a live MCP client: not done

### Phase 3 — Conversational Ordering ✅ COMPLETE

- `orders_prepare` validates parameters, fetches pricing, returns a summary with a single-use confirmation token (5-minute TTL)
- `orders_confirm` accepts the token and executes the purchase
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

### Phase 6 — CLI Interface ❌ NOT STARTED

Planned: `skyfi search`, `skyfi orders list/get`, `skyfi aoi list/create`, `skyfi auth login/status` — all backed by the same tool logic as the MCP server.

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
bun test         # Run unit tests
bun run dev:cf   # Start Cloudflare Workers local dev server (wrangler)
bun run deploy   # Deploy to Cloudflare Workers
```

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

Contract test coverage (17 tests):

| Group | Endpoints tested |
|-------|-----------------|
| Auth | `GET /auth/whoami` |
| Archives | `POST /archives` (search), `GET /archives` (pagination), `GET /archives/{id}` |
| Pricing | `POST /pricing` (with and without AOI) |
| Feasibility | `POST /feasibility`, `GET /feasibility/{id}`, `POST /feasibility/pass-prediction` |
| Orders | `GET /orders`, `GET /orders/{id}`, `POST /order-archive`, `POST /order-tasking` |
| Notifications | `POST /notifications`, `GET /notifications`, `GET /notifications/{id}`, `DELETE /notifications/{id}` |

Contract tests require Prism to be running. If Prism is not reachable, the test file fails immediately with a startup error message. They are excluded from `bun test` by default (no `contract` in the grep pattern) — run them explicitly.

#### Coverage

```
File                       | % Funcs | % Lines | Uncovered
---------------------------|---------|---------|----------
All files                  |   97.69 |   97.99 |
 src/client/osm.ts         |  100.00 |  100.00 |
 src/client/skyfi.ts       |  100.00 |  100.00 |
 src/config/index.ts       |  100.00 |  100.00 |
 src/server/transport.ts   |   90.00 |  100.00 |
 src/tools/alerts.ts       |  100.00 |  100.00 |
 src/tools/aoi.ts          |  100.00 |  100.00 |
 src/tools/confirmation.ts |  100.00 |  100.00 |
 src/tools/feasibility.ts  |  100.00 |  100.00 |
 src/tools/location.ts     |  100.00 |  100.00 |
 src/tools/orders.ts       |  100.00 |  100.00 |
 src/tools/pricing.ts      |  100.00 |  100.00 |
 src/tools/search.ts       |  100.00 |  100.00 |
 src/tools/test_harness.ts |  100.00 |   94.12 |
```

- **114 tests** across 20 test files, including **17 contract tests**
- **89.31% line coverage**, **90.17% function coverage** on the full suite
- `src/server/transport.ts` shows 90% function coverage because the default `transportFactory` lambda (a one-liner that constructs the SDK's `WebStandardStreamableHTTPServerTransport`) is never invoked — tests inject a custom factory. Bun's coverage reporter counts lines as covered but the function as uncovered.
- New Cloudflare Agents-specific files (`src/server/agent_transport.ts`, `src/worker_routes.ts`, `src/alerts_object.ts`) lower aggregate coverage because they include Worker runtime branches that are hard to execute under Bun while still being validated by focused unit tests and type-checking.

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

| Path | Method | Purpose |
|------|--------|---------|
| `/mcp` | POST/GET/DELETE | MCP protocol (tool calls, SSE streams, session management) |
| `/health` | GET | Health check |
| `/webhooks/aoi` | POST | Inbound webhook receiver for AOI notifications |

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

The server deploys to `https://skyfi-mcp.<your-account>.workers.dev/mcp`.

**Local Workers dev server:**

```bash
bun run dev:cf
```

This starts a local Wrangler dev server that simulates the Workers runtime, useful for testing Workers-specific behavior without deploying.

**Connect a remote MCP client:**

```bash
claude mcp add skyfi -- https://skyfi-mcp.<your-account>.workers.dev/mcp
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

These are the highest-priority items needed to bring the implementation in line with `REQUIREMENTS.md`:

1. Add live-system verification. Real SkyFi API smoke tests and an end-to-end MCP client validation pass are still missing.
2. Build the demo agent. The requirements call for a polished geospatial deep research agent using this MCP server, ready to be open-sourced.
3. Add LangSmith tracing at the tool-call boundary (Phase 2 gap).
4. Build the CLI interface (Phase 6).
