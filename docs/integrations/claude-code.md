# SkyFi MCP + Claude Code

Connect the SkyFi MCP server to [Claude Code](https://docs.anthropic.com/en/docs/claude-code), Anthropic's CLI for Claude.

## Prerequisites

- [Claude Code](https://docs.anthropic.com/en/docs/claude-code) installed
- A running SkyFi MCP server (local or deployed)

## Local Server

Start the SkyFi MCP server:

```bash
export SKYFI_API_KEY=your-key-here
bun run dev
```

Add it to Claude Code:

```bash
claude mcp add skyfi http://localhost:3000/mcp
```

## Deployed Server (Cloudflare Workers)

For a remote deployment with API key authentication:

```bash
claude mcp add skyfi \
  --header "x-skyfi-api-key: YOUR_SKYFI_API_KEY" \
  https://skyfi-mcp.your-account.workers.dev/mcp
```

## Usage

Once connected, SkyFi tools are available in your Claude Code session. Ask naturally:

```
> Search for satellite imagery of downtown Kyiv from the last month

> What pricing tiers does SkyFi offer?

> Check if we can task a new SAR capture of the Port of Shanghai next week

> Set up an AOI monitor for the Panama Canal and notify me at https://my-webhook.example.com
```

## Verify Connection

Check that the MCP server is registered:

```bash
claude mcp list
```

You should see `skyfi` in the output with the configured URL.

## Remove

```bash
claude mcp remove skyfi
```

## Notes

- Claude Code connects via the Streamable HTTP transport
- For local development, the server uses stateful sessions with in-memory session tracking
- For Cloudflare Workers, the server uses stateless mode (no session persistence)
- Orders require explicit confirmation — Claude Code will present the price and ask for your approval before placing any order
