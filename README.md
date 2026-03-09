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

- **Runtime**: [Bun](https://bun.sh)
- **MCP SDK**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **HTTP Framework**: [Hono](https://hono.dev)
- **Validation**: [Zod](https://zod.dev)
- **Database**: SQLite (lightweight; used for AOI alert persistence if enabled)
- **Observability**: LangSmith tracing (planned at tool-call boundary)
- **Deployment**: Railway (preferred); local self-hosting supported
- **External APIs**: [SkyFi Platform API](https://app.skyfi.com/platform-api/redoc), [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org)

## Implementation Status

Overall: ~72% complete.

### Phase 1 — Scaffold & SkyFi Client ✅ COMPLETE

- TypeScript project setup with Bun
- Typed HTTP client covering all SkyFi API endpoints (archives, orders, pricing, feasibility, notifications)
- Config loader supporting env variables and `~/.skyfi/config.json`

### Phase 2 — MCP Server + Core Read-Only Tools 🚧 PARTIAL

- MCP transport (HTTP + SSE via Hono) with per-session server instances: done
- Tools implemented: `search_imagery` (with pagination), `check_feasibility` (async polling), `get_pricing`, `list_orders`, `get_order`: done
- LangSmith tracing at tool-call boundary: not started
- Real SkyFi API smoke test: not done
- End-to-end validation with a live MCP client: not done

### Phase 3 — Conversational Ordering ✅ COMPLETE

- `prepare_order` validates parameters, fetches pricing, returns a summary with a single-use confirmation token (5-minute TTL)
- `confirm_order` accepts the token and executes the purchase
- Tokens are random UUIDs, single-use, session-isolated

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
- Railway deployment instructions: not written

## Stretch Goals

- **Demo Agent — Geospatial Deep Research**: A polished, open-source-ready agent using this MCP for geospatial-supported deep research (LangGraph or similar); LangSmith tracing included
- **PostgreSQL migration**: Swap SQLite for PostgreSQL if AOI monitoring state or multi-user demand grows
- **Rich notification delivery**: Slack, email, or webhook forwarding for AOI alerts beyond console logging
- **Cloudflare Agents deployment**: Evaluate Cloudflare as an alternative hosting target if Railway proves insufficient for SSE or global edge requirements
- **Payments integration**: In-MCP payment flow beyond credential-based API key usage

## Design Decisions

### Two-Tool Confirmation Gate

Ordering satellite imagery costs real money. The server enforces a hard human-in-the-loop confirmation before any purchase:

1. **`prepare_order`** validates parameters, fetches pricing, and returns a summary with a single-use confirmation token (5-minute TTL).
2. **`confirm_order`** accepts the token and executes the purchase. Invalid or expired tokens are rejected.

This two-tool pattern is intentionally safer than a single tool with a `confirmed: true` flag. The agent must make two separate calls, and the human sees the full price between them. Even if an agent tries to chain calls autonomously, the token mechanism ensures the prepare step visibly completed first.

### Stateful Session Management

Each MCP client connection gets its own transport and session, tracked via the `mcp-session-id` header. This allows concurrent agent connections without cross-talk while keeping each session's pending order tokens isolated.

### No Muninn Framework (PoC)

The project scope describes using `muninn-kernel-ts` and `muninn-frames-ts` as internal dispatch layers. These packages are not published to npm — they exist only as architectural concepts from a prior project. For this PoC, tools are registered directly with the MCP SDK's `McpServer.registerTool()` API. The Muninn patterns (prefix-based syscall routing, frame lifecycle) can be layered in later without changing the external tool surface.

### Direct MCP SDK Transport

The server uses `WebStandardStreamableHTTPServerTransport` from the MCP TypeScript SDK, served through Hono. This gives us:

- HTTP + SSE transport (the current MCP standard)
- Works on Bun, Node.js, Cloudflare Workers, and Deno without changes
- Session resumability support built in

### SkyFi API as WKT

The SkyFi API uses WKT (Well-Known Text) polygons for areas of interest rather than GeoJSON. The `resolve_location` tool bridges this by converting OpenStreetMap bounding boxes to WKT polygons automatically, so users can say "search imagery near downtown Kyiv" without knowing the coordinate format.

### Config Precedence

API key resolution follows this order:

1. Request header (for cloud/multi-user deployment)
2. `SKYFI_API_KEY` environment variable
3. `~/.skyfi/config.json` file

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
  "apiKey": "your-key-here"
}
```

The server starts at `http://localhost:3000/mcp`.

### Scripts

```bash
bun run dev      # Start with hot reload
bun run start    # Start production
bun run check    # TypeScript type check
```

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

### Railway (recommended)

Railway is the preferred deployment target. The HTTP + SSE transport requires long-lived connections — verify Railway's request timeout behavior and configure SSE keepalive if needed.

The inbound webhook endpoint (`POST /webhooks/aoi`) requires a stable public URL. Railway provides this automatically on deployment. For local development with webhooks, use a tunnel (e.g., ngrok).

Environment variables to set on Railway:

- `SKYFI_API_KEY` — your SkyFi API key
- `LANGCHAIN_API_KEY` — LangSmith API key (when tracing is enabled)
- `PORT` — Railway sets this automatically

### Cloudflare (alternative)

The Hono server and MCP SDK transport are compatible with Cloudflare Workers. Cloudflare is a documented fallback if Railway's SSE timeout limits prove problematic at scale. No code changes are required to switch transports.

## Project Structure

```
src/
├── index.ts              # Entry point — starts Hono server
├── config/
│   └── index.ts          # Config loader (env, JSON file, headers)
├── client/
│   ├── types.ts          # SkyFi API request/response types
│   ├── skyfi.ts          # Typed SkyFi HTTP client
│   └── osm.ts            # OpenStreetMap Nominatim client
├── server/
│   ├── mcp.ts            # MCP server factory — registers all tools
│   └── transport.ts      # Hono app with HTTP+SSE transport
└── tools/
    ├── search.ts          # search_imagery
    ├── feasibility.ts     # check_feasibility
    ├── pricing.ts         # get_pricing
    ├── orders.ts          # list_orders, get_order, prepare_order, confirm_order
    ├── aoi.ts             # create/list/delete AOI monitors
    └── location.ts        # resolve_location (OSM geocoding)
```
