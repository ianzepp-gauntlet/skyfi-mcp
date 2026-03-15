import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  type EvalReporter,
  listEvalSuites,
  listScenarioIds,
  resolveRootDir,
  runEvalSuite,
} from "../src/evals/harness.js";
import YAML from "yaml";

interface CliArgs {
  suites: string[];
  model: string;
  judgeModel: string;
  serverUrl: string;
  serverUrlExplicit: boolean;
  logLevel?: "verbose" | "debug";
  dryRun: boolean;
  resultsDir?: string;
  cases?: string[];
  help: boolean;
  list: boolean;
}

interface ManagedServer {
  url: string;
  stop(): Promise<void>;
}

interface EvalCasePreview {
  id: string;
  description: string;
  query: string;
  allowed_tools?: string[];
  expected_tools?: string[];
  tool_must_not_contain?: string[];
  follow_up_messages?: string[];
}

interface EvalSuitePreview {
  name: string;
  description: string;
  stage: string;
  mode: "fixture" | "live";
  cases: EvalCasePreview[];
}

function parseArgs(argv: string[]): CliArgs {
  const envServerUrl = process.env.SKYFI_MCP_URL;
  const parsed: CliArgs = {
    suites: ["planner-smoke"],
    model: "gpt-4o",
    judgeModel:
      process.env.OPENROUTER_JUDGE_MODEL ?? "anthropic/claude-sonnet-4.5",
    serverUrl: envServerUrl ?? "",
    serverUrlExplicit: !!envServerUrl,
    dryRun: false,
    help: false,
    list: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;

    if (arg === "--help" || arg === "-h") {
      parsed.help = true;
      continue;
    }
    if (arg === "--list") {
      parsed.list = true;
      continue;
    }
    if (arg === "--suite") {
      const raw = argv[++i] ?? "";
      const suites = raw
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
      if (suites.length > 0) {
        parsed.suites =
          parsed.suites.length === 1 && parsed.suites[0] === "planner-smoke"
            ? suites
            : [...parsed.suites, ...suites];
      }
      continue;
    }
    if (arg === "--model") {
      parsed.model = argv[++i] ?? parsed.model;
      continue;
    }
    if (arg === "--server-url") {
      parsed.serverUrl = argv[++i] ?? parsed.serverUrl;
      parsed.serverUrlExplicit = true;
      continue;
    }
    if (arg === "--judge-model") {
      parsed.judgeModel = argv[++i] ?? parsed.judgeModel;
      continue;
    }
    if (arg === "--results-dir") {
      parsed.resultsDir = argv[++i] ?? parsed.resultsDir;
      continue;
    }
    if (arg === "--verbose") {
      parsed.logLevel = "verbose";
      continue;
    }
    if (arg === "--debug") {
      parsed.logLevel = "debug";
      continue;
    }
    if (arg === "--dry-run") {
      parsed.dryRun = true;
      continue;
    }
    if (arg === "--cases") {
      parsed.cases = (argv[++i] ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
  }

  return parsed;
}

function createConsoleReporter(level?: "verbose" | "debug"): EvalReporter | undefined {
  if (!level) return undefined;
  return {
    level,
    log(message: string) {
      if (level === "debug") {
        console.log(message);
        return;
      }
      console.log(formatVerboseMessage(message));
    },
  };
}

function toYamlFence(text: string): string {
  try {
    const parsed = JSON.parse(text);
    return `\`\`\`yaml\n${YAML.stringify(parsed).trimEnd()}\n\`\`\``;
  } catch {
    return `\`\`\`text\n${text.trimEnd()}\n\`\`\``;
  }
}

function formatVerboseMessage(message: string): string {
  const normalizedMessage = message.trimStart();
  const suiteStart = message.match(
    /^Suite (.+) starting mode=(.+) model=(.+) serverUrl=(.+)$/,
  );
  if (suiteStart) {
    return [
      "",
      `# Suite: ${suiteStart[1]}`,
      "",
      `- Mode: ${suiteStart[2]}`,
      `- Model: ${suiteStart[3]}`,
      `- Server: ${suiteStart[4]}`,
    ].join("\n");
  }

  const suiteFinish = message.match(
    /^Suite (.+) finished passed=(\d+) failed=(\d+) blocked=(\d+) caseCount=(\d+)$/,
  );
  if (suiteFinish) {
    return [
      "",
      `## Suite Result`,
      "",
      `- Passed: ${suiteFinish[2]}/${suiteFinish[5]}`,
      `- Failed: ${suiteFinish[3]}`,
      `- Blocked: ${suiteFinish[4]}`,
    ].join("\n");
  }

  const caseMessage = normalizedMessage.match(/^\[([^\]]+)\] (.+)$/s);
  if (!caseMessage) return message;

  const caseId = caseMessage[1]!;
  const body = caseMessage[2]!;

  const start = body.match(/^START (.+)$/);
  if (start) {
    return `\n## Case: ${caseId}\n\n${start[1]}`;
  }

  const query = body.match(/^Query: (.+)$/s);
  if (query) {
    return `### User\n\n${query[1]}`;
  }

  const allowedTools = body.match(/^Allowed tools: (.+)$/);
  if (allowedTools) {
    return [`### Tools`, "", `Available tools: ${allowedTools[1]}`].join("\n");
  }

  const openAiRequest = body.match(
    /^OpenAI request model=(.+) previousResponseId=(.+) tools=(.+)$/,
  );
  if (openAiRequest) {
    return [
      `### Assistant`,
      "",
      `Thinking.`,
      "",
      `- Model: ${openAiRequest[1]}`,
      `- Previous response: ${openAiRequest[2]}`,
      `- Tools in scope: ${openAiRequest[3]}`,
    ].join("\n");
  }

  const openAiResponse = body.match(
    /^OpenAI response id=(.+) functionCalls=(.+) finalTextChars=(.+)$/,
  );
  if (openAiResponse) {
    return [
      `### Assistant`,
      "",
      `Model response received.`,
      "",
      `- Response ID: ${openAiResponse[1]}`,
      `- Tool calls: ${openAiResponse[2]}`,
      `- Final text chars: ${openAiResponse[3]}`,
    ].join("\n");
  }

  const selectedTools = body.match(/^Step (\d+) selected tools: (.+)$/);
  if (selectedTools) {
    return [
      `### Assistant`,
      "",
      `Step ${selectedTools[1]} selected these tools: ${selectedTools[2]}.`,
    ].join("\n");
  }

  const toolArgs = body.match(/^Tool ([^ ]+) args=(.+)$/s);
  if (toolArgs) {
    return [
      `### Tool Call: ${toolArgs[1]}`,
      "",
      `Arguments`,
      "",
      toYamlFence(toolArgs[2]!),
    ].join("\n");
  }

  const toolOutput = body.match(/^Tool ([^ ]+) output:\n([\s\S]+)$/);
  if (toolOutput) {
    return [
      `### Tool Result: ${toolOutput[1]}`,
      "",
      `Output`,
      "",
      toYamlFence(toolOutput[2]!),
    ].join("\n");
  }

  const finalAnswer = body.match(/^Final answer(?: after max steps)? \((\d+) chars\): ([\s\S]+)$/);
  if (finalAnswer) {
    return [
      `### Assistant`,
      "",
      finalAnswer[2]!,
      "",
      `- Characters: ${finalAnswer[1]}`,
    ].join("\n");
  }

  const grade = body.match(/^Grade status=(.+) reasons=(.+)$/s);
  if (grade) {
    return [
      `### Grader`,
      "",
      `- Status: ${grade[1]}`,
      `- Reasons: ${grade[2]}`,
    ].join("\n");
  }

  const judgeRun = body.match(/^Running secondary judge model=(.+)$/);
  if (judgeRun) {
    return [`### Judge`, "", `Reviewing with ${judgeRun[1]}.`].join("\n");
  }

  const judgeVerdict = body.match(/^Judge verdict=(.+) confidence=(.+) model=(.+)$/);
  if (judgeVerdict) {
    return [
      `### Judge`,
      "",
      `- Verdict: ${judgeVerdict[1]}`,
      `- Confidence: ${judgeVerdict[2]}`,
      `- Model: ${judgeVerdict[3]}`,
    ].join("\n");
  }

  const judgeReasoning = body.match(/^Judge reasoning: ([\s\S]+)$/);
  if (judgeReasoning) {
    return [`### Judge`, "", judgeReasoning[1]!].join("\n");
  }

  const httpAction = body.match(/^HTTP action ([A-Z]+) (.+)$/);
  if (httpAction) {
    return [`### System`, "", `HTTP setup: ${httpAction[1]} ${httpAction[2]}`].join("\n");
  }

  const httpActionBody = body.match(/^HTTP action body:\n([\s\S]+)$/);
  if (httpActionBody) {
    return [`### System`, "", `HTTP setup body`, "", toYamlFence(httpActionBody[1]!)].join("\n");
  }

  const httpActionResponse = body.match(/^HTTP action response status=(.+) expected=(.+)$/);
  if (httpActionResponse) {
    return [
      `### System`,
      "",
      `HTTP setup response.`,
      "",
      `- Status: ${httpActionResponse[1]}`,
      `- Expected: ${httpActionResponse[2]}`,
    ].join("\n");
  }

  const end = body.match(/^END elapsedMs=(.+)$/);
  if (end) {
    return [`### System`, "", `Case finished in ${end[1]}ms.`].join("\n");
  }

  return `${caseId}: ${body}`;
}

function renderResultsTable(
  cases: Array<{
    suite: string;
    caseId: string;
    status: "passed" | "failed" | "blocked";
    elapsedMs: number;
    judge?: { verdict: string } | undefined;
  }>,
): string {
  const lines = [
    "## Case Summary",
    "",
    "| Suite | Case | Status | Time (ms) | Secondary Judge |",
    "| --- | --- | --- | ---: | --- |",
  ];

  for (const result of cases) {
    lines.push(
      `| ${result.suite} | ${result.caseId} | ${result.status} | ${result.elapsedMs} | ${result.judge ? `yes (${result.judge.verdict})` : "no"} |`,
    );
  }

  return lines.join("\n");
}

async function loadYamlFile<T>(path: string): Promise<T> {
  const raw = await readFile(path, "utf8");
  return YAML.parse(raw) as T;
}

async function loadSuitePreview(
  rootDir: string,
  suiteName: string,
  caseFilter?: string[],
): Promise<EvalSuitePreview> {
  const suitesPath = join(rootDir, "evals", "suites.yaml");
  const suites = await loadYamlFile<{
    suites: Record<
      string,
      { description: string; stage: string; mode: "fixture" | "live"; cases: string[] }
    >;
  }>(suitesPath);
  const suite = suites.suites[suiteName];
  if (!suite) {
    throw new Error(`Unknown eval suite: ${suiteName}`);
  }

  const selectedCaseIds = caseFilter?.length
    ? suite.cases.filter((caseId) => caseFilter.includes(caseId))
    : suite.cases;

  const cases: EvalCasePreview[] = [];
  for (const caseId of selectedCaseIds) {
    const scenarioPath = join(rootDir, "evals", "scenarios", `${caseId}.yaml`);
    const scenario = await loadYamlFile<EvalCasePreview>(scenarioPath);
    cases.push(scenario);
  }

  return {
    name: suiteName,
    description: suite.description,
    stage: suite.stage,
    mode: suite.mode,
    cases,
  };
}

function renderDryRunSuite(preview: EvalSuitePreview): string {
  const lines = [
    `# Suite: ${preview.name}`,
    "",
    preview.description,
    "",
    `- Stage: ${preview.stage}`,
    `- Mode: ${preview.mode}`,
  ];

  for (const evalCase of preview.cases) {
    lines.push(
      "",
      `## Case: ${evalCase.id}`,
      "",
      evalCase.description,
      "",
      "### User",
      "",
      evalCase.query,
    );

    if ((evalCase.allowed_tools ?? []).length > 0) {
      lines.push(
        "",
        "### Tools",
        "",
        "Allowed tools",
        "",
        `\`\`\`yaml\n${YAML.stringify(evalCase.allowed_tools).trimEnd()}\n\`\`\``,
      );
    }

    if ((evalCase.expected_tools ?? []).length > 0) {
      lines.push(
        "",
        "Expected tools",
        "",
        `\`\`\`yaml\n${YAML.stringify(evalCase.expected_tools).trimEnd()}\n\`\`\``,
      );
    }

    if ((evalCase.tool_must_not_contain ?? []).length > 0) {
      lines.push(
        "",
        "Forbidden tools",
        "",
        `\`\`\`yaml\n${YAML.stringify(evalCase.tool_must_not_contain).trimEnd()}\n\`\`\``,
      );
    }

    if ((evalCase.follow_up_messages ?? []).length > 0) {
      lines.push(
        "",
        "### Follow-Ups",
        "",
        `\`\`\`yaml\n${YAML.stringify(evalCase.follow_up_messages).trimEnd()}\n\`\`\``,
      );
    }

    lines.push(
      "",
      "### Dry Run",
      "",
      "No MCP server, tool calls, or LLM requests were executed for this case.",
    );
  }

  return lines.join("\n");
}

function renderDryRunSummary(
  previews: EvalSuitePreview[],
): string {
  const rows = previews.flatMap((preview) =>
    preview.cases.map((evalCase) => ({
      suite: preview.name,
      caseId: evalCase.id,
      mode: preview.mode,
      tools: (evalCase.allowed_tools ?? []).length,
    })),
  );

  const lines = [
    "## Dry Run Summary",
    "",
    `- Suites: ${previews.length}`,
    `- Cases: ${rows.length}`,
    `- Executed calls: 0`,
    "",
    "| Suite | Case | Mode | Allowed Tools | Executed |",
    "| --- | --- | --- | ---: | --- |",
  ];

  for (const row of rows) {
    lines.push(`| ${row.suite} | ${row.caseId} | ${row.mode} | ${row.tools} | no |`);
  }

  return lines.join("\n");
}

function randomPort(min = 23000, max = 25000): number {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function readStreamToBuffer(
  stream: ReadableStream<Uint8Array> | null,
  buffer: string[],
): Promise<void> {
  if (!stream) return;
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let pending = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      pending += decoder.decode(value, { stream: true });
      const lines = pending.split(/\r?\n/);
      pending = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        buffer.push(line);
        if (buffer.length > 40) buffer.shift();
      }
    }
    pending += decoder.decode();
    if (pending.trim()) {
      buffer.push(pending);
      if (buffer.length > 40) buffer.shift();
    }
  } finally {
    reader.releaseLock();
  }
}

