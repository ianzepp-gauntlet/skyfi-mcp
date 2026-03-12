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
                "headers": {
                    "x-skyfi-api-key": "YOUR_SKYFI_API_KEY",
                },
            }
        }
    ) as client:
        agent = create_react_agent(model, client.get_tools())

        result = await agent.ainvoke(
            {
                "messages": [
                    {
                        "role": "user",
                        "content": "Find satellite imagery of Tokyo from the last month",
                    }
                ]
            }
        )

        for msg in result["messages"]:
            print(msg.content)


asyncio.run(main())
