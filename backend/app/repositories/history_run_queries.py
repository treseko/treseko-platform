"""Shared filters, stable pages and totals for historical runs."""
from .repository_context import *


def _build_test_runs_query(
    db: AsyncSession,
    proyecto_id: UUID,
    build_id: Optional[UUID] = None,
    component_id: Optional[UUID] = None,
    case_query: Optional[str] = None,
    case_code: Optional[str] = None,
    status: Optional[str] = None,
    run_result: Optional[str] = None,
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

    if component_id or case_query or case_code or status or version_executed is not None or ai_review_status:
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
        # ``TestRun`` contiene columnas JSON. PostgreSQL no puede aplicar
        # ``DISTINCT`` a una fila que las incluya porque JSON no tiene un
        # operador de igualdad. Agrupar por la clave primaria deduplica las
        # filas introducidas por los joins de filtros sin comparar esos campos.
        query = query.group_by(models.TestRun.id)

    if run_result:
        from .history_run_status import run_result_expression
        query = query.filter(run_result_expression() == run_result)

    if has_evidence is not None:
        # Correlate at run level: a run with one empty step and one attachment
        # belongs only to "with evidence".
        from sqlalchemy import exists, and_
        snapshot_evidence = exists(select(models.SnapshotPaso.id).join(
            models.EjecucionCaso, models.EjecucionCaso.id == models.SnapshotPaso.ejecucion_caso_id,
        ).outerjoin(models.SnapshotAttachment, models.SnapshotAttachment.snapshot_id == models.SnapshotPaso.id).where(
            models.EjecucionCaso.test_run_id == models.TestRun.id,
            or_(and_(models.SnapshotPaso.evidencia_url.isnot(None), models.SnapshotPaso.evidencia_url != ""),
                models.SnapshotAttachment.attachment_id.isnot(None)),
        ))
        structured_evidence = exists(select(models.EjecucionCaso.id).where(
            models.EjecucionCaso.test_run_id == models.TestRun.id,
            or_(cast(models.EjecucionCaso.api_resultado, String).notin_(["{}", "null"]),
                cast(models.EjecucionCaso.chatbot_resultado, String).notin_(["{}", "null"])),
        ))
        evidence_filter = or_(snapshot_evidence, structured_evidence)
        query = query.filter(evidence_filter if has_evidence else ~evidence_filter)
    return query


async def get_test_runs_proyecto(db: AsyncSession, proyecto_id: UUID, skip: int = 0, limit: int = 100, **filters):
    query = _build_test_runs_query(db, proyecto_id, **filters)
    result = await db.execute(query.order_by(models.TestRun.fecha_creacion.desc(), models.TestRun.id.desc()).offset(skip).limit(limit))
    return result.scalars().all()


async def count_test_runs_proyecto(db: AsyncSession, proyecto_id: UUID, **filters):
    query = _build_test_runs_query(db, proyecto_id, **filters)
    result = await db.execute(select(func.count()).select_from(query.with_only_columns(models.TestRun.id).subquery()))
    return int(result.scalar_one())
