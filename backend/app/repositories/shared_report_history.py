from .repository_context import *
from sqlalchemy.orm import aliased
from .project_metrics import get_project_metrics
from .report_snapshot_payloads import _shared_report_type
from .shared_report_freshness import _current_shared_report_bundle_hash, shared_report_has_new_values


async def list_shared_report_bundle_history(
    db: AsyncSession,
    proyecto_id: UUID,
    build_id: Optional[UUID] = None,
    componente_id: Optional[UUID] = None,
    limit: int = 50,
    cursor: Optional[str] = None,
) -> Dict[str, Any]:
    """Return a keyset-paginated summary without loading report evidence JSON."""
    filters = [models.SharedReportSnapshot.proyecto_id == proyecto_id]
    if build_id is not None:
        filters.append(models.SharedReportSnapshot.build_id == build_id)
    if componente_id is not None:
        filters.append(models.SharedReportSnapshot.componente_id == componente_id)
    group_id_column = models.SharedReportSnapshot.snapshot_group_id
    group_time = func.max(models.SharedReportSnapshot.created_at)
    groups_query = select(group_id_column.label("group_id"), group_time.label("group_created_at")).where(
        *filters, group_id_column.is_not(None)
    ).group_by(group_id_column)
    cursor_time = None
    cursor_group = None
    if cursor:
        try:
            cursor_time_text, cursor_group = base64.urlsafe_b64decode(cursor + "=" * (-len(cursor) % 4)).decode().split("\n", 1)
            cursor_time = ensure_utc(datetime.fromisoformat(cursor_time_text.replace("Z", "+00:00")))
        except (ValueError, TypeError, UnicodeDecodeError, binascii.Error):
            raise ValueError("Cursor de historial inválido")
        groups_query = groups_query.having(or_(group_time < cursor_time, (group_time == cursor_time) & (group_id_column < cursor_group)))
    groups_query = groups_query.order_by(group_time.desc(), group_id_column.desc()).limit(max(1, min(limit, 100)) + 1)
    group_rows = (await db.execute(groups_query)).all()
    has_more = len(group_rows) > max(1, min(limit, 100))
    page_groups = group_rows[:max(1, min(limit, 100))]
    if not page_groups:
        return {"items": [], "next_cursor": None}
    group_ids = [row.group_id for row in page_groups]
    revoker = aliased(models.Usuario)
    selected_columns = (
        models.SharedReportSnapshot.id, models.SharedReportSnapshot.token,
        models.SharedReportSnapshot.proyecto_id, models.SharedReportSnapshot.build_id,
        models.SharedReportSnapshot.componente_id, models.SharedReportSnapshot.title,
        models.SharedReportSnapshot.description, models.SharedReportSnapshot.metrics_hash,
        models.SharedReportSnapshot.created_by, models.SharedReportSnapshot.created_at,
        models.SharedReportSnapshot.expires_at, models.SharedReportSnapshot.activo,
        models.SharedReportSnapshot.revoked_at, models.SharedReportSnapshot.revoked_by,
        models.SharedReportSnapshot.snapshot_group_id, models.SharedReportSnapshot.report_type,
        models.SharedReportSnapshot.history_metadata,
        models.Usuario.nombre_completo.label("creator_name"), models.Usuario.email.label("creator_email"),
        revoker.nombre_completo.label("revoker_name"), revoker.email.label("revoker_email"),
    )
    rows_query = select(*selected_columns).outerjoin(
        models.Usuario, models.Usuario.id == models.SharedReportSnapshot.created_by
    ).outerjoin(revoker, revoker.id == models.SharedReportSnapshot.revoked_by).where(
        models.SharedReportSnapshot.proyecto_id == proyecto_id,
        models.SharedReportSnapshot.snapshot_group_id.in_(group_ids),
    )
    if build_id is not None:
        rows_query = rows_query.where(models.SharedReportSnapshot.build_id == build_id)
    if componente_id is not None:
        rows_query = rows_query.where(models.SharedReportSnapshot.componente_id == componente_id)
    rows = (await db.execute(rows_query.order_by(models.SharedReportSnapshot.created_at.asc()))).all()
    grouped: Dict[str, List[models.SharedReportSnapshot]] = {}
    creator_names: Dict[str, str] = {}
    for row in rows:
        history_metadata = row.history_metadata or {}
        snapshot = models.SharedReportSnapshot(
            id=row.id, token=row.token, proyecto_id=row.proyecto_id, build_id=row.build_id,
            componente_id=row.componente_id, title=row.title, description=row.description,
            metrics_hash=row.metrics_hash, created_by=row.created_by, created_at=row.created_at,
            expires_at=row.expires_at, activo=row.activo, revoked_at=row.revoked_at,
            revoked_by=row.revoked_by, snapshot_group_id=row.snapshot_group_id,
            report_type=row.report_type, history_metadata=history_metadata,
            payload={"metadata": {**history_metadata, "snapshot_group_id": row.snapshot_group_id,
                                  "report_type": row.report_type}},
        )
        grouped.setdefault(row.snapshot_group_id, []).append(snapshot)
        if row.created_by:
            creator_names[str(row.created_by)] = row.creator_name or row.creator_email or str(row.created_by)
    items: List[Dict[str, Any]] = []
    latest_row = (await db.execute(
        select(models.SharedReportSnapshot.metrics_hash, models.SharedReportSnapshot.history_metadata)
        .where(*filters)
        .order_by(models.SharedReportSnapshot.created_at.desc(), models.SharedReportSnapshot.id.desc())
        .limit(1)
    )).first()
    latest_hash = (
        ((latest_row.history_metadata or {}).get("snapshot_hash") if latest_row else None)
        or (latest_row.metrics_hash if latest_row else None)
    )
    metrics_cache: Dict[tuple[str, str, str], Dict[str, Any]] = {}
    current_hash_cache: Dict[tuple[str, str, str], str] = {}
    for page_group in page_groups:
        group_snapshots = grouped.get(page_group.group_id, [])
        if not group_snapshots:
            continue
        first = group_snapshots[0]
        metadata = first.history_metadata or {}
        group_hash = metadata.get("snapshot_hash") or first.metrics_hash
        cache_key = (str(first.proyecto_id), str(first.build_id or ""), str(first.componente_id or ""))
        group_metrics = metrics_cache.get(cache_key)
        if group_metrics is None:
            group_metrics = await get_project_metrics(db, first.proyecto_id, first.build_id)
            metrics_cache[cache_key] = group_metrics
        group_current_hash = current_hash_cache.get(cache_key)
        if group_current_hash is None:
            group_current_hash = await _current_shared_report_bundle_hash(
                db, first.proyecto_id, first.build_id, first.componente_id, metrics=group_metrics,
            )
            current_hash_cache[cache_key] = group_current_hash
        has_new_values = await shared_report_has_new_values(db, first, metrics=group_metrics, current_hash=group_current_hash)
        items.append({
            "snapshot_group_id": page_group.group_id,
            "metrics_hash": group_hash,
            "build_id": first.build_id,
            "componente_id": first.componente_id,
            "created_at": page_group.group_created_at,
            "created_by": first.created_by,
            "created_by_display": creator_names.get(str(first.created_by)) if first.created_by else None,
            "activo": any(snapshot.activo for snapshot in group_snapshots),
            "revoked_at": max((snapshot.revoked_at for snapshot in group_snapshots if snapshot.revoked_at), default=None),
            "revoked_by": next((snapshot.revoked_by for snapshot in group_snapshots if snapshot.revoked_by), None),
            "revoked_by_display": next((
                (row.revoker_name or row.revoker_email)
                for row in rows
                if row.snapshot_group_id == page_group.group_id and row.revoked_by
            ), None),
            "has_new_values": has_new_values,
            "is_latest": group_hash == latest_hash,
            "snapshots": sorted(group_snapshots, key=lambda item: _shared_report_type(item)),
            "report_types": sorted({_shared_report_type(snapshot) for snapshot in group_snapshots}),
            **{key: metadata.get(key) for key in (
                "build", "componente", "requested_report_type", "build_definition", "qa_comment",
                "definition_responsible_id", "definition_responsible_display", "definition_at",
            )},
        })
    next_cursor = None
    if has_more and page_groups:
        last = page_groups[-1]
        raw_cursor = f"{ensure_utc(last.group_created_at).isoformat()}\n{last.group_id}"
        next_cursor = base64.urlsafe_b64encode(raw_cursor.encode()).decode().rstrip("=")
    return {"items": items, "next_cursor": next_cursor}
