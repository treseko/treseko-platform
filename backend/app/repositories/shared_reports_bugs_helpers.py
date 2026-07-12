from .legacy_common import *


async def _build_shared_report_base_payload(
    db: AsyncSession,
    payload: schemas.SharedReportSnapshotCreate,
    snapshot_group_id: str,
    metrics_hash: str,
    created_by: Optional[UUID] = None,
) -> Optional[Dict[str, Any]]:
    metrics = await get_project_metrics(db, payload.proyecto_id, payload.build_id)
    project = (await db.execute(select(models.Proyecto).filter(models.Proyecto.id == payload.proyecto_id))).scalar_one_or_none()
    if not project:
        return None
    report_settings = normalize_project_report_settings(project.report_settings or {})
    org = None
    if project.organizacion_id:
        org = (await db.execute(select(models.Organizacion).filter(models.Organizacion.id == project.organizacion_id))).scalar_one_or_none()
    build = None
    build_id = payload.build_id or metrics.get("build_id")
    if build_id:
        build = (await db.execute(select(models.Build).filter(models.Build.id == build_id))).scalar_one_or_none()
    component = None
    component_id = payload.componente_id or (build.componente_id if build else None)
    if component_id:
        component = (await db.execute(select(models.Componente).filter(models.Componente.id == component_id))).scalar_one_or_none()
    responsible_id = payload.definition_responsible_id or created_by
    responsible = None
    if responsible_id:
        responsible = (await db.execute(select(models.Usuario).filter(models.Usuario.id == responsible_id))).scalar_one_or_none()
    responsible_display = (responsible.nombre_completo or responsible.email) if responsible else None
    stats = metrics.get("stats") or {}
    build_context = metrics.get("build_context") or {}
    definition_at = utc_now()
    manual_definition = {
        "requested_report_type": str(payload.requested_report_type or "all").lower(),
        "build_definition": str(payload.build_definition or "").strip(),
        "qa_comment": str(payload.qa_comment or "").strip() or None,
        "responsible_id": str(responsible_id or "") or None,
        "responsible_display": responsible_display,
        "defined_at": definition_at.isoformat(),
    }
    metadata = {
        "organizacion": build_context.get("organization") or (org.nombre if org else None),
        "proyecto": project.nombre,
        "componente": build_context.get("component") or (component.nombre if component else None),
        "plataforma": build_context.get("platform") or (component.tech_stack if component else None),
        "build": build_context.get("build") or (build.nombre if build else metrics.get("build_name")),
        "build_code": build_context.get("build_code") or (build.codigo if build else None),
        "build_created_at": build_context.get("build_created_at"),
        "execution_started_at": build_context.get("execution_started_at"),
        "last_execution_at": build_context.get("last_execution_at"),
        "qa_state": build_context.get("qa_state"),
        "snapshot_at": utc_now().isoformat(),
        "snapshot_group_id": snapshot_group_id,
        "snapshot_hash": metrics_hash,
        "snapshot_created_for_build": str(build.id) if build else None,
        "snapshot_bundle_version": REPORT_SNAPSHOT_BUNDLE_VERSION,
        "requested_report_type": manual_definition["requested_report_type"],
        "build_definition": manual_definition["build_definition"],
        "qa_comment": manual_definition["qa_comment"],
        "definition_responsible_id": manual_definition["responsible_id"],
        "definition_responsible_display": manual_definition["responsible_display"],
        "definition_at": manual_definition["defined_at"],
        "report_settings_version": report_settings.get("version"),
    }
    all_bug_items = _bug_list_items(await list_project_bugs(db, payload.proyecto_id))
    if component:
        all_bug_items = [bug for bug in all_bug_items if not bug.componente_id or bug.componente_id == component.id]
    current_bug_items = list(all_bug_items)
    if build:
        current_bug_items = [bug for bug in current_bug_items if not bug.build_id or bug.build_id == build.id]
    all_bug_snapshots = [_bug_issue_snapshot_dict(bug) for bug in all_bug_items]
    current_bug_snapshots = [_bug_issue_snapshot_dict(bug) for bug in current_bug_items]
    build_names = {
        str(item.get("build_id")): str(item.get("build_name") or item.get("build_id"))
        for item in (metrics.get("historico_versions") or [])
        if item.get("build_id")
    }
    missing_build_ids = {
        bug.get("build_id")
        for bug in all_bug_snapshots
        if bug.get("build_id") and bug.get("build_id") not in build_names
    }
    if missing_build_ids:
        parsed_missing_build_ids = []
        for build_id_value in missing_build_ids:
            try:
                parsed_missing_build_ids.append(UUID(str(build_id_value)))
            except (TypeError, ValueError):
                pass
        result_build_names = await db.execute(select(models.Build.id, models.Build.nombre).filter(models.Build.id.in_(parsed_missing_build_ids)))
        for build_id_value, build_name in result_build_names.all():
            build_names[str(build_id_value)] = build_name
    cases = _flatten_report_suite_cases(metrics.get("por_suite_tree") or [])
    failed_cases = [case for case in cases if str(case.get("estado") or "").upper() in {"FALLO", "BLOQUEADO"}]
    development_cases = [_report_development_case(case) for case in failed_cases]
    bug_tracking = _report_bug_tracking(all_bug_snapshots, build_names, str(build.id) if build else None)
    enriched_bugs = metrics.get("bugs") or current_bug_snapshots
    development_bugs = _report_development_bug_snapshots(enriched_bugs, current_bug_snapshots)
    development_bug_tracking = [
        item for item in bug_tracking
        if item.get("current_status") == "Sigue abierto"
    ]
    qa_summary = _report_quality_summary(metrics, enriched_bugs)
    return {
        "project": project,
        "build": build,
        "component": component,
        "stats": stats,
        "qa_summary": qa_summary,
        "payload": {
        "metadata": metadata,
        "report_settings": report_settings,
        "manual_definition": manual_definition,
        "metrics": metrics,
        "qa_summary": qa_summary,
        "bugs": enriched_bugs,
        "bug_traceability": metrics.get("bug_traceability") or {},
        "failures_and_blockers": metrics.get("failures_and_blockers") or [],
        "evidence_summary": metrics.get("evidence_summary") or {},
        "evidence_items": metrics.get("evidence_items") or [],
        "temporal_metrics": metrics.get("temporal_metrics") or {},
        "comparison": metrics.get("comparison") or {},
        "calculation_rules": metrics.get("calculation_rules") or {},
        "development": {
            "cases": development_cases,
            "failures": metrics.get("failures_and_blockers") or [],
            "bugs": development_bugs,
            "bug_tracking": development_bug_tracking,
            "bugs_without_evidence": [bug for bug in development_bugs if not bug.get("has_evidence")],
            "bugs_without_responsible": [bug for bug in development_bugs if not bug.get("responsable")],
            "regressions": _report_regressions(development_cases, development_bug_tracking, metrics),
        },
        "internal": {},
        },
    }

