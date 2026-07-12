from .legacy_common import *
import logging

from ..services.error_sanitizer import sanitize_external_error


logger = logging.getLogger(__name__)
REDMINE_REQUEST_TIMEOUT = httpx.Timeout(10.0, connect=5.0)


def _safe_redmine_issue_text(value, *, fallback: str = "N/D", max_len: int = 1200) -> str:
    if value is None or str(value).strip() == "":
        return fallback
    return sanitize_external_error(value, max_len=max_len)


async def get_execution_history_details(db: AsyncSession, ejecucion_id: UUID):
    details_by_execution = await get_execution_history_details_bulk(db, [ejecucion_id])
    return details_by_execution.get(ejecucion_id, _empty_execution_history_details())


def _empty_execution_history_details():
    return {
        "paso_fallido": None,
        "snapshot_id": None,
        "datos_prueba": None,
        "resultado_esperado": None,
        "accion": None,
        "evidencia_url": None,
        "evidencias": [],
        "observaciones": None,
        "snapshots": [],
    }


def _build_execution_history_details(snapshots, attachments_by_snapshot):
    if not snapshots:
        return _empty_execution_history_details()
    failed_snapshot = next(
        (snap for snap in snapshots if snap.estado_paso in (models.EstadoResultado.FALLO, models.EstadoResultado.BLOQUEADO)),
        None
    )
    evidence_snapshot = next((snap for snap in snapshots if snap.evidencia_url), failed_snapshot)
    observation_snapshot = next((snap for snap in snapshots if snap.comentarios), failed_snapshot)
    linked_evidence_url = None
    all_evidencias = []
    preferred_evidencias = []
    for snap in snapshots:
        links = attachments_by_snapshot.get(snap.id, [])
        snap_evidencias = [_attachment_to_dict(link.attachment) for link in links if link.attachment]
        if snap == evidence_snapshot:
            preferred_evidencias.extend(snap_evidencias)
        all_evidencias.extend(snap_evidencias)
        snap.evidencias = snap_evidencias
    if preferred_evidencias:
        linked_evidence_url = preferred_evidencias[0]["public_url"]
    preferred_ids = {preferred["id"] for preferred in preferred_evidencias}
    return {
        "paso_fallido": failed_snapshot.numero_paso if failed_snapshot else None,
        "snapshot_id": str(failed_snapshot.id) if failed_snapshot else None,
        "datos_prueba": failed_snapshot.datos_congelados if failed_snapshot else None,
        "resultado_esperado": failed_snapshot.resultado_esperado_congelado if failed_snapshot else None,
        "accion": failed_snapshot.accion_congelada if failed_snapshot else None,
        "evidencia_url": linked_evidence_url or (evidence_snapshot.evidencia_url if evidence_snapshot else None) or (all_evidencias[0]["public_url"] if all_evidencias else None),
        "evidencias": preferred_evidencias + [item for item in all_evidencias if item["id"] not in preferred_ids],
        "observaciones": observation_snapshot.comentarios if observation_snapshot else None,
        "snapshots": [
            {
                "id": str(snap.id),
                "numero_paso": snap.numero_paso,
                "paso_id": str(snap.paso_id) if snap.paso_id else None,
                "accion_congelada": snap.accion_congelada,
                "datos_congelados": snap.datos_congelados,
                "resultado_esperado_congelado": snap.resultado_esperado_congelado,
                "estado_paso": snap.estado_paso.value if hasattr(snap.estado_paso, "value") else snap.estado_paso,
                "comentarios": snap.comentarios,
                "evidencia_url": snap.evidencia_url,
                "error_log": snap.error_log,
                "evidencias": getattr(snap, "evidencias", []),
            }
            for snap in snapshots
        ],
    }


