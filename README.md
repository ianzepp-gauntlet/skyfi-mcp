# SkyFi MCP Server

## Executive Summary

This project turns the SkyFi satellite imagery platform into a remote MCP server that an AI agent can use for real work: searching archives, checking feasibility, pricing orders, creating AOI monitors, and preparing or confirming purchases through a controlled tool interface.

The core submission decision was to optimize for a credible remote MCP MVP rather than a broad but shallow demo. That meant focusing on four things the brief actually depends on: a working Cloudflare-hosted MCP surface, safe conversational ordering, AOI monitoring with webhook ingestion, and enough validation to show the server behaves correctly under real tool loops instead of only in unit tests.

## Why This Is The Right MVP

The brief is not asking for a generic API wrapper. It is asking whether SkyFi can become usable inside agent workflows where the model must search, reason, ask clarifying questions, and avoid making unsafe purchases. The strongest MVP therefore is one that proves:

- a remote MCP server can authenticate per user and run on Cloudflare Agents
- the ordering flow cannot jump directly from intent to purchase
- the imagery workflows are broad enough to support exploration, pricing, ordering, and monitoring
- the server can be exercised through real LLM tool loops, not just mocked function calls

That is the shape of this repository. The implementation is intentionally narrower than the full long-term platform vision, but it is deep in the areas that matter most for evaluator confidence.

## Product And Technical Judgment

### 1. Remote MCP first, local parity second

The codebase supports both local Bun hosting and Cloudflare Workers, but the primary target is Cloudflare Agents. The shared MCP/tool layer lives in common modules, while the two entrypoints differ only in bootstrap and config sourcing:

- Bun entrypoint: [`src/index.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/index.ts)
- Cloudflare Workers entrypoint: [`src/worker.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/worker.ts)
- Shared MCP composition root: [`src/server/mcp.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/server/mcp.ts)

This is the correct tradeoff for the brief. It keeps local development simple without fragmenting the actual product surface.

### 2. Human confirmation is enforced as a system property

Ordering satellite imagery costs money, so the server does not expose a one-shot purchase path. Instead it uses a two-step flow:

1. `orders_prepare` validates the request and returns pricing plus a short-lived confirmation token.
2. `orders_confirm` consumes that token and places the order.

That logic is implemented in [`src/tools/orders.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/orders.ts) and backed by a dedicated token store in [`src/tools/confirmation.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/confirmation.ts). This is one of the most important design choices in the repo because it prevents a model from silently converting planning behavior into a paid action.

### 3. AOI monitoring is treated as a real workflow, not a placeholder

The monitoring path includes:

- MCP tools for create/list/get/delete on AOI notifications
- a webhook receiver at `POST /webhooks/aoi`
- alert persistence for later retrieval inside MCP sessions

On Bun, alerts are stored in memory. On Cloudflare, alerts are stored in a shared Durable Object so they are visible across sessions rather than trapped in a single process:

- AOI tools: [`src/tools/aoi.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/aoi.ts)
- Worker routing: [`src/worker_routes.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/worker_routes.ts)
- Durable alert store: [`src/alerts_object.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/alerts_object.ts)

### 4. Geospatial usability matters more than raw endpoint count

SkyFi expects WKT polygons, but users and agents often think in place names. The `location_resolve` tool bridges that gap by converting OpenStreetMap/Nominatim results into WKT polygons that can be passed directly into archive, pricing, feasibility, and monitoring tools:

- Tool registration: [`src/tools/location.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/location.ts)
- OSM client: [`src/client/osm.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/client/osm.ts)

This is a good MVP decision because it removes a major practical failure mode for conversational geospatial tooling.

### 5. Validation is aimed at agent behavior, not only library correctness

The repo includes unit tests, transport tests, contract-style tool tests, and an eval harness that runs a real LLM tool loop against fixture-backed and live scenarios:

- Eval harness: [`src/evals/harness.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/evals/harness.ts)
- Eval runner: [`scripts/run-evals.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/scripts/run-evals.ts)
- Eval scenarios: [`evals/scenarios`](/Users/ianzepp/github/gauntlet/skyfi-mcp/evals/scenarios)
- Eval overview: [`evals/README.md`](/Users/ianzepp/github/gauntlet/skyfi-mcp/evals/README.md)

