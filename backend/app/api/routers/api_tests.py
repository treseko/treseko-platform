from __future__ import annotations

import copy
import base64
import json
import httpx
from typing import Any
from urllib.parse import urlparse
from uuid import UUID

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field
from sqlalchemy import select

from ...database import AsyncSessionLocal
from ...main_context import *
from ...services.api_test_execution import get_api_test_executor
from ...services.api_test_runner import ApiTestRunnerError, sanitize_api_config
from ...services.api_bug_context import _used_variables
from ...services.api_evidence_policy import evidence_policy_marker, public_api_evidence_enabled
from ...services.api_dynamic_variables import (
    DYNAMIC_VARIABLE_CATALOG_VERSION,
    POSTMAN_EXTENSION_VARIABLE_NAMES,
    POSTMAN_OFFICIAL_DYNAMIC_VARIABLE_NAMES,
    derive_case_dynamic_seed,
    dynamic_catalog,
)
from ...services import case_portability


router = APIRouter(tags=["API Tests"])


def _api_progress_status(execution: models.EjecucionCaso) -> str:
    """Map the persisted execution/result state to the API monitor contract."""
    result_status = str((execution.api_resultado or {}).get("status") or "").upper()
    if result_status == "RUNNING":
        return "RUNNING"
    if result_status == "ERROR":
        return "ERROR"
    execution_status = execution.estado_resultado.value if hasattr(execution.estado_resultado, "value") else str(execution.estado_resultado or "")
    return {
        models.EstadoResultado.PASO.value: "PASSED",
        models.EstadoResultado.FALLO.value: "FAILED",
        models.EstadoResultado.BLOQUEADO.value: "BLOCKED",
        models.EstadoResultado.EJECUTANDO_AI.value: "RUNNING",
    }.get(execution_status, "PENDING")


def _api_progress_item(execution: models.EjecucionCaso, case: models.CasoPrueba) -> dict[str, Any]:
    result = execution.api_resultado or {}
    steps = result.get("steps") or []
    definition = getattr(execution, "api_config_snapshot", None) or getattr(case, "configuracion_api", None) or {}
    schema_version = str(definition.get("schema_version") or "treseko.api-test/v1")
    framework_version = schema_version.rsplit("/v", 1)[-1] if "/v" in schema_version else "1"
    assertions = [
        assertion
        for step in steps
        if isinstance(step, dict)
        for assertion in (step.get("assertions") or [])
        if isinstance(assertion, dict)
    ]
    errors = result.get("errors") or []
    error_message = errors[0].get("error") if errors and isinstance(errors[0], dict) else (str(errors[0]) if errors else None)
    assertion_passed = sum(1 for item in assertions if str(item.get("status")).upper() == "PASSED")
    assertion_failed = sum(1 for item in assertions if str(item.get("status")).upper() == "FAILED")
    return {
        "case_id": str(case.id),
        "case_code": case.codigo,
        "case_title": case.titulo,
        "status": _api_progress_status(execution),
        "framework": f"HTTP/REST · v{framework_version}",
        "executor": "API runner",
        "http_status": next(
            (step.get("response", {}).get("status") for step in steps if isinstance(step, dict) and isinstance(step.get("response"), dict)),
            None,
        ),
        "duration_ms": result.get("duration_ms") or max(0, int(execution.duracion_segundos or 0) * 1000),
        "assertions_passed": assertion_passed,
        "assertions_failed": assertion_failed,
        "message": execution.observaciones or error_message,
    }


async def _execute_api_suite_background(run_id: UUID, user_id: UUID, case_ids: list[UUID], dynamic_seed: str | None = None) -> None:
    """Execute an API batch outside the request and commit progress per case."""
    async with AsyncSessionLocal() as db:
        run = await db.get(models.TestRun, run_id)
        user = await db.get(models.Usuario, user_id)
        if not run or not user:
            return
        environment = await db.get(models.Entorno, run.entorno_id)
        if not environment:
            executions = (await db.execute(select(models.EjecucionCaso).where(models.EjecucionCaso.test_run_id == run.id))).scalars().all()
            for execution in executions:
                execution.api_resultado = {
                    **(execution.api_resultado or {}),
                    "schema_version": "treseko.api-result/v1",
                    "status": "ERROR",
                    "duration_ms": 0,
                    "steps": [],
                    "errors": [{"error": "El ambiente de ejecución ya no está disponible."}],
                }
                execution.estado_resultado = models.EstadoResultado.FALLO
                execution.execution_mode = models.ExecutionMode.AUTOMATIZADA
                execution.observaciones = "El ambiente de ejecución ya no está disponible."
                execution.fecha_ejecucion = utc_now()
            run.estado_run = models.EstadoRun.CERRADO
            run.fecha_cierre = utc_now()
            await db.commit()
            return
        cases = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.id.in_(case_ids)))).scalars().all()
        cases_by_id = {case.id: case for case in cases}
        executions = (await db.execute(select(models.EjecucionCaso).where(models.EjecucionCaso.test_run_id == run.id))).scalars().all()
        executions_by_case = {execution.caso_id: execution for execution in executions}
        shared_variables = {**(run.variables_resueltas or {})}
        run.estado_run = models.EstadoRun.EN_PROGRESO
        await db.commit()

        for case_id in case_ids:
            case = cases_by_id.get(case_id)
            execution = executions_by_case.get(case_id)
            if not case or not execution:
                continue
            execution.api_resultado = {
                **(execution.api_resultado or {}),
                "schema_version": "treseko.api-result/v1",
                "status": "RUNNING",
                "steps": [],
            }
            execution.execution_mode = models.ExecutionMode.AUTOMATIZADA
            await db.commit()
            try:
                await _execute_api_case(
                    db,
                    case,
                    execution,
                    run,
                    environment,
                    user,
                    shared_variables=shared_variables,
                    dynamic_seed=dynamic_seed,
                )
            except Exception as exc:  # keep the batch moving and expose a case-level error
                await db.rollback()
                execution.api_resultado = {
                    "schema_version": "treseko.api-result/v1",
                    "status": "ERROR",
                    "duration_ms": 0,
                    "steps": [],
                    "errors": [{"error": str(exc)}],
                }
                execution.estado_resultado = models.EstadoResultado.FALLO
                execution.execution_mode = models.ExecutionMode.AUTOMATIZADA
                execution.observaciones = f"Error al ejecutar el caso API: {exc}"
                execution.fecha_ejecucion = utc_now()
                case.ultimo_resultado = models.EstadoResultado.FALLO.value
                case.ultima_ejecucion_por = user.id
                case.ultima_ejecucion_fecha = execution.fecha_ejecucion
            await db.commit()

        run.estado_run = models.EstadoRun.CERRADO
        run.fecha_cierre = utc_now()
        await db.commit()


