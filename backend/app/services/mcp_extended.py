"""Governed MCP read handlers for evidence, inventory, versions and quality."""
from __future__ import annotations
from uuid import UUID
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from .. import models
from ..evidence_url_security import sanitize_evidence_url
def _value(value):
    return getattr(value, "value", value)


_SECRET_KEYS = {"password", "passwd", "secret", "token", "api_key", "apikey", "authorization", "cookie", "credential", "private_key", "client_secret", "access_key"}


def _safe_report(value, depth=0):
    from .mcp_redaction import redact
    return redact(value)


def _meta_attachment(link):
    attachment = getattr(link, "attachment", None)
    if not attachment:
        return {"id": str(link.id), "attachment_id": str(link.attachment_id), "tipo": link.tipo}
    return {"id": str(link.id), "attachment_id": str(attachment.id), "tipo": str(link.tipo or ""),
            "filename": str(attachment.filename_original or ""),
            "content_type": str(attachment.content_type or ""), "size": int(attachment.size or 0),
            "sha256": str(attachment.sha256 or ""), "url": sanitize_evidence_url(attachment.public_url)}


async def list_evidence(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
    snapshot_id = UUID(arguments["snapshot_id"])
    snapshot = await db.scalar(select(models.SnapshotPaso).join(models.EjecucionCaso).join(models.TestRun).where(
        models.SnapshotPaso.id == snapshot_id, models.TestRun.proyecto_id == project.id))
    if snapshot is None:
        raise LookupError("snapshot not found")
    links = (await db.execute(select(models.SnapshotAttachment).options(selectinload(models.SnapshotAttachment.attachment)).where(models.SnapshotAttachment.snapshot_id == snapshot_id).order_by(models.SnapshotAttachment.id).offset(offset).limit(limit + 1))).scalars().all()
    return {"project_id": str(project.id), "snapshot_id": str(snapshot_id), "items": [_meta_attachment(link) for link in links[:limit]], "next_offset": offset + limit if len(links) > limit else None,
            "evidence_url": str(snapshot.evidencia_url or "") if snapshot.evidencia_url else None}


async def get_evidence(db, user, project, arguments):
    del user
    evidence = await db.scalar(select(models.SnapshotAttachment).options(selectinload(models.SnapshotAttachment.attachment)).join(models.SnapshotPaso).join(models.EjecucionCaso).join(models.TestRun).where(
        models.SnapshotAttachment.id == UUID(arguments["evidence_id"]), models.TestRun.proyecto_id == project.id))
    if evidence is None:
        raise LookupError("evidence not found")
    return {"project_id": str(project.id), **_meta_attachment(evidence)}


def _environment(item):
    return {"id": str(item.id), "name": str(item.nombre or ""), "status": str(item.status or ""),
            "version": str(item.version or "") if item.version else None, "active": bool(item.activo),
            "url": str(item.url or ""), "variables": _safe_report(item.variables or {})}


def _dataset(item):
    return {"id": str(item.id), "environment_id": str(item.entorno_id), "name": str(item.nombre or ""),
            "description": str(item.descripcion or ""), "active": bool(item.activo),
            "default": bool(item.es_default), "variables": _safe_report(item.variables or {})}


async def list_environments(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
    rows = (await db.execute(select(models.Entorno).where(models.Entorno.proyecto_id == project.id, models.Entorno.activo.is_(True)).order_by(models.Entorno.nombre, models.Entorno.id).offset(offset).limit(limit + 1))).scalars().all()
    return {"project_id": str(project.id), "items": [_environment(item) for item in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}


async def get_environment(db, user, project, arguments):
    del user
    item = await db.scalar(select(models.Entorno).where(models.Entorno.id == UUID(arguments["environment_id"]), models.Entorno.proyecto_id == project.id))
    if item is None:
        raise LookupError("environment not found")
    return _environment(item)


async def list_datasets(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
    rows = (await db.execute(select(models.EntornoDataset).join(models.Entorno).where(
        models.EntornoDataset.entorno_id == UUID(arguments["environment_id"]), models.Entorno.proyecto_id == project.id,
        models.EntornoDataset.activo.is_(True)).order_by(models.EntornoDataset.nombre, models.EntornoDataset.id).offset(offset).limit(limit + 1))).scalars().all()
    return {"project_id": str(project.id), "environment_id": arguments["environment_id"], "items": [_dataset(item) for item in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}


async def get_dataset(db, user, project, arguments):
    del user
    item = await db.scalar(select(models.EntornoDataset).join(models.Entorno).where(
        models.EntornoDataset.id == UUID(arguments["dataset_id"]), models.Entorno.proyecto_id == project.id))
    if item is None:
        raise LookupError("dataset not found")
    return _dataset(item)


async def list_case_versions(db, user, project, arguments):
    del user
    limit, offset = arguments.get("limit", 100), arguments.get("offset", 0)
    case = await db.scalar(select(models.CasoPrueba).where(models.CasoPrueba.id == UUID(arguments["case_id"]), models.CasoPrueba.proyecto_id == project.id))
    if case is None:
        raise LookupError("case not found")
    rows = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.master_id == case.master_id, models.CasoPrueba.proyecto_id == project.id).order_by(models.CasoPrueba.version, models.CasoPrueba.id).offset(offset).limit(limit + 1))).scalars().all()
    return {"project_id": str(project.id), "case_id": str(case.id), "master_id": str(case.master_id),
            "items": [{"id": str(item.id), "version": item.version, "active": bool(item.activo), "format": _value(item.formato_prueba), "test_type": _value(item.tipo_prueba), "title": str(item.titulo or "")} for item in rows[:limit]], "next_offset": offset + limit if len(rows) > limit else None}


async def quality_trends(db, user, project, arguments):
    del user
    limit = min(int(arguments.get("limit", 20)), 50)
    offset = arguments.get("offset", 0)
    builds = (await db.execute(select(models.Build).where(models.Build.proyecto_id == project.id).order_by(models.Build.fecha_creacion.desc(), models.Build.id.desc()).offset(offset).limit(limit + 1))).scalars().all()
    items = []
    for build in builds[:limit]:
        from .mcp_metrics import build_counts
        counts = await build_counts(db, project.id, build.id)
        items.append({"build_id": str(build.id), "build": str(build.nombre or ""), "runs": counts["runs"]["total"], "results": counts["results"]["total"], "by_status": counts["results"]["by_status"]})
    return {"project_id": str(project.id), "items": items, "next_offset": offset + limit if len(builds) > limit else None, "metrics_source": "persisted TestRun/EjecucionCaso counts"}


async def compare_builds(db, user, project, arguments):
    del user
    def bid(name): return UUID(arguments[name])
    out = []
    for key in ("baseline_build_id", "candidate_build_id"):
        build = await db.scalar(select(models.Build).where(models.Build.id == bid(key), models.Build.proyecto_id == project.id))
        if build is None: raise LookupError("build not found")
        from .mcp_metrics import build_counts
        counts = await build_counts(db, project.id, build.id)
        out.append({"build_id": str(build.id), "name": str(build.nombre or ""), "runs": counts["runs"]["total"], "results": counts["results"]["total"], "by_status": counts["results"]["by_status"]})
    return {"project_id": str(project.id), "baseline": out[0], "candidate": out[1], "metrics_source": "persisted TestRun/EjecucionCaso counts"}


HANDLERS = {"evidence.list": list_evidence, "evidence.get": get_evidence, "environments.list": list_environments,
            "environments.get": get_environment, "datasets.list": list_datasets, "datasets.get": get_dataset,
            "cases.versions.list": list_case_versions, "quality.trends": quality_trends, "quality.compare": compare_builds}
