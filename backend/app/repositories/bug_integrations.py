from .legacy_common import *

BUG_EXPORT_REDACTED_VALUE = "[redacted]"
BUG_EXPORT_SENSITIVE_KEY_MARKERS = {
    "access_token",
    "api_key",
    "apikey",
    "authorization",
    "bearer",
    "client_secret",
    "credential",
    "credentials",
    "password",
    "refresh_token",
    "secret",
    "token",
}

BUG_EXPORT_MARKDOWN_ESCAPE_RE = re.compile(r"([\\`*_{}\[\]()#+\-.!|>])")


def _bug_export_key_is_sensitive(key: Any) -> bool:
    normalized = str(key or "").lower().replace("-", "_").replace(" ", "_")
    return any(marker in normalized for marker in BUG_EXPORT_SENSITIVE_KEY_MARKERS)


def _redact_bug_export_text(value: str) -> str:
    text = str(value or "").replace("\x00", "")
    text = re.sub(
        r"(?i)\b(authorization)\s*:\s*bearer\s+[^\s,;\n]+",
        r"\1: Bearer [redacted]",
        text,
    )
    text = re.sub(
        r"(?i)((?:access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|password|secret|client[_-]?secret|token)\s*[:=]\s*)([^\s,;\n}]+)",
        lambda match: f"{match.group(1)}{BUG_EXPORT_REDACTED_VALUE}",
        text,
    )
    text = re.sub(
        r"(?i)([\"'](?:access[_-]?token|refresh[_-]?token|api[_-]?key|apikey|password|secret|client[_-]?secret|token)[\"']\s*:\s*)([\"'][^\"']*[\"']|[^,\n}]+)",
        lambda match: f"{match.group(1)}\"{BUG_EXPORT_REDACTED_VALUE}\"",
        text,
    )
    return text


def _escape_bug_export_markdown(value: Any) -> str:
    text = str(value if value not in (None, "") else "N/D").replace("\x00", "")
    text = text.replace("\r\n", "\n").replace("\r", "\n")
    escaped_lines = [
        BUG_EXPORT_MARKDOWN_ESCAPE_RE.sub(r"\\\1", line).rstrip()
        for line in text.split("\n")
    ]
    return "\n".join(escaped_lines).strip() or "N/D"


def _redact_bug_export_value(value: Any, key: Any = None) -> Any:
    if _bug_export_key_is_sensitive(key):
        return BUG_EXPORT_REDACTED_VALUE
    if isinstance(value, dict):
        return {item_key: _redact_bug_export_value(item_value, item_key) for item_key, item_value in value.items()}
    if isinstance(value, list):
        return [_redact_bug_export_value(item) for item in value]
    if isinstance(value, str):
        return _redact_bug_export_text(value)
    return value


