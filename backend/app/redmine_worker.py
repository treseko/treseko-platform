import asyncio
from concurrent.futures import ThreadPoolExecutor
import logging
import requests
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from . import models, schemas
from .services.error_sanitizer import sanitize_external_error
import hashlib
from uuid import UUID

# Pool de hilos exclusivo para integraciones externas lentas
# Evita que el Event Loop de FastAPI se bloquee esperando a Redmine
redmine_executor = ThreadPoolExecutor(max_workers=5)
logger = logging.getLogger(__name__)
REDMINE_WORKER_TIMEOUT = (5, 10)


def _safe_redmine_issue_text(value, *, fallback: str = "N/D", max_len: int = 1200) -> str:
    if value is None or str(value).strip() == "":
        return fallback
    return sanitize_external_error(value, max_len=max_len)


def send_bug_to_redmine_sync(url: str, api_key: str, project_id: str, payload: dict):
    """Ejecución síncrona dentro del pool de hilos."""
    headers = {
        "X-Redmine-API-Key": api_key,
        "Content-Type": "application/json"
    }
    try:
        # Timeout corto para no saturar el pool si Redmine está caído
        response = requests.post(
            f"{url}/issues.json", 
            json=payload, 
            headers=headers, 
            timeout=REDMINE_WORKER_TIMEOUT
        )
        if response.status_code == 201:
            issue_id = (response.json().get("issue") or {}).get("id", "sin-id")
            logger.info("Redmine: Bug reportado exitosamente. ID: %s", issue_id)
            return True
        else:
            logger.warning("Redmine: Error %s - %s", response.status_code, sanitize_external_error(response.text))
            return False
    except Exception as e:
        logger.warning("Redmine: Error de conexión - %s", sanitize_external_error(e))
        return False

async def dispatch_redmine_bug(db_session: AsyncSession, proyecto_id: UUID, snapshot_id: UUID):
    """
    Función orquestadora que extrae datos y despacha al hilo aislado.
    Llamada por BackgroundTasks de FastAPI.
    """
    # 1. Obtener Config de Redmine (en el loop asíncrono)
    from . import crud
    config = await crud.get_redmine_config(db_session, proyecto_id)
    if not config:
        return

    # 2. Obtener detalles del fallo
    result = await db_session.execute(select(models.SnapshotPaso).filter(models.SnapshotPaso.id == snapshot_id))
    snap = result.scalar_one_or_none()
    if not snap or snap.estado_paso != models.EstadoResultado.FALLO:
        return

    # 3. Calcular Hash de Deduplicación
    error_content = "".join(
        [
            _safe_redmine_issue_text(snap.accion_congelada, max_len=500),
            _safe_redmine_issue_text(snap.resultado_esperado_congelado, max_len=500),
            _safe_redmine_issue_text(snap.error_log, fallback="", max_len=500),
        ]
    )
    bug_hash = hashlib.sha256(error_content.encode()).hexdigest()

    # 4. Preparar Payload
    payload = {
        "issue": {
            "project_id": config.project_identifier,
            "subject": f"FALLO QA: Paso {snap.numero_paso}",
            "description": (
                f"Acción: {_safe_redmine_issue_text(snap.accion_congelada)}\n"
                f"Resultado Esperado: {_safe_redmine_issue_text(snap.resultado_esperado_congelado)}\n"
                f"Error: {_safe_redmine_issue_text(snap.error_log, fallback='No log available')}\n"
                f"Evidencia: {snap.evidencia_url or 'No image'}\n\n"
                f"--- DEDUP_ID: {bug_hash} ---"
            ),
            "priority_id": 4
        }
    }

    # TODO: Implementar búsqueda en Redmine para evitar duplicados antes de enviar
    # Por ahora solo incluimos el hash en la descripción.

    # 5. Despachar al Pool de Hilos (Fuera del Event Loop)
    loop = asyncio.get_running_loop()
    await loop.run_in_executor(
        redmine_executor, 
        send_bug_to_redmine_sync, 
        config.url, 
        config.api_key, 
        config.project_identifier, 
        payload
    )
