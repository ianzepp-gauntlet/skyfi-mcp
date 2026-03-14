import { describe, expect, test } from "bun:test";
import { gradeCase } from "./harness.js";
import type { EvalCase, ToolCallTrace } from "./types.js";

describe("gradeCase", () => {
  test("passes when expected tools and phrases are present", () => {
    const evalCase: EvalCase = {
      id: "archive-search",
      description: "Search by place name",
      query: "Show imagery near Austin",
      category: "search",
      difficulty: "easy",
      expected_tools: ["location_resolve", "archives_search"],
      must_contain_any: ["imagery", "archive"],
      tool_result_must_contain: {
        location_resolve: ["POLYGON"],
        archives_search: ["archives"],
      },
    };

    const toolCalls: ToolCallTrace[] = [
      {
        name: "location_resolve",
        args: { query: "Austin" },
        outputText: '{"wkt":"POLYGON ((0 0, 1 0, 1 1, 0 1, 0 0))"}',
        rawResult: {},
      },
      {
        name: "archives_search",
        args: { aoi: "POLYGON" },
        outputText: '{"archives":[{"archiveId":"a-1"}]}',
        rawResult: {},
      },
    ];

    const grade = gradeCase(
      evalCase,
      "I found archive imagery options for the area.",
      toolCalls,
    );

    expect(grade.passed).toBe(true);
    expect(grade.reasons).toHaveLength(0);
  });

  test("fails when forbidden tools are used or required content is missing", () => {
    const evalCase: EvalCase = {
      id: "clarify",
      description: "Should ask for clarification",
      query: "Order imagery next month",
      category: "ordering",
      difficulty: "easy",
      tool_must_not_contain: ["orders_prepare", "orders_confirm"],
      must_contain_any: ["clarify", "specify", "need more information"],
    };

    const toolCalls: ToolCallTrace[] = [
      {
        name: "orders_prepare",
        args: {},
        outputText: "{}",
        rawResult: {},
      },
    ];

    const grade = gradeCase(evalCase, "I can handle that.", toolCalls);

    expect(grade.passed).toBe(false);
    expect(grade.reasons.some((reason) => reason.includes("Forbidden tool"))).toBe(
      true,
    );
    expect(
      grade.reasons.some((reason) => reason.includes("missing any acceptable phrase")),
    ).toBe(true);
  });
});
