"""Transactional suite lifecycle; folder retirement preserves case definitions."""
from sqlalchemy import select, func
from .. import models
from .suite_policy import suite_rows, descendants, editable_path
from .case_mutation_policy import lock_case_master, require_archivable_masters


async def cases_in_tree(db, rows, suite_id):
    ids = [suite_id, *(row.id for row in descendants(rows, suite_id) if row.activo)]
    latest = select(models.CasoPrueba.master_id, func.max(models.CasoPrueba.version).label('version')).group_by(models.CasoPrueba.master_id).subquery()
    cases = (await db.execute(select(models.CasoPrueba).where(
        models.CasoPrueba.suite_id.in_(ids), models.CasoPrueba.activo.is_(True),
    ).join(latest, (models.CasoPrueba.master_id == latest.c.master_id) & (models.CasoPrueba.version == latest.c.version)))).scalars().all()
    project_id = next(row.proyecto_id for row in rows if row.id == suite_id)
    if any(item.proyecto_id != project_id for item in cases):
        raise ValueError('La rama contiene casos de otro proyecto. Revisa sus relaciones antes de modificarla.')
    return cases


async def tree_has_cases(db, suite):
    return bool(await cases_in_tree(db, await suite_rows(db, suite.proyecto_id), suite.id))


async def _locked_versions(db, cases):
    masters = sorted({item.master_id for item in cases}, key=str)
    for master in masters:
        await lock_case_master(db, master)
    if not masters:
        return []
    return (await db.execute(select(models.CasoPrueba).where(
        models.CasoPrueba.master_id.in_(masters), models.CasoPrueba.activo.is_(True),
    ).with_for_update().execution_options(populate_existing=True))).scalars().all()


async def require_no_pending_execution(db, masters):
    if not masters:
        return
    from .case_mutation_policy import CaseArchiveConflict
    pending = await db.scalar(select(models.EjecucionCaso.id).join(models.CasoPrueba,
        models.CasoPrueba.id == models.EjecucionCaso.caso_id).join(models.TestRun,
        models.TestRun.id == models.EjecucionCaso.test_run_id).where(
        models.CasoPrueba.master_id.in_(masters), models.TestRun.estado_run != models.EstadoRun.CERRADO,
        models.EjecucionCaso.estado_resultado.in_([models.EstadoResultado.SIN_CORRER, models.EstadoResultado.EJECUTANDO_AI]),
    ).limit(1))
    if pending:
        raise CaseArchiveConflict('La suite tiene ejecuciones pendientes o en curso. Finaliza o cancela el run antes de retirarla.')
    job = await db.scalar(select(models.AutomationJob.id).join(models.CasoPrueba,
        models.CasoPrueba.id == models.AutomationJob.caso_id).where(models.CasoPrueba.master_id.in_(masters),
        models.AutomationJob.estado.in_([models.AutomationJobStatus.PENDING, models.AutomationJobStatus.CLAIMED, models.AutomationJobStatus.RUNNING, models.AutomationJobStatus.BLOCKED_BY_RUNNER]),
    ).limit(1))
    if job:
        raise CaseArchiveConflict('La suite tiene trabajos automatizados pendientes o en curso. Cancélalos antes de retirarla.')


async def archive_tree(db, suite_id, archived, *, commit=True):
    root = await db.get(models.Suite, suite_id)
    if not root or not root.activo:
        return False, 'Suite no encontrada', {}
    rows = await suite_rows(db, root.proyecto_id)
    root = editable_path(rows, suite_id, allow_archived_self=True)
    if root.archivado == archived:
        return True, 'La suite ya tiene el estado solicitado', {'suites_afectadas': 0, 'casos_afectados': 0, 'archivado': archived}
    tree = [root, *(row for row in descendants(rows, suite_id) if row.activo)]
    cases = await cases_in_tree(db, rows, suite_id)
    versions = await _locked_versions(db, cases)
    if archived:
        await require_archivable_masters(db, {item.master_id for item in versions})
        await require_no_pending_execution(db, {item.master_id for item in versions})
        root.archive_snapshot = {'version': 1,
            'suites': {str(item.id): bool(item.archivado) for item in tree},
            'cases': {str(item.id): item.estado_caso.value for item in versions}}
        for item in tree:
            item.archivado = True
        for item in versions:
            item.estado_caso = models.EstadoCaso.ARCHIVADO
        changed_suites, changed_cases = len(tree), len({item.master_id for item in versions})
        notice = None
    else:
        snapshot = root.archive_snapshot or {}
        changed_suites, restored_masters = 0, set()
        if snapshot.get('version') == 1:
            prior_suites = snapshot.get('suites') or {}
            for item in tree:
                if str(item.id) in prior_suites:
                    item.archivado = bool(prior_suites[str(item.id)])
                    changed_suites += 1
            prior_cases = snapshot.get('cases') or {}
            for item in versions:
                previous = prior_cases.get(str(item.id))
                if previous and item.estado_caso == models.EstadoCaso.ARCHIVADO:
                    item.estado_caso = models.EstadoCaso(previous)
                    restored_masters.add(item.master_id)
            notice = None
        else:
            # Old archival did not retain previous states. Do not guess them.
            root.archivado = False
            changed_suites = 1
            notice = 'Archivado anterior sin estados previos: se restauró la carpeta; revisa y restaura sus subsuites y casos individualmente.'
        root.archive_snapshot = None
        changed_cases = len(restored_masters)
    if commit:
        await db.commit()
    else:
        await db.flush()
    return True, 'Suite archivada correctamente' if archived else 'Suite restaurada correctamente', {
        'suites_afectadas': changed_suites, 'casos_afectados': changed_cases,
        'archivado': archived, **({'notice': notice} if notice else {}),
    }


async def delete_tree(db, suite_id, *, commit=True):
    root = await db.get(models.Suite, suite_id)
    if not root or not root.activo:
        return False, 'Suite no encontrada'
    rows = await suite_rows(db, root.proyecto_id)
    editable_path(rows, suite_id, allow_archived_self=True)
    tree = [root, *(row for row in descendants(rows, suite_id) if row.activo)]
    versions = await _locked_versions(db, await cases_in_tree(db, rows, suite_id))
    await require_archivable_masters(db, {item.master_id for item in versions})
    masters = {item.master_id for item in versions}
    await require_no_pending_execution(db, masters)
    if masters and await db.scalar(select(models.EjecucionCaso.id).join(models.CasoPrueba,
        models.CasoPrueba.id == models.EjecucionCaso.caso_id).where(models.CasoPrueba.master_id.in_(masters)).limit(1)):
        return False, 'No se puede eliminar una suite con casos que tienen ejecuciones. Archiva la suite para conservar su historial.'
    for item in tree:
        item.activo = False
    for item in versions:
        item.activo = False
    if commit:
        await db.commit()
    else:
        await db.flush()
    return True, 'Suite eliminada correctamente'
