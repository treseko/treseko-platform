"""Policy for persisting reproducible evidence from synthetic test data.

Production-like environments keep the existing redaction guarantees.  A
dedicated synthetic test service may opt in to exact values so a case can be
reproduced later.  The marker is explicit and can be frozen in the execution,
case or format-specific configuration; absence of the marker always means
that the historical redaction policy remains active.
"""
from __future__ import annotations

from typing import Any


POLICY_KEY = "evidence_policy"
PUBLIC_TEST_DATA_KEY = "public_test_data"
PUBLIC_POLICY_MARKER = "public_test_data"


def _policy_from(value: Any) -> dict[str, Any]:
    if not isinstance(value, dict):
        return {}
    policy = value.get(POLICY_KEY)
    if isinstance(policy, dict):
        return policy
    # ``EjecucionCaso.evidence_policy`` stores the policy object itself,
    # while metadata/configuration stores it below the named key.
    return value if PUBLIC_TEST_DATA_KEY in value else {}


def _object_policies(value: Any) -> list[dict[str, Any]]:
    if value is None:
        return []
    if isinstance(value, dict):
        return [_policy_from(value)]
    return [
        _policy_from(getattr(value, attribute, None))
        for attribute in (
            "evidence_policy",
            "configuracion_api",
            "configuracion_chatbot",
            "api_config_snapshot",
            "chatbot_config_snapshot",
            "api_resultado",
            "chatbot_resultado",
            "ai_report",
            "metadata_json",
        )
    ]


def public_test_data_evidence_enabled(
    *,
    environment: Any = None,
    case: Any = None,
    execution: Any = None,
    config: Any = None,
    result: Any = None,
    metadata: Any = None,
) -> bool:
    """Return whether exact synthetic values may be persisted for a case.

    The setting is deliberately opt-in.  A result marker is accepted so
    report builders can preserve the policy frozen at execution time even if
    the environment is edited later.  It is format-independent: API,
    classic and conversational executions use the same explicit marker.
    """
    # The execution is authoritative once it has a concrete marker.  This is
    # what prevents an environment edit from changing historical evidence.
    # Older rows may not have the generic column yet, so their snapshots and
    # format-specific result remain a backward-compatible fallback.
    sources = (execution, result, metadata, config, case, environment)
    for source in sources:
        for policy in _object_policies(source):
            if PUBLIC_TEST_DATA_KEY in policy:
                return policy.get(PUBLIC_TEST_DATA_KEY) is True
    return False


def public_api_evidence_enabled(*, environment: Any = None, config: Any = None, result: Any = None) -> bool:
    """Backward-compatible API name for the format-independent policy."""
    return public_test_data_evidence_enabled(environment=environment, config=config, result=result)


def evidence_policy_marker(enabled: bool) -> dict[str, Any]:
    return {
        POLICY_KEY: {
            PUBLIC_TEST_DATA_KEY: bool(enabled),
            "redaction": "disabled" if enabled else "semantic",
            "scope": PUBLIC_POLICY_MARKER if enabled else "default",
        }
    }
