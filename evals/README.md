# SkyFi Eval Framework

This directory contains the eval harness for the SkyFi MCP server. It is not a unit-test layer and it is not a static prompt snapshot test. The harness runs a real LLM planning loop against the MCP tool surface and records what the model did, what tools it called, what those tools returned, how the deterministic grader scored the result, and whether a secondary judge was involved.

The point of this framework is to answer a practical question:

Can an LLM use this MCP server safely and effectively for the workflows the project actually cares about?

## What This Framework Is

At a high level, the eval system is made of:

- `evals/scenarios/`: YAML case definitions
- `evals/suites.yaml`: named suites that group cases
- `evals/fixtures/`: deterministic fixture outputs for non-live suites
- `evals/models.yaml`: model aliases for the planner loop
- `scripts/run-evals.ts`: the CLI entrypoint
- `src/evals/harness.ts`: the runner, grader, and artifact writer
- `evals/results/`: output artifacts from prior runs

The harness tests the real orchestration path:

1. a user prompt is given to the model
2. the model chooses MCP tools
3. tool calls are executed either live or through fixtures
4. the model receives tool outputs and continues the conversation
5. the final answer is graded
6. failed deterministic cases may optionally receive a secondary judge review

## What It Tests

The current corpus is built around the behaviors that matter most for SkyFi MCP:

- place resolution through `location_resolve`
- archive search and archive detail lookup
- pricing exploration
- account readiness and budget inspection
- tasking feasibility checks
- pass prediction
- safe order preparation without accidental confirmation
- explicit human confirmation gates
- AOI notification creation, review, alert retrieval, and deletion
- negative cases where the assistant should refuse to guess or should ask for clarification

The framework is intentionally biased toward production-stable signals:

- expected tools were used
- forbidden tools were not used
- key fields appeared in tool outputs
- the final answer was non-empty and operationally useful

It is intentionally not strict about exact phrasing in the assistant’s prose.

## What It Tests Against

The harness supports two execution modes.

### Fixture Mode

Fixture mode keeps the LLM loop real, but replaces tool outputs with deterministic fixture data.

Use this when you want to verify:

- tool selection
- multi-step planning
- confirmation-gate behavior
- negative/underspecified request handling

without depending on live SkyFi API state.

### Live Mode

Live mode talks to the real MCP server and, through it, the real SkyFi-backed integrations.

Use this when you want to verify:

- the remote/local MCP transport still works
- the current tool contract still matches upstream behavior
- live search, feasibility, pass prediction, pricing, AOI, and ordering-prep flows still produce useful results

The runner now auto-starts a local Cloudflare/Wrangler MCP server by default for live suites, picks a random port in the `23000-25000` range, waits for `/health`, runs the suite, and then tears the server down.

If you explicitly provide `--server-url` or set `SKYFI_MCP_URL`, the harness uses that server instead and does not start a managed local one.

## Grading Model

The harness uses two grading layers.

### 1. Deterministic Grading

The deterministic grader checks:

- `expected_tools`
- `expected_tool_sequence`
- `tool_must_not_contain`
- `must_contain`
- `must_contain_any`
- `must_not_contain`
- `tool_result_must_contain`
- `min_final_chars`

This gives a crisp pass/fail signal for behavior that should not be subjective.

### 2. Secondary Judge

If `OPENROUTER_API_KEY` is set, failed deterministic cases can be reviewed by a secondary judge model.

The judge classifies failures as:

- `real_failure`
- `rubric_too_strict`
- `ambiguous`

This is useful when the deterministic rubric fails because of:

- tool/API instability
- response-shape drift
- rubric assumptions that are too brittle

### Passed, Failed, and Blocked

The harness now distinguishes:

- `passed`: deterministic grading passed
- `failed`: a real behavior failure remained after classification
- `blocked`: the run was blocked by tool/API/rubric ambiguity rather than clearly failing as an assistant behavior regression

## Verbose and Debug Output

The runner supports three output levels.

### Default Output

Default output is compact. It prints suite summaries and a final markdown table.

### `--verbose`

Verbose mode renders the run as a markdown-style transcript:

- suite headers
- case headers
- user prompts
- assistant planning steps
- tool calls and tool results
- grader and judge sections

Tool arguments and tool results are rendered as fenced YAML when possible for readability.

### `--debug`

Debug mode keeps the raw lower-level diagnostic output:

- more direct event logs
- larger request/response snippets
- OpenAI input payloads
- judge prompts and judge reasoning details

Use `--verbose` when you want to watch the eval like a conversation. Use `--debug` when you want lower-level runner diagnostics.

## Dry Run Mode

`--dry-run` lets you inspect the eval corpus without executing anything.

A dry run:

- loads suites and scenarios
- prints the user prompts
- prints allowed/expected/forbidden tool declarations
- prints follow-up turns when present
- prints a final markdown summary table

A dry run does **not**:

- start the MCP server
- call MCP tools
- call OpenAI
- call the judge

This is useful when:

- reviewing the corpus
- checking which prompts will be sent
- validating suite composition
- confirming that a filter or multi-suite invocation is selecting the intended cases

## Directory Layout

```text
evals/
├── README.md
├── fixtures/
├── models.yaml
├── results/
├── scenarios/
└── suites.yaml
```

### `fixtures/`

Fixture-backed tool outputs used by fixture suites. These let the planner loop stay real while making tool outputs deterministic.

### `models.yaml`

Model aliases used by the eval runner.

### `results/`

Artifacts from prior runs. Each run gets its own timestamped directory.

### `scenarios/`

Portable YAML case definitions. These are the actual eval cases.

### `suites.yaml`

Named suites that group cases by purpose.

## Current Suite Catalog

The suite inventory below reflects `evals/suites.yaml`.

### Fixture Suites

- `planner-smoke`
  Validates core planning and confirmation-gate behavior.
- `planner-human-loop-smoke`
  Focuses on explicit human approval before order confirmation.
- `planner-multistep-smoke`
  Covers search, clarification, and tasking-oriented multi-step planning.
- `planner-aoi-smoke`
  Covers AOI monitoring workflows and underspecified AOI requests.

### Live Suites

- `live-smoke`
  Small read-only live sanity checks.
- `live-integration-smoke`
  Minimal live MCP integration checks.
- `live-feasibility-smoke`
  Feasibility-only live check.
- `live-opportunity-smoke`
  Pass-prediction live check.
- `live-orders-smoke`
  Read-only order inspection checks.
- `live-monitoring-smoke`
  Read-only AOI monitoring review checks.
- `live-aoi-smoke`
  Live AOI lifecycle and webhook visibility checks.
- `live-budget-smoke`
  Pricing and budget-filtered discovery checks.
- `live-ordering-smoke`
  Safe ordering-prep checks without confirmation.
- `live-human-loop`
  Opt-in live prepare-and-confirm confirmation-gate checks using zero-cost open-data archive orders, including a fast expiry case when `SKYFI_CONFIRMATION_TTL_MS` is set to a low value for evals.
- `live-multistep-smoke`
  Safe multi-step live flows that chain multiple tools.
- `live-tasking-smoke`
  Safe tasking workflows that check feasibility and prepare but do not confirm.

To see the current authoritative list from the CLI:

```bash
bun run evals --list
```

## Environment and Requirements

### Required for Real Runs

- `OPENAI_API_KEY`

### Optional

- `SKYFI_API_KEY`
  Forwarded to the MCP server as `x-skyfi-api-key`
- `OPENROUTER_API_KEY`
  Enables secondary judging on deterministic failures
- `OPENROUTER_JUDGE_MODEL`
  Overrides the default judge model
- `SKYFI_MCP_URL`
  Uses an explicit external MCP server instead of the managed local server

### Not Required for Dry Run

Dry runs do not require any API keys.

## How To Run Evals

### List suites and scenarios

```bash
bun run evals --list
```

### Run one suite

```bash
export OPENAI_API_KEY=...
bun run evals --suite planner-smoke
```

### Run multiple suites in one invocation

```bash
export OPENAI_API_KEY=...
bun run evals --suite live-feasibility-smoke,live-opportunity-smoke
```

You can also repeat the flag:

```bash
export OPENAI_API_KEY=...
bun run evals --suite live-feasibility-smoke --suite live-tasking-smoke
```

### Run a subset of cases

```bash
export OPENAI_API_KEY=...
bun run evals --suite live-smoke --cases live-pricing-exploration,live-account-readiness
```

### Run with a live transcript

```bash
export OPENAI_API_KEY=...
export SKYFI_API_KEY=...
bun run evals --suite live-feasibility-smoke --verbose
```

### Run with lower-level debug output

```bash
export OPENAI_API_KEY=...
export SKYFI_API_KEY=...
bun run evals --suite live-feasibility-smoke --debug
```

### Run with secondary judging enabled

```bash
export OPENAI_API_KEY=...
export OPENROUTER_API_KEY=...
export OPENROUTER_JUDGE_MODEL=anthropic/claude-sonnet-4.5
bun run evals --suite planner-smoke
```

### Run against an explicit MCP server

```bash
export OPENAI_API_KEY=...
export SKYFI_API_KEY=...
bun run evals --suite live-opportunity-smoke --server-url http://127.0.0.1:8787/mcp
```

Or with environment:

```bash
export OPENAI_API_KEY=...
export SKYFI_API_KEY=...
export SKYFI_MCP_URL=http://127.0.0.1:8787/mcp
bun run evals --suite live-opportunity-smoke
```

### Dry run a suite

```bash
bun run evals --suite planner-smoke --dry-run
```

### Dry run multiple suites

```bash
bun run evals --suite planner-smoke,live-feasibility-smoke --dry-run
```

## How the Managed Local Server Works

For normal runs without `--server-url` and without `SKYFI_MCP_URL`, the runner:

1. picks a random port in `23000-25000`
2. starts `wrangler dev`
3. waits for `/health`
4. runs the requested suite or suites
5. tears the server down in `finally`

This means live evals can be run locally without manually starting the MCP server first.

## Artifacts Written Per Run

Each run writes a timestamped directory under `evals/results/`.

Typical contents:

- one JSON file per case
- `summary.json`
- `trace.log`

### Per-case JSON artifact

Each case artifact captures:

- `caseId`
- execution mode
- passed/failed/blocked status
- deterministic grading reasons
- optional judge output
- final answer text
- tool call trace
- raw tool results
- response IDs
- elapsed time

### `summary.json`

The suite summary captures:

- suite name
- mode
- model
- case counts
- passed / failed / blocked totals
- results directory path
- embedded case results

### `trace.log`

This is the human-readable trace sidecar for later analysis.

It records:

- suite start and finish
- case start and finish
- prompts
- tool selection
- tool arguments
- tool outputs
- grading outcome
- judge activity

This is especially useful if you want to inspect a run after the fact instead of watching the console in real time.

## Reading Results

If you only need the high-level answer:

- read `summary.json`

If you want to see what the model actually did:

- read the per-case JSON
- read `trace.log`

If you want the live console experience:

- rerun with `--verbose`

If you want lower-level payload debugging:

- rerun with `--debug`

## Notes and Constraints

- Live suites depend on upstream SkyFi behavior and can surface real API drift.
- Fixture suites are more stable and are better for planner regressions.
- Dry runs are for inspection only and are not correctness signals.
- Multi-suite runs are aggregated into one final markdown table at the bottom of the output.
- Secondary judging is advisory classification layered on top of deterministic grading; it helps explain failures but does not replace the deterministic rubric.

## Recommended Workflows

### Fast corpus review

```bash
bun run evals --suite planner-smoke,live-feasibility-smoke --dry-run
```

### Planner regression check

```bash
export OPENAI_API_KEY=...
bun run evals --suite planner-smoke,planner-human-loop-smoke,planner-multistep-smoke
```

### Live transport and API sanity pass

```bash
export OPENAI_API_KEY=...
export SKYFI_API_KEY=...
bun run evals --suite live-integration-smoke,live-feasibility-smoke,live-opportunity-smoke --verbose
```

### Safe ordering and tasking review

```bash
export OPENAI_API_KEY=...
export SKYFI_API_KEY=...
bun run evals --suite live-ordering-smoke,live-tasking-smoke --verbose
```
