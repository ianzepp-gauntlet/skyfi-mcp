# SkyFi MCP Server — Technical Writer Memory

## Project Overview

SkyFi is a Bun/TypeScript MCP (Model Context Protocol) server that wraps the
SkyFi satellite imagery platform API. Key architectural layers:

- `src/config/` — API key resolution (header > env var > ~/.skyfi/config.json)
- `src/client/skyfi.ts` — Typed HTTP client for the SkyFi Platform API
- `src/client/osm.ts` — OpenStreetMap Nominatim geocoding (no SkyFi involvement)
- `src/client/types.ts` — Pure domain types, no logic
- `src/server/mcp.ts` — Composition root; wires client to tool registrations
- `src/server/transport.ts` — Hono HTTP app with session management
- `src/tools/` — One file per tool group; each exports a `register*Tools` fn
- `src/index.ts` — Bun entry point; exports `{ port, fetch }`

## Documentation Conventions Applied

- File-level JSDoc on every source file explaining architecture, context, trade-offs
- Section dividers using `// ── Name ─────` style (matches existing code style)
- Phase markers (`// PHASE N: NAME`) used in multi-step handlers (orders.ts, transport.ts)
- Inline markers: `WHY:`, `EDGE:`, `NOTE:`, `TRADE-OFFS:` sections in file docs
- Test files get a file-level block explaining testing strategy and coverage focus
- Individual test cases get inline `// WHY:` comments for non-obvious setup choices

## Project-Specific Patterns

- Tool handlers always return `{ content: [{ type: "text", text: JSON.stringify(...) }] }`
- The `registerXxxTools(server, client)` pattern is uniform across all tool files
- `ConfirmationStore` uses injectable `now` parameter for deterministic TTL testing
- `searchImagerySchema` uses `superRefine` for cross-field validation (page vs aoi+dates)
- Linter/formatter is active — files may be reformatted after Write; use Edit for small changes

## Test Framework

Bun test (`bun:test`). Run with `bun test`. All 16 tests pass as of last pass.