async def get_execution_history_details_bulk(db: AsyncSession, ejecucion_ids: List[UUID]) -> Dict[UUID, Dict[str, Any]]:
    unique_ids = list(dict.fromkeys([item for item in ejecucion_ids if item]))
    if not unique_ids:
        return {}
    result = await db.execute(
        select(models.SnapshotPaso)
        .filter(models.SnapshotPaso.ejecucion_caso_id.in_(unique_ids))
        .order_by(models.SnapshotPaso.numero_paso)
    )
    snapshots = result.scalars().all()
    snapshot_ids = [snap.id for snap in snapshots]
    attachments_by_snapshot: Dict[UUID, List[models.SnapshotAttachment]] = {}
    if snapshot_ids:
        attachments_result = await db.execute(
            select(models.SnapshotAttachment)
            .options(selectinload(models.SnapshotAttachment.attachment))
            .filter(models.SnapshotAttachment.snapshot_id.in_(snapshot_ids))
            .order_by(models.SnapshotAttachment.created_at)
        )
        for link in attachments_result.scalars().all():
            attachments_by_snapshot.setdefault(link.snapshot_id, []).append(link)
    snapshots_by_execution: Dict[UUID, List[models.SnapshotPaso]] = {}
    for snap in snapshots:
        snapshots_by_execution.setdefault(snap.ejecucion_caso_id, []).append(snap)
    return {
        execution_id: _build_execution_history_details(snapshots_by_execution.get(execution_id, []), attachments_by_snapshot)
        for execution_id in unique_ids
    }

# --- REDMINE ---
async def create_redmine_config(db: AsyncSession, config: schemas.RedmineConfigCreate):
    await db.execute(models.RedmineConfig.__table__.delete().where(models.RedmineConfig.proyecto_id == config.proyecto_id))
    db_config = models.RedmineConfig(**config.model_dump())
    db.add(db_config)
    await db.commit()
    await db.refresh(db_config)
    return db_config

async def get_redmine_config(db: AsyncSession, proyecto_id: UUID):
    result = await db.execute(select(models.RedmineConfig).filter(models.RedmineConfig.proyecto_id == proyecto_id))
    return result.scalar_one_or_none()

async def report_defect_to_redmine(proyecto_id: UUID, ejecucion_id: UUID, snapshot_id: UUID, db: AsyncSession):
    config = await get_redmine_config(db, proyecto_id)
    if not config: return
    result = await db.execute(select(models.SnapshotPaso).filter(models.SnapshotPaso.id == snapshot_id))
    snap = result.scalar_one_or_none()
    if not snap or snap.estado_paso != models.EstadoResultado.FALLO: return
    payload = {
        "issue": {
            "project_id": config.project_identifier,
            "subject": f"FALLO QA: Paso {snap.numero_paso} en Ejecución {str(ejecucion_id)[:8]}",
            "description": (
                f"Acción: {_safe_redmine_issue_text(snap.accion_congelada)}\n"
                f"Resultado Esperado: {_safe_redmine_issue_text(snap.resultado_esperado_congelado)}\n"
                f"Error: {_safe_redmine_issue_text(snap.error_log, fallback='No log')}\n"
                f"Evidencia: {snap.evidencia_url or 'Sin captura'}"
            ),
            "priority_id": 4,
        }
    }
    headers = {"X-Redmine-API-Key": config.api_key}
    try:
        async with httpx.AsyncClient(timeout=REDMINE_REQUEST_TIMEOUT) as client:
            resp = await client.post(f"{config.url}/issues.json", json=payload, headers=headers)
            if resp.status_code == 201:
                issue_id = (resp.json().get("issue") or {}).get("id", "sin-id")
                logger.info("Defecto reportado exitosamente a Redmine: %s", issue_id)
            else:
                logger.warning(
                    "Redmine rechazo el defecto QA con estado %s: %s",
                    resp.status_code,
                    sanitize_external_error(getattr(resp, "text", "")),
                )
    except Exception as e:
        logger.warning("Error al conectar con Redmine: %s", sanitize_external_error(e))
