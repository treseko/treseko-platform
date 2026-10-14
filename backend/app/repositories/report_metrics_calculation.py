"""Shared definitions for report totals and observed response latency."""
import math

TERMINAL_RESULTS = frozenset({"PASO", "FALLO", "BLOQUEADO"})


def is_terminal_result(value):
    return getattr(value, "value", value) in TERMINAL_RESULTS


def observed_latency(value):
    if value is None or isinstance(value, bool):
        return None
    try:
        number = float(value)
    except (TypeError, ValueError):
        return None
    return number if math.isfinite(number) and number >= 0 else None


def nearest_rank_p95(samples):
    ordered = sorted(samples)
    return ordered[math.ceil(len(ordered) * .95) - 1] if ordered else 0.0


def api_latency_samples(result):
    result = result if isinstance(result, dict) else {}
    samples = []
    for step in result.get("steps") or []:
        if not isinstance(step, dict):
            continue
        response = step.get("response")
        timings = response.get("timings") if isinstance(response, dict) else None
        latency = observed_latency(timings.get("total_ms")) if isinstance(timings, dict) else None
        if latency is not None:
            samples.append(latency)
    return samples


def chatbot_latency_samples(result):
    result = result if isinstance(result, dict) else {}
    samples = []
    for turn in result.get("turns") or []:
        if not isinstance(turn, dict):
            continue
        latency = observed_latency(turn.get("latencyMs", turn.get("latency_ms")))
        if latency is not None:
            samples.append(latency)
    return samples
