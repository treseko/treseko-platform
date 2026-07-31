from .updater import *
from .updater import _utc_iso

def _update_state(self, state: UpdateTaskState, stage: str, progress: int, message: str) -> None:
    state.stage = stage
    state.progress_pct = progress
    state.message = message
    self._append_event(state, stage, message=message, details={"progress_pct": progress}, persist=False)
    self._persist_history()

def _append_event(
    self,
    state: UpdateTaskState,
    event: str,
    *,
    message: str | None = None,
    actor_email: str | None = None,
    actor_user_id: str | None = None,
    ip_address: str | None = None,
    details: dict[str, Any] | None = None,
    persist: bool = True,
) -> None:
    events = list(state.events or [])
    payload: dict[str, Any] = {
        "at": _utc_iso(),
        "event": str(event),
        "stage": state.stage,
        "status": state.status,
    }
    if message:
        payload["message"] = message
    actor_email = actor_email or state.initiated_by_email
    actor_user_id = actor_user_id or state.initiated_by_user_id
    ip_address = ip_address or state.initiated_from_ip
    if actor_email:
        payload["actor_email"] = actor_email
    if actor_user_id:
        payload["actor_user_id"] = actor_user_id
    if ip_address:
        payload["ip_address"] = ip_address
    if details:
        payload["details"] = details
    events.append(payload)
    state.events = events[-80:]
    if persist:
        self._persist_history()

