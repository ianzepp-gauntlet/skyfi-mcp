# SkyFi MCP + Claude Web (Anthropic)

Connect the SkyFi MCP server to [Claude](https://claude.ai) as a custom integration.

## Prerequisites

- A Claude Pro, Team, or Enterprise subscription
- A deployed SkyFi MCP server with a public URL (e.g. on Cloudflare Workers)
- [`skyfi-cli`](https://github.com/ianzepp/skyfi-cli) installed (optional, for testing)

> **Note:** Claude Web requires a publicly accessible HTTPS URL. The local development server (`http://localhost:3000`) will not work unless exposed via a tunnel (see [Local Development](#local-development) below).

## Testing & Verification

Before connecting Claude Web, use `skyfi-cli` to confirm your credentials and explore real data:

```bash
# Verify auth
skyfi-cli whoami

# Search for imagery
skyfi-cli archives search --aoi 'POLYGON ((-122.4 37.7, -122.3 37.7, -122.3 37.8, -122.4 37.8, -122.4 37.7))'

# Check pricing
skyfi-cli pricing get

# List existing orders
skyfi-cli orders list

# Set up an AOI monitor
skyfi-cli notifications create \
  --aoi 'POLYGON ((-122.4 37.7, -122.3 37.7, -122.3 37.8, -122.4 37.8, -122.4 37.7))' \
  --webhook-url https://your-webhook.example.com/hook
```

## Setup

1. Open [claude.ai](https://claude.ai) and go to **Settings**
2. Navigate to **Integrations** (or **Custom Integrations**)
3. Click **Add Custom Integration**
4. Enter the MCP server URL:
   ```
   https://skyfi-mcp.ian-zepp.workers.dev/mcp
   ```
5. Add the authentication header:
   - Header name: `x-skyfi-api-key`
   - Header value: your SkyFi API key
6. Save the integration

## Usage

Once connected, you can use SkyFi tools directly in Claude conversations:

> "Search for satellite imagery of the Suez Canal from the last 30 days with less than 20% cloud cover"

> "Check if it's feasible to task a new satellite capture of Central Park next week"

> "Show me the pricing for satellite imagery"

> "Set up an AOI monitor for the Port of Rotterdam"

## Place Name Resolution

You never need to supply coordinates manually. Claude will call `location_resolve` (powered by OpenStreetMap) to convert place names to WKT polygons automatically:

> "Find recent satellite imagery near the Pyramids of Giza"

Claude resolves the location, then searches the archive — no WKT required.

## Ordering Flow

When placing orders, Claude will:

1. Call `orders_prepare` to validate parameters and fetch pricing
2. Present the price summary for your review
3. Only call `orders_confirm` after you explicitly approve

This two-step flow ensures you always see the price before any purchase is made.

Example conversation:

> "I'd like to order imagery of the Panama Canal. Check feasibility first."
> [Claude reports available pass windows]
>
> "What would a tasking order cost for next week?"
> [Claude presents price: "This order would cost $X. Confirm?"]
>
> "Yes, confirm."
> [Claude places the order]

## AOI Monitoring

Claude can set up Area of Interest monitors and report on alerts:

> "Monitor the Strait of Hormuz for new imagery. Send alerts to https://my-webhook.example.com/alerts."
> [Claude calls location_resolve → notifications_create]

> "Any new imagery alerts for my monitors?"
> [Claude calls alerts_list → reports pending notifications]

Webhook payloads are delivered to your endpoint automatically when new imagery appears over a monitored AOI.

## Available Tools

All SkyFi MCP tools are available in the conversation:

| Tool | What it does |
| --- | --- |
| `archives_search` | Search the satellite catalog |
| `archive_get` | Inspect a specific archive scene in full detail |
| `passes_predict` | Predict upcoming satellite passes over an AOI |
| `feasibility_check` | Check if a new capture is possible |
| `corridor_chunk` | Convert a GPS route into reusable corridor AOI chunks |
| `feasibility_check_chunks` | Run `feasibility_check` semantics across chunked AOIs |
| `pricing_get` | View pricing matrix |
| `account_whoami` | Inspect account profile, budget, and payment readiness |
| `orders_list` / `orders_get` | Browse order history |
| `orders_deliverable_get` | Get a signed download URL for an existing deliverable |
| `orders_redeliver` | Retry delivery for an existing order with new delivery settings |
| `orders_prepare` / `orders_confirm` | Place orders (with confirmation) |
| `notifications_create` / `notifications_list` / `notifications_get` / `notifications_delete` | Manage area monitors |
| `alerts_list` | Check for new imagery notifications |
| `location_resolve` | Convert place names to coordinates (via OpenStreetMap) |

## Local Development

Claude Web requires a public HTTPS URL. To test with a local server, expose it via a tunnel:

```bash
# Start the MCP server
export SKYFI_API_KEY=your-key-here
bun run dev

# In a separate terminal, expose it publicly
ngrok http 3000
```

Use the ngrok HTTPS URL (e.g. `https://abc123.ngrok-free.app/mcp`) as the integration endpoint in Claude Web settings.

## Notes

- Claude manages the MCP session automatically
- The Cloudflare Workers deployment is session-backed via Durable Objects rather than purely stateless request handling
- API key is sent via the `x-skyfi-api-key` header on every request
- `location_resolve` uses the OpenStreetMap Nominatim API to convert place names to WKT polygons
