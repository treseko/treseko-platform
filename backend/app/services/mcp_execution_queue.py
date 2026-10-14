"""Durable API suite dispatch, shared claims and explicit interruption receipts."""
from __future__ import annotations

import asyncio
import copy
from contextlib import suppress
from datetime import timedelta
import logging
import secrets
from uuid import UUID

from sqlalchemy import select

from .. import models, auth, access_control
from ..database import AsyncSessionLocal
from ..time_utils import utc_now
from .update_api_admission import UpdateAPIAdmission

logger = logging.getLogger(__name__)
_task = None
LEASE_SECONDS = 30


async def enqueue(db, run, user, case_ids):
    # The caller holds the run row lock. Receipt and job share its outer UoW.
    existing = await db.get(models.McpApiRunJob, run.id)
    if existing:
        return existing
    cases = (await db.execute(select(models.CasoPrueba).where(models.CasoPrueba.id.in_(case_ids)))).scalars().all()
    definitions = {str(case.id): copy.deepcopy(case.configuracion_api or {}) for case in cases}
    job = models.McpApiRunJob(run_id=run.id, user_id=user.id, state="PENDING", payload={"case_ids": [str(x) for x in case_ids], "dynamic_seed": run.dynamic_seed, "definitions": definitions})
    db.add(job)
    await db.flush()
    return job


async def cancel(db, run_id):
    job = await db.get(models.McpApiRunJob, run_id, with_for_update=True)
    if job and job.state in {"PENDING", "RUNNING"}:
        job.state = "CANCELLED"
        job.owner_token = None
        job.lease_expires_at = None
    return job


async def _heartbeat(run_id, token):
    while True:
        await asyncio.sleep(5)
        async with AsyncSessionLocal() as db:
            job = await db.get(models.McpApiRunJob, run_id, with_for_update=True)
            if not job or job.state != "RUNNING" or job.owner_token != token:
                return
            job.lease_expires_at = utc_now() + timedelta(seconds=LEASE_SECONDS)
            await db.commit()


async def dispatch_one():
    if UpdateAPIAdmission(None).blocked():
        return False
    async with AsyncSessionLocal() as db:
        activation = await db.get(models.AppSetting, "mcp.enabled")
        if not activation or activation.value.get("enabled") is not True:
            return False
        stale = (await db.execute(select(models.McpApiRunJob).where(models.McpApiRunJob.state == "RUNNING", models.McpApiRunJob.lease_expires_at < utc_now()).with_for_update(skip_locked=True).limit(10))).scalars().all()
        for item in stale:
            item.state = "INTERRUPTED"
            item.owner_token = None
            run = await db.get(models.TestRun, item.run_id)
            if run:
                run.estado_run = models.EstadoRun.CERRADO
                run.fecha_cierre = utc_now()
        job = await db.scalar(select(models.McpApiRunJob).where(models.McpApiRunJob.state == "PENDING").order_by(models.McpApiRunJob.created_at).with_for_update(skip_locked=True).limit(1))
        if job is None:
            await db.commit()
            return False
        run = await db.get(models.TestRun, job.run_id)
        user = await db.get(models.Usuario, job.user_id)
        try:
            if not run or not user or not user.activo or run.estado_run == models.EstadoRun.CERRADO:
                raise ValueError("run unavailable")
            project = await access_control.require_project_access(db, user, run.proyecto_id, "edit")
            await access_control.require_organization_access(db, user, project.organizacion_id, "edit")
            if not auth.has_capability_permission(user, "ejecutar.automatizada", "edit"):
                raise ValueError("execution permission unavailable")
        except Exception:
            job.state = "BLOCKED"
            await db.commit()
            return True
        token = secrets.token_hex(24)
        job.state = "RUNNING"
        job.owner_token = token
        job.lease_expires_at = utc_now() + timedelta(seconds=LEASE_SECONDS)
        run_id, user_id, payload = job.run_id, job.user_id, dict(job.payload)
        await db.commit()
    heartbeat = asyncio.create_task(_heartbeat(run_id, token))
    terminal = "COMPLETED"
    try:
        from ..api.routers.api_tests import _execute_api_suite_background
        await _execute_api_suite_background(run_id, user_id, [UUID(x) for x in payload["case_ids"]], payload.get("dynamic_seed"), frozen_definitions=payload.get("definitions"))
    except asyncio.CancelledError:
        terminal = "INTERRUPTED"
        raise
    except Exception:
        terminal = "INTERRUPTED"
        logger.error("MCP API dispatch interrupted; inspect the persisted run before repeating")
    finally:
        heartbeat.cancel()
        with suppress(asyncio.CancelledError):
            await heartbeat
        async with AsyncSessionLocal() as db:
            job = await db.get(models.McpApiRunJob, run_id, with_for_update=True)
            if job and job.state == "RUNNING" and job.owner_token == token:
                job.state = terminal
                job.owner_token = None
                job.lease_expires_at = None
                if terminal == "INTERRUPTED":
                    run = await db.get(models.TestRun, run_id)
                    if run:
                        run.estado_run = models.EstadoRun.CERRADO
                        run.fecha_cierre = utc_now()
                await db.commit()
    return True


async def _loop():
    while True:
        try:
            await dispatch_one()
        except asyncio.CancelledError:
            raise
        except Exception:
            logger.error("MCP dispatch unavailable; persisted pending jobs are retained")
        await asyncio.sleep(1)


def start():
    global _task
    if _task is None or _task.done():
        _task = asyncio.create_task(_loop(), name="mcp-api-dispatch")


async def stop():
    global _task
    if _task is not None:
        _task.cancel()
        with suppress(asyncio.CancelledError):
            await _task
        _task = None
