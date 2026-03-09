# SkyFi MCP Server — Implementation Plan

## Key Findings

1. **Muninn packages don't exist on npm** — `muninn-kernel-ts` and `muninn-frames-ts` are not published. Skip for PoC; implement tool dispatch directly with the MCP SDK. The patterns (prefix routing, frame lifecycle) can be adopted later without the abstraction layer.

2. **SkyFi API is well-structured** — Auth via `X-Skyfi-Api-Key` header. Endpoints cover: archives (search), orders (list/create/download), pricing, feasibility, and notifications (AOI monitoring with webhooks). All required functionality exists.

3. **Notifications = AOI monitoring** — The API already supports creating notification filters with webhook URLs, which maps directly to Milestone 4.

## SkyFi API Surface

| Method | Path | Summary |
|--------|------|---------|
| GET | `/auth/whoami` | Current user details and statistics |
| POST | `/archives` | Search catalog with filters (aoi, dates, cloud cover, resolution) |
| GET | `/archives` | Continue paginated search |
| GET | `/archives/{archive_id}` | Retrieve single archive details |
| POST | `/notifications` | Create notification filter (aoi, gsd, product type, webhook URL) |
| GET | `/notifications` | List active notifications |
| GET | `/notifications/{notification_id}` | Get notification with history |
| DELETE | `/notifications/{notification_id}` | Remove notification |
| GET | `/orders` | List customer orders |
| POST | `/order-tasking` | Create tasking order |
| POST | `/order-archive` | Create archive order |
| GET | `/orders/{order_id}` | Get order status and history |
| GET | `/orders/{order_id}/{deliverable_type}` | Download deliverable |
| POST | `/orders/{order_id}/redelivery` | Reschedule delivery |
| POST | `/pricing` | Get pricing matrix |
| POST | `/feasibility/pass-prediction` | Find observable satellite passes |
| POST | `/feasibility` | Check AOI feasibility |
| GET | `/feasibility/{feasibility_id}` | Poll feasibility task status |

## Directory Structure

```
skyfi/
├── src/
│   ├── index.ts                    # Entry point
│   ├── client/
│   │   ├── skyfi.ts                # Typed SkyFi API client
│   │   ├── types.ts                # API request/response types
│   │   └── osm.ts                  # OSM Nominatim client (Phase 5)
│   ├── server/
│   │   ├── mcp.ts                  # MCP server setup + tool registration
│   │   ├── transport.ts            # HTTP + SSE transport (Hono)
│   │   └── middleware/
│   │       ├── auth.ts             # API key resolution (local JSON / headers)
│   │       └── tracing.ts          # LangSmith tracing wrapper
│   ├── tools/
│   │   ├── search.ts               # search_imagery tool
│   │   ├── feasibility.ts          # check_feasibility tool
│   │   ├── pricing.ts              # get_pricing tool
│   │   ├── orders.ts               # list_orders, prepare_order, confirm_order tools
│   │   ├── aoi.ts                  # create/list/delete AOI monitors
│   │   └── location.ts             # resolve_location (OSM)
│   ├── config/
│   │   └── index.ts                # Env + local JSON config loader
│   └── cli/
│       └── index.ts                # CLI entry (Phase 6)
├── package.json
├── tsconfig.json
├── bunfig.toml
└── .env.example
```

## Phases

### Phase 1: Scaffold + SkyFi API Client

**Goal:** Typed HTTP client wrapping the SkyFi API, runnable with Bun.

1. `bun init`, install deps: `@modelcontextprotocol/sdk`, `hono`, `zod`
2. Build typed SkyFi client covering:
   - `POST /archives` — search catalog
   - `GET /archives` — paginated search continuation
   - `GET /archives/:id` — single archive detail
   - `POST /pricing` — pricing matrix
   - `POST /feasibility` — check feasibility
   - `GET /feasibility/:id` — poll feasibility status
   - `GET /orders` — list orders
   - `POST /order-archive` — create archive order
   - `POST /order-tasking` — create tasking order
   - `GET /orders/:id` — order status
   - `POST /notifications` — create notification
   - `GET /notifications` — list notifications
   - `DELETE /notifications/:id` — delete notification
   - `GET /auth/whoami` — current user
3. Config loader: read `SKYFI_API_KEY` from env or `~/.skyfi/config.json`
4. Smoke test: run a search against the real API

### Phase 2: MCP Server + Core Read-Only Tools

**Goal:** Working MCP server that an AI agent can connect to and search imagery.

