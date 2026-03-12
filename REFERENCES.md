# References: skyfi

## Reference Projects

### monk-api

**Source:** `/Users/ianzepp/github/ianzepp/monk-api`
**Relevance:** TypeScript Hono server with layered middleware, error factory, and streaming JSONL — maps directly to a TypeScript MCP server + CLI architecture.

#### Patterns to Extract

- **Hono App Factory with Layered Middleware** — Construct the Hono app in a single factory function. Apply middleware in explicit order: request tracking, body parsing, JWT/auth validation, context initialization. Each middleware layer is a separate file under `src/lib/middleware/`. Key files: `/Users/ianzepp/github/ianzepp/monk-api/src/index.ts`, `/Users/ianzepp/github/ianzepp/monk-api/src/lib/middleware/index.ts`
- **Context Initializer Middleware** — A middleware that constructs a per-request system context object and attaches it to `c.set("ctx", ...)`. All downstream handlers read services from this context rather than importing globals. Key file: `/Users/ianzepp/github/ianzepp/monk-api/src/lib/middleware/context-initializer.ts`
- **HttpErrors Factory Class** — A class with static methods (`HttpErrors.notFound()`, `HttpErrors.unauthorized()`, etc.) that return `HTTPException` instances with consistent JSON error bodies. Use this pattern for all error responses in the MCP server and CLI. Key file: `/Users/ianzepp/github/ianzepp/monk-api/src/lib/errors/http-error.ts`
- **JWT Auth Middleware** — Validates a Bearer token, extracts claims, and attaches the user to context. Supports multi-tier access levels (public / user / sudo) via separate middleware variants. Key files: `/Users/ianzepp/github/ianzepp/monk-api/src/lib/middleware/jwt-validator.ts`, `/Users/ianzepp/github/ianzepp/monk-api/src/lib/middleware/auth-validator.ts`
- **Streaming JSONL via AsyncGenerator** — Route handlers call an `AsyncGenerator` function that yields objects; the route flushes each yielded object as a newline-delimited JSON line. Use `c.stream()` with a `for await` loop over the generator. Key file: `/Users/ianzepp/github/ianzepp/monk-api/src/routes/api/bulk/export/POST.ts`
- **Path-as-Route File Convention** — Route files live at `src/routes/<resource>/<METHOD>.ts`. Each file exports a single handler function. A `routes.ts` in the resource directory wires them into the Hono router. Key files: `/Users/ianzepp/github/ianzepp/monk-api/src/routes/auth/routes.ts`, `/Users/ianzepp/github/ianzepp/monk-api/src/routes/health/GET.ts`
- **API Helpers** — Utility functions for consistent JSON response shaping: `jsonOk()`, `jsonCreated()`, `jsonError()`. Key file: `/Users/ianzepp/github/ianzepp/monk-api/src/lib/api-helpers.ts`

---

### gauntlet-week-1

**Source:** `/Users/ianzepp/github/gauntlet/gauntlet-week-1`
**Relevance:** Provides Frame protocol concepts and tool registration patterns for structuring the CLI interface and MCP tool dispatch.

#### Patterns to Extract

- **Frame Protocol for CLI Interface** — Model CLI commands as frames: each request has an `id`, a `syscall` name, and a `data` payload. Responses carry the same `id` plus a `status` (`done`, `error`, `item`). Adapt this as the wire format for MCP tool calls and streaming responses. Key file: `/Users/ianzepp/github/gauntlet/gauntlet-week-1/frames/src/lib.rs`
- **Frame Constructors** — Provide static constructor functions (`request()`, `done()`, `done_with()`, `item_with()`, `error()`) instead of constructing frames ad hoc. Adapt to TypeScript factory functions. Key file: `/Users/ianzepp/github/gauntlet/gauntlet-week-1/server/src/frame.rs`
- **Tool Registration Pattern** — Register MCP tools as a typed list of descriptors (name, description, input JSON schema, handler function). Dispatch by matching `syscall`/tool name to the registered handler. Key file: `/Users/ianzepp/github/gauntlet/gauntlet-week-1/server/src/llm/tools.rs`
- **Syscall Routing by Prefix** — Route incoming calls to subsystem handlers by matching the syscall string prefix (e.g., `"fs."` → filesystem handler, `"llm."` → LLM handler). Implement as a `Map<string, Handler>` lookup in TypeScript. Key file: `/Users/ianzepp/github/gauntlet/gauntlet-week-1/server/src/routes/ws.rs`
