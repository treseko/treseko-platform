from .services.integrations.registry import get_registered_capabilities as get_integration_capabilities
from .services.plugins.registry import get_registered_capabilities as get_plugin_capabilities


CAPABILITY_LEVELS = {"none", "read", "edit"}

RBAC_CAPABILITIES = [
    {
        "module": "dashboard",
        "module_label": "Dashboard",
        "capabilities": [
            {"id": "dashboard.ver", "label": "Ver dashboard"},
            {"id": "dashboard.personalizar", "label": "Personalizar"},
        ],
    },
    {
        "module": "ejecutar",
        "module_label": "Ejecutar Pruebas",
        "capabilities": [
            {"id": "ejecutar.ver", "label": "Ver casos ejecutables"},
            {"id": "ejecutar.manual", "label": "Iniciar manual"},
            {"id": "ejecutar.automatizada", "label": "Iniciar automatizada"},
            {"id": "ejecutar.ia", "label": "Iniciar IA"},
            {"id": "ejecutar.evidencias", "label": "Evidencias"},
            {"id": "ejecutar.historial_build", "label": "Historial de build"},
        ],
    },
    {
        "module": "crear_pruebas",
        "module_label": "Anadir Pruebas",
        "capabilities": [
            {"id": "crear_pruebas.suites", "label": "Suites"},
            {"id": "crear_pruebas.casos", "label": "Casos"},
            {"id": "crear_pruebas.pasos", "label": "Pasos"},
            {"id": "crear_pruebas.versiones", "label": "Versiones"},
            {"id": "crear_pruebas.adjuntos", "label": "Adjuntos de referencia"},
            {"id": "crear_pruebas.scripts", "label": "Scripts automatizados"},
        ],
    },
    {
        "module": "automatizacion",
        "module_label": "Automatizacion",
        "capabilities": [
            {"id": "automatizacion.workers", "label": "Workers"},
            {"id": "automatizacion.jobs", "label": "Jobs"},
            {"id": "automatizacion.funciones", "label": "Funciones reutilizables"},
            {"id": "automatizacion.validacion_scripts", "label": "Validacion de scripts"},
        ],
    },
    {
        "module": "proyectos",
        "module_label": "Proyectos",
        "capabilities": [
            {"id": "proyectos.portfolio", "label": "Portafolio"},
            {"id": "proyectos.componentes", "label": "Componentes"},
            {"id": "proyectos.builds", "label": "Builds"},
            {"id": "proyectos.build_scope", "label": "Alcance build-caso"},
            {"id": "proyectos.equipo", "label": "Equipo"},
            {"id": "proyectos.ambientes", "label": "Ambientes"},
            {"id": "proyectos.datasets", "label": "Datasets"},
            {"id": "proyectos.wiki", "label": "Wiki"},
        ],
    },
    {
        "module": "inventario",
        "module_label": "Inventario",
        "capabilities": [
            {"id": "inventario.ambientes", "label": "Ambientes"},
            {"id": "inventario.dispositivos", "label": "Dispositivos"},
            {"id": "inventario.nodos", "label": "Nodos"},
            {"id": "inventario.categorias", "label": "Categorias"},
        ],
    },
    {
        "module": "reportes",
        "module_label": "Reportes",
        "capabilities": [
            {"id": "reportes.ver", "label": "Ver metricas"},
            {"id": "reportes.exportar", "label": "Exportar"},
            {"id": "reportes.compartir", "label": "Compartir"},
            {"id": "reportes.configurar", "label": "Configurar informes"},
        ],
    },
    {
        "module": "bugs",
        "module_label": "Bug Tracker",
        "capabilities": [
            {"id": "bugs.ver", "label": "Ver bugs"},
            {"id": "bugs.crear", "label": "Crear bugs"},
            {"id": "bugs.editar", "label": "Editar bugs"},
            {"id": "bugs.triage", "label": "Triage y estados"},
            {"id": "bugs.asignar", "label": "Asignar responsables"},
            {"id": "bugs.comentar", "label": "Comentar"},
            {"id": "bugs.adjuntos", "label": "Adjuntar evidencia"},
            {"id": "bugs.vincular_externo", "label": "Vincular tracker externo"},
            {"id": "bugs.exportar", "label": "Exportar markdown"},
            {"id": "bugs.admin", "label": "Administrar bug tracker"},
        ],
    },
    {
        "module": "motor_ia",
        "module_label": "Motor IA",
        "capabilities": [
            {"id": "motor_ia.ver", "label": "Ver estado"},
            {"id": "motor_ia.configuracion", "label": "Configuracion"},
            {"id": "motor_ia.workflows", "label": "Workflows"},
            {"id": "motor_ia.logs", "label": "Logs"},
            {"id": "motor_ia.scheduler", "label": "Scheduler"},
        ],
    },
    {
        "module": "redmine",
        "module_label": "Complementos legacy",
        "capabilities": [
            {"id": "redmine.ver", "label": "Ver"},
            {"id": "redmine.configuracion", "label": "Configurar"},
            {"id": "redmine.reportar", "label": "Reportar"},
            {"id": "redmine.vinculos", "label": "Vinculos issue/snapshot"},
        ],
    },
    {
        "module": "integraciones",
        "module_label": "Integraciones",
        "capabilities": [
            {"id": "integraciones.catalogo", "label": "Catalogo"},
            {"id": "integraciones.ver_estado", "label": "Ver estado"},
            {"id": "integraciones.test_conexion", "label": "Probar conexion"},
            {"id": "integraciones.configurar", "label": "Configurar"},
            {"id": "integraciones.secretos", "label": "Gestionar secretos"},
            {"id": "integraciones.webhooks", "label": "Webhooks"},
            {"id": "integraciones.auditoria", "label": "Auditoria"},
        ],
    },
    {
        "module": "plugins",
        "module_label": "Plugins",
        "capabilities": [
            {"id": "plugins.catalogo", "label": "Catalogo"},
            {"id": "plugins.instalar", "label": "Instalar"},
            {"id": "plugins.desinstalar", "label": "Desinstalar"},
            {"id": "plugins.habilitar", "label": "Habilitar"},
            {"id": "plugins.configurar", "label": "Configurar"},
            {"id": "plugins.gestionar_secretos", "label": "Gestionar secretos"},
            {"id": "plugins.auditoria", "label": "Auditoria"},
        ],
    },
    {
        "module": "notificaciones",
        "module_label": "Notificaciones",
        "capabilities": [
            {"id": "notificaciones.ver", "label": "Ver notificaciones"},
            {"id": "notificaciones.inbox", "label": "Bandeja personal"},
            {"id": "notificaciones.configuracion", "label": "Configuracion SMTP"},
            {"id": "notificaciones.reglas", "label": "Reglas"},
            {"id": "notificaciones.plantillas", "label": "Plantillas"},
            {"id": "notificaciones.auditoria", "label": "Auditoria"},
            {"id": "notificaciones.admin", "label": "Administracion"},
        ],
    },
    {
        "module": "historial",
        "module_label": "Historial",
        "capabilities": [
            {"id": "historial.ver", "label": "Ver historial"},
            {"id": "historial.detalle", "label": "Detalle"},
            {"id": "historial.evidencias", "label": "Evidencias"},
        ],
    },
    {
        "module": "configuracion",
        "module_label": "Configuracion",
        "capabilities": [
            {"id": "configuracion.preferencias", "label": "Preferencias"},
            {"id": "configuracion.perfil", "label": "Mi Perfil"},
            {"id": "configuracion.clientes", "label": "Clientes / Soluciones"},
            {"id": "configuracion.usuarios", "label": "Gestion Usuarios"},
            {"id": "configuracion.roles", "label": "Roles"},
            {"id": "configuracion.integraciones", "label": "Integraciones"},
            {"id": "configuracion.pruebas_ia", "label": "Pruebas con IA"},
            {"id": "configuracion.monitor", "label": "Monitor"},
            {"id": "configuracion.api_keys", "label": "API keys"},
            {"id": "configuracion.sesion", "label": "Sesion y seguridad"},
            {"id": "configuracion.adjuntos", "label": "Adjuntos y evidencias"},
            {"id": "configuracion.licencia", "label": "Licencia"},
            {"id": "configuracion.actualizaciones", "label": "Actualizaciones"},
        ],
    },
]

CAPABILITY_TO_MODULE = {
    capability["id"]: group["module"]
    for group in RBAC_CAPABILITIES
    for capability in group["capabilities"]
}

for capability_id, capability in get_integration_capabilities().items():
    CAPABILITY_TO_MODULE[capability_id] = capability["module"]

for capability_id, capability in get_plugin_capabilities().items():
    CAPABILITY_TO_MODULE[capability_id] = capability["module"]

ALL_CAPABILITIES = set(CAPABILITY_TO_MODULE)


def get_capability_module(capability_id: str) -> str | None:
    return CAPABILITY_TO_MODULE.get(capability_id)
