"""Read-only PostgreSQL evidence for a legacy installation admission gate.

This module deliberately does not import the application database or scheduler.
The database URL is read only from a private operator-owned file, and admission
control is true only when both injected control proofs confirm the same binding.
"""
from __future__ import annotations

import asyncio
import math
import os
from pathlib import Path
import stat
from typing import Any, Mapping, Protocol, Sequence

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.pool import NullPool

from .update_legacy_bootstrap import LegacyAdmissionGate, LegacyBootstrap, LegacyBootstrapError

QUERY_SCHEMA = "treseko-legacy-1.0.2"
_QUERY = text("""
SELECT
  count(*) FILTER (WHERE estado::text IN ('PENDING','CLAIMED','RUNNING')) AS automation_active,
  count(*) FILTER (WHERE job_type = 'AI_EXECUTION'
                   AND estado::text IN ('PENDING','CLAIMED','RUNNING')) AS ai_active,
  count(*) FILTER (WHERE estado::text NOT IN
                   ('PENDING','CLAIMED','RUNNING','PASSED','FAILED','BLOCKED','ERROR','TIMEOUT','CANCELLED','BLOCKED_BY_RUNNER')) AS automation_unknown,
  (SELECT count(*) FROM public.ejecuciones_casos
     WHERE estado_resultado::text IN ('SIN_CORRER','EJECUTANDO_AI')) AS executions_active,
  (SELECT count(*) FROM public.ejecuciones_casos
     WHERE estado_resultado::text NOT IN ('PASO','FALLO','BLOQUEADO','SIN_CORRER','EJECUTANDO_AI')) AS executions_unknown
FROM public.automation_jobs
""")


class LegacyPendingObserverError(LegacyBootstrapError):
    """SQL evidence is unavailable or does not match the pinned schema."""


class AdmissionControlProof(Protocol):
    def assert_closed(self, transaction: str, inventory_digest: str,
                      source_ids: Sequence[str]) -> bool: ...

    def scheduler_claims_controlled(self, transaction: str, inventory_digest: str,
                                    source_ids: Sequence[str]) -> bool: ...


def _read_url(path: Path) -> str:
    if not path.is_absolute() or ".." in path.parts:
        raise ValueError("Private PostgreSQL URL file must be absolute")
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    try:
        with os.fdopen(fd, "rb") as stream:
            info = os.fstat(stream.fileno())
            if (not stat.S_ISREG(info.st_mode) or info.st_uid not in {0, os.geteuid()}
                    or info.st_mode & 0o077 or info.st_size > 4096):
                raise ValueError("PostgreSQL URL file must be private")
            value = stream.read(4097).decode("utf-8").strip()
    except UnicodeError as exc:
        raise ValueError("PostgreSQL URL file is invalid") from exc
    if not value.startswith("postgresql+asyncpg://"):
        raise ValueError("PostgreSQL async URL is required")
    return value


class LegacyPendingObserver:
    def __init__(self, config: Mapping[str, Any], *, control: AdmissionControlProof | None,
                 transaction: str, inventory_digest: str, source_ids: Sequence[str]):
        required = {"schema", "state_dir", "database_url_file", "database_name", "timeout_seconds", "query_schema"}
        if not isinstance(config, Mapping) or set(config) != required or config.get("schema") != 1:
            raise ValueError("Pinned legacy observer configuration is required")
        if config["query_schema"] != QUERY_SCHEMA or not isinstance(config["database_name"], str):
            raise ValueError("Unsupported legacy observer query schema")
        timeout = config["timeout_seconds"]
        if isinstance(timeout, bool) or not isinstance(timeout, (int, float)) or not math.isfinite(timeout) or not 0 < timeout <= 180:
            raise ValueError("Bounded PostgreSQL observer timeout is required")
        self.url = _read_url(Path(config["database_url_file"]))
        self.database_name = config["database_name"]
        self.timeout = float(timeout)
        self.control = control
        self.transaction = transaction
        self.inventory_digest = inventory_digest
        self.source_ids = list(source_ids)

    def observe(self, transaction: str) -> dict[str, Any]:
        if transaction != self.transaction:
            raise LegacyPendingObserverError("Observer transaction binding differs")
        counts = self._run_sql()
        controlled = False
        if self.control is not None:
            try:
                controlled = bool(
                    self.control.assert_closed(transaction, self.inventory_digest, self.source_ids)
                    and self.control.scheduler_claims_controlled(transaction, self.inventory_digest, self.source_ids)
                )
            except Exception:
                controlled = False
        pending = counts["automation_active"] + counts["executions_active"]
        return {"source": "sql", "observed": True, "pending": pending,
                "automation_jobs": counts["automation_active"], "ai_jobs": counts["ai_active"],
                "executions": counts["executions_active"],
                "admission_controlled": controlled}

    def _run_sql(self) -> dict[str, int]:
        async def read() -> dict[str, int]:
            engine = create_async_engine(self.url, poolclass=NullPool,
                                         connect_args={"timeout": self.timeout,
                                                       "command_timeout": self.timeout})
            try:
                async with engine.connect() as connection:
                    connection = await connection.execution_options(isolation_level="REPEATABLE READ")
                    async with connection.begin():
                        await connection.execute(
                            text("SELECT set_config('statement_timeout', CAST(:ms AS text), true)"),
                            {"ms": str(int(self.timeout * 1000))},
                        )
                        database = await connection.scalar(text("SELECT current_database()"))
                        if database != self.database_name:
                            raise LegacyPendingObserverError("Observer database differs from inventory")
                        row = (await connection.execute(_QUERY)).mappings().one()
                        values = {key: int(row[key] or 0) for key in row.keys()}
                        if any(value < 0 for value in values.values()) or values["automation_unknown"] or values["executions_unknown"]:
                            raise LegacyPendingObserverError("Observer found an unknown legacy status")
                        return values
            except LegacyPendingObserverError:
                raise
            except Exception as exc:
                raise LegacyPendingObserverError("Legacy PostgreSQL evidence is unknown") from exc
            finally:
                await engine.dispose()
        try:
            return asyncio.run(asyncio.wait_for(read(), timeout=self.timeout + 1))
        except LegacyPendingObserverError:
            raise
        except Exception as exc:
            raise LegacyPendingObserverError("Legacy PostgreSQL evidence is unknown") from exc


def build_legacy_admission_gate(config: Mapping[str, Any], manifest: Mapping[str, Any],
                                transaction: str, inventory_digest: str,
                                source_ids: Sequence[str], consent: str,
                                evidence: Mapping[str, Any], *, fence: Any,
                                control: AdmissionControlProof | None) -> LegacyAdmissionGate:
    observer = LegacyPendingObserver(config, control=control, transaction=transaction,
                                     inventory_digest=inventory_digest, source_ids=source_ids)
    return LegacyAdmissionGate(LegacyBootstrap({"schema": 1, "state_dir": config["state_dir"]},
                                               fence=fence, pending_observer=observer),
                               manifest, transaction, inventory_digest, source_ids, consent, evidence)
