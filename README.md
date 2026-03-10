# SkyFi MCP Server

An MCP (Model Context Protocol) server that exposes the [SkyFi](https://skyfi.com) satellite imagery platform to AI agents. Enables conversational search, ordering, pricing, feasibility checks, and area-of-interest monitoring — all through standard MCP tool calls.

## Tools

| Tool | Description |
|------|-------------|
| `search_imagery` | Search the SkyFi satellite imagery catalog by area, date range, cloud cover, and resolution |
| `check_feasibility` | Check whether a new satellite tasking capture is feasible for a given area and time window |
| `get_pricing` | Get the SkyFi pricing matrix, optionally scoped to a specific area |
| `list_orders` | List your previous SkyFi orders |
| `get_order` | Get detailed status and history for a specific order |
| `prepare_order` | Prepare an order and get pricing — does NOT place the order (returns a confirmation token) |
| `confirm_order` | Execute a prepared order using a confirmation token from `prepare_order` |
| `create_aoi_monitor` | Create an Area of Interest monitor with webhook notifications for new imagery |
| `list_aoi_monitors` | List all active AOI monitors |
| `delete_aoi_monitor` | Delete an AOI monitor |
| `resolve_location` | Resolve a place name to coordinates and WKT polygon via OpenStreetMap |

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
│  Hono transport (transport.ts)      │  ← Shared, with sessionMode option
│    ├─ stateful (Bun)                │
│    └─ stateless (Workers)           │
├─────────────────────────────────────┤
│  Entry point                        │
│    ├─ src/worker.ts (Workers)       │
│    └─ src/index.ts  (Bun)           │
└─────────────────────────────────────┘
```

The Workers entry point runs in **stateless** session mode — each request creates a fresh MCP server and transport. The Bun entry point runs in **stateful** mode with in-memory session tracking, which also supports the optional `~/.skyfi/config.json` file for local developer convenience.

## Implementation Status

Overall: ~80% complete.

### Phase 1 — Scaffold & SkyFi Client ✅ COMPLETE

- TypeScript project setup with Bun
- Typed HTTP client covering all SkyFi API endpoints (archives, orders, pricing, feasibility, notifications)
- Config loader supporting env variables, request headers, and `~/.skyfi/config.json` (Bun only)

### Phase 2 — MCP Server + Core Read-Only Tools 🚧 PARTIAL

- MCP transport (HTTP + SSE via Hono) with per-session server instances: done
- Dual-runtime support (Cloudflare Workers + Bun): done
- Tools implemented: `search_imagery` (with pagination), `check_feasibility` (async polling), `get_pricing`, `list_orders`, `get_order`: done
- Unit test suite covering config, client, transport, and tool-schema validation: done
- LangSmith tracing at tool-call boundary: not started
- Real SkyFi API smoke test: not done
- End-to-end validation with a live MCP client: not done

### Phase 3 — Conversational Ordering ✅ COMPLETE

- `prepare_order` validates parameters, fetches pricing, returns a summary with a single-use confirmation token (5-minute TTL)
- `confirm_order` accepts the token and executes the purchase
- Tokens are random UUIDs, single-use, session-isolated
- `ConfirmationStore` class (`src/tools/confirmation.ts`) implements the token store with lazy TTL expiry and injectable clock for deterministic testing

### Phase 4 — AOI Monitoring 🚧 PARTIAL

- `create_aoi_monitor`, `list_aoi_monitors`, `delete_aoi_monitor`: done
- Inbound webhook receiver at `POST /webhooks/aoi`: done (logs payloads to console)
- `get_aoi_monitor` (with history): not implemented
- Persisted alert storage via SQLite + `get_aoi_alerts` tool: not implemented

### Phase 5 — OpenStreetMap Integration ✅ COMPLETE

- Nominatim client with `User-Agent` header for polite usage
- `resolve_location` tool converts place names to bounding boxes and WKT polygons for use with SkyFi

### Phase 6 — CLI Interface ❌ NOT STARTED

Planned: `skyfi search`, `skyfi orders list/get`, `skyfi aoi list/create`, `skyfi auth login/status` — all backed by the same tool logic as the MCP server.

### Phase 7 — Documentation 🚧 PARTIAL

- General README and quick start: done
- Platform-specific integration guides (ADK, LangChain/LangGraph, AI SDK, Claude Web, Claude Code, OpenAI, Gemini): not written
- Cloudflare Workers deployment instructions: done

## Stretch Goals

- **Demo Agent — Geospatial Deep Research**: A polished, open-source-ready agent using this MCP for geospatial-supported deep research (LangGraph or similar); LangSmith tracing included
- **PostgreSQL migration**: Swap SQLite for PostgreSQL if AOI monitoring state or multi-user demand grows
- **Rich notification delivery**: Slack, email, or webhook forwarding for AOI alerts beyond console logging
- **Payments integration**: In-MCP payment flow beyond credential-based API key usage

## Design Decisions

### Two-Tool Confirmation Gate

Ordering satellite imagery costs real money. The server enforces a hard human-in-the-loop confirmation before any purchase:

1. **`prepare_order`** validates parameters, fetches pricing, and returns a summary with a single-use confirmation token (5-minute TTL).
2. **`confirm_order`** accepts the token and executes the purchase. Invalid or expired tokens are rejected.

This two-tool pattern is intentionally safer than a single tool with a `confirmed: true` flag. The agent must make two separate calls, and the human sees the full price between them. Even if an agent tries to chain calls autonomously, the token mechanism ensures the prepare step visibly completed first.

### Dual-Runtime Session Management

The transport layer supports two session modes via `CreateAppOptions`:

- **Stateful** (Bun, default): Each MCP client connection gets its own transport and session, tracked via the `mcp-session-id` header in an in-memory `Map`. This allows concurrent agent connections without cross-talk while keeping each session's pending order tokens isolated.
- **Stateless** (Workers): Each request creates a fresh MCP server and transport. Requests with `mcp-session-id` are rejected with HTTP 501. This avoids relying on Worker isolate affinity, which is not guaranteed.

### No Muninn Framework (PoC)

The project scope describes using `muninn-kernel-ts` and `muninn-frames-ts` as internal dispatch layers. These packages are not published to npm — they exist only as architectural concepts from a prior project. For this PoC, tools are registered directly with the MCP SDK's `McpServer.registerTool()` API. The Muninn patterns (prefix-based syscall routing, frame lifecycle) can be layered in later without changing the external tool surface.

### Direct MCP SDK Transport

The server uses `WebStandardStreamableHTTPServerTransport` from the MCP TypeScript SDK, served through Hono. This gives us:

- HTTP + SSE transport (the current MCP standard)
- Works on Bun, Node.js, Cloudflare Workers, and Deno without changes
- Session resumability support on runtimes that support it (Bun/Node)

### SkyFi API as WKT

The SkyFi API uses WKT (Well-Known Text) polygons for areas of interest rather than GeoJSON. The `resolve_location` tool bridges this by converting OpenStreetMap bounding boxes to WKT polygons automatically, so users can say "search imagery near downtown Kyiv" without knowing the coordinate format.

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

The project includes unit tests co-located with each module (files ending in `_test.ts`). Tests use Bun's built-in test runner and do not require a real SkyFi API key.

```bash
bun test
```

Coverage areas:
- `config/config_test.ts` — API key and base URL priority order (header > env > local config)
- `client/skyfi_test.ts` — HTTP client edge cases (204/205 No Content handling)
- `client/osm_test.ts` — `bboxToWkt` coordinate transformation
- `server/transport_test.ts` — Per-session API key/env propagation, stateless mode session rejection
- `tools/search_test.ts` — `searchImagerySchema` cross-field validation
- `tools/confirmation_test.ts` — `ConfirmationStore` TTL expiry and single-use enforcement

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

Cloudflare Workers is the primary deployment target. The server runs in stateless session mode on Workers.

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
├── worker.ts             # Cloudflare Workers entry point — stateless sessions
├── config/
│   ├── index.ts          # Portable config loader (env, headers) — no Node.js imports
│   ├── local.ts          # Local config file loader (~/.skyfi/config.json) — Bun only
│   └── config_test.ts    # Unit tests for loadConfig priority order
├── client/
│   ├── types.ts          # SkyFi API request/response types
│   ├── skyfi.ts          # Typed SkyFi HTTP client
│   ├── skyfi_test.ts     # Unit tests for SkyFiClient (204/205 handling)
│   ├── osm.ts            # OpenStreetMap Nominatim client
│   └── osm_test.ts       # Unit tests for bboxToWkt
├── server/
│   ├── mcp.ts            # MCP server factory — registers all tools
│   ├── transport.ts      # Hono app with HTTP+SSE transport (stateful/stateless)
│   └── transport_test.ts # Unit tests for createApp (API key propagation, session modes)
└── tools/
    ├── search.ts          # search_imagery
    ├── search_test.ts     # Unit tests for searchImagerySchema validation
    ├── feasibility.ts     # check_feasibility
    ├── pricing.ts         # get_pricing
    ├── orders.ts          # list_orders, get_order, prepare_order, confirm_order
    ├── confirmation.ts    # ConfirmationStore — single-use token store for ordering
    ├── confirmation_test.ts # Unit tests for ConfirmationStore (TTL, single-use)
    ├── aoi.ts             # create/list/delete AOI monitors
    └── location.ts        # resolve_location (OSM geocoding)
wrangler.jsonc             # Cloudflare Workers deployment config
```

## Next Steps

These are the highest-priority items needed to bring the implementation in line with `REQUIREMENTS.md`:

1. Complete AOI notification delivery. `POST /webhooks/aoi` currently logs and acknowledges payloads, but it does not persist alerts or fan them out so an agent can actually inform the user when new imagery arrives.
2. Write the required integration guides. The project still needs concrete usage documentation for ADK, LangChain/LangGraph, AI SDK, Claude Web, OpenAI, Claude Code, and Gemini.
3. Add live-system verification. Real SkyFi API smoke tests and an end-to-end MCP client validation pass are still missing.
4. Build the demo agent. The requirements call for a polished geospatial deep research agent using this MCP server, ready to be open-sourced.
