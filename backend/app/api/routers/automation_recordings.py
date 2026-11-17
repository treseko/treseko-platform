from fastapi import APIRouter
import ipaddress
import secrets
from datetime import timedelta
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from ...main_context import *
from ...services.automation_payloads import freeze_worker_payload, worker_payload
from ...services.automation_result_ingress import ensure_job_runner_access
from .automation import get_current_automation_runner
from .automation_helpers import _publish_automation_job_event, _require_automation_job_access
from ...services import mcp_browser

router = APIRouter(tags=["Automatizacion"])


def _is_private_recorder_target(target):
    hostname = (target.hostname or "").strip("[]").rstrip(".").lower()
    if hostname == "localhost" or hostname.endswith((".localhost", ".local", ".internal")):
        return True
    try:
        address = ipaddress.ip_address(hostname)
    except ValueError:
        return False  # Engine also checks DNS results to block private aliases.
    return (
        address.is_private
        or address.is_loopback
        or address.is_link_local
        or address.is_reserved
        or address.is_unspecified
        or address in ipaddress.ip_network("100.64.0.0/10")
    )

def _recording_project_id(job):
    payload = worker_payload(job)
    return UUID(str(payload["proyecto_id"]))


def _recording_script(url, actions):
    import json

    def literal(value):
        return json.dumps(value, ensure_ascii=False)

    def safe_url(value):
        parts = urlsplit(value)
        query = urlencode([
            (key, "[redacted]" if any(word in key.lower() for word in ("token", "secret", "password", "auth", "session", "key")) else item)
            for key, item in parse_qsl(parts.query, keep_blank_values=True)
        ])
        fragment = "[redacted]" if any(word in parts.fragment.lower() for word in ("token=", "secret=", "password=", "auth=", "session=", "key=")) else parts.fragment
        return urlunsplit((parts.scheme, parts.netloc, parts.path, query, fragment))

    action_lines = []
    action_index = 0
    interaction_count = 0
    for item in actions[:100]:
        kind = item.get("action") if isinstance(item, dict) else None
        if kind == "navigate":
            destination = str(item.get("url", ""))
            if destination.startswith(("http://", "https://")):
                action_lines.append(f"  await page.goto({literal(safe_url(destination))});")
                action_index += 1
            continue
        candidates = item.get("candidates") if isinstance(item, dict) else None
        if not isinstance(candidates, list) or not candidates:
            continue
        encoded = literal(candidates[:6])
        locator = f"await resolve(page, {encoded})"
        action_index += 1
        if kind == "click":
            interaction_count += 1
            action_lines.extend([f"  const target{action_index} = {locator};", f"  await target{action_index}.click();"])
        elif kind == "fill":
            interaction_count += 1
            value = "String(process.env.TRESEKO_TEST_SECRET || 'REEMPLAZAR_SECRETO')" if item.get("sensitive") else literal(str(item.get("value", ""))[:1000])
            action_lines.extend([f"  const target{action_index} = {locator};", f"  await target{action_index}.fill({value});"])
        elif kind == "select":
            interaction_count += 1
            value = "String(process.env.TRESEKO_TEST_SECRET || 'REEMPLAZAR_SECRETO')" if item.get("sensitive") else literal(str(item.get("value", "")))
            action_lines.extend([f"  const target{action_index} = {locator};", f"  await target{action_index}.selectOption({value});"])
        elif kind == "press":
            interaction_count += 1
            action_lines.extend([f"  const target{action_index} = {locator};", f"  await target{action_index}.press({literal(str(item.get('key', 'Enter')))});"])
    if not interaction_count:
        raise ValueError("La grabación no contiene interacciones compatibles; realiza al menos un clic o completa un campo.")
    body = "\n".join(action_lines)
    return f'''import {{ test, expect }} from '@playwright/test';

async function resolve(page, candidates) {{
  for (const candidate of candidates) {{
    let locator;
    try {{
      if (candidate.kind === 'testId') locator = page.getByTestId(candidate.value);
      else if (candidate.kind === 'role') locator = page.getByRole(candidate.role, {{ name: candidate.name, exact: true }});
      else if (candidate.kind === 'label') locator = page.getByLabel(candidate.value, {{ exact: true }});
      else if (candidate.kind === 'placeholder') locator = page.getByPlaceholder(candidate.value, {{ exact: true }});
      else if (candidate.kind === 'text') locator = page.getByText(candidate.value, {{ exact: true }});
      else if (candidate.kind === 'id') locator = page.locator(`[id="${{candidate.value.replaceAll('"', '\\\\"')}}"]`);
      if (locator) {{
        await locator.first().waitFor({{ state: 'visible', timeout: 1800 }});
        if (await locator.count() === 1 && await locator.isEnabled()) return locator;
      }}
    }} catch {{ /* Try the next recorded selector. */ }}
  }}
  throw new Error('Ninguna alternativa de selector identificó un único elemento visible y habilitado.');
}}

test('Recorrido grabado', async ({{ page }}) => {{
  await page.goto({literal(safe_url(url))});
{body}
  // Agrega aquí las comprobaciones del resultado esperado antes de guardar el caso.
}});
'''

