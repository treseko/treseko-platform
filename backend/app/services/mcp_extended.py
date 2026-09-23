"""Governed MCP read handlers for evidence, inventory, versions and quality."""
from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from .. import models
from ..evidence_url_security import sanitize_evidence_url
def _value(value):
    return getattr(value, "value", value)


_SECRET_KEYS = {"password", "passwd", "secret", "token", "api_key", "apikey", "authorization", "cookie", "credential", "private_key", "client_secret", "access_key"}


def _safe_report(value, depth=0):
    if depth > 6:
        return "[max-depth]"
    if isinstance(value, dict):
        return {str(key)[:120]: "[REDACTED]" if any(token in str(key).lower() for token in _SECRET_KEYS) else _safe_report(item, depth + 1) for key, item in list(value.items())[:100]}
    if isinstance(value, list):
        return [_safe_report(item, depth + 1) for item in value[:100]]
    if isinstance(value, (str, int, float, bool)) or value is None:
        return value if not isinstance(value, str) else value[:16000]
    return str(value)[:200]


def _meta_attachment(link):
    attachment = getattr(link, "attachment", None)
    if not attachment:
        return {"id": str(link.id), "attachment_id": str(link.attachment_id), "tipo": link.tipo}
    return {"id": str(link.id), "attachment_id": str(attachment.id), "tipo": str(link.tipo or ""),
            "filename": str(attachment.filename_original or "")[:255],
            "content_type": str(attachment.content_type or "")[:100], "size": int(attachment.size or 0),
            "sha256": str(attachment.sha256 or "")[:64], "url": sanitize_evidence_url(attachment.public_url)}


async def list_evidence(db, user, project, arguments):
    del user
    snapshot_id = UUID(arguments["snapshot_id"])
    snapshot = await db.scalar(select(models.SnapshotPaso).join(models.EjecucionCaso).join(models.TestRun).where(
        models.SnapshotPaso.id == snapshot_id, models.TestRun.proyecto_id == project.id))
    if snapshot is None:
        raise LookupError("snapshot not found")
    links = (await db.execute(select(models.SnapshotAttachment).where(models.SnapshotAttachment.snapshot_id == snapshot_id))).scalars().all()
    return {"project_id": str(project.id), "snapshot_id": str(snapshot_id), "items": [_meta_attachment(link) for link in links],
            "evidence_url": str(snapshot.evidencia_url or "")[:2048] if snapshot.evidencia_url else None}


async def get_evidence(db, user, project, arguments):
    del user
    evidence = await db.scalar(select(models.SnapshotAttachment).join(models.SnapshotPaso).join(models.EjecucionCaso).join(models.TestRun).where(
        models.SnapshotAttachment.id == UUID(arguments["evidence_id"]), models.TestRun.proyecto_id == project.id))
    if evidence is None:
        raise LookupError("evidence not found")
    return {"project_id": str(project.id), **_meta_attachment(evidence)}


def _environment(item):
    return {"id": str(item.id), "name": str(item.nombre or "")[:100], "status": str(item.status or "")[:50],
            "version": str(item.version or "")[:50] if item.version else None, "active": bool(item.activo),
            "url": str(item.url or "")[:255], "variables": _safe_report(item.variables or {})}


def _dataset(item):
    return {"id": str(item.id), "environment_id": str(item.entorno_id), "name": str(item.nombre or "")[:100],
            "description": str(item.descripcion or "")[:1024], "active": bool(item.activo),
            "default": bool(item.es_default), "variables": _safe_report(item.variables or {})}


async def list_environments(db, user, project, arguments):
    del user, arguments
    rows = (await db.execute(select(models.Entorno).where(models.Entorno.proyecto_id == project.id, models.Entorno.activo.is_(True)).order_by(models.Entorno.nombre))).scalars().all()
    return {"project_id": str(project.id), "items": [_environment(item) for item in rows]}


async def get_environment(db, user, project, arguments):
    del user
    item = await db.scalar(select(models.Entorno).where(models.Entorno.id == UUID(arguments["environment_id"]), models.Entorno.proyecto_id == project.id))
    if item is None:
        raise LookupError("environment not found")
    return _environment(item)


