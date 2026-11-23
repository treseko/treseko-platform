from __future__ import annotations

import uuid
from types import SimpleNamespace

from app.api.routers import report_development_markdown as development_markdown
from app.api.routers import report_rendering_markdown as renderer


def _snapshot(payload: dict) -> SimpleNamespace:
    return SimpleNamespace(
        title="Informe de desarrollo",
        created_at="2026-09-05T00:00:00+00:00",
        metrics_hash="hash-development",
        payload=payload,
    )


def _base_payload(*, settings: dict | None = None) -> dict:
    return {
        "metadata": {"report_type": "development", "build": "Build actual"},
        "report_settings": settings or {"development": {"sections": {"format_metrics": True}}},
        "metrics": {
            "stats": {"pasados": 2, "fallados": 1, "bloqueados": 1, "pendientes": 1},
            "total_ejecutados": 4,
            "total_casos_asignados": 5,
            "metricas_por_formato": {
                "CLASICA": {"status": "OK", "total": 2, "executed": 2, "passed": 1, "failed": 1, "blocked": 0, "coverage_percent": 100},
                "API": {"status": "OK", "total": 1, "executed": 1, "passed": 1, "failed": 0, "blocked": 0, "coverage_percent": 100},
                "CONVERSACIONAL": {"status": "OK", "total": 1, "executed": 1, "passed": 0, "failed": 0, "blocked": 1, "coverage_percent": 100},
            },
        },
        "development": {},
    }


def _bug(code: str, *, context_type: str = "CLASICA", state: str = "ABIERTO", **extra) -> dict:
    return {
        "id": str(uuid.uuid4()),
        "codigo": code,
        "titulo": f"Título {code}",
        "estado": state,
        "severidad": "MEDIA",
        "case_code": f"TC-{code}",
        "origin_build_name": "Build origen legible",
        "current_build_verification": "Reproducción confirmada" if state == "ABIERTO" else "Corrección verificada",
        "responsable": "Responsable QA",
        "tipo_contexto": context_type,
        "public_test_data": True,
        **extra,
    }


def test_development_markdown_uses_categories_and_keeps_corrected_new_bug(monkeypatch):
    new = _bug(
        "BUG-NEW",
        state="RESUELTO",
        origin_build_name="",
        build_code="Build código",
        ambiente_nombre="Ambiente código",
        dataset_name="Dataset código",
        case_title="Caso desde bug",
        case_version="v3",
        navegador="Firefox",
        dispositivo="Desktop",
        sistema_operativo="macOS",
        url_afectada="https://qa.example.test/orders",
    )
    historical = _bug("BUG-HIST", state="ABIERTO", origin_build_name="Build anterior", current_build_verification="Pendiente de verificar")
    corrected = dict(new)
    unclassified = _bug("BUG-UNCLASS")
    failure_uuid = str(uuid.uuid4())
    failure = {
        "case_code": "TC-SIN-BUG",
        "estado": "FALLO",
        "suite": "Checkout",
        "failed_step": {
            "numero_paso": 2,
            "accion_congelada": "Confirmar pedido",
            "resultado_esperado_congelado": "Pedido confirmado",
            "error_log": f"No responde; snapshot={failure_uuid}",
        },
    }
    monkeypatch.setattr(
        development_markdown,
        "development_report_sections",
        lambda _payload: {
            "new_bugs": [new],
            "historical_bugs": [historical],
            "corrected_bugs": [corrected],
            "unclassified_bugs": [unclassified],
            "failures_without_bug": [failure],
        },
    )

    rendered = renderer._shared_report_markdown(_snapshot(_base_payload()))

    assert "Resultados: 2 pasadas, 1 fallidas, 1 bloqueadas y 1 pendientes." in rendered
    assert "Bugs nuevos y sin clasificar" in rendered
    assert "BUG-NEW" in rendered
    assert "BUG-UNCLASS" in rendered
    assert "Bugs históricos pendientes" in rendered
    assert "BUG-HIST" in rendered
    assert "Pendiente de verificar" in rendered
    assert "Correcciones verificadas" in rendered
    assert rendered.count("### Bugs nuevos: BUG-NEW") == 1
    assert "Regresiones y reincidencias" not in rendered
    assert "Bugs y seguimiento por build" not in rendered
    assert "Fallos sin bug abierto" in rendered
    assert "<details>" in rendered
    assert "<summary>Fallos sin bug abierto</summary>" in rendered
    assert "Cantidad: 1" in rendered
    assert "</details>" in rendered
    assert "TC-SIN-BUG" in rendered
    assert "Confirmar pedido" in rendered
    assert "Pedido confirmado" in rendered
    assert str(failure_uuid) not in rendered
    assert "Ambiente código" in rendered
    assert "Dataset código" in rendered
    assert "Build código" in rendered
    assert "Firefox" in rendered
    assert "Desktop" in rendered
    assert "macOS" in rendered
    assert "https://qa.example.test/orders" in rendered