def _require_api_execution_capability(current_user: models.Usuario, origin: str) -> None:
    capability = "ejecutar.manual" if origin == "MANUAL" else "ejecutar.automatizada"
    if not auth.has_capability_permission(current_user, capability, "edit"):
        raise HTTPException(
            status_code=403,
            detail=f"No tienes permisos para iniciar una ejecución API {origin.lower()}.",
        )


def _api_state_items(states: list[Any]) -> dict[str, Any]:
    return {str(item.key): item.value for item in states if str(item.key).startswith("api.")}


async def _load_api_state(db: AsyncSession, project_id: UUID, environment_id: UUID) -> dict[str, Any]:
    rows = await db.execute(select(models.ApiPersistentState).where(
        models.ApiPersistentState.proyecto_id == project_id,
        models.ApiPersistentState.entorno_id == environment_id,
    ))
    return _api_state_items(rows.scalars().all())


async def _persist_api_state(
    db: AsyncSession,
    project_id: UUID,
    environment_id: UUID,
    run: models.TestRun,
    case: models.CasoPrueba,
    current_user: models.Usuario,
    values: dict[str, Any],
) -> None:
    for key, value in values.items():
        key = str(key)
        if not key.startswith("api."):
            raise ApiTestRunnerError("El Estado API solo admite variables con prefijo api.")
        row = (await db.execute(select(models.ApiPersistentState).where(
            models.ApiPersistentState.proyecto_id == project_id,
            models.ApiPersistentState.entorno_id == environment_id,
            models.ApiPersistentState.key == key,
        ).with_for_update())).scalar_one_or_none()
        if row:
            row.value = value
            row.version = int(row.version or 0) + 1
            row.last_run_id = run.id
            row.last_case_id = case.id
            row.updated_by = current_user.id
        else:
            db.add(models.ApiPersistentState(
                proyecto_id=project_id,
                entorno_id=environment_id,
                key=key,
                value=value,
                version=1,
                last_run_id=run.id,
                last_case_id=case.id,
                updated_by=current_user.id,
            ))


class PostmanImportRequest(BaseModel):
    content_base64: str = Field(min_length=1, max_length=30_000_000)
    file_name: str | None = Field(default="collection.json", max_length=255)
    component_id: UUID | None = None
    build_id: UUID | None = None
    selected_external_ids: list[str] | None = None


def _decode_postman_content(value: str) -> bytes:
    try:
        return base64.b64decode(value, validate=True)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="La colección Postman codificada no es válida") from exc

_API_ASSERTION_OPERATORS = {
    "equals", "equal", "not_equals", "contains", "starts_with", "ends_with", "matches",
    "exists", "not_exists", "type_is", "greater_than", "gt", "greater_or_equal", "gte",
    "less_than", "lt", "less_or_equal", "lte", "in", "is_empty", "not_empty",
    "array_length_equals", "array_length_greater_or_equal", "array_length_less_or_equal", "json_schema",
}
_API_ASSERTION_SOURCES = {
    "response.status", "response.body", "response.text", "response.headers",
    "response.cookies", "response.time.total_ms", "response.size_bytes",
}


def _validate_assertions(items: Any, location: str) -> list[str]:
    errors: list[str] = []
    if items is None:
        return errors
    if not isinstance(items, list):
        return [f"{location} debe ser una lista"]
    for index, assertion in enumerate(items, start=1):
        prefix = f"{location}[{index}]"
        if not isinstance(assertion, dict) or not assertion.get("operator"):
            errors.append(f"{prefix} debe indicar operator")
            continue
        operator = str(assertion.get("operator")).lower()
        source = str(assertion.get("source") or "response.body")
        if operator not in _API_ASSERTION_OPERATORS:
            errors.append(f"{prefix}.operator no soportado: {operator}")
        if source not in _API_ASSERTION_SOURCES and not source.startswith(("response.headers.", "response.cookies.")):
            errors.append(f"{prefix}.source no soportado: {source}")
        if operator == "type_is" and str(assertion.get("expected") or "").lower() not in {"string", "number", "boolean", "object", "array", "null"}:
            errors.append(f"{prefix}.expected debe ser string, number, boolean, object, array o null")
        if operator == "json_schema" and not isinstance(assertion.get("expected"), dict):
            errors.append(f"{prefix}.expected debe ser un esquema JSON objeto")
    return errors


def _validate_extractors(items: Any, location: str) -> list[str]:
    errors: list[str] = []
    if items is None:
        return errors
    if not isinstance(items, list):
        return [f"{location} debe ser una lista"]
    for index, extractor in enumerate(items, start=1):
        if not isinstance(extractor, dict):
            errors.append(f"{location}[{index}] debe ser un objeto")
            continue
        name = str(extractor.get("name") or "")
        if extractor.get("persist") is True and not name.startswith("api."):
            errors.append(f"{location}[{index}].name debe usar api.* para persistir")
    return errors