async def create_bug_from_execution(db: AsyncSession, ejecucion_id: UUID, payload: schemas.BugIssueUpdate, created_by: Optional[UUID]):
    execution_result = await db.execute(
        select(models.EjecucionCaso, models.TestRun, models.CasoPrueba)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .filter(models.EjecucionCaso.id == ejecucion_id)
    )
    row = execution_result.first()
    if not row:
        return None
    execution, run, case = row
    if execution.estado_resultado not in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO}:
        raise ValueError("Solo se puede crear bug directo desde una ejecucion fallida o bloqueada.")

    existing_execution_bug = await find_existing_failure_bug(
        db,
        proyecto_id=run.proyecto_id,
        ejecucion_id=execution.id,
    )
    if existing_execution_bug:
        return existing_execution_bug

    snapshot_result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id == execution.id)
        .filter(models.SnapshotPaso.estado_paso.in_([models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO]))
        .order_by(models.SnapshotPaso.numero_paso)
    )
    snapshot = snapshot_result.scalars().first()
    if snapshot:
        return await create_bug_from_snapshot(db, snapshot.id, payload, created_by)

    build = None
    if run.build_id:
        build_result = await db.execute(select(models.Build).filter(models.Build.id == run.build_id))
        build = build_result.scalar_one_or_none()
    component = None
    component_id = case.componente_id or (build.componente_id if build else None)
    if component_id:
        component = (await db.execute(select(models.Componente).filter(models.Componente.id == component_id))).scalar_one_or_none()
    environment = None
    if run.entorno_id:
        environment = (await db.execute(select(models.Entorno).filter(models.Entorno.id == run.entorno_id))).scalar_one_or_none()
    dataset = None
    if run.dataset_id:
        dataset = (await db.execute(select(models.EntornoDataset).filter(models.EntornoDataset.id == run.dataset_id))).scalar_one_or_none()
    resolved_dataset = await resolve_case_dataset(db, case.id, run.build_id, run.entorno_id, run.dataset_id)
    dataset_values = (resolved_dataset or {}).get("variables_resueltas") or {}

    base = {
        "proyecto_id": run.proyecto_id,
        "componente_id": component_id,
        "build_id": run.build_id,
        "caso_id": case.id,
        "test_run_id": run.id,
        "ejecucion_id": execution.id,
        "entorno_id": run.entorno_id,
        "dataset_id": run.dataset_id,
        "execution_mode": execution.execution_mode.value if hasattr(execution.execution_mode, "value") else str(execution.execution_mode),
        "case_code": case.codigo,
        "build_code": (build.codigo or build.nombre) if build else None,
        "titulo": f"{case.codigo or 'Caso'} - {case.titulo}: ejecucion {execution.estado_resultado.value.lower()}",
        "descripcion": execution.observaciones or "Fallo detectado durante la ejecucion de prueba.",
        "resultado_esperado": f"El caso {case.codigo or case.titulo} debe completar su objetivo sin fallos ni bloqueos.",
        "resultado_obtenido": execution.observaciones or "La ejecucion no cumplio el resultado esperado.",
        "pasos_reproduccion": "\n".join([
            f"1. Ejecutar caso {case.codigo or case.titulo} en build {build.nombre if build else run.nombre}.",
            "2. Reproducir el flujo guardado en la ejecucion.",
            "3. Validar el resultado final registrado.",
        ]),
        "notas_qa": execution.observaciones,
        "datos_prueba": json.dumps(dataset_values, ensure_ascii=False, indent=2) if dataset_values else None,
        "origen": "ejecucion_manual" if execution.execution_mode == models.ExecutionMode.MANUAL else str(execution.execution_mode.value).lower(),
        "severidad": "ALTA" if execution.estado_resultado == models.EstadoResultado.BLOQUEADO else "MEDIA",
        "prioridad": "P1" if execution.estado_resultado == models.EstadoResultado.BLOQUEADO else "P2",
        "criticidad": "ALTA" if execution.estado_resultado == models.EstadoResultado.BLOQUEADO else "MEDIA",
        "bloquea_caso": False,
        "ambiente_nombre": environment.nombre if environment else run.entorno,
        "ambiente_url": environment.url if environment else None,
        "version_app": build.nombre if build else None,
        "modulo_funcional": component.nombre if component else None,
        "metadata_json": {
            "project_id": str(run.proyecto_id),
            "build_name": build.nombre if build else None,
            "build_code": build.codigo if build else None,
            "component_name": component.nombre if component else None,
            "component_code": getattr(component, "codigo", None) if component else None,
            "environment_name": environment.nombre if environment else run.entorno,
            "environment_url": environment.url if environment else None,
            "dataset_name": dataset.nombre if dataset else None,
            "dataset_variables": dataset_values,
            "execution_status": execution.estado_resultado.value,
            "execution_date": isoformat_utc(execution.fecha_ejecucion),
            "executed_by": str(execution.ejecutado_por),
            "case_version": execution.version_ejecutada,
            "created_from": "execution",
        },
    }
    overrides = payload.model_dump(exclude_unset=True)
    override_metadata = overrides.pop("metadata_json", None)
    base.update({key: value for key, value in overrides.items() if value is not None})
    if override_metadata:
        base["metadata_json"] = {**(base.get("metadata_json") or {}), **override_metadata}
    base["dedupe_hash"] = compute_bug_dedupe_hash(base)
    existing_dedupe_bug = await find_existing_failure_bug(
        db,
        proyecto_id=run.proyecto_id,
        ejecucion_id=execution.id,
        dedupe_hash=base["dedupe_hash"],
    )
    if existing_dedupe_bug:
        return existing_dedupe_bug
    return await create_bug_issue(db, schemas.BugIssueCreate(**base), created_by, from_failure=True)


