# SkyFi MCP + Claude Code

Connect the SkyFi MCP server to [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's CLI for Claude.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- A running SkyFi MCP server (local or deployed)
- [`skyfi-cli`](https://github.com/ianzepp/skyfi-cli) installed (optional, for testing)

## Testing & Verification

Before connecting to Claude Code, use `skyfi-cli` to verify your credentials and explore real data:

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

## Local Server

Start the SkyFi MCP server:

```bash
export SKYFI_API_KEY=your-key-here
bun run dev
```

Add it to Claude Code:

```bash
claude mcp add skyfi http://localhost:3000/mcp
```

## Deployed Server (Cloudflare Workers)

For a remote deployment with API key authentication:

```bash
claude mcp add skyfi \
  --header "x-skyfi-api-key: YOUR_SKYFI_API_KEY" \
  https://skyfi-mcp.ian-zepp.workers.dev/mcp
```

## Usage

Once connected, SkyFi tools are available in your Claude Code session. Ask naturally:

```
> Search for satellite imagery of downtown Kyiv from the last month

> What pricing tiers does SkyFi offer?

> Find imagery near the Pyramids of Giza — use the place name, don't worry about coordinates

> Check if we can task a new SAR capture of the Port of Shanghai next week

> Set up an AOI monitor for the Panama Canal and notify me at https://my-webhook.example.com
```

## Place Name Resolution

Claude Code can resolve place names to coordinates automatically using the `location_resolve` tool (powered by OpenStreetMap). You never need to supply WKT polygons manually:

```
> Find recent satellite imagery near the Golden Gate Bridge
```

Claude will call `location_resolve` to get the coordinates, then pass them to `archives_search`.

## Conversational Ordering

Claude Code follows a strict prepare → confirm flow. It will never place an order without showing you the price first:

```
> I want to order a high-res image of the Port of Los Angeles. Is a new capture feasible?
[Claude calls feasibility_check, reports available pass windows]

> Great. What would a tasking order cost for next week?
[Claude calls orders_prepare, presents price summary]

> Looks good — confirm the order.
[Claude calls orders_confirm only after your explicit approval]
```

For pipelines and other long linear assets:

```
> This oil pipeline is too long for one AOI polygon. Chunk it into a 1 km corridor and check feasibility next week.
[Claude calls corridor_chunk → feasibility_check_chunks]
```

## AOI Monitoring

```
> Monitor the Suez Canal for new imagery. Send alerts to https://my-webhook.example.com/alerts.
[Claude calls location_resolve → notifications_create]

> Do I have any new imagery alerts?
[Claude calls alerts_list → reports pending notifications]
```

## Verify Connection

Check that the MCP server is registered:

```bash
claude mcp list
```

You should see `skyfi` in the output with the configured URL.

## Remove

```bash
claude mcp remove skyfi
```

## Notes

- Claude Code connects via the Streamable HTTP transport
- For local development, the server uses stateful sessions with in-memory session tracking
- For Cloudflare Workers, the server uses Durable Object-backed session state so MCP sessions can survive across HTTP requests
- Orders require explicit confirmation — Claude Code will present the price and ask for your approval before placing any order
- `location_resolve` uses the OpenStreetMap Nominatim API to convert place names to WKT polygons
