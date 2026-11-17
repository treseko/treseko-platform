from .repository_context import *
from sqlalchemy.orm import aliased
from ..services.shared_report_revocation import hydrate_legacy_revocation_actor
from ..services.edition.entitlement_provider import get_entitlement_provider
from ..version import PRODUCT_VERSION
from .report_bug_payloads import _enrich_api_bug_snapshots
from ..services.development_report import (
    development_sections_for_payload,
)
from .report_bug_loading import (
    load_and_freeze_development_bug_labels,
    list_all_project_bugs,
)
from .project_metrics import get_project_metrics
from .report_fingerprints import (
    REPORT_BUNDLE_TYPES,
    REPORT_SNAPSHOT_BUNDLE_VERSION,
    _legacy_report_metrics_fingerprint,
    _report_bundle_fingerprint,
    _report_metrics_fingerprint,
    _short_report_token,
    normalize_project_report_settings,
)
from .report_snapshot_payloads import (
    _derive_report_payload,
    _find_active_shared_report_bundle,
    _flatten_report_suite_cases,
    _shared_report_group_id,
    _shared_report_metadata,
    _shared_report_thumbnail_svg,
    _shared_report_type,
)
from .report_bug_payloads import (
    _bug_issue_snapshot_dict,
    _enrich_conversational_bug_snapshots,
    _report_bug_tracking,
    _report_bugs_digest,
    _report_development_bug_snapshots,
    _report_development_case,
    _report_merge_bug_snapshot,
    _report_quality_summary,
    _report_regressions,
)


async def _shared_report_branding(db: AsyncSession) -> Dict[str, Any]:
    entitlement_state = await get_entitlement_provider().get_state(db)
    enabled_features = set(entitlement_state.get("enabled_features") or [])
    can_customize = entitlement_state.get("edition") == "premium" and "branding.custom" in enabled_features
    return config_service.branding_response(
        await config_service.get_workspace_branding(db),
        edition=str(entitlement_state.get("edition") or "community"),
        can_customize=can_customize,
    )


