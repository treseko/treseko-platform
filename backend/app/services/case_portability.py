"""Persistence orchestration for the versioned test-case portability broker."""
from __future__ import annotations

import hashlib
import io
import os
import re
import zipfile
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from sqlalchemy import select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession

from .. import models
from ..time_utils import utc_now
from .case_portability_parser import (
    FORMAT_ID, MAX_CASES, PortabilityError, _canonical, parse_import, profiles, validate_file_extension,
)

ROLLBACK_WINDOW = timedelta(hours=1)

async def export_tcases(db: AsyncSession, project_id: UUID, component_id: UUID, suite_ids: list[UUID] | None = None, case_ids: list[UUID] | None = None) -> bytes:
    suites = (await db.execute(select(models.Suite).where(
        models.Suite.proyecto_id == project_id,
        models.Suite.componente_id == component_id,
    ))).scalars().all()
    selected_ids = {str(value) for value in (suite_ids or [])}
    if selected_ids:
        children: dict[str | None, list[str]] = {}
        for suite in suites: children.setdefault(str(suite.parent_id) if suite.parent_id else None, []).append(str(suite.id))
        expanded = set(selected_ids); pending = list(selected_ids)
        while pending:
            for child in children.get(pending.pop(), []):
                if child not in expanded: expanded.add(child); pending.append(child)
        suites = [suite for suite in suites if str(suite.id) in expanded]
    allowed_suite_ids = {str(suite.id) for suite in suites} if selected_ids else None
    cases = (await db.execute(select(models.CasoPrueba).where(
        models.CasoPrueba.proyecto_id == project_id,
        models.CasoPrueba.componente_id == component_id,
    ).order_by(models.CasoPrueba.master_id, models.CasoPrueba.version))).scalars().all()
    if allowed_suite_ids is not None: cases = [case for case in cases if case.suite_id and str(case.suite_id) in allowed_suite_ids]
    if case_ids: cases = [case for case in cases if case.id in set(case_ids)]
    suite_data = [{"id": str(s.id), "parent_id": str(s.parent_id) if s.parent_id else None, "nombre": s.nombre, "descripcion": s.descripcion, "orden": s.orden} for s in suites]
    case_data, versions, attachments = [], [], []
    attachment_files: dict[str, bytes] = {}
    for case in cases:
        steps = (await db.execute(select(models.PasoPrueba).where(models.PasoPrueba.caso_id == case.id).order_by(models.PasoPrueba.numero_paso))).scalars().all()
        step_data = [{"numero_paso": p.numero_paso, "accion": p.accion, "datos": p.datos, "resultado_esperado": p.resultado_esperado} for p in steps]
        entry = {"external_id": str(case.master_id), "external_version": str(case.version), "suite_id": str(case.suite_id) if case.suite_id else None, "titulo": case.titulo, "descripcion": case.descripcion, "precondiciones": case.precondiciones, "postcondiciones": case.postcondiciones, "prioridad": case.prioridad.value, "criticidad": case.criticidad.value, "tipo_prueba": case.tipo_prueba.value, "estado_caso": case.estado_caso.value, "etiquetas": case.etiquetas or [], "pasos": step_data}
        for step in steps:
            links = (await db.execute(select(models.PasoAttachment).where(models.PasoAttachment.paso_id == step.id))).scalars().all()
            for link in links:
                attachment = await db.get(models.Attachment, link.attachment_id)
                if not attachment or not attachment.storage_path or not os.path.isfile(attachment.storage_path):
                    raise PortabilityError(f"No se pudo leer el adjunto {link.attachment_id} del paso {step.id}")
                safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(attachment.filename_original).name)[:120] or "attachment"
                archive_path = f"attachments/{case.master_id}/{step.numero_paso}-{attachment.id}-{safe_name}"
                content = Path(attachment.storage_path).read_bytes()
                attachments.append({"case_external_id": str(case.master_id), "step_number": step.numero_paso, "filename": safe_name, "content_type": attachment.content_type, "size": len(content), "sha256": hashlib.sha256(content).hexdigest(), "tipo": link.tipo, "archive_path": archive_path})
                attachment_files[archive_path] = content
        case_data.append(entry); versions.append({"master_id": str(case.master_id), "version": case.version, "case": entry})
    payloads = {"cases.json": case_data, "suites.json": suite_data, "versions.json": versions, "attachments.json": attachments}
    manifest = {"format": FORMAT_ID, "created_at": utc_now().isoformat(), "project_id": str(project_id), "checksums": {name: hashlib.sha256(_canonical(value)).hexdigest() for name, value in payloads.items()}, "case_count": len(case_data)}
    stream = io.BytesIO()
    with zipfile.ZipFile(stream, "w", compression=zipfile.ZIP_DEFLATED) as archive:
        archive.writestr("manifest.json", _canonical(manifest)); [archive.writestr(name, _canonical(value)) for name, value in payloads.items()]
        for name, content in attachment_files.items(): archive.writestr(name, content)
    return stream.getvalue()


