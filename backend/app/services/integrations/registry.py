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
