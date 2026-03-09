import { test, expect, describe } from "bun:test";
import { loadConfig } from "./index.js";

describe("loadConfig", () => {
  test("uses header API key when provided", () => {
    const config = loadConfig("header-key");
    expect(config.apiKey).toBe("header-key");
  });

  test("falls back to SKYFI_API_KEY env var", () => {
    const original = process.env.SKYFI_API_KEY;
    process.env.SKYFI_API_KEY = "env-key";
    try {
      const config = loadConfig();
      expect(config.apiKey).toBe("env-key");
    } finally {
      if (original !== undefined) {
        process.env.SKYFI_API_KEY = original;
      } else {
        delete process.env.SKYFI_API_KEY;
      }
    }
  });

  test("throws when no API key is available", () => {
    const original = process.env.SKYFI_API_KEY;
    delete process.env.SKYFI_API_KEY;
    try {
      expect(() => loadConfig()).toThrow("SkyFi API key not found");
    } finally {
      if (original !== undefined) {
        process.env.SKYFI_API_KEY = original;
      }
    }
  });

  test("uses default base URL", () => {
    const config = loadConfig("key");
    expect(config.baseUrl).toBe("https://app.skyfi.com/platform-api");
  });

  test("respects SKYFI_BASE_URL env var", () => {
    const original = process.env.SKYFI_BASE_URL;
    process.env.SKYFI_BASE_URL = "https://custom.example.com/api";
    try {
      const config = loadConfig("key");
      expect(config.baseUrl).toBe("https://custom.example.com/api");
    } finally {
      if (original !== undefined) {
        process.env.SKYFI_BASE_URL = original;
      } else {
        delete process.env.SKYFI_BASE_URL;
      }
    }
  });
});