async def preview_import(db: AsyncSession, project_id: UUID, profile_id: str, data: bytes, *, include_binary: bool = False) -> dict[str, Any]:
    package = parse_import(profile_id, data)
    results, new, changed, duplicate = [], 0, 0, 0
    for item in package["cases"]:
        digest = hashlib.sha256(_canonical(item)).hexdigest()
        ref = (await db.execute(select(models.CaseExternalRef).where(models.CaseExternalRef.proyecto_id == project_id, models.CaseExternalRef.source_tool == item["source_tool"], models.CaseExternalRef.external_id == item["external_id"]).order_by(models.CaseExternalRef.created_at.desc()).limit(1))).scalar_one_or_none()
        outcome = "new" if not ref else ("duplicate" if ref.content_sha256 == digest else "new_version")
        new += outcome == "new"; changed += outcome == "new_version"; duplicate += outcome == "duplicate"
        results.append({"external_id": item["external_id"], "titulo": item["titulo"], "outcome": outcome})
    response_package = package if include_binary else {key: value for key, value in package.items() if key != "attachment_files"}
    return {"source_tool": package["tool"], "source_version": package["version"], "file_sha256": hashlib.sha256(data).hexdigest(), "summary": {"total": len(results), "new": new, "new_versions": changed, "duplicates": duplicate}, "diagnostics": package.get("diagnostics", {}), "items": results, "package": response_package}


async def _suite_for_path(db: AsyncSession, project_id: UUID, path: str, created: list[str], descriptions: dict[str, str | None] | None = None, component_id: UUID | None = None) -> UUID | None:
    parent_id = None
    names = [part.strip() for part in path.replace("\\", "/").split("/") if part.strip()][:8]
    for index, name in enumerate(names):
        existing = (await db.execute(select(models.Suite).where(models.Suite.proyecto_id == project_id, models.Suite.parent_id == parent_id, models.Suite.nombre == name, models.Suite.componente_id == component_id))).scalar_one_or_none()
        if existing: parent_id = existing.id; continue
        current_path = "/".join(names[: index + 1])
        suite = models.Suite(proyecto_id=project_id, componente_id=component_id, parent_id=parent_id, nombre=name, descripcion=(descriptions or {}).get(current_path))
        db.add(suite); await db.flush(); parent_id = suite.id; created.append(str(suite.id))
    return parent_id


async def commit_import(db: AsyncSession, project_id: UUID, profile_id: str, data: bytes, file_name: str | None, actor_id: UUID, selected_external_ids: list[str] | None = None, component_id: UUID | None = None, build_id: UUID | None = None) -> models.CaseImportBatch:
    preview = await preview_import(db, project_id, profile_id, data, include_binary=True); package = preview.pop("package")
    if selected_external_ids is not None:
        allowed = set(selected_external_ids); package["cases"] = [item for item in package["cases"] if str(item.get("external_id")) in allowed]
    batch = models.CaseImportBatch(proyecto_id=project_id, source_tool=package["tool"], source_version=package["version"], file_name=(file_name or "import" )[:255], file_sha256=preview["file_sha256"], status="RUNNING", summary_json={}, item_results=[], created_case_ids=[], created_suite_ids=[], created_by=actor_id)
    db.add(batch); await db.flush(); created_cases: list[str] = []; created_suites: list[str] = []; results = []
    try:
        for item in package["cases"]:
            digest = hashlib.sha256(_canonical(item)).hexdigest()
            ref = (await db.execute(select(models.CaseExternalRef).where(models.CaseExternalRef.proyecto_id == project_id, models.CaseExternalRef.source_tool == item["source_tool"], models.CaseExternalRef.external_id == item["external_id"]).order_by(models.CaseExternalRef.created_at.desc()).limit(1))).scalar_one_or_none()
            if ref and ref.content_sha256 == digest:
                results.append({"external_id": item["external_id"], "outcome": "duplicate"}); continue
            suite_id = await _suite_for_path(
                db, project_id, item["suite_path"], created_suites,
                {item["suite_path"]: item.get("suite_description")},
                component_id,
            )
            latest = await db.get(models.CasoPrueba, ref.caso_id) if ref else None
            case = models.CasoPrueba(master_id=(latest.master_id if latest else uuid4()), codigo=(latest.codigo if latest else None), proyecto_id=project_id, suite_id=suite_id, componente_id=component_id, titulo=item["titulo"], descripcion=item["descripcion"], precondiciones=item["precondiciones"], postcondiciones=item["postcondiciones"], version=((latest.version + 1) if latest else 1), prioridad=item["prioridad"], criticidad=item["criticidad"], tipo_prueba=item["tipo_prueba"], estado_caso=item["estado_caso"], etiquetas=item["etiquetas"], creado_por=actor_id)
            db.add(case); await db.flush()
            imported_steps = []
            for step in item["pasos"]:
                row = models.PasoPrueba(caso_id=case.id, **step); db.add(row); imported_steps.append(row)
            await db.flush()
            for attachment in package.get("attachments", []):
                if attachment.get("case_external_id") != item["external_id"]: continue
                step = next((row for row in imported_steps if row.numero_paso == attachment.get("step_number")), None)
                content = package.get("attachment_files", {}).get(attachment.get("archive_path"))
                if not step or not content or hashlib.sha256(content).hexdigest() != attachment.get("sha256"):
                    raise PortabilityError(f"Adjunto inválido para el caso {item['external_id']}")
                safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", Path(attachment.get("filename") or "attachment").name)[:120] or "attachment"
                target_dir = Path(__file__).resolve().parents[1] / "static" / "evidencias"
                target_dir.mkdir(parents=True, exist_ok=True)
                target_name = f"{uuid4()}-{safe_name}"; target_path = target_dir / target_name; target_path.write_bytes(content)
                saved = models.Attachment(filename_original=safe_name, content_type=attachment.get("content_type") or "application/octet-stream", size=len(content), sha256=attachment["sha256"], storage_path=str(target_path), public_url=f"/static/evidencias/{target_name}", scope="CASE_PORTABILITY", proyecto_id=project_id, created_by=actor_id)
                db.add(saved); await db.flush(); db.add(models.PasoAttachment(paso_id=step.id, attachment_id=saved.id, tipo=attachment.get("tipo") or "evidence"))
            db.add(models.CaseExternalRef(proyecto_id=project_id, caso_id=case.id, master_id=case.master_id, source_tool=item["source_tool"], external_id=item["external_id"], external_version=item["external_version"], content_sha256=digest, import_batch_id=batch.id, metadata_json={"profile": profile_id}))
            created_cases.append(str(case.id)); results.append({"external_id": item["external_id"], "case_id": str(case.id), "outcome": "new_version" if latest else "new"})
        # Mark the completion boundary after all records exist. Rollback uses
        # this timestamp to distinguish imported rows from later edits; using
        # the initial batch timestamp would incorrectly reject every rollback.
        batch.created_at = utc_now()
        batch.status = "COMPLETED"; batch.summary_json = {**preview["summary"], "diagnostics": preview.get("diagnostics", {})}; batch.item_results = results; batch.created_case_ids = created_cases; batch.created_suite_ids = created_suites
        if build_id:
            for case_id in created_cases: db.add(models.BuildCaso(build_id=build_id, caso_id=UUID(case_id)))
        await db.commit(); await db.refresh(batch); return batch
    except Exception:
        await db.rollback(); raise


