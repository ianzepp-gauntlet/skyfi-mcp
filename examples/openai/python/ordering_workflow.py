from openai import OpenAI

client = OpenAI()

mcp_tool = {
    "type": "mcp",
    "server_label": "skyfi",
    "server_url": "https://skyfi-mcp.your-account.workers.dev/mcp",
    "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
}

# Step 1: feasibility check
r1 = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    input="Check if it's feasible to task a new SAR capture of the Port of Rotterdam next week.",
)
print(r1.output_text)
# -> Reports available pass windows

# Step 2: prepare - model presents price, waits for human approval
r2 = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    previous_response_id=r1.id,
    input="Prepare an order for next Monday through Friday. Show me the price first.",
)
print(r2.output_text)
# -> "This order would cost $X. Confirm?"

# Step 3: human approves, model confirms
r3 = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    previous_response_id=r2.id,
    input="Yes, confirm the order.",
)
print(r3.output_text)
# -> Order placed
