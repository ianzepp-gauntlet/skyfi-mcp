/**
 * Unit tests for `searchImagerySchema`.
 *
 * Tests focus on the cross-field `superRefine` validation rule that enforces
 * the two calling modes of `archives_search`:
 * - Pagination mode (only `page` required): must pass validation.
 * - Initial search mode (aoi + fromDate + toDate required): must fail when any
 *   of those fields is missing, even if other optional fields are present.
 *
 * These tests document the contract that the tool handler relies on — if this
 * validation is broken, the handler's non-null assertions (`aoi!`, `fromDate!`)
 * could cause runtime errors.
 */

import { describe, expect, test } from "bun:test";
import { registerSearchTools, searchImagerySchema } from "./search.js";
import { createToolHarness } from "./test_harness.js";

describe("searchImagerySchema", () => {
  test("allows page-only pagination requests", () => {
    const result = searchImagerySchema.safeParse({
      page: "cursor-123",
    });

    expect(result.success).toBe(true);
  });

  test("rejects initial searches without required fields", () => {
    const result = searchImagerySchema.safeParse({
      aoi: "POLYGON((0 0, 1 0, 1 1, 0 1, 0 0))",
      fromDate: "2026-01-01",
    });

    expect(result.success).toBe(false);
  });

  test("accepts full initial search with aoi, fromDate, toDate", () => {
    const result = searchImagerySchema.safeParse({
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      fromDate: "2026-01-01",
      toDate: "2026-06-01",
    });

    expect(result.success).toBe(true);
  });

  test("rejects empty object (no page, no aoi+dates)", () => {
    const result = searchImagerySchema.safeParse({});

    expect(result.success).toBe(false);
  });

  test("rejects aoi+toDate without fromDate", () => {
    const result = searchImagerySchema.safeParse({
      aoi: "POLYGON((0 0,1 0,1 1,0 1,0 0))",
      toDate: "2026-06-01",
    });

    expect(result.success).toBe(false);
  });

  test("rejects fromDate+toDate without aoi", () => {
    const result = searchImagerySchema.safeParse({
      fromDate: "2026-01-01",
      toDate: "2026-06-01",
    });

    expect(result.success).toBe(false);
  });
});

describe("registerSearchTools", () => {
  test("archive_get looks up a single archive by id", async () => {
    const harness = createToolHarness();
    const calls: string[] = [];
    const client = {
      getArchive: async (archiveId: string) => {
        calls.push(archiveId);
        return { archiveId, provider: "Planet" };
      },
      searchArchives: async () => ({ total: 0, archives: [] }),
      getArchivesPage: async () => ({ total: 0, archives: [] }),
    };

    registerSearchTools(harness.server as any, client as any);

    const raw = await harness.invoke("archive_get", { archive_id: "arc-123" });
    const result = JSON.parse((raw as any).content[0].text);

    expect(result).toEqual({ archiveId: "arc-123", provider: "Planet" });
    expect(calls).toEqual(["arc-123"]);
  });
});
