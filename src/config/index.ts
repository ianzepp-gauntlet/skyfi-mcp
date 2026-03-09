/**
 * Configuration loading for the SkyFi MCP server.
 *
 * API key resolution follows a deliberate priority order so the server can be
 * used in multiple deployment contexts without code changes:
 *
 *   1. Per-request header (`x-skyfi-api-key`) — allows a single server
 *      process to serve multiple callers, each using their own API key.
 *   2. `SKYFI_API_KEY` environment variable — the standard 12-factor approach
 *      for single-tenant deployments.
 *   3. `~/.skyfi/config.json` — convenience for local developer workstations
 *      where setting env vars is inconvenient.
 *
 * Base URL resolution follows the same priority: env var overrides the local
 * config file, which overrides the production default. This lets developers
 * point the server at a staging environment without modifying source code.
 *
 * TRADE-OFFS:
 * - Config is resolved eagerly on each request (via `loadConfig`) rather than
 *   once at startup. This allows the per-request header override to work but
 *   means file I/O happens on every session initialization. The file read is
 *   guarded by `existsSync` and caught silently, so cold paths are fast.
 * - The local config file is silently ignored on parse errors rather than
 *   failing loudly. This is deliberate: a corrupt config file should not
 *   prevent the server from starting when an env var or header key is present.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

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

/**
 * Path to the optional local config file.
 * Follows XDG-like convention: a dotfile directory in the user's home.
 */
const CONFIG_PATH = join(homedir(), ".skyfi", "config.json");

/**
 * Attempt to load partial configuration from the local config file.
 *
 * Returns an empty object rather than throwing if the file is absent or
 * malformed. Accepts both camelCase (`apiKey`) and snake_case (`api_key`)
 * key names to reduce friction for users who hand-write the file.
 *
 * @returns A partial config — callers must fill in any missing fields.
 */
function loadLocalConfig(): Partial<SkyFiConfig> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      // WHY: Accept both naming conventions so the file is easy to author by hand.
      apiKey: parsed.apiKey ?? parsed.api_key,
      baseUrl: parsed.baseUrl ?? parsed.base_url,
    };
  } catch {
    // WHY: Silently ignore parse failures — the caller will fall through to env
    // vars or the header key, and will only fail if those are also absent.
    return {};
  }
}

/**
 * Resolve a complete `SkyFiConfig` from the available configuration sources.
 *
 * Priority for API key: `headerApiKey` argument > `SKYFI_API_KEY` env var >
 * `~/.skyfi/config.json`. Priority for base URL: `SKYFI_BASE_URL` env var >
 * `~/.skyfi/config.json` > built-in production default.
 *
 * @param headerApiKey - API key extracted from the inbound `x-skyfi-api-key`
 *   request header. When present, it takes precedence over all other sources
 *   so that a shared server can be used by multiple callers.
 * @throws {Error} When no API key can be found from any source.
 */
export function loadConfig(headerApiKey?: string): SkyFiConfig {
  const local = loadLocalConfig();

  const apiKey = headerApiKey ?? process.env.SKYFI_API_KEY ?? local.apiKey;
  if (!apiKey) {
    throw new Error(
      "SkyFi API key not found. Set SKYFI_API_KEY env var or create ~/.skyfi/config.json"
    );
  }

  return {
    apiKey,
    baseUrl: process.env.SKYFI_BASE_URL ?? local.baseUrl ?? DEFAULT_BASE_URL,
  };
}
