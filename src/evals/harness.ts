import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { basename, join, resolve } from "node:path";
import YAML from "yaml";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { parseJson, parseJsonObject } from "../lib/json.js";
import type {
  CaseArtifact,
  EvalCase,
  EvalHttpAction,
  EvalModelsFile,
  EvalSuiteDefinition,
  EvalSuitesFile,
  GradeResult,
  JudgeResult,
  SuiteArtifact,
  ToolCallTrace,
} from "./types.js";

interface OpenAIResponse {
  id: string;
  output?: Array<{
    type?: string;
    name?: string;
    arguments?: string;
    call_id?: string;
    content?: Array<{ type?: string; text?: string }>;
  }>;
  output_text?: string;
  error?: { message?: string };
}

interface OpenRouterJudgeResponse {
  choices?: Array<{
    message?: {
      content?: string;
    };
  }>;
  error?: { message?: string };
  model?: string;
}

interface HarnessOptions {
  rootDir: string;
  suiteName: string;
  modelName: string;
  serverUrl: string;
  openAiApiKey: string;
  openRouterApiKey?: string;
  judgeModel?: string;
  skyfiApiKey?: string;
  resultsRoot?: string;
  caseFilter?: string[];
}

interface LoadedSuite {
  definition: EvalSuiteDefinition;
  cases: EvalCase[];
}

interface ToolDescriptor {
  name: string;
  description?: string;
  inputSchema: {
    type: "object";
    properties?: Record<string, object>;
    required?: string[];
  };
}

interface ToolExecutor {
  listTools(): Promise<ToolDescriptor[]>;
  callTool(name: string, args: Record<string, unknown>, evalCase: EvalCase): Promise<unknown>;
  close(): Promise<void>;
}

type FixtureFile = {
  tool_results: Record<string, unknown | unknown[]>;
};

function normalizeList(values?: string[]): string[] {
  return values ?? [];
}

function normalizeText(value: string): string {
  return value.toLowerCase();
}

function includesNormalized(haystack: string, needle: string): boolean {
  return normalizeText(haystack).includes(normalizeText(needle));
}

async function loadYamlFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return YAML.parse(raw) as T;
}

async function loadSuite(rootDir: string, suiteName: string): Promise<LoadedSuite> {
  const suitesPath = join(rootDir, "evals", "suites.yaml");
  const suites = await loadYamlFile<EvalSuitesFile>(suitesPath);
  const definition = suites.suites[suiteName];
  if (!definition) {
    throw new Error(`Unknown eval suite: ${suiteName}`);
  }

  const cases: EvalCase[] = [];
  for (const caseId of definition.cases) {
    const casePath = join(rootDir, "evals", "scenarios", `${caseId}.yaml`);
    const evalCase = await loadYamlFile<EvalCase>(casePath);
    cases.push(evalCase);
  }

  return { definition, cases };
}

async function resolveModelName(rootDir: string, requested: string): Promise<string> {
  const modelsPath = join(rootDir, "evals", "models.yaml");
  const models = await loadYamlFile<EvalModelsFile>(modelsPath);
  return models.models[requested]?.model ?? requested;
}

function createResultsDirName(date = new Date()): string {
  const iso = date.toISOString().replaceAll(":", "-");
  return iso;
}

function stringifyToolResult(result: unknown): string {
  if (
    result &&
    typeof result === "object" &&
    "content" in result &&
    Array.isArray((result as { content?: unknown[] }).content)
  ) {
    const parts = ((result as { content: Array<{ type?: string; text?: string }> })
      .content ?? [])
      .filter((item) => item.type === "text" && typeof item.text === "string")
      .map((item) => item.text ?? "");
    if (parts.length > 0) return parts.join("\n\n");
  }

  if (typeof result === "string") return result;
  return JSON.stringify(result, null, 2);
}

function extractFunctionCalls(response: OpenAIResponse): Array<{
  name: string;
  arguments: string;
  callId: string;
}> {
  const output = response.output ?? [];
  return output
    .filter((item) => item.type === "function_call")
    .map((item) => ({
      name: item.name ?? "",
      arguments: item.arguments ?? "{}",
      callId: item.call_id ?? "",
    }))
    .filter((item) => item.name.length > 0 && item.callId.length > 0);
}

