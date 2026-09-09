from typing import Any


TEST_FORMATS = ("CLASICA", "CONVERSACIONAL", "API", "PERFORMANCE")
IMPLEMENTED_METRIC_FORMATS = {"CLASICA", "CONVERSACIONAL", "API"}
EXECUTION_MODES = ("MANUAL", "AUTOMATIZADA", "IA", "EXTERNA", "SIN_EJECUTAR")


def _safe_percent(numerator: int, denominator: int) -> float:
    return round((numerator / denominator) * 100, 2) if denominator else 0.0


def _empty_format_metrics() -> dict[str, Any]:
    """Return a stable, extensible metric contract for every test format."""
    result = {}
    for formato in TEST_FORMATS:
        specific = {}
        if formato == "CONVERSACIONAL":
            specific = {
                "turns": 0,
                "total_latency_ms": 0,
                "p95_latency_ms": 0,
                "http_errors": 0,
                "validation_failures": 0,
                "security_findings": 0,
                "memory_failures": 0,
                "tool_failures": 0,
                "tools_not_observable": 0,
                "tools_blocked": 0,
            }
        elif formato == "API":
            specific = {
                "requests": 0,
                "total_latency_ms": 0,
                "p95_latency_ms": 0,
                "http_errors": 0,
                "validation_failures": 0,
                "status_2xx": 0,
                "status_4xx": 0,
                "status_5xx": 0,
            }
        result[formato] = {
            "format": formato,
            "status": "SIN_DATOS",
            "metrics_available": formato in IMPLEMENTED_METRIC_FORMATS,
            "total": 0,
            "executed": 0,
            "passed": 0,
            "failed": 0,
            "blocked": 0,
            "pending": 0,
            "coverage_percent": 0.0,
            "success_executed_percent": 0.0,
            "success_total_percent": 0.0,
            "duration_seconds": 0,
            "specific": specific,
        }
    return result


def _finalize_format_metrics(metrics: dict[str, Any]) -> dict[str, Any]:
    for formato, data in metrics.items():
        total = int(data.get("total") or 0)
        executed = int(data.get("executed") or 0)
        passed = int(data.get("passed") or 0)
        data["pending"] = max(total - executed, 0)
        data["coverage_percent"] = _safe_percent(executed, total)
        data["success_executed_percent"] = _safe_percent(passed, executed)
        data["success_total_percent"] = _safe_percent(passed, total)
        data["status"] = "SIN_DATOS" if total == 0 else (
            "DISPONIBLE" if formato in IMPLEMENTED_METRIC_FORMATS else "EN_PREPARACION"
        )
    return metrics


def _empty_format_mode_metrics() -> dict[str, dict[str, dict[str, Any]]]:
    """Return the build-scoped format x execution-mode matrix contract."""
    return {
        formato: {
            modo: {
                "format": formato,
                "execution_mode": modo,
                "total": 0,
                "executed": 0,
                "passed": 0,
                "failed": 0,
                "blocked": 0,
                "pending": 0,
            }
            for modo in EXECUTION_MODES
        }
        for formato in TEST_FORMATS
    }


def _finalize_format_mode_metrics(metrics: dict[str, dict[str, dict[str, Any]]]) -> dict[str, dict[str, dict[str, Any]]]:
    """Normalize pending counts without mixing formats or builds."""
    for modes in metrics.values():
        for bucket in modes.values():
            bucket["pending"] = max(int(bucket.get("total") or 0) - int(bucket.get("executed") or 0), 0)
    return metrics
