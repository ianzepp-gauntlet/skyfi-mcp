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