async def list_datasets(db, user, project, arguments):
    del user
    rows = (await db.execute(select(models.EntornoDataset).join(models.Entorno).where(
        models.EntornoDataset.entorno_id == UUID(arguments["environment_id"]), models.Entorno.proyecto_id == project.id,
        models.EntornoDataset.activo.is_(True)).order_by(models.EntornoDataset.nombre))).scalars().all()
    return {"project_id": str(project.id), "environment_id": arguments["environment_id"], "items": [_dataset(item) for item in rows]}


async def get_dataset(db, user, project, arguments):
    del user
    item = await db.scalar(select(models.EntornoDataset).join(models.Entorno).where(
        models.EntornoDataset.id == UUID(arguments["dataset_id"]), models.Entorno.proyecto_id == project.id))
    if item is None:
        raise LookupError("dataset not found")
    return _dataset(item)


async def list_case_versions(db, user, project, arguments):
    del user
    case = await db.scalar(select(models.CasoPrueba).where(models.CasoPrueba.id == UUID(arguments["case_id"]), models.CasoPrueba.proyecto_id == project.id))
    if case is None:
        raise LookupError("case not found")
    rows = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.master_id == case.master_id, models.CasoPrueba.proyecto_id == project.id).order_by(models.CasoPrueba.version))).scalars().all()
    return {"project_id": str(project.id), "case_id": str(case.id), "master_id": str(case.master_id),
            "items": [{"id": str(item.id), "version": item.version, "active": bool(item.activo), "format": _value(item.formato_prueba), "test_type": _value(item.tipo_prueba), "title": str(item.titulo or "")[:256]} for item in rows]}


async def quality_trends(db, user, project, arguments):
    del user
    limit = min(int(arguments.get("limit", 20)), 50)
    builds = (await db.execute(select(models.Build).where(models.Build.proyecto_id == project.id).order_by(models.Build.nombre.desc()).limit(limit))).scalars().all()
    items = []
    for build in builds:
        runs = (await db.execute(select(models.TestRun).where(models.TestRun.proyecto_id == project.id, models.TestRun.build_id == build.id))).scalars().all()
        run_ids = [run.id for run in runs]
        results = (await db.execute(select(models.EjecucionCaso).where(models.EjecucionCaso.test_run_id.in_(run_ids)))).scalars().all() if run_ids else []
        items.append({"build_id": str(build.id), "build": str(build.nombre or "")[:256], "runs": len(runs), "results": len(results),
                      "by_status": {str(_value(status)): sum(1 for result in results if _value(result.estado_resultado) == _value(status)) for status in {result.estado_resultado for result in results}}})
    return {"project_id": str(project.id), "items": items, "metrics_source": "persisted TestRun/EjecucionCaso counts"}


async def compare_builds(db, user, project, arguments):
    del user
    def bid(name): return UUID(arguments[name])
    out = []
    for key in ("baseline_build_id", "candidate_build_id"):
        build = await db.scalar(select(models.Build).where(models.Build.id == bid(key), models.Build.proyecto_id == project.id))
        if build is None: raise LookupError("build not found")
        runs = (await db.execute(select(models.TestRun).where(models.TestRun.proyecto_id == project.id, models.TestRun.build_id == build.id))).scalars().all()
        ids = [run.id for run in runs]
        results = (await db.execute(select(models.EjecucionCaso).where(models.EjecucionCaso.test_run_id.in_(ids)))).scalars().all() if ids else []
        out.append({"build_id": str(build.id), "name": str(build.nombre or "")[:256], "runs": len(runs), "results": len(results),
                    "by_status": {str(_value(status)): sum(1 for result in results if _value(result.estado_resultado) == _value(status)) for status in {result.estado_resultado for result in results}}})
    return {"project_id": str(project.id), "baseline": out[0], "candidate": out[1], "metrics_source": "persisted TestRun/EjecucionCaso counts"}


HANDLERS = {"evidence.list": list_evidence, "evidence.get": get_evidence, "environments.list": list_environments,
            "environments.get": get_environment, "datasets.list": list_datasets, "datasets.get": get_dataset,
            "cases.versions.list": list_case_versions, "quality.trends": quality_trends, "quality.compare": compare_builds}
