from .repository_context import *


async def ensure_bug_build_is_active(db: AsyncSession, bug: models.BugIssue) -> None:
    if not bug.build_id:
        return
    build = (
        await db.execute(select(models.Build).filter(models.Build.id == bug.build_id))
    ).scalar_one_or_none()
    if build is None or access_control.is_build_active(build):
        return
    if bug.caso_id:
        bug_case = (
            await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == bug.caso_id))
        ).scalar_one_or_none()
        if bug_case:
            active_tracking_build = (
                await db.execute(
                    select(models.Build.id)
                    .join(models.BuildCaso, models.BuildCaso.build_id == models.Build.id)
                    .join(models.CasoPrueba, models.CasoPrueba.id == models.BuildCaso.caso_id)
                    .filter(
                        models.Build.proyecto_id == bug.proyecto_id,
                        models.Build.activo.is_(True),
                        models.Build.estado == "ACTIVA",
                    )
                    .filter(models.CasoPrueba.master_id == bug_case.master_id)
                    .limit(1)
                )
            ).scalar_one_or_none()
            if active_tracking_build:
                return
    metadata = bug.metadata_json if isinstance(bug.metadata_json, dict) else {}
    occurrence_build_ids = [
        item.get("build_id") for item in (metadata.get("linked_execution_occurrences") or [])
        if isinstance(item, dict) and item.get("build_id")
    ]
    if occurrence_build_ids:
        active_occurrence = (
            await db.execute(
                select(models.Build.id)
                .filter(models.Build.id.in_(occurrence_build_ids), models.Build.proyecto_id == bug.proyecto_id)
                .filter(models.Build.activo.is_(True), models.Build.estado == "ACTIVA")
                .limit(1)
            )
        ).scalar_one_or_none()
        if active_occurrence:
            return
    raise ValueError(
        "La build origen del bug está inactiva. Para modificarlo, registra seguimiento en una build activa del mismo caso o reabre una build vigente."
    )