async function waitForHealth(url: string, timeoutMs = 30000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // Keep polling until timeout.
    }
    await sleep(300);
  }

  throw new Error(`Timed out waiting for eval server health at ${url}`);
}

async function startManagedServer(rootDir: string): Promise<ManagedServer> {
  const port = randomPort();
  const inspectorPort = port + 1;
  const stdoutBuffer: string[] = [];
  const stderrBuffer: string[] = [];
  const proc = Bun.spawn({
    cmd: [
      "bun",
      "x",
      "wrangler",
      "dev",
      "--port",
      String(port),
      "--inspector-port",
      String(inspectorPort),
      "--show-interactive-dev-session=false",
      "--log-level",
      "warn",
    ],
    cwd: rootDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stdoutTask = readStreamToBuffer(proc.stdout, stdoutBuffer);
  const stderrTask = readStreamToBuffer(proc.stderr, stderrBuffer);
  const healthUrl = `http://127.0.0.1:${port}/health`;
  const serverUrl = `http://127.0.0.1:${port}/mcp`;

  try {
    await waitForHealth(healthUrl);
  } catch (error) {
    proc.kill();
    await Promise.allSettled([proc.exited, stdoutTask, stderrTask]);
    const logs = [...stdoutBuffer, ...stderrBuffer].join("\n");
    throw new Error(
      `Failed to start eval server on port ${port}: ${
        error instanceof Error ? error.message : String(error)
      }${logs ? `\nRecent server logs:\n${logs}` : ""}`,
    );
  }

  return {
    url: serverUrl,
    async stop() {
      proc.kill();
      await Promise.allSettled([proc.exited, stdoutTask, stderrTask]);
    },
  };
}

function printHelp(): void {
  console.log(`SkyFi eval harness

Usage:
  bun run scripts/run-evals.ts --suite planner-smoke
  bun run scripts/run-evals.ts --suite live-feasibility-smoke,live-opportunity-smoke
  bun run scripts/run-evals.ts --suite planner-smoke --dry-run

Options:
  --suite <name>        Eval suite name. Repeat or comma-separate to run multiple suites
  --model <name>        OpenAI model name or alias from evals/models.yaml
  --judge-model <name>  OpenRouter model for secondary failure review
  --server-url <url>    MCP server URL (disables managed local server startup)
  --verbose             Show case lifecycle, tool calls, grading, and judge activity
  --debug               Verbose output plus larger request/response payload snippets
  --dry-run             Show suites and prompts without executing MCP, tool, or LLM calls
  --results-dir <dir>   Override results output directory
  --cases a,b,c         Run only a subset of case IDs
  --list                List available suites and scenario IDs
  --help                Show this message

Required env:
  OPENAI_API_KEY        Used for the LLM planning loop

Optional env:
  OPENROUTER_API_KEY    Used for secondary review of failed cases
  OPENROUTER_JUDGE_MODEL
  SKYFI_API_KEY         Forwarded to the MCP server as x-skyfi-api-key when present
  SKYFI_MCP_URL         MCP server URL (disables managed local server startup)`);
}

async function main(): Promise<void> {
  const args = parseArgs(Bun.argv.slice(2));
  const rootDir = resolveRootDir(process.cwd());

  if (args.help) {
    printHelp();
    return;
  }

  if (args.list) {
    const [suites, scenarios] = await Promise.all([
      listEvalSuites(rootDir),
      listScenarioIds(rootDir),
    ]);
    console.log("Suites:");
    for (const suite of suites) console.log(`- ${suite}`);
    console.log("\nScenarios:");
    for (const scenario of scenarios) console.log(`- ${scenario}`);
    return;
  }

  if (args.dryRun) {
    const previews = [];
    for (const suiteName of args.suites) {
      const preview = await loadSuitePreview(rootDir, suiteName, args.cases);
      previews.push(preview);
      console.log(renderDryRunSuite(preview));
      console.log("");
    }
    console.log(renderDryRunSummary(previews));
    return;
  }

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required to run the eval harness");
  }
  const reporter = createConsoleReporter(args.logLevel);

  const managedServer = args.serverUrlExplicit
    ? undefined
    : await startManagedServer(rootDir);

  try {
    const summaries = [];
    for (const suiteName of args.suites) {
      const summary = await runEvalSuite({
        rootDir,
        suiteName,
        modelName: args.model,
        serverUrl: managedServer?.url ?? args.serverUrl,
        openAiApiKey,
        openRouterApiKey: process.env.OPENROUTER_API_KEY,
        judgeModel: args.judgeModel,
        skyfiApiKey: process.env.SKYFI_API_KEY,
        resultsRoot: args.resultsDir,
        caseFilter: args.cases,
        reporter,
      });
      summaries.push(summary);

      console.log(
        `Suite ${summary.suite} finished: ${summary.passed}/${summary.caseCount} passed`,
      );
      console.log(`Mode: ${summary.mode}`);
      console.log(`Model: ${summary.model}`);
      console.log(`Blocked: ${summary.blocked}`);
      console.log(`Results: ${summary.resultsDir}`);
      if (managedServer) {
        console.log(`Managed server: ${managedServer.url}`);
      }

      if (!args.logLevel) {
        for (const result of summary.cases) {
          const status =
            result.status === "passed"
              ? "PASS"
              : result.status === "blocked"
                ? "BLOCKED"
                : "FAIL";
          console.log(`- [${status}] ${result.caseId} (${result.elapsedMs}ms)`);
          if (result.status !== "passed") {
            for (const reason of result.grade.reasons) {
              console.log(`    ${reason}`);
            }
            if (result.judge) {
              console.log(
                `    judge: ${result.judge.verdict} (${result.judge.confidence}) via ${result.judge.model}`,
              );
            }
          }
        }
      }
    }

    const allCases = summaries.flatMap((summary) =>
      summary.cases.map((result) => ({
        suite: summary.suite,
        caseId: result.caseId,
        status: result.status,
        elapsedMs: result.elapsedMs,
        judge: result.judge,
      })),
    );
    const totalPassed = summaries.reduce((sum, summary) => sum + summary.passed, 0);
    const totalFailed = summaries.reduce((sum, summary) => sum + summary.failed, 0);
    const totalBlocked = summaries.reduce((sum, summary) => sum + summary.blocked, 0);
    const totalCases = summaries.reduce((sum, summary) => sum + summary.caseCount, 0);

    console.log("");
    console.log("## Overall Result");
    console.log("");
    console.log(`- Suites: ${summaries.length}`);
    console.log(`- Passed: ${totalPassed}/${totalCases}`);
    console.log(`- Failed: ${totalFailed}`);
    console.log(`- Blocked: ${totalBlocked}`);
    console.log("");
    console.log(renderResultsTable(allCases));
  } finally {
    await managedServer?.stop();
  }
}

await main();