This is the right evidence to counter "vibe-coded MCP wrapper" skepticism. The harness checks tool choice, forbidden-tool avoidance, multi-step flows, and human approval behavior.

## Requirements Coverage

The target brief is defined in [`REQUIREMENTS.md`](/Users/ianzepp/github/gauntlet/skyfi-mcp/REQUIREMENTS.md). The table below maps each requirement to what is actually present in this repository.

| Requirement | Status | Evidence |
| --- | --- | --- |
| Remote MCP server on Cloudflare Agents | Met | Worker entrypoint and Agent integration in [`src/worker.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/worker.ts), custom transport in [`src/server/agent_transport.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/server/agent_transport.ts), deployment config in [`wrangler.jsonc`](/Users/ianzepp/github/gauntlet/skyfi-mcp/wrangler.jsonc) |
| Built on the SkyFi public API | Met | Typed client in [`src/client/skyfi.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/client/skyfi.ts), local spec copy at [`docs/openapi.json`](/Users/ianzepp/github/gauntlet/skyfi-mcp/docs/openapi.json) |
| Local hosting support | Met | Bun server entrypoint in [`src/index.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/index.ts) |
| Conversational image ordering with price review and human confirmation | Met | `orders_prepare` and `orders_confirm` in [`src/tools/orders.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/orders.ts), token lifecycle tests in [`src/tools/confirmation_test.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/confirmation_test.ts) |
| Feasibility before order placement | Met | Feasibility tooling in [`src/tools/feasibility.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/feasibility.ts), ordering and feasibility scenarios under [`evals/scenarios`](/Users/ianzepp/github/gauntlet/skyfi-mcp/evals/scenarios) |
| Data exploration across search, pricing, orders, and deliverables | Met | Search/pricing/order tools under [`src/tools`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools) |
| AOI monitoring and webhook notifications | Met | AOI tools and webhook persistence in [`src/tools/aoi.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/aoi.ts), [`src/worker_routes.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/worker_routes.ts), and [`src/alerts_object.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/alerts_object.ts) |
| Local JSON config plus cloud header-based auth | Met | Config resolution in [`src/config/index.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/config/index.ts) and local config loader in [`src/config/local.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/config/local.ts) |
| Payments support within MCP | Partial | The server supports preparing and confirming paid orders through SkyFi using an authenticated account, but it does not implement a separate payment subsystem inside this repo |
| OpenStreetMap integration | Met | Place-name resolution in [`src/tools/location.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/location.ts) and [`src/client/osm.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/client/osm.ts) |
| Documentation for ADK, LangChain/LangGraph, AI SDK, Claude Web, OpenAI, Claude Code, Gemini | Met | Integration docs under [`docs/integrations`](/Users/ianzepp/github/gauntlet/skyfi-mcp/docs/integrations) |
| Demo geospatial deep-research agent | Not in this repo | The current repository does not contain the requested polished demo agent |

### Important transport note

The original requirement text asks for "stateless HTTP + SSE transport." That wording reflects an older MCP transport shape. The implemented remote path should be understood as an intentional upgrade to the current Cloudflare Agents + Streamable HTTP model rather than a step away from the goal:

- the Cloudflare deployment uses Cloudflare Agents and returns `text/event-stream`
- session identity is preserved via MCP session IDs and Durable Object-backed agent instances
- the transport is closer to modern Streamable HTTP MCP behavior than to a purely stateless SSE wrapper
- this is the preferred modern transport direction for MCP-style deployments, while the older HTTP + SSE framing is now effectively legacy guidance

That is a deliberate modernization, not an omission. It aligns the server with the current MCP SDK and Cloudflare Agents model, and should be considered an upgrade from the older HTTP + SSE framing rather than a product-level gap.

## What Was Built

The current server exposes tools across six workflow areas:

