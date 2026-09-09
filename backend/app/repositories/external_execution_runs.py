from .repository_context import *
from ..evidence_url_security import sanitize_evidence_url
from ..services.error_sanitizer import sanitize_external_error
from ..services.edition.usage_limits import enforce_weekly_automated_execution_limit
from ..services.ai_report_sanitizer import sanitize_ai_report_payload
from ..services.chatbot_config import normalize_chatbot_config
from ..services.api_test_runner import sanitize_api_config
from .external_api_execution import add_external_api_snapshots

def _external_api_evidence(item: schemas.ExternalExecutionCase, case: models.CasoPrueba) -> dict | None:
    """Normalize observed API evidence without allowing it to redefine expectations."""
    is_api = getattr(case.formato_prueba, "value", case.formato_prueba) == "API"
    if is_api and item.api is None:
        raise ValueError(f"El caso API {item.case_code} debe incluir api en el reporte externo")
    if not is_api and item.api is not None:
        raise ValueError(f"El caso {item.case_code} no es API y no puede incluir evidencia api")
    if item.api is None:
        return None
    raw = dict(item.api)
    raw["schema_version"] = raw.get("schema_version") or "treseko.api-result/v1"
    raw["execution_mode"] = "EXTERNA"
    raw["status"] = raw.get("status") or {
        "PASO": "PASSED",
        "FALLO": "FAILED",
        "BLOQUEADO": "BLOCKED",
    }.get(item.status.value, item.status.value)
    raw["steps"] = [step for step in (raw.get("steps") or []) if isinstance(step, dict)]
    return sanitize_ai_report_payload(raw)

def _external_chatbot_evidence(item: schemas.ExternalExecutionCase, case: models.CasoPrueba) -> dict | None:
    """Build the persisted conversational evidence from an external report.

    Observed data comes from the runner, but expected data always comes from
    the case configuration stored in Treseko. This prevents a runner from
    rewriting the criterion it is being evaluated against.
    """
    is_conversational = getattr(case.formato_prueba, "value", case.formato_prueba) == "CONVERSACIONAL"
    if is_conversational and item.chatbot is None:
        raise ValueError(f"El caso conversacional {item.case_code} debe incluir chatbot.turns en el reporte externo")
    if is_conversational and item.chatbot is not None and item.steps:
        raise ValueError(f"El caso conversacional {item.case_code} debe reportar turnos en chatbot.turns, no steps clásicos")
    if not is_conversational and item.chatbot is not None:
        raise ValueError(f"El caso {item.case_code} no es conversacional y no puede incluir evidencia chatbot")
    if item.chatbot is None:
        return None

    config = normalize_chatbot_config(case.configuracion_chatbot if isinstance(case.configuracion_chatbot, dict) else {})
    configured_turns = ((config.get("conversation") or {}).get("turns") or []) if isinstance(config, dict) else []
    raw = item.chatbot.model_dump(mode="json")
    canonical_turns = []
    for position, turn in enumerate(raw.get("turns") or []):
        observed = dict(turn) if isinstance(turn, dict) else {}
        technical_index = position
        configured = configured_turns[position] if position < len(configured_turns) and isinstance(configured_turns[position], dict) else {}
        expected = configured.get("expected") if isinstance(configured.get("expected"), dict) else {}
        observed["index"] = position + 1
        observed["technical_index"] = technical_index
        observed["expected"] = expected
        observed["status"] = str(observed.get("status") or "").upper()
        canonical_turns.append(observed)

    result = dict(raw)
    result["schema_version"] = 1
    result["protocol"] = raw.get("protocol") or "treseko.chatbot/v1"
    result["conversation_strategy"] = raw.get("conversation_strategy") or "external_api"
    result["execution_mode"] = "EXTERNA"
    result["status"] = item.status.value
    result["turns"] = canonical_turns
    if not result.get("session_id"):
        first_request = canonical_turns[0].get("request") if canonical_turns and isinstance(canonical_turns[0].get("request"), dict) else {}
        request_body = first_request.get("body") if isinstance(first_request, dict) else {}
        if isinstance(request_body, dict) and request_body.get("session_id"):
            result["session_id"] = str(request_body["session_id"])
    result["assertions"] = [
        assertion
        for turn in canonical_turns
        for assertion in (turn.get("assertions") if isinstance(turn.get("assertions"), list) else [])
    ]
    result["http_errors"] = raw.get("http_errors") or [
        {"technical_index": turn.get("technical_index"), "status_code": turn.get("statusCode") or turn.get("status_code")}
        for turn in canonical_turns
        if int(turn.get("statusCode") or turn.get("status_code") or 0) >= 400
    ]
    performance = dict(raw.get("performance") or {})
    latencies = [int(turn.get("latencyMs") or turn.get("latency_ms") or 0) for turn in canonical_turns]
    performance["turn_count"] = len(canonical_turns)
    performance["total_latency_ms"] = int(performance.get("total_latency_ms") or sum(latencies))
    performance["p95_latency_ms"] = int(performance.get("p95_latency_ms") or (sorted(latencies)[min(len(latencies) - 1, max(0, int(len(latencies) * .95) - 1))] if latencies else 0))
    performance["http_error_count"] = int(performance.get("http_error_count") or len([turn for turn in canonical_turns if int(turn.get("statusCode") or turn.get("status_code") or 0) >= 400]))
    result["performance"] = performance
    return sanitize_ai_report_payload(result)

