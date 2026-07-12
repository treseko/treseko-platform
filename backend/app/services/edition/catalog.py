from __future__ import annotations

from copy import deepcopy
from typing import Any


COMMUNITY_LIMITS: dict[str, int] = {
    "max_organizations": 1,
    "max_users": 5,
    "max_projects": 3,
    "max_workers": 1,
    "max_automated_runs_per_week": 50,
    "max_ai_runs_per_week": 10,
    "max_storage_mb": 1024,
}


LIMIT_CATALOG: dict[str, dict[str, str]] = {
    "max_organizations": {"label": "Organizaciones", "category": "workspace"},
    "max_users": {"label": "Usuarios", "category": "workspace"},
    "max_projects": {"label": "Proyectos", "category": "workspace"},
    "max_workers": {"label": "Workers", "category": "automation"},
    "max_automated_runs_per_week": {"label": "Ejecuciones automatizadas por semana", "category": "automation"},
    "max_ai_runs_per_week": {"label": "Ejecuciones IA por semana", "category": "ai"},
    "max_storage_mb": {"label": "Almacenamiento MB", "category": "storage"},
}


FEATURE_CATALOG: dict[str, dict[str, Any]] = {
    "auth.local": {"edition": "community", "label": "Autenticacion local", "category": "auth"},
    "license.screen": {"edition": "community", "label": "Pantalla de licencia", "category": "system"},
    "projects.basic": {"edition": "community", "label": "Proyectos, componentes y builds basicos", "category": "qa"},
    "tests.manual": {"edition": "community", "label": "Suites, casos, pasos y ejecucion manual", "category": "qa"},
    "evidence.basic": {"edition": "community", "label": "Evidencias basicas", "category": "qa"},
    "bugs.basic": {"edition": "community", "label": "Bug tracker interno simple", "category": "bugs"},
    "reports.basic": {"edition": "community", "label": "Reportes y exportacion basica", "category": "reports"},
    "rbac.simple": {"edition": "community", "label": "RBAC simple", "category": "security"},
    "automation.local_worker": {"edition": "community", "label": "Worker local o automatizacion basica", "category": "automation"},
    "external_api.basic_report": {"edition": "community", "label": "API externa basica para reportar ejecuciones", "category": "automation"},
    "ai.basic_execution": {"edition": "community", "label": "Ejecucion IA basica con cuota semanal", "category": "ai"},
    "updates.community_stable": {"edition": "community", "label": "Canal community-stable", "category": "updates"},
    "rbac.granular": {"edition": "premium", "label": "RBAC granular por capacidades", "category": "security"},
    "auth.sso": {"edition": "premium", "label": "Active Directory, OIDC y SSO", "category": "auth"},
    "ai.engine": {"edition": "premium", "label": "Motor IA completo", "category": "ai"},
    "automation.multi_worker": {"edition": "premium", "label": "Multi-worker", "category": "automation"},
    "automation.scheduler": {"edition": "premium", "label": "Scheduler avanzado", "category": "automation"},
    "automation.advanced": {"edition": "premium", "label": "Ejecucion automatizada avanzada", "category": "automation"},
    "external_api.advanced": {"edition": "premium", "label": "API externa avanzada", "category": "automation"},
    "reports.advanced": {"edition": "premium", "label": "Reportes ejecutivos, desarrollo e internos", "category": "reports"},
    "reports.snapshots": {"edition": "premium", "label": "Snapshots y links compartidos", "category": "reports"},
    "bugs.enterprise": {"edition": "premium", "label": "Bug tracker enterprise, SLA y enlaces externos", "category": "bugs"},
    "integrations.enterprise": {"edition": "premium", "label": "GitHub, GitLab, Jira, Redmine y Azure DevOps", "category": "integrations"},
    "notifications.email": {"edition": "premium", "label": "Notificaciones y email", "category": "notifications"},
    "audit.advanced": {"edition": "premium", "label": "Auditoria avanzada y seguridad", "category": "audit"},
    "metrics.historical": {"edition": "premium", "label": "Metricas historicas y tendencias", "category": "reports"},
    "branding.custom": {"edition": "premium", "label": "Branding personalizable", "category": "branding"},
    "updates.premium": {"edition": "premium", "label": "Canales premium-stable y premium-beta", "category": "updates"},
    "saas.multi_tenant": {"edition": "premium", "label": "Modo SaaS multi-tenant preparado", "category": "platform"},
}


FEATURE_ALIASES: dict[str, str] = {
    "audit.qa_break": "audit.advanced",
}


PREMIUM_HISTORICAL_READ_POLICY: dict[str, dict[str, list[str]]] = {
    "reports.snapshots": {
        "read_after_downgrade": [
            "public_shared_report_links",
            "frozen_report_snapshot_payloads",
            "shared_report_bundle_history",
        ],
        "write_requires_premium": [
            "create_shared_report_snapshot",
            "configure_advanced_report_sections",
            "revoke_or_administer_shared_report_bundle",
        ],
    },
    "reports.advanced": {
        "read_after_downgrade": [
            "previously_generated_report_exports",
            "frozen_report_metrics",
        ],
        "write_requires_premium": [
            "generate_executive_or_development_report",
            "change_project_report_settings",
        ],
    },
    "bugs.enterprise": {
        "read_after_downgrade": [
            "existing_bug_history",
            "execution_occurrence_comments",
            "external_link_metadata",
        ],
        "write_requires_premium": [
            "create_enterprise_bug_workflow",
            "deduplicate_or_merge_bugs",
            "sync_enterprise_external_links",
        ],
    },
    "audit.advanced": {
        "read_after_downgrade": [
            "previous_audit_observations",
            "generated_audit_reports",
        ],
        "write_requires_premium": [
            "run_full_qa_break_audit",
            "generate_new_qa_break_evidence",
        ],
    },
}


def canonical_feature_id(feature_id: str) -> str:
    compact = str(feature_id or "").strip()
    return FEATURE_ALIASES.get(compact, compact)


def normalize_feature_ids(features: Any) -> list[str]:
    if not isinstance(features, (list, tuple, set)):
        return []
    return sorted({canonical_feature_id(str(item)) for item in features if canonical_feature_id(str(item))})


def community_feature_ids() -> set[str]:
    return {
        feature_id
        for feature_id, feature in FEATURE_CATALOG.items()
        if feature.get("edition") == "community"
    }


def premium_feature_ids() -> set[str]:
    return {
        feature_id
        for feature_id, feature in FEATURE_CATALOG.items()
        if feature.get("edition") == "premium"
    }


def all_feature_ids() -> set[str]:
    return set(FEATURE_CATALOG)


def accepted_feature_ids() -> set[str]:
    return all_feature_ids() | set(FEATURE_ALIASES)


def premium_historical_read_policy() -> dict[str, dict[str, list[str]]]:
    return deepcopy(PREMIUM_HISTORICAL_READ_POLICY)


def all_limit_ids() -> set[str]:
    return set(LIMIT_CATALOG)


def feature_catalog_response(enabled_features: set[str]) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    for feature_id, feature in sorted(FEATURE_CATALOG.items()):
        row = deepcopy(feature)
        row["id"] = feature_id
        row["enabled"] = feature_id in enabled_features
        rows.append(row)
    return rows
