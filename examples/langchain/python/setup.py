import asyncio

from langchain_mcp_adapters.client import MultiServerMCPClient


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
        tools = client.get_tools()
        print(tools)


asyncio.run(main())
