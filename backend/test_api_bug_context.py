from datetime import datetime, timezone
from types import SimpleNamespace
from uuid import uuid4

from app.services.api_bug_context import build_api_context, is_api_case


def test_api_bug_context_keeps_structured_steps_and_redacts_secrets():
    case_id = uuid4()
    execution_id = uuid4()
    run_id = uuid4()
    project_id = uuid4()
    case = SimpleNamespace(
        id=case_id,
        formato_prueba=SimpleNamespace(value="API"),
        codigo="TC-API-001",
        titulo="Consulta de recurso",
        suite_id=None,
        componente_id=None,
        descripcion="Validar la consulta API.",
        precondiciones="El ambiente QA está disponible.",
        postcondiciones="La respuesta queda registrada.",
    )
    execution = SimpleNamespace(
        id=execution_id,
        api_config_snapshot={
            "request": {
                "url": "{{base_url}}/users",
                "headers": [{"key": "Authorization", "value": "Bearer secret-value"}],
            }
        },
        api_resultado={
            "schema_version": "treseko.api-result/v1",
            "status": "FAILED",
            "duration_ms": 42,
            "steps": [{
                "index": 1,
                "name": "Consulta usuarios",
                "status": "FAILED",
                "request": {"method": "GET", "url": "https://qa.example/users"},
                "response": {"status_code": 500, "body": {"error": "down"}},
                "latency_ms": 42,
                "assertions": [{"name": "HTTP 200", "status": "FAILED", "expected": 200, "actual": 500}],
            }],
        },
        execution_mode="AUTOMATIZADA",
        estado_resultado="FALLO",
        duracion_segundos=1,
        fecha_ejecucion=datetime.now(timezone.utc),
        observaciones="HTTP 500",
        version_ejecutada="1",
    )
    run = SimpleNamespace(
        id=run_id,
        nombre="API QA",
        proyecto_id=project_id,
        build_id=None,
        entorno_id=None,
        dataset_id=None,
        entorno="QA",
        variables_resueltas={"user": "qa"},
        datasets_resueltos={str(case_id): [{"name": "qa"}]},
    )
    environment = SimpleNamespace(nombre="QA", url="https://qa.example")

    context = build_api_context(
        bug_id=uuid4(), execution=execution, run=run, case=case, environment=environment
    )

    assert is_api_case(case)
    assert context["format"] == "API"
    assert context["execution_snapshot"]["status"] == "FALLO"
    assert context["steps"][0]["visible_index"] == 1
    assert context["steps"][0]["status_code"] == 500
    assert context["technical_evidence"]["failed_step_indexes"] == [1]
    assert context["api_config_snapshot"]["request"]["headers"][0]["value"] == "[REDACTED]"
