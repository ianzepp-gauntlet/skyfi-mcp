import {
  listEvalSuites,
  listScenarioIds,
  resolveRootDir,
  runEvalSuite,
} from "../src/evals/harness.js";

interface CliArgs {
  suite: string;
  model: string;
  judgeModel: string;
  serverUrl: string;
  resultsDir?: string;
  cases?: string[];
  help: boolean;
  list: boolean;
}

function parseArgs(argv: string[]): CliArgs {
  const parsed: CliArgs = {
    suite: "planner-smoke",
    model: "gpt-4o",
    judgeModel:
      process.env.OPENROUTER_JUDGE_MODEL ?? "anthropic/claude-sonnet-4.5",
    serverUrl: process.env.SKYFI_MCP_URL ?? "http://localhost:8787/mcp",
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
      parsed.suite = argv[++i] ?? parsed.suite;
      continue;
    }
    if (arg === "--model") {
      parsed.model = argv[++i] ?? parsed.model;
      continue;
    }
    if (arg === "--server-url") {
      parsed.serverUrl = argv[++i] ?? parsed.serverUrl;
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
    if (arg === "--cases") {
      parsed.cases = (argv[++i] ?? "")
        .split(",")
        .map((part) => part.trim())
        .filter((part) => part.length > 0);
    }
  }

  return parsed;
}

function printHelp(): void {
  console.log(`SkyFi eval harness

Usage:
  bun run scripts/run-evals.ts --suite planner-smoke

Options:
  --suite <name>        Eval suite name (default: planner-smoke)
  --model <name>        OpenAI model name or alias from evals/models.yaml
  --judge-model <name>  OpenRouter model for secondary failure review
  --server-url <url>    MCP server URL (default: SKYFI_MCP_URL or http://localhost:8787/mcp)
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
  SKYFI_MCP_URL         Default server URL`);
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

  const openAiApiKey = process.env.OPENAI_API_KEY;
  if (!openAiApiKey) {
    throw new Error("OPENAI_API_KEY is required to run the eval harness");
  }

  const summary = await runEvalSuite({
    rootDir,
    suiteName: args.suite,
    modelName: args.model,
    serverUrl: args.serverUrl,
    openAiApiKey,
    openRouterApiKey: process.env.OPENROUTER_API_KEY,
    judgeModel: args.judgeModel,
    skyfiApiKey: process.env.SKYFI_API_KEY,
    resultsRoot: args.resultsDir,
    caseFilter: args.cases,
  });

  console.log(
    `Suite ${summary.suite} finished: ${summary.passed}/${summary.caseCount} passed`,
  );
  console.log(`Mode: ${summary.mode}`);
  console.log(`Model: ${summary.model}`);
  console.log(`Blocked: ${summary.blocked}`);
  console.log(`Results: ${summary.resultsDir}`);

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

await main();
