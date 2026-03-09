import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { homedir } from "os";

export interface SkyFiConfig {
  apiKey: string;
  baseUrl: string;
}

const DEFAULT_BASE_URL = "https://app.skyfi.com/platform-api";
const CONFIG_PATH = join(homedir(), ".skyfi", "config.json");

function loadLocalConfig(): Partial<SkyFiConfig> {
  if (!existsSync(CONFIG_PATH)) return {};
  try {
    const raw = readFileSync(CONFIG_PATH, "utf-8");
    const parsed = JSON.parse(raw);
    return {
      apiKey: parsed.apiKey ?? parsed.api_key,
      baseUrl: parsed.baseUrl ?? parsed.base_url,
    };
  } catch {
    return {};
  }
}

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