def _validate_definition(config: dict[str, Any]) -> list[str]:
    errors: list[str] = []
    if not isinstance(config, dict):
        return ["configuracion_api debe ser un objeto"]
    if config.get("schema_version") not in {None, "treseko.api-test/v1", "treseko.api-test/v2"}:
        errors.append("schema_version debe ser treseko.api-test/v1 o treseko.api-test/v2")
    for script_key in ("pre_request_script", "post_response_script"):
        script = config.get(script_key)
        if script is not None and not isinstance(script, (str, dict)):
            errors.append(f"{script_key} debe ser texto o un objeto de script")
    steps = config.get("steps")
    request = config.get("request")
    if steps is None and not isinstance(request, dict):
        errors.append("La definición debe incluir request o steps")
    if steps is not None:
        if not isinstance(steps, list) or not steps:
            errors.append("steps debe ser una lista no vacía")
        else:
            for index, step in enumerate(steps, start=1):
                if not isinstance(step, dict):
                    errors.append(f"steps[{index}] debe ser un objeto")
                elif not isinstance(step.get("request", step), dict):
                    errors.append(f"steps[{index}].request debe ser un objeto")
    request_items = [request] if isinstance(request, dict) else []
    request_items.extend(
        (step.get("request", step) if isinstance(step, dict) else {})
        for step in (steps or [])
        if isinstance(step, dict)
    )
    for index, item in enumerate(request_items, start=1):
        if not isinstance(item, dict):
            continue
        method = str(item.get("method") or "GET").upper()
        if method == "TRACE" or method not in {"GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"}:
            errors.append(f"request[{index}].method no soportado: {method}")
        body = item.get("body")
        if isinstance(body, dict) and str(body.get("mode") or "none").lower() not in {"none", "raw", "json", "urlencoded", "formdata", "multipart"}:
            errors.append(f"request[{index}].body.mode no soportado")
        auth_type = str((item.get("auth") or {}).get("type") or "none").lower() if isinstance(item.get("auth"), dict) else "none"
        if auth_type not in {"none", "bearer", "basic", "api_key", "apikey", "oauth2"}:
            errors.append(f"request[{index}].auth.type no soportado: {auth_type}")
        redirects = item.get("redirects")
        if redirects is not None and not isinstance(redirects, dict):
            errors.append(f"request[{index}].redirects debe ser un objeto")
    errors.extend(_validate_assertions(config.get("assertions"), "assertions"))
    errors.extend(_validate_extractors(config.get("extractors"), "extractors"))
    if isinstance(steps, list):
        for index, step in enumerate(steps, start=1):
            if isinstance(step, dict) and "assertions" in step:
                errors.extend(_validate_assertions(step.get("assertions"), f"steps[{index}].assertions"))
            if isinstance(step, dict) and "extractors" in step:
                errors.extend(_validate_extractors(step.get("extractors"), f"steps[{index}].extractors"))
    return errors


async def _case_access(db: AsyncSession, current_user: models.Usuario, case_id: UUID, level: str = "read"):
    case = await db.get(models.CasoPrueba, case_id)
    if not case or case.formato_prueba != models.FormatoPrueba.API:
        raise HTTPException(status_code=404, detail="Prueba API no encontrada")
    await access_control.require_project_access(db, current_user, case.proyecto_id, level)
    return case


async def _execute_api_case(
    db: AsyncSession,
    case: models.CasoPrueba,
    execution: models.EjecucionCaso,
    run: models.TestRun,
    environment: models.Entorno,
    current_user: models.Usuario,
    shared_variables: dict[str, Any] | None = None,
    dynamic_seed: str | None = None,
) -> dict[str, Any]:
    definition = copy.deepcopy(case.configuracion_api or {})
    case_dynamic_seed = derive_case_dynamic_seed(
        getattr(run, "dynamic_seed", None) or dynamic_seed,
        str(case.id),
    )
    execution.dynamic_seed = case_dynamic_seed
    public_evidence = public_api_evidence_enabled(environment=environment, config=definition)
    execution.api_config_snapshot = sanitize_api_config(definition, redact=not public_evidence)
    dataset_variables = {str(key): value for key, value in (run.variables_resueltas or {}).items()}
    try:
        executor_kwargs: dict[str, Any] = {"shared_variables": shared_variables}
        executor_kwargs["dynamic_seed"] = case_dynamic_seed
        result = await get_api_test_executor().execute(definition, environment, dataset_variables, **executor_kwargs)
        final_status = models.EstadoResultado.PASO if result.get("status") in {"PASSED", "PASSED_WITH_WARNINGS"} else models.EstadoResultado.FALLO
        observation = "Ejecución API completada"
    except ApiTestRunnerError as exc:
        result = {"schema_version": "treseko.api-result/v1", "status": "BLOCKED", "steps": [], "errors": [{"error": str(exc)}]}
        final_status = models.EstadoResultado.BLOQUEADO
        observation = str(exc)
    execution.api_resultado = result
    dynamic_evidence = result.get("dynamic_variables") if isinstance(result.get("dynamic_variables"), dict) else {}
    execution.dynamic_variables = dynamic_evidence.get("values") or {}
    execution.estado_resultado = final_status
    execution.duracion_segundos = max(0, round(float(result.get("duration_ms") or 0) / 1000))
    execution.observaciones = observation
    execution.fecha_ejecucion = utc_now()
    if result.get("status") in {"PASSED", "PASSED_WITH_WARNINGS"}:
        api_variables = result.get("api_variables") or {}
        if shared_variables is not None:
            shared_variables.update(api_variables)
        run.variables_resueltas = {**(run.variables_resueltas or {}), **api_variables}
        await _persist_api_state(db, case.proyecto_id, environment.id, run, case, current_user, result.get("persistent_variables") or {})
    case.ultimo_resultado = final_status.value
    case.ultima_ejecucion_por = current_user.id
    case.ultima_ejecucion_fecha = execution.fecha_ejecucion
    for step in result.get("steps") or []:
        db.add(models.SnapshotPaso(
            ejecucion_caso_id=execution.id,
            numero_paso=int(step.get("index") or 1),
            accion_congelada=f"{step.get('request', {}).get('method', 'GET')} {step.get('request', {}).get('url', '')}",
            datos_congelados=json.dumps(step.get("request") or {}, ensure_ascii=False, default=str),
            datos_resueltos=json.dumps(step.get("request") or {}, ensure_ascii=False, default=str),
            resultado_esperado_congelado=json.dumps(step.get("assertions") or [], ensure_ascii=False, default=str),
            estado_paso=models.EstadoResultado.PASO if step.get("status") in {"PASSED", "PASSED_WITH_WARNINGS"} else models.EstadoResultado.FALLO,
            comentarios=step.get("status"),
            error_log=json.dumps(step.get("errors") or [], ensure_ascii=False, default=str) if step.get("errors") else None,
        ))
    return {"case_id": str(case.id), "execution_id": str(execution.id), "status": final_status.value, "result": result}


@router.get("/dynamic-variables/catalog")
async def read_dynamic_variables_catalog(
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "read")),
):
    """Return the shared safe dynamic-variable catalog used by all editors."""
    del current_user
    return {
        "catalog_version": DYNAMIC_VARIABLE_CATALOG_VERSION,
        "official_count": len(POSTMAN_OFFICIAL_DYNAMIC_VARIABLE_NAMES),
        "extension_count": len(POSTMAN_EXTENSION_VARIABLE_NAMES),
        "extensions": sorted(POSTMAN_EXTENSION_VARIABLE_NAMES),
        "items": dynamic_catalog(),
    }


@router.post("/api-tests/validate", response_model=schemas.ApiTestValidationResponse)
async def validate_api_test_definition(
    payload: schemas.ApiTestValidationRequest,
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "read")),
):
    del current_user
    errors = _validate_definition(payload.configuracion_api)
    return schemas.ApiTestValidationResponse(valid=not errors, errors=errors)


