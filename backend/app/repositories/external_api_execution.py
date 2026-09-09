from __future__ import annotations

import json
from typing import Any

from .. import models


def add_external_api_snapshots(
    db,
    *,
    execution_id,
    case_config: dict[str, Any] | None,
    api_evidence: dict[str, Any],
) -> None:
    """Persist one immutable snapshot per request reported by an API runner."""
    config = case_config if isinstance(case_config, dict) else {}
    expected_assertions = config.get("assertions") or []
    for position, step in enumerate(api_evidence.get("steps") or []):
        request = step.get("request") if isinstance(step.get("request"), dict) else {}
        status = str(step.get("status") or "").upper()
        step_status = (
            models.EstadoResultado.PASO
            if status in {"PASSED", "PASSED_WITH_WARNINGS"}
            else models.EstadoResultado.BLOQUEADO
            if status == "BLOCKED"
            else models.EstadoResultado.FALLO
        )
        db.add(models.SnapshotPaso(
            ejecucion_caso_id=execution_id,
            numero_paso=int(step.get("index") or position + 1),
            accion_congelada=f"{request.get('method', 'GET')} {request.get('url', '')}",
            datos_congelados=json.dumps(request.get("body"), ensure_ascii=False, default=str) if request.get("body") is not None else None,
            resultado_esperado_congelado=json.dumps(expected_assertions, ensure_ascii=False, default=str),
            estado_paso=step_status,
            comentarios=status,
            error_log=json.dumps(step.get("errors") or [], ensure_ascii=False, default=str) if step.get("errors") else None,
        ))
