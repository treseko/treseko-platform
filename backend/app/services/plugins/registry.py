from __future__ import annotations


PLUGIN_MANIFESTS = [
    {
        "id": "bug_tracker",
        "kind": "plugin",
        "display_name": "Bug Tracker interno",
        "module": "plugins",
        "status": "active",
        "builtin": True,
        "description": "Gestion de bugs, evidencias, estados, comentarios y trazabilidad QA integrada en Treseko.",
        "capabilities": [
            {"id": "plugins.provider.bug_tracker.ver", "label": "Ver bug tracker interno", "level": "read"},
            {"id": "plugins.provider.bug_tracker.crear", "label": "Crear bugs internos", "level": "edit"},
            {"id": "plugins.provider.bug_tracker.triage", "label": "Gestionar estados y triage", "level": "edit"},
            {"id": "plugins.provider.bug_tracker.evidencia", "label": "Adjuntar evidencia y comentarios", "level": "edit"},
        ],
    },
    {
        "id": "motor_llm",
        "kind": "plugin",
        "display_name": "Motor LLM",
        "module": "plugins",
        "status": "active",
        "builtin": True,
        "description": "Motor de lenguaje integrado para ejecucion IA, generacion asistida y workflows controlados por permisos y cuotas.",
        "capabilities": [
            {"id": "plugins.provider.motor_llm.ver", "label": "Ver configuracion del Motor LLM", "level": "read"},
            {"id": "plugins.provider.motor_llm.configurar", "label": "Configurar modelos, tokens y endpoints", "level": "edit"},
            {"id": "plugins.provider.motor_llm.ejecutar", "label": "Ejecutar capacidades IA habilitadas", "level": "edit"},
            {"id": "plugins.provider.motor_llm.auditoria", "label": "Consultar trazas y auditoria IA", "level": "read"},
        ],
    },
    {
        "id": "junit_importer",
        "kind": "plugin",
        "display_name": "JUnit XML Importer",
        "module": "plugins",
        "status": "planned",
        "capabilities": [
            {"id": "plugins.provider.junit_importer.importar_resultados", "label": "Importar resultados JUnit/XML", "level": "edit"},
        ],
    },
    {
        "id": "excel_importer",
        "kind": "plugin",
        "display_name": "Excel Case Importer",
        "module": "plugins",
        "status": "planned",
        "capabilities": [
            {"id": "plugins.provider.excel_importer.importar_casos", "label": "Importar casos desde Excel", "level": "edit"},
        ],
    },
    {
        "id": "custom_dashboard",
        "kind": "plugin",
        "display_name": "Custom Dashboard Widgets",
        "module": "plugins",
        "status": "planned",
        "capabilities": [
            {"id": "plugins.provider.custom_dashboard.agregar_widget", "label": "Agregar widget de Dashboard", "level": "edit"},
        ],
    },
    {
        "id": "ai_case_generator",
        "kind": "plugin",
        "display_name": "AI Case Generator",
        "module": "plugins",
        "status": "planned",
        "capabilities": [
            {"id": "plugins.provider.ai_case_generator.generar_casos", "label": "Generar casos con IA", "level": "edit"},
        ],
    },
]


def get_registered_plugins() -> list[dict]:
    return PLUGIN_MANIFESTS


def get_registered_capabilities() -> dict[str, dict]:
    return {
        capability["id"]: {**capability, "provider_id": manifest["id"], "kind": manifest["kind"], "module": manifest["module"]}
        for manifest in PLUGIN_MANIFESTS
        for capability in manifest["capabilities"]
    }


def is_registered_capability(capability_id: str) -> bool:
    return capability_id in get_registered_capabilities()
