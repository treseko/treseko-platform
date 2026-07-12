import json
import logging
import os
import uuid
import html
from pathlib import Path as _FilesystemPath
from fastapi import FastAPI, Depends, HTTPException, status, BackgroundTasks, WebSocket, WebSocketDisconnect, Request, UploadFile, File, Header, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import HTMLResponse, Response, RedirectResponse
from fastapi.security import OAuth2PasswordRequestForm
from fastapi.staticfiles import StaticFiles
from jose import JWTError, jwt
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, or_
from sqlalchemy.exc import IntegrityError, SQLAlchemyError
from typing import Any, List, Optional
from uuid import UUID
from datetime import timedelta, datetime, timezone
from .database import engine, Base, get_db, AsyncSessionLocal, initialize_database
from . import models, schemas, crud, auth, utils, access_control
from .test_trace import TestTraceMiddleware, write_trace
from .time_utils import isoformat_utc, utc_now
from .services.notifications import config_service as notification_config_service
from .services.notifications import event_service as notification_event_service
from .services.notifications import processor as notification_processor
from .services.notifications.email_sender import send_smtp_email
from .services.notifications.template_renderer import render_html_template, render_text_template
from .services.auth_ad import oidc_service
from .services.realtime_events import realtime_event_bus
from .static_asset_auth import extract_asset_query_token, normalize_asset_token
from .version import PRODUCT_VERSION

logger = logging.getLogger(__name__)
STATIC_ROOT = _FilesystemPath(__file__).resolve().parent / "static"

REALTIME_BUG_EVENT_TYPES = {
    "bug.status_changed": "bug.status.changed",
    "bug.comment_added": "bug.comment.created",
    "bug.attachment_added": "bug.attachment.created",
    "bug.attachment_deleted": "bug.attachment.deleted",
    "bug.external_link_added": "bug.external_link.created",
    "bug.external_link_deleted": "bug.external_link.deleted",
}

async def _issue_auth_tokens(db: AsyncSession, user: models.Usuario):
    session_config = await crud.get_auth_session_config(db)
    session_timeout_minutes = int(session_config.get("session_timeout_minutes") or 480)
    access_minutes = max(1, session_timeout_minutes)
    access_token = auth.create_access_token(
        data={"sub": user.email},
        expires_delta=timedelta(minutes=access_minutes),
    )
    return {
        "access_token": access_token,
        "token_type": "bearer",
        "expires_in": access_minutes * 60,
        "session_timeout_minutes": session_timeout_minutes,
    }

async def _bug_notification_payload(db: AsyncSession, bug: models.BugIssue, actor: models.Usuario | None = None) -> dict[str, Any]:
    proyecto = None
    build = None
    caso = None
    if bug.proyecto_id:
        proyecto = (await db.execute(select(models.Proyecto).filter(models.Proyecto.id == bug.proyecto_id))).scalar_one_or_none()
    if bug.build_id:
        build = (await db.execute(select(models.Build).filter(models.Build.id == bug.build_id))).scalar_one_or_none()
    if bug.caso_id:
        caso = (await db.execute(select(models.CasoPrueba).filter(models.CasoPrueba.id == bug.caso_id))).scalar_one_or_none()
    return {
        "bug": {
            "id": str(bug.id),
            "codigo": bug.codigo,
            "titulo": bug.titulo,
            "estado": bug.estado,
            "severidad": bug.severidad,
            "prioridad": bug.prioridad,
            "asignado_a": str(bug.asignado_a) if bug.asignado_a else None,
            "creado_por": str(bug.creado_por) if bug.creado_por else None,
            "link_url": f"/bugs/{bug.id}",
        },
        "proyecto": {"id": str(proyecto.id), "nombre": proyecto.nombre} if proyecto else {},
        "build": {"id": str(build.id), "nombre": build.nombre} if build else {},
        "caso": {"id": str(caso.id), "codigo": caso.codigo, "titulo": caso.titulo} if caso else {},
        "actor": {"id": str(actor.id), "email": actor.email, "nombre": actor.nombre_completo or actor.email} if actor else {},
    }

async def _emit_bug_event(db: AsyncSession, event_type: str, bug: models.BugIssue, actor: models.Usuario, extra: dict[str, Any] | None = None):
    payload = await _bug_notification_payload(db, bug, actor)
    if extra:
        payload.update(extra)
    realtime_event_type = REALTIME_BUG_EVENT_TYPES.get(event_type, event_type)
    await notification_event_service.emit_event(
        db=db,
        event_type=event_type,
        actor_user_id=actor.id,
        proyecto_id=bug.proyecto_id,
        entity_type="bug",
        entity_id=bug.id,
        severity=str(bug.severidad or "info").lower(),
        payload=payload,
        dedupe_key=f"{event_type}:{bug.id}:{uuid.uuid4().hex[:8]}",
    )
    await realtime_event_bus.publish(
        bug.proyecto_id,
        realtime_event_type,
        actor_id=actor.id,
        component_id=bug.componente_id,
        build_id=bug.build_id,
        case_id=bug.caso_id,
        execution_id=bug.ejecucion_id,
        bug_id=bug.id,
        payload={
            "bug": payload.get("bug", {}),
            "caso": payload.get("caso", {}),
            "build": payload.get("build", {}),
            "source_event_type": event_type,
            "old_value": payload.get("old_value"),
            "new_value": payload.get("new_value"),
        },
    )
    await realtime_event_bus.publish(
        bug.proyecto_id,
        "report.metrics.invalidated",
        actor_id=actor.id,
        component_id=bug.componente_id,
        build_id=bug.build_id,
        case_id=bug.caso_id,
        bug_id=bug.id,
        payload={"source": realtime_event_type},
    )

