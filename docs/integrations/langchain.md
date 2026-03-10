# SkyFi MCP + LangChain / LangGraph

Connect the SkyFi MCP server to [LangChain](https://python.langchain.com/) or [LangGraph](https://langchain-ai.github.io/langgraph/) agents.

## Prerequisites

- A running SkyFi MCP server (local or deployed)
- Python 3.10+
- `langchain-mcp-adapters` installed

```bash
pip install langchain-mcp-adapters langchain-openai langgraph
```

## Setup

Use `MultiServerMCPClient` to connect to the SkyFi MCP server:

```python
from langchain_mcp_adapters.client import MultiServerMCPClient

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
```

## LangGraph Agent

Create a ReAct agent with the MCP tools:

```python
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

model = ChatOpenAI(model="gpt-4o")

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

    result = await agent.ainvoke({
        "messages": [
            {"role": "user", "content": "Find satellite imagery of Tokyo from the last month"}
        ]
    })

    for msg in result["messages"]:
        print(msg.content)
```

## LangChain (without LangGraph)

If you prefer plain LangChain without the graph framework:

```python
from langchain_openai import ChatOpenAI
from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate

model = ChatOpenAI(model="gpt-4o")

prompt = ChatPromptTemplate.from_messages([
    ("system", "You are a satellite imagery assistant."),
    ("human", "{input}"),
    ("placeholder", "{agent_scratchpad}"),
])

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

    result = await executor.ainvoke({"input": "What pricing options does SkyFi offer?"})
    print(result["output"])
```

## Deployed Server

For a Cloudflare Workers deployment, change the URL:

```python
"skyfi": {
    "url": "https://skyfi-mcp.your-account.workers.dev/mcp",
    "transport": "streamable_http",
    "headers": {
        "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
    },
}
```

## Notes

- The adapter converts MCP tools to LangChain `BaseTool` instances automatically
- Tool schemas (Zod on the server) are translated to JSON Schema for the LLM
- Orders require two-step confirmation — the agent will call `prepare_order` first, present pricing, and only call `confirm_order` after human approval
- For LangSmith tracing, set `LANGCHAIN_API_KEY` and `LANGCHAIN_TRACING_V2=true` in your environment
