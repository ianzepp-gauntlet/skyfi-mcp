# Observed Constraints

These are concrete findings from a live SkyFi MCP exploration run on 2026-03-15. Treat them as operational hints, not permanent guarantees.

## Readiness and account state

- `account_whoami` returned a real user account with `hasValidSharedCard: false`, `budgetAmount: 0`, and `remainingBudget: 0`.
- That means research and monitoring flows were usable, but paid ordering could not be presented as ready without qualification.
- A card-limit failure later proved that a live confirm-path test can still trigger a real billable order attempt if the chosen archive is not actually open data.

## Archive-first findings

- `location_resolve` successfully resolved `Port of Los Angeles, California` into a WKT polygon suitable for downstream tools.
- `archives_search` over `2026-02-15` to `2026-03-15` returned a mix of commercial and open-data results.
- `archive_get` on a commercial Planet SkySat result produced rich details including footprint, pricing, and imagery metadata.
- `orders_get` on an existing zero-cost open-data archive order showed a completed delivery lifecycle and linked archive metadata.
- `orders_deliverable_get` produced a signed download URL for an existing order deliverable.
- For confirmation-gate tests, letting the model search and pick a scene is not safe enough. A live search-based confirm test drifted to a billable scene and attempted a paid order.

## Tasking-first findings

- `passes_predict` failed when the time window started less than 24 hours from the current time.
- A later window beginning on `2026-03-17T00:00:00Z` succeeded and returned multiple passes.
- `feasibility_check` for a near-term `DAY` / `VERY HIGH` request completed successfully but returned no opportunities.
- A good agent should distinguish between "no opportunities" and actual API/tool failure.

## Monitoring-first findings

- `notifications_create` failed when no explicit `webhookUrl` was supplied and the server lacked an internally managed public webhook URL.
- Supplying `https://skyfi-mcp.ian-zepp.workers.dev/webhooks/aoi` allowed monitor creation to succeed.
- `notifications_get` confirmed the new monitor, and `notifications_delete` removed it cleanly.
- The live account also had one pre-existing monitor with zero recent alerts.

## Ambiguity handling

- `location_resolve` for `Springfield` returned multiple legitimate U.S. cities.
- A demo agent should surface that ambiguity instead of pretending the first result is always correct.

## Human gate findings

- The original remote confirmation flow failed even with immediate approval because confirmation tokens were stored in session-local memory. The error message looked like an expiry, but the real problem was session-boundary token loss.
- That issue was fixed by moving confirmation storage to shared process-level state locally and a Durable Object-backed shared store remotely.
- A local live human-loop eval then succeeded end-to-end.
- A deployed remote live human-loop eval also succeeded end-to-end against `https://skyfi-mcp.ian-zepp.workers.dev/mcp`.
- The safe path uses a pinned known open-data archive and `deliveryDriver: NONE`.

## Current safe HITL recipe

Use this exact combination when the goal is to prove the human approval gate without requiring cloud bucket credentials:

- `archiveId`: `4ecd615a-0588-4a80-9010-580f2b6a6e67`
- AOI: `POLYGON ((-118.27 33.72, -118.21 33.72, -118.21 33.76, -118.27 33.76, -118.27 33.72))`
- verify from `archive_get`:
  - `openData: true`
  - `priceFullScene: 0`
- prepare with:
  - `type: archive`
  - `deliveryDriver: NONE`
- confirm only after explicit approval