async def _current_shared_report_bundle_hash(
    db: AsyncSession,
    proyecto_id: UUID,
    build_id: Optional[UUID],
    componente_id: Optional[UUID],
) -> str:
    metrics = await get_project_metrics(db, proyecto_id, build_id)
    project = (await db.execute(select(models.Proyecto).filter(models.Proyecto.id == proyecto_id))).scalar_one_or_none()
    report_settings = normalize_project_report_settings((project.report_settings if project else {}) or {})
    bug_items = _bug_list_items(await list_project_bugs(db, proyecto_id))
    if componente_id:
        bug_items = [bug for bug in bug_items if not bug.componente_id or bug.componente_id == componente_id]
    if build_id:
        bug_items = [bug for bug in bug_items if not bug.build_id or bug.build_id == build_id]
    return _report_bundle_fingerprint(metrics, _report_bugs_digest(bug_items), report_settings)

async def create_shared_report_bundle(
    db: AsyncSession,
    payload: schemas.SharedReportSnapshotCreate,
    created_by: Optional[UUID],
) -> Optional[Dict[str, Any]]:
    metrics = await get_project_metrics(db, payload.proyecto_id, payload.build_id)
    project = (await db.execute(select(models.Proyecto).filter(models.Proyecto.id == payload.proyecto_id))).scalar_one_or_none()
    if not project:
        return None
    build = None
    build_id = payload.build_id or metrics.get("build_id")
    if build_id:
        build = (await db.execute(select(models.Build).filter(models.Build.id == build_id))).scalar_one_or_none()
    component = None
    component_id = payload.componente_id or (build.componente_id if build else None)
    if component_id:
        component = (await db.execute(select(models.Componente).filter(models.Componente.id == component_id))).scalar_one_or_none()
    bug_items = _bug_list_items(await list_project_bugs(db, payload.proyecto_id))
    if component:
        bug_items = [bug for bug in bug_items if not bug.componente_id or bug.componente_id == component.id]
    if build:
        bug_items = [bug for bug in bug_items if not bug.build_id or bug.build_id == build.id]
    report_settings = normalize_project_report_settings(project.report_settings or {})
    metrics_hash = _report_bundle_fingerprint(metrics, _report_bugs_digest(bug_items), report_settings)
    manual_definition = {
        "requested_report_type": str(payload.requested_report_type or "all").lower(),
        "build_definition": str(payload.build_definition or "").strip(),
        "qa_comment": str(payload.qa_comment or "").strip(),
    }
    existing = await _find_active_shared_report_bundle(
        db,
        payload.proyecto_id,
        build.id if build else None,
        component.id if component else None,
        metrics_hash,
        manual_definition,
    )
    if existing:
        return {"snapshots": existing, "reused": True, "metrics_hash": metrics_hash, "snapshot_group_id": _shared_report_group_id(existing[0])}

    snapshot_group_id = str(uuid.uuid4())
    base = await _build_shared_report_base_payload(db, payload, snapshot_group_id, metrics_hash, created_by)
    if not base:
        return None
    project = base["project"]
    build = base["build"]
    component = base["component"]
    stats = base["stats"]
    qa_summary = base["qa_summary"]
    snapshots: List[models.SharedReportSnapshot] = []
    for report_type in REPORT_BUNDLE_TYPES:
        frozen_payload = _derive_report_payload(base["payload"], report_type)
        token = _short_report_token(project, component, build, f"{metrics_hash}:{report_type}")
        for _ in range(5):
            existing_token = await db.execute(
                select(models.SharedReportSnapshot.id).filter(models.SharedReportSnapshot.token == token)
            )
            if not existing_token.scalar_one_or_none():
                break
            token = _short_report_token(project, component, build, f"{metrics_hash}:{report_type}:{secrets.token_hex(3)}")
        title_prefix = {
            "executive": "Informe Ejecutivo QA",
            "development": "Informe Desarrollo QA",
            "internal": "Informe Interno QA",
        }[report_type]
        title = f"{title_prefix} - {project.nombre} - {(build.nombre if build else frozen_payload.get('metadata', {}).get('build')) or 'Build activa'}"
        description = (
            f"{qa_summary.get('decision')} · Riesgo {qa_summary.get('risk')} · "
            f"Pasadas {stats.get('pasados', 0)} / "
            f"Fallidas {stats.get('fallados', 0)} / "
            f"Bloqueadas {stats.get('bloqueados', 0)}"
        )
        snapshot = models.SharedReportSnapshot(
            token=token,
            proyecto_id=payload.proyecto_id,
            build_id=build.id if build else None,
            componente_id=component.id if component else None,
            title=title,
            description=description,
            payload=frozen_payload,
            metrics_hash=metrics_hash,
            thumbnail_svg=_shared_report_thumbnail_svg(frozen_payload),
            created_by=created_by,
            expires_at=ensure_utc(payload.expires_at),
        )
        db.add(snapshot)
        snapshots.append(snapshot)
    bundle_tokens = {
        _shared_report_type(snapshot): snapshot.token
        for snapshot in snapshots
    }
    bundle_paths = {
        "executive": f"/s/reports/{bundle_tokens.get('executive')}" if bundle_tokens.get("executive") else None,
        "development": f"/s/reports/{bundle_tokens.get('development')}" if bundle_tokens.get("development") else None,
        "internal": f"/reports/internal/{bundle_tokens.get('internal')}" if bundle_tokens.get("internal") else None,
    }
    for snapshot in snapshots:
        frozen_payload = snapshot.payload or {}
        metadata = frozen_payload.setdefault("metadata", {})
        metadata["bundle_tokens"] = bundle_tokens
        metadata["bundle_paths"] = {key: value for key, value in bundle_paths.items() if value}
        snapshot.payload = frozen_payload
    await db.commit()
    for snapshot in snapshots:
        await db.refresh(snapshot)
    return {"snapshots": snapshots, "reused": False, "metrics_hash": metrics_hash, "snapshot_group_id": snapshot_group_id}

