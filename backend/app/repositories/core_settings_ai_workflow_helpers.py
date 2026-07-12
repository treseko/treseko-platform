from .legacy_common import *
from ..attachment_storage import attachment_availability_dict
from ..content_type_validation import content_matches_declared_type as _content_matches_declared_type
from ..services.edition.entitlement_service import check_limit


def _accumulate_ai_metrics(summary: Dict[str, Any], execution: models.EjecucionCaso, status: str) -> None:
    report = execution.ai_report or {}
    if not isinstance(report, dict):
        report = {}
    metrics = report.get("metrics") if isinstance(report.get("metrics"), dict) else {}
    traces = report.get("workflow_traces") if isinstance(report.get("workflow_traces"), list) else report.get("timeline") if isinstance(report.get("timeline"), list) else []
    traces = traces or []

    summary["executions"] += 1
    summary["by_status"][status] = summary["by_status"].get(status, 0) + 1
    if status == "PASO":
        summary["passed"] += 1
    elif status == "FALLO":
        summary["failed"] += 1
    elif status == "BLOQUEADO":
        summary["blocked"] += 1

    confidence = execution.ai_confidence if execution.ai_confidence is not None else report.get("confidence")
    if confidence is not None:
        summary.setdefault("_confidence_sum", 0.0)
        summary.setdefault("_confidence_count", 0)
        try:
            summary["_confidence_sum"] += float(confidence)
            summary["_confidence_count"] += 1
        except (TypeError, ValueError):
            pass

    review_status = _review_status_for_execution(execution)
    if bool(execution.ai_human_review_required or report.get("human_review_required")) or review_status == models.AiReviewStatus.REQUIERE_REVISION.value:
        summary["human_review_required"] += 1
    if review_status == models.AiReviewStatus.REVISADA.value:
        summary["human_review_reviewed"] += 1
    elif review_status == models.AiReviewStatus.REQUIERE_REVISION.value:
        summary["human_review_pending"] += 1

    category = execution.ai_failure_category or report.get("failure_category")
    if category:
        summary["failure_categories"][str(category)] = summary["failure_categories"].get(str(category), 0) + 1

    error_code = _ai_error_code_from_report(report, execution.estado_resultado)
    if error_code:
        summary["error_codes"][error_code] = summary["error_codes"].get(error_code, 0) + 1

    model = report.get("model") or (report.get("parameters") or {}).get("model")
    if model:
        summary["models"][str(model)] = summary["models"].get(str(model), 0) + 1

    prompt_tokens = _metric_number(metrics, "promptTokens", "prompt_tokens")
    completion_tokens = _metric_number(metrics, "completionTokens", "completion_tokens")
    total_tokens = _metric_number(metrics, "totalTokens", "total_tokens")
    estimated_cost = _metric_number(metrics, "estimatedCost", "estimated_cost")
    latency_ms = _metric_number(metrics, "latencyMs", "latency_ms")

    trace_latency_ms = sum(_trace_duration_ms(trace) for trace in traces if isinstance(trace, dict))
    trace_tokens = 0.0
    trace_cost = 0.0
    trace_ai_calls = 0
    for trace in traces:
        if not isinstance(trace, dict):
            continue
        trace_metrics = trace.get("metrics_json") if isinstance(trace.get("metrics_json"), dict) else trace.get("metrics") if isinstance(trace.get("metrics"), dict) else {}
        trace_total_tokens = _metric_number(trace_metrics, "totalTokens", "total_tokens")
        trace_tokens += trace_total_tokens
        trace_cost += _metric_number(trace_metrics, "estimatedCost", "estimated_cost")
        if trace_total_tokens or _metric_number(trace_metrics, "latencyMs", "latency_ms"):
            trace_ai_calls += 1

    if not total_tokens and trace_tokens:
        total_tokens = trace_tokens
    if not estimated_cost and trace_cost:
        estimated_cost = trace_cost
    if not latency_ms and trace_latency_ms:
        latency_ms = trace_latency_ms

    summary["prompt_tokens"] += int(prompt_tokens)
    summary["completion_tokens"] += int(completion_tokens)
    summary["total_tokens"] += int(total_tokens)
    summary["estimated_cost"] += float(estimated_cost)
    summary["latency_ms"] += int(latency_ms)
    summary["workflow_traces"] += len(traces)
    workflow_nodes = [
        node for node in ((report.get("workflow_snapshot") or {}).get("nodes") or [])
        if isinstance(node, dict) and node.get("enabled", True) is not False and str(node.get("type") or node.get("name") or "").lower() not in {"start", "end"}
    ]
    base_nodes = [
        node for node in workflow_nodes
        if str(node.get("type") or node.get("name") or "") in BASE_AI_WORKFLOW_NODE_TYPES
    ]
    custom_nodes = [node for node in workflow_nodes if node not in base_nodes]
    summary["workflow_nodes_configured"] = max(summary["workflow_nodes_configured"], len(workflow_nodes))
    summary["workflow_base_nodes_configured"] = max(summary["workflow_base_nodes_configured"], len(base_nodes))
    summary["workflow_custom_nodes_configured"] = max(summary["workflow_custom_nodes_configured"], len(custom_nodes))
    if total_tokens:
        summary["tokens_reported_executions"] += 1
    else:
        summary["tokens_missing_executions"] += 1
    if trace_ai_calls:
        summary.setdefault("ai_calls", 0)
        summary["ai_calls"] += trace_ai_calls

