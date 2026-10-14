"""Persisted quality counts aggregated in SQL, without loading result bodies."""
from sqlalchemy import select, func
from .. import models


async def grouped(db, column, *conditions, join_runs=False):
    query = select(column, func.count()).where(*conditions).group_by(column)
    if join_runs:
        query = query.join(models.TestRun, models.TestRun.id == models.EjecucionCaso.test_run_id)
    rows = (await db.execute(query)).all()
    return {str(getattr(status, 'value', status) or 'N/D'): count for status, count in rows}


async def build_counts(db, project_id, build_id):
    runs = await grouped(db, models.TestRun.estado_run, models.TestRun.proyecto_id == project_id, models.TestRun.build_id == build_id)
    results = await grouped(db, models.EjecucionCaso.estado_resultado, models.TestRun.proyecto_id == project_id, models.TestRun.build_id == build_id, join_runs=True)
    return {'runs': {'total': sum(runs.values()), 'by_status': runs}, 'results': {'total': sum(results.values()), 'by_status': results}}
