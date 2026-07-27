import asyncio
from collections import defaultdict, deque
from typing import Any

from starlette.websockets import WebSocket


class AiDryRunStreamManager:
    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._events: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=80))
        self._runs: dict[str, dict[str, str]] = {}
        self._lock = asyncio.Lock()

    async def register(self, run_id: str, project_id: str, callback_token: str) -> None:
        async with self._lock:
            self._runs[run_id] = {"project_id": project_id, "callback_token": callback_token}

    async def run_context(self, run_id: str) -> dict[str, str] | None:
        async with self._lock:
            return self._runs.get(run_id)

    async def connect(self, run_id: str, websocket: WebSocket) -> list[dict[str, Any]]:
        async with self._lock:
            self._connections[run_id].add(websocket)
            return list(self._events.get(run_id, ()))

    async def disconnect(self, run_id: str, websocket: WebSocket) -> None:
        async with self._lock:
            self._connections.get(run_id, set()).discard(websocket)

    async def publish(self, run_id: str, event: dict[str, Any]) -> None:
        async with self._lock:
            self._events[run_id].append(event)
            connections = list(self._connections.get(run_id, ()))
        stale: list[WebSocket] = []
        for connection in connections:
            try:
                await connection.send_json(event)
            except Exception:
                stale.append(connection)
        for connection in stale:
            await self.disconnect(run_id, connection)


ai_dry_run_stream = AiDryRunStreamManager()