def _default_workflow_uuid(label: str) -> UUID:
    return uuid.uuid5(AI_WORKFLOW_NAMESPACE, label)

def _visible_case_filter():
    return (
        models.CasoPrueba.activo == True,
        or_(
            models.CasoPrueba.suite_id.is_(None),
            models.CasoPrueba.suite.has(models.Suite.activo == True),
        ),
    )

PLACEHOLDER_RE = re.compile(r"\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}")
CONTENT_TYPE_EXTENSIONS = {
    "image/png": "png",
    "image/jpeg": "jpg",
    "image/jpg": "jpg",
    "image/webp": "webp",
    "image/gif": "gif",
    "application/pdf": "pdf",
    "text/plain": "txt",
    "text/csv": "csv",
    "application/json": "json",
    "application/xml": "xml",
    "text/xml": "xml",
    "application/zip": "zip",
    "application/x-zip-compressed": "zip",
    "application/vnd.ms-excel": "xls",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
    "application/msword": "doc",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
    "application/vnd.ms-powerpoint": "ppt",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation": "pptx",
    "video/mp4": "mp4",
    "video/webm": "webm",
    "application/octet-stream": "bin",
}

def _attachment_to_dict(attachment: models.Attachment):
    return {
        "id": str(attachment.id),
        "filename_original": attachment.filename_original,
        "content_type": attachment.content_type,
        "size": attachment.size,
        "public_url": attachment.public_url,
        "scope": attachment.scope,
        "created_by": str(attachment.created_by),
        "created_at": attachment.created_at.isoformat() if attachment.created_at else None,
        **attachment_availability_dict(attachment),
    }


def _hash_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def _json_safe(value):
    if isinstance(value, UUID):
        return str(value)
    if hasattr(value, "value"):
        return value.value
    if isinstance(value, list):
        return [_json_safe(item) for item in value]
    if isinstance(value, dict):
        return {key: _json_safe(item) for key, item in value.items()}
    return value


def _strip_non_assignable_user_permissions(permisos):
    return {
        module: level
        for module, level in (permisos or {}).items()
        if module not in USER_ASSIGNABLE_EXCLUDED_MODULES
    }


def _strip_non_assignable_user_capabilities(permisos_detallados):
    return {
        capability: level
        for capability, level in (permisos_detallados or {}).items()
        if capability.split(".", 1)[0] not in USER_ASSIGNABLE_EXCLUDED_MODULES
    }


def _strip_non_assignable_user_modules(modulos):
    return [
        module
        for module in (modulos or [])
        if module not in USER_ASSIGNABLE_EXCLUDED_MODULES
    ]


