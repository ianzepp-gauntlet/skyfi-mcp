# Slide 7 — "CORRIDOR CHUNKING" — Automated Pipeline

## Key Facts
- Two MCP tools: corridor_chunk (geometry) → feasibility_check_chunks (satellite availability)
- Pipeline: raw GPS route → local equirectangular projection → Douglas-Peucker simplification → distance-based splitting → convex hull per chunk → area budget bisection → WKT output
- Convex hull is deliberate: live testing showed SkyFi rejects raw offset rings at bends, but convex hulls are accepted
- Area budget (maxChunkAreaSqKm): binary search halves chunk length until polygon fits within area cap
- Antimeridian-safe: longitude normalization handles routes crossing the 180° line
- Polar guard: rejects routes above 80° average latitude (equirectangular projection breaks down)
- Feasibility fan-out: each chunk runs independently, per-chunk error isolation (one failure doesn't abort the batch)
- Output summary: chunkCount, feasibleChunkCount, failedChunkCount, totalOpportunityCount
- Replaces ~2 hours of manual work with two tool calls

## Talking Point
"Two tool calls replace two hours. corridor_chunk takes a raw GPS route, projects it locally, simplifies dense points, splits by distance, and builds a convex hull polygon per section — with an optional area cap that bisects chunks that are too large. Then feasibility_check_chunks fans out independent feasibility checks per chunk, with error isolation so one failure doesn't kill the batch. The agent gets back a per-section coverage map."

---

## Variant A — "Mission Control Schematic"

Create a wide-format (16:9) technical schematic slide titled "CORRIDOR CHUNKING // AUTOMATED PIPELINE" in a dark satellite mission control aesthetic. Black background, monospace typography, amber/gold and green line art, no photographic imagery, no gradients.

**Layout:** A left-to-right pipeline flow with two major phases, showing the transformation from raw route to per-chunk feasibility results.

**Phase 1 — left side, labeled "corridor_chunk":** A vertical pipeline of processing steps, each as a box connected by downward arrows:
1. "Raw GPS Route" (input — show a small winding polyline icon)
2. "Local Equirectangular Projection" with annotation: "lat/lon → meters"
3. "Douglas-Peucker Simplification" with annotation: "absorb dense OSRM-like data"
4. "Distance-Based Splitting" with annotation: "maxChunkLengthMeters"
5. "Convex Hull Per Chunk" with annotation: "SkyFi-safe — no concavity"
6. "Area Budget Check" with annotation: "bisect if > maxChunkAreaSqKm"

At the bottom of Phase 1, show the output: a row of 4-5 small convex polygon icons laid end-to-end along a route, each labeled with a chunk index (0, 1, 2, 3, 4). Below them: "WKT POLYGON per chunk".

**Connector between phases:** A wide arrow labeled "chunks array" pointing from Phase 1 output to Phase 2 input.

**Phase 2 — right side, labeled "feasibility_check_chunks":** Show the chunks fanning out into parallel feasibility checks. Each of the 4-5 chunk polygons has an arrow pointing to its own "Feasibility Check" box. Below the checks, show results merging back: some chunks marked green ("opportunities found"), one marked amber ("no opportunities"), one marked red ("ERROR — isolated"). A summary box at the bottom:
- "chunkCount: 5"
- "feasibleChunkCount: 3"
- "failedChunkCount: 1"
- "totalOpportunityCount: 7"

**Annotation callouts:**
- Top left: "INPUT: any ordered GPS polyline — pipelines, roads, rail, power lines"
- Top right: "2 tool calls replace ~2 hours of manual polygon work"
- Bottom left: "Antimeridian-safe · polar guard (< 80° lat) · convex-only output"

Style: Mission control data processing pipeline. Thin amber borders on all boxes. The two phases should be visually distinct (Phase 1 = geometry, Phase 2 = satellite availability). Green/amber/red status indicators on the feasibility results. Clean and precise.

---

## Variant B — "Whiteboard Sketch"

Create a wide-format (16:9) technical diagram slide titled "CORRIDOR CHUNKING" on a dark charcoal background. Hand-drawn sketch style with slightly organic lines. White and amber ink. Monospace labels.

**Layout:** A top-to-bottom transformation story showing a route being progressively processed.

**Top — "INPUT":** A hand-drawn winding route line with many dense GPS points along it (shown as small dots packed closely together). Label: "Raw GPS route — 200km pipeline, hundreds of points". A field note annotation: "Could come from OSRM, Google Maps, or hand-traced".

**Middle — "PROCESSING" (the largest section):** Show the route being transformed in 4 visual steps arranged as a storyboard strip flowing left to right:

Step 1: The dense route points get thinned out (fewer dots, same shape). Label: "Simplify (Douglas-Peucker)".

Step 2: The simplified route gets sliced by vertical cut lines at regular intervals. Label: "Split by distance". Small annotation: "maxChunkLengthMeters".

Step 3: Each segment gets a convex polygon drawn around it — show 4-5 chunky hexagon-like shapes laid along the route, each one covering its segment. Label: "Convex hull per chunk". A scrawled note: "No concavity → SkyFi accepts every one".

Step 4: One of the chunks is visually too large. Show it being bisected in half with a dotted line. Label: "Area budget → bisect". Annotation: "maxChunkAreaSqKm".

**Bottom — "OUTPUT":** The final chunks shown as a row of convex polygons, each with a status indicator:
- Chunk 0: green circle, "3 opportunities"
- Chunk 1: green circle, "2 opportunities"
- Chunk 2: amber circle, "0 opportunities"
- Chunk 3: red circle, "ERROR (isolated)"
- Chunk 4: green circle, "2 opportunities"

A summary note: "feasibleChunkCount: 3 / failedChunkCount: 1 / totalOpportunityCount: 7"

**Right margin annotation panel (field notes):**
- "2 MCP tool calls total"
- "corridor_chunk → geometry"
- "feasibility_check_chunks → availability"
- "One failure doesn't kill the batch"
- "Replaces ~2 hrs manual work"

Style: Engineer's whiteboard transformation story. The storyboard strip in the middle should feel like a visual proof — you can see the route being progressively tamed from messy input to clean output. Hand-drawn polygons, scribbled annotations. Dark background, light ink.

---

## Variant C — "Ground Station Network"

Create a wide-format (16:9) technical diagram slide titled "CORRIDOR CHUNKING" on a dark charcoal background with subtle topographic contour line texture. White, amber, and green ink. Monospace labels. Hand-drawn sketch style.

**Layout:** A map-like view showing a route being chunked, with a processing pipeline annotation along one side.

**Center of the slide:** A winding route drawn across the terrain contours (same route from the problem slide). But this time, the route is cleanly divided into 5 sections by perpendicular cut marks. Each section has its own convex polygon drawn around it — 5 distinct, non-overlapping convex shapes following the route. The polygons should look clean and geometric compared to the messy failed attempts on the problem slide.

Each polygon is color-coded by feasibility result:
- Chunks 0, 1, 4: green border with a small satellite icon, labeled "feasible"
- Chunk 2: amber border, labeled "no passes"
- Chunk 3: red border, labeled "error (isolated)"

KM markers along the route: "KM 0", "KM 40", "KM 80", "KM 120", "KM 160", "KM 200".

**Right side — a vertical processing pipeline** shown as a narrow column of labeled steps connected by arrows:
1. "GPS route in"
2. "Project → simplify → split"
3. "Convex hull per chunk"
4. "Area budget check"
5. "Feasibility per chunk"
6. "Per-section coverage map"

Labels: "corridor_chunk" next to steps 1-4, "feasibility_check_chunks" next to steps 5-6.

**Top left annotation (field note style):** "2 tool calls. ~2 seconds. Replaces ~2 hours of manual polygon work."

**Bottom annotation spanning width:** "Each chunk: independent feasibility check, independent error handling. The agent sees exactly which corridor sections have satellite coverage."

**Bottom right detail annotations:**
- "Antimeridian-safe (longitude normalization)"
- "Polar guard (< 80° avg latitude)"
- "Convex-only output (SkyFi-validated)"

Style: Satellite operator's solution map — the same terrain from the problem slide, but now the corridor is cleanly segmented and color-coded. The visual contrast with the problem slide should be immediate: messy failed polygons → clean chunked coverage. The processing pipeline on the right is secondary to the map view. Green feasibility indicators should pop against the dark background.
