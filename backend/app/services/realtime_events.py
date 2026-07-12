import asyncio
from collections import defaultdict, deque
from datetime import date, datetime, timezone
from enum import Enum
from typing import Any
from uuid import UUID, uuid4

from fastapi import WebSocket
from starlette.websockets import WebSocketState

from ..time_utils import utc_now


class RealtimeEventBus:
    def __init__(self):
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)
        self._recent_events: dict[str, deque[dict[str, Any]]] = defaultdict(lambda: deque(maxlen=50))
        self._lock = asyncio.Lock()

    async def connect(self, project_id: UUID | str, websocket: WebSocket):
        project_key = str(project_id)
        if websocket.application_state == WebSocketState.CONNECTING:
            await websocket.accept()
        async with self._lock:
            self._connections[project_key].add(websocket)

    async def disconnect(self, project_id: UUID | str, websocket: WebSocket):
        project_key = str(project_id)
        async with self._lock:
            connections = self._connections.get(project_key)
            if not connections:
                return
            connections.discard(websocket)
            if not connections:
                self._connections.pop(project_key, None)

    async def publish(
        self,
        project_id: UUID | str | None,
        event_type: str,
        *,
        actor_id: UUID | str | None = None,
        component_id: UUID | str | None = None,
        build_id: UUID | str | None = None,
        suite_id: UUID | str | None = None,
        case_id: UUID | str | None = None,
        run_id: UUID | str | None = None,
        execution_id: UUID | str | None = None,
        bug_id: UUID | str | None = None,
        payload: dict[str, Any] | None = None,
    ):
        if not project_id:
            return
        await self._publish_one(
            project_id,
            event_type,
            actor_id=actor_id,
            component_id=component_id,
            build_id=build_id,
            suite_id=suite_id,
            case_id=case_id,
            run_id=run_id,
            execution_id=execution_id,
            bug_id=bug_id,
            payload=payload,
        )
        if event_type == "report.metrics.invalidated":
            share_payload = {"source": (payload or {}).get("source") or event_type}
            await self._publish_one(
                project_id,
                "report.share.invalidated",
                actor_id=actor_id,
                component_id=component_id,
                build_id=build_id,
                suite_id=suite_id,
                case_id=case_id,
                run_id=run_id,
                execution_id=execution_id,
                bug_id=bug_id,
                payload=share_payload,
            )

    async def _publish_one(
        self,
        project_id: UUID | str,
        event_type: str,
        *,
        actor_id: UUID | str | None = None,
        component_id: UUID | str | None = None,
        build_id: UUID | str | None = None,
        suite_id: UUID | str | None = None,
        case_id: UUID | str | None = None,
        run_id: UUID | str | None = None,
        execution_id: UUID | str | None = None,
        bug_id: UUID | str | None = None,
        payload: dict[str, Any] | None = None,
    ):
        event = self._build_event(
            project_id=project_id,
            event_type=event_type,
            actor_id=actor_id,
            component_id=component_id,
            build_id=build_id,
            suite_id=suite_id,
            case_id=case_id,
            run_id=run_id,
            execution_id=execution_id,
            bug_id=bug_id,
            payload=payload,
        )
        project_key = str(project_id)
        async with self._lock:
            self._recent_events[project_key].append(event)
            connections = list(self._connections.get(project_key, set()))

        if not connections:
            return

        results = await asyncio.gather(
            *(self._send(connection, event) for connection in connections),
            return_exceptions=True,
        )
        stale_connections = [
            connection
            for connection, result in zip(connections, results)
            if result is not None
        ]
        if stale_connections:
            async with self._lock:
                current_connections = self._connections.get(project_key)
                if current_connections:
                    for connection in stale_connections:
                        current_connections.discard(connection)

    async def send_recent(self, project_id: UUID | str, websocket: WebSocket):
        project_key = str(project_id)
        async with self._lock:
            recent_events = list(self._recent_events.get(project_key, []))
        for event in recent_events:
            await self._send(websocket, event)

    def _build_event(
        self,
        *,
        project_id: UUID | str,
        event_type: str,
        actor_id: UUID | str | None,
        component_id: UUID | str | None,
        build_id: UUID | str | None,
        suite_id: UUID | str | None,
        case_id: UUID | str | None,
        run_id: UUID | str | None,
        execution_id: UUID | str | None,
        bug_id: UUID | str | None,
        payload: dict[str, Any] | None,
    ):
        return {
            "event_id": str(uuid4()),
            "event_type": event_type,
            "project_id": str(project_id),
            "component_id": self._string_or_none(component_id),
            "build_id": self._string_or_none(build_id),
            "suite_id": self._string_or_none(suite_id),
            "case_id": self._string_or_none(case_id),
            "run_id": self._string_or_none(run_id),
            "execution_id": self._string_or_none(execution_id),
            "bug_id": self._string_or_none(bug_id),
            "actor_id": self._string_or_none(actor_id),
            "timestamp": utc_now().astimezone(timezone.utc).isoformat(),
            "payload": self._sanitize(payload or {}),
        }

    async def _send(self, websocket: WebSocket, event: dict[str, Any]):
        try:
            if websocket.client_state != WebSocketState.CONNECTED:
                return RuntimeError("websocket disconnected")
            await websocket.send_json(event)
            return None
        except Exception as exc:
            return exc

    @staticmethod
    def _string_or_none(value: UUID | str | None):
        return str(value) if value is not None else None

    def _sanitize(self, value: Any):
        if value is None or isinstance(value, (str, int, float, bool)):
            return value
        if isinstance(value, UUID):
            return str(value)
        if isinstance(value, Enum):
            return value.value
        if isinstance(value, (datetime, date)):
            return value.isoformat()
        if isinstance(value, dict):
            return {str(key): self._sanitize(item) for key, item in value.items()}
        if isinstance(value, (list, tuple, set)):
            return [self._sanitize(item) for item in value]
        return str(value)


realtime_event_bus = RealtimeEventBus()
