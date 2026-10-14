"""Normalize observed Chatbot metrics across manual and automated runs."""
from typing import Any
from .report_metrics_calculation import chatbot_latency_samples, nearest_rank_p95

def _chatbot_result_metrics(result: Any) -> dict[str, Any]:
    result = result if isinstance(result, dict) else {}
    turns = [item for item in (result.get("turns") or []) if isinstance(item, dict)]
    performance = result.get("performance") if isinstance(result.get("performance"), dict) else {}
    # Global assertions in automated runs summarize turn assertions; use one source.
    assertions = [item for item in (result.get("assertions") or []) if isinstance(item, dict)]
    if not assertions:
        assertions = [item for turn in turns for item in (turn.get("assertions") or []) if isinstance(item, dict)]
    failed_assertions = [item for item in assertions if item.get("passed") is False]
    security = [item for item in (result.get("security_findings") or []) if isinstance(item, dict)]
    memory_checks = [item for item in (result.get("memory_checks") or []) if isinstance(item, dict)]
    tool_results = [item for item in (result.get("tools") or []) if isinstance(item, dict)]
    http_statuses = [turn.get("statusCode", turn.get("status_code")) for turn in turns]
    observed_http = [status for status in http_statuses if isinstance(status, (int, float))]
    http_error_count = sum(status == 0 or status >= 400 for status in observed_http) if observed_http else int(performance["http_error_count"] if performance.get("http_error_count") is not None else len(result.get("http_errors") or []))
    latencies = chatbot_latency_samples(result)
    p95 = nearest_rank_p95(latencies)
    return {
        "turn_count": int(performance.get("turn_count") or len(turns)),
        "total_latency_ms": float(performance.get("total_latency_ms") or sum(latencies)),
        "p95_latency_ms": p95,
        "latency_sample_count": len(latencies),
        "http_error_count": http_error_count,
        "validation_failure_count": len(failed_assertions) if assertions else int(result.get("failed_assertions") or 0),
        "security_finding_count": len(security),
        "memory_failure_count": len([item for item in memory_checks if item.get("passed") is False or item.get("status") == "FAILED"]),
        "tool_failure_count": len([item for item in tool_results if item.get("status") == "FAILED"]),
        "tool_not_observable_count": len([item for item in tool_results if item.get("status") == "NOT_OBSERVABLE"]),
        "tool_blocked_count": len([item for item in tool_results if item.get("status") == "BLOCKED"]),
        "semantic": result.get("judge") if isinstance(result.get("judge"), dict) else {},
        "status": result.get("status"),
    }