@router.post("/api-tests/dry-run")
async def dry_run_api_test(
    payload: schemas.ApiTestDryRunRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.automatizada", "edit")),
):
    """Execute an API draft without creating a case, run, execution or state."""
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "read")
    errors = _validate_definition(payload.configuracion_api)
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Definición API inválida", "errors": errors})
    environment = await db.get(models.Entorno, payload.entorno_id)
    if not environment or environment.proyecto_id != payload.proyecto_id or not environment.activo:
        raise HTTPException(status_code=400, detail="El ambiente no pertenece al proyecto o está inactivo")
    dataset_variables: dict[str, Any] = {}
    if payload.dataset_id:
        dataset = (await db.execute(select(models.EntornoDataset).where(
            models.EntornoDataset.id == payload.dataset_id,
            models.EntornoDataset.entorno_id == payload.entorno_id,
            models.EntornoDataset.activo == True,
        ))).scalar_one_or_none()
        if not dataset:
            raise HTTPException(status_code=422, detail="El dataset no pertenece al ambiente o está inactivo")
        dataset_variables = {str(key): value for key, value in (dataset.variables or {}).items()}
    try:
        result = await get_api_test_executor().execute(
            copy.deepcopy(payload.configuracion_api),
            environment,
            dataset_variables,
            shared_variables={},
            dynamic_seed=payload.dynamic_seed,
        )
    except ApiTestRunnerError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc
    return {
        "dry_run": True,
        "persisted": False,
        "project_id": str(payload.proyecto_id),
        "environment_id": str(payload.entorno_id),
        "dataset_id": str(payload.dataset_id) if payload.dataset_id else None,
        "status": result.get("status"),
        "result": result,
    }


@router.get("/proyectos/{project_id}/entornos/{environment_id}/api-state", response_model=schemas.ApiPersistentStateList)
async def read_api_state(
    project_id: UUID,
    environment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.ambientes", "read")),
):
    await access_control.require_project_access(db, current_user, project_id, "read")
    environment = await db.get(models.Entorno, environment_id)
    if not environment or environment.proyecto_id != project_id:
        raise HTTPException(status_code=404, detail="Ambiente no encontrado")
    rows = await db.execute(select(models.ApiPersistentState).where(
        models.ApiPersistentState.proyecto_id == project_id,
        models.ApiPersistentState.entorno_id == environment_id,
    ).order_by(models.ApiPersistentState.key))
    return {"entorno_id": environment_id, "items": rows.scalars().all()}


@router.put("/proyectos/{project_id}/entornos/{environment_id}/api-state/{key:path}", response_model=schemas.ApiPersistentStateValue)
async def write_api_state(
    project_id: UUID,
    environment_id: UUID,
    key: str,
    payload: schemas.ApiPersistentStateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.ambientes", "edit")),
):
    await access_control.require_project_access(db, current_user, project_id, "edit")
    if not key.startswith("api."):
        raise HTTPException(status_code=422, detail="El Estado API requiere una clave api.*")
    environment = await db.get(models.Entorno, environment_id)
    if not environment or environment.proyecto_id != project_id:
        raise HTTPException(status_code=404, detail="Ambiente no encontrado")
    row = (await db.execute(select(models.ApiPersistentState).where(
        models.ApiPersistentState.proyecto_id == project_id,
        models.ApiPersistentState.entorno_id == environment_id,
        models.ApiPersistentState.key == key,
    ).with_for_update())).scalar_one_or_none()
    if row:
        if payload.version != row.version:
            raise HTTPException(status_code=409, detail="El Estado API cambió desde la última lectura")
        row.value = payload.value
        row.version += 1
        row.updated_by = current_user.id
    else:
        if payload.version not in {0}:
            raise HTTPException(status_code=409, detail="El Estado API no existe con esa versión")
        row = models.ApiPersistentState(proyecto_id=project_id, entorno_id=environment_id, key=key, value=payload.value, version=1, updated_by=current_user.id)
        db.add(row)
    await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="UPDATE_API_STATE", recurso="api_persistent_state", recurso_id=project_id, detalles={"environment_id": str(environment_id), "key": key}, commit=False)
    await db.commit()
    await db.refresh(row)
    return row


@router.delete("/proyectos/{project_id}/entornos/{environment_id}/api-state/{key:path}")
async def delete_api_state(
    project_id: UUID,
    environment_id: UUID,
    key: str,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("proyectos.ambientes", "edit")),
):
    await access_control.require_project_access(db, current_user, project_id, "edit")
    row = (await db.execute(select(models.ApiPersistentState).where(
        models.ApiPersistentState.proyecto_id == project_id,
        models.ApiPersistentState.entorno_id == environment_id,
        models.ApiPersistentState.key == key,
    ))).scalar_one_or_none()
    if not row:
        raise HTTPException(status_code=404, detail="Estado API no encontrado")
    await db.delete(row)
    await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="DELETE_API_STATE", recurso="api_persistent_state", recurso_id=project_id, detalles={"environment_id": str(environment_id), "key": key}, commit=False)
    await db.commit()
    return {"ok": True}


@router.post("/proyectos/{project_id}/api-tests/import-postman/preview")
async def preview_postman_collection(
    project_id: UUID,
    payload: PostmanImportRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "read")),
):
    await access_control.require_project_access(db, current_user, project_id, "read")
    try:
        data = _decode_postman_content(payload.content_base64)
        case_portability.validate_file_extension("postman/collection-v2.1", payload.file_name)
        preview = await case_portability.preview_import(db, project_id, "postman/collection-v2.1", data)
        return {"source": "postman", "profile": "postman/collection-v2.1", **preview}
    except case_portability.PortabilityError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.post("/proyectos/{project_id}/api-tests/import-postman/")
