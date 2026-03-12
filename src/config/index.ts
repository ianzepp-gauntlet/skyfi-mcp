/**
 * Configuration loading for the SkyFi MCP server.
 *
 * API key resolution follows a deliberate priority order so the server can be
 * used in multiple deployment contexts without code changes:
 *
 *   1. Per-request header (`x-skyfi-api-key`) — allows a single server
 *      process to serve multiple callers, each using their own API key.
 *   2. Environment variable (`SKYFI_API_KEY`) — the standard 12-factor
 *      approach for single-tenant deployments. On Cloudflare Workers, this
 *      comes from Worker env bindings passed via the `env` parameter.
 *   3. Local config file (`~/.skyfi/config.json`) — convenience for local
 *      developer workstations. Passed in via the `localConfig` parameter by
 *      the Bun entry point; omitted on Workers where there is no filesystem.
 *
 * Base URL resolution follows the same priority: env var overrides the local
 * config file, which overrides the production default.
 *
 * This module has zero Node.js built-in imports (`fs`, `os`, `path`) so it is
 * portable across Bun, Node.js, and Cloudflare Workers. Filesystem-dependent
 * config loading is isolated in `config/local.ts` and only used by the Bun
 * entry point.
 */

/**
 * Runtime configuration required to construct a `SkyFiClient`.
 *
 * Kept intentionally minimal — everything else the client needs (HTTP method,
 * path, body) is passed per-call rather than stored here.
 */
export interface SkyFiConfig {
  /** SkyFi Platform API key used to authenticate every request. */
  apiKey: string;
  /**
   * Base URL for the SkyFi Platform API, without a trailing slash.
   * Defaults to the production endpoint.
   */
  baseUrl: string;
}

/** Production SkyFi Platform API endpoint. */
const DEFAULT_BASE_URL = "https://app.skyfi.com/platform-api";

function nonEmpty(value?: string): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * Resolve a complete `SkyFiConfig` from the available configuration sources.
 *
 * Priority for API key: `headerApiKey` > `env.SKYFI_API_KEY` > `localConfig.apiKey`.
 * Priority for base URL: `env.SKYFI_BASE_URL` > `localConfig.baseUrl` > built-in default.
 *
 * @param headerApiKey - API key extracted from the inbound `x-skyfi-api-key`
 *   request header. When present, it takes precedence over all other sources
 *   so that a shared server can be used by multiple callers.
 * @param localConfig - Partial config from the local filesystem (Bun only).
 *   Omit on runtimes without filesystem access (e.g. Cloudflare Workers).
 * @param env - Environment variables. On Cloudflare Workers, pass the Worker
 *   env bindings from Hono's `c.env`. On Bun/Node, defaults to `process.env`.
 * @throws {Error} When no API key can be found from any source.
 */
export function loadConfig(
  headerApiKey?: string,
  localConfig?: Partial<SkyFiConfig>,
  env?: Record<string, string | undefined>,
): SkyFiConfig {
  const local = localConfig ?? {};
  const envVars = env ?? process.env;

  const apiKey =
    nonEmpty(headerApiKey) ??
    nonEmpty(envVars.SKYFI_API_KEY) ??
    nonEmpty(local.apiKey);
  if (!apiKey) {
    throw new Error(
      "SkyFi API key not found. Set SKYFI_API_KEY env var or create ~/.skyfi/config.json",
    );
  }

  return {
    apiKey,
    baseUrl:
      nonEmpty(envVars.SKYFI_BASE_URL) ??
      nonEmpty(local.baseUrl) ??
      DEFAULT_BASE_URL,
  };
}
