import asyncio

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

model = ChatOpenAI(model="gpt-4o")


async def ordering_workflow():
    async with MultiServerMCPClient(
        {
            "skyfi": {
                "url": "http://localhost:3000/mcp",
                "transport": "streamable_http",
                "headers": {"x-skyfi-api-key": "YOUR_SKYFI_API_KEY"},
            }
        }
    ) as client:
        agent = create_react_agent(model, client.get_tools())

        # Step 1: feasibility
        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Check if it's feasible to task a new SAR capture of the Port of "
                            "Los Angeles next week. Report the available pass windows."
                        ),
                    }
                ]
            }
        )
        print(result["messages"][-1].content)

        # Step 2: prepare - agent presents price, waits for human approval
        result = await agent.ainvoke(
            {
                "messages": result["messages"]
                + [
                    {
                        "role": "user",
                        "content": "Prepare an order for next Monday-Friday. Show me the price before doing anything else.",
                    }
                ]
            }
        )
        print(result["messages"][-1].content)
        # -> "This order would cost $X. Confirm?"

        # Step 3: human approves, agent confirms
        result = await agent.ainvoke(
            {
                "messages": result["messages"]
                + [{"role": "user", "content": "Yes, confirm the order."}]
            }
        )
        print(result["messages"][-1].content)


asyncio.run(ordering_workflow())