async def create_shared_report_snapshot(
    db: AsyncSession,
    payload: schemas.SharedReportSnapshotCreate,
    created_by: Optional[UUID],
):
    bundle = await create_shared_report_bundle(db, payload, created_by)
    if not bundle:
        return None
    for snapshot in bundle["snapshots"]:
        if _shared_report_type(snapshot) == "executive":
            return snapshot
    return bundle["snapshots"][0]

async def get_shared_report_by_token(db: AsyncSession, token: str):
    result = await db.execute(select(models.SharedReportSnapshot).filter(models.SharedReportSnapshot.token == token))
    return result.scalar_one_or_none()

async def shared_report_has_new_values(db: AsyncSession, snapshot: models.SharedReportSnapshot) -> bool:
    metrics = await get_project_metrics(db, snapshot.proyecto_id, snapshot.build_id)
    payload = snapshot.payload or {}
    metadata = payload.get("metadata") or {}
    if metadata.get("snapshot_bundle_version") and metadata.get("snapshot_bundle_version") != REPORT_SNAPSHOT_BUNDLE_VERSION:
        return True
    if metadata.get("snapshot_bundle_version") == REPORT_SNAPSHOT_BUNDLE_VERSION:
        current_hash = await _current_shared_report_bundle_hash(db, snapshot.proyecto_id, snapshot.build_id, snapshot.componente_id)
        frozen_hash = _shared_report_payload_bundle_hash(payload)
        if current_hash in {metadata.get("snapshot_hash"), snapshot.metrics_hash, frozen_hash}:
            return False
        latest = await get_latest_equivalent_shared_report(db, snapshot)
        if latest:
            return True
        current_data_at = _latest_shared_report_data_at(metrics)
        snapshot_at = _shared_report_snapshot_at(snapshot)
        return bool(current_data_at and snapshot_at and current_data_at > snapshot_at + timedelta(seconds=2))
    if "report_type" not in metadata:
        return _legacy_report_metrics_fingerprint(metrics) != snapshot.metrics_hash
    report_type = str(metadata.get("report_type") or "executive").lower()
    bug_items = _bug_list_items(await list_project_bugs(db, snapshot.proyecto_id))
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
        .order_by(models.SharedReportSnapshot.created_at.desc())
    )
    result = await db.execute(query)
    for candidate in result.scalars().all():
        if candidate.id == snapshot.id:
            continue
        if _shared_report_group_id(candidate) == snapshot_group_id:
            continue
        if candidate.created_at <= snapshot.created_at:
            continue
        if _shared_report_type(candidate) == report_type:
            return candidate
    return None

