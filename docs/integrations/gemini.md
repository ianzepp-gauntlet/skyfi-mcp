# SkyFi MCP + Google Gemini

Connect the SkyFi MCP server to the [Gemini API](https://ai.google.dev/gemini-api) using its MCP tool support.

## Prerequisites

- A Google AI API key
- A deployed SkyFi MCP server with a public URL

## Gemini API (MCP Tool Type)

The Gemini API supports MCP servers as a tool type in function calling:

```python
from google import genai

client = genai.Client()

skyfi_tool = genai.types.Tool(
    mcp=genai.types.McpTool(
        server_url="https://skyfi-mcp.your-account.workers.dev/mcp",
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

## Multi-Turn Conversation

For interactive sessions with tool use across multiple turns:

```python
from google import genai

client = genai.Client()

skyfi_tool = genai.types.Tool(
    mcp=genai.types.McpTool(
        server_url="https://skyfi-mcp.your-account.workers.dev/mcp",
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

# First turn: search
response = chat.send_message("Find imagery of downtown Seattle from last week")
print(response.text)

# Follow-up: pricing
response = chat.send_message("What would that cost?")
print(response.text)
```

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
          "serverUrl": "https://skyfi-mcp.your-account.workers.dev/mcp",
          "headers": {
            "x-skyfi-api-key": "YOUR_SKYFI_API_KEY"
          }
        }
      }
    ]
  }'
```

## Notes

- Gemini connects to the MCP server directly — the server must be publicly accessible over HTTPS
- The API handles tool discovery, session management, and multi-step tool calling automatically
- The SkyFi MCP server runs in stateless mode on Cloudflare Workers, compatible with Gemini's connection model
- Orders use a two-step confirmation flow (prepare then confirm) for safety
- For local development, expose your server via a tunnel (e.g. `ngrok http 3000`)
