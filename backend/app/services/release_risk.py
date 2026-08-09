"""Versioned, deterministic release-risk calculation for Quality Intelligence.

This module deliberately accepts a normalized snapshot instead of database
models.  The same snapshot must always produce the same score and explanation.
It is advisory: release approval remains a human decision.
"""

from __future__ import annotations

import hashlib
import json
from typing import Any


RELEASE_RISK_ALGORITHM_VERSION = "v1"


def _number(snapshot: dict[str, Any], key: str) -> float:
    try:
        return max(0.0, float(snapshot.get(key) or 0))
    except (TypeError, ValueError):
        return 0.0


def _factor(
    factor_id: str, weight: int, points: int, value: Any, evidence_refs: list[str],
) -> dict[str, Any]:
    return {
        "id": factor_id,
        "weight": weight,
        "points": points,
        "value": value,
        "evidence_refs": sorted(set(evidence_refs)),
    }


def release_risk_input_hash(snapshot: dict[str, Any]) -> str:
    """Hash only the normalized input retained with an evaluation."""
    canonical = json.dumps(snapshot, ensure_ascii=True, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode("utf-8")).hexdigest()


def calculate_release_risk(snapshot: dict[str, Any]) -> dict[str, Any]:
    """Calculate a bounded and fully explained advisory release-risk score.

    Expected values are counts and percentages collected by the caller. Missing
    values score as insufficient evidence rather than being interpreted as safe.
    """
    coverage = min(_number(snapshot, "coverage_percent"), 100.0)
    failed = int(_number(snapshot, "failed_cases"))
    blocked = int(_number(snapshot, "blocked_cases"))
    pending = int(_number(snapshot, "pending_cases"))
    high_open_bugs = int(_number(snapshot, "high_open_bugs"))
    open_bugs = int(_number(snapshot, "open_bugs"))
    flaky_rate = min(_number(snapshot, "flaky_case_rate"), 100.0)
    evidence_complete = _number(snapshot, "evidence_complete_percent")
    total_cases = int(_number(snapshot, "total_cases"))
    refs = snapshot.get("evidence_refs") if isinstance(snapshot.get("evidence_refs"), dict) else {}
    factors: list[dict[str, Any]] = []

    coverage_points = 25 if total_cases == 0 or coverage < 70 else 12 if coverage < 90 else 0
    factors.append(_factor("coverage", 25, coverage_points, coverage, list(refs.get("coverage") or [])))
    result_points = 25 if blocked else 18 if failed else 8 if pending else 0
    factors.append(_factor("execution_results", 25, result_points, {"failed": failed, "blocked": blocked, "pending": pending}, list(refs.get("executions") or [])))
    bug_points = 20 if high_open_bugs else 10 if open_bugs else 0
    factors.append(_factor("open_bugs", 20, bug_points, {"high_open": high_open_bugs, "open": open_bugs}, list(refs.get("bugs") or [])))
    flaky_points = 15 if flaky_rate >= 30 else 8 if flaky_rate >= 10 else 0
    factors.append(_factor("flakiness", 15, flaky_points, flaky_rate, list(refs.get("flakiness") or [])))
    evidence_points = 15 if total_cases == 0 or evidence_complete < 60 else 7 if evidence_complete < 90 else 0
    factors.append(_factor("evidence_completeness", 15, evidence_points, evidence_complete, list(refs.get("evidence") or [])))

    score = min(100, sum(int(item["points"]) for item in factors))
    if blocked or high_open_bugs or score >= 70:
        level, recommendation = "HIGH", "NO_APTA"
    elif total_cases == 0 or coverage < 70 or evidence_complete < 60:
        level, recommendation = "MEDIUM", "REVISION_HUMANA"
    elif score >= 30:
        level, recommendation = "MEDIUM", "APTA_CON_RIESGO"
    else:
        level, recommendation = "LOW", "APTA"
    return {
        "algorithm_version": RELEASE_RISK_ALGORITHM_VERSION,
        "score": score,
        "level": level,
        "recommendation": recommendation,
        "factors": factors,
        "input_hash": release_risk_input_hash(snapshot),
    }
