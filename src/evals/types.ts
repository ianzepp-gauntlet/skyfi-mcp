export interface EvalHttpAction {
  method: string;
  url: string;
  headers?: Record<string, string>;
  body?: unknown;
  expect_status?: number;
}

export interface EvalCase {
  id: string;
  description: string;
  query: string;
  category: string;
  difficulty: string;
  tags?: string[];
  allowed_tools?: string[];
  expected_tools?: string[];
  expected_tool_sequence?: string[];
  tool_must_not_contain?: string[];
  must_contain?: string[];
  must_contain_any?: string[];
  must_not_contain?: string[];
  tool_result_must_contain?: Record<string, string[]>;
  min_final_chars?: number;
  max_steps?: number;
  follow_up_messages?: string[];
  http_actions_before?: EvalHttpAction[];
  http_actions_after?: EvalHttpAction[];
}

export interface EvalSuiteDefinition {
  description: string;
  stage: string;
  mode: "fixture" | "live";
  fixture_set?: string;
  cases: string[];
}

export interface EvalSuitesFile {
  suites: Record<string, EvalSuiteDefinition>;
}

export interface EvalModelsFile {
  models: Record<
    string,
    {
      label: string;
      provider: string;
      model: string;
    }
  >;
}

export interface ToolCallTrace {
  name: string;
  args: Record<string, unknown>;
  outputText: string;
  rawResult: unknown;
}

export interface GradeResult {
  passed: boolean;
  reasons: string[];
}

export type EvalCaseStatus = "passed" | "failed" | "blocked";

export interface JudgeResult {
  verdict: "real_failure" | "rubric_too_strict" | "ambiguous";
  confidence: number;
  reasoning: string;
  recommendedAction: string;
  model: string;
}

export interface CaseArtifact {
  caseId: string;
  mode: "fixture" | "live";
  passed: boolean;
  status: EvalCaseStatus;
  grade: GradeResult;
  judge?: JudgeResult;
  finalText: string;
  toolCalls: ToolCallTrace[];
  responseIds: string[];
  elapsedMs: number;
}

export interface SuiteArtifact {
  suite: string;
  mode: "fixture" | "live";
  model: string;
  caseCount: number;
  passed: number;
  failed: number;
  blocked: number;
  resultsDir: string;
  cases: CaseArtifact[];
}
