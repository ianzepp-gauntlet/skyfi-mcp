/**
 * Local filesystem configuration loader.
 *
 * Reads `~/.skyfi/config.json` as a convenience for local developer
 * workstations where setting environment variables is inconvenient.
 *
 * This module is intentionally separated from `config/index.ts` because it
 * imports Node.js built-ins (`fs`, `os`, `path`) that are unavailable on
 * Cloudflare Workers. Only the Bun/Node entry point (`src/index.ts`) imports
 * this module — the Workers entry point (`src/worker.ts`) skips it entirely.
 */

import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";
import type { SkyFiConfig } from "./index.js";

/**
 * Path to the optional local config file.
 * Follows XDG-like convention: a dotfile directory in the user's home.
 */
const CONFIG_PATH = join(homedir(), ".skyfi", "config.json");

/**
 * Attempt to load partial configuration from the local config file.
 *
 * Returns an empty object rather than throwing if the file is absent or
 * malformed. When the file exists but cannot be parsed, a `console.warn` is
 * emitted with the error message so the misconfiguration is visible without
 * crashing the process. Accepts both camelCase (`apiKey`) and snake_case
 * (`api_key`) key names to reduce friction for users who hand-write the file.
 *
 * @returns A partial config — callers must fill in any missing fields.
 */
export function loadLocalConfig(): Partial<SkyFiConfig> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      apiKey: parsed.apiKey ?? parsed.api_key,
      baseUrl: parsed.baseUrl ?? parsed.base_url,
    };
  } catch (err) {
    console.warn(
      `[skyfi] Failed to parse config file at ${CONFIG_PATH}:`,
      err instanceof Error ? err.message : err,
    );
    return {};
  }
}
