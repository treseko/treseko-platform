"""Read-only bug loading and display-label preparation for report snapshots."""

from __future__ import annotations

from copy import deepcopy
from datetime import datetime
from typing import Any

from sqlalchemy import select

from .. import models


async def list_project_bugs(db: Any, proyecto_id: Any, **filters: Any) -> Any:
    """Resolve the existing bug repository only when a page is requested."""
    from .bug_issue_management import list_project_bugs as repository_list_project_bugs

    return await repository_list_project_bugs(db, proyecto_id, **filters)


def _text(value: Any) -> str:
    return str(value).strip() if value not in (None, "") else ""


def _iso(value: Any) -> str | None:
    if not value:
        return None
    if isinstance(value, datetime):
        return value.isoformat()
    return _text(value) or None


async def list_all_project_bugs(db: Any, proyecto_id: Any, **filters: Any) -> list[Any]:
    """Load every project bug through the repository's 50-item pages."""
    page_size = 50
    skip = 0
    result_items: list[Any] = []
    seen_ids: set[str] = set()
    total: int | None = None
    while True:
        page_result = await list_project_bugs(db, proyecto_id, **dict(filters), skip=skip, limit=page_size)
        page = page_result.get("items") if isinstance(page_result, dict) else page_result
        page = list(page or [])
        if total is None and isinstance(page_result, dict):
            try:
                total = max(int(page_result.get("total")), 0)
            except (TypeError, ValueError):
                total = None
        for item in page:
            item_id = _text(getattr(item, "id", None))
            if item_id and item_id in seen_ids:
                continue
            if item_id:
                seen_ids.add(item_id)
            result_items.append(item)
        if not page or (total is not None and skip + len(page) >= total) or len(page) < page_size:
            return result_items
        skip += len(page)


def freeze_development_bug_labels(snapshots: list[dict[str, Any]], bugs: list[Any]) -> list[dict[str, Any]]:
    """Add relationship-backed display names to fresh, report-local copies."""
    by_id = {_text(getattr(bug, "id", None)): bug for bug in bugs if _text(getattr(bug, "id", None))}
    result = [deepcopy(item) for item in snapshots]
    for snapshot in result:
        bug = by_id.get(_text(snapshot.get("id")))
        origin = getattr(bug, "build", None) if bug else None
        resolved = getattr(bug, "resolved_build", None) if bug else None
        if not snapshot.get("origin_build_name") and origin:
            snapshot["origin_build_name"] = getattr(origin, "nombre", None)
        if origin:
            snapshot.setdefault("origin_build_code", getattr(origin, "codigo", None))
            if not snapshot.get("origin_build_created_at"):
                snapshot["origin_build_created_at"] = _iso(getattr(origin, "fecha_creacion", None))
            if not snapshot.get("origin_build_started_at"):
                snapshot["origin_build_started_at"] = _iso(getattr(origin, "fecha_inicio", None))
            if not snapshot.get("origin_build_finished_at"):
                snapshot["origin_build_finished_at"] = _iso(getattr(origin, "fecha_fin", None))
        if not snapshot.get("resolved_build_name") and resolved:
            snapshot["resolved_build_name"] = getattr(resolved, "nombre", None)
            snapshot["build_corregido"] = getattr(resolved, "nombre", None)
    return result


async def load_and_freeze_development_bug_labels(
    db: Any,
    snapshots: list[dict[str, Any]],
    bugs: list[Any],
    proyecto_id: Any,
) -> list[dict[str, Any]]:
    """Batch-load optional labels within the already scoped project."""
    result = freeze_development_bug_labels(snapshots, bugs)
    bug_by_id = {_text(getattr(bug, "id", None)): bug for bug in bugs if _text(getattr(bug, "id", None))}
    assignee_ids = {getattr(bug, "asignado_a", None) for bug in bugs if getattr(bug, "asignado_a", None)}
    dataset_ids = {getattr(bug, "dataset_id", None) for bug in bugs if getattr(bug, "dataset_id", None)}
    environment_ids = {getattr(bug, "entorno_id", None) for bug in bugs if getattr(bug, "entorno_id", None)}

    users: dict[str, str] = {}
    if assignee_ids:
        rows = await db.execute(select(models.Usuario).where(models.Usuario.id.in_(assignee_ids)))
        users = {
            _text(user.id): _text(getattr(user, "display_name", None) or user.nombre_completo or user.email)
            for user in rows.scalars().all()
        }
    environments: dict[str, str] = {}
    if environment_ids:
        rows = await db.execute(
            select(models.Entorno.id, models.Entorno.nombre).where(
                models.Entorno.proyecto_id == proyecto_id,
                models.Entorno.id.in_(environment_ids),
            )
        )
        environments = {_text(row[0]): row[1] for row in rows.all() if row[1]}
    datasets: dict[str, tuple[str, str | None]] = {}
    if dataset_ids:
        rows = await db.execute(
            select(models.EntornoDataset.id, models.EntornoDataset.nombre, models.Entorno.nombre)
            .join(models.Entorno, models.Entorno.id == models.EntornoDataset.entorno_id)
            .where(
                models.Entorno.proyecto_id == proyecto_id,
                models.EntornoDataset.id.in_(dataset_ids),
            )
        )
        datasets = {
            _text(row[0]): (row[1], row[2])
            for row in rows.all()
            if row[1]
        }
    for snapshot in result:
        bug = bug_by_id.get(_text(snapshot.get("id")))
        if not bug:
            continue
        assignee_name = users.get(_text(getattr(bug, "asignado_a", None)))
        if assignee_name and not snapshot.get("responsable"):
            snapshot["responsable"] = assignee_name
        dataset = datasets.get(_text(getattr(bug, "dataset_id", None)))
        if dataset:
            if not snapshot.get("dataset_name"):
                snapshot["dataset_name"] = dataset[0]
            if dataset[1] and not snapshot.get("environment_name"):
                snapshot["environment_name"] = dataset[1]
        environment_name = environments.get(_text(getattr(bug, "entorno_id", None)))
        if environment_name and not snapshot.get("environment_name"):
            snapshot["environment_name"] = environment_name
    return result


__all__ = [
    "list_all_project_bugs",
    "freeze_development_bug_labels",
    "load_and_freeze_development_bug_labels",
]
