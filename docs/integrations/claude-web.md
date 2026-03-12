# SkyFi MCP + Claude Web (Anthropic)

Connect the SkyFi MCP server to [Claude](https://claude.ai) as a custom integration.

## Prerequisites

- A Claude Pro, Team, or Enterprise subscription
- A deployed SkyFi MCP server with a public URL (e.g. on Cloudflare Workers)

> **Note:** Claude Web requires a publicly accessible HTTPS URL. The local development server (`http://localhost:3000`) will not work unless exposed via a tunnel (e.g. ngrok).

## Setup

1. Open [claude.ai](https://claude.ai) and go to **Settings**
2. Navigate to **Integrations** (or **Custom Integrations**)
3. Click **Add Custom Integration**
4. Enter the MCP server URL:
   ```
   https://skyfi-mcp.your-account.workers.dev/mcp
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

## Ordering Flow

When placing orders, Claude will:

1. Call `orders_prepare` to validate parameters and fetch pricing
2. Present the price summary for your review
3. Only call `orders_confirm` after you explicitly approve

This two-step flow ensures you always see the price before any purchase is made.

## Available Tools

All SkyFi MCP tools are available in the conversation:

| Tool | What it does |
|------|-------------|
| `archives_search` | Search the satellite catalog |
| `feasibility_check` | Check if a new capture is possible |
| `pricing_get` | View pricing matrix |
| `orders_list` / `orders_get` | Browse order history |
| `orders_prepare` / `orders_confirm` | Place orders (with confirmation) |
| `notifications_create` / `notifications_list` / `notifications_get` / `notifications_delete` | Manage area monitors |
| `alerts_list` | Check for new imagery notifications |
| `location_resolve` | Convert place names to coordinates |

## Notes

- Claude manages the MCP session automatically
- The server runs in stateless mode on Cloudflare Workers — each request is independent
- API key is sent via the `x-skyfi-api-key` header on every request
- For local development, use a tunnel service to expose your server:
  ```bash
  ngrok http 3000
  ```
  Then use the ngrok HTTPS URL as the integration endpoint
