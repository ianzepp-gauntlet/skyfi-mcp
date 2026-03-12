# SkyFi MCP + OpenAI

Connect the SkyFi MCP server to [OpenAI](https://platform.openai.com/) via the Responses API's MCP tool support.

## Prerequisites

- An OpenAI API key
- A deployed SkyFi MCP server with a public URL
- [`skyfi-cli`](https://github.com/ianzepp/skyfi-cli) installed (optional, for testing)

> **Note:** The OpenAI Responses API connects to your MCP server directly — it must be publicly accessible over HTTPS. See [Local Development](#local-development) for tunnel options.

## Testing & Verification

Before writing OpenAI code, use `skyfi-cli` to verify credentials and explore real data:

```bash
# Verify auth
skyfi-cli whoami

# Search for imagery (note an archive ID from the results)
skyfi-cli archives search --aoi 'POLYGON ((-122.4 37.7, -122.3 37.7, -122.3 37.8, -122.4 37.8, -122.4 37.7))'

# Check pricing
skyfi-cli pricing get

# List existing orders
skyfi-cli orders list --json | jq '.orders[].orderId'

# Set up an AOI monitor
skyfi-cli notifications create \
  --aoi 'POLYGON ((-122.4 37.7, -122.3 37.7, -122.3 37.8, -122.4 37.8, -122.4 37.7))' \
  --webhook-url https://your-webhook.example.com/hook
```

## Responses API (Direct MCP Support)

OpenAI's Responses API supports MCP servers natively as a tool type:

```bash
curl https://api.openai.com/v1/responses \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENAI_API_KEY" \
  -d '{
    "model": "gpt-4o",
    "tools": [
      {
        "type": "mcp",
        "server_label": "skyfi",
        "server_url": "https://skyfi-mcp.your-account.workers.dev/mcp",
        "headers": {
          "x-skyfi-api-key": "YOUR_SKYFI_API_KEY"
        }
      }
    ],
    "input": "Search for satellite imagery of the Eiffel Tower from the last month"
  }'
```

## Python SDK

```python
from openai import OpenAI

client = OpenAI()

response = client.responses.create(
    model="gpt-4o",
    tools=[
        {
            "type": "mcp",
            "server_label": "skyfi",
            "server_url": "https://skyfi-mcp.your-account.workers.dev/mcp",
            "headers": {
                "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
            },
        }
    ],
    input="What are the pricing options for satellite imagery?",
)

print(response.output_text)
```

## Node.js SDK

```typescript
import OpenAI from "openai";

const client = new OpenAI();

const response = await client.responses.create({
  model: "gpt-4o",
  tools: [
    {
      type: "mcp",
      server_label: "skyfi",
      server_url: "https://skyfi-mcp.your-account.workers.dev/mcp",
      headers: {
        "x-skyfi-api-key": process.env.SKYFI_API_KEY!,
      },
    },
  ],
  input: "Search for recent satellite imagery of downtown Tokyo",
});

console.log(response.output_text);
```

## Place Name Resolution

The `location_resolve` tool converts place names to WKT coordinates via OpenStreetMap — no manual polygon construction required:

```python
response = client.responses.create(
    model="gpt-4o",
    tools=[{
        "type": "mcp",
        "server_label": "skyfi",
        "server_url": "https://skyfi-mcp.your-account.workers.dev/mcp",
        "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
    }],
    input="Find recent satellite imagery near the Pyramids of Giza",
)
# The model calls location_resolve("Pyramids of Giza") → WKT polygon,
# then passes coordinates to archives_search automatically.
print(response.output_text)
```

## Conversational Ordering

Use a multi-turn thread to walk through the full feasibility → prepare → confirm flow:

```python
from openai import OpenAI

client = OpenAI()

mcp_tool = {
    "type": "mcp",
    "server_label": "skyfi",
    "server_url": "https://skyfi-mcp.your-account.workers.dev/mcp",
    "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
}

# Step 1: feasibility check
r1 = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    input="Check if it's feasible to task a new SAR capture of the Port of Rotterdam next week.",
)
print(r1.output_text)
# → Reports available pass windows

# Step 2: prepare — model presents price, waits for human approval
r2 = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    previous_response_id=r1.id,
    input="Prepare an order for next Monday through Friday. Show me the price first.",
)
print(r2.output_text)
# → "This order would cost $X. Confirm?"

# Step 3: human approves, model confirms
r3 = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    previous_response_id=r2.id,
    input="Yes, confirm the order.",
)
print(r3.output_text)
# → Order placed
```

## AOI Monitoring

```python
mcp_tool = {
    "type": "mcp",
    "server_label": "skyfi",
    "server_url": "https://skyfi-mcp.your-account.workers.dev/mcp",
    "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
}

# Create a monitor
r = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    input=(
        "Set up a monitor for the Strait of Hormuz. "
        "Send alerts to https://my-webhook.example.com/alerts when new imagery arrives."
    ),
)
print(r.output_text)
# Agent calls: location_resolve → notifications_create

# Check for pending alerts
r = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    input="Any new imagery alerts for my monitors?",
)
print(r.output_text)
# Agent calls: alerts_list → reports pending notifications
```

Webhook payloads are delivered to your endpoint when new imagery appears over a monitored AOI.

## Tool Filtering

To expose only specific tools, use the `allowed_tools` parameter:

```python
{
    "type": "mcp",
    "server_label": "skyfi",
    "server_url": "https://skyfi-mcp.your-account.workers.dev/mcp",
    "headers": {
        "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
    },
    "allowed_tools": ["archives_search", "pricing_get", "location_resolve"],
}
```

## Local Development

The OpenAI Responses API requires a public HTTPS URL. To test with a local server:

```bash
# Start the MCP server
export SKYFI_API_KEY=your-key-here
bun run dev

# In a separate terminal, expose it publicly
ngrok http 3000
```

Use the ngrok HTTPS URL (e.g. `https://abc123.ngrok-free.app/mcp`) as `server_url` in your tool config.

## Notes

- OpenAI connects to the MCP server directly — the server must be publicly accessible over HTTPS
- The Responses API handles MCP session management, tool discovery, and tool calling automatically
- The server runs in stateless mode on Cloudflare Workers, which is compatible with OpenAI's connection model
- Orders require two-step confirmation (prepare then confirm) to ensure human approval
- `location_resolve` uses the OpenStreetMap Nominatim API to convert place names to WKT polygons
- Use `previous_response_id` to chain multi-turn conversations in the Responses API
