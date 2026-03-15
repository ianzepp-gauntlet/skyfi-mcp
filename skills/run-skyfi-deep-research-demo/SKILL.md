---
name: run-skyfi-deep-research-demo
description: Use when the user wants to explore the active SkyFi MCP connection, rehearse a geospatial deep-research demo, compare archive/tasking/monitoring workflow variants, or recreate a repeatable SkyFi MCP research run without accidentally placing orders.
---

# Run SkyFi Deep Research Demo

Use this skill to exercise the live SkyFi MCP surface as a demo agent would: establish account state, pick an AOI, run several workflow variants, summarize the tradeoffs, and clean up temporary monitoring artifacts.

Read [references/observed-constraints.md](references/observed-constraints.md) before running if you need the current integration quirks and concrete examples from prior live runs.
Use [references/scenarios.yaml](references/scenarios.yaml) as the working scenario corpus when you want concrete prompts and expected behaviors to test against this skill.

## Quick Start

Start with these read-only tools to understand the live session:

- `account_whoami`
- `pricing_get`
- `notifications_list`
- `orders_list`

Treat this as a readiness gate, not boilerplate. You need to know:

- whether the account can actually place paid orders
- whether any prior orders or monitors exist that can be reused as examples
- whether you should keep the run strictly exploratory

If payment readiness or budget is missing, say so explicitly and avoid presenting ordering as available.

For human-in-the-loop testing, distinguish between:

- `research/demo ordering discussion`: exploratory, no confirmation
- `safe live gate test`: pinned open-data archive, explicit approval, real confirmation

Do not blur those modes.

## Workflow

### 1. Resolve an AOI

Use `location_resolve` to turn a place name into a WKT polygon.

Preferred AOIs:

- ports
- airports
- industrial zones
- disaster areas
- named cities or districts tied to the user’s research question

If the location result is ambiguous, do not silently pick a random city unless one result is clearly dominant and the ambiguity is low. For broad names like `Springfield`, show the candidate locations and either ask for clarification or state which candidate you will use and why.

### 2. Run the archive-first variant

Use this when the goal is evidence-backed research from existing imagery.

Recommended order:

1. `archives_search` with the resolved AOI and an explicit date range
2. `archive_get` on the most promising result
3. `orders_list` or `orders_get` if existing orders help demonstrate retrieval and deliverables
4. `orders_deliverable_get` only for an existing order when you need to prove downstream access

Bias toward recent imagery, low cloud cover, and clearly explain the tradeoff between open-data coverage and higher-resolution commercial captures.

This is the default demo path because it produces concrete evidence quickly and carries less operational risk than tasking or purchase flows.

### 3. Run the tasking-first variant

Use this when the research question depends on future collection opportunities rather than existing imagery.

Recommended order:

1. `pricing_get` scoped to the AOI
2. `passes_predict` with a window that starts at least 24 hours in the future
3. `feasibility_check` for a concrete product type and resolution

Critical rules:

- always use exact ISO dates
- never start `passes_predict` too close to the current time
- treat `opportunities: []` as a valid outcome, not a tool failure
- explain feasibility and pricing separately

Only use `orders_prepare` if the user explicitly wants to move from research into ordering and you have the required delivery details. Never call `orders_confirm` without explicit human confirmation.

### 3a. Run a safe human-gate archive test

Use this only when the goal is to prove the confirmation gate itself.

Recommended order:

1. `archive_get` on a pinned known archive ID
2. verify from tool output that `openData` is `true`
3. verify from tool output that `priceFullScene` is `0`
4. `orders_prepare` with `deliveryDriver: NONE`
5. stop and wait for explicit approval
6. `orders_confirm`
7. `orders_get` or `orders_list` to prove the created order exists

Critical rules:

- do not let the model search live and choose an archive for a confirm-path gate test
- pin the archive ID in the scenario or test prompt
- inspect the archive before preparing the order
- use `deliveryDriver: NONE` for the open-data gate path so fake bucket credentials are not required
- never treat a prepare response as a placed order

The current known-safe archive for this repo is:

- `archiveId`: `4ecd615a-0588-4a80-9010-580f2b6a6e67`
- AOI: `POLYGON ((-118.27 33.72, -118.21 33.72, -118.21 33.76, -118.27 33.76, -118.27 33.72))`

If you use a different archive, you must re-verify from tool output that it is open data and zero cost before allowing confirmation.

### 4. Run the monitoring-first variant

Use this when the best demo is continuous awareness rather than immediate retrieval.

Recommended order:

1. `notifications_list` to inspect existing monitors
2. `notifications_create` only if you have either:
   a configured internal webhook on the MCP host, or
   an explicit `webhookUrl`
3. `notifications_get` to verify the created monitor
4. `alerts_list` to inspect recent alert history
5. `notifications_delete` to clean up any temporary monitor created for the demo

Do not create persistent monitors as a casual probe. If you create one for demonstration, delete it before finishing unless the user explicitly wants it retained.

### 5. Compare the variants

After running the variants, summarize:

- which path answered the research question fastest
- which path produced the highest-confidence evidence
- which path was blocked by account or infrastructure constraints
- what a polished demo agent should choose first for similar user intents

The comparison is part of the deliverable. Do not just dump tool results.

## Expected Findings

In a healthy exploratory run, you should usually be able to surface:

- account readiness constraints
- at least one resolvable AOI
- one viable archive-first path
- one tasking policy or feasibility constraint
- one monitoring setup constraint or success path

If any path fails, record whether the problem was:

- user input ambiguity
- upstream API policy
- account/payment readiness
- missing webhook/public URL configuration
- delivery-mode requirements
- session-boundary/state persistence
- actual MCP/tool failure

## Safety Rules

- Never place an order by default.
- Never call `orders_confirm` without explicit human approval in the thread.
- Prefer existing orders over creating new purchase flows during demo work.
- Use exact dates like `2026-03-17T00:00:00Z`, not relative language in tool inputs.
- Clean up temporary monitors you create.
- For live HITL tests, pin the archive ID and verify it is open data before confirmation.
- For live HITL tests, use `deliveryDriver: NONE` when the goal is a zero-cost open-data archive order.

## Output Shape

When reporting results back to the user, include:

- the AOI you chose
- the workflow variants you tested
- the strongest example result from each variant
- the constraints that changed agent behavior
- the recommended default demo path

Keep the summary operational. The point is to learn how a real deep-research agent should behave on this MCP surface, not to produce generic prose about geospatial analysis.