def shared_report_is_expired(snapshot: models.SharedReportSnapshot) -> bool:
    if not snapshot.expires_at:
        return False
    return ensure_utc(snapshot.expires_at) < utc_now()

async def revoke_shared_report(db: AsyncSession, token: str):
    snapshot = await get_shared_report_by_token(db, token)
    if not snapshot:
        return None
    group_id = _shared_report_group_id(snapshot)
    now = utc_now()
    if not group_id.startswith("legacy:"):
        result = await db.execute(select(models.SharedReportSnapshot).filter(models.SharedReportSnapshot.proyecto_id == snapshot.proyecto_id))
        targets = [item for item in result.scalars().all() if _shared_report_group_id(item) == group_id]
    else:
        targets = [snapshot]
    for target in targets:
        target.activo = False
        target.revoked_at = now
    await db.commit()
    await db.refresh(snapshot)
    return snapshot

async def list_shared_report_bundle_history(
    db: AsyncSession,
    proyecto_id: UUID,
    build_id: Optional[UUID] = None,
    componente_id: Optional[UUID] = None,
) -> List[Dict[str, Any]]:
    query = (
        select(models.SharedReportSnapshot)
        .filter(models.SharedReportSnapshot.proyecto_id == proyecto_id)
        .order_by(models.SharedReportSnapshot.created_at.desc())
    )
    if build_id is not None:
        query = query.filter(models.SharedReportSnapshot.build_id == build_id)
    if componente_id is not None:
        query = query.filter(models.SharedReportSnapshot.componente_id == componente_id)
    result = await db.execute(query)
    all_snapshots = result.scalars().all()
    creator_ids = {snapshot.created_by for snapshot in all_snapshots if snapshot.created_by}
    creators: Dict[UUID, str] = {}
    if creator_ids:
        creator_result = await db.execute(select(models.Usuario).filter(models.Usuario.id.in_(creator_ids)))
        creators = {
            user.id: (user.nombre_completo or user.email or str(user.id))
            for user in creator_result.scalars().all()
        }
    grouped: Dict[str, List[models.SharedReportSnapshot]] = {}
    for snapshot in all_snapshots:
        grouped.setdefault(_shared_report_group_id(snapshot), []).append(snapshot)
    items: List[Dict[str, Any]] = []
    sorted_groups = sorted(
        grouped.values(),
        key=lambda group: max((snapshot.created_at for snapshot in group if snapshot.created_at), default=datetime.min.replace(tzinfo=timezone.utc)),
        reverse=True,
    )
    latest_hash = None
    for group_snapshots in sorted_groups:
        first = sorted(group_snapshots, key=lambda item: item.created_at or datetime.min.replace(tzinfo=timezone.utc))[0]
        metadata = _shared_report_metadata(first)
        group_hash = metadata.get("snapshot_hash") or first.metrics_hash
        if latest_hash is None:
            latest_hash = group_hash
        has_new_values = await shared_report_has_new_values(db, first)
        items.append({
            "snapshot_group_id": _shared_report_group_id(first),
            "metrics_hash": group_hash,
            "build_id": first.build_id,
            "componente_id": first.componente_id,
            "created_at": first.created_at,
            "created_by": first.created_by,
            "created_by_display": creators.get(first.created_by) if first.created_by else None,
            "activo": any(snapshot.activo for snapshot in group_snapshots),
            "has_new_values": has_new_values,
            "is_latest": group_hash == latest_hash,
            "snapshots": sorted(group_snapshots, key=lambda item: _shared_report_type(item)),
            "report_types": sorted({_shared_report_type(snapshot) for snapshot in group_snapshots}),
            "build": metadata.get("build"),
            "componente": metadata.get("componente"),
            "requested_report_type": metadata.get("requested_report_type"),
            "build_definition": metadata.get("build_definition"),
            "qa_comment": metadata.get("qa_comment"),
            "definition_responsible_id": metadata.get("definition_responsible_id"),
            "definition_responsible_display": metadata.get("definition_responsible_display"),
            "definition_at": metadata.get("definition_at"),
        })
    return sorted(items, key=lambda item: item["created_at"], reverse=True)

