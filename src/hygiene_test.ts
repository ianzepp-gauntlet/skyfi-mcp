// Hygiene — enforces coding standards at test time.
//
// These tests scan the source tree for antipatterns that violate project
// standards. Each has a budget (ideally zero). If you must add one, you
// have to fix an existing one first — the budget never grows.

import * as fs from "fs";
import * as path from "path";
import { describe, test, expect } from "bun:test";

// ── Ratchet budgets ───────────────────────────────────────────────────────────
// These reflect current production-code totals.
// Lower them as existing debt is removed; no category may grow.

// Type system escapes.
const MAX_ANY_TYPE = 0; // ": any" in type positions
const MAX_AS_UNKNOWN_AS = 0; // double-cast escape hatch
const MAX_TS_SUPPRESS = 0; // @ts-ignore, @ts-expect-error, @ts-nocheck

// Unhandled promise loss — fire-and-forget void discards.
// Current: transport.ts:187 (void server.close() — intentional async cleanup)
const MAX_VOID_DISPATCH = 1;

// Raw JSON.parse in production code — should stay at transport/config boundaries.
// Current: skyfi.ts (response parse + JSDoc comment), local.ts (config parse + JSDoc comment), orders.ts (pricing roundtrip)
const MAX_JSON_PARSE = 4;

// console.* calls in production code — debug/info logging.
// Current: index.ts (startup banner), transport.ts (webhook log), local.ts (console.warn + JSDoc comment)
const MAX_CONSOLE = 4;

// ── Helpers ───────────────────────────────────────────────────────────────────

interface SourceFile {
  filePath: string;
  content: string;
  lines: string[];
}

function collectSourceFiles(dir: string): SourceFile[] {
  const results: SourceFile[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...collectSourceFiles(fullPath));
    } else if (entry.name.endsWith(".ts") && !entry.name.endsWith("_test.ts")) {
      const content = fs.readFileSync(fullPath, "utf8");
      results.push({ filePath: fullPath, content, lines: content.split("\n") });
    }
  }
  return results;
}

function countMatches(files: SourceFile[], pattern: string): number {
  let total = 0;
  for (const file of files) {
    for (const line of file.lines) {
      if (line.includes(pattern)) total++;
    }
  }
  return total;
}

function matchingLines(files: SourceFile[], pattern: string): string[] {
  const hits: string[] = [];
  for (const file of files) {
    for (let i = 0; i < file.lines.length; i++) {
      const line = file.lines[i];
      if (line?.includes(pattern)) {
        hits.push(`  ${file.filePath}:${i + 1}: ${line.trim()}`);
      }
    }
  }
  return hits;
}

const srcDir = path.resolve(import.meta.dir, ".");
const files = collectSourceFiles(srcDir);

// ── Type system escapes ───────────────────────────────────────────────────────

describe("hygiene", () => {
  test("any type budget", () => {
    const count = countMatches(files, ": any");
    expect(count).toBeLessThanOrEqual(MAX_ANY_TYPE);
  });

  test("as unknown as budget", () => {
    const count = countMatches(files, "as unknown as");
    expect(count).toBeLessThanOrEqual(MAX_AS_UNKNOWN_AS);
  });

  test("ts-suppress budget", () => {
    const count = countMatches(files, "@ts-");
    const hits = matchingLines(files, "@ts-");
    expect(count).toBeLessThanOrEqual(MAX_TS_SUPPRESS);
    if (count > MAX_TS_SUPPRESS) {
      throw new Error(
        `"@ts-" suppress budget exceeded (${count}/${MAX_TS_SUPPRESS}):\n${hits.join("\n")}`,
      );
    }
  });

  // ── Silent promise loss ───────────────────────────────────────────────────

  test("void dispatch budget", () => {
    let fireAndForget = 0;
    const hits: string[] = [];
    for (const file of files) {
      for (let i = 0; i < file.lines.length; i++) {
        const trimmed = file.lines[i]?.trimStart();
        // Count "void expr" statements, not return type annotations
        if (trimmed?.startsWith("void ") && !trimmed.startsWith("void 0")) {
          fireAndForget++;
          hits.push(`  ${file.filePath}:${i + 1}: ${trimmed}`);
        }
      }
    }
    expect(fireAndForget).toBeLessThanOrEqual(MAX_VOID_DISPATCH);
    if (fireAndForget > MAX_VOID_DISPATCH) {
      throw new Error(
        `fire-and-forget "void <expr>" budget exceeded (${fireAndForget}/${MAX_VOID_DISPATCH}):\n${hits.join("\n")}`,
      );
    }
  });

  // ── Serialization / parsing ───────────────────────────────────────────────

  test("JSON.parse budget", () => {
    const count = countMatches(files, "JSON.parse");
    const hits = matchingLines(files, "JSON.parse");
    expect(count).toBeLessThanOrEqual(MAX_JSON_PARSE);
    if (count > MAX_JSON_PARSE) {
      throw new Error(
        `JSON.parse budget exceeded (${count}/${MAX_JSON_PARSE}):\n${hits.join("\n")}`,
      );
    }
  });

  // ── Debug leaks ───────────────────────────────────────────────────────────

  test("console budget", () => {
    const count = countMatches(files, "console.");
    const hits = matchingLines(files, "console.");
    expect(count).toBeLessThanOrEqual(MAX_CONSOLE);
    if (count > MAX_CONSOLE) {
      throw new Error(
        `console.* budget exceeded (${count}/${MAX_CONSOLE}):\n${hits.join("\n")}`,
      );
    }
  });
});