async def _emit_ai_engine_unavailable_event(
    db: AsyncSession,
    *,
    actor: models.Usuario | None = None,
    execution: models.EjecucionCaso | None = None,
    case: models.CasoPrueba | None = None,
    run: models.TestRun | None = None,
    detail: str = "Motor IA no disponible",
):
    await notification_event_service.emit_event(
        db=db,
        event_type="ai.engine.unavailable",
        actor_user_id=actor.id if actor else None,
        proyecto_id=run.proyecto_id if run else None,
        entity_type="ai_engine",
        entity_id=execution.id if execution else None,
        severity="warning",
        payload={
            "ai_engine": {"status": "unavailable", "detail": detail},
            "execution": {"id": str(execution.id), "estado": execution.estado_resultado.value if execution else None} if execution else {},
            "caso": {"id": str(case.id), "codigo": case.codigo, "titulo": case.titulo} if case else {},
            "actor": {"id": str(actor.id), "email": actor.email, "nombre": actor.nombre_completo or actor.email} if actor else {},
            "message": f"Motor IA no disponible: {detail}",
        },
        dedupe_key=f"ai.engine.unavailable:{str(execution.id) if execution else 'dry-run'}:{utc_now().strftime('%Y%m%d%H%M')}",
    )

def _shared_report_quality_gate_failed(snapshot: models.SharedReportSnapshot | None) -> tuple[bool, dict[str, Any]]:
    payload = snapshot.payload if snapshot else {}
    metrics = payload.get("metrics") if isinstance(payload.get("metrics"), dict) else {}
    stats = metrics.get("stats") if isinstance(metrics.get("stats"), dict) else {}
    qa_summary = payload.get("qa_summary") if isinstance(payload.get("qa_summary"), dict) else {}
    decision = str(qa_summary.get("decision") or "").strip().lower()
    risk = str(qa_summary.get("risk") or "").strip().lower()
    failed = int(stats.get("fallados") or 0)
    blocked = int(stats.get("bloqueados") or 0)
    failed_gate = (
        decision in {"no apto", "bloqueado"}
        or risk in {"alto", "critico", "crítico"}
        or failed > 0
        or blocked > 0
    )
    return failed_gate, {"metrics": metrics, "stats": stats, "qa_summary": qa_summary}

logger.debug("Cargando módulo main.py")

def _script_agent_allowed(user: models.Usuario) -> bool:
    return user.rol == models.Rol.ADMIN and os.getenv("AI_SCRIPT_AGENT_ENABLED", "false").lower() in {"1", "true", "yes", "on"}

app = FastAPI(
    title="Treseko Platform API",
    description="Intelligent Testing Core Backend (Architecture v2.6 Multi-Level)",
    version=PRODUCT_VERSION,
)

app.add_middleware(TestTraceMiddleware)

def _cors_allowed_origins() -> list[str]:
    raw_value = os.getenv("CORS_ALLOWED_ORIGINS", "").strip()
    if not raw_value:
        return []
    return [origin.strip() for origin in raw_value.split(",") if origin.strip()]