function extractFinalText(response: OpenAIResponse): string {
  if (typeof response.output_text === "string" && response.output_text.trim()) {
    return response.output_text;
  }

  const pieces = (response.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((item) => item.type === "output_text" || item.type === "text")
    .map((item) => item.text ?? "")
    .filter((text) => text.trim().length > 0);

  return pieces.join("\n\n");
}

function buildInitialPrompt(evalCase: EvalCase): string {
  return [
    "You are evaluating a SkyFi MCP assistant.",
    "Use tools when they are necessary, but do not fabricate facts or tool results.",
    "Do not invent required user inputs such as AOIs, coordinates, geometries, archive IDs, webhook URLs, delivery destinations, dates, or confirmation tokens.",
    "If the request is ambiguous, ask for clarification instead of guessing.",
    "If the user refers to 'this AOI', 'that location', or similar without actually providing the geometry or coordinates, treat the request as underspecified and ask for the missing details.",
    "If location resolution returns several clearly near-duplicate results for the same address or named place, prefer the first or most relevant resolved result and continue to the downstream tool instead of blocking on clarification.",
    "For purchase-related requests, do not claim an order is placed unless the flow explicitly reaches confirmation.",
    "If you prepare an order but do not confirm it, explicitly tell the user that the order has not yet been placed and that explicit confirmation is still required.",
    `User request: ${evalCase.query}`,
  ].join("\n\n");
}

function parseJsonObjectFromText(text: string): unknown {
  const trimmed = text.trim();
  if (trimmed.startsWith("```")) {
    const withoutStart = trimmed.replace(/^```[a-zA-Z0-9_-]*\s*/, "");
    const withoutFence = withoutStart.replace(/\s*```$/, "");
    return parseJson(withoutFence.trim());
  }
  return parseJson(trimmed);
}

async function createOpenAIResponse(params: {
  apiKey: string;
  model: string;
  input: unknown;
  tools: unknown[];
  previousResponseId?: string;
}): Promise<OpenAIResponse> {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      input: params.input,
      tools: params.tools,
      previous_response_id: params.previousResponseId,
      parallel_tool_calls: false,
    }),
  });

  const json = (await response.json()) as OpenAIResponse;
  if (!response.ok) {
    throw new Error(
      `OpenAI Responses API failed (${response.status}): ${json.error?.message ?? JSON.stringify(json)}`,
    );
  }

  return json;
}