async def import_postman_collection(
    project_id: UUID,
    payload: PostmanImportRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "edit")),
):
    await access_control.require_project_access(db, current_user, project_id, "edit")
    if not payload.component_id:
        raise HTTPException(status_code=422, detail="Seleccioná un componente destino para la suite API")
    component = await db.get(models.Componente, payload.component_id)
    if not component or component.proyecto_id != project_id:
        raise HTTPException(status_code=422, detail="El componente destino no pertenece al proyecto")
    if payload.build_id:
        build = await access_control.require_build_access(db, current_user, payload.build_id, "edit")
        if build.proyecto_id != project_id or build.componente_id != payload.component_id:
            raise HTTPException(status_code=422, detail="La build destino no pertenece al componente seleccionado")
        if not access_control.is_build_active(build):
            raise HTTPException(status_code=409, detail="La build está inactiva. No se puede importar en una build histórica.")
    try:
        data = _decode_postman_content(payload.content_base64)
        case_portability.validate_file_extension("postman/collection-v2.1", payload.file_name)
        batch = await case_portability.commit_import(
            db,
            project_id,
            "postman/collection-v2.1",
            data,
            payload.file_name,
            current_user.id,
            payload.selected_external_ids,
            payload.component_id,
            payload.build_id,
        )
        await crud.create_audit_log(
            db=db,
            usuario_id=current_user.id,
            accion="IMPORT_POSTMAN_COLLECTION",
            recurso="case_import_batch",
            recurso_id=batch.id,
            detalles={"project_id": str(project_id), "component_id": str(payload.component_id), "build_id": str(payload.build_id) if payload.build_id else None},
            ip_address=request.client.host if request.client else None,
        )
        return {"batch_id": str(batch.id), "source": "postman", "status": batch.status, "summary": batch.summary_json, "items": batch.item_results}
    except case_portability.PortabilityError as exc:
        raise HTTPException(status_code=422, detail=str(exc)) from exc


@router.get("/proyectos/{project_id}/api-tests/catalog")
async def read_api_fixture_catalog(
    project_id: UUID,
    environment_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "read")),
):
    """Read the catalog exposed by an external API fixture service.

    The service is intentionally external to Treseko. The environment remains
    the source of truth for its URL, while this proxy keeps browser access
    same-origin and applies the same project authorization as case authoring.
    """
    await access_control.require_project_access(db, current_user, project_id, "read")
    environment = await db.get(models.Entorno, environment_id)
    if not environment or environment.proyecto_id != project_id or not environment.activo:
        raise HTTPException(status_code=404, detail="El ambiente no pertenece al proyecto o está inactivo")
    catalog_url = str((environment.configuracion_api or {}).get("catalog_url") or f"{str(environment.url).rstrip('/')}/catalog")
    parsed_catalog = urlparse(catalog_url)
    parsed_environment = urlparse(str(environment.url))
    if parsed_catalog.scheme not in {"http", "https"} or not parsed_catalog.hostname:
        raise HTTPException(status_code=422, detail="El ambiente no tiene una URL de catálogo HTTP válida")
    allowed_hosts = set((environment.configuracion_api or {}).get("allowed_hosts") or [])
    allowed_hosts.add(parsed_environment.hostname or "")
    if parsed_catalog.hostname not in allowed_hosts:
        raise HTTPException(status_code=422, detail="La URL del catálogo no pertenece a un host permitido por el ambiente")
    try:
        async with httpx.AsyncClient(timeout=5.0, follow_redirects=False) as client:
            response = await client.get(catalog_url, headers={"Accept": "application/json"})
    except httpx.HTTPError as exc:
        raise HTTPException(status_code=502, detail=f"No se pudo consultar el catálogo del servicio API: {exc}") from exc
    if response.status_code != 200:
        raise HTTPException(status_code=502, detail=f"El servicio API devolvió HTTP {response.status_code} al consultar su catálogo")
    try:
        payload = response.json()
    except ValueError as exc:
        raise HTTPException(status_code=502, detail="El catálogo del servicio API no devolvió JSON válido") from exc
    if not isinstance(payload, dict) or not isinstance(payload.get("operations"), list):
        raise HTTPException(status_code=502, detail="El catálogo del servicio API no cumple el contrato esperado")
    return {"source": "external-api-fixture", "environment_id": str(environment.id), **payload}


@router.get("/proyectos/{project_id}/api-tests")
async def list_api_tests(
    project_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "read")),
):
    await access_control.require_project_access(db, current_user, project_id, "read")
    result = await db.execute(
        select(models.CasoPrueba)
        .where(models.CasoPrueba.proyecto_id == project_id, models.CasoPrueba.formato_prueba == models.FormatoPrueba.API)
        .order_by(models.CasoPrueba.ultima_modificacion.desc(), models.CasoPrueba.titulo)
    )
    return result.scalars().all()


@router.get("/api-tests/{case_id}")
async def read_api_test(
    case_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.casos", "read")),
):
    return await _case_access(db, current_user, case_id, "read")


