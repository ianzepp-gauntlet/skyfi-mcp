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

## Quick Start

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

## Scripts

```bash
bun run dev      # Start with hot reload
bun run start    # Start production
bun run check    # TypeScript type check
```

## Endpoints

| Path | Method | Purpose |
|------|--------|---------|
| `/mcp` | POST/GET/DELETE | MCP protocol (tool calls, SSE streams, session management) |
| `/health` | GET | Health check |
| `/webhooks/aoi` | POST | Inbound webhook receiver for AOI notifications |

## Tech Stack

- **Runtime**: [Bun](https://bun.sh)
- **MCP SDK**: [@modelcontextprotocol/sdk](https://github.com/modelcontextprotocol/typescript-sdk)
- **HTTP Framework**: [Hono](https://hono.dev)
- **Validation**: [Zod](https://zod.dev)
- **External APIs**: [SkyFi Platform API](https://app.skyfi.com/platform-api/redoc), [OpenStreetMap Nominatim](https://nominatim.openstreetmap.org)
