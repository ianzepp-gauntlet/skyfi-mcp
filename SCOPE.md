# Project Scope: SkyFi MCP Server

## Tech Stack

- **MCP Server Runtime**: TypeScript (Node.js / Bun) — preferred over Python given solo dev context and strong MCP SDK ecosystem in TS; Python is acceptable per requirements but avoided here
- **Server Framework**: Hono or Express for HTTP + SSE transport
- **CLI Interface**: TypeScript CLI (secondary interface, using `commander` or `yargs`) — MCP marketplace is shifting toward CLI
- **Database**: SQLite (lightweight enough for credential/session storage and AOI monitoring state; upgrade to PostgreSQL if scale demands it)
- **Auth**: External auth provider (TBD); local mode uses stored JSON config; cloud mode uses request headers
- **Deployment**: Railway (preferred over Cloudflare — see Risk Areas); local self-hosting also supported
- **Observability**: LangSmith tracing for all agentic/tool-calling flows
- **External APIs**: SkyFi Public API, OpenStreetMap (Nominatim / Overpass)
- **Webhook Support**: Inbound webhook endpoint for AOI notification callbacks

## MVP Milestones (ordered)

1. **Project scaffold and SkyFi API client**
   - TypeScript project setup with Bun
   - Typed HTTP client wrapping the SkyFi public API (auth, search, orders, feasibility, pricing)
   - Environment-based credential config (local JSON file and header-based)

2. **MCP server — core tools**
   - Stateless HTTP + SSE MCP server using the MCP TypeScript SDK
   - Tools: search imagery, check feasibility, get pricing, list previous orders, fetch ordered images
   - LangSmith tracing integrated at the tool-call layer

3. **Conversational image ordering with human-in-the-loop**
   - Tool flow: check feasibility → present pricing → require explicit user confirmation → place order
   - Confirmation gate is a hard requirement before any purchase action

4. **AOI monitoring setup**
   - Tools to create, list, and delete AOI monitors
   - Inbound webhook endpoint to receive new-imagery notifications
   - Notification delivery (initially: log / console; can be extended)

5. **OpenStreetMap integration**
   - Tools to resolve place names and bounding boxes via OSM (Nominatim)
   - Enables conversational geo-lookup ("show me imagery near downtown Kyiv")

6. **CLI interface**
   - Secondary CLI wrapping the same tool logic as the MCP server
   - Commands mirror MCP tools: `skyfi search`, `skyfi order`, `skyfi aoi`, etc.
   - Credential management commands (`skyfi auth login`, `skyfi auth status`)

7. **Documentation**
   - Usage guides for: ADK (Google), LangChain/LangGraph, AI SDK (Vercel), Claude Web, Claude Code, OpenAI, Gemini
   - Local and Railway deployment instructions

## Muninn Framework Integration

The MCP tool dispatch model — one tool call producing a stream of results terminating with a final status — is structurally identical to the Muninn request/stream/terminal lifecycle. Adopting `muninn-kernel-ts` as the internal tool routing layer gives MCP tool calls a consistent, testable dispatch path and makes the human-in-the-loop confirmation gate a first-class architectural primitive.

### Components

| Component | Role in This Project |
|---|---|
| `muninn-kernel-ts` | In-process tool dispatcher — each MCP tool maps to a `call` prefix; the kernel routes `request` frames to the correct `Syscall` handler and streams `item`/`done` responses back |
| `muninn-frames-ts` | Shared frame schema — `Frame`, `Status`, `encodeFrame`, `decodeFrame` used at the SSE transport boundary between the MCP server and AI agent clients |

### MCP Tool → Muninn Call Mapping

| MCP Tool | Muninn Call | Stream Shape |
|---|---|---|
| `search_imagery` | `imagery:search` | `item` per result → `done` |
| `check_feasibility` | `order:feasibility` | `done` with feasibility data |
| `get_pricing` | `order:pricing` | `done` with pricing data |
| `place_order` | `order:place` | `done` with order confirmation |
| `list_orders` | `order:list` | `item` per order → `done` |
| `create_aoi_monitor` | `aoi:create` | `done` with monitor ID |
| `list_aoi_monitors` | `aoi:list` | `item` per monitor → `done` |
| `delete_aoi_monitor` | `aoi:delete` | `done` |
| `resolve_location` | `osm:geocode` | `done` with bounding box |

### Human-in-the-Loop Confirmation Gate (Milestone 3)

The hard confirmation requirement before order placement maps naturally onto the Muninn frame lifecycle:

```
request("order:confirm", { order_details })
  → item({ type: "confirmation_required", summary: "...", price: "..." })
  → [wait for human approval via SigcallRegistry]
  → done({ confirmed: true })   — if approved
  → error({ code: "E_CANCELLED", message: "Order cancelled by user" })  — if rejected
```

The `SigcallRegistry` in `muninn-kernel-ts` handles the dynamic, per-session confirmation handler: when a confirmation is needed, the server registers a temporary sigcall endpoint for that session's response, waits for the human to act, then unregisters it. This cleanly separates the confirmation protocol from the tool implementation.

### Requirement Mapping

