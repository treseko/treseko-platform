from .repository_context import *
from sqlalchemy import exists
from ..services.conversational_bug_context import build_conversational_context, conversational_context_row_values
from ..services.chatbot_turns import find_executed_turn
from .bug_issue_management import link_bug_to_execution
from .bug_payload_validation import compute_conversational_bug_dedupe_hash, normalize_chatbot_finding_type
from ..services.api_evidence_policy import (
    evidence_policy_marker,
    public_test_data_evidence_enabled,
)
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
    if execution.estado_resultado not in {models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO} and not execution.ai_human_review_required:
        raise ValueError("Solo se puede crear bug directo desde una ejecución fallida, bloqueada o con revisión humana requerida.")
    is_chatbot = str(getattr(case.formato_prueba, "value", case.formato_prueba) or "").upper() == "CONVERSACIONAL"
    chatbot_result = execution.chatbot_resultado if isinstance(execution.chatbot_resultado, dict) else {}
    chatbot_config = execution.chatbot_config_snapshot if isinstance(execution.chatbot_config_snapshot, dict) else {}
    if not is_chatbot and (payload.chatbot_turn_index is not None or payload.chatbot_finding_type is not None):
        raise ValueError("Una ejecución clásica no admite datos de turno Chatbot.")
    if is_chatbot and not isinstance(chatbot_result.get("turns"), list):
        raise ValueError("La ejecución Chatbot no tiene turnos enviados para registrar un bug.")
    if is_chatbot and chatbot_result:
        force_new_bug = bool((payload.metadata_json or {}).get("force_new_bug"))
        build = await db.get(models.Build, run.build_id) if run.build_id else None
        component_id = case.componente_id or (build.componente_id if build else None)
        component = await db.get(models.Componente, component_id) if component_id else None
        environment = await db.get(models.Entorno, run.entorno_id) if run.entorno_id else None
        requested_turn = payload.chatbot_turn_index
        turns = chatbot_result.get("turns") if isinstance(chatbot_result.get("turns"), list) else []
        turn = find_executed_turn(turns, requested_turn) if requested_turn is not None else None
        finding_type = payload.chatbot_finding_type
        if turn and not finding_type:
            if int(turn.get("status_code") or turn.get("statusCode") or 0) >= 400:
                finding_type = "HTTP_FAILURE"
            elif any(not bool(item.get("passed")) for item in (turn.get("assertions") or []) if isinstance(item, dict)):
                finding_type = "TURN_EXPECTATION_MISMATCH"
            elif any(item.get("status") in {"FAILED", "BLOCKED"} for item in (chatbot_result.get("tools") or []) if isinstance(item, dict)):
                finding_type = "TOOL_FAILURE"
            else:
                finding_type = "INVALID_RESPONSE"
        if not finding_type and any(item.get("status") in {"FAILED", "BLOCKED"} for item in (chatbot_result.get("tools") or []) if isinstance(item, dict)):
            finding_type = "TOOL_FAILURE"
        finding_type = normalize_chatbot_finding_type(finding_type)
        if requested_turn is not None and turn is None:
            raise ValueError("El turno Chatbot indicado no existe en la ejecución.")
        scope_label = f"turno {requested_turn + 1}" if requested_turn is not None else "evaluación"
        title_suffix = f": {scope_label} Chatbot"
        public_evidence = public_test_data_evidence_enabled(
            environment=environment,
            case=case,
            execution=execution,
            config=chatbot_config,
            result=chatbot_result,
        )
        context = build_conversational_context(execution=execution, run=run, case=case, chatbot_config=chatbot_config, chatbot_result=chatbot_result, requested_turn=requested_turn, finding_type=finding_type, environment=environment, public_evidence=public_evidence)
        safe_result = context["execution_snapshot"]
        safe_turns = context["conversation_turns"]
        failed_context_turn = next((item for item in safe_turns if item.get("index") == requested_turn), None)
        if turn is not None:
            expected = json.dumps((failed_context_turn or {}).get("expected") or "El turno debe cumplir el criterio configurado.", ensure_ascii=False, indent=2)
            obtained = json.dumps((failed_context_turn or {}).get("observed") or {}, ensure_ascii=False, indent=2)
            description = f"El chatbot no cumplió el criterio esperado en el {scope_label}. Categoría: {finding_type}."
        else:
            expected = "La conversación debe completar todas las validaciones configuradas."
            obtained = chatbot_result.get("summary") or execution.observaciones or "La evaluación Chatbot falló o quedó bloqueada."
            description = f"La conversación no cumplió el criterio configurado. Categoría: {finding_type}."
        result_text = json.dumps(safe_turns if requested_turn is not None else context["execution_snapshot"], ensure_ascii=False, indent=2)
        execution_mode_value = str(getattr(execution.execution_mode, "value", execution.execution_mode or "IA")).upper()
        base = {
            "proyecto_id": run.proyecto_id, "componente_id": component_id, "caso_id": case.id, "test_run_id": run.id,
            "ejecucion_id": execution.id, "build_id": run.build_id,
            "entorno_id": run.entorno_id, "dataset_id": run.dataset_id,
            "execution_mode": execution_mode_value, "case_code": case.codigo,
            "case_master_id": case.master_id, "case_version": execution.version_ejecutada,
            "build_code": (build.codigo or build.nombre) if build else None,
            "chatbot_turn_index": requested_turn, "chatbot_finding_type": finding_type,
            "titulo": f"{case.codigo or 'Caso'} - {case.titulo}{title_suffix}",
            "descripcion": description, "resultado_esperado": expected,
            "resultado_obtenido": obtained if isinstance(obtained, str) else result_text,
            "precondiciones": case.precondiciones,
            "pasos_reproduccion": "\n".join([f"1. Iniciar una sesión nueva.", *[f"{index + 2}. Enviar el mensaje y esperar la respuesta del turno {index + 1}." for index, _ in enumerate(safe_turns[: (requested_turn + 1) if requested_turn is not None else len(safe_turns)])], f"{len(safe_turns) + 2}. Comparar la respuesta obtenida contra el resultado esperado."]),
            "datos_prueba": result_text, "logs_relevantes": json.dumps(context["technical_evidence"], ensure_ascii=False, indent=2),
            "notas_qa": payload.comentario or payload.notas_qa or execution.ai_review_note or execution.observaciones,
            "origen": "chatbot_evaluation", "tipo_contexto": "CONVERSACIONAL", "severidad": "ALTA" if requested_turn is not None else "MEDIA",
            "prioridad": "P1" if requested_turn is not None else "P2", "criticidad": "ALTA" if requested_turn is not None else "MEDIA",
            "ambiente_nombre": environment.nombre if environment else run.entorno,
            "ambiente_url": environment.url if environment else None,
            "version_app": build.nombre if build else None,
            "modulo_funcional": component.nombre if component else None,
            "metadata_json": {"chatbot": True, "format": "CONVERSACIONAL", "chatbot_scope": "turn" if turn is not None else "execution", "chatbot_turn_index": requested_turn, "chatbot_finding_type": finding_type, "workflow_version": context["evaluation"].get("workflow_version"), "execution_status": context["execution_snapshot"].get("status"), "report_decision": "CREATE_DIFFERENT" if force_new_bug else "CREATE", "public_test_data": public_evidence, **context.get("evidence_policy", {}),},
        }
        dedupe_hash = compute_conversational_bug_dedupe_hash(base)
        # Cross-execution matches are intentionally not auto-linked. The
        # frontend applies the same related-bug decision used by classic
        # executions; this endpoint remains idempotent only for the exact
        # execution/turn occurrence.
        existing = await find_existing_failure_bug(db, proyecto_id=run.proyecto_id, ejecucion_id=execution.id, chatbot_turn_index=requested_turn, chatbot_finding_type=finding_type, dedupe_hash=dedupe_hash)
        if existing and (existing.chatbot_turn_index == requested_turn) and not force_new_bug:
            if not getattr(existing, "conversational_context", None):
                db.add(models.BugConversationalContext(
                    bug_id=existing.id,
                    **conversational_context_row_values(context),
                ))
                await db.commit()
                return await get_bug_issue(db, existing.id)
            return existing
        base["dedupe_hash"] = dedupe_hash
        bug = await create_bug_issue(
            db,
            schemas.BugIssueCreate(**base),
            created_by,
            from_failure=not force_new_bug,
            commit=False,
        )
        if bug and not getattr(bug, "conversational_context", None):
            context_row = models.BugConversationalContext(
                bug_id=bug.id,
                **conversational_context_row_values(context),
            )
            db.add(context_row)
            await db.commit()
            return await get_bug_issue(db, bug.id)
        return bug
    is_api = str(getattr(case.formato_prueba, "value", case.formato_prueba) or "").upper() == "API"
    force_new_bug = bool((payload.metadata_json or {}).get("force_new_bug")) if is_api else False
    existing_execution_bug = await find_existing_failure_bug(
        db,
        proyecto_id=run.proyecto_id,
        ejecucion_id=execution.id,
    )
    if existing_execution_bug and not force_new_bug:
        return existing_execution_bug
    snapshot_result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id == execution.id)
        .filter(models.SnapshotPaso.estado_paso.in_([models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO]))
        .order_by(models.SnapshotPaso.numero_paso)
    )
    snapshot = snapshot_result.scalars().first()
    # API evidence is stored on EjecucionCaso, not in classic step snapshots.
    # Keep the API bug linked to the execution so BugApiEvidence can rebuild
    # the request, response and assertions in Bug Tracker.
    if snapshot and not force_new_bug and not is_api:
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
    public_evidence = public_test_data_evidence_enabled(environment=environment, case=case, execution=execution)
    dataset = None
    if run.dataset_id:
        dataset = (await db.execute(select(models.EntornoDataset).filter(models.EntornoDataset.id == run.dataset_id))).scalar_one_or_none()
    resolved_dataset = await resolve_case_dataset(db, case.id, run.build_id, run.entorno_id, run.dataset_id)
    dataset_values = (resolved_dataset or {}).get("dataset_resuelto") or []
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
        "descripcion": (case.descripcion or execution.observaciones or "Fallo detectado durante la ejecucion de prueba."),
        "resultado_esperado": (case.postcondiciones or f"El caso {case.codigo or case.titulo} debe completar su objetivo sin fallos ni bloqueos."),
        "resultado_obtenido": execution.observaciones or "La ejecucion no cumplio el resultado esperado.",
        "pasos_reproduccion": "\n".join([
            f"1. Ejecutar caso {case.codigo or case.titulo} en build {build.nombre if build else run.nombre}.",
            "2. Reproducir el flujo guardado en la ejecucion.",
            "3. Validar el resultado final registrado.",
        ]),
        "notas_qa": execution.observaciones,
        "precondiciones": case.precondiciones,
        "datos_prueba": json.dumps(dataset_values, ensure_ascii=False, indent=2) if dataset_values else None,
        "origen": "ejecucion_manual" if execution.execution_mode == models.ExecutionMode.MANUAL else str(execution.execution_mode.value).lower(),
        "tipo_contexto": "API" if is_api else "CLASICO",
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
            "dataset_resolved_values": dataset_values,
            "execution_status": execution.estado_resultado.value,
            "execution_date": isoformat_utc(execution.fecha_ejecucion),
            "executed_by": str(execution.ejecutado_por),
            "case_version": execution.version_ejecutada,
            "created_from": "execution",
            "case_description": case.descripcion,
            "case_preconditions": case.precondiciones,
            "case_postconditions": case.postcondiciones,
            "format": "API" if is_api else "CLASICO",
            "public_test_data": public_evidence,
            **evidence_policy_marker(public_evidence),
        },
    }
    if is_api:
        api_result = execution.api_resultado if isinstance(execution.api_resultado, dict) else {}
        base["metadata_json"] = {
            **(base.get("metadata_json") or {}),
            "evidence_policy": api_result.get("evidence_policy") or {},
            "api_evidence_schema": api_result.get("schema_version"),
            "api_evidence_sha256": api_result.get("evidence_sha256"),
            "api_variables_used": api_result.get("variables_used") or {},
            "api_dynamic_variables": api_result.get("dynamic_variables") or {},
            "api_assertions_count": sum(
                len(item.get("assertions") or [])
                for item in (api_result.get("steps") or [])
                if isinstance(item, dict)
            ),
            "api_evidence_frozen_at": isoformat_utc(execution.fecha_ejecucion),
            "public_test_data": public_test_data_evidence_enabled(environment=environment, case=case, execution=execution, config=execution.api_config_snapshot or {}, result=api_result),
        }
    overrides = payload.model_dump(exclude_unset=True)
    comentario = overrides.pop("comentario", None)
    override_metadata = overrides.pop("metadata_json", None)
    base.update({key: value for key, value in overrides.items() if value is not None})
    if comentario:
        base["notas_qa"] = comentario
    if override_metadata:
        base["metadata_json"] = {**(base.get("metadata_json") or {}), **override_metadata}
    base["dedupe_hash"] = compute_bug_dedupe_hash(base)
    existing_dedupe_bug = await find_existing_failure_bug(
        db,
        proyecto_id=run.proyecto_id,
        ejecucion_id=execution.id,
        dedupe_hash=base["dedupe_hash"],
    )
    if existing_dedupe_bug and not force_new_bug:
        return existing_dedupe_bug
    if is_api:
        base["metadata_json"] = {**(base.get("metadata_json") or {}), "format": "API", "report_decision": "CREATE_DIFFERENT" if force_new_bug else "CREATE"}
    return await create_bug_issue(db, schemas.BugIssueCreate(**base), created_by, from_failure=not force_new_bug)
