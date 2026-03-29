# Slide 5 — "SKYFI-CLI" — Native Alternative

## Key Facts
- Rust CLI, 5.5K LOC, Homebrew installable
- Full SkyFi API v2 surface — every MCP tool has a CLI equivalent
- Zero LLM token overhead, structured JSON output for piping
- alerts install: OS-native notifications via launchd (macOS) or systemd (Linux)
- research command: prompt-driven agent loop using OpenAI Responses API, writes markdown briefs + JSON trace
- Shared config with MCP server (~/.skyfi/config.json)

## Talking Point
"The CLI covers the same SkyFi API surface as the MCP server but with zero token overhead — ideal for scripting and automation. The standout feature is alerts install, which sets up OS-native notifications so you get desktop popups when your AOI monitor fires, without running an MCP server."

---

## Variant A — "Dual Interface"

Create a wide-format (16:9) technical diagram slide titled "SKYFI-CLI // NATIVE ALTERNATIVE" on a dark charcoal background. Hand-drawn sketch style with slightly organic lines. White and amber ink. Monospace labels.

**Layout:** The slide is split vertically into two halves by a thin dashed line down the center, with a shared bottom section.

**Left half, labeled "MCP SERVER (TypeScript)":** A vertical stack showing the MCP agent path. Top: "AI Agent" → arrow labeled "tool calls via Streamable HTTP" → "MCP Server (18 tools)" → "SkyFi API". Annotation callouts: "Rich agent autonomy", "Multi-step tool loops", "Session state in Durable Objects", "Best for: conversational workflows". A small label: "Token cost: full MCP overhead per call".

**Right half, labeled "CLI (Rust, 5.5K LOC)":** A vertical stack showing the CLI path. Top: "Terminal / Script" → arrow labeled "direct commands" → "skyfi-cli binary" → "SkyFi API". Below the binary box, show a compact command tree as a vertical list: "archives search | get", "orders list | get | order-archive | order-tasking | pass-targeted | download", "feasibility check | status | pass-prediction", "notifications create | list | get | delete", "alerts poll | watch | install", "pricing", "research". Annotation callouts: "Zero token overhead", "Structured JSON output for piping", "Homebrew installable", "Best for: scripting, automation, low-cost exploration".

**Shared bottom section spanning full width, labeled "ALERTS INSTALL — OS-NATIVE NOTIFICATIONS":** A horizontal flow showing: "skyfi-cli alerts install" → fork into two paths. Left path: "macOS: launchd agent → Notification Center banners via osascript". Right path: "Linux: systemd user service + timer → notify-send desktop notifications". Both paths have an optional branch: "→ --on-alert hook: spawns user script per alert, JSON on stdin + env vars". An annotation: "Polling interval configurable. Seen/unseen state persisted locally. No MCP server required."

**Top right margin annotation:** "Same SkyFi API, same workflows, two interfaces — pick the right one for the job"

**Bottom right margin annotation:** "research command: prompt-driven agent loop, writes markdown briefs + JSON trace"

Style: Engineer's whiteboard comparison sketch. Two parallel paths, clearly drawn. The CLI side should feel lightweight and direct compared to the MCP side. The alerts install section at the bottom should feel like a bonus feature — a practical integration that goes beyond what the MCP server offers.

---

## Variant B — "Command Surface Map"

Create a wide-format (16:9) technical diagram slide titled "SKYFI-CLI — RUST" on a dark charcoal background with subtle topographic contour texture. White and amber ink, monospace labels, hand-drawn sketch style.

**Layout:** A central hub-and-spoke diagram with the alerts install feature highlighted at the bottom.

**Center hub:** A rounded box labeled "skyfi-cli" with subtitle "Rust · 5.5K LOC · Homebrew". Three small detail labels below: "Zero LLM token overhead", "Structured --json output", "Shared config with MCP server".

**Spokes radiating outward (6 spokes):** Each spoke ends in a command group box:

- Top left: "archives" with sub-labels "search · get"
- Top right: "orders" with sub-labels "list · get · order-archive · order-tasking · pass-targeted · download · redeliver"
- Left: "feasibility" with sub-labels "check · status · pass-prediction"
- Right: "notifications" with sub-labels "create · list · get · delete"
- Bottom left: "pricing" with sub-label "per-provider tiers · AOI-scoped"
- Bottom right: "research" with sub-labels "prompt-driven agent loop · markdown brief · JSON trace · streaming progress"

**Below the hub, spanning full width — a prominently styled section labeled "alerts install":** This should be visually emphasized with a slightly thicker border or highlighted background. Show a horizontal flow: "alerts install --interval 300" → two output paths side by side. Left: a macOS icon or label with "launchd agent → Notification Center banners". Right: a Linux icon or label with "systemd timer → notify-send desktop popups". A third branch below: "--on-alert hook → spawns script per alert (JSON stdin + env vars)". Related commands shown as smaller labels: "alerts poll · alerts watch · alerts state show · alerts state reset".

**Annotation callouts (field note style):**
- Near the research spoke: "Uses OpenAI Responses API with tool loop — same research workflow as MCP, lower overhead"
- Near the top: "Full SkyFi API v2 surface — every MCP tool has a CLI equivalent"
- Near the alerts section: "Only the CLI can deliver OS-native notifications — the MCP server provides the webhook, the CLI provides the desktop alert"

Style: Hub-and-spoke command map with the alerts install feature as the visual anchor at the bottom. Hand-drawn lines, field note annotations. The alerts section should stand out as the unique capability that bridges server-side webhooks to desktop-level user awareness.
