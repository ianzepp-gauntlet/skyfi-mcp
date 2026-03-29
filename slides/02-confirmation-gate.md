# Slide 2 — "CONFIRMATION GATE" — Ordering Safety Model

## Corrected Facts
- orders_prepare: validates params → fetches pricing → stores token via crypto.randomUUID() → returns pricing + token. Response text: "ORDER NOT YET PLACED"
- Token: single-use, configurable TTL (default 5 min via SKYFI_CONFIRMATION_TTL_MS), lazy expiration, crypto UUID
- Token store: in-memory (Bun) or Durable Object (Cloudflare) — survives session boundaries on remote
- orders_confirm: atomic consume (await get + delete) → submits to SkyFi API → returns order ID
- Failure paths: expired → "call orders_prepare again", API error → restore() puts token back, double-submit → already consumed → rejected
- Deep research skill exercises the full HITL gate end-to-end with pinned zero-cost open-data archive (deliveryDriver: NONE)
- Eval coverage: live-open-data-human-approval-confirms-order + expired-token scenario

## Talking Point
"An agent cannot jump from intent to purchase. Prepare fetches pricing and returns a short-lived token. Confirm consumes it atomically. The token is single-use, expires in 5 minutes by default, and if the upstream API call fails, the token is restored so the user doesn't have to re-review pricing."

---

## Variant A — "Launch Authorization Sequence"

Create a wide-format (16:9) technical schematic slide titled "CONFIRMATION GATE // ORDERING SAFETY MODEL" in a dark satellite mission control aesthetic. Black background, monospace typography, amber/gold and white line art, no photographic imagery, no gradients.

**Layout:** A left-to-right flow divided into two phases separated by a prominent vertical gate in the center, with a live validation section at the bottom.

**Left phase, labeled "PHASE 1: PREPARE":** A vertical stack of four boxes connected by downward arrows: "orders_prepare called" → "Validate params (type, AOI, delivery)" → "Fetch pricing from SkyFi API" → "Store token (in-memory or Durable Object)". At the bottom of this stack, a wide output box labeled "RETURNS TO AGENT:" containing two lines: "pricing summary" and "confirmation token (crypto UUID)". A prominent label in amber: "ORDER NOT YET PLACED".

**Center gate:** A tall vertical rectangle styled like a physical security barrier or airlock door. Inside it, three labels stacked vertically: "SINGLE USE", "CONFIGURABLE TTL", "ASYNC-SAFE". The gate has a keyhole or card-slot icon where the token enters from the left and exits to the right. Above the gate, a label: "HUMAN REVIEWS PRICING HERE". This should be the visual focal point.

**Right phase, labeled "PHASE 2: CONFIRM":** A vertical stack of three boxes: "orders_confirm called with token" → "Atomic consume: await get + delete" → "Submit order to SkyFi API". At the bottom, an output box "RETURNS:" with "order ID + status". A prominent label in green: "ORDER EXECUTED".

**Below the main flow, a horizontal bar labeled "FAILURE PATHS"** containing three small boxes in a row:
- "Token expired → re-run orders_prepare"
- "API failure → restore() puts token back"
- "Double submit → already consumed → rejected"

**Below the failure paths, a separate section labeled "LIVE VALIDATION"** with two items shown as small schematic cards:
- "Deep research skill: archive-first → prepare → human gate → confirm (pinned zero-cost open-data archive, deliveryDriver: NONE)"
- "Eval coverage: live-open-data-human-approval-confirms-order + expired-token scenario"

**Top right margin annotation:** "Token store: in-memory (Bun) or Durable Object (Cloudflare) — survives session boundaries on remote"

Style: Mission control process diagram. Thin amber borders. The center gate is the visual anchor — thicker borders, larger. The live validation section at the bottom should feel like an evidence panel bolted onto the diagram.

---

## Variant B — "Airlock Diagram"

Create a wide-format (16:9) technical diagram slide titled "ORDERING SAFETY MODEL" on a dark charcoal background. Hand-drawn sketch style with slightly organic lines. White and amber ink. Monospace labels.

