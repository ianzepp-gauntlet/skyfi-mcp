import asyncio

from langchain.agents import AgentExecutor, create_tool_calling_agent
from langchain_core.prompts import ChatPromptTemplate
from langchain_mcp_adapters.client import MultiServerMCPClient
from langchain_openai import ChatOpenAI

model = ChatOpenAI(model="gpt-4o")

prompt = ChatPromptTemplate.from_messages(
    [
        ("system", "You are a satellite imagery assistant."),
        ("human", "{input}"),
        ("placeholder", "{agent_scratchpad}"),
    ]
)


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
        agent = create_tool_calling_agent(model, tools, prompt)
        executor = AgentExecutor(agent=agent, tools=tools)

        result = await executor.ainvoke(
            {"input": "What pricing options does SkyFi offer?"}
        )
        print(result["output"])


asyncio.run(main())