def _modules_from_permissions_and_capabilities(permisos, permisos_detallados):
    from .auth import modules_from_permissions
    from .rbac_catalog import get_capability_module

    modules = set(modules_from_permissions(permisos))
    for capability, level in (permisos_detallados or {}).items():
        if level in {"read", "edit"}:
            module = get_capability_module(capability)
            if module:
                modules.add(module)
    return _strip_non_assignable_user_modules(sorted(modules))


def _attachment_response_with_url(attachment):
    return attachment


def _safe_artifact_filename(filename: Optional[str], content_type: str, fallback: str) -> str:
    raw = os.path.basename(filename or fallback).strip() or fallback
    safe = re.sub(r"[^A-Za-z0-9._-]+", "_", raw)
    if "." not in safe:
        safe = f"{safe}.{CONTENT_TYPE_EXTENSIONS.get(content_type, 'bin')}"
    return safe[:180]


async def _create_artifact_attachment_no_commit(
    db: AsyncSession,
    filename_original: str,
    content_type: str,
    content: bytes,
    created_by: UUID,
    proyecto_id: UUID | None = None,
    organizacion_id: UUID | None = None,
):
    if organizacion_id:
        result = await db.execute(
            select(func.coalesce(func.sum(models.Attachment.size), 0))
            .filter(models.Attachment.organizacion_id == organizacion_id)
        )
        current_bytes = int(result.scalar() or 0)
        mb = 1024 * 1024
        current_mb = (current_bytes + mb - 1) // mb
        incoming_mb = max(1, (len(content) + mb - 1) // mb)
        check = await check_limit(
            db,
            "max_storage_mb",
            int(current_mb),
            increment=int(incoming_mb),
            tenant_id=str(organizacion_id),
        )
        if not check["allowed"]:
            raise ValueError(
                "Limite de storage alcanzado para la solucion: "
                f"{current_bytes // mb} MB usados de {check['limit']} MB."
            )
    sha256 = hashlib.sha256(content).hexdigest()
    ext = CONTENT_TYPE_EXTENSIONS.get((content_type or "").split(";", 1)[0].strip().lower(), "bin")
    rel_dir = os.path.join(sha256[:2], sha256[2:4])
    abs_dir = os.path.join(ATTACHMENTS_DIR, rel_dir)
    os.makedirs(abs_dir, exist_ok=True)
    filename = f"{sha256}.{ext}"
    storage_path = os.path.join(abs_dir, filename)
    if not os.path.exists(storage_path):
        with open(storage_path, "wb") as output:
            output.write(content)
    attachment = models.Attachment(
        filename_original=filename_original,
        content_type=content_type,
        size=len(content),
        sha256=sha256,
        storage_path=storage_path.replace("\\", "/"),
        public_url=f"/static/attachments/{sha256[:2]}/{sha256[2:4]}/{filename}",
        scope="AUTOMATION_JOB",
        proyecto_id=proyecto_id,
        organizacion_id=organizacion_id,
        created_by=created_by,
    )
    db.add(attachment)
    await db.flush()
    return attachment


async def _project_context_for_automation_job(db: AsyncSession, job: models.AutomationJob):
    if job.test_run_id:
        result = await db.execute(
            select(models.Proyecto.id, models.Proyecto.organizacion_id)
            .join(models.TestRun, models.TestRun.proyecto_id == models.Proyecto.id)
            .filter(models.TestRun.id == job.test_run_id)
        )
        row = result.first()
        if row:
            return row.id, row.organizacion_id
    if job.build_id:
        result = await db.execute(
            select(models.Proyecto.id, models.Proyecto.organizacion_id)
            .join(models.Build, models.Build.proyecto_id == models.Proyecto.id)
            .filter(models.Build.id == job.build_id)
        )
        row = result.first()
        if row:
            return row.id, row.organizacion_id
    if job.caso_id:
        result = await db.execute(
            select(models.Proyecto.id, models.Proyecto.organizacion_id)
            .join(models.CasoPrueba, models.CasoPrueba.proyecto_id == models.Proyecto.id)
            .filter(models.CasoPrueba.id == job.caso_id)
        )
        row = result.first()
        if row:
            return row.id, row.organizacion_id
    return None, None


async def _project_context_for_execution(db: AsyncSession, execution: models.EjecucionCaso):
    result = await db.execute(
        select(models.Proyecto.id, models.Proyecto.organizacion_id)
        .join(models.TestRun, models.TestRun.proyecto_id == models.Proyecto.id)
        .filter(models.TestRun.id == execution.test_run_id)
    )
    row = result.first()
    if row:
        return row.id, row.organizacion_id
    return None, None


async def get_attachment_config(db: AsyncSession):
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == ATTACHMENT_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    value = setting.value if setting else {}
    return {**DEFAULT_ATTACHMENT_CONFIG, **(value or {})}


async def update_attachment_config(db: AsyncSession, config: schemas.AttachmentConfig):
    value = {**DEFAULT_ATTACHMENT_CONFIG, **config.model_dump()}
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == ATTACHMENT_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        setting = models.AppSetting(key=ATTACHMENT_CONFIG_KEY, value=value)
        db.add(setting)
    await db.commit()
    return value


async def get_auth_session_config(db: AsyncSession):
    return await config_service.get_auth_session_config(db)


async def update_auth_session_config(db: AsyncSession, config: schemas.AuthSessionConfig):
    return await config_service.update_auth_session_config(db, config)


async def get_ai_engine_config(db: AsyncSession):
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    value = setting.value if setting else {}
    merged = {**DEFAULT_AI_ENGINE_CONFIG, **(value or {})}
    merged.pop("engine_url", None)
    return merged


REDACTED_AI_CONFIG_SECRET = "[redacted]"
AI_CONFIG_SECRET_KEYS = {
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
AI_CONFIG_SECRET_KEY_SUFFIXES = (
    "_api_key",
    "_apikey",
    "_password",
    "_secret",
    "_token",
)


def _is_sensitive_ai_config_key(key: Any) -> bool:
    normalized = str(key or "").lower().replace("-", "_").replace(" ", "_")
    return normalized in AI_CONFIG_SECRET_KEYS or normalized.endswith(AI_CONFIG_SECRET_KEY_SUFFIXES)


def redact_ai_engine_config_secrets(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: REDACTED_AI_CONFIG_SECRET if _is_sensitive_ai_config_key(key) else redact_ai_engine_config_secrets(item)
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_ai_engine_config_secrets(item) for item in value]
    return value


def _restore_redacted_ai_config_secrets(incoming: Any, current: Any) -> Any:
    if incoming == REDACTED_AI_CONFIG_SECRET:
        return current
    if isinstance(incoming, dict):
        current_dict = current if isinstance(current, dict) else {}
        return {
            key: _restore_redacted_ai_config_secrets(item, current_dict.get(key))
            for key, item in incoming.items()
        }
    if isinstance(incoming, list):
        current_list = current if isinstance(current, list) else []
        return [
            _restore_redacted_ai_config_secrets(item, current_list[index] if index < len(current_list) else None)
            for index, item in enumerate(incoming)
        ]
    return incoming


async def get_ai_engine_public_config(db: AsyncSession):
    return redact_ai_engine_config_secrets(await get_ai_engine_config(db))


async def update_ai_engine_config(db: AsyncSession, config: schemas.AiEngineConfig):
    current = await get_ai_engine_config(db)
    incoming = _restore_redacted_ai_config_secrets(config.model_dump(), current)
    value = _json_safe({**DEFAULT_AI_ENGINE_CONFIG, **incoming})
    value.pop("engine_url", None)
    result = await db.execute(select(models.AppSetting).filter(models.AppSetting.key == AI_ENGINE_CONFIG_KEY))
    setting = result.scalar_one_or_none()
    if setting:
        setting.value = value
    else:
        setting = models.AppSetting(key=AI_ENGINE_CONFIG_KEY, value=value)
        db.add(setting)
    await db.commit()
    return value


def _node_payload(node: models.AiWorkflowNode, include_versions: bool = True) -> Dict[str, Any]:
    payload = {
        "id": str(node.id),
        "workflow_id": str(node.workflow_id),
        "type": node.type,
        "name": node.name,
        "agent_key": node.agent_key,
        "enabled": bool(node.enabled),
        "locked": bool(node.locked),
        "prompt_template": node.prompt_template or "",
        "config_json": node.config_json or {},
        "position_x": node.position_x or 0,
        "position_y": node.position_y or 0,
        "retry_policy": node.retry_policy or {},
        "timeout_sec": node.timeout_sec or 60,
        "model_override": node.model_override,
        "temperature_override": node.temperature_override,
    }
    if include_versions:
        payload["prompt_versions"] = [
            {
                "id": str(version.id),
                "node_id": str(version.node_id),
                "version": version.version,
                "prompt_template": version.prompt_template,
                "changelog": version.changelog,
                "created_by": str(version.created_by) if version.created_by else None,
                "created_at": isoformat_utc(version.created_at),
            }
            for version in sorted(node.prompt_versions or [], key=lambda item: item.version)
        ]
    return payload


def _edge_payload(edge: models.AiWorkflowEdge) -> Dict[str, Any]:
    return {
        "id": str(edge.id),
        "workflow_id": str(edge.workflow_id),
        "source_node_id": str(edge.source_node_id),
        "target_node_id": str(edge.target_node_id),
        "condition_type": edge.condition_type,
        "condition_json": edge.condition_json or {},
        "priority": edge.priority or 0,
        "max_passes": edge.max_passes or 1,
    }


def _workflow_payload(workflow: models.AiWorkflow) -> Dict[str, Any]:
    return {
        "id": str(workflow.id),
        "name": workflow.name,
        "version": workflow.version,
        "status": workflow.status,
        "is_default": bool(workflow.is_default),
        "created_by": str(workflow.created_by) if workflow.created_by else None,
        "created_at": isoformat_utc(workflow.created_at),
        "updated_at": isoformat_utc(workflow.updated_at),
    }


def _workflow_definition(workflow: models.AiWorkflow) -> Dict[str, Any]:
    return {
        "workflow": _workflow_payload(workflow),
        "nodes": [_node_payload(node) for node in sorted(workflow.nodes or [], key=lambda item: (item.position_x, item.position_y, item.name))],
        "edges": [_edge_payload(edge) for edge in sorted(workflow.edges or [], key=lambda item: (item.priority, item.condition_type))],
    }


def _legacy_agent_workflow_from_definition(definition: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not definition:
        return DEFAULT_AI_AGENT_WORKFLOW
    by_agent = {str(node.get("agent_key") or "").upper(): node for node in definition.get("nodes", [])}
    legacy = []
    for preset in DEFAULT_AI_AGENT_WORKFLOW:
        node = by_agent.get(preset["id"])
        legacy.append({
            **preset,
            "enabled": bool(node.get("enabled", preset["enabled"])) if node else preset["enabled"],
            "locked": bool(node.get("locked", preset["locked"])) if node else preset["locked"],
            "prompt": node.get("prompt_template", preset["prompt"]) if node else preset["prompt"],
            "retry_limit": int((node.get("retry_policy") or {}).get("max_retries", preset.get("retry_limit", 0))) if node else preset.get("retry_limit", 0),
        })
    return legacy


async def _load_workflow(db: AsyncSession, workflow_id: UUID) -> Optional[models.AiWorkflow]:
    result = await db.execute(
        select(models.AiWorkflow)
        .options(
            selectinload(models.AiWorkflow.nodes).selectinload(models.AiWorkflowNode.prompt_versions),
            selectinload(models.AiWorkflow.edges),
        )
        .filter(models.AiWorkflow.id == workflow_id)
    )
    return result.scalar_one_or_none()


async def _next_workflow_version(db: AsyncSession, workflow_id: UUID) -> int:
    result = await db.execute(
        select(func.max(models.AiWorkflowVersion.version)).filter(models.AiWorkflowVersion.workflow_id == workflow_id)
    )
    return int(result.scalar_one_or_none() or 0) + 1
