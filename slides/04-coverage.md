# Slide 4 — "COVERAGE MAP" — Requirements Status

## Corrected Facts
- 8 requirements fully met, 2 partial in the current repo state
- 3 Durable Objects on Cloudflare: MCP session, AlertStore, ConfirmationStore
- Transport: Streamable HTTP — intentional upgrade from legacy SSE
- Payments go through the SkyFi account, but there is no separate payment subsystem in this repo
- The demo agent exists as an in-repo skill and prompt set, not a standalone polished demo app

## Talking Point
"Most of the requirements are fully implemented in the repo today. Two remain partial in a strict sense: billing is delegated to the SkyFi account rather than a separate payment subsystem in this codebase, and the demo agent exists as a reusable skill and prompt set rather than a standalone polished app. The transport is still an intentional modernization — Streamable HTTP on Cloudflare Agents rather than the older HTTP+SSE pattern from the original spec."

---

## Variant A — "Ground Track / Waypoint Map"

Create a wide-format (16:9) technical diagram slide titled "REQUIREMENTS COVERAGE" in a dark satellite mission control aesthetic. Black background, monospace typography, amber/gold, green, and white line art, no photographic imagery, no gradients.

**Layout:** A curved orbital ground track sweeps across the slide from bottom-left to top-right — a single smooth arc like a satellite's path projected onto a dark map. Along this arc, 10 waypoint markers are evenly spaced. Most waypoints have a green filled center (indicating "met"); two use amber to indicate "partial". A thin leader line extends from each waypoint to a label box.

**The 10 waypoints, in order along the arc:**
1. "Remote MCP — Cloudflare Workers + Durable Objects"
2. "SkyFi API — 20 tools across 6 groups"
3. "Local Hosting — Bun runtime"
4. "Conversational Ordering — prepare/confirm gate"
5. "Feasibility + Pass Prediction"
6. "AOI Monitoring — webhooks + alert persistence"
7. "Location Resolution — OpenStreetMap Nominatim"
8. "Auth — header-based (cloud) + JSON config (local)"
9. "Integration Docs — 7 platforms (ADK, LangChain, AI SDK, Claude Web, OpenAI, Claude Code, Gemini)"
10. "Demo Agent — reusable skill/prompt set (partial)"

Waypoints 1-8 are green. Waypoints 9-10 use amber to indicate partial fulfillment.

**Annotation callouts around the margins (monospace, thin border boxes):**
- Top left: "Transport: Streamable HTTP — intentional upgrade from legacy SSE"
- Bottom right: "Payments: billing through SkyFi account — no separate payment subsystem needed"
- Top right: "Cloudflare: 3 Durable Objects — MCP session, AlertStore, ConfirmationStore"

**Bottom center, a summary line in larger text:** "8 MET / 2 PARTIAL"

Style: Dark satellite tracking display. The orbital arc should feel like a real ground track plotted on a dark map background (no actual map imagery — just the suggestion of it through subtle grid lines or faint latitude/longitude marks). Green waypoints should glow subtly against the dark background. Clean and precise.

---

## Variant B — "Satellite Constellation"

Create a wide-format (16:9) technical diagram slide titled "REQUIREMENTS COVERAGE" on a dark charcoal background. Hand-drawn sketch style with slightly organic lines. White, amber, and green ink. Monospace labels.

**Center:** A circular mission badge or emblem labeled "SKYFI MCP" with "8 MET / 2 PARTIAL" prominently inside it.

**Surrounding the badge:** 10 nodes arranged in a rough circle like satellites in constellation, each connected to the center by a thin line. Most nodes use a green filled center; two use amber to indicate partial. Arrange them roughly like a clock face:

- 12 o'clock: "Remote MCP — Cloudflare Workers + Durable Objects"
- 1 o'clock: "SkyFi API — 20 tools / 6 groups"
- 2 o'clock: "Local Hosting — Bun"
- 3 o'clock: "Conversational Ordering — prepare/confirm gate"
- 4 o'clock: "Feasibility + Pass Prediction"
- 5 o'clock: "AOI Monitoring + Webhooks"
- 6 o'clock: "Location — OpenStreetMap"
- 8 o'clock: "Auth — headers + local config"
- 9 o'clock: "Payments — SkyFi billing, no local payment subsystem (partial)"
- 11 o'clock: "Demo Agent — deep-research skill assets (partial)"

Eight nodes are green. The Payments and Demo Agent nodes are amber.

**Three annotation callouts** positioned in the open space between nodes, styled as field notes with thin leader lines:
- Near the Remote MCP node: "3 Durable Objects: session, alerts, confirmation"
- Near the Ordering node: "Streamable HTTP transport — modern MCP spec"
- Near the bottom: "Payments handled through SkyFi account billing"

Style: Hand-drawn constellation diagram. Organic lines, field note annotations. The central badge should feel like a mission patch. Green dots should stand out as the dominant color accent against the dark background.

---

## Variant C — "Status Board"

Create a wide-format (16:9) technical diagram slide titled "REQUIREMENTS STATUS" on a dark charcoal background with subtle topographic contour texture. White, amber, and green ink. Monospace labels. Hand-drawn sketch style.

**Layout:** A large status board table filling most of the slide. 10 rows, each representing a requirement. Three columns: a status indicator (left), the requirement name (center), and key evidence or detail (right).

**Row format:** Each row has a hand-drawn circle on the left (filled green for met), the requirement name in white monospace, and a right-aligned detail annotation in amber.

**The 10 rows:**
1. Green circle | "Remote MCP Server" | "Cloudflare Workers — 3 Durable Objects"
2. Green circle | "SkyFi API Integration" | "20 tools across 6 groups"
3. Green circle | "Local Hosting" | "Bun runtime — localhost:3000/mcp"
4. Green circle | "Conversational Ordering" | "prepare/confirm gate — single-use token, configurable TTL"
5. Green circle | "Feasibility + Tasking" | "passes_predict + feasibility submit/status + corridor chunking"
6. Green circle | "AOI Monitoring" | "5 tools + webhook receiver + shared alert DO"
7. Green circle | "Location Resolution" | "OpenStreetMap Nominatim → WKT polygon"
8. Green circle | "Authentication" | "x-skyfi-api-key header + ~/.skyfi/config.json"
9. Amber circle | "Payments Support" | "Uses SkyFi account billing; no separate payment subsystem in this repo"
10. Amber circle | "Demo Agent" | "Reusable deep-research skill and prompts, not a standalone polished app"

**Below the table, two annotation boxes side by side:**
- Left box: "TRANSPORT: Streamable HTTP — intentional upgrade from legacy HTTP + SSE spec"
- Right box: "PAYMENTS: billing through SkyFi account — no separate payment subsystem in this repo"

**Bottom center, large text:** "8 MET / 2 PARTIAL"

Style: Operations room status board. The table should feel like a real-time monitoring display — rows are clearly separated, status circles are the visual anchor for each row. Hand-drawn but legible. The green circles should be the most prominent color element. Think of the board you'd see on the wall of a satellite operations center showing system health.