| Requirement | Muninn Touch Point |
|---|---|
| MCP tool dispatch (Milestones 2–5) | `muninn-kernel-ts` routes `request` frames to typed `Syscall` handlers by prefix; each MCP tool is a syscall |
| Streaming tool results via SSE transport | `muninn-frames-ts` encodes frames as JSON strings written to the SSE stream |
| Human confirmation before order placement (Milestone 3) | `SigcallRegistry.register(sessionId)` creates a temporary per-session confirmation handler |
| AOI webhook inbound → agent notification (Milestone 4) | Inbound webhook fires `kernel.dispatch(request("aoi:notify", payload))`; routed to a notification syscall |
| Concurrent tool calls from AI agents | `Caller` in `muninn-kernel-ts` is stateless and safe for concurrent in-flight requests |
| Demo agent streaming results (Milestone 7) | `caller.call(request("imagery:search", params))` returns `AsyncIterable<Frame>` consumed by the LangGraph/ADK demo agent |

### TypeScript Kernel Pattern

```ts
import { Kernel, request } from "muninn-kernel-ts";
import type { Syscall, Frame, Caller } from "muninn-kernel-ts";

class ImagerySearchSyscall implements Syscall {
  prefix() { return "imagery"; }

  async *dispatch(frame: Frame, caller: Caller, cancel: AbortSignal): AsyncIterable<Frame> {
    const results = await skyfiClient.search(frame.data);
    for (const result of results) {
      if (cancel.aborted) { yield responseFrom(frame, "cancel", {}); return; }
      yield responseFrom(frame, "item", result);
    }
    yield responseFrom(frame, "done", {});
  }
}

const kernel = Kernel.create();
kernel.register(new ImagerySearchSyscall());
kernel.register(new OrderSyscall());
kernel.register(new AoiSyscall());
kernel.register(new OsmSyscall());
```

### SSE Transport Boundary

At the SSE gateway, `muninn-frames-ts` encodes/decodes frames as JSON strings — the lightweight alternative to protobuf used by the Rust wire layer:

```ts
import { encodeFrame, decodeFrame } from "muninn-frames-ts";

// Outbound: encode kernel frame → SSE event
sseResponse.write(`data: ${encodeFrame(frame)}\n\n`);

// Inbound: decode SSE event → kernel frame
const frame = decodeFrame(sseEventData);
await kernel.dispatch(frame);
```

### What Is Not Used Here

`muninn-kernel-rs`, `muninn-frames-rs`, and `muninn-bridge-rs` are not applicable — the MCP server is TypeScript only. `muninn-client-ts` is not needed server-side; it would be relevant if a TypeScript browser client connects to this MCP server directly.

---

## Stretch Goals

- **Demo Agent — Geospatial Deep Research**: A polished, open-source-ready agent using this MCP for geospatial-supported deep research (LangGraph or similar); LangSmith tracing included
- **PostgreSQL migration**: Swap SQLite for PostgreSQL if AOI monitoring state or multi-user demand grows
- **Rich notification delivery**: Slack, email, or webhook forwarding for AOI alerts beyond console logging
- **Cloudflare Agents deployment**: Evaluate Cloudflare as an alternative hosting target if Railway proves insufficient for SSE or global edge requirements
- **Payments integration**: In-MCP payment flow beyond credential-based API key usage

## External Dependencies

| Dependency | Purpose | Notes |
|---|---|---|
| SkyFi Public API | Core data and ordering | Requires API key; rate limits TBD |
| OpenStreetMap (Nominatim / Overpass) | Geo-lookup and bounding box resolution | Free; rate-limit politely |
| LangSmith | Tracing for agentic/tool flows | Requires LANGCHAIN_API_KEY |
| MCP TypeScript SDK | MCP protocol implementation | `@modelcontextprotocol/sdk` |
| Railway | Deployment hosting | SSE transport must remain open — verify Railway timeout behavior |
| External Auth Provider (TBD) | Cloud multi-user auth | Provider not yet selected |

## Risk Areas

- **Railway vs. Cloudflare tension**: Requirements specify Cloudflare Agents for MCP hosting; Railway is preferred here. SSE (long-lived HTTP connections) may hit Railway's request timeout limits. Mitigate by testing SSE keepalive behavior early, and document Cloudflare as a fallback target.
- **Human confirmation gate**: The order confirmation requirement is a hard safety constraint. Tool design must ensure no order is placed without an explicit confirmation step — this needs careful MCP tool flow design to be enforced even when an agent tries to chain calls autonomously.
- **SkyFi API coverage**: The public API may not expose all functionality needed (e.g., webhook registration for AOI monitoring). Scope may need to be adjusted based on actual API capabilities discovered during integration.
- **AOI webhook reliability**: Inbound webhooks require a stable public URL. On Railway this is straightforward; locally it requires a tunnel (ngrok, etc.). Document this clearly.
- **Auth provider selection (TBD)**: Cloud multi-user auth is scoped but the provider is unselected. This is a blocking dependency for multi-user deployment — keep local single-user mode fully functional as a fallback.
- **LangSmith in non-Python stack**: LangSmith has first-class support for Python; TypeScript support exists but is less mature. Validate tracing integration early in the build.
