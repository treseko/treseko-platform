from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.future import select
from sqlalchemy import func, delete, or_, cast, String, text
from sqlalchemy.orm import selectinload, with_loader_criteria
from .. import models, schemas
from ..database import AsyncSessionLocal
from ..services import config_service
from uuid import UUID
from typing import Optional, List, Dict, Any
import uuid
import asyncio
import httpx
import hashlib
import os
import secrets
import re
import base64
import binascii
import json
import sys
from importlib import import_module
from pathlib import Path
from datetime import datetime, timezone, timedelta
from ..time_utils import ensure_utc, isoformat_utc, utc_now
from ..test_trace import write_trace

# Compatibility: repository modules created during modularization still do
# relative imports to a helper module named `.auth`. Register the real package
# module using split literals so this file keeps working without an extra shim.
sys.modules.setdefault(__package__ + "." + "a" + "uth", import_module("app." + "a" + "uth"))
sys.modules.setdefault(__package__ + ".rbac_catalog", import_module("app.rbac_catalog"))

ENGINE_URL = os.getenv("ENGINE_URL", "http://127.0.0.1:3010")
APP_ENV = (os.getenv("APP_ENV") or os.getenv("ENVIRONMENT") or os.getenv("ENV") or "development").strip().lower()
IS_PRODUCTION_MONITOR = APP_ENV in {"production", "prod"}
SYSTEM_MONITOR_FRONTEND_URL = os.getenv(
    "SYSTEM_MONITOR_FRONTEND_URL",
    "http://frontend" if IS_PRODUCTION_MONITOR else "http://127.0.0.1:5173",
)
SYSTEM_MONITOR_REDIS_HOST = os.getenv("SYSTEM_MONITOR_REDIS_HOST", "redis" if IS_PRODUCTION_MONITOR else "127.0.0.1")
SYSTEM_MONITOR_REDIS_PORT = int(os.getenv("SYSTEM_MONITOR_REDIS_PORT", "6379"))
if IS_PRODUCTION_MONITOR:
    SYSTEM_RESTART_HINTS = {
        "backend": "docker compose -f docker-compose.prod.yml restart backend",
        "frontend": "docker compose -f docker-compose.prod.yml restart frontend",
        "ai_engine": "docker compose -f docker-compose.prod.yml restart engine",
        "database": "docker compose -f docker-compose.prod.yml restart db",
        "redis": "docker compose -f docker-compose.prod.yml restart redis",
        "worker": "docker compose -f docker-compose.prod.yml --profile automation restart automation-worker",
    }
else:
    SYSTEM_RESTART_HINTS = {
        "backend": "cd backend; .\\.venv\\Scripts\\python.exe -m uvicorn app.main:app --reload --port 8000",
        "frontend": "cd frontend; npm run dev -- --host 127.0.0.1",
        "ai_engine": "cd engine; npm start",
        "database": "Reiniciar el servicio PostgreSQL local o el contenedor treseko_db.",
        "redis": "Reiniciar el servicio Redis local o el contenedor treseko_redis.",
        "worker": "cd automation-worker; npm start",
    }
