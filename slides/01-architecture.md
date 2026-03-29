# Slide 1 — "MISSION OVERVIEW" — System Architecture

## Corrected Facts
- 20 tools across 6 groups: search (2), feasibility (4), pricing (1), orders/account (7), AOI monitoring (5), location (1)
- Bun path: Hono + Streamable HTTP transport, in-memory session map, process-local AlertStore
- Cloudflare path: Durable Object per session (SkyFiMcpAgent), shared DO for alerts (SkyFiAlertStore), shared DO for confirmations (SkyFiConfirmationStore), custom Streamable HTTP → WebSocket → DO bridge
- Shared layer: createMcpServer() — identical tool registration on both runtimes
- Upstream services: SkyFi Platform API + OpenStreetMap Nominatim
- Auth: x-skyfi-api-key header or local ~/.skyfi/config.json

## Talking Point
"Same 20 tools on both runtimes. Locally, sessions live in memory. On Cloudflare, each session is a Durable Object — API key persists inside the DO, alerts share a separate DO so they're visible across sessions."

---

## Variant A — "Mission Control Schematic"

Create a wide-format (16:9) technical schematic slide titled "MISSION OVERVIEW // SYSTEM ARCHITECTURE" in a dark satellite mission control aesthetic. Black background, monospace typography, amber/gold and white line art, no photographic imagery, no gradients.

Layout: three horizontal lanes stacked vertically, connected by labeled arrows.

**Top lane, labeled "AGENT LAYER":** A single box on the left labeled "AI Client" with a subtitle "(Claude, OpenAI, Gemini, any MCP client)". An arrow labeled "MCP tool calls" points down to the middle lane.

**Middle lane, labeled "MCP SERVER":** This is the widest section. Show it as a large rounded rectangle that splits into two parallel runtime paths:

Left path labeled "BUN (LOCAL)": contains a box "Hono + Streamable HTTP", connected to a small box "In-Memory Session Map", connected to a small box "Process-Local AlertStore".

Right path labeled "CLOUDFLARE (REMOTE)": contains a box "Custom Streamable HTTP → WebSocket → DO Bridge", connected to a box "Durable Object per Session (SkyFiMcpAgent)", connected to a separate box "Shared Alert DO (SkyFiAlertStore)" with a label "cross-session visibility".

Both paths converge into a single shared box at the bottom of the middle lane labeled "createMcpServer() — 20 TOOLS / 6 GROUPS". Inside or below this box, show 6 small labeled blocks in a row: "Search (2)" "Feasibility (4)" "Pricing (1)" "Orders (7)" "AOI (5)" "Location (1)".

**Bottom lane, labeled "UPSTREAM":** Two boxes. Left box: "SkyFi Platform API". Right box: "OpenStreetMap Nominatim". Dashed arrows connect the tool groups above to the appropriate upstream: Location connects to OSM, everything else connects to SkyFi.

**Annotation callouts** (styled as monospace labels with thin border boxes, positioned around the margins):
- Top right: "AUTH: x-skyfi-api-key header | ~/.skyfi/config.json"
- Bottom left: "TRANSPORT: Streamable HTTP (modern MCP spec)"
- Bottom right: "Same tool layer, two runtimes"

Style: Think satellite ground station network diagram. Boxes have thin 1px amber borders, text is white or amber monospace. Connection lines are thin with small arrowheads. The overall feel should be a technical blueprint you'd see on a mission control monitor.

---

## Variant B — "Orbital Diagram"