async def _build_shared_report_base_payload(
    db: AsyncSession,
    payload: schemas.SharedReportSnapshotCreate,
    snapshot_group_id: str,
    metrics_hash: str,
    created_by: Optional[UUID] = None,
    *,
    metrics: Optional[Dict[str, Any]] = None,
    bug_items: Optional[List[Any]] = None,
    branding: Optional[Dict[str, Any]] = None,
) -> Optional[Dict[str, Any]]:
    metrics = metrics if metrics is not None else await get_project_metrics(db, payload.proyecto_id, payload.build_id)
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
    branding = branding if branding is not None else await _shared_report_branding(db)
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
        # Freeze the product version in the snapshot so historical reports
        # remain attributable after the installation is updated.
        "app_version": PRODUCT_VERSION,
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
        "branding": {
            "brand_name": branding["effective_brand_name"],
            "logo_url": branding["effective_logo_url"],
        },
    }
    all_bug_items = list(bug_items) if bug_items is not None else await list_all_project_bugs(db, payload.proyecto_id)
    if component:
        all_bug_items = [bug for bug in all_bug_items if not bug.componente_id or bug.componente_id == component.id]
    current_bug_items = list(all_bug_items)
    if build:
        current_bug_items = [bug for bug in current_bug_items if not bug.build_id or bug.build_id == build.id]
    all_bug_snapshots = await load_and_freeze_development_bug_labels(
        db, [_bug_issue_snapshot_dict(bug) for bug in all_bug_items], all_bug_items, payload.proyecto_id,
    )
    current_bug_snapshots = await load_and_freeze_development_bug_labels(
        db, [_bug_issue_snapshot_dict(bug) for bug in current_bug_items], current_bug_items, payload.proyecto_id,
    )
    bugs_by_id = {str(bug.id): bug for bug in all_bug_items}
    await _enrich_conversational_bug_snapshots(db, all_bug_snapshots, bugs_by_id)
    await _enrich_conversational_bug_snapshots(db, current_bug_snapshots, bugs_by_id)
    await _enrich_api_bug_snapshots(db, all_bug_snapshots, bugs_by_id)
    await _enrich_api_bug_snapshots(db, current_bug_snapshots, bugs_by_id)
    build_names = {
        str(item.get("build_id")): str(item.get("build_name") or "Build no registrada")
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
    metric_bugs = metrics.get("bugs") or []
    current_by_key = {
        str(item.get("id")): item
        for item in current_bug_snapshots
        if item.get("id")
    }
    current_by_key.update({
        str(item.get("codigo")): item
        for item in current_bug_snapshots
        if item.get("codigo")
    })
    # A metric bug can remain associated with the project while its build
    # association is absent or points to a previous build. Prefer the current
    # snapshot, but retain the complete project snapshot as a fallback so
    # enriched API/conversational evidence is not reduced to a summary row.
    all_by_key = {
        str(item.get("id")): item
        for item in all_bug_snapshots
        if item.get("id")
    }
    all_by_key.update({
        str(item.get("codigo")): item
        for item in all_bug_snapshots
        if item.get("codigo")
    })
    enriched_bugs = [
        _report_merge_bug_snapshot(
            current_by_key.get(str(item.get("id")))
            or current_by_key.get(str(item.get("codigo")))
            or all_by_key.get(str(item.get("id")))
            or all_by_key.get(str(item.get("codigo")))
            or {},
            item,
        )
        for item in metric_bugs
    ] or current_bug_snapshots
    development_bugs = _report_development_bug_snapshots(enriched_bugs, all_bug_snapshots)
    development_sections = development_sections_for_payload(
        metadata, metrics, all_bug_snapshots, development_bugs,
        metrics.get("failures_and_blockers") or [],
    )
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
            **development_sections,
            "bug_tracking": development_bug_tracking,
            "bugs_without_evidence": [bug for bug in development_bugs if not bug.get("has_evidence")],
            "bugs_without_responsible": [bug for bug in development_bugs if not bug.get("responsable")],
            "regressions": _report_regressions(development_cases, development_bug_tracking, metrics),
        },
        "internal": {},
        },
    }

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
    bug_items = await list_all_project_bugs(db, payload.proyecto_id)
    if component:
        bug_items = [bug for bug in bug_items if not bug.componente_id or bug.componente_id == component.id]
    report_settings = normalize_project_report_settings(project.report_settings or {})
    branding = await _shared_report_branding(db)
    metrics_hash = _report_bundle_fingerprint(metrics, _report_bugs_digest(bug_items), report_settings, branding)
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
    base = await _build_shared_report_base_payload(
        db,
        payload,
        snapshot_group_id,
        metrics_hash,
        created_by,
        metrics=metrics,
        bug_items=bug_items,
        branding=branding,
    )
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
            snapshot_group_id=snapshot_group_id,
            report_type=report_type,
            history_metadata={
                key: frozen_payload.get("metadata", {}).get(key)
                for key in (
                    "organizacion", "proyecto", "componente", "build", "build_code",
                    "requested_report_type", "build_definition", "qa_comment",
                    "definition_responsible_id", "definition_responsible_display", "definition_at",
                    "snapshot_hash", "snapshot_bundle_version",
                )
            },
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
    canonical_payload = base["payload"]
    canonical_metadata = canonical_payload.setdefault("metadata", {})
    canonical_metadata["bundle_tokens"] = bundle_tokens
    canonical_metadata["bundle_paths"] = {key: value for key, value in bundle_paths.items() if value}
    db.add(models.SharedReportPayload(snapshot_group_id=snapshot_group_id, payload=canonical_payload))
    summary_metadata_keys = (
        "organizacion", "proyecto", "componente", "build", "build_code", "branding",
        "snapshot_at", "snapshot_hash", "snapshot_created_for_build", "snapshot_bundle_version",
        "snapshot_group_id", "report_type", "requested_report_type", "build_definition", "qa_comment",
        "definition_responsible_id", "definition_responsible_display", "definition_at",
        "bundle_tokens", "bundle_paths",
    )
    for snapshot in snapshots:
        metadata = (snapshot.payload or {}).get("metadata") or {}
        snapshot.history_metadata = {
            key: metadata.get(key)
            for key in (
                "organizacion", "proyecto", "componente", "build", "build_code",
                "requested_report_type", "build_definition", "qa_comment",
                "definition_responsible_id", "definition_responsible_display", "definition_at",
                "snapshot_hash", "snapshot_bundle_version",
            )
        }
        snapshot.payload = {
            "metadata": {key: metadata.get(key) for key in summary_metadata_keys},
            "stats": stats,
            "qa_summary": qa_summary,
        }
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
    result = await db.execute(
        select(models.SharedReportSnapshot)
        .options(selectinload(models.SharedReportSnapshot.revoker))
        .filter(models.SharedReportSnapshot.token == token)
    )
    snapshot = result.scalar_one_or_none()
    if snapshot and snapshot.snapshot_group_id:
        shared_payload_result = await db.execute(
            select(models.SharedReportPayload).filter(
                models.SharedReportPayload.snapshot_group_id == snapshot.snapshot_group_id
            )
        )
        shared_payload = shared_payload_result.scalar_one_or_none()
        if shared_payload:
            snapshot.payload = _derive_report_payload(shared_payload.payload or {}, _shared_report_type(snapshot))
    await hydrate_legacy_revocation_actor(db, snapshot)
    return snapshot

async def revoke_shared_report(db: AsyncSession, token: str, revoked_by_id: Optional[UUID] = None):
    snapshot = await get_shared_report_by_token(db, token)
    if not snapshot:
        return None
    group_id = _shared_report_group_id(snapshot)
    now = utc_now()
    if not group_id.startswith("legacy:"):
        result = await db.execute(
            select(models.SharedReportSnapshot)
            .filter(models.SharedReportSnapshot.proyecto_id == snapshot.proyecto_id)
            .filter(models.SharedReportSnapshot.snapshot_group_id == group_id)
        )
        targets = result.scalars().all()
    else:
        targets = [snapshot]
    for target in targets:
        target.activo = False
        target.revoked_at = now
        target.revoked_by = revoked_by_id
    await db.commit()
    await db.refresh(snapshot)
    return snapshot


# Keep report freshness helpers available through the established repository
# module API while their implementation remains isolated from payload writes.
from .shared_report_freshness import (  # noqa: E402
    _current_shared_report_bundle_hash,
    get_latest_equivalent_shared_report,
    shared_report_has_new_values,
    shared_report_is_expired,
)

BUG_OPEN_STATES = {"ABIERTO", "TRIAGE", "ASIGNADO", "EN_PROGRESO", "LISTO_PARA_RETEST", "EN_RETEST", "REABIERTO", "BLOQUEADO"}
BUG_CLOSED_STATES = {"RESUELTO", "CERRADO", "DUPLICADO", "NO_REPRODUCIBLE", "NO_CORRESPONDE"}
BUG_ALLOWED_STATES = BUG_OPEN_STATES | BUG_CLOSED_STATES
BUG_ALLOWED_SEVERITIES = {"CRITICA", "ALTA", "MEDIA", "BAJA", "COSMETICA"}
BUG_ALLOWED_PRIORITIES = {"P0", "P1", "P2", "P3", "P4", "ALTA", "MEDIA", "BAJA"}