@router.post("/automation-recordings/start")
async def start_playwright_recording(
    payload: schemas.PlaywrightRecordingStart,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.scripts", "edit")),
):
    await crud.expire_stale_playwright_recordings(db)
    await access_control.require_project_access(db, current_user, payload.proyecto_id, "edit")
    environment = await db.get(models.Entorno, payload.entorno_id)
    if not environment or not environment.activo or environment.proyecto_id != payload.proyecto_id:
        raise HTTPException(status_code=404, detail="Selecciona un ambiente activo del proyecto")
    try:
        target = urlsplit(environment.url)
    except Exception:
        target = None
    if not target or target.scheme not in {"http", "https"} or not target.hostname or target.username or target.password:
        raise HTTPException(status_code=400, detail="El ambiente debe tener una URL HTTP o HTTPS válida, sin credenciales")
    if _is_private_recorder_target(target):
        raise HTTPException(
            status_code=422,
            detail="El navegador remoto no puede acceder a localhost ni a direcciones privadas. Graba con la extensión de Treseko desde un navegador que sí alcance el sitio e importa el archivo .spec.js.",
        )

    project = await db.get(models.Proyecto, payload.proyecto_id)
    if not project:
        raise HTTPException(status_code=404, detail="Proyecto no encontrado")

    await db.execute(select(models.Usuario.id).where(models.Usuario.id == current_user.id).with_for_update())
    active = await db.execute(select(models.AutomationJob).filter(
        models.AutomationJob.job_type == "PLAYWRIGHT_RECORDING",
        models.AutomationJob.proyecto_id == payload.proyecto_id,
        models.AutomationJob.creado_por == current_user.id,
        models.AutomationJob.estado.in_((models.AutomationJobStatus.PENDING, models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING)),
    ).limit(1))
    if active.scalar_one_or_none():
        raise HTTPException(status_code=409, detail="Ya tienes una grabación activa en este proyecto")

    job_payload = freeze_worker_payload({
        "job_type": "PLAYWRIGHT_RECORDING",
        "proyecto_id": str(project.id),
        "entorno_id": str(environment.id),
        "environment_name": environment.nombre,
        "url": environment.url,
        "framework": "playwright",
        "language": "javascript",
        "browser": "chromium",
    })
    job = models.AutomationJob(
        job_type="PLAYWRIGHT_RECORDING",
        organizacion_id=project.organizacion_id,
        proyecto_id=project.id,
        required_framework="playwright",
        required_language="javascript",
        timeout_seconds=1800,
        payload_congelado=job_payload,
        metadata_resultado={"recorder_control": "CONTINUE", "recording_mode": "browser"},
        creado_por=current_user.id,
        max_attempts=1,
    )
    db.add(job)
    await db.flush()
    browser = {}
    try:
        browser = await mcp_browser.open_recording_session(current_user, project, environment.url)
    except Exception as exc:
        await db.rollback()
        if getattr(exc, "code", None) == "WEB_TARGET_REJECTED":
            raise HTTPException(
                status_code=422,
                detail="El sitio seleccionado resuelve a una dirección privada. Graba con la extensión de Treseko desde un navegador que sí alcance el sitio e importa el archivo .spec.js.",
            ) from exc
        if getattr(exc, "code", None) == "WEB_TARGET_UNAVAILABLE":
            raise HTTPException(status_code=502, detail="El sitio público no respondió. Comprueba su disponibilidad e inténtalo otra vez.") from exc
        raise HTTPException(status_code=503, detail="No se pudo abrir el navegador web de grabación. Comprueba que el Engine esté disponible.") from exc
    job.estado = models.AutomationJobStatus.RUNNING
    job.fecha_inicio = utc_now()
    job.metadata_resultado = {**(job.metadata_resultado or {}), "browser_id": browser["browser_id"]}
    await crud.create_audit_log(
        db=db,
        usuario_id=current_user.id,
        accion="CREATE",
        recurso="playwright_recording",
        recurso_id=job.id,
        detalles={"proyecto_id": str(project.id), "entorno_id": str(environment.id), "mode": "browser"},
    )
    await db.commit()
    await db.refresh(job)
    await _publish_automation_job_event(db, "automation.job.created", job, actor_id=current_user.id)
    return {
        "id": job.id,
        "estado": job.estado,
        "environment_name": environment.nombre,
        "recording_mode": "browser",
        "url": environment.url,
        **browser,
    }