def generate_bug_markdown(bug: models.BugIssue) -> str:
    metadata = bug.metadata_json or {}
    context_type = getattr(bug, "tipo_contexto", "CLASICO")
    context_type = getattr(context_type, "value", context_type)
    public_test_data = (
        str(context_type or "CLASICO").upper() in {"API", "CLASICO", "CONVERSACIONAL"}
        and public_test_data_evidence_enabled(metadata=metadata)
    )

    def value(item, key: Any = None):
        # Synthetic fixture projects may explicitly opt into public data for
        # reproducible evidence. Every other export keeps redaction.
        safe_item = item if public_test_data else _redact_bug_export_value(item, key)
        if isinstance(safe_item, (dict, list)):
            safe_item = json.dumps(safe_item, ensure_ascii=False, indent=2)
        return _escape_bug_export_markdown(safe_item)

    api_evidence_sections = ""
    if public_test_data and str(context_type or "").upper() == "API":
        variables = metadata.get("api_variables_used") if isinstance(metadata.get("api_variables_used"), dict) else {}
        variable_lines = [f"- {value(name)}: {value(item, name)}" for name, item in variables.items()] or ["- N/D"]
        api_evidence_sections = f"""
## Evidencia API para replicacion
- Política: datos públicos para replicación
- Schema: {value(metadata.get('api_evidence_schema'))}
- Hash de evidencia: {value(metadata.get('api_evidence_sha256'))}
- Aserciones conservadas: {value(metadata.get('api_assertions_count'))}
- Variables utilizadas:
{chr(10).join(variable_lines)}
- Variables dinámicas: {value(metadata.get('api_dynamic_variables'))}
"""
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
    conversational = getattr(bug, "conversational_context", None)
    conversation_sections = ""
    if str(getattr(bug, "tipo_contexto", "CLASICO") or "CLASICO").upper() == "CONVERSACIONAL" and conversational:
        context = conversational
        turns = context.conversation_turns or []
        turn_lines = []
        for turn in turns:
            safe_turn = turn if public_test_data else _redact_bug_export_value(turn)
            turn_lines.append(
                f"### Turno {safe_turn.get('turn_number', safe_turn.get('index', 'N/D'))}\n"
                f"- Estado: {value(safe_turn.get('status'))}\n"
                f"- Mensaje: {value(safe_turn.get('message'))}\n"
                f"- Esperado: {value(safe_turn.get('expected'))}\n"
                f"- Observado: {value(safe_turn.get('observed'))}\n"
                f"- Latencia: {value(safe_turn.get('latency_ms'))} ms · HTTP {value(safe_turn.get('status_code'))}"
            )
        conversation_sections = f"""
## Contexto conversacional
- Tipo: Conversacional
- Turno afectado: {value(bug.chatbot_turn_index + 1 if bug.chatbot_turn_index is not None else 'Ejecucion completa')}
- Hallazgo: {value(bug.chatbot_finding_type)}
- Confianza: {value((context.evaluation or {}).get('confidence'))}
- Consenso: {value((context.evaluation or {}).get('consensus'))}
- Requiere revisión humana: {value((context.evaluation or {}).get('human_review_required'))}

## Línea de tiempo
{chr(10).join(turn_lines) or '- N/D'}

## Evidencia técnica conversacional
{value(context.technical_evidence)}
"""
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
{conversation_sections}
{api_evidence_sections}

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

