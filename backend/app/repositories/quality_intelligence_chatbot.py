from typing import Any

from .. import models


def failure_candidates(result: dict[str, Any]) -> list[Any]:
    return [
        result.get("reason"), result.get("summary"),
        *[item.get("error") for item in result.get("turns", []) if isinstance(item, dict)],
        *[item.get("reason") for item in result.get("security_findings", []) if isinstance(item, dict)],
        *[item.get("warning") or item.get("reason") or item.get("status") for item in result.get("tools", []) if isinstance(item, dict) and item.get("status") in {"FAILED", "BLOCKED"}],
    ]


def evidence_fields(execution: models.EjecucionCaso, case: models.CasoPrueba) -> dict[str, Any]:
    formato = str(getattr(case.formato_prueba, "value", case.formato_prueba) or "CLASICA").upper()
    if formato != "CONVERSACIONAL":
        return {}
    result = execution.chatbot_resultado if isinstance(execution.chatbot_resultado, dict) else {}
    performance = result.get("performance") if isinstance(result.get("performance"), dict) else {}
    memory_checks = result.get("memory_checks") if isinstance(result.get("memory_checks"), list) else []
    tools = result.get("tools") if isinstance(result.get("tools"), list) else []
    return {"source": "chatbot-evaluation-v1", "formato_prueba": formato, "chatbot": {
        "turn_count": int(performance.get("turn_count") or len(result.get("turns") or [])),
        "total_latency_ms": performance.get("total_latency_ms", 0), "p95_latency_ms": performance.get("p95_latency_ms", 0),
        "http_error_count": len(result.get("http_errors") or []),
        "validation_failure_count": len([a for a in result.get("assertions", []) if isinstance(a, dict) and a.get("passed") is False]),
        "security_finding_count": len(result.get("security_findings") or []),
        "memory_failure_count": len([item for item in memory_checks if isinstance(item, dict) and (item.get("passed") is False or item.get("status") == "FAILED")]),
        "tool_failure_count": len([item for item in tools if isinstance(item, dict) and item.get("status") == "FAILED"]),
        "tool_not_observable_count": len([item for item in tools if isinstance(item, dict) and item.get("status") == "NOT_OBSERVABLE"]),
        "tool_blocked_count": len([item for item in tools if isinstance(item, dict) and item.get("status") == "BLOCKED"]),
        "semantic_score": (result.get("judge") or {}).get("score") if isinstance(result.get("judge"), dict) else None,
    }}