def rollback_expires_at(batch: models.CaseImportBatch) -> datetime | None:
    return batch.created_at + ROLLBACK_WINDOW if batch.created_at else None


async def rollback_eligibility(
    db: AsyncSession,
    batch: models.CaseImportBatch,
) -> tuple[bool, str | None, datetime | None]:
    expires_at = rollback_expires_at(batch)
    if batch.status != "COMPLETED" or batch.rolled_back_at:
        return False, "El lote no se puede revertir", expires_at
    if not expires_at or utc_now() >= expires_at:
        return False, "La ventana de una hora para revertir este lote ya venció", expires_at

    ids = [UUID(value) for value in (batch.created_case_ids or [])]
    if ids:
        execution_id = await db.scalar(
            select(models.EjecucionCaso.id)
            .where(models.EjecucionCaso.caso_id.in_(ids))
            .limit(1)
        )
        if execution_id:
            return False, "No se puede revertir: uno o más casos ya tienen ejecuciones", expires_at

    for case_id in ids:
        case = await db.get(models.CasoPrueba, case_id)
        if not case: continue
        if case.ultima_modificacion and batch.created_at and case.ultima_modificacion > batch.created_at:
            return False, "No se puede revertir: uno o más casos tuvieron cambios posteriores", expires_at
    return True, None, expires_at


async def rollback_batch(db: AsyncSession, batch: models.CaseImportBatch, actor_id: UUID) -> models.CaseImportBatch:
    eligible, reason, _ = await rollback_eligibility(db, batch)
    if not eligible:
        raise PortabilityError(reason or "El lote no se puede revertir")

    try:
        for case_id in [UUID(value) for value in (batch.created_case_ids or [])]:
            case = await db.get(models.CasoPrueba, case_id)
            if case:
                await db.delete(case)
        for suite_id in reversed([UUID(value) for value in (batch.created_suite_ids or [])]):
            suite = await db.get(models.Suite, suite_id)
            if suite:
                remaining = (await db.execute(select(models.CasoPrueba.id).where(models.CasoPrueba.suite_id == suite_id).limit(1))).scalar_one_or_none()
                children = (await db.execute(select(models.Suite.id).where(models.Suite.parent_id == suite_id).limit(1))).scalar_one_or_none()
                if not remaining and not children: await db.delete(suite)
        batch.status = "ROLLED_BACK"; batch.rolled_back_at = utc_now(); batch.rolled_back_by = actor_id
        await db.commit(); await db.refresh(batch); return batch
    except IntegrityError as exc:
        await db.rollback()
        raise PortabilityError("No se puede revertir: uno o más casos ya tienen ejecuciones") from exc
