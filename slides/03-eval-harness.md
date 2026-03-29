# Slide 3 — "EVAL HARNESS" — Agent Behavior Validation

## Corrected Facts
- 37 scenarios across 15 suites — fixture-backed (deterministic) and live (real SkyFi API)
- 8 grading criteria: expected tools, tool sequence ordering, forbidden tools, must-contain phrases, must-contain-any phrases, must-not-contain phrases, minimum answer length, tool output content validation
- Secondary judge: Claude Sonnet 4.5 via OpenRouter reviews failures to classify as real failure vs rubric-too-strict vs ambiguous
- 150 unit tests across 22 test files (separate from eval scenarios)
- Two execution modes: FixtureExecutor (canned YAML responses) and LiveMcpExecutor (real MCP connection via Streamable HTTP)

## Talking Point
"Unit tests check functions. Evals check agent behavior. 37 scenarios run a real LLM tool loop — either against fixtures for deterministic replay, or live against the SkyFi API. The grader checks 8 criteria including tool sequence ordering and output content. When a case fails, a secondary judge model reviews whether it's a real failure or the rubric being too strict."

---

## Variant A — "Mission Telemetry Dashboard"

Create a wide-format (16:9) technical schematic slide titled "EVAL HARNESS // AGENT BEHAVIOR VALIDATION" in a dark satellite mission control aesthetic. Black background, monospace typography, amber/gold and white line art, no photographic imagery, no gradients.

**Layout:** Three columns of equal width, each with a header bar.

**Left column, header "SCENARIOS":** Show a stylized YAML document snippet at the top with visible field labels: "id:", "query:", "expected_tools:", "forbidden_tools:", "follow_up_messages:". Below the snippet, a vertical list of 6 scenario names as monospace labels, each with a small category tag: "human-approval-confirms-order [ordering]", "archive-search-place-name [search]", "feasibility-then-pass-prediction [tasking]", "aoi-create-get-alerts-delete [monitoring]", "no-approval-no-confirm [safety]", "live-location-and-search [live]". Below the list, a summary line: "37 SCENARIOS / 15 SUITES".

**Center column, header "EXECUTION":** A vertical loop diagram showing the agent execution cycle. Four nodes in a circle connected by arrows: "Prompt → Model selects tool → Execute (fixture or live) → Return result" with an arrow looping back to "Model selects tool". A label at the top of the loop: "max 8 steps per case". Two mode labels below the loop as side-by-side boxes: "FIXTURE MODE: canned YAML responses, deterministic" and "LIVE MODE: real MCP connection to SkyFi API". Below that: "150 unit tests / 22 test files (separate)".

**Right column, header "GRADING":** A checklist of 8 grading criteria, each with a small checkbox icon: "Expected tools called", "Tool sequence ordering correct", "Forbidden tools avoided", "Required phrases present", "Any-of phrases present", "Forbidden phrases absent", "Minimum answer length met", "Tool output content validated". Below the checklist, a separate box labeled "SECONDARY JUDGE" with: "Claude Sonnet 4.5 via OpenRouter" and three verdict labels: "real_failure | rubric_too_strict | ambiguous".

Style: Mission telemetry dashboard with three data panels. Thin amber borders on all boxes and column headers. The YAML snippet should look like actual code rendered in monospace. Clean and structured.

---

## Variant B — "Test Loop Cycle"

Create a wide-format (16:9) technical diagram slide titled "EVAL HARNESS" on a dark charcoal background. Hand-drawn sketch style with slightly organic lines. White and amber ink. Monospace labels.

**Center of the diagram:** A large circular flow with four nodes connected by curved arrows forming a loop, labeled clockwise:
- "PROMPT" (top) — "User query from scenario YAML"
- "SELECT" (right) — "Model picks tool from allowed set"
- "EXECUTE" (bottom) — "Fixture (deterministic) or Live (real SkyFi API)"
- "RESULT" (left) — "Tool output fed back to model"
An arrow from RESULT curves back to SELECT. A small label inside the loop: "up to 8 steps". An exit arrow breaks out of the loop from SELECT downward, labeled "Final answer".

**Top left, outside the loop:** A stylized YAML document styled as a pinned note or torn paper scrap, showing: "id: human-approval-confirms-order", "query: Prepare an archive order...", "expected_tools: [orders_prepare, orders_confirm]", "follow_up_messages: ['Yes, place the order']". Below it: "37 scenarios / 15 suites".

**Bottom right, outside the loop:** A grading checklist styled as a clipboard or field notebook page. Eight items with small check marks: "Expected tools", "Tool sequence order", "Forbidden tools", "Must-contain phrases", "Any-of phrases", "Must-not-contain phrases", "Min answer length", "Tool output content". Below the checklist, a separate annotation box: "JUDGE: Claude Sonnet 4.5 reviews failures → real_failure | rubric_too_strict | ambiguous".

**Bottom left annotation** (field note style): "150 unit tests across 22 files — separate from eval scenarios"

**Top right annotation:** "Two modes: fixture (canned) for deterministic replay, live for real API validation"

Style: Engineer's whiteboard sketch with the circular loop as the dominant visual. Hand-drawn arrows, annotation notes that look scribbled on a planning board. Dark background, light ink.

---

## Variant C — "Scenario Pipeline"

Create a wide-format (16:9) technical diagram slide titled "EVAL HARNESS — AGENT BEHAVIOR VALIDATION" on a dark charcoal background with subtle topographic contour texture. White and amber ink, monospace labels, hand-drawn sketch style.

**Layout:** A top-to-bottom pipeline flowing through three stages.

**Stage 1 — "SCENARIO INPUT" (top):** A wide horizontal band containing several scenario cards arranged in a row, each as a small rectangle with a name and category tag. Show 5-6 cards: "human-approval [ordering]", "archive-search [search]", "feasibility-chain [tasking]", "aoi-lifecycle [monitoring]", "no-confirm [safety]", "live-search [live]". A count label to the right: "37 scenarios across 15 suites". A downward arrow labeled "one at a time" leads to Stage 2.

**Stage 2 — "EXECUTION LOOP" (middle, largest section):** A horizontal flow showing the agent loop. Left side: a box "Initial prompt + allowed tools" feeds into a repeating cycle shown as a horizontal chain: "Model → Tool Call → Execute → Result → Model" with a loop arrow above it labeled "up to 8 steps". Two boxes below the chain show the execution modes side by side: "FIXTURE: canned YAML responses" and "LIVE: real MCP → SkyFi API". A downward arrow labeled "final answer + tool call trace" leads to Stage 3.

**Stage 3 — "GRADING" (bottom):** Split into two side-by-side sections.

Left section, "DETERMINISTIC GRADER": Eight criteria listed vertically with small status icons: "Expected tools called", "Tool sequence order", "Forbidden tools avoided", "Must-contain phrases", "Any-of phrases", "Must-not-contain", "Min answer length", "Tool output content". Result labels: "PASS or FAIL + reasons".

Right section, "SECONDARY JUDGE": A box labeled "Claude Sonnet 4.5 (OpenRouter)" with subtitle "Only invoked on failures". Three verdict outputs: "real_failure", "rubric_too_strict", "ambiguous". An annotation: "Separates actual bugs from overly strict rubrics".

**Bottom right annotation:** "Also: 150 unit tests / 22 test files (function-level, separate from evals)"

Style: Signal processing pipeline on a terrain map. Scenarios flow in at the top, get processed, graded at the bottom. Hand-drawn lines, field note annotations. The execution loop in the middle should be the visual focus.
