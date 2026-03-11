/**
 * Unit tests for `loadConfig`.
 *
 * These tests verify the API key and base URL priority order. The `loadConfig`
 * function now accepts `localConfig` and `env` as explicit parameters, making
 * tests deterministic without mutating `process.env`.
 *
 * Priority under test:
 * - API key: header argument > env.SKYFI_API_KEY > localConfig.apiKey
 * - Base URL: env.SKYFI_BASE_URL > localConfig.baseUrl > hardcoded default
 */

import { test, expect, describe } from "bun:test";
import { loadConfig } from "./index.js";

describe("loadConfig", () => {
  test("uses header API key when provided", () => {
    const config = loadConfig("header-key");
    expect(config.apiKey).toBe("header-key");
  });

  test("falls back to env SKYFI_API_KEY", () => {
    const config = loadConfig(undefined, undefined, {
      SKYFI_API_KEY: "env-key",
    });
    expect(config.apiKey).toBe("env-key");
  });

  test("falls back to localConfig apiKey", () => {
    const config = loadConfig(undefined, { apiKey: "local-key" }, {});
    expect(config.apiKey).toBe("local-key");
  });

  test("header takes precedence over env and localConfig", () => {
    const config = loadConfig(
      "header-key",
      { apiKey: "local-key" },
      { SKYFI_API_KEY: "env-key" },
    );
    expect(config.apiKey).toBe("header-key");
  });

  test("env takes precedence over localConfig", () => {
    const config = loadConfig(
      undefined,
      { apiKey: "local-key" },
      { SKYFI_API_KEY: "env-key" },
    );
    expect(config.apiKey).toBe("env-key");
  });

  test("throws when no API key is available", () => {
    expect(() => loadConfig(undefined, {}, {})).toThrow(
      "SkyFi API key not found",
    );
  });

  test("uses default base URL", () => {
    const config = loadConfig("key", undefined, {});
    expect(config.baseUrl).toBe("https://app.skyfi.com/platform-api");
  });

  test("respects env SKYFI_BASE_URL", () => {
    const config = loadConfig("key", undefined, {
      SKYFI_BASE_URL: "https://custom.example.com/api",
    });
    expect(config.baseUrl).toBe("https://custom.example.com/api");
  });

  test("falls back to localConfig baseUrl", () => {
    const config = loadConfig(
      "key",
      { baseUrl: "https://local.example.com/api" },
      {},
    );
    expect(config.baseUrl).toBe("https://local.example.com/api");
  });

  test("env baseUrl takes precedence over localConfig baseUrl", () => {
    const config = loadConfig(
      "key",
      { baseUrl: "https://local.example.com" },
      { SKYFI_BASE_URL: "https://env.example.com" },
    );
    expect(config.baseUrl).toBe("https://env.example.com");
  });
});
