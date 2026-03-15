# SkyFi MCP + Vercel AI SDK

Connect the SkyFi MCP server to a [Vercel AI SDK](https://ai-sdk.dev/) application.

## Prerequisites

- A running SkyFi MCP server (local or deployed)
- Node.js 18+
- AI SDK with MCP support
- [`skyfi-cli`](https://github.com/ianzepp/skyfi-cli) installed (optional, for testing)

```bash
npm install ai @ai-sdk/openai @ai-sdk/mcp
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

## Place Name Resolution

The `location_resolve` tool converts place names to coordinates via OpenStreetMap, so users don't need to supply WKT polygons manually:

```typescript
const { text } = await generateText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 10,
  prompt: "Find satellite imagery near the Eiffel Tower from the last month",
});
// The model calls location_resolve("Eiffel Tower") → WKT polygon,
// then passes those coordinates to archives_search automatically.
```

## Conversational Ordering

Use `generateText` with enough `maxSteps` to support the full feasibility → prepare → confirm flow:

```typescript
import { generateText } from "ai";
import { openai } from "@ai-sdk/openai";
import { createMCPClient } from "@ai-sdk/mcp";

const mcpClient = await createMCPClient({
  transport: {
    type: "streamable-http",
    url: process.env.SKYFI_MCP_URL ?? "http://localhost:3000/mcp",
    headers: { "x-skyfi-api-key": process.env.SKYFI_API_KEY! },
  },
});

const tools = await mcpClient.tools();

// Step 1: feasibility check
const { text: feasibilityReport } = await generateText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 5,
  prompt:
    "Check if it's feasible to task a new SAR capture of the Port of Rotterdam next week. Report the available pass windows.",
});
console.log(feasibilityReport);

// Step 2: prepare order — model returns price for human review
const { text: priceSummary } = await generateText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 5,
  prompt:
    "Prepare an order for a SAR capture of the Port of Rotterdam. Window: next Monday through Friday. Show me the price before doing anything else.",
});
console.log(priceSummary);
// → "The order would cost $X. Shall I confirm?"

// Step 3: human approves, agent confirms
const { text: confirmation } = await generateText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 3,
  prompt: "Yes, confirm the order.",
});
console.log(confirmation);

await mcpClient.close();
```

## AOI Monitoring

Set up an Area of Interest monitor and poll for alerts:

```typescript
// Create a monitor
const { text: monitorResult } = await generateText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 5,
  prompt:
    "Set up an AOI monitor for the Suez Canal. Send alerts to https://my-webhook.example.com/alerts.",
});
console.log(monitorResult);
// Agent calls: location_resolve → notifications_create

// Check for new imagery alerts
const { text: alerts } = await generateText({
  model: openai("gpt-4o"),
  tools,
  maxSteps: 3,
  prompt: "Do I have any new imagery alerts?",
});
console.log(alerts);
// Agent calls: alerts_list → reports pending notifications
```

Webhook payloads are delivered to your endpoint when new imagery appears over a monitored AOI. Each payload includes the monitor ID, AOI, and available image metadata.

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
    url: "https://skyfi-mcp.ian-zepp.workers.dev/mcp",
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