**Central metaphor: a two-chamber airlock drawn from above (top-down cross section).** Two rectangular chambers side by side with a sealed door between them.

**Left chamber, labeled "PREPARE":** Inside the chamber, four steps as handwritten annotations with small arrows: "validate params" → "fetch pricing" → "store token (memory or Durable Object)" → "return pricing + token to agent". A large scrawled note at bottom: "ORDER NOT YET PLACED". Entry arrow on the far left: "Agent calls orders_prepare".

**The sealed door between chambers:** Drawn as a thick double line with a lock icon. Three labels around the door: "SINGLE USE" above, "CONFIGURABLE TTL (default 5 min)" on the door, "human reviews pricing here" below in handwritten annotation with an arrow pointing to the space between chambers.

**Right chamber, labeled "CONFIRM":** Inside: "await consume (atomic get + delete)" → "submit to SkyFi API" → "return order ID". A note at bottom: "ORDER EXECUTED" in green-tinted text. Exit arrow on far right: "Purchase complete".

**Below the airlock, three failure-path sticky notes:**
- "Token expired? Door stays locked. Re-run prepare."
- "API fails? Token restored. No re-review needed."
- "Same token twice? Already consumed. Rejected."

**To the right of the airlock, a separate annotation panel** styled as a field notebook page, titled "LIVE PROOF". Three handwritten bullet points:
- "Deep research skill runs full gate end-to-end"
- "Pinned zero-cost archive (open data, deliveryDriver: NONE)"
- "Eval scenarios: approval + expired-token paths tested live"

**Top right corner annotation:** "Token store: Durable Object on Cloudflare — survives session restarts"

Style: Engineer's whiteboard sketch. Hand-drawn chambers, wobbly lines, annotation notes that look scribbled. The airlock metaphor is immediate — two rooms, one locked door, you must stop in between. The field notebook panel on the right provides evidence this isn't just theoretical.

---

## Variant C — "Countdown Sequence"

Create a wide-format (16:9) technical diagram slide titled "CONFIRMATION GATE" on a dark charcoal background with subtle topographic contour texture. White and amber ink, monospace labels, hand-drawn sketch style.

**Layout:** A vertical timeline flowing top to bottom on the left two-thirds of the slide, with an evidence panel on the right third.

**Timeline steps, each as a horizontal bar with a status icon on the left:**

Step 1 — amber circle: "orders_prepare → validate params, fetch pricing, store token" with annotation: "crypto.randomUUID() — in-memory or Durable Object"

Step 2 — amber circle: "Return pricing + confirmation token to agent" with large annotation: "ORDER NOT YET PLACED"

Step 3 — lock icon (visual focal point, wider bar, thicker borders): "HUMAN REVIEW — agent presents pricing, user decides" with annotation: "Configurable TTL (default 5 min) — single use — no bypass". Draw a countdown timer icon.

Step 4 — amber circle: "orders_confirm → await atomic consume (get + delete)" with annotation: "token invalidated immediately"

Step 5 — green circle: "Submit to SkyFi API → return order ID" with annotation: "ORDER EXECUTED"

**Branching failure paths** as dashed lines from the timeline:
- From Step 3: "Token expires → restart from Step 1"
- From Step 4: "Double submit → already consumed → rejected"
- From Step 5: "API error → restore() puts token back → retry"

**Right panel, titled "LIVE PROOF"** styled as a field notebook or operations log:
- "Deep research skill exercises full gate"
- "Pinned zero-cost open-data archive"
- "deliveryDriver: NONE (no cloud creds needed)"
- "Eval: live approval + expired-token scenarios"
- "Token store: Durable Object on Cloudflare — cross-session persistence"

**Bottom annotation:** "The token is the only path from pricing to purchase — the agent cannot fabricate, reuse, or skip it"

Style: Mission countdown checklist meets terrain map. The human review step (Step 3) dominates visually. The right panel provides evidence this has been validated with real agent runs, not just unit tests.