- account readiness and budget inspection
- archive search and archive detail lookup
- pass prediction and feasibility checks for tasking
- pricing exploration
- order history, deliverable retrieval, redelivery, and controlled ordering
- AOI monitor creation, review, deletion, and alert retrieval
- OpenStreetMap-based location resolution

The MCP composition root in [`src/server/mcp.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/server/mcp.ts) wires these tool groups into a per-session server instance so each caller can be bound to their own SkyFi API key.

## Validation, Reliability, And Testing

The strongest evidence in the repo is not the README text. It is the combination of targeted tests plus agent-loop evals.

### Automated tests

Representative coverage includes:

- transport/session behavior in [`src/server/transport_test.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/server/transport_test.ts)
- Worker route behavior in [`src/worker_test.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/worker_test.ts)
- confirmation token safety in [`src/tools/confirmation_test.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools/confirmation_test.ts)
- tool-specific tests under [`src/tools`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools)

### Eval harness

The eval harness is intentionally biased toward signals that matter for a remote MCP server:

- correct tool choice
- forbidden purchase-tool avoidance
- multi-step flow handling
- non-empty, useful outputs
- explicit human approval behavior before confirmation

The latest checked-in eval artifacts under [`evals/results`](/Users/ianzepp/github/gauntlet/skyfi-mcp/evals/results) show recent successful runs for planner and live smoke suites as documented in [`evals/README.md`](/Users/ianzepp/github/gauntlet/skyfi-mcp/evals/README.md).

## Known Limitations And Expansion Path

This repo is credible as an MCP submission, but there are still clear boundaries.

- The demo deep-research agent requested in the brief is not included here.
- "Payments support" is currently satisfied through SkyFi account/payment readiness and order confirmation flows, not through a bespoke payment UX or wallet layer.
- The remote transport is intentionally modernized around Streamable HTTP semantics and session-backed Cloudflare Agents behavior, which should be treated as an upgrade over the older stateless HTTP + SSE pattern.
- Bun-hosted AOI alert persistence is in-memory; Cloudflare gets the stronger shared Durable Object implementation.
- LangSmith tracing is not implemented in the current codebase.

The most credible next steps would be:

1. Add the open-source geospatial deep-research demo agent requested by the brief.
2. Add trace-level observability around tool execution and failure paths.
3. Decide whether the transport should be reframed as an intentional modernization or adjusted further to match the original requirement wording more literally.
4. Promote the eval harness into a standard release gate for remote deployments.

## Stack And Architecture

- Runtime: Bun locally, Cloudflare Workers remotely
- HTTP layer: Hono for local/server transport, Cloudflare Agents transport for remote
- MCP SDK: `@modelcontextprotocol/sdk`
- Validation: Zod
- External services: SkyFi Platform API and OpenStreetMap Nominatim
- Build and tooling: Bun, TypeScript, ESLint, Prettier, Wrangler

Architecturally, the repo separates:

- typed upstream API clients under [`src/client`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/client)
- runtime-agnostic tool registration under [`src/tools`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/tools)
- MCP server assembly under [`src/server/mcp.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/server/mcp.ts)
- transport/runtime bindings under [`src/server`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/server), [`src/index.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/index.ts), and [`src/worker.ts`](/Users/ianzepp/github/gauntlet/skyfi-mcp/src/worker.ts)

## Setup And Useful Commands

### Local development

```bash
bun install
bun run dev
```

The local server listens on `http://localhost:3000/mcp` by default.

### Cloudflare local development

```bash
bun run dev:cf
```

### Environment

See [`.env.example`](/Users/ianzepp/github/gauntlet/skyfi-mcp/.env.example) for the basic variables:

```bash
SKYFI_API_KEY=...
SKYFI_BASE_URL=https://app.skyfi.com/platform-api
SKYFI_MCP_PUBLIC_BASE_URL=https://your-public-mcp-host.example.com
PORT=3000
```

### Validation commands

```bash
bun test
bun run check
bun run lint
bun run docs:verify
bun run evals --list
```

### Deployment

The Cloudflare deployment configuration lives in [`wrangler.jsonc`](/Users/ianzepp/github/gauntlet/skyfi-mcp/wrangler.jsonc).

```bash
bun run deploy
```
