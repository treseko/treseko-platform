from app.repositories.ai_generation_engine_errors import (
    engine_contract_issues,
    engine_error_code,
    engine_generation_error_message,
)


def test_reads_current_nested_engine_error_contract_and_explains_timeout():
    payload = {
        "error": {
            "error_code": "AI_PROVIDER_TIMEOUT",
            "message": "El proveedor IA agotó el tiempo de espera.",
            "details": {"category": "timeout"},
        },
        "detail": "El proveedor IA agotó el tiempo de espera.",
    }

    assert engine_error_code(payload) == "AI_PROVIDER_TIMEOUT"
    message = engine_generation_error_message(payload)
    assert message is not None
    assert "timeout del nodo" in message
    assert "modelo más rápido" in message


def test_preserves_flat_legacy_error_code_and_reads_nested_contract_issues():
    payload = {
        "code": "STORY_GENERATION_CONTRACT_INVALID",
        "error": {"details": {"contract_issues": ["Criterio sin fuente", ""]}},
    }

    assert engine_error_code(payload) == "STORY_GENERATION_CONTRACT_INVALID"
    assert engine_contract_issues(payload) == ["Criterio sin fuente"]
    assert engine_generation_error_message({"error": {"error_code": "UNKNOWN"}}) is None
