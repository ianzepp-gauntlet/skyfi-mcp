# SkyFi Eval Harness

This directory contains a first-pass eval harness for the SkyFi MCP server. The harness exercises a real LLM tool loop and grades both:

- whether the model chooses the expected SkyFi tools
- whether the final answer and tool outputs are useful enough to pass simple regression checks

The harness is intentionally biased toward production-stable signals:

- expected tools used
- forbidden tools avoided
- useful fields present in tool outputs
- non-empty final responses

It is intentionally not strict about exact assistant wording, since production users may connect many different LLMs to the same MCP server.

## Layout

```text
evals/
├── fixtures/
├── models.yaml
├── results/
├── scenarios/
└── suites.yaml
```

- `scenarios/`: portable YAML case definitions
- `fixtures/`: deterministic tool outputs for fixture-backed planning tests
- `suites.yaml`: named eval suites
- `models.yaml`: model aliases
- `results/`: run artifacts written by the harness

## Modes

### `planner-smoke`

Fixture-backed smoke tests. These use the real LLM loop but replace tool results with deterministic fixture outputs so you can verify tool selection and confirmation-gate behavior without depending on live SkyFi data.

This suite intentionally includes negative cases where the user request is underspecified. Those cases should pass only when the model avoids calling the purchase tools and asks for the missing detail instead.

### `live-smoke`

Read-only live tests. These call the real MCP server and grade whether the model used the expected tools and whether the returned outputs were non-empty and plausibly useful.

The live suite intentionally avoids order-confirmation calls.

## Verification Status

Latest completed successful runs:

- `planner-smoke`: passed (`5/5`)
  - `evals/results/2026-03-14T22-49-47.643Z`
- `live-integration-smoke`: passed (`4/4`)
  - `evals/results/2026-03-14T22-52-46.248Z`
- `live-feasibility-smoke`: passed (`1/1`)
  - `evals/results/2026-03-14T22-55-42.189Z`
- `live-opportunity-smoke`: passed (`2/2`)
  - `evals/results/2026-03-14T22-59-11.707Z`
- `live-monitoring-smoke`: passed (`1/1`)
  - `evals/results/2026-03-14T23-00-54.614Z`
- `live-orders-smoke`: passed (`2/2`)
  - `evals/results/2026-03-14T23-01-39.469Z`

Coverage included in those successful runs:

- planner tool selection and confirmation-gate behavior
- account readiness and pricing lookup
- place-name and exact-address resolution
- archive search
- feasibility checks
- next-opportunity lookup, including an expected failure for too-soon pass windows
- read-only order history inspection
- read-only AOI monitoring review

## Requirements

- `OPENAI_API_KEY`
- a reachable MCP server URL

Optional:

- `SKYFI_MCP_URL`
- `SKYFI_API_KEY`
- `OPENROUTER_API_KEY`
- `OPENROUTER_JUDGE_MODEL`

If `SKYFI_API_KEY` is set, the harness forwards it to the MCP server as `x-skyfi-api-key`.
If `OPENROUTER_API_KEY` is set, failed deterministic cases receive a secondary review from an OpenRouter judge model.

## Usage

List suites and scenarios:

```bash
bun run evals --list
```

Run the fixture-backed planner suite against a local Worker:

```bash
export OPENAI_API_KEY=...
export SKYFI_MCP_URL=http://localhost:8787/mcp
bun run evals:planner-smoke
```

Run with secondary failure review enabled:

```bash
export OPENROUTER_API_KEY=...
export OPENROUTER_JUDGE_MODEL=anthropic/claude-sonnet-4.5
bun run evals:planner-smoke
```

Run the live read-only suite:

```bash
export OPENAI_API_KEY=...
export SKYFI_MCP_URL=http://localhost:8787/mcp
export SKYFI_API_KEY=...
bun run evals:live-smoke
```

Run a subset of cases:

```bash
bun run evals --suite live-smoke --cases live-pricing-exploration,live-account-readiness
```

## Output

Each run writes:

- one JSON artifact per case
- one `summary.json` file for the whole run

under `evals/results/<timestamp>/`.

These artifacts capture:

- pass/fail
- grading reasons
- optional judge verdict for failed cases
- final answer text
- tool call trail
- raw tool results
- response IDs