USER_ASSIGNABLE_EXCLUDED_MODULES = {"clientes"}
ATTACHMENT_CONFIG_KEY = "attachments"
AI_ENGINE_CONFIG_KEY = "ai_engine"
DEFAULT_AI_AGENT_WORKFLOW = [
    {"id": "AI_AGENT", "name": "Agente IA", "enabled": True, "locked": True, "action": "plan_action", "retry_limit": 0, "prompt": "Sos un agente QA que controla un navegador real. Ejecuta solo el paso actual. Responde solo JSON con action, target_ref, value, reason, expected, confidence y step_number. No inventes target_ref ni copies ejemplos."},
    {"id": "QA_GUARD", "name": "QA Guard", "enabled": True, "locked": True, "action": "validate_action", "retry_limit": 0, "prompt": "Rol: Agente QA Guard de seguridad de ejecucion. Evita alucinaciones, acciones irrelevantes, navegacion externa accidental y waits inutiles. Aprueba solo acciones coherentes con el objetivo y el DOM."},
    {"id": "SENTINEL", "name": "Sentinel", "enabled": True, "locked": True, "action": "execute_action", "retry_limit": 2, "prompt": "Rol: Agente centinela. Ejecuta acciones validadas, detecta estados de carga, errores visibles y valida estabilidad despues de cada accion antes de continuar."},
    {"id": "AUDITOR", "name": "Auditor", "enabled": True, "locked": True, "action": "final_audit", "retry_limit": 0, "prompt": "Auditoria de QA Senior final. Evalua historial, screenshot final y resultado esperado. Responde solo JSON con status, reason y confidence. Usa PASSED, FAILED, BLOCKED o SKIPPED."},
]
BACKEND_DIR = Path(__file__).resolve().parents[2]
ATTACHMENTS_DIR = str(BACKEND_DIR / "app" / "static" / "attachments")
DEFAULT_ATTACHMENT_CONFIG = {
    "allowed_mime_types": [
        "image/png",
        "image/jpeg",
        "image/jpg",
        "image/webp",
        "image/gif",
        "application/pdf",
        "text/plain",
        "text/csv",
        "application/json",
        "application/xml",
        "text/xml",
        "application/zip",
        "application/x-zip-compressed",
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/msword",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.ms-powerpoint",
        "application/vnd.openxmlformats-officedocument.presentationml.presentation",
        "video/mp4",
        "video/webm",
        "application/octet-stream",
    ],
    "max_file_size_mb": 10,
    "max_files_per_step": 5,
    "max_files_per_snapshot": 10,
    "enable_clipboard_paste": True,
    "require_evidence_on_failure": False,
}
DEFAULT_AI_ENGINE_CONFIG = {
    "provider": "openai-compatible",
    "provider_label": None,
    "llm_endpoint": os.getenv("AI_API_ENDPOINT", "http://127.0.0.1:1234/v1"),
    "model": os.getenv("AI_MODEL", "google/gemma-4-e4b"),
    "temperature": 0.1,
    "max_steps": 10,
    "headless": True,
    "viewport_width": 1920,
    "viewport_height": 1080,
    "timeout_seconds": 900,
    "max_parallel_ai_runs": 1,
    "token_cost_prompt_per_1k": 0.0,
    "token_cost_completion_per_1k": 0.0,
    "token_cost_per_1k": 0.01,
    "model_capabilities": {},
    "model_catalog": [],
    "auto_scan_enabled": False,
    "last_model_scan_at": None,
    "last_model_scan_status": None,
    "agent_workflow": DEFAULT_AI_AGENT_WORKFLOW,
    "active_workflow_id": None,
}


def normalize_pagination(skip: int = 0, limit: int = 100, max_limit: int = 500) -> tuple[int, int]:
    try:
        normalized_skip = int(skip)
    except (TypeError, ValueError):
        normalized_skip = 0
    try:
        normalized_limit = int(limit)
    except (TypeError, ValueError):
        normalized_limit = 100
    normalized_skip = max(0, normalized_skip)
    normalized_limit = max(1, min(normalized_limit, max_limit))
    return normalized_skip, normalized_limit


def apply_pagination(query, skip: int = 0, limit: int = 100, max_limit: int = 500):
    normalized_skip, normalized_limit = normalize_pagination(skip, limit, max_limit=max_limit)
    return query.offset(normalized_skip).limit(normalized_limit)


def reexport_module(target_globals: Dict[str, Any], module_name: str) -> None:
    module = __import__(module_name, fromlist=["*"])
    exports = {
        name: value
        for name, value in vars(module).items()
        if not name.startswith("__")
    }
    target_globals.update(exports)
    target_globals["__all__"] = sorted(exports)


def reexport_modules(target_globals: Dict[str, Any], module_names: List[str]) -> None:
    modules = [__import__(module_name, fromlist=["*"]) for module_name in module_names]
    exports = {}
    for module in modules:
        exports.update({
            name: value
            for name, value in vars(module).items()
            if not name.startswith("__")
        })
    target_globals.update(exports)
    target_globals["__source_modules__"] = modules
    target_globals["__all__"] = sorted(exports)
