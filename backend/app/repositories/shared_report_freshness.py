from .repository_context import *
from .project_metrics import get_project_metrics
from .report_bug_loading import list_all_project_bugs
from .report_bug_payloads import _report_bugs_digest
from .report_fingerprints import (
    REPORT_SNAPSHOT_BUNDLE_VERSION,
    _legacy_report_metrics_fingerprint,
    _report_bundle_fingerprint,
    _report_metrics_fingerprint,
    normalize_project_report_settings,
)
from .report_snapshot_payloads import _shared_report_group_id, _shared_report_metadata, _shared_report_type
from .shared_report_operations import _shared_report_branding
from . import shared_report_operations as _report_operations


async def _current_shared_report_bundle_hash(
    db: AsyncSession,
    proyecto_id: UUID,
    build_id: Optional[UUID],
    componente_id: Optional[UUID],
    *,
    metrics: Optional[Dict[str, Any]] = None,
) -> str:
    metrics = metrics if metrics is not None else await _report_operations.get_project_metrics(db, proyecto_id, build_id)
    project = (await db.execute(select(models.Proyecto).filter(models.Proyecto.id == proyecto_id))).scalar_one_or_none()
    report_settings = normalize_project_report_settings((project.report_settings if project else {}) or {})
    bug_items = await list_all_project_bugs(db, proyecto_id)
    if componente_id:
        bug_items = [bug for bug in bug_items if not bug.componente_id or bug.componente_id == componente_id]
    branding = await _shared_report_branding(db)
    return _report_bundle_fingerprint(metrics, _report_bugs_digest(bug_items), report_settings, branding)

async def shared_report_has_new_values(
    db: AsyncSession,
    snapshot: models.SharedReportSnapshot,
    *,
    metrics: Optional[Dict[str, Any]] = None,
    current_hash: Optional[str] = None,
) -> bool:
    # Reuse request-scoped calculations while keeping frozen snapshots immutable.
    metrics = metrics if metrics is not None else await _report_operations.get_project_metrics(db, snapshot.proyecto_id, snapshot.build_id)
    payload = snapshot.payload or {}
    metadata = payload.get("metadata") or {}
    if metadata.get("snapshot_bundle_version") and metadata.get("snapshot_bundle_version") != REPORT_SNAPSHOT_BUNDLE_VERSION:
        return True
    if metadata.get("snapshot_bundle_version") == REPORT_SNAPSHOT_BUNDLE_VERSION:
        current_hash = current_hash if current_hash is not None else await _report_operations._current_shared_report_bundle_hash(db, snapshot.proyecto_id, snapshot.build_id, snapshot.componente_id, metrics=metrics)
        # metrics_hash is the canonical fingerprint used when this immutable
        # snapshot was created; hashing its large frozen JSON again is redundant.
        if current_hash == snapshot.metrics_hash:
            return False
        latest = await _report_operations.get_latest_equivalent_shared_report(db, snapshot)
        if latest:
            return True
        current_data_at = _latest_shared_report_data_at(metrics)
        snapshot_at = _shared_report_snapshot_at(snapshot)
        return bool(current_data_at and snapshot_at and current_data_at > snapshot_at + timedelta(seconds=2))
    if "report_type" not in metadata:
        return _legacy_report_metrics_fingerprint(metrics) != snapshot.metrics_hash
    report_type = str(metadata.get("report_type") or "executive").lower()
    bug_items = await list_all_project_bugs(db, snapshot.proyecto_id)
    if snapshot.componente_id:
        bug_items = [bug for bug in bug_items if not bug.componente_id or bug.componente_id == snapshot.componente_id]
    if snapshot.build_id:
        bug_items = [bug for bug in bug_items if not bug.build_id or bug.build_id == snapshot.build_id]
    return _report_metrics_fingerprint(metrics, report_type, _report_bugs_digest(bug_items)) != snapshot.metrics_hash

def _shared_report_datetime(value: Any) -> Optional[datetime]:
    if not value:
        return None
    if isinstance(value, datetime):
        return ensure_utc(value)
    try:
        text = str(value).strip()
        if not text:
            return None
        parsed = datetime.fromisoformat(text.replace("Z", "+00:00"))
        return ensure_utc(parsed)
    except (TypeError, ValueError):
        return None

def _shared_report_snapshot_at(snapshot: models.SharedReportSnapshot) -> Optional[datetime]:
    metadata = _shared_report_metadata(snapshot)
    return _shared_report_datetime(metadata.get("snapshot_at")) or _shared_report_datetime(snapshot.created_at)

def _latest_shared_report_data_at(metrics: Dict[str, Any]) -> Optional[datetime]:
    build_context = metrics.get("build_context") if isinstance(metrics.get("build_context"), dict) else {}
    candidates = [
        build_context.get("last_execution_at"),
        build_context.get("execution_started_at"),
        build_context.get("build_created_at"),
    ]
    parsed = [item for item in (_shared_report_datetime(value) for value in candidates) if item]
    return max(parsed) if parsed else None

async def get_latest_equivalent_shared_report(db: AsyncSession, snapshot: models.SharedReportSnapshot):
    report_type = _shared_report_type(snapshot)
    snapshot_group_id = _shared_report_group_id(snapshot)
    query = (
        select(models.SharedReportSnapshot)
        .filter(models.SharedReportSnapshot.proyecto_id == snapshot.proyecto_id)
        .filter(models.SharedReportSnapshot.build_id == snapshot.build_id)
        .filter(models.SharedReportSnapshot.componente_id == snapshot.componente_id)
        .filter(models.SharedReportSnapshot.activo == True)  # noqa: E712
        .filter(models.SharedReportSnapshot.created_at > snapshot.created_at)
        .filter(models.SharedReportSnapshot.report_type == report_type)
        .filter(models.SharedReportSnapshot.snapshot_group_id != snapshot_group_id)
        .order_by(models.SharedReportSnapshot.created_at.desc(), models.SharedReportSnapshot.id.desc())
        .limit(1)
    )
    result = await db.execute(query)
    candidate = result.scalars().first()
    if candidate:
        return candidate
    # Compatibility for rows created before indexed identity columns were
    # populated (for example, an installation temporarily between migrations).
    legacy_query = (
        select(models.SharedReportSnapshot)
        .filter(models.SharedReportSnapshot.proyecto_id == snapshot.proyecto_id)
        .filter(models.SharedReportSnapshot.build_id == snapshot.build_id)
        .filter(models.SharedReportSnapshot.componente_id == snapshot.componente_id)
        .filter(models.SharedReportSnapshot.activo == True)  # noqa: E712
        .filter(models.SharedReportSnapshot.created_at > snapshot.created_at)
        .filter(models.SharedReportSnapshot.snapshot_group_id.is_(None))
        .order_by(models.SharedReportSnapshot.created_at.desc())
        .limit(100)
    )
    legacy_result = await db.execute(legacy_query)
    for legacy in legacy_result.scalars().all():
        if _shared_report_group_id(legacy) != snapshot_group_id and _shared_report_type(legacy) == report_type:
            return legacy
    return None

def shared_report_is_expired(snapshot: models.SharedReportSnapshot) -> bool:
    if not snapshot.expires_at:
        return False
    return ensure_utc(snapshot.expires_at) < utc_now()
