# SkyFi MCP + Google Gemini

Connect the SkyFi MCP server to the [Gemini API](https://ai.google.dev/gemini-api) using its MCP tool support.

## Prerequisites

- A Google AI API key
- A deployed SkyFi MCP server with a public URL
- [`skyfi-cli`](https://github.com/ianzepp/skyfi-cli) installed (optional, for testing)

> **Note:** The Gemini API connects to your MCP server directly — it must be publicly accessible over HTTPS. See [Local Development](#local-development) for tunnel options.

## Testing & Verification

Before writing Gemini code, use `skyfi-cli` to verify credentials and explore real data:

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

## Gemini API (MCP Tool Type)

The Gemini API supports MCP servers as a tool type in function calling:

```python
from google import genai

client = genai.Client()

skyfi_tool = genai.types.Tool(
    mcp=genai.types.McpTool(
        server_url="https://skyfi-mcp.ian-zepp.workers.dev/mcp",
        headers={
            "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
        },
    )
)

response = client.models.generate_content(
    model="gemini-2.0-flash",
    contents="Search for satellite imagery of the Great Barrier Reef from the last month",
    config=genai.types.GenerateContentConfig(
        tools=[skyfi_tool],
    ),
)

print(response.text)
```

## Place Name Resolution

The `location_resolve` tool converts place names to WKT coordinates via OpenStreetMap — no manual polygon construction needed:

```python
response = client.models.generate_content(
    model="gemini-2.0-flash",
    contents="Find recent satellite imagery near the Eiffel Tower",
    config=genai.types.GenerateContentConfig(
        tools=[skyfi_tool],
    ),
)
# Gemini calls location_resolve("Eiffel Tower") → WKT polygon,
# then passes coordinates to archives_search automatically.
print(response.text)
```

## Multi-Turn Conversation

For interactive sessions with tool use across multiple turns:

```python
from google import genai

client = genai.Client()

skyfi_tool = genai.types.Tool(
    mcp=genai.types.McpTool(
        server_url="https://skyfi-mcp.ian-zepp.workers.dev/mcp",
        headers={
            "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
        },
    )
)

chat = client.chats.create(
    model="gemini-2.0-flash",
    config=genai.types.GenerateContentConfig(
        tools=[skyfi_tool],
        system_instruction="You are a satellite imagery assistant. Help users search, monitor, and order satellite imagery through SkyFi.",
    ),
)

# Search
response = chat.send_message("Find imagery of downtown Seattle from last week")
print(response.text)

# Pricing
response = chat.send_message("What would that cost?")
print(response.text)
```

## Conversational Ordering

Use a multi-turn chat to walk through the full feasibility → prepare → confirm flow:

For pipelines and other long linear assets, use the two-step corridor workflow:

```python
response = chat.send_message(
    "This oil pipeline is too long for one AOI polygon. Chunk the route into "
    "a 1 km wide corridor with 20 km maximum chunk length, then run feasibility "
    "next week."
)
print(response.text)
# Gemini calls corridor_chunk -> feasibility_submit -> feasibility_status
```

```python
chat = client.chats.create(
    model="gemini-2.0-flash",
    config=genai.types.GenerateContentConfig(
        tools=[skyfi_tool],
        system_instruction="You are a satellite imagery assistant. Always check feasibility and show pricing before confirming any order.",
    ),
)

# Step 1: feasibility
response = chat.send_message(
    "Can we task a new SAR capture of the Port of Rotterdam next week? Check feasibility."
)
print(response.text)
# → Reports available pass windows

# Step 2: prepare (model presents price, waits for approval)
response = chat.send_message(
    "Great. Prepare an order for next Monday through Friday and show me the price."
)
print(response.text)
# → "This order would cost $X. Confirm?"

# Step 3: confirm
response = chat.send_message("Yes, confirm the order.")
print(response.text)
# → Order placed
```

## AOI Monitoring

```python
chat = client.chats.create(
    model="gemini-2.0-flash",
    config=genai.types.GenerateContentConfig(tools=[skyfi_tool]),
)

# Create a monitor
response = chat.send_message(
    "Set up a monitor for the Strait of Hormuz. "
    "Send alerts to https://my-webhook.example.com/alerts when new imagery arrives."
)
print(response.text)
# Agent calls: location_resolve → notifications_create

# Check alerts
response = chat.send_message("Any new imagery alerts?")
print(response.text)
# Agent calls: alerts_list → reports pending notifications
```

Webhook payloads are delivered to your endpoint when new imagery appears over a monitored AOI.

## REST API

```bash
curl "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=$GOOGLE_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "contents": [
      {"parts": [{"text": "Search for satellite imagery near the Pyramids of Giza"}]}
    ],
    "tools": [
      {
        "mcp": {
          "serverUrl": "https://skyfi-mcp.ian-zepp.workers.dev/mcp",
          "headers": {
            "x-skyfi-api-key": "YOUR_SKYFI_API_KEY"
          }
        }
      }
    ]
  }'
```

## Local Development

The Gemini API requires a public HTTPS URL. To test with a local server:

```bash
# Start the MCP server
export SKYFI_API_KEY=your-key-here
bun run dev

# In a separate terminal, expose it publicly
ngrok http 3000
```

Use the ngrok HTTPS URL (e.g. `https://abc123.ngrok-free.app/mcp`) as `server_url` in your Gemini tool config.

## Notes

- Gemini connects to the MCP server directly — the server must be publicly accessible over HTTPS
- The API handles tool discovery, session management, and multi-step tool calling automatically
- The SkyFi MCP server uses Durable Object-backed session state on Cloudflare Workers, which remains compatible with Gemini's connection model
- Orders use a two-step confirmation flow (prepare then confirm) for safety
- `location_resolve` uses the OpenStreetMap Nominatim API to convert place names to WKT polygons