def _load_history(self) -> None:
    applied_task_id = self._read_applied_update_task_id()
    history_file = self.settings.history_file
    if not history_file.exists():
        return
    try:
        payload = json.loads(history_file.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return
    allowed = set(UpdateTaskState.__dataclass_fields__)
    changed = False
    for item in payload.get("tasks", []):
        if not isinstance(item, dict):
            continue
        data = {key: value for key, value in item.items() if key in allowed}
        task_id = str(data.get("task_id") or "").strip()
        if not task_id:
            continue
        try:
            state = UpdateTaskState(**data)
        except TypeError:
            continue
        if state.task_id == applied_task_id and state.status in {"queued", "in_progress", "restarting", "done"}:
            state.status = "done"
            state.stage = "applied"
            state.progress_pct = 100
            state.error = None
            state.message = "Actualizacion aplicada y migraciones finalizadas tras el reinicio."
            state.completed_at = state.completed_at or _utc_iso()
            self._append_event(state, "applied", message=state.message, persist=False)
            changed = True
        elif state.status in {"queued", "in_progress", "restarting"}:
            state.status = "failed"
            state.stage = "interrupted"
            state.progress_pct = min(state.progress_pct, 99)
            state.error = "El proceso se reinicio antes de terminar la tarea de update."
            state.message = "La tarea quedo interrumpida por reinicio del proceso."
            state.completed_at = state.completed_at or _utc_iso()
            changed = True
        self._tasks[task_id] = state
    if self._tasks:
        latest = max(
            self._tasks.values(),
            key=lambda item: item.started_at or item.completed_at or "",
        )
        self._latest_task_id = latest.task_id
    if changed:
        self._persist_history()

def _read_applied_update_task_id(self) -> str:
    marker = self.settings.updates_dir / "update-applied"
    if not marker.exists():
        return ""
    try:
        payload = json.loads(marker.read_text(encoding="utf-8"))
        return str(payload.get("task_id") or "").strip() if isinstance(payload, dict) else ""
    except (OSError, json.JSONDecodeError):
        return ""

def _persist_history(self) -> None:
    history_file = self.settings.history_file
    history_file.parent.mkdir(parents=True, exist_ok=True)
    tasks = sorted(
        self._tasks.values(),
        key=lambda item: item.started_at or item.completed_at or "",
        reverse=True,
    )
    max_items = max(20, self.settings.max_backups * 20)
    payload = {
        "updated_at": _utc_iso(),
        "tasks": [task.as_dict() for task in tasks[:max_items]],
    }
    tmp_file = history_file.with_name(f"{history_file.name}.{uuid.uuid4().hex}.tmp")
    tmp_file.write_text(json.dumps(payload, indent=2, sort_keys=True), encoding="utf-8")
    tmp_file.replace(history_file)
    self._schedule_db_history_persist(payload["tasks"])

def _schedule_db_history_persist(self, tasks_snapshot: list[dict[str, Any]]) -> None:
    if not UPDATE_DB_HISTORY_ENABLED:
        return
    try:
        loop = asyncio.get_running_loop()
    except RuntimeError:
        return
    if self._db_history_task and not self._db_history_task.done():
        self._db_history_dirty = True
        return
    snapshot = copy.deepcopy(tasks_snapshot)
    self._db_history_dirty = False
    self._db_history_task = loop.create_task(self._persist_db_history_snapshot(snapshot))

    def _reschedule_if_dirty(task: asyncio.Task[None]) -> None:
        if task.cancelled():
            return
        try:
            task.result()
        except Exception as exc:  # pragma: no cover - best effort background mirror
            logger.debug("No se pudo persistir historial de updates en DB: %s", exc)
        if self._db_history_dirty:
            latest = sorted(
                self._tasks.values(),
                key=lambda item: item.started_at or item.completed_at or "",
                reverse=True,
            )
            self._schedule_db_history_persist([task_state.as_dict() for task_state in latest])

    self._db_history_task.add_done_callback(_reschedule_if_dirty)

async def _persist_db_history_snapshot(self, tasks_snapshot: list[dict[str, Any]]) -> None:
    if not tasks_snapshot:
        return
    from sqlalchemy import delete, select
    from ..database import AsyncSessionLocal
    from .. import models

    async with AsyncSessionLocal() as session:
        for task_payload in tasks_snapshot:
            task_id = str(task_payload.get("task_id") or "").strip()
            if not task_id:
                continue
            result = await session.execute(
                select(models.SystemUpdateTask).where(models.SystemUpdateTask.task_id == task_id)
            )
            row = result.scalar_one_or_none()
            if row is None:
                row = models.SystemUpdateTask(task_id=task_id)
                session.add(row)
            self._copy_task_payload_to_db_row(row, task_payload)
            await session.flush()
            await session.execute(
                delete(models.SystemUpdateEvent).where(models.SystemUpdateEvent.task_id == task_id)
            )
            for event_index, event_payload in enumerate(task_payload.get("events") or []):
                if not isinstance(event_payload, dict):
                    continue
                session.add(self._event_row_from_payload(task_id, event_index, event_payload))
        await session.commit()

@staticmethod
def _parse_iso_datetime(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        return datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None

@staticmethod
def _parse_uuid(value: Any) -> uuid.UUID | None:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except (TypeError, ValueError):
        return None

def _copy_task_payload_to_db_row(self, row: Any, payload: dict[str, Any]) -> None:
    row.status = str(payload.get("status") or "idle")
    row.channel = str(payload.get("channel") or "")
    row.version = payload.get("version")
    row.previous_version = payload.get("previous_version")
    row.stage = payload.get("stage")
    row.progress_pct = int(payload.get("progress_pct") or 0)
    row.message = payload.get("message")
    row.error = payload.get("error")
    row.initiated_by_user_id = self._parse_uuid(payload.get("initiated_by_user_id"))
    row.initiated_by_email = payload.get("initiated_by_email")
    row.initiated_from_ip = payload.get("initiated_from_ip")
    row.apply_confirmation = payload.get("apply_confirmation")
    row.rollback_by_user_id = self._parse_uuid(payload.get("rollback_by_user_id"))
    row.rollback_by_email = payload.get("rollback_by_email")
    row.rollback_from_ip = payload.get("rollback_from_ip")
    row.rollback_requested_at = self._parse_iso_datetime(payload.get("rollback_requested_at"))
    row.rollback_confirmation = payload.get("rollback_confirmation")
    row.rollback_restore_database = bool(payload.get("rollback_restore_database"))
    row.backup_path = payload.get("backup_path")
    row.rollback_path = payload.get("rollback_path")
    row.package_path = payload.get("package_path")
    row.extracted_path = payload.get("extracted_path")
    row.started_at = self._parse_iso_datetime(payload.get("started_at"))
    row.completed_at = self._parse_iso_datetime(payload.get("completed_at"))
    row.payload = payload

def _event_row_from_payload(self, task_id: str, event_index: int, payload: dict[str, Any]) -> Any:
    from .. import models

    return models.SystemUpdateEvent(
        task_id=task_id,
        event_index=event_index,
        event=str(payload.get("event") or ""),
        stage=payload.get("stage"),
        status=payload.get("status"),
        actor_user_id=self._parse_uuid(payload.get("actor_user_id")),
        actor_email=payload.get("actor_email"),
        ip_address=payload.get("ip_address"),
        message=payload.get("message"),
        details=payload.get("details") if isinstance(payload.get("details"), dict) else {},
        occurred_at=self._parse_iso_datetime(payload.get("at")),
        payload=payload,
    )