@router.get("/automation-recordings/active")
async def get_active_playwright_recording(
    proyecto_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.scripts", "edit")),
):
    """Restore the caller's active recorder after a page reload."""
    await crud.expire_stale_playwright_recordings(db)
    await access_control.require_project_access(db, current_user, proyecto_id, "edit")
    result = await db.execute(
        select(models.AutomationJob)
        .filter(
            models.AutomationJob.job_type == "PLAYWRIGHT_RECORDING",
            models.AutomationJob.proyecto_id == proyecto_id,
            models.AutomationJob.creado_por == current_user.id,
            models.AutomationJob.estado.in_((models.AutomationJobStatus.PENDING, models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING)),
        )
        .order_by(models.AutomationJob.fecha_creacion.desc())
        .limit(1)
    )
    job = result.scalar_one_or_none()
    if not job:
        return {"active": None}

    metadata = job.metadata_resultado or {}
    browser_state = {}
    browser_unavailable = False
    if job.estado == models.AutomationJobStatus.RUNNING and metadata.get("browser_id"):
        project = await db.get(models.Proyecto, _recording_project_id(job))
        try:
            browser_state = await mcp_browser.recording_session_action(current_user, project, metadata["browser_id"])
        except Exception:
            # Keep the job id available so the UI can cancel the orphaned
            # backend record and release the one-active-session guard.
            browser_unavailable = True
    payload = worker_payload(job)
    return {
        "active": {
            "id": job.id,
            "estado": job.estado,
            "recording_mode": metadata.get("recording_mode", "browser"),
            "worker_name": metadata.get("worker_name"),
            "worker_host": metadata.get("worker_host"),
            "environment_name": payload.get("environment_name"),
            "entorno_id": payload.get("entorno_id"),
            "url": payload.get("url"),
            "browser_unavailable": browser_unavailable,
            **browser_state,
        }
    }


@router.get("/automation-recordings/{job_id}")
async def get_playwright_recording(
    job_id: UUID,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.scripts", "edit")),
):
    await crud.expire_stale_playwright_recordings(db)
    job = await crud.get_automation_job(db, job_id)
    if not job or job.job_type != "PLAYWRIGHT_RECORDING":
        raise HTTPException(status_code=404, detail="Grabación no encontrada")
    if job.creado_por != current_user.id:
        raise HTTPException(status_code=404, detail="Grabación no encontrada")
    await _require_automation_job_access(db, current_user, job, "edit")
    metadata = job.metadata_resultado or {}
    browser_state = None
    if job.estado == models.AutomationJobStatus.RUNNING and metadata.get("browser_id"):
        project = await db.get(models.Proyecto, _recording_project_id(job))
        try:
            browser_state = await mcp_browser.recording_session_action(current_user, project, metadata["browser_id"])
        except Exception as exc:
            raise HTTPException(status_code=503, detail="Se perdió la sesión del navegador; cancela y vuelve a iniciar la grabación.") from exc
    return {
        "id": job.id,
        "estado": job.estado,
        "recording_mode": metadata.get("recording_mode", "browser"),
        "worker_name": metadata.get("worker_name"),
        "worker_host": metadata.get("worker_host"),
        "environment_name": worker_payload(job).get("environment_name"),
        "url": worker_payload(job).get("url"),
        "script": metadata.get("recorded_script") if job.estado == models.AutomationJobStatus.PASSED else None,
        "error": job.error_message if job.estado in {models.AutomationJobStatus.ERROR, models.AutomationJobStatus.TIMEOUT, models.AutomationJobStatus.BLOCKED} else None,
        "control": metadata.get("recorder_control", "CONTINUE"),
        **(browser_state or {}),
    }


@router.post("/automation-recordings/{job_id}/action")
async def act_playwright_recording(
    job_id: UUID,
    payload: dict,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.scripts", "edit")),
):
    job = await crud.get_automation_job(db, job_id)
    if not job or job.job_type != "PLAYWRIGHT_RECORDING" or job.creado_por != current_user.id:
        raise HTTPException(status_code=404, detail="Grabación no encontrada")
    await _require_automation_job_access(db, current_user, job, "edit")
    metadata = job.metadata_resultado or {}
    if job.estado != models.AutomationJobStatus.RUNNING or metadata.get("recording_mode") != "browser":
        raise HTTPException(status_code=409, detail="La grabación no está activa")
    action = str(payload.get("action", ""))
    if action not in {"click", "click_at", "scroll_at", "type_text", "press_key", "clear_focused_text", "navigate"}:
        raise HTTPException(status_code=400, detail="Acción de navegador no permitida")
    project = await db.get(models.Proyecto, _recording_project_id(job))
    try:
        return await mcp_browser.recording_session_action(current_user, project, metadata["browser_id"], payload)
    except Exception as exc:
        raise HTTPException(status_code=422, detail="No se pudo ejecutar la acción en la sesión web; actualiza la pantalla e inténtalo otra vez.") from exc