Create a wide-format (16:9) technical diagram slide titled "SYSTEM ARCHITECTURE" in a hand-drawn satellite operations schematic style on a dark navy/charcoal background. Use a sketched/hand-drawn line quality for boxes and arrows (not perfectly straight — slightly organic like an engineer's whiteboard sketch). White and amber ink on dark background. Monospace labels.

**Center of the diagram:** A large circle or orbital ring labeled "MCP TOOL CORE" containing the text "createMcpServer()" and "20 tools / 6 groups". Around the inside of the ring, arrange 6 small labeled boxes like satellites in orbit: "Search (2)", "Feasibility (4)", "Pricing (1)", "Orders/Account (7)", "AOI Monitoring (5)", "Location (1)".

**Above the ring (12 o'clock position):** A box labeled "AI AGENT" with subtitle "Claude · OpenAI · Gemini · any MCP client". A sketched arrow points down into the ring labeled "tool calls via Streamable HTTP".

**Left of the ring (9 o'clock):** A box labeled "BUN RUNTIME (LOCAL)" with three annotation callouts in smaller text: "Hono HTTP framework", "In-memory session map", "Process-local alert store". A dashed line connects it to the central ring.

**Right of the ring (3 o'clock):** A box labeled "CLOUDFLARE WORKERS (REMOTE)" with three annotation callouts: "1 Durable Object per session", "Shared Alert DO (cross-session)", "WebSocket bridge to DO". A dashed line connects it to the central ring.

**Below the ring (6 o'clock):** Two boxes side by side. Left: "SkyFi Platform API" (connected by a solid arrow from the ring). Right: "OpenStreetMap Nominatim" (connected by a solid arrow, labeled "location_resolve").

**Corner annotations** (styled as pinned sticky notes or torn paper scraps with handwritten-style monospace text):
- Top right corner: "AUTH: x-skyfi-api-key header or local ~/.skyfi/config.json"
- Bottom left corner: "Both runtimes share identical tool registration"

Style: Think of an engineer's after-hours whiteboard photo — sketched boxes, hand-drawn arrows with slight wobble, annotation callouts that look like sticky notes. Dark background with light ink. No corporate polish, no stock imagery.

---

## Variant C — "Ground Station Network"

Create a wide-format (16:9) technical diagram slide titled "SYSTEM ARCHITECTURE" on a dark charcoal background with a subtle topographic contour line texture (faint, decorative — like a terrain map seen from orbit). White and amber/gold ink. Monospace labels. Hand-drawn sketch style — slightly organic lines, not perfectly ruled. Think of a satellite operator's annotated planning map.

**Layout:** A spatial network diagram. Nodes are scattered across the canvas like ground stations on a map, connected by labeled paths.

**Top center — large node:** "AI AGENT" with subtitle "Claude · OpenAI · Gemini · any MCP client". Two paths descend from it, forking left and right.

**Left node (mid-level):** "BUN (LOCAL)" drawn as a rounded box with three internal annotation lines stacked vertically: "Hono + Streamable HTTP", "In-memory session map", "Process-local alerts". A solid path connects it down to the shared tool node. A small label on the path: "localhost:3000/mcp".

**Right node (mid-level):** "CLOUDFLARE (REMOTE)" drawn as a rounded box with three internal annotation lines: "1 Durable Object per session", "Shared Alert DO (cross-session)", "HTTP → WebSocket → DO bridge". A solid path connects it down to the shared tool node. A small label on the path: "edge network".

**Center node (large, prominent):** "TOOL CORE — 20 TOOLS" as the largest node on the diagram. Inside it, six smaller boxes arranged in two rows of three: "Search (2)", "Feasibility (4)", "Pricing (1)" on top row; "Orders (7)", "AOI (5)", "Location (1)" on bottom row.

**Bottom left node:** "SkyFi Platform API" connected to the tool core by a solid line. Draw a small satellite dish icon next to it.

**Bottom right node:** "OpenStreetMap Nominatim" connected to the tool core by a dashed line labeled "1 tool — location_resolve". Draw a small map pin icon next to it.

**Margin annotations** (styled as handwritten callout notes with thin leader lines, like an engineer's marginalia):
- Near the fork between Bun and Cloudflare: "Same createMcpServer() — identical tools on both paths"
- Near the Cloudflare node: "API key persists inside DO"
- Top right corner: "AUTH: x-skyfi-api-key header or ~/.skyfi/config.json"

Style: Spatial and organic — nodes positioned like stations on a terrain map, not in a rigid grid. Slight hand-drawn wobble on all lines. Dark background with light ink. Annotation callouts look like field notes scribbled on a map. No corporate polish, no stock photos, no gradients.
