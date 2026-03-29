# SkyFi MCP + LangChain / LangGraph

Connect the SkyFi MCP server to [LangChain](https://python.langchain.com/) or [LangGraph](https://langchain-ai.github.io/langgraph/) agents.

## Prerequisites

- A running SkyFi MCP server (local or deployed)
- Python 3.10+
- `langchain-mcp-adapters` installed
- [`skyfi-cli`](https://github.com/ianzepp/skyfi-cli) installed (optional, for testing)

```bash
pip install langchain-mcp-adapters langchain-openai langgraph
```

## Testing & Verification

Before writing agent code, use `skyfi-cli` to verify credentials and grab real IDs:

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

## Setup

Use `MultiServerMCPClient` to connect to the SkyFi MCP server:

<!-- example: examples/langchain/python/setup.py -->

```python
import asyncio

from langchain_mcp_adapters.client import MultiServerMCPClient


async def main():
    async with MultiServerMCPClient(
        {
            "skyfi": {
                "url": "http://localhost:3000/mcp",
                "transport": "streamable_http",
                "headers": {
                    "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
                },
            }
        }
    ) as client:
        tools = client.get_tools()
        print(tools)


asyncio.run(main())
```

<!-- /example -->

## LangGraph Agent

Create a ReAct agent with the MCP tools:

<!-- example: examples/langchain/python/langgraph_agent.py -->

```python
import asyncio

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

model = ChatOpenAI(model="gpt-4o")


async def main():
    async with MultiServerMCPClient(
        {
            "skyfi": {
                "url": "http://localhost:3000/mcp",
                "transport": "streamable_http",
                "headers": {
                    "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
                },
            }
        }
    ) as client:
        agent = create_react_agent(model, client.get_tools())

        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": "Find satellite imagery of Tokyo from the last month",
                    }
                ]
            }
        )

        for msg in result["messages"]:
            print(msg.content)


asyncio.run(main())
```

<!-- /example -->

## Place Name Resolution

The `location_resolve` tool converts place names to WKT coordinates via OpenStreetMap — users don't need to supply polygons manually:

<!-- example: examples/langchain/python/place_name_resolution.py -->

```python
import asyncio

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

model = ChatOpenAI(model="gpt-4o")


async def main():
    async with MultiServerMCPClient(
        {
            "skyfi": {
                "url": "http://localhost:3000/mcp",
                "transport": "streamable_http",
                "headers": {
                    "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
                },
            }
        }
    ) as client:
        agent = create_react_agent(model, client.get_tools())

        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": "Find recent imagery near the Golden Gate Bridge",
                    }
                ]
            }
        )

        # Agent calls location_resolve("Golden Gate Bridge") -> WKT polygon,
        # then passes coordinates to archives_search.
        print(result["messages"][-1].content)


asyncio.run(main())
```

<!-- /example -->

## Conversational Ordering

Walk through the full feasibility → prepare → confirm flow with a multi-message thread:

<!-- example: examples/langchain/python/ordering_workflow.py -->

```python
import asyncio

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

model = ChatOpenAI(model="gpt-4o")


async def ordering_workflow():
    async with MultiServerMCPClient(
        {
            "skyfi": {
                "url": "http://localhost:3000/mcp",
                "transport": "streamable_http",
                "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
            }
        }
    ) as client:
        agent = create_react_agent(model, client.get_tools())

        # Step 1: feasibility
        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Check if it's feasible to task a new SAR capture of the Port of "
                            "Los Angeles next week. Report the available pass windows."
                        ),
                    }
                ]
            }
        )
        print(result["messages"][-1].content)

        # Step 2: prepare - agent presents price, waits for human approval
        result = await agent.ainvoke(
            {
                "messages": result["messages"]
                + [
                    {
                        "role": "user",
                        "content": "Prepare an order for next Monday-Friday. Show me the price before doing anything else.",
                    }
                ]
            }
        )
        print(result["messages"][-1].content)
        # -> "This order would cost $X. Confirm?"

        # Step 3: human approves, agent confirms
        result = await agent.ainvoke(
            {
                "messages": result["messages"]
                + [{"role": "user", "content": "Yes, confirm the order."}]
            }
        )
        print(result["messages"][-1].content)


asyncio.run(ordering_workflow())
```

<!-- /example -->

## AOI Monitoring

Set up an Area of Interest monitor and check for alerts:

<!-- example: examples/langchain/python/aoi_monitoring.py -->

```python
import asyncio

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

model = ChatOpenAI(model="gpt-4o")


async def main():
    async with MultiServerMCPClient(
        {
            "skyfi": {
                "url": "http://localhost:3000/mcp",
                "transport": "streamable_http",
                "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
            }
        }
    ) as client:
        agent = create_react_agent(model, client.get_tools())

        # Create a monitor
        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Set up a monitor for the Panama Canal. "
                            "Send alerts to https://my-webhook.example.com/alerts."
                        ),
                    }
                ]
            }
        )
        print(result["messages"][-1].content)
        # Agent calls: location_resolve -> notifications_create

        # Check for pending alerts
        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": "Any new imagery alerts for my monitors?",
                    }
                ]
            }
        )
        print(result["messages"][-1].content)
        # Agent calls: alerts_list -> reports pending notifications


asyncio.run(main())
```

<!-- /example -->

For long linear assets such as pipelines, let the agent chunk the route first and then run feasibility over the returned chunks:

```python
result = await agent.ainvoke(
    {
        "messages": [
            {
                "role": "user",
                "content": (
                    "This oil pipeline is too long for one AOI polygon. Chunk the route "
                    "into a 1 km wide corridor with 20 km maximum chunk length, then "
                    "run feasibility next week."
                ),
            }
        ]
    }
)
# Agent calls corridor_chunk -> feasibility_submit -> feasibility_status
```

Webhook payloads are delivered to your endpoint when new imagery appears over a monitored AOI.

## LangChain (without LangGraph)

If you prefer plain LangChain without the graph framework:

<!-- example: examples/langchain/python/langchain_agent.py -->

```python
import asyncio

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI

model = ChatOpenAI(model="gpt-4o")

prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "You are a satellite imagery assistant."),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ]
)


async def main():
    async with MultiServerMCPClient(
        {
            "skyfi": {
                "url": "http://localhost:3000/mcp",
                "transport": "streamable_http",
                "headers": {
                    "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
                },
            }
        }
    ) as client:
        tools = client.get_tools()
        agent = create_tool_calling_agent(model, tools, prompt)
        executor = AgentExecutor(agent=agent, tools=tools)

        result = await executor.ainvoke(
            {"input": "What pricing options does SkyFi offer?"}
        )
        print(result["output"])


asyncio.run(main())
```

<!-- /example -->

## Deployed Server

For a Cloudflare Workers deployment, change the URL:

```python
"skyfi": {
    "url": "https://skyfi-mcp.ian-zepp.workers.dev/mcp",
    "transport": "streamable_http",
    "headers": {
        "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
    },
}
```

## Notes

- The adapter converts MCP tools to LangChain `BaseTool` instances automatically
- Tool schemas (Zod on the server) are translated to JSON Schema for the LLM
- Orders require two-step confirmation — the agent will call `orders_prepare` first, present pricing, and only call `orders_confirm` after human approval
- `location_resolve` uses the OpenStreetMap Nominatim API to convert place names to WKT polygons
- For LangSmith tracing, set `LANGCHAIN_API_KEY` and `LANGCHAIN_TRACING_V2=true` in your environment

## Keeping Examples Honest

Run `bun run docs:verify` to ensure the marked snippets in this guide still match the checked-in files under `examples/`, and to syntax-check those example files.