async function runJudge(params: {
  apiKey: string;
  model: string;
  evalCase: EvalCase;
  grade: GradeResult;
  finalText: string;
  toolCalls: ToolCallTrace[];
}): Promise<JudgeResult> {
  const prompt = [
    "You are grading whether an eval failure is a real failure or a rubric problem.",
    'Return strict JSON with keys: verdict, confidence, reasoning, recommendedAction.',
    'Allowed verdict values: "real_failure", "rubric_too_strict", "ambiguous".',
    "Use rubric_too_strict when the assistant behavior is acceptable or safer than required, but the deterministic rubric was too narrow.",
    "Use real_failure when the assistant missed intent, behaved unsafely, or skipped a necessary tool.",
    "Use ambiguous only when both the case and output are too unclear to judge with confidence.",
    "",
    `Case ID: ${params.evalCase.id}`,
    `Description: ${params.evalCase.description}`,
    `User query: ${params.evalCase.query}`,
    `Deterministic failure reasons: ${params.grade.reasons.join(" | ")}`,
    `Expected tools: ${normalizeList(params.evalCase.expected_tools).join(", ") || "(none)"}`,
    `Forbidden tools: ${normalizeList(params.evalCase.tool_must_not_contain).join(", ") || "(none)"}`,
    "",
    "Final answer:",
    params.finalText || "(empty)",
    "",
    "Tool calls:",
    JSON.stringify(
      params.toolCalls.map((call) => ({
        name: call.name,
        args: call.args,
        outputText: call.outputText,
      })),
      null,
      2,
    ),
  ].join("\n");

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${params.apiKey}`,
    },
    body: JSON.stringify({
      model: params.model,
      messages: [
        {
          role: "system",
          content:
            "You are a careful eval judge. Return only valid JSON without markdown fences.",
        },
        {
          role: "user",
          content: prompt,
        },
      ],
      temperature: 0,
      response_format: {
        type: "json_object",
      },
    }),
  });

  const json = (await response.json()) as OpenRouterJudgeResponse;
  if (!response.ok) {
    throw new Error(
      `OpenRouter judge failed (${response.status}): ${json.error?.message ?? JSON.stringify(json)}`,
    );
  }

  const content = json.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter judge returned no message content");
  }

  const parsed = parseJsonObjectFromText(content) as Omit<JudgeResult, "model">;
  return {
    verdict: parsed.verdict,
    confidence: parsed.confidence,
    reasoning: parsed.reasoning,
    recommendedAction: parsed.recommendedAction,
    model: json.model ?? params.model,
  };
}

function gradeCase(evalCase: EvalCase, finalText: string, toolCalls: ToolCallTrace[]): GradeResult {
  const reasons: string[] = [];
  const expectedTools = normalizeList(evalCase.expected_tools);
  const expectedToolSequence = normalizeList(evalCase.expected_tool_sequence);
  const forbiddenTools = normalizeList(evalCase.tool_must_not_contain);
  const mustContain = normalizeList(evalCase.must_contain);
  const mustContainAny = normalizeList(evalCase.must_contain_any);
  const mustNotContain = normalizeList(evalCase.must_not_contain);
  const calledToolNames = toolCalls.map((call) => call.name);

  for (const tool of expectedTools) {
    if (!calledToolNames.includes(tool)) {
      reasons.push(`Missing expected tool call: ${tool}`);
    }
  }

  if (expectedToolSequence.length > 0) {
    let searchStart = 0;
    for (const tool of expectedToolSequence) {
      const foundAt = calledToolNames.indexOf(tool, searchStart);
      if (foundAt === -1) {
        reasons.push(
          `Expected tool sequence not satisfied: missing ${tool} after step ${searchStart}`,
        );
        break;
      }
      searchStart = foundAt + 1;
    }
  }

  for (const tool of forbiddenTools) {
    if (calledToolNames.includes(tool)) {
      reasons.push(`Forbidden tool was called: ${tool}`);
    }
  }

  for (const phrase of mustContain) {
    if (!includesNormalized(finalText, phrase)) {
      reasons.push(`Final answer missing required phrase: ${phrase}`);
    }
  }

  if (
    mustContainAny.length > 0 &&
    !mustContainAny.some((phrase) => includesNormalized(finalText, phrase))
  ) {
    reasons.push(
      `Final answer missing any acceptable phrase: ${mustContainAny.join(", ")}`,
    );
  }

  for (const phrase of mustNotContain) {
    if (includesNormalized(finalText, phrase)) {
      reasons.push(`Final answer contains forbidden phrase: ${phrase}`);
    }
  }

  if ((evalCase.min_final_chars ?? 0) > finalText.trim().length) {
    reasons.push(
      `Final answer shorter than required minimum of ${evalCase.min_final_chars} characters`,
    );
  }

  for (const [toolName, requiredPhrases] of Object.entries(
    evalCase.tool_result_must_contain ?? {},
  )) {
    const matchingCalls = toolCalls.filter((call) => call.name === toolName);
    if (matchingCalls.length === 0) {
      reasons.push(`No tool output available to grade for ${toolName}`);
      continue;
    }

    const combinedOutput = matchingCalls.map((call) => call.outputText).join("\n");
    for (const phrase of requiredPhrases) {
      if (!includesNormalized(combinedOutput, phrase)) {
        reasons.push(
          `Tool output for ${toolName} missing required phrase: ${phrase}`,
        );
      }
    }
  }

  return {
    passed: reasons.length === 0,
    reasons,
  };
}

class LiveMcpExecutor implements ToolExecutor {
  private client: Client;
  private transport: StreamableHTTPClientTransport;

  constructor(serverUrl: string, skyfiApiKey?: string) {
    const headers = skyfiApiKey
      ? { "x-skyfi-api-key": skyfiApiKey }
      : undefined;

    this.transport = new StreamableHTTPClientTransport(new URL(serverUrl), {
      requestInit: headers ? { headers } : undefined,
    });
    this.client = new Client({
      name: "skyfi-evals",
      version: "0.1.0",
    });
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async listTools(): Promise<ToolDescriptor[]> {
    const result = await this.client.listTools();
    return result.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({
      name,
      arguments: args,
    });
  }

  async close(): Promise<void> {
    await this.transport.close();
  }
}

class FixtureExecutor implements ToolExecutor {
  private fixtureFile: FixtureFile;
  private liveToolSource: LiveMcpExecutor;
  private callCounts = new Map<string, number>();

  constructor(fixtureFile: FixtureFile, liveToolSource: LiveMcpExecutor) {
    this.fixtureFile = fixtureFile;
    this.liveToolSource = liveToolSource;
  }

  async listTools(): Promise<ToolDescriptor[]> {
    return this.liveToolSource.listTools();
  }

  async callTool(name: string): Promise<unknown> {
    const raw = this.fixtureFile.tool_results[name];
    if (raw === undefined) {
      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                error: `No fixture result configured for tool '${name}'`,
                availableFixtureTools: Object.keys(this.fixtureFile.tool_results),
              },
              null,
              2,
            ),
          },
        ],
        isError: true,
      };
    }

    if (!Array.isArray(raw)) {
      return raw;
    }

    const index = this.callCounts.get(name) ?? 0;
    const next = raw[index];
    if (next === undefined) {
      throw new Error(
        `Fixture for tool '${name}' ran out of responses at index ${index}`,
      );
    }
    this.callCounts.set(name, index + 1);
    return next;
  }

  async close(): Promise<void> {
    await this.liveToolSource.close();
  }
}

async function loadFixture(rootDir: string, fixtureSet: string, caseId: string): Promise<FixtureFile> {
  const path = join(rootDir, "evals", "fixtures", fixtureSet, `${caseId}.yaml`);
  return loadYamlFile<FixtureFile>(path);
}

function buildFunctionTools(allTools: ToolDescriptor[], evalCase: EvalCase): unknown[] {
  const allowed = new Set(evalCase.allowed_tools ?? allTools.map((tool) => tool.name));
  return allTools
    .filter((tool) => allowed.has(tool.name))
    .map((tool) => ({
      type: "function",
      name: tool.name,
      description: tool.description ?? "",
      parameters: tool.inputSchema,
      strict: false,
    }));
}

function resolveActionUrl(serverUrl: string, actionUrl: string): string {
  if (/^https?:\/\//i.test(actionUrl)) {
    return actionUrl;
  }

  const base = new URL(serverUrl);
  return new URL(actionUrl, `${base.origin}/`).toString();
}

async function runHttpActions(
  serverUrl: string,
  actions: EvalHttpAction[] | undefined,
): Promise<void> {
  for (const action of actions ?? []) {
    const resolvedUrl = resolveActionUrl(serverUrl, action.url);
    const hasJsonBody = action.body !== undefined;
    const response = await fetch(resolvedUrl, {
      method: action.method,
      headers: {
        ...(hasJsonBody ? { "Content-Type": "application/json" } : {}),
        ...(action.headers ?? {}),
      },
      body: hasJsonBody ? JSON.stringify(action.body) : undefined,
    });

    const expectedStatus = action.expect_status ?? 200;
    if (response.status !== expectedStatus) {
      const body = await response.text();
      throw new Error(
        `HTTP action ${action.method} ${resolvedUrl} returned ${response.status}, expected ${expectedStatus}: ${body}`,
      );
    }
  }
}

async function runCase(params: {
  evalCase: EvalCase;
  model: string;
  executor: ToolExecutor;
  openAiApiKey: string;
  openRouterApiKey?: string;
  judgeModel?: string;
  serverUrl: string;
}): Promise<CaseArtifact> {
  const startedAt = Date.now();
  await runHttpActions(params.serverUrl, params.evalCase.http_actions_before);
  const allTools = await params.executor.listTools();
  const tools = buildFunctionTools(allTools, params.evalCase);
  const toolCalls: ToolCallTrace[] = [];
  const responseIds: string[] = [];
  let finalText = "";
  const runAssistantTurn = async (
    input: unknown,
    previousResponseId?: string,
  ): Promise<OpenAIResponse> => {
    let response = await createOpenAIResponse({
      apiKey: params.openAiApiKey,
      model: params.model,
      input,
      tools,
      previousResponseId,
    });
    responseIds.push(response.id);

    for (let step = 0; step < (params.evalCase.max_steps ?? 8); step++) {
      const functionCalls = extractFunctionCalls(response);
      if (functionCalls.length === 0) {
        finalText = extractFinalText(response);
        return response;
      }

      const toolOutputs = [];
      for (const call of functionCalls) {
        let parsedArgs: Record<string, unknown>;
        try {
          parsedArgs = parseJsonObject(
            call.arguments,
            `Tool arguments for ${call.name}`,
          );
        } catch {
          parsedArgs = {};
        }

        const rawResult = await params.executor.callTool(
          call.name,
          parsedArgs,
          params.evalCase,
        );
        const outputText = stringifyToolResult(rawResult);
        toolCalls.push({
          name: call.name,
          args: parsedArgs,
          outputText,
          rawResult,
        });

        toolOutputs.push({
          type: "function_call_output",
          call_id: call.callId,
          output: outputText,
        });
      }

      response = await createOpenAIResponse({
        apiKey: params.openAiApiKey,
        model: params.model,
        previousResponseId: response.id,
        input: toolOutputs,
        tools,
      });
      responseIds.push(response.id);
    }

    finalText = extractFinalText(response);
    return response;
  };

  let response = await runAssistantTurn(buildInitialPrompt(params.evalCase));
  for (const followUp of params.evalCase.follow_up_messages ?? []) {
    response = await runAssistantTurn(followUp, response.id);
  }

  try {
    const grade = gradeCase(params.evalCase, finalText, toolCalls);
    let judge: JudgeResult | undefined;
    if (!grade.passed && params.openRouterApiKey) {
      judge = await runJudge({
        apiKey: params.openRouterApiKey,
        model: params.judgeModel ?? "anthropic/claude-sonnet-4.5",
        evalCase: params.evalCase,
        grade,
        finalText,
        toolCalls,
      });
    }

    return {
      caseId: params.evalCase.id,
      mode: "live",
      passed: grade.passed,
      grade,
      judge,
      finalText,
      toolCalls,
      responseIds,
      elapsedMs: Date.now() - startedAt,
    };
  } finally {
    await runHttpActions(params.serverUrl, params.evalCase.http_actions_after);
  }
}

export async function runEvalSuite(options: HarnessOptions): Promise<SuiteArtifact> {
  const loaded = await loadSuite(options.rootDir, options.suiteName);
  const model = await resolveModelName(options.rootDir, options.modelName);
  const resultsRoot = options.resultsRoot ?? join(options.rootDir, "evals", "results");
  const resultsDir = join(resultsRoot, createResultsDirName());
  await mkdir(resultsDir, { recursive: true });

  const filteredCases = options.caseFilter?.length
    ? loaded.cases.filter((evalCase) => options.caseFilter?.includes(evalCase.id))
    : loaded.cases;

  if (filteredCases.length === 0) {
    throw new Error("No eval cases matched the requested suite/filter");
  }

  const liveToolSource = new LiveMcpExecutor(options.serverUrl, options.skyfiApiKey);
  await liveToolSource.connect();

  try {
    const cases: CaseArtifact[] = [];
    for (const evalCase of filteredCases) {
      const executor =
        loaded.definition.mode === "fixture"
          ? new FixtureExecutor(
              await loadFixture(
                options.rootDir,
                loaded.definition.fixture_set ?? "",
                evalCase.id,
              ),
              liveToolSource,
            )
          : liveToolSource;

      const artifact = await runCase({
        evalCase,
        model,
        executor,
        openAiApiKey: options.openAiApiKey,
        openRouterApiKey: options.openRouterApiKey,
        judgeModel: options.judgeModel,
        serverUrl: options.serverUrl,
      });
      artifact.mode = loaded.definition.mode;
      cases.push(artifact);

      const casePath = join(resultsDir, `${evalCase.id}.json`);
      await writeFile(casePath, JSON.stringify(artifact, null, 2));
    }

    const summary: SuiteArtifact = {
      suite: options.suiteName,
      mode: loaded.definition.mode,
      model,
      caseCount: cases.length,
      passed: cases.filter((item) => item.passed).length,
      failed: cases.filter((item) => !item.passed).length,
      resultsDir,
      cases,
    };

    await writeFile(join(resultsDir, "summary.json"), JSON.stringify(summary, null, 2));
    return summary;
  } finally {
    await liveToolSource.close();
  }
}

export async function listEvalSuites(rootDir: string): Promise<string[]> {
  const suitesPath = join(rootDir, "evals", "suites.yaml");
  const suites = await loadYamlFile<EvalSuitesFile>(suitesPath);
  return Object.keys(suites.suites);
}

export async function listScenarioIds(rootDir: string): Promise<string[]> {
  const dir = join(rootDir, "evals", "scenarios");
  const files = await readdir(dir);
  return files
    .filter((file) => file.endsWith(".yaml"))
    .map((file) => basename(file, ".yaml"))
    .sort();
}

export function resolveRootDir(cwd: string): string {
  return resolve(cwd);
}

export { gradeCase };