BUG_OPEN_STATES = {"ABIERTO", "TRIAGE", "ASIGNADO", "EN_PROGRESO", "LISTO_PARA_RETEST", "EN_RETEST", "REABIERTO", "BLOQUEADO"}
BUG_CLOSED_STATES = {"RESUELTO", "CERRADO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}
BUG_ALLOWED_STATES = BUG_OPEN_STATES | BUG_CLOSED_STATES
BUG_ALLOWED_SEVERITIES = {"CRITICA", "ALTA", "MEDIA", "BAJA", "COSMETICA"}
BUG_ALLOWED_PRIORITIES = {"P0", "P1", "P2", "P3", "P4", "ALTA", "MEDIA", "BAJA"}


def _normalize_bug_text(value: Optional[str]) -> str:
    return re.sub(r"\s+", " ", (value or "").strip().lower())


def _bug_payload_dict(payload: schemas.BugIssueCreate | schemas.BugIssueUpdate) -> Dict[str, Any]:
    return payload.model_dump(exclude_unset=isinstance(payload, schemas.BugIssueUpdate))


def compute_bug_dedupe_hash(data: Dict[str, Any]) -> str:
    base = "|".join([
        str(data.get("proyecto_id") or ""),
        str(data.get("componente_id") or ""),
        str(data.get("build_id") or ""),
        str(data.get("caso_id") or ""),
        str(data.get("numero_paso") or ""),
        _normalize_bug_text(data.get("titulo")),
        _normalize_bug_text(data.get("error_tecnico")),
        _normalize_bug_text(data.get("resultado_obtenido") or data.get("descripcion")),
    ])
    return hashlib.sha256(base.encode("utf-8")).hexdigest()


def _validate_bug_payload(data: Dict[str, Any], from_failure: bool = False) -> None:
    if not _normalize_bug_text(data.get("titulo")):
        raise ValueError("El bug debe tener titulo.")
    if not data.get("proyecto_id"):
        raise ValueError("El bug debe estar asociado a un proyecto.")
    if not data.get("build_id") and not _normalize_bug_text(data.get("build_code")) and not _normalize_bug_text(data.get("version_app")):
        raise ValueError("El bug debe tener build o contexto de version.")
    if not _normalize_bug_text(data.get("resultado_esperado")):
        raise ValueError("El bug debe incluir resultado esperado.")
    if not _normalize_bug_text(data.get("resultado_obtenido") or data.get("descripcion") or data.get("error_tecnico")):
        raise ValueError("El bug debe incluir resultado obtenido, descripcion del fallo o error tecnico.")
    if not _normalize_bug_text(data.get("pasos_reproduccion")) and not data.get("snapshot_id") and not data.get("caso_id"):
        raise ValueError("El bug debe incluir pasos de reproduccion o trazabilidad a caso/snapshot.")
    if str(data.get("severidad") or "").upper() not in BUG_ALLOWED_SEVERITIES:
        raise ValueError("Severidad invalida.")
    if str(data.get("prioridad") or "").upper() not in BUG_ALLOWED_PRIORITIES:
        raise ValueError("Prioridad invalida.")
    if from_failure and not (
        _normalize_bug_text(data.get("notas_qa"))
        or _normalize_bug_text(data.get("logs_relevantes"))
        or _normalize_bug_text(data.get("error_tecnico"))
        or _normalize_bug_text(data.get("descripcion"))
        or data.get("snapshot_id")
    ):
        raise ValueError("Un bug creado desde un fallo requiere evidencia, comentario o contexto del snapshot.")


def _bug_options():
    return (
        selectinload(models.BugIssue.comments).selectinload(models.BugComment.attachments).selectinload(models.BugAttachment.attachment),
        selectinload(models.BugIssue.attachments).selectinload(models.BugAttachment.attachment),
        selectinload(models.BugIssue.external_links),
    )
