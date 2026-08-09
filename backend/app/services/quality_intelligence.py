"""Pure deterministic rules for the V1.0.2 Quality Intelligence foundation."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from hashlib import sha256
import re
from typing import Iterable, Mapping, Sequence


ALGORITHM_VERSION = "v1"
TERMINAL_RESULTS = frozenset({"PASO", "FALLO", "BLOQUEADO"})
COMPARABLE_RESULTS = frozenset({"PASO", "FALLO"})

_UUID_PATTERN = re.compile(r"\b[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\b", re.IGNORECASE)
_HEX_TOKEN_PATTERN = re.compile(r"\b[a-f0-9]{24,}\b", re.IGNORECASE)
_DATE_PATTERN = re.compile(r"\b\d{4}[-/]\d{1,2}[-/]\d{1,2}(?:[T\s]\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})?)?\b", re.IGNORECASE)
_NUMBER_PATTERN = re.compile(r"\b\d+\b")
_SPACE_PATTERN = re.compile(r"\s+")
_URL_PATTERN = re.compile(r"\bhttps?://[^\s\"'<>]+", re.IGNORECASE)
_EMAIL_PATTERN = re.compile(r"\b[^\s@]+@[^\s@]+\.[^\s@]+\b")
_UNIX_TEMP_PATH_PATTERN = re.compile(r"(?:/tmp|/private/tmp|/var/folders)/[^\s\"'<>]+", re.IGNORECASE)
_WINDOWS_TEMP_PATH_PATTERN = re.compile(r"\b[a-z]:\\(?:users\\[^\\\s]+\\appdata\\local\\temp|temp)\\[^\s\"'<>]+", re.IGNORECASE)
_SECRET_VALUE_PATTERN = re.compile(
    r"\b(token|secret|password|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+",
    re.IGNORECASE,
)

FAILURE_CATEGORIES = frozenset(
    {
        "ASSERTION",
        "CODE",
        "DATA",
        "DEPENDENCY",
        "ENVIRONMENT",
        "NETWORK",
        "SELECTOR",
        "TIMEOUT",
        "UNKNOWN",
    }
)


@dataclass(frozen=True)
class QualityHealthResult:
    classification: str
    flaky_score: float
    total_observations: int
    passed_count: int
    failed_count: int
    blocked_count: int
    comparable_count: int
    transition_count: int
    algorithm_version: str = ALGORITHM_VERSION

    def evidence_summary(self) -> dict[str, int | float | str]:
        return {
            "algorithm_version": self.algorithm_version,
            "total_observations": self.total_observations,
            "comparable_observations": self.comparable_count,
            "passed": self.passed_count,
            "failed": self.failed_count,
            "blocked": self.blocked_count,
            "transitions": self.transition_count,
            "flaky_score": self.flaky_score,
            "classification": self.classification,
        }


def canonical_result(value: object) -> str:
    raw = getattr(value, "value", value)
    return str(raw or "").strip().upper()


def normalize_failure_text(value: object) -> str:
    """Return a privacy-preserving, stable representation for a fingerprint."""
    text = str(value or "").strip().lower()
    text = _SECRET_VALUE_PATTERN.sub(r"\1=<secret>", text)
    text = _URL_PATTERN.sub("<url>", text)
    text = _EMAIL_PATTERN.sub("<email>", text)
    text = _UNIX_TEMP_PATH_PATTERN.sub("<temp-path>", text)
    text = _WINDOWS_TEMP_PATH_PATTERN.sub("<temp-path>", text)
    text = _UUID_PATTERN.sub("<uuid>", text)
    text = _HEX_TOKEN_PATTERN.sub("<token>", text)
    text = _DATE_PATTERN.sub("<date>", text)
    text = _NUMBER_PATTERN.sub("<number>", text)
    text = _SPACE_PATTERN.sub(" ", text)
    return text[:1000]


def canonical_failure_category(value: object) -> str:
    category = str(value or "UNKNOWN").strip().upper()
    return category if category in FAILURE_CATEGORIES else "UNKNOWN"


def failure_fingerprint(*, category: object = "UNKNOWN", error_text: object = "", signature_version: str = ALGORITHM_VERSION) -> str | None:
    normalized = normalize_failure_text(error_text)
    normalized_category = canonical_failure_category(category)
    if not normalized and normalized_category == "UNKNOWN":
        return None
    material = f"{signature_version}|{normalized_category}|{normalized}".encode("utf-8")
    return sha256(material).hexdigest()


def calculate_quality_health(observations: Iterable[Mapping[str, object] | object], *, window_size: int = 20) -> QualityHealthResult:
    """Calculate a deterministic, explainable health signal for one case series.

    The caller supplies observations already scoped to one project/case/context.
    Objects may be mappings or expose ``resultado``/``observed_at`` attributes.
    """
    if window_size < 3:
        raise ValueError("window_size debe ser al menos 3")

    def get(item: Mapping[str, object] | object, key: str, default: object = None) -> object:
        return item.get(key, default) if isinstance(item, Mapping) else getattr(item, key, default)

    terminal = [item for item in observations if canonical_result(get(item, "resultado", get(item, "estado_resultado"))) in TERMINAL_RESULTS]
    terminal.sort(key=lambda item: (get(item, "observed_at", get(item, "fecha_ejecucion", datetime.min)) or datetime.min, str(get(item, "id", ""))))
    selected = terminal[-window_size:]
    results = [canonical_result(get(item, "resultado", get(item, "estado_resultado"))) for item in selected]
    comparable = [result for result in results if result in COMPARABLE_RESULTS]
    passed_count = results.count("PASO")
    failed_count = results.count("FALLO")
    blocked_count = results.count("BLOQUEADO")
    transition_count = sum(1 for previous, current in zip(comparable, comparable[1:]) if previous != current)
    has_mixed_outcomes = "PASO" in comparable and "FALLO" in comparable
    flaky_score = round((transition_count / (len(comparable) - 1)) * 100, 2) if len(comparable) >= 2 and has_mixed_outcomes else 0.0

    if len(comparable) < 3:
        classification = "BLOCKED" if blocked_count and not comparable else "INSUFFICIENT_DATA"
    elif has_mixed_outcomes and flaky_score >= 50:
        classification = "FLAKY"
    elif has_mixed_outcomes:
        classification = "MIXED"
    elif blocked_count and not comparable:
        classification = "BLOCKED"
    else:
        classification = "STABLE"

    return QualityHealthResult(
        classification=classification,
        flaky_score=flaky_score,
        total_observations=len(selected),
        passed_count=passed_count,
        failed_count=failed_count,
        blocked_count=blocked_count,
        comparable_count=len(comparable),
        transition_count=transition_count,
    )


def quality_scope_key(*, component_id: object = None, environment_id: object = None) -> str:
    component = str(component_id) if component_id else "global"
    environment = str(environment_id) if environment_id else "global"
    return f"component:{component}|environment:{environment}"