@router.post("/proyectos/{project_id}/api-tests/execute")
async def execute_api_suite(
    project_id: UUID,
    payload: schemas.ApiTestExecuteRequest,
    request: Request,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.get_current_active_user),
):
    """Execute selected API cases as one Treseko TestRun.

    This is the API equivalent of Collection Runner: the suite remains the
    source of truth and every request is persisted below its case execution.
    The legacy single-case endpoint remains unchanged for existing clients.
    """
    origin = str(payload.origen or "AUTOMATIZADA").upper()
    allowed_origins = {"MANUAL", "AUTOMATIZADA", "EXTERNAL_API", "IA"}
    if origin not in allowed_origins:
        raise HTTPException(status_code=422, detail="origen API debe ser MANUAL, AUTOMATIZADA, EXTERNAL_API o IA")
    _require_api_execution_capability(current_user, origin)
    await access_control.require_project_access(db, current_user, project_id, "edit")
    build = await db.get(models.Build, payload.build_id)
    if not build or build.proyecto_id != project_id or not access_control.is_build_active(build):
        raise HTTPException(status_code=409, detail="La build API no pertenece al proyecto o no está activa")
    if payload.suite_id:
        suite = await db.get(models.Suite, payload.suite_id)
        if not suite or suite.proyecto_id != project_id:
            raise HTTPException(status_code=404, detail="Suite API no encontrada")
        all_suites = (await db.execute(select(models.Suite.id, models.Suite.parent_id).where(models.Suite.proyecto_id == project_id))).all()
        descendant_ids = {suite.id}
        changed = True
        while changed:
            changed = False
            for child_id, parent_id in all_suites:
                if parent_id in descendant_ids and child_id not in descendant_ids:
                    descendant_ids.add(child_id)
                    changed = True
        suite_cases = await db.execute(select(models.CasoPrueba.id).where(models.CasoPrueba.suite_id.in_(descendant_ids)))
        selected_ids = list(suite_cases.scalars().all())
    else:
        selected_ids = list(dict.fromkeys(payload.case_ids))
    if not selected_ids:
        raise HTTPException(status_code=422, detail="Seleccioná al menos un caso API o una suite")
    rows = await db.execute(select(models.CasoPrueba).where(
        models.CasoPrueba.id.in_(selected_ids),
        models.CasoPrueba.proyecto_id == project_id,
        models.CasoPrueba.formato_prueba == models.FormatoPrueba.API,
        models.CasoPrueba.activo == True,
    ))
    cases_by_id = {case.id: case for case in rows.scalars().all()}
    if set(cases_by_id) != set(selected_ids):
        raise HTTPException(status_code=422, detail="Todos los casos seleccionados deben ser API activos del proyecto")
    environment = await db.get(models.Entorno, payload.entorno_id)
    if not environment or environment.proyecto_id != project_id or not environment.activo:
        raise HTTPException(status_code=400, detail="El ambiente no pertenece al proyecto o está inactivo")
    if payload.run_id:
        if origin != "MANUAL" or payload.prepare_only:
            raise HTTPException(status_code=422, detail="El run_id solo puede reutilizarse para ejecutar un caso API manual")
        run = await db.get(models.TestRun, payload.run_id)
        if not run or run.proyecto_id != project_id:
            raise HTTPException(status_code=404, detail="Run API manual no encontrado")
        if run.origen != "MANUAL" or run.estado_run == models.EstadoRun.CERRADO:
            raise HTTPException(status_code=409, detail="El run API manual ya está cerrado")
        if run.entorno_id != payload.entorno_id or run.dataset_id != payload.dataset_id:
            raise HTTPException(status_code=409, detail="El ambiente o dataset no coincide con el run API manual")
        selected_ids = list(dict.fromkeys(payload.case_ids))
        if len(selected_ids) != 1:
            raise HTTPException(status_code=422, detail="La ejecución manual API debe enviar un solo caso por vez")
    else:
        try:
            run = await crud.create_test_run(db=db, run=schemas.TestRunCreate(
                nombre=f"API · {len(selected_ids)} caso(s)", entorno=environment.nombre,
                proyecto_id=project_id, build_id=payload.build_id, origen=origin,
                entorno_id=payload.entorno_id, dataset_id=payload.dataset_id, caso_ids=selected_ids,
                dynamic_seed=payload.dynamic_seed,
            ), user_id=current_user.id)
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
    dataset_name = None
    if run.dataset_id:
        selected_dataset = await db.get(models.EntornoDataset, run.dataset_id)
        dataset_name = selected_dataset.nombre if selected_dataset else None
    api_shared_variables = await _load_api_state(db, project_id, payload.entorno_id)
    run.variables_resueltas = {**(run.variables_resueltas or {}), **api_shared_variables}
    await db.commit()
    if payload.prepare_only:
        if origin != "MANUAL":
            raise HTTPException(status_code=422, detail="Solo se puede preparar un run API manual")
        return {
            "pending": True,
            "project_id": str(project_id),
            "run_id": str(run.id),
            "origin": origin,
            "environment_id": str(run.entorno_id) if run.entorno_id else None,
            "environment_name": environment.nombre,
            "dataset_id": str(run.dataset_id) if run.dataset_id else None,
            "dataset_name": dataset_name,
            "dataset_previews": {
                str(case_id): {
                    "caso_id": str(case_id),
                    "entorno_id": str(run.entorno_id) if run.entorno_id else None,
                    "entorno_nombre": environment.nombre,
                    "dataset_id": str(run.dataset_id) if run.dataset_id else None,
                    "dataset_nombre": dataset_name,
                    "dataset_resuelto": (run.datasets_resueltos or {}).get(str(case_id), []),
                    "variables_resueltas": run.variables_resueltas or {},
                }
                for case_id in selected_ids
            },
        }
    if origin == "AUTOMATIZADA":
        try:
            job = await crud.create_api_automation_job_for_suite(
                db,
                run=run,
                case_ids=selected_ids,
                cases_by_id=cases_by_id,
                environment=environment,
                shared_variables=api_shared_variables,
                user_id=current_user.id,
            )
        except ValueError as exc:
            raise HTTPException(status_code=400, detail=str(exc)) from exc
        await crud.create_audit_log(
            db=db,
            usuario_id=current_user.id,
            accion="EXECUTE_API_SUITE",
            recurso="api_test_suite",
            recurso_id=project_id,
            detalles={
                "run_id": str(run.id),
                "job_id": str(job.id),
                "case_count": len(selected_ids),
                "origin": origin,
                "executor": "automation_worker",
            },
            ip_address=request.client.host if request.client else None,
        )
        job_status = job.estado.value if hasattr(job.estado, "value") else str(job.estado)
        return JSONResponse(
            status_code=202,
            content={
                "pending": job_status in {"PENDING", "CLAIMED", "RUNNING"},
                "project_id": str(project_id),
                "run_id": str(run.id),
                "job_id": str(job.id),
                "origin": origin,
                "run_name": run.nombre,
                "started_at": run.fecha_creacion.isoformat() if run.fecha_creacion else None,
                "environment_name": environment.nombre,
                "dataset_name": dataset_name,
                "status": job_status,
                "total": len(selected_ids),
                "message": job.error_message if job_status == "BLOCKED" else None,
            },
        )
    executions = await db.execute(select(models.EjecucionCaso).where(models.EjecucionCaso.test_run_id == run.id))
    execution_by_case = {execution.caso_id: execution for execution in executions.scalars().all()}
    missing_run_cases = [case_id for case_id in selected_ids if case_id not in execution_by_case]
    if missing_run_cases:
        raise HTTPException(status_code=409, detail="El caso seleccionado no pertenece al lote API manual actual")
    if not payload.run_id:
        run.variables_resueltas = {**(run.variables_resueltas or {}), **api_shared_variables}
    results = []
    for case_id in selected_ids:
        case = cases_by_id[case_id]
        errors = _validate_definition(case.configuracion_api or {})
        if errors:
            execution = execution_by_case[case.id]
            definition = copy.deepcopy(case.configuracion_api or {})
            public_evidence = public_api_evidence_enabled(environment=environment, config=definition)
            execution.api_config_snapshot = sanitize_api_config(definition, redact=not public_evidence)
            invalid_result = {
                "schema_version": "treseko.api-result/v1",
                "status": "BLOCKED",
                "duration_ms": 0,
                "steps": [],
                "errors": errors,
                "validation_errors": errors,
                "variables_used": _used_variables(definition, run.variables_resueltas or {}, redact=not public_evidence),
                **evidence_policy_marker(public_evidence),
            }
            execution.api_resultado = invalid_result
            execution.estado_resultado = models.EstadoResultado.BLOQUEADO
            execution.observaciones = "Definición API inválida: " + "; ".join(errors)
            execution.fecha_ejecucion = utc_now()
            execution.duracion_segundos = 0
            case.ultimo_resultado = models.EstadoResultado.BLOQUEADO.value
            case.ultima_ejecucion_por = current_user.id
            case.ultima_ejecucion_fecha = execution.fecha_ejecucion
            results.append({"case_id": str(case.id), "execution_id": str(execution.id), "status": "BLOQUEADO", "errors": errors, "result": invalid_result, "config_snapshot": execution.api_config_snapshot})
            continue
        results.append(await _execute_api_case(db, case, execution_by_case[case.id], run, environment, current_user, shared_variables=api_shared_variables, dynamic_seed=payload.dynamic_seed))
    if origin != "MANUAL":
        run.estado_run = models.EstadoRun.CERRADO
        run.fecha_cierre = utc_now()
    await db.commit()
    await crud.create_audit_log(db=db, usuario_id=current_user.id, accion="EXECUTE_API_SUITE", recurso="api_test_suite", recurso_id=project_id, detalles={"run_id": str(run.id), "case_count": len(selected_ids), "origin": origin}, ip_address=request.client.host if request.client else None)
    return {"project_id": str(project_id), "run_id": str(run.id), "origin": origin, "environment_name": environment.nombre, "dataset_name": dataset_name, "status": "PASSED" if all(item.get("status") == "PASO" for item in results) else "COMPLETED", "executions": results}


