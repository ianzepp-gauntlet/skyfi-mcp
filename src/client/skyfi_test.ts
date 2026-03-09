/**
 * Unit tests for SkyFiClient.
 *
 * Strategy: replace `globalThis.fetch` with a stub before each test and
 * restore the original after. This avoids real network calls while still
 * exercising the client's request-handling logic.
 *
 * Coverage focus: edge cases in the private `request` method — particularly
 * the 204/205 "No Content" handling, which must return `undefined` rather than
 * attempting to parse an empty body (a JSON parse error would mask the real
 * behavior and make DELETE operations appear to fail).
 */

import { afterEach, describe, expect, test } from "bun:test";
import { SkyFiClient } from "./skyfi.js";

const originalFetch = globalThis.fetch;

describe("SkyFiClient", () => {
  afterEach(() => {
    // WHY: Restore fetch after each test so stubs don't leak across test cases.
    globalThis.fetch = originalFetch;
  });

  test("returns undefined for successful 204 responses", async () => {
    // WHY: The SkyFi API returns 204 No Content for DELETE operations. The
    // client must not attempt to parse the empty body, which would throw and
    // surface as a misleading error instead of a clean void return.
    globalThis.fetch = ((async () =>
      new Response(null, {
        status: 204,
      })) as unknown) as typeof fetch;

    const client = new SkyFiClient({
      apiKey: "test-key",
      baseUrl: "https://example.com",
    });

    await expect(client.deleteNotification("notification-123")).resolves.toBeUndefined();
  });
});
