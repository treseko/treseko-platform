from __future__ import annotations


INTEGRATION_MANIFESTS = [
    {
        "id": "notification_email",
        "kind": "integration",
        "display_name": "Email / SMTP",
        "module": "integraciones",
        "status": "active",
        "builtin": True,
        "description": "Notificaciones por correo integradas en Treseko. Configura SMTP, remitente y reglas desde Configuracion.",
        "capabilities": [
            {"id": "integraciones.provider.notification_email.ver", "label": "Ver configuracion de email", "level": "read"},
            {"id": "integraciones.provider.notification_email.configurar", "label": "Configurar SMTP y remitente", "level": "edit"},
            {"id": "integraciones.provider.notification_email.test_conexion", "label": "Enviar prueba de correo", "level": "read"},
            {"id": "integraciones.provider.notification_email.gestionar_secretos", "label": "Gestionar credenciales SMTP", "level": "edit"},
        ],
    },
    {
        "id": "redmine",
        "kind": "integration",
        "display_name": "Redmine",
        "module": "integraciones",
        "status": "planned",
        "capabilities": [
            {"id": "integraciones.provider.redmine.ver", "label": "Ver configuracion Redmine", "level": "read"},
            {"id": "integraciones.provider.redmine.configurar", "label": "Configurar Redmine", "level": "edit"},
            {"id": "integraciones.provider.redmine.test_conexion", "label": "Probar conexion Redmine", "level": "read"},
            {"id": "integraciones.provider.redmine.gestionar_secretos", "label": "Gestionar secretos Redmine", "level": "edit"},
            {"id": "integraciones.provider.redmine.reportar", "label": "Reportar defectos", "level": "edit"},
            {"id": "integraciones.provider.redmine.vincular", "label": "Vincular issue/snapshot", "level": "edit"},
            {"id": "integraciones.provider.redmine.deduplicar", "label": "Buscar duplicados", "level": "read"},
            {"id": "integraciones.provider.redmine.webhooks", "label": "Webhooks Redmine", "level": "edit"},
            {"id": "integraciones.provider.redmine.auditoria", "label": "Auditoria Redmine", "level": "read"},
        ],
    },
    {
        "id": "jira",
        "kind": "integration",
        "display_name": "Jira",
        "module": "integraciones",
        "status": "planned",
        "capabilities": [
            {"id": "integraciones.provider.jira.ver", "label": "Ver configuracion Jira", "level": "read"},
            {"id": "integraciones.provider.jira.configurar", "label": "Configurar Jira", "level": "edit"},
            {"id": "integraciones.provider.jira.reportar", "label": "Reportar defectos", "level": "edit"},
            {"id": "integraciones.provider.jira.vincular", "label": "Vincular issue/snapshot", "level": "edit"},
            {"id": "integraciones.provider.jira.deduplicar", "label": "Buscar duplicados", "level": "read"},
        ],
    },
    {
        "id": "github_issues",
        "kind": "integration",
        "display_name": "GitHub Issues",
        "module": "integraciones",
        "status": "planned",
        "capabilities": [
            {"id": "integraciones.provider.github_issues.ver", "label": "Ver configuracion GitHub Issues", "level": "read"},
            {"id": "integraciones.provider.github_issues.configurar", "label": "Configurar GitHub Issues", "level": "edit"},
            {"id": "integraciones.provider.github_issues.reportar", "label": "Reportar issues", "level": "edit"},
            {"id": "integraciones.provider.github_issues.vincular", "label": "Vincular issue/snapshot", "level": "edit"},
        ],
    },
]


def get_registered_integrations() -> list[dict]:
    return INTEGRATION_MANIFESTS


def get_registered_capabilities() -> dict[str, dict]:
    return {
        capability["id"]: {**capability, "provider_id": manifest["id"], "kind": manifest["kind"], "module": manifest["module"]}
        for manifest in INTEGRATION_MANIFESTS
        for capability in manifest["capabilities"]
    }


def is_registered_capability(capability_id: str) -> bool:
    return capability_id in get_registered_capabilities()
