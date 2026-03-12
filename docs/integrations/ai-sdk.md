# SkyFi MCP + Vercel AI SDK

Connect the SkyFi MCP server to a [Vercel AI SDK](https://ai-sdk.dev/) application.

## Prerequisites

- A running SkyFi MCP server (local or deployed)
- Node.js 18+
- AI SDK with MCP support

```bash
npm install ai @ai-sdk/openai @ai-sdk/mcp
```

## Setup

Use `createMCPClient` to connect to the SkyFi MCP server:

```typescript
import { createMCPClient } from "@ai-sdk/mcp";

const mcpClient = await createMCPClient({
  transport: {
    type: "streamable-http",
    url: "http://localhost:3000/mcp",
    headers: {
      "x-skyfi-api-key": process.env.SKYFI_API_KEY!,
    },
  },
});

const tools = await mcpClient.tools();
```

## Generate Text with Tools

```typescript
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";

const { text } = await generateText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 10,
  prompt:
    "Search for satellite imagery of the Golden Gate Bridge from the last week",
});

console.log(text);
```

## Streaming with Tools

```typescript
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";

const result = streamText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 10,
  prompt: "What are the pricing options for satellite imagery?",
});

for await (const chunk of result.textStream) {
  process.stdout.write(chunk);
}
```

## Next.js Route Handler

```typescript
// app/api/chat/route.ts
import { streamText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createMCPClient } from "@ai-sdk/mcp";

export async function POST(req: Request) {
  const { messages } = await req.json();

  const mcpClient = await createMCPClient({
    transport: {
      type: "streamable-http",
      url: process.env.SKYFI_MCP_URL ?? "http://localhost:3000/mcp",
      headers: {
        "x-skyfi-api-key": process.env.SKYFI_API_KEY!,
      },
    },
  });

  const result = streamText({
    model: openai("gpt-4o"),
    tools: await mcpClient.tools(),
    maxSteps: 10,
    messages,
  });

  return result.toDataStreamResponse();
}
```

## Deployed Server

For a Cloudflare Workers deployment:

```typescript
const mcpClient = await createMCPClient({
  transport: {
    type: "streamable-http",
    url: "https://skyfi-mcp.your-account.workers.dev/mcp",
    headers: {
      "x-skyfi-api-key": process.env.SKYFI_API_KEY!,
    },
  },
});
```

## Notes

- AI SDK converts MCP tool schemas to its internal tool format automatically
- `maxSteps` controls how many tool call rounds the model can make — set higher for multi-step workflows like ordering
- Orders require two-step confirmation (prepare then confirm) to ensure human approval before purchase
- Close the MCP client when done: `await mcpClient.close()`
