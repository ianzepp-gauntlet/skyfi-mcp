# Test Auditor Memory - skyfi-mcp

## Project Stack
- Runtime: Bun + Cloudflare Workers
- Test framework: Bun built-in (`bun:test`)
- Test file convention: `*_test.ts` colocated with production code
- HTTP framework: Hono
- Validation: Zod
- MCP SDK: @modelcontextprotocol/sdk

## Test Patterns
- Uses a custom `createToolHarness()` (in `src/tools/test_harness.ts`) that stubs `McpServer.registerTool` to capture handlers for direct invocation
- Global `fetch` is monkey-patched per test with `afterEach` cleanup for HTTP client tests
- `ConfirmationStore` accepts injectable `now` parameter for deterministic time testing
- `AlertStore.add()` accepts injectable `now` string for deterministic timestamps
- Mock SkyFi clients are created inline per test (no shared factory)

## Key Architecture
- `SkyFiClient` is the sole HTTP boundary; all tools delegate to it
- Two-step order flow: `orders_prepare` -> `orders_confirm` via `ConfirmationStore`
- `AlertStore` bridges webhook receiver and MCP tool handlers
- Transport layer handles MCP session lifecycle (stateful/stateless)

## Audit Findings (2026-03-11)
- No tests for API client error propagation through tool handlers
- No tests for `loadLocalConfig()` at all
- Webhook endpoint lacks test for alertStore persistence path
- `resolveLocation` empty-query edge case untested
- `searchImagerySchema` only tests 2 of several validation branches