1. Set up Hono HTTP+SSE server using `@modelcontextprotocol/sdk` `StreamableHTTPServerTransport`
2. Register read-only tools:
   - `search_imagery` — wraps `POST /archives` with params: aoi (GeoJSON/bbox), date range, cloud cover, resolution
   - `check_feasibility` — wraps `POST /feasibility` + polls `GET /feasibility/:id`
   - `get_pricing` — wraps `POST /pricing`
   - `list_orders` — wraps `GET /orders`
   - `get_order` — wraps `GET /orders/:id`
3. Add LangSmith tracing at tool-call boundary (wrap each tool handler)
4. Test with Claude Code as MCP client

### Phase 3: Order Placement + Human-in-the-Loop

**Goal:** Conversational ordering with a hard confirmation gate before any purchase.

Two-tool pattern enforces the confirmation gate:

- `prepare_order` — accepts order params (archive ID or tasking params, delivery config). Internally calls `POST /pricing` to get cost. Returns pricing summary + a short-lived confirmation token. No order is placed.
- `confirm_order` — accepts the confirmation token. Validates it, then executes `POST /order-archive` or `POST /order-tasking`. Fails without a valid token.

This is safer than a single tool with a flag — the agent must make two distinct calls, and the human sees the price in between.

Token implementation: generate a random UUID, store in a `Map<string, OrderIntent>` with a 5-minute TTL. `confirm_order` looks up and deletes the token on use.

### Phase 4: AOI Monitoring

**Goal:** Tools to create, list, and delete AOI monitors; inbound webhook for notifications.

1. `create_aoi_monitor` — wraps `POST /notifications` (aoi, gsd range, product type, webhook URL)
2. `list_aoi_monitors` — wraps `GET /notifications`
3. `get_aoi_monitor` — wraps `GET /notifications/:id` (includes history)
4. `delete_aoi_monitor` — wraps `DELETE /notifications/:id`
5. Add inbound webhook route on Hono: `POST /webhooks/aoi` receives SkyFi callbacks
6. For PoC: log notifications to console. Store in SQLite for retrieval via a `get_aoi_alerts` tool.

### Phase 5: OSM Integration

**Goal:** Conversational geo-lookup so users can say "near downtown Kyiv" instead of providing coordinates.

1. Build Nominatim client (`osm.ts`) — `GET https://nominatim.openstreetmap.org/search`
2. `resolve_location` tool — takes place name string, returns bounding box and GeoJSON polygon
3. Respect Nominatim rate limits (1 req/sec, include User-Agent)

### Phase 6: CLI

**Goal:** Secondary interface mirroring MCP tools.

Wire `commander` to call the same tool logic:
- `skyfi search --bbox ... --from ... --to ...`
- `skyfi orders list`
- `skyfi orders get <id>`
- `skyfi aoi list`
- `skyfi aoi create ...`
- `skyfi auth status`
- `skyfi auth login`

### Phase 7: Documentation

Write after tools are stable:
- Usage guides for: ADK (Google), LangChain/LangGraph, AI SDK (Vercel), Claude Web, Claude Code, OpenAI, Gemini
- Local and Railway deployment instructions

## Build Order (PoC Priority)

| Priority | What | Why |
|----------|------|-----|
| **1** | SkyFi client + config | Everything depends on API access |
| **2** | MCP server + `search_imagery` | Proves the full MCP pipeline end-to-end |
| **3** | `get_pricing` + `check_feasibility` | Completes the read-only tool surface |
| **4** | `prepare_order` + `confirm_order` | Core differentiator — human-in-the-loop |
| **5** | `resolve_location` (OSM) | Quick win, high demo value |
| **6** | AOI monitoring tools | Depends on webhook URL availability |
| **7** | CLI, docs | Polish |

## Risks & Mitigations

| Risk | Mitigation |
|------|-----------|
| No SkyFi API key yet | Build client with types first; add mock responses for dev mode |
| Feasibility endpoint is async (polling) | Tool should poll with timeout, return partial status if slow |
| SSE timeout on Railway | Test keepalive early; MCP SDK may handle this |
| Muninn packages not published | Skip for PoC — direct MCP SDK tool dispatch is simpler and sufficient |
| SkyFi API may not expose all needed fields | Validate against real API responses in Phase 1 smoke test |
| Nominatim rate limits | 1 req/sec limit, cache results, include proper User-Agent |

## Architectural Decisions

1. **No Muninn for PoC** — The abstraction adds complexity without published packages. MCP SDK handles tool dispatch natively.
2. **Two-tool confirmation pattern** — Safer than a single tool with a confirm flag. Forces a visible round-trip through the agent/user.
3. **Hono over Express** — Lighter, better TypeScript support, aligns with monk-api reference patterns.
4. **SQLite only for AOI alert storage** — Everything else is stateless. SQLite is optional and only used if we persist webhook-received notifications.
5. **Config precedence** — Environment variables override local JSON config. Cloud mode uses request headers (no local config needed).
