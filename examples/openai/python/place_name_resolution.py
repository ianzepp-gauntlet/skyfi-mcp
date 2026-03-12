from openai import OpenAI

client = OpenAI()

response = client.responses.create(
    model="gpt-4o",
    tools=[
        {
            "type": "mcp",
            "server_label": "skyfi",
            "server_url": "https://skyfi-mcp.your-account.workers.dev/mcp",
            "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
        }
    ],
    input="Find recent satellite imagery near the Pyramids of Giza",
)

# The model calls location_resolve("Pyramids of Giza") -> WKT polygon,
# then passes coordinates to archives_search automatically.
print(response.output_text)