def test_development_markdown_does_not_detail_disabled_categories(monkeypatch):
    new = _bug("BUG-DISABLED-NEW")
    historical = _bug("BUG-DISABLED-HIST")
    corrected = _bug("BUG-DISABLED-CORRECTED", state="RESUELTO")
    monkeypatch.setattr(
        development_markdown,
        "development_report_sections",
        lambda _payload: {
            "new_bugs": [new],
            "historical_bugs": [historical],
            "corrected_bugs": [corrected],
            "unclassified_bugs": [],
            "failures_without_bug": [],
        },
    )
    settings = {"development": {"sections": {"bugs": False, "bug_tracking": False, "corrected_bugs": False, "bug_details": True}}}

    rendered = renderer._shared_report_markdown(_snapshot(_base_payload(settings=settings)))

    assert "BUG-DISABLED-NEW" not in rendered
    assert "BUG-DISABLED-HIST" not in rendered
    assert "BUG-DISABLED-CORRECTED" not in rendered
    assert "Bugs nuevos y sin clasificar" not in rendered
    assert "### Bugs históricos pendientes" not in rendered
    assert "### Correcciones verificadas" not in rendered


def test_development_markdown_renders_classic_api_and_conversational_full_evidence(monkeypatch):
    public_uuid = str(uuid.uuid4())
    classic = _bug("BUG-CLASSIC", context_type="CLASICO", responsable=public_uuid)
    api = _bug(
        "BUG-API",
        context_type="API",
        api_context={
            "case_snapshot": {"code": "TC-API", "title": "Contrato API"},
            "execution_snapshot": {
                "build_name": "Build API",
                "environment_name": "API QA",
                "dataset_name": "Dataset API",
                "run_name": "Run API",
                "execution_name": "Ejecución API",
                "environment_id": str(uuid.uuid4()),
                "dataset_id": str(uuid.uuid4()),
                "execution_id": str(uuid.uuid4()),
                "run_id": str(uuid.uuid4()),
                "variables_used": {"id": public_uuid},
            },
            "api_config_snapshot": {"url": "https://api.example.test/orders"},
            "api_resultado": {"response": {"order_id": public_uuid, "body": "x" * 15000}},
            "steps": [{"name": f"Solicitud {index}", "status_code": 200} for index in range(35)],
        },
    )
    conversational = _bug(
        "BUG-CHAT",
        context_type="CONVERSACIONAL",
        conversational_context={
            "case_snapshot": {"code": "TC-CHAT", "title": "Chat"},
            "execution_snapshot": {"run_name": "Run Chat", "execution_name": "Ejecución Chat", "environment_name": "Chat QA", "dataset_name": "Dataset Chat"},
            "conversation_turns": [
                {"turn_number": index, "technical_index": index - 1, "message": f"Mensaje {index}", "response_text": f"Respuesta {index}", "status": "PASSED"}
                for index in range(1, 46)
            ],
            "evaluation": {"status": "FALLO", "finding_type": "RESPONSE"},
        },
    )
    monkeypatch.setattr(
        development_markdown,
        "development_report_sections",
        lambda _payload: {"new_bugs": [classic, api, conversational], "historical_bugs": [], "corrected_bugs": [], "unclassified_bugs": [], "failures_without_bug": []},
    )

    rendered = renderer._shared_report_markdown(_snapshot(_base_payload()))

    assert "Tipo: CLÁSICA" in rendered
    assert "Tipo: API" in rendered
    assert "Tipo: CONVERSACIONAL" in rendered
    assert "Solicitud 34" in rendered
    assert "Turno visible 45" in rendered
    assert public_uuid.replace("-", r"\-") in rendered  # UUID in evidence remains; Markdown escapes its punctuation.
    assert "ID del ambiente" not in rendered
    assert "ID del dataset" not in rendered
    assert "Ejecución API" in rendered
    assert public_uuid.count("-") > 0


def test_development_markdown_renders_more_than_forty_bugs_without_truncation(monkeypatch):
    bugs = [_bug(f"BUG-{index:03d}") for index in range(45)]
    monkeypatch.setattr(
        development_markdown,
        "development_report_sections",
        lambda _payload: {"new_bugs": bugs, "historical_bugs": [], "corrected_bugs": [], "unclassified_bugs": [], "failures_without_bug": []},
    )

    rendered = renderer._shared_report_markdown(_snapshot(_base_payload()))

    assert rendered.count("BUG-") >= 45
    assert "BUG-044" in rendered
