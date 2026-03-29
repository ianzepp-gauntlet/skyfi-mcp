# SkyFi MCP + Google ADK

Connect the SkyFi MCP server to a Google [Agent Development Kit (ADK)](https://google.github.io/adk-docs/) agent.

## Prerequisites

- A running SkyFi MCP server (local or deployed)
- Python 3.10+
- `google-adk` installed (`pip install google-adk`)
- [`skyfi-cli`](https://github.com/ianzepp/skyfi-cli) installed (optional, for testing)

## Testing & Verification

Before wiring up an agent, use `skyfi-cli` to verify your credentials and explore real data:

```bash
# Verify auth
skyfi-cli whoami

# Search for imagery (grab an archive ID to use in examples)
skyfi-cli archives search --aoi 'POLYGON ((-122.4 37.7, -122.3 37.7, -122.3 37.8, -122.4 37.8, -122.4 37.7))'

# Check pricing
skyfi-cli pricing get

# List existing orders
skyfi-cli orders list

# Set up an AOI monitor (replace with your webhook URL)
skyfi-cli notifications create \
  --aoi 'POLYGON ((-122.4 37.7, -122.3 37.7, -122.3 37.8, -122.4 37.8, -122.4 37.7))' \
  --webhook-url https://your-webhook.example.com/hook
```

## Setup

ADK supports MCP tool servers natively via `MCPToolset`.

```python
from google.adk.toolsets import MCPToolset

skyfi_tools = MCPToolset(
    name="skyfi",
    connection_params={
        "url": "http://localhost:3000/mcp",
        "headers": {
            "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
        },
    },
)
```

For a deployed server on Cloudflare Workers:

```python
skyfi_tools = MCPToolset(
    name="skyfi",
    connection_params={
        "url": "https://skyfi-mcp.ian-zepp.workers.dev/mcp",
        "headers": {
            "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
        },
    },
)
```

## Agent Configuration

Register the toolset when creating your agent:

```python
from google.adk.agents import Agent

agent = Agent(
    model="gemini-2.0-flash",
    name="skyfi_agent",
    instruction="You are a satellite imagery assistant. Use the SkyFi tools to search imagery, check pricing, and help users order satellite photos.",
    toolsets=[skyfi_tools],
)
```

## Run

```python
from google.adk.runners import InMemoryRunner

runner = InMemoryRunner(agent=agent)
session = runner.create_session()

response = runner.run(
    session_id=session.id,
    user_message="Search for recent satellite imagery of downtown San Francisco",
)

for event in response:
    if event.content:
        print(event.content.text)
```

## Place Name Resolution

The `location_resolve` tool converts place names to coordinates so you don't need to supply WKT polygons manually:

```python
response = runner.run(
    session_id=session.id,
    user_message="Find satellite imagery near the Golden Gate Bridge from the last two weeks",
)
# The agent will call location_resolve("Golden Gate Bridge") → WKT polygon,
# then pass those coordinates to archives_search automatically.
```

## Conversational Ordering

The agent follows a strict prepare → confirm flow before any purchase:

```python
# Step 1: user asks about ordering
response = runner.run(
    session_id=session.id,
    user_message="I'd like to order a high-resolution image of the Port of Los Angeles. Check if it's feasible first.",
)
# Agent calls: feasibility_submit → feasibility_status → reports pass windows

# Step 2: user approves and asks to proceed
response = runner.run(
    session_id=session.id,
    user_message="Looks good. What would it cost and can we place the order?",
)
# Agent calls: orders_prepare → presents price summary, waits for confirmation

# Step 3: user confirms
response = runner.run(
    session_id=session.id,
    user_message="Yes, confirm the order.",
)
# Agent calls: orders_confirm → order placed
```

The agent will never call `orders_confirm` without presenting the price first.

For long linear assets such as pipelines, use the corridor workflow first:

```python
response = runner.run(
    session_id=session.id,
    user_message=(
        "I manage an oil pipeline. Chunk this route into 1 km wide corridor polygons "
        "with 20 km maximum chunk length and then run feasibility next week."
    ),
)
# Agent calls: corridor_chunk → feasibility_submit → feasibility_status
```

## AOI Monitoring

Set up an Area of Interest monitor so the agent notifies a webhook when new imagery becomes available:

```python
response = runner.run(
    session_id=session.id,
    user_message=(
        "Set up a monitor for the Panama Canal zone. "
        "Notify me at https://my-webhook.example.com/alerts when new imagery arrives."
    ),
)
# Agent calls: location_resolve → notifications_create with webhook URL

# Later: check for pending alerts
response = runner.run(
    session_id=session.id,
    user_message="Any new imagery alerts for my monitors?",
)
# Agent calls: alerts_list → reports new imagery notifications
```

## Available Tools

Once connected, the agent has access to all SkyFi MCP tools:

- `archives_search` — search the satellite catalog
- `archive_get` — inspect a specific archive scene in full detail
- `passes_predict` — predict upcoming satellite passes over an AOI
- `feasibility_submit` — create a feasibility job for one or more AOIs
- `feasibility_status` — poll a feasibility job and aggregate per-AOI results
- `corridor_chunk` — convert a GPS route into reusable corridor AOI chunks
- `pricing_get` — view pricing options
- `account_whoami` — inspect account profile, budget, and payment readiness
- `orders_list` / `orders_get` — browse order history
- `orders_deliverable_get` — get a signed download URL for an existing deliverable
- `orders_redeliver` — retry delivery for an existing order with new delivery settings
- `orders_prepare` / `orders_confirm` — place orders with human confirmation
- `notifications_create` / `notifications_list` / `notifications_get` / `notifications_delete` — manage AOI monitors
- `alerts_list` — check for new imagery alerts
- `location_resolve` — convert place names to WKT coordinates (via OpenStreetMap)

## Notes

- The `x-skyfi-api-key` header is required for authentication
- Orders require two-step confirmation (prepare then confirm) — the agent will present pricing for human approval before executing
- ADK handles MCP session management automatically via the Streamable HTTP transport