@router.post("/automation-recordings/{job_id}/finish")
async def finish_playwright_recording(
    job_id: UUID,
    payload: schemas.PlaywrightRecordingFinish,
    db: AsyncSession = Depends(get_db),
    current_user: models.Usuario = Depends(auth.check_capability("crear_pruebas.scripts", "edit")),
):
    job = await crud.get_automation_job(db, job_id)
    if not job or job.job_type != "PLAYWRIGHT_RECORDING" or job.creado_por != current_user.id:
        raise HTTPException(status_code=404, detail="Grabación no encontrada")
    await _require_automation_job_access(db, current_user, job, "edit")
    if job.estado in {models.AutomationJobStatus.PENDING, models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING}:
        metadata = job.metadata_resultado or {}
        project = await db.get(models.Proyecto, _recording_project_id(job))
        if metadata.get("recording_mode") == "browser":
            browser_id = metadata.get("browser_id")
            browser_state = None
            try:
                if not payload.cancel:
                    browser_state = await mcp_browser.recording_session_action(current_user, project, metadata["browser_id"])
            except Exception as exc:
                if not payload.cancel:
                    raise HTTPException(status_code=503, detail="No se pudo finalizar la sesión del navegador. Intenta de nuevo.") from exc
            actions = (browser_state or {}).get("recorded_actions", [])
            if payload.cancel:
                try:
                    await mcp_browser.close_recording_session(current_user, project, browser_id)
                except Exception:
                    pass
                job.estado = models.AutomationJobStatus.CANCELLED
                job.error_message = "Grabación cancelada por el usuario."
                metadata = {**metadata, "recorder_control": "CANCEL", "browser_id": None}
            else:
                try:
                    script = _recording_script(worker_payload(job).get("url", ""), actions)
                except ValueError as exc:
                    raise HTTPException(status_code=422, detail=str(exc)) from exc
                try:
                    await mcp_browser.close_recording_session(current_user, project, metadata["browser_id"])
                except Exception as exc:
                    raise HTTPException(status_code=503, detail="No se pudo cerrar la sesión del navegador. Intenta finalizar de nuevo.") from exc
                job.estado = models.AutomationJobStatus.PASSED
                metadata = {**metadata, "recorded_script": script, "recorded_actions": actions, "recorder_control": "STOP", "browser_id": None}
            job.metadata_resultado = metadata
            job.fecha_fin = utc_now()
        else:
            job.metadata_resultado = {**metadata, "recorder_control": "CANCEL" if payload.cancel else "STOP"}
            if payload.cancel:
                job.estado = models.AutomationJobStatus.CANCELLED
                job.fecha_fin = utc_now()
                job.error_message = "Grabación cancelada por el usuario."
        await crud.create_audit_log(
            db=db,
            usuario_id=current_user.id,
            accion="CANCEL" if payload.cancel else "FINISH",
            recurso="playwright_recording",
            recurso_id=job.id,
            detalles={"estado": job.estado.value if hasattr(job.estado, "value") else str(job.estado), "action_count": len((job.metadata_resultado or {}).get("recorded_actions", []))},
        )
        await db.commit()
        await db.refresh(job)
    return {
        "id": job.id,
        "estado": job.estado,
        "recording_mode": (job.metadata_resultado or {}).get("recording_mode", "browser"),
        "script": (job.metadata_resultado or {}).get("recorded_script") if job.estado == models.AutomationJobStatus.PASSED else None,
    }


@router.get("/automation-recordings/{job_id}/control")
async def get_playwright_recording_control(
    job_id: UUID,
    x_job_lease_token: Optional[str] = Header(default=None),
    db: AsyncSession = Depends(get_db),
    runner: models.AutomationRunner = Depends(get_current_automation_runner),
):
    job = await crud.get_automation_job(db, job_id)
    if not job or job.job_type != "PLAYWRIGHT_RECORDING":
        raise HTTPException(status_code=404, detail="Grabación no encontrada")
    ensure_job_runner_access(job, runner)
    if not x_job_lease_token or not secrets.compare_digest(str(job.lease_token or ""), x_job_lease_token):
        raise HTTPException(status_code=409, detail="Lease de grabación inválido")
    return {"action": (job.metadata_resultado or {}).get("recorder_control", "CONTINUE")}