def generate_bug_markdown(bug: models.BugIssue) -> str:
    def value(item, key: Any = None):
        safe_item = _redact_bug_export_value(item, key)
        if isinstance(safe_item, (dict, list)):
            safe_item = json.dumps(safe_item, ensure_ascii=False, indent=2)
        return _escape_bug_export_markdown(safe_item)
    metadata = bug.metadata_json or {}
    additional_context = metadata.get("additional_context") or []
    if isinstance(additional_context, dict):
        additional_context_items = [{"key": key, "value": val} for key, val in additional_context.items()]
    elif isinstance(additional_context, list):
        additional_context_items = additional_context
    else:
        additional_context_items = []
    additional_context_lines = [
        f"- {value(item.get('key'))}: {value(item.get('value'), item.get('key'))}"
        for item in additional_context_items
        if isinstance(item, dict) and (item.get("key") or item.get("value"))
    ] or ["- N/D"]
    attachments = [
        f"- {value(link.attachment.filename_original)} ({value(link.attachment.public_url)})"
        for link in (bug.attachments or [])
        if getattr(link, "attachment", None)
    ] or ["- N/D"]
    external = [
        f"- {value(link.provider_id)}: {value(link.external_issue_id)} {value(link.external_issue_url or '')}".strip()
        for link in (bug.external_links or [])
    ] or ["- N/D"]
    return f"""# {value(bug.codigo)} - {value(bug.titulo)}

## Resumen
{value(bug.descripcion)}

## Resultado esperado
{value(bug.resultado_esperado)}

## Resultado obtenido
{value(bug.resultado_obtenido or bug.comportamiento_actual)}

## Impacto
- Severidad: {value(bug.severidad)}
- Prioridad: {value(bug.prioridad)}
- Impacto negocio: {value(bug.impacto_negocio)}

## Contexto de prueba
- Proyecto: {value(bug.proyecto_id)}
- Componente: {value(bug.componente_id)}
- Build: {value(bug.build_id)}
- Ambiente: {value(bug.ambiente_nombre)}
- Dataset: {value(bug.dataset_id)}
- Caso: {value(bug.caso_id)}
- Codigo caso: {value(bug.case_code)}
- Version ejecutada: {value(bug.version_app)}
- TestRun: {value(bug.test_run_id)}
- Ejecucion: {value(bug.ejecucion_id)}
- Snapshot: {value(bug.snapshot_id)}
- Modo ejecucion: {value(bug.execution_mode)}
- Reportado por: {value(bug.creado_por)}

## Contexto adicional del sistema
{chr(10).join(additional_context_lines)}

## Paso afectado
- Numero: {value(bug.numero_paso)}
- Accion: {value(metadata.get('snapshot_action'))}
- Datos: {value(bug.datos_prueba, 'datos_prueba')}
- Resultado esperado del paso: {value(bug.resultado_esperado)}
- Comentario del tester: {value(bug.notas_qa)}
- Estado: {value(metadata.get('snapshot_status'))}

## Pasos para reproducir
{value(bug.pasos_reproduccion)}

## Evidencias
{chr(10).join(attachments)}

## Informacion tecnica
- URL afectada: {value(bug.url_afectada)}
- Browser: {value(bug.navegador)}
- Dispositivo: {value(bug.dispositivo)}
- Resolucion: {value(bug.resolucion)}
- Sistema operativo: {value(bug.sistema_operativo)}
- Stack trace: {value(bug.stack_trace)}
- Error tecnico: {value(bug.error_tecnico)}
- Logs relevantes: {value(bug.logs_relevantes)}

## Trazabilidad
- Bug interno: {value(bug.codigo)}
- Ticket externo:
{chr(10).join(external)}
- Dedupe hash: {value(bug.dedupe_hash)}
- Asignado a: {value(bug.asignado_a)}
- Estado: {value(bug.estado)}
"""


async def create_bug_external_link(db: AsyncSession, bug_id: UUID, payload: schemas.BugExternalLinkCreate, created_by: Optional[UUID]):
    bug = await get_bug_issue(db, bug_id)
    if not bug:
        return None
    link = models.ExternalIssueLink(
        bug_id=bug.id,
        provider_id=payload.provider_id,
        proyecto_id=bug.proyecto_id,
        build_id=bug.build_id,
        test_run_id=bug.test_run_id,
        ejecucion_id=bug.ejecucion_id,
        snapshot_id=bug.snapshot_id,
        external_issue_id=payload.external_issue_id,
        external_issue_url=payload.external_issue_url,
        dedupe_hash=bug.dedupe_hash,
        status=payload.status,
        metadata_json=payload.metadata_json,
        created_by=created_by,
    )
    db.add(link)
    bug.external_provider = payload.provider_id
    bug.external_issue_id = payload.external_issue_id
    bug.external_issue_url = payload.external_issue_url
    bug.external_sync_status = "linked"
    bug.external_last_sync_at = utc_now()
    bug.updated_at = utc_now()
    await db.commit()
    await db.refresh(link)
    return link


async def list_bug_external_links(db: AsyncSession, bug_id: UUID):
    result = await db.execute(select(models.ExternalIssueLink).filter(models.ExternalIssueLink.bug_id == bug_id).order_by(models.ExternalIssueLink.created_at.desc()))
    return result.scalars().all()


