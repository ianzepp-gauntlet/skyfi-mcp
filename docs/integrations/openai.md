# SkyFi MCP + OpenAI

Connect the SkyFi MCP server to [OpenAI](https://platform.openai.com/) via the Responses API's MCP tool support.

## Prerequisites

- An OpenAI API key
- A deployed SkyFi MCP server with a public URL

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
    "allowed_tools": ["search_imagery", "get_pricing", "resolve_location"],
}
```

## Notes

- OpenAI connects to the MCP server directly — the server must be publicly accessible over HTTPS
- The Responses API handles MCP session management, tool discovery, and tool calling automatically
- The server runs in stateless mode on Cloudflare Workers, which is compatible with OpenAI's connection model
- Orders require two-step confirmation (prepare then confirm) to ensure human approval
- For local development, expose your server via a tunnel (e.g. `ngrok http 3000`)