def _sanitize_external_execution_text(value: Optional[str], *, max_len: int) -> Optional[str]:
    if value is None or not str(value).strip():
        return value
    return sanitize_external_error(value, max_len=max_len)


async def record_external_execution_report(
    db: AsyncSession,
    payload: schemas.ExternalExecutionReport,
    user: models.Usuario,
):
    from .. import access_control

    case_final_statuses = {
        models.EstadoResultado.PASO,
        models.EstadoResultado.FALLO,
        models.EstadoResultado.BLOQUEADO,
    }
    step_statuses = case_final_statuses | {models.EstadoResultado.SIN_CORRER}

    org_result = await db.execute(
        select(models.Organizacion).filter(
            models.Organizacion.codigo == payload.solution_code,
            models.Organizacion.activo.is_(True),
        )
    )
    org = org_result.scalar_one_or_none()
    if not org:
        raise ValueError("La solucion indicada no existe")

    project_result = await db.execute(
        select(models.Proyecto).filter(
            models.Proyecto.codigo == payload.project_code,
            models.Proyecto.organizacion_id == org.id,
        )
    )
    project = project_result.scalar_one_or_none()
    if not project:
        raise ValueError("El proyecto indicado no existe en la solucion")
    await access_control.require_project_access(db, user, project.id, "edit")

    component_result = await db.execute(
        select(models.Componente).filter(
            models.Componente.codigo == payload.component_code,
            models.Componente.proyecto_id == project.id,
        )
    )
    component = component_result.scalar_one_or_none()
    if not component:
        raise ValueError("El componente indicado no existe en el proyecto")

    build_result = await db.execute(
        select(models.Build).filter(
            models.Build.codigo == payload.build_code,
            models.Build.proyecto_id == project.id,
            models.Build.componente_id == component.id,
        )
    )
    build = build_result.scalar_one_or_none()
    if not build:
        raise ValueError("La build indicada no existe en el componente")
    if not access_control.is_build_active(build):
        raise ValueError("La build indicada esta inactiva y no permite reportar ejecuciones")

    run = None
    if payload.external_run_id:
        run_result = await db.execute(
            select(models.TestRun).filter(
                models.TestRun.proyecto_id == project.id,
                models.TestRun.build_id == build.id,
                models.TestRun.origen == "EXTERNAL_API",
                models.TestRun.external_run_id == payload.external_run_id,
            )
        )
        run = run_result.scalar_one_or_none()

    assigned_result = await db.execute(
        select(models.BuildCaso.caso_id).filter(models.BuildCaso.build_id == build.id)
    )
    assigned_case_ids = set(assigned_result.scalars().all())

    case_codes = [item.case_code for item in payload.cases]
    cases_result = await db.execute(
        select(models.CasoPrueba).filter(
            models.CasoPrueba.codigo.in_(case_codes),
            models.CasoPrueba.proyecto_id == project.id,
            models.CasoPrueba.componente_id == component.id,
            models.CasoPrueba.activo == True,
        )
    )
    cases_by_code = {case.codigo: case for case in cases_result.scalars().all()}
    missing_or_unassigned = [
        case_code
        for case_code in case_codes
        if case_code not in cases_by_code or cases_by_code[case_code].id not in assigned_case_ids
    ]
    if missing_or_unassigned:
        raise ValueError(
            "Los casos no existen, no pertenecen al componente o no estan asignados a la build: "
            + ", ".join(sorted(set(missing_or_unassigned)))
        )

    existing_case_ids: set = set()
    if run:
        existing_result = await db.execute(
            select(models.EjecucionCaso.caso_id).filter(models.EjecucionCaso.test_run_id == run.id)
        )
        existing_case_ids = set(existing_result.scalars().all())
    requested_case_ids = {cases_by_code[case_code].id for case_code in case_codes}
    new_execution_count = len(requested_case_ids - existing_case_ids)
    await enforce_weekly_automated_execution_limit(db, solution_id=org.id, increment=new_execution_count)

    processed = 0
    results: list[schemas.ExternalExecutionCaseResult] = []

    for item in payload.cases:
        item_evidence_url = sanitize_evidence_url(item.evidence_url)
        item_observations = _sanitize_external_execution_text(item.observations, max_len=4000)
        if item.status not in case_final_statuses:
            raise ValueError(f"Estado final invalido para caso {item.case_code}. Usa PASO, FALLO o BLOQUEADO.")
        invalid_step = next((step for step in item.steps if step.status not in step_statuses), None)
        if invalid_step:
            raise ValueError(f"Estado invalido en caso {item.case_code}, paso {invalid_step.number}.")

        case = cases_by_code[item.case_code]
        chatbot_evidence = _external_chatbot_evidence(item, case)
        api_evidence = _external_api_evidence(item, case)
        observed_api_or_chatbot = api_evidence or chatbot_evidence or {}

        original_steps_result = await db.execute(
            select(models.PasoPrueba)
            .filter(models.PasoPrueba.caso_id == case.id)
            .order_by(models.PasoPrueba.numero_paso)
        )
        original_steps = original_steps_result.scalars().all()
        known_numbers = {step.numero_paso for step in original_steps}
        reported_numbers = [step.number for step in item.steps]
        duplicate_numbers = sorted({number for number in reported_numbers if reported_numbers.count(number) > 1})
        if duplicate_numbers:
            raise ValueError(f"El caso {item.case_code} contiene pasos duplicados: {duplicate_numbers}")
        unknown_numbers = sorted(set(reported_numbers) - known_numbers)
        if original_steps and unknown_numbers:
            raise ValueError(f"El caso {item.case_code} contiene pasos inexistentes: {unknown_numbers}")
        if original_steps and item.status == models.EstadoResultado.PASO and set(reported_numbers) != known_numbers:
            missing_numbers = sorted(known_numbers - set(reported_numbers))
            raise ValueError(f"El caso {item.case_code} marcado como PASO debe reportar todos sus pasos. Faltan: {missing_numbers}")

        if not run:
            run = models.TestRun(
                proyecto_id=project.id,
                build_id=build.id,
                origen="EXTERNAL_API",
                external_run_id=payload.external_run_id,
                nombre=f"External API - {payload.external_run_id or utc_now().isoformat()}",
                entorno=payload.environment or "qa",
                estado_run=models.EstadoRun.ABIERTO,
                creado_por=user.id,
            )
            db.add(run)
            await db.flush()

        existing_result = await db.execute(
            select(models.EjecucionCaso).filter(
                models.EjecucionCaso.test_run_id == run.id,
                models.EjecucionCaso.caso_id == case.id,
            )
        )
        execution = existing_result.scalar_one_or_none()
        if execution and not payload.overwrite:
            raise ValueError(f"El caso {item.case_code} ya fue reportado en este external_run_id")

        now = utc_now()
        if execution:
            await db.execute(delete(models.SnapshotPaso).where(models.SnapshotPaso.ejecucion_caso_id == execution.id))
            execution.estado_resultado = item.status
            execution.duracion_segundos = max(
                0,
                item.duration_seconds or round(
                    float((observed_api_or_chatbot.get("duration_ms") or observed_api_or_chatbot.get("performance", {}).get("total_latency_ms", 0)) or 0) / 1000
                ),
            )
            execution.observaciones = item_observations
            execution.fecha_ejecucion = now
            execution.ejecutado_por = user.id
            execution.version_ejecutada = case.version
            execution.execution_mode = models.ExecutionMode.EXTERNA
            if chatbot_evidence is not None:
                execution.chatbot_config_snapshot = sanitize_ai_report_payload(
                    normalize_chatbot_config(case.configuracion_chatbot if isinstance(case.configuracion_chatbot, dict) else {})
                )
                execution.chatbot_resultado = chatbot_evidence
            if api_evidence is not None:
                execution.api_config_snapshot = sanitize_api_config(case.configuracion_api if isinstance(case.configuracion_api, dict) else {})
                execution.api_resultado = api_evidence
        else:
            execution = models.EjecucionCaso(
                test_run_id=run.id,
                caso_id=case.id,
                version_ejecutada=case.version,
                estado_resultado=item.status,
                execution_mode=models.ExecutionMode.EXTERNA,
                ejecutado_por=user.id,
                duracion_segundos=max(
                    0,
                    item.duration_seconds or round(
                        float((observed_api_or_chatbot.get("duration_ms") or observed_api_or_chatbot.get("performance", {}).get("total_latency_ms", 0)) or 0) / 1000
                    ),
                ),
                observaciones=item_observations,
                fecha_ejecucion=now,
                chatbot_config_snapshot=(
                    sanitize_ai_report_payload(normalize_chatbot_config(case.configuracion_chatbot or {}))
                    if chatbot_evidence is not None else {}
                ),
                chatbot_resultado=chatbot_evidence or {},
                api_config_snapshot=(
                    sanitize_api_config(case.configuracion_api if isinstance(case.configuracion_api, dict) else {})
                    if api_evidence is not None else {}
                ),
                api_resultado=api_evidence or {},
            )
            db.add(execution)
            await db.flush()

        external_steps = {step.number: step for step in item.steps}

        if chatbot_evidence is not None:
            configured_turns = (
                (normalize_chatbot_config(case.configuracion_chatbot or {}).get("conversation") or {}).get("turns") or []
            )
            for position, turn in enumerate(chatbot_evidence.get("turns") or []):
                configured = configured_turns[position] if position < len(configured_turns) and isinstance(configured_turns[position], dict) else {}
                expected = configured.get("expected") if isinstance(configured.get("expected"), dict) else {}
                response_text = str(turn.get("responseText") or turn.get("response_text") or "")
                assertions = turn.get("assertions") if isinstance(turn.get("assertions"), list) else []
                comments = response_text
                if assertions:
                    comments = f"{comments}\nAserciones: {json.dumps(assertions, ensure_ascii=False, default=str)}".strip()
                db.add(models.SnapshotPaso(
                    ejecucion_caso_id=execution.id,
                    numero_paso=position + 1,
                    accion_congelada=str(turn.get("message") or "Mensaje conversacional"),
                    resultado_esperado_congelado=json.dumps(expected, ensure_ascii=False, default=str) if expected else "Configuración conversacional",
                    estado_paso=(
                        models.EstadoResultado.PASO
                        if turn.get("status") == "PASSED"
                        else models.EstadoResultado.BLOQUEADO
                        if turn.get("status") == "BLOCKED"
                        else models.EstadoResultado.FALLO
                    ),
                    comentarios=comments[:4000] if comments else None,
                    evidencia_url=sanitize_evidence_url(turn.get("evidence_url")) or item_evidence_url,
                    error_log=_sanitize_external_execution_text(turn.get("error"), max_len=12000),
                ))
        elif api_evidence is not None:
            add_external_api_snapshots(
                db,
                execution_id=execution.id,
                case_config=case.configuracion_api,
                api_evidence=api_evidence,
            )
        elif original_steps:
            for original in original_steps:
                reported = external_steps.get(original.numero_paso)
                reported_observations = _sanitize_external_execution_text(reported.observations, max_len=4000) if reported else None
                reported_error_log = _sanitize_external_execution_text(reported.error_log, max_len=12000) if reported else None
                db.add(models.SnapshotPaso(
                    ejecucion_caso_id=execution.id,
                    paso_id=original.id,
                    numero_paso=original.numero_paso,
                    accion_congelada=original.accion,
                    datos_congelados=original.datos,
                    resultado_esperado_congelado=original.resultado_esperado,
                    estado_paso=reported.status if reported else models.EstadoResultado.SIN_CORRER,
                    comentarios=reported_observations,
                    evidencia_url=(sanitize_evidence_url(reported.evidence_url) if reported else None) or (item_evidence_url if original.numero_paso == 1 else None),
                    error_log=reported_error_log,
                ))
        else:
            known_numbers = set()

        for reported in item.steps:
            if reported.number in known_numbers:
                continue
            db.add(models.SnapshotPaso(
                ejecucion_caso_id=execution.id,
                numero_paso=reported.number,
                accion_congelada=f"Paso externo {reported.number}",
                resultado_esperado_congelado="Reportado por runner externo",
                estado_paso=reported.status,
                comentarios=_sanitize_external_execution_text(reported.observations, max_len=4000),
                evidencia_url=sanitize_evidence_url(reported.evidence_url) or item_evidence_url,
                error_log=_sanitize_external_execution_text(reported.error_log, max_len=12000),
            ))

        if not original_steps and not item.steps and chatbot_evidence is None and api_evidence is None:
            db.add(models.SnapshotPaso(
                ejecucion_caso_id=execution.id,
                numero_paso=1,
                accion_congelada="Ejecucion automatizada externa",
                resultado_esperado_congelado="Resultado reportado por runner externo",
                estado_paso=item.status,
                comentarios=item_observations,
                evidencia_url=item_evidence_url,
            ))

        case.ultimo_resultado = item.status.value
        case.ultima_ejecucion_por = user.id
        case.ultima_ejecucion_fecha = now

        processed += 1
        results.append(schemas.ExternalExecutionCaseResult(
            case_code=item.case_code,
            status="saved",
            execution_id=execution.id,
            final_status=item.status,
        ))

    await db.commit()
    return schemas.ExternalExecutionReportResponse(
        run_id=run.id if run else None,
        external_run_id=payload.external_run_id,
        solution_code=payload.solution_code,
        project_code=payload.project_code,
        component_code=payload.component_code,
        build_code=payload.build_code,
        processed=processed,
        rejected=0,
        results=results,
    )

