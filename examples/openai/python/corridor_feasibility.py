from openai import OpenAI

client = OpenAI()

mcp_tool = {
    "type": "mcp",
    "server_label": "skyfi",
    "server_url": "https://skyfi-mcp.ian-zepp.workers.dev/mcp",
    "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
}

# Step 1: generate chunk polygons for a long linear asset such as a pipeline.
chunking = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    input=(
        "I manage an oil pipeline. Chunk this pipeline route into 1 km wide corridor "
        "polygons with 20 km maximum chunk length, then show me the chunks before "
        "running feasibility. Route points: "
        "[(29.7604, -95.3698), (29.8500, -95.1000), (29.9200, -94.8200)]."
    ),
)
print(chunking.output_text)
# -> Agent calls corridor_chunk and summarizes the returned chunks.

# Step 2: run feasibility across the returned chunks.
feasibility = client.responses.create(
    model="gpt-4o",
    tools=[mcp_tool],
    previous_response_id=chunking.id,
    input=(
        "Now run feasibility on those chunks for a DAY product next week at "
        "VERY_HIGH resolution and summarize which segments have opportunities."
    ),
)
print(feasibility.output_text)
# -> Agent calls feasibility_check_chunks and reports per-chunk feasibility.