async def delete_bug_external_link(db: AsyncSession, bug_id: UUID, link_id: UUID):
    result = await db.execute(delete(models.ExternalIssueLink).where(models.ExternalIssueLink.bug_id == bug_id, models.ExternalIssueLink.id == link_id))
    await db.commit()
    return (getattr(result, "rowcount", 0) or 0) > 0


async def bug_external_preview(db: AsyncSession, bug_id: UUID, provider_id: str = "redmine"):
    bug = await get_bug_issue(db, bug_id)
    if not bug:
        return None
    return {
        "provider_id": provider_id,
        "subject": f"{bug.codigo} - {bug.titulo}",
        "markdown": generate_bug_markdown(bug),
        "metadata": {"bug_id": str(bug.id), "dedupe_hash": bug.dedupe_hash},
    }


async def summarize_project_bugs(db: AsyncSession, proyecto_id: UUID):
    bugs = (await db.execute(select(models.BugIssue).options(selectinload(models.BugIssue.attachments), selectinload(models.BugIssue.external_links)).filter(models.BugIssue.proyecto_id == proyecto_id))).scalars().unique().all()
    def count_by(field):
        data: Dict[str, int] = {}
        for bug in bugs:
            key = str(getattr(bug, field, None) or "N/D")
            data[key] = data.get(key, 0) + 1
        return data
    open_bugs = [bug for bug in bugs if bug.estado not in BUG_CLOSED_STATES]
    return {
        "total": len(bugs),
        "abiertos": len(open_bugs),
        "criticos": len([bug for bug in open_bugs if bug.severidad in {"CRITICA", "ALTA"}]),
        "bloquean_release": len([bug for bug in open_bugs if bug.bloquea_release]),
        "listos_retest": len([bug for bug in open_bugs if bug.estado == "LISTO_PARA_RETEST"]),
        "cerrados": len([bug for bug in bugs if bug.estado in BUG_CLOSED_STATES]),
        "vinculados_externos": len([bug for bug in bugs if bug.external_issue_id or bug.external_links]),
        "sin_evidencia": len([bug for bug in bugs if not bug.attachments and not (bug.metadata_json or {}).get("legacy_evidence_url")]),
        "sin_asignado": len([bug for bug in open_bugs if not bug.asignado_a]),
        "by_estado": count_by("estado"),
        "by_severidad": count_by("severidad"),
        "by_prioridad": count_by("prioridad"),
        "by_origen": count_by("origen"),
    }


async def bug_dedupe_suggestions(db: AsyncSession, proyecto_id: UUID, dedupe_hash: Optional[str] = None, q: Optional[str] = None, limit: int = 10):
    query = select(models.BugIssue).options(*_bug_options()).filter(models.BugIssue.proyecto_id == proyecto_id, models.BugIssue.estado.in_(BUG_OPEN_STATES))
    if dedupe_hash:
        query = query.filter(models.BugIssue.dedupe_hash == dedupe_hash)
    elif q:
        normalized = f"%{q.strip()}%"
        query = query.filter(or_(models.BugIssue.titulo.ilike(normalized), models.BugIssue.resultado_obtenido.ilike(normalized), models.BugIssue.error_tecnico.ilike(normalized)))
    else:
        return []
    result = await db.execute(query.order_by(models.BugIssue.created_at.desc()).limit(limit))
    return [{"bug": bug, "reason": "dedupe_hash" if dedupe_hash else "texto_similar"} for bug in result.scalars().unique().all()]


async def mark_bug_duplicate(db: AsyncSession, bug_id: UUID, duplicate_of_id: UUID, comentario: Optional[str], user_id: Optional[UUID]):
    bug = await get_bug_issue(db, bug_id)
    duplicate = await get_bug_issue(db, duplicate_of_id)
    if not bug or not duplicate:
        return None
    if bug.id == duplicate.id:
        raise ValueError("Un bug no puede marcarse como duplicado de si mismo.")
    if bug.proyecto_id != duplicate.proyecto_id:
        raise ValueError("El bug duplicado debe pertenecer al mismo proyecto.")
    bug.duplicate_of_id = duplicate_of_id
    bug.estado = "DUPLICADO"
    bug.closed_at = utc_now()
    bug.fecha_resolucion = bug.closed_at
    bug.resuelto_por = user_id
    bug.motivo_cierre = comentario or f"Duplicado de {duplicate.codigo}"
    if comentario:
        db.add(models.BugComment(bug_id=bug_id, autor_id=user_id, comentario=comentario))
    await db.commit()
    return await get_bug_issue(db, bug_id)