async def get_test_runs_proyecto(
    db: AsyncSession,
    proyecto_id: UUID,
    skip: int = 0,
    limit: int = 100,
    build_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    case_query: Optional[str] = None,
    case_code: Optional[str] = None,
    status: Optional[str] = None,
    origin: Optional[str] = None,
    runner_id: Optional[UUID] = None,
    environment_id: Optional[UUID] = None,
    dataset_id: Optional[UUID] = None,
    date_from: Optional[datetime] = None,
    date_to: Optional[datetime] = None,
    has_evidence: Optional[bool] = None,
    version_executed: Optional[int] = None,
    ai_review_status: Optional[str] = None,
):
    query = select(models.TestRun).filter(models.TestRun.proyecto_id == proyecto_id)
    if build_id:
        query = query.filter(models.TestRun.build_id == build_id)
    if origin:
        query = query.filter(models.TestRun.origen == origin)
    if runner_id:
        query = query.filter(models.TestRun.creado_por == runner_id)
    if environment_id:
        query = query.filter(models.TestRun.entorno_id == environment_id)
    if dataset_id:
        query = query.filter(models.TestRun.dataset_id == dataset_id)
    if date_from:
        query = query.filter(models.TestRun.fecha_creacion >= ensure_utc(date_from))
    if date_to:
        query = query.filter(models.TestRun.fecha_creacion <= ensure_utc(date_to))

    if component_id or case_query or case_code or status or version_executed is not None or has_evidence is not None or ai_review_status:
        query = query.join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
        if component_id or case_query or case_code:
            query = query.join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        if component_id:
            query = query.filter(models.CasoPrueba.componente_id == component_id)
        if case_code:
            query = query.filter(func.lower(models.CasoPrueba.codigo) == case_code.lower())
        if case_query:
            pattern = f"%{case_query.lower()}%"
            query = query.filter(or_(
                func.lower(models.CasoPrueba.codigo).like(pattern),
                func.lower(models.CasoPrueba.titulo).like(pattern),
            ))
        if status:
            query = query.filter(models.EjecucionCaso.estado_resultado == status)
        if version_executed is not None:
            query = query.filter(models.EjecucionCaso.version_ejecutada == version_executed)
        if ai_review_status:
            query = query.filter(models.EjecucionCaso.ai_review_status == ai_review_status)
        if has_evidence is not None:
            query = query.outerjoin(models.SnapshotPaso, models.SnapshotPaso.ejecucion_caso_id == models.EjecucionCaso.id)
            query = query.outerjoin(models.SnapshotAttachment, models.SnapshotAttachment.snapshot_id == models.SnapshotPaso.id)
            evidence_filter = or_(
                models.SnapshotPaso.evidencia_url.isnot(None),
                models.SnapshotAttachment.attachment_id.isnot(None),
            )
            query = query.filter(evidence_filter if has_evidence else ~evidence_filter)
        # ``TestRun`` contiene columnas JSON. PostgreSQL no puede aplicar
        # ``DISTINCT`` a una fila que las incluya porque JSON no tiene un
        # operador de igualdad. Agrupar por la clave primaria deduplica las
        # filas introducidas por los joins de filtros sin comparar esos campos.
        query = query.group_by(models.TestRun.id)

    result = await db.execute(
        query
        .order_by(models.TestRun.fecha_creacion.desc())
        .offset(skip)
        .limit(limit)
    )
    return result.scalars().all()
