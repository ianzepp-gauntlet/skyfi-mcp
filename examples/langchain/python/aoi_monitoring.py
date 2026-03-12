import asyncio

from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI
from langgraph.prebuilt import create_react_agent

model = ChatOpenAI(model="gpt-4o")


async def main():
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

        # Create a monitor
        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": (
                            "Set up a monitor for the Panama Canal. "
                            "Send alerts to https://my-webhook.example.com/alerts."
                        ),
                    }
                ]
            }
        )
        print(result["messages"][-1].content)
        # Agent calls: location_resolve -> notifications_create

        # Check for pending alerts
        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": "Any new imagery alerts for my monitors?",
                    }
                ]
            }
        )
        print(result["messages"][-1].content)
        # Agent calls: alerts_list -> reports pending notifications


asyncio.run(main())
