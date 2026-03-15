from openai import OpenAI

client = OpenAI()

response = client.responses.create(
    model="gpt-4o",
    tools=[
        {
            "type": "mcp",
            "server_label": "skyfi",
            "server_url": "https://skyfi-mcp.ian-zepp.workers.dev/mcp",
            "headers": {
                "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
            },
        }
    ],
    input="What are the pricing options for satellite imagery?",
)

print(response.output_text)
