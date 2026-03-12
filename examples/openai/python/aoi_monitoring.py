from openai import OpenAI

client = OpenAI()

mcp_tool = {
    "type": "mcp",
    "server_label": "skyfi",
    "server_url": "https://skyfi-mcp.your-account.workers.dev/mcp",
    "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
}

# Create a monitor
r = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    input=(
        "Set up a monitor for the Strait of Hormuz. "
        "Send alerts to https://my-webhook.example.com/alerts when new imagery arrives."
    ),
)
print(r.output_text)
# Agent calls: location_resolve -> notifications_create

# Check for pending alerts
r = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    input="Any new imagery alerts for my monitors?",
)
print(r.output_text)
# Agent calls: alerts_list -> reports pending notifications