@router.get("/test-runs/{run_id}/api-progress")
async def read_api_execution_progress(
    run_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.ver", "read")),
):
    run = await db.get(models.TestRun, run_id)
    if not run:
        raise HTTPException(status_code=404, detail="Run API no encontrado")
    await access_control.require_project_access(db, current_user, run.proyecto_id, "read")
    if str(run.origen or "").upper() != "AUTOMATIZADA":
        raise HTTPException(status_code=409, detail="El run no corresponde a una ejecución API automatizada")
    rows = await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .where(models.EjecucionCaso.test_run_id == run.id)
    )
    items = [_api_progress_item(execution, case) for execution, case in rows.all()]
    counts = {
        "total": len(items),
        "pending": sum(1 for item in items if item["status"] == "PENDING"),
        "running": sum(1 for item in items if item["status"] == "RUNNING"),
        "passed": sum(1 for item in items if item["status"] == "PASSED"),
        "failed": sum(1 for item in items if item["status"] == "FAILED"),
        "blocked": sum(1 for item in items if item["status"] == "BLOCKED"),
        "errors": sum(1 for item in items if item["status"] == "ERROR"),
    }
    terminal = counts["total"] > 0 and counts["pending"] == 0 and counts["running"] == 0
    return {
        "run_id": str(run.id),
        "run_name": run.nombre,
        "started_at": run.fecha_creacion.isoformat() if run.fecha_creacion else None,
        "finished_at": run.fecha_cierre.isoformat() if run.fecha_cierre else None,
        "status": "COMPLETED" if terminal else ("RUNNING" if counts["running"] or counts["passed"] or counts["failed"] or counts["blocked"] or counts["errors"] else "PENDING"),
        **counts,
        "executions": items,
    }


@router.post("/api-tests/{case_id}/execute")
async def execute_api_test(
    case_id: UUID,
    payload: schemas.ApiTestExecuteRequest,
    request: Request,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.automatizada", "edit")),
):
    case = await _case_access(db, current_user, case_id, "edit")
    definition = copy.deepcopy(case.configuracion_api or {})
    errors = _validate_definition(definition)
    if errors:
        raise HTTPException(status_code=422, detail={"message": "Definición API inválida", "errors": errors})
    environment = await db.get(models.Entorno, payload.entorno_id)
    if not environment or environment.proyecto_id != case.proyecto_id or not environment.activo:
        raise HTTPException(status_code=400, detail="El ambiente no pertenece al proyecto o está inactivo")

    run_payload = schemas.TestRunCreate(
        nombre=f"API · {case.codigo or case.titulo}",
        entorno=environment.nombre,
        proyecto_id=case.proyecto_id,
        build_id=payload.build_id,
        origen="AUTOMATIZADA",
        entorno_id=payload.entorno_id,
        dataset_id=payload.dataset_id,
        caso_ids=[case.id],
    )
    try:
        run = await crud.create_test_run(db=db, run=run_payload, user_id=current_user.id)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    execution = (await db.execute(select(models.EjecucionCaso).where(models.EjecucionCaso.test_run_id == run.id, models.EjecucionCaso.caso_id == case.id))).scalar_one()
    public_evidence = public_api_evidence_enabled(environment=environment, config=definition)
    execution.api_config_snapshot = sanitize_api_config(definition, redact=not public_evidence)
    dataset_variables = {}
    for item in (run.variables_resueltas or {}).items():
        dataset_variables[str(item[0])] = item[1]
    api_shared_variables = await _load_api_state(db, case.proyecto_id, payload.entorno_id)
    run.variables_resueltas = {**(run.variables_resueltas or {}), **api_shared_variables}
    try:
        executor_kwargs: dict[str, Any] = {"shared_variables": api_shared_variables}
        if payload.dynamic_seed is not None:
            executor_kwargs["dynamic_seed"] = payload.dynamic_seed
        result = await get_api_test_executor().execute(definition, environment, dataset_variables, **executor_kwargs)
        final_status = models.EstadoResultado.PASO if result.get("status") in {"PASSED", "PASSED_WITH_WARNINGS"} else models.EstadoResultado.FALLO
        observation = "Ejecución API completada"
    except ApiTestRunnerError as exc:
        result = {"schema_version": "treseko.api-result/v1", "status": "BLOCKED", "steps": [], "errors": [{"error": str(exc)}]}
        final_status = models.EstadoResultado.BLOQUEADO
        observation = str(exc)
    execution.api_resultado = result
    execution.estado_resultado = final_status
    execution.duracion_segundos = max(0, round(float(result.get("duration_ms") or 0) / 1000))
    execution.observaciones = observation
    execution.fecha_ejecucion = utc_now()
    if result.get("status") in {"PASSED", "PASSED_WITH_WARNINGS"}:
        api_variables = result.get("api_variables") or {}
        run.variables_resueltas = {**(run.variables_resueltas or {}), **api_variables}
        await _persist_api_state(db, case.proyecto_id, payload.entorno_id, run, case, current_user, result.get("persistent_variables") or {})
    case.ultimo_resultado = final_status.value
    case.ultima_ejecucion_por = current_user.id
    case.ultima_ejecucion_fecha = execution.fecha_ejecucion
    pending_result = await db.execute(
        select(models.EjecucionCaso.caso_id).where(
            models.EjecucionCaso.test_run_id == run.id,
            models.EjecucionCaso.estado_resultado.in_([
                models.EstadoResultado.SIN_CORRER,
                models.EstadoResultado.EJECUTANDO_AI,
            ]),
        )
    )
    pending_case_ids = [str(case_id) for case_id in pending_result.scalars().all()]
    if pending_case_ids:
        run.estado_run = models.EstadoRun.ABIERTO
        run.fecha_cierre = None
    else:
        run.estado_run = models.EstadoRun.CERRADO
        run.fecha_cierre = execution.fecha_ejecucion

    for step in result.get("steps") or []:
        snapshot = models.SnapshotPaso(
            ejecucion_caso_id=execution.id,
            numero_paso=int(step.get("index") or 1),
            accion_congelada=f"{step.get('request', {}).get('method', 'GET')} {step.get('request', {}).get('url', '')}",
            datos_congelados=json.dumps(step.get("request", {}).get("body"), ensure_ascii=False, default=str) if step.get("request", {}).get("body") is not None else None,
            resultado_esperado_congelado=json.dumps(step.get("assertions") or [], ensure_ascii=False, default=str),
            estado_paso=models.EstadoResultado.PASO if step.get("status") in {"PASSED", "PASSED_WITH_WARNINGS"} else models.EstadoResultado.FALLO,
            comentarios=step.get("status"),
            error_log=json.dumps(step.get("errors") or [], ensure_ascii=False, default=str) if step.get("errors") else None,
        )
        db.add(snapshot)
    await db.commit()
    await db.refresh(execution)
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="EXECUTE",
        recurso="api_test",
        recurso_id=case.id,
        detalles={"execution_id": str(execution.id), "status": final_status.value, "build_id": str(payload.build_id), "environment_id": str(payload.entorno_id)},
        ip_address=request.client.host if request.client else None,
    )
    return {"case_id": str(case.id), "run_id": str(run.id), "execution_id": str(execution.id), "status": final_status.value, "result": result}