_cors_origins = _cors_allowed_origins()
if _cors_origins:
    app.add_middleware(
        CORSMiddleware,
        allow_origins=_cors_origins,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

class SecureEvidenceStaticFiles(StaticFiles):
    INLINE_SAFE_MEDIA_TYPES = {
        "application/json",
        "application/pdf",
        "application/xml",
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/gif",
        "text/csv",
        "text/plain",
        "text/xml",
        "video/mp4",
        "video/webm",
    }

    async def get_response(self, path: str, scope):
        normalized_path = path.lstrip("/")
        is_sensitive_asset = normalized_path.split("/", 1)[0] in {"attachments", "evidencias"}
        if is_sensitive_asset:
            await self._authorize_sensitive_asset(normalized_path, scope)
            full_path, stat_result = self.lookup_path(path)
            if stat_result is None:
                raise HTTPException(
                    status_code=410,
                    detail="El registro de evidencia existe, pero el archivo fisico no esta disponible en storage.",
                )
        response = await super().get_response(path, scope)
        if is_sensitive_asset:
            response.headers["X-Content-Type-Options"] = "nosniff"
            response.headers["Cache-Control"] = "private, no-store"
            content_type = response.headers.get("content-type", "").split(";", 1)[0].strip().lower()
            if content_type not in self.INLINE_SAFE_MEDIA_TYPES:
                response.headers["Content-Disposition"] = (
                    f'attachment; filename="{self._safe_asset_download_filename(normalized_path)}"'
                )
        return response

    @staticmethod
    def _safe_asset_download_filename(path: str) -> str:
        raw = os.path.basename(path or "evidencia").strip() or "evidencia"
        safe = "".join(char if char.isalnum() or char in "._-" else "_" for char in raw)
        return (safe.strip("._") or "evidencia")[:120]

    async def _authorize_sensitive_asset(self, path: str, scope) -> None:
        token = self._extract_bearer_token(scope) or self._extract_query_token(scope)
        if not token:
            raise HTTPException(status_code=401, detail="No autenticado")
        async with AsyncSessionLocal() as db:
            user = await self._user_from_token(db, token)
            if not user or not user.activo:
                raise HTTPException(status_code=401, detail="No autenticado")
            if path.startswith("attachments/"):
                await self._authorize_attachment(db, user, f"/static/{path}")
                return
            if path.startswith("evidencias/"):
                await self._authorize_legacy_evidence(db, user, f"/static/{path}")
                return
        raise HTTPException(status_code=403, detail="No tienes permisos para ver esta evidencia")

    @staticmethod
    def _extract_bearer_token(scope) -> str | None:
        for raw_name, raw_value in scope.get("headers") or []:
            if raw_name.lower() != b"authorization":
                continue
            value = raw_value.decode("latin1")
            if value.lower().startswith("bearer "):
                return normalize_asset_token(value.split(" ", 1)[1])
        return None

    @staticmethod
    def _extract_query_token(scope) -> str | None:
        return extract_asset_query_token(scope.get("query_string"))

    @staticmethod
    async def _user_from_token(db: AsyncSession, token: str):
        try:
            payload = jwt.decode(token, auth.SECRET_KEY, algorithms=[auth.ALGORITHM])
            if payload.get("type") != "access":
                return None
            email = payload.get("sub")
            if not email:
                return None
        except JWTError:
            return None
        return await crud.get_user_by_email(db, email=email)

    @staticmethod
    async def _authorize_attachment(db: AsyncSession, user: models.Usuario, public_url: str) -> None:
        attachment = (await db.execute(
            select(models.Attachment).filter(models.Attachment.public_url == public_url)
        )).scalar_one_or_none()
        if not attachment:
            raise HTTPException(status_code=404, detail="Evidencia no encontrada")

        project_ids: set = set()
        step_rows = (await db.execute(
            select(models.CasoPrueba.proyecto_id)
            .join(models.PasoPrueba, models.PasoPrueba.caso_id == models.CasoPrueba.id)
            .join(models.PasoAttachment, models.PasoAttachment.paso_id == models.PasoPrueba.id)
            .filter(models.PasoAttachment.attachment_id == attachment.id)
        )).scalars().all()
        project_ids.update(step_rows)

        snapshot_rows = (await db.execute(
            select(models.TestRun.proyecto_id)
            .join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
            .join(models.SnapshotPaso, models.SnapshotPaso.ejecucion_caso_id == models.EjecucionCaso.id)
            .join(models.SnapshotAttachment, models.SnapshotAttachment.snapshot_id == models.SnapshotPaso.id)
            .filter(models.SnapshotAttachment.attachment_id == attachment.id)
        )).scalars().all()
        project_ids.update(snapshot_rows)

        bug_rows = (await db.execute(
            select(models.BugIssue.proyecto_id)
            .join(models.BugAttachment, models.BugAttachment.bug_id == models.BugIssue.id)
            .filter(models.BugAttachment.attachment_id == attachment.id)
        )).scalars().all()
        project_ids.update(bug_rows)

        if not project_ids and attachment.created_by == user.id:
            return
        for project_id in project_ids:
            try:
                await access_control.require_project_access(db, user, project_id, "read")
                return
            except HTTPException:
                continue
        raise HTTPException(status_code=403, detail="No tienes permisos para ver esta evidencia")

    @staticmethod
    async def _authorize_legacy_evidence(db: AsyncSession, user: models.Usuario, public_url: str) -> None:
        rows = (await db.execute(
            select(models.TestRun.proyecto_id)
            .join(models.EjecucionCaso, models.EjecucionCaso.test_run_id == models.TestRun.id)
            .join(models.SnapshotPaso, models.SnapshotPaso.ejecucion_caso_id == models.EjecucionCaso.id)
            .filter(models.SnapshotPaso.evidencia_url == public_url)
        )).scalars().all()
        for project_id in rows:
            try:
                await access_control.require_project_access(db, user, project_id, "read")
                return
            except HTTPException:
                continue
        raise HTTPException(status_code=403, detail="No tienes permisos para ver esta evidencia")

app.mount("/static", SecureEvidenceStaticFiles(directory=str(STATIC_ROOT)), name="static")
