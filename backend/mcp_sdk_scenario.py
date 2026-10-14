"""Exercise the HTTP protocol with the official, model-independent MCP client."""
import httpx
from fastapi import FastAPI
from mcp import ClientSession
from mcp.client.streamable_http import streamable_http_client
from app.api.routers.mcp import router


async def exercise_sdk(key, project_id):
    app = FastAPI()
    app.include_router(router)
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), headers={'X-MCP-API-Key': key}) as client:
      async with streamable_http_client('http://treseko.test/mcp', http_client=client) as (read, write, _):
        async with ClientSession(read, write) as session:
            initialized = await session.initialize()
            assert initialized.serverInfo.name == 'treseko-mcp'
            tools = await session.list_tools()
            assert len(tools.tools) == 56
            resources = await session.list_resources()
            assert str(resources.resources[0].uri) == 'treseko://mcp/guide'
            guide = await session.read_resource('treseko://mcp/guide')
            assert 'idempotency_key' in guide.contents[0].text
            await session.send_ping()
            result = await session.call_tool('treseko.projects.get', {'project_id': project_id})
            assert result.isError is False
            assert project_id in result.content[0].text
