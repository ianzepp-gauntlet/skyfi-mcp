import OpenAI from "openai";

const client = new OpenAI();

const response = await client.responses.create({
  model: "gpt-4o",
  tools: [
    {
      type: "mcp",
      server_label: "skyfi",
      server_url:
        process.env.SKYFI_MCP_URL ??
        "https://skyfi-mcp.your-account.workers.dev/mcp",
      headers: {
        "x-skyfi-api-key": process.env.SKYFI_API_KEY!,
      },
    },
  ],
  input: "Search for recent satellite imagery of downtown Tokyo",
});

console.log(response.output_text);
