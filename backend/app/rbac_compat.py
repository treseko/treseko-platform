from __future__ import annotations


REDMINE_LEGACY_READ = {
    "integraciones.provider.redmine.ver",
}

REDMINE_LEGACY_EDIT = {
    "integraciones.provider.redmine.ver",
    "integraciones.provider.redmine.configurar",
    "integraciones.provider.redmine.test_conexion",
    "integraciones.provider.redmine.gestionar_secretos",
    "integraciones.provider.redmine.reportar",
    "integraciones.provider.redmine.vincular",
}


def legacy_capability_level(module_permissions: dict, capability_id: str) -> str | None:
    redmine_level = (module_permissions or {}).get("redmine")
    if redmine_level == "edit" and capability_id in REDMINE_LEGACY_EDIT:
        return "edit"
    if redmine_level in {"read", "edit"} and capability_id in REDMINE_LEGACY_READ:
        return "read"
    return None
