# SkyFi MCP + Google ADK

Connect the SkyFi MCP server to a Google [Agent Development Kit (ADK)](https://google.github.io/adk-docs/) agent.

## Prerequisites

- A running SkyFi MCP server (local or deployed)
- Python 3.10+
- `google-adk` installed (`pip install google-adk`)

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
        "url": "https://skyfi-mcp.your-account.workers.dev/mcp",
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

## Available Tools

Once connected, the agent has access to all SkyFi MCP tools:

- `archives_search` — search the satellite catalog
- `feasibility_check` — check if a new capture is possible
- `pricing_get` — view pricing options
- `orders_list` / `orders_get` — browse order history
- `orders_prepare` / `orders_confirm` — place orders with human confirmation
- `notifications_create` / `notifications_list` / `notifications_get` / `notifications_delete` — manage AOI monitors
- `alerts_list` — check for new imagery alerts
- `location_resolve` — convert place names to coordinates

## Notes

- The `x-skyfi-api-key` header is required for authentication
- Orders require two-step confirmation (prepare then confirm) — the agent will present pricing for human approval before executing
- ADK handles MCP session management automatically via the Streamable HTTP transport