@router.get("/api-tests/executions/{execution_id}")
async def read_api_execution(
    execution_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.ver", "read")),
):
    row = (await db.execute(select(models.EjecucionCaso, models.CasoPrueba, models.TestRun).join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id).join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id).where(models.EjecucionCaso.id == execution_id))).first()
    if not row or row[1].formato_prueba != models.FormatoPrueba.API:
        raise HTTPException(status_code=404, detail="Ejecución API no encontrada")
    execution, case, run = row
    await access_control.require_project_access(db, current_user, run.proyecto_id, "read")
    environment = await db.get(models.Entorno, run.entorno_id) if run.entorno_id else None
    dataset = await db.get(models.EntornoDataset, run.dataset_id) if run.dataset_id else None
    variables = run.variables_resueltas or {}
    return {
        "execution_id": str(execution.id),
        "case_id": str(case.id),
        "run_id": str(run.id),
        "status": execution.estado_resultado.value,
        "result": execution.api_resultado or {},
        "config_snapshot": execution.api_config_snapshot or {},
        "environment_id": str(run.entorno_id) if run.entorno_id else None,
        "environment_name": environment.nombre if environment else run.entorno,
        "environment_url": environment.url if environment else None,
        "dataset_id": str(run.dataset_id) if run.dataset_id else None,
        "dataset_name": dataset.nombre if dataset else None,
        "resolved_dataset": (run.datasets_resueltos or {}).get(str(case.id), []),
        "variables_used": (execution.api_resultado or {}).get("variables_used") or _used_variables(execution.api_config_snapshot or {}, variables),
    }


@router.post("/api-tests/executions/{execution_id}/manual-evaluation")
async def evaluate_api_execution_manually(
    execution_id: UUID,
    payload: schemas.ApiManualEvaluationRequest,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("ejecutar.manual", "edit")),
):
    row = (await db.execute(
        select(models.EjecucionCaso, models.CasoPrueba, models.TestRun)
        .join(models.CasoPrueba, models.CasoPrueba.id == models.EjecucionCaso.caso_id)
        .join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
        .where(models.EjecucionCaso.id == execution_id)
    )).first()
    if not row or row[1].formato_prueba != models.FormatoPrueba.API:
        raise HTTPException(status_code=404, detail="Ejecución API no encontrada")
    execution, case, run = row
    await access_control.require_project_access(db, current_user, run.proyecto_id, "edit")
    result = dict(execution.api_resultado or {})
    result["manual_evaluation"] = {
        "status": payload.status,
        "notes": payload.notes or "",
        "evaluator_id": str(current_user.id),
        "evaluated_at": utc_now().isoformat(),
    }
    execution.api_resultado = result
    execution.estado_resultado = models.EstadoResultado(payload.status)
    execution.observaciones = payload.notes or f"Evaluación manual API finalizada: {payload.status}."
    execution.fecha_ejecucion = utc_now()
    case.ultimo_resultado = payload.status
    case.ultima_ejecucion_por = current_user.id
    case.ultima_ejecucion_fecha = execution.fecha_ejecucion
    pending_result = await db.execute(
        select(models.EjecucionCaso.caso_id).where(
            models.EjecucionCaso.test_run_id == run.id,
            models.EjecucionCaso.estado_resultado.in_([
                models.EstadoResultado.SIN_CORRER,
                models.EstadoResultado.EJECUTANDO_AI,
            ]),
        )
    )
    pending_case_ids = [str(case_id) for case_id in pending_result.scalars().all()]
    if pending_case_ids:
        run.estado_run = models.EstadoRun.ABIERTO
        run.fecha_cierre = None
    else:
        run.estado_run = models.EstadoRun.CERRADO
        run.fecha_cierre = execution.fecha_ejecucion
    await db.commit()
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="EVALUATE_API_MANUALLY",
        recurso="api_execution",
        recurso_id=execution.id,
        detalles={"status": payload.status, "case_id": str(case.id), "run_id": str(run.id)},
    )
    return {
        "execution_id": str(execution.id),
        "case_id": str(case.id),
        "run_id": str(run.id),
        "status": payload.status,
        "result": result,
        "run_status": run.estado_run.value,
        "pending_case_ids": pending_case_ids,
    }