async def summarize_project_bugs(db: AsyncSession, proyecto_id: UUID, build_id: Optional[UUID] = None, build_scope: Optional[str] = None):
    query = select(models.BugIssue).options(selectinload(models.BugIssue.attachments), selectinload(models.BugIssue.external_links)).filter(models.BugIssue.proyecto_id == proyecto_id)
    if build_id:
        if str(build_scope or "").lower() == "historical":
            history_match = exists().where(
                models.BugStatusHistory.bug_id == models.BugIssue.id,
                models.BugStatusHistory.build_id == build_id,
            )
            query = query.filter(or_(
                models.BugIssue.build_id == build_id,
                models.BugIssue.resolved_build_id == build_id,
                history_match,
            ))
        else:
            query = query.filter(models.BugIssue.build_id == build_id)
    bugs = (await db.execute(query)).scalars().unique().all()
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
    old_status = bug.estado
    bug.estado = "DUPLICADO"
    bug.closed_at = utc_now()
    bug.fecha_resolucion = bug.closed_at
    bug.resuelto_por = user_id
    bug.resolved_build_id = None
    bug.motivo_cierre = comentario or f"Duplicado de {duplicate.codigo}"
    db.add(models.BugStatusHistory(
        bug_id=bug.id, project_id=bug.proyecto_id, from_status=old_status,
        to_status=bug.estado, actor_id=user_id, close_reason=bug.motivo_cierre,
        source="mark_duplicate", occurred_at=bug.closed_at,
    ))
    if comentario:
        db.add(models.BugComment(bug_id=bug_id, autor_id=user_id, comentario=comentario))
    await db.commit()
    return await get_bug_issue(db, bug_id)
