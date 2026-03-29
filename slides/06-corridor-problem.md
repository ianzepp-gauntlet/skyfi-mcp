# Slide 6 — "THE CORRIDOR PROBLEM" — Why Chunking Exists

## Key Facts
- SkyFi currently handles long linear asset requests (pipelines, roads, transmission lines) manually
- A single customer request for pipeline corridor imagery can take ~2 hours of manual work: tracing the route, hand-drawing polygon sections, submitting feasibility checks one at a time
- SkyFi's AOI validator rejects concave polygons in practice — a naive buffer around a winding route produces concavity at every bend
- A single oversized polygon gives no per-section visibility — you can't tell which 20km stretch has satellite coverage and which doesn't
- Linear assets are a common commercial use case (oil/gas pipelines, highways, power lines, rail corridors)

## Talking Point
"When a customer asks SkyFi to image a 200km pipeline, today that's a 2-hour manual exercise — someone traces the route by hand, draws polygon sections, and submits feasibility checks one at a time. We automated the entire workflow into three MCP tool calls: chunk the route, submit one batch feasibility job, then poll for the per-section results."

---

## Variant A — "Mission Control Schematic"

Create a wide-format (16:9) technical schematic slide titled "THE CORRIDOR PROBLEM" in a dark satellite mission control aesthetic. Black background, monospace typography, amber/gold, red, and white line art, no photographic imagery, no gradients.

**Layout:** The slide is split into a top section showing the problem visually and a bottom section with annotation labels.

**Top section — the visual problem:** On the left, draw a winding route line (like a pipeline or road seen from above) running roughly from bottom-left to top-right with 3-4 significant bends. Around the route, draw a single buffer polygon that follows the route contour. At each bend, the polygon creates a concave notch. Mark these concave notches with red X icons and labels: "CONCAVE — REJECTED". The overall polygon should look obviously wrong — too large, too complex, with pinch points at the bends.

On the right side, show a second copy of the same route, but this time with a single giant rectangular bounding box drawn around the entire route. The box covers massive empty areas on either side of the route. Label it: "BOUNDING BOX — TOO LARGE / NO SECTION VISIBILITY". A red X at the corner.

Between the two failed approaches, a large label: "NEITHER APPROACH WORKS".

**Bottom section — three annotation boxes in a row:**
- Left box, red border: "Concave polygons → SkyFi API rejects the AOI"
- Center box, red border: "One giant polygon → no way to know which section has coverage"
- Right box, amber border: "Manual workaround: ~2 HOURS per pipeline request — trace route, hand-draw sections, submit feasibility one at a time"

**Top right margin annotation:** "Common use case: oil/gas pipelines, highways, power lines, rail corridors"

Style: Mission control problem diagnosis display. The failed polygon attempts should look visually broken — red accents on the rejection points. The 2-hour manual workaround callout should be the most prominent text element on the slide. Clean and precise, thin amber/red borders.

---

## Variant B — "Whiteboard Sketch"

Create a wide-format (16:9) technical diagram slide titled "THE CORRIDOR PROBLEM" on a dark charcoal background. Hand-drawn sketch style with slightly organic lines. White, amber, and red ink. Monospace labels.

**Layout:** A before/after narrative flowing left to right.

**Left third — "THE REQUEST":** A hand-drawn sketch of a winding line labeled "200 km oil pipeline" with small icons along it suggesting infrastructure (tiny dots for pump stations or junctions). An annotation arrow points to it: "Customer asks: image this corridor at 50cm resolution". Below it, a field note: "Linear assets: pipelines, roads, power lines, rail".

**Center third — "THE PROBLEM":** Two failed attempts stacked vertically, each crossed out with a red hand-drawn X.

Top attempt: A winding route with a tight buffer polygon that creates concave notches at bends. Label: "Offset buffer → concave at bends → API rejects it". The polygon should look obviously pinched and broken at the turns.

Bottom attempt: The same route with a huge bounding rectangle around it. Label: "Bounding box → 80% empty space → no section visibility".

**Right third — "THE COST":** A large hand-drawn clock icon showing "~2 HRS" prominently. Below it, three bullet-style annotations in a vertical list:
- "Trace route by hand"
- "Draw polygon sections manually"
- "Submit feasibility checks one at a time"

A scrawled note at the bottom: "Per request. Every time."

**Bottom annotation spanning full width:** "The geometry is the bottleneck — not the satellite availability"

Style: Engineer's whiteboard problem statement. Hand-drawn winding routes, red X marks on failed approaches, the clock/time callout should be the emotional anchor. Dark background, light ink. The progression from left to right should tell the story: here's the request, here's why it's hard, here's what it costs today.

---

## Variant C — "Ground Station Network"

Create a wide-format (16:9) technical diagram slide titled "THE CORRIDOR PROBLEM" on a dark charcoal background with subtle topographic contour line texture. White, amber, and red ink. Monospace labels. Hand-drawn sketch style.

**Layout:** A map-like view showing a winding route across terrain, with problem annotations overlaid.

**Center of the slide:** A winding route line drawn across the terrain contours, running from one side of the slide to the other with several significant bends. The route should look like it follows geographic features (a valley, a river path, a ridge line). Small labels along the route: "KM 0", "KM 50", "KM 100", "KM 150", "KM 200".

**Around the route, two overlaid polygon attempts, both visually failing:**

First attempt (amber, semi-transparent): A tight buffer following the route that creates concave pinch points at each bend. Red X marks at each concavity with a small label: "concave — rejected".

Second attempt (amber, dashed): A single massive bounding rectangle around the entire route. Label: "one polygon — no per-section data".

**Left margin — a vertical annotation panel** styled as a field operations log:
- "ASSET: 200km oil pipeline"
- "REQUEST: corridor imagery, 50cm"
- "CURRENT PROCESS: manual"
- "TIME: ~2 hours per request"
- "STEPS: trace → section → submit → repeat"

**Bottom right annotation (field note style, larger text):** "Every bend creates geometry the API won't accept. Every request costs an operator 2 hours of manual polygon work."

**Top right corner:** "Linear assets are one of SkyFi's highest-value commercial use cases"

Style: Satellite operator's annotated terrain map showing a problem site. The winding route across contour lines should feel geographic and real. Red rejection marks should stand out against the amber/white palette. The left-side operations log gives the human cost. The overall mood is: this is a real operational pain point, not an academic exercise.
