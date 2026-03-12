# SkyFi — MCP Server

## Company

SkyFi

## Category

AI Solution

## Role

All Roles

## Problem Statement

As AI systems become more autonomous, they will encompass a larger share of purchasing decisions. This trend — already visible in software development (Supabase, Vercel, Fly.io) and research (Firecrawl, Exa, Tavily) — will spread to other verticals as agents are deployed more broadly.

SkyFi needs a Model Context Protocol (MCP) server that exposes its satellite imagery platform to AI agents, enabling conversational ordering, search, and monitoring.

## Functional Requirements

### 1. Remote MCP Server

- Fully deployed remote MCP server built on [Cloudflare Agents](https://developers.cloudflare.com/agents/model-context-protocol/)
- Built on the [SkyFi public API](https://app.skyfi.com/platform-api/redoc)
- Stateless HTTP + SSE transport ([reference](https://blog.christianposta.com/ai/understanding-mcp-recent-change-around-http-sse/))
- Ability to host the server locally as well

### 2. Conversational Image Ordering

- User can conversationally place a SkyFi image order
- Must confirm price with user and **require human confirmation** before placing an order
- Must check feasibility and report results to user before placing an order

### 3. Data Exploration

- Browse available data on SkyFi through iterative search
- Explore previous orders and fetch previously ordered images
- Explore feasibility of a task conversationally
- Explore different pricing options conversationally

### 4. AOI Monitoring & Notifications

- Conversationally set up Area of Interest (AOI) monitoring and notifications
- Integrated with webhooks so an agent can inform the user when their AOI has new images
- Think: an item in ChatGPT Pulse informing the user of new available imagery

### 5. Authentication & Payments

- Authentication and payments support within the MCP
- Support for **local use** with credentials in stored JSON config
- Support for **cloud deployment** with credentials sent in headers for multi-user access

### 6. OpenStreetMaps Integration

- OpenStreetMaps integration with exposed tools

### 7. Documentation

Comprehensive documentation on how to use the MCP with:

- [ADK (Google)](https://google.github.io/adk-docs/tools/mcp-tools/)
- [LangChain / LangGraph](https://langchain-ai.github.io/langgraph/agents/mcp/)
- [AI SDK (Vercel)](https://ai-sdk.dev/cookbook/node/mcp-tools)
- [Claude Web (Anthropic)](https://support.anthropic.com/en/articles/11175166-getting-started-with-custom-integrations-using-remote-mcp)
- [OpenAI](https://platform.openai.com/docs/guides/tools-remote-mcp)
- [Anthropic Claude Code](https://docs.anthropic.com/en/docs/claude-code/mcp)
- [Gemini](https://ai.google.dev/gemini-api/docs/function-calling?example=meeting#mcp)

### 8. Demo Agent

- A demo agent using this MCP for **geospatial-supported deep research**
- Polished and ready to be open-sourced

## Required Languages

- Python preferred (no hard requirement)

## Technical Contact

Yes
