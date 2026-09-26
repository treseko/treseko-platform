from .services.integrations.registry import get_registered_capabilities as get_integration_capabilities
from .services.plugins.registry import get_registered_capabilities as get_plugin_capabilities


CAPABILITY_LEVELS = {"none", "read", "edit"}

RBAC_CAPABILITIES = [
    {
        "module": "dashboard",
        "module_label": "Dashboard",
        "module_description": "Vista general del trabajo y del estado de calidad.",
        "capabilities": [
            {"id": "dashboard.ver", "label": "Ver dashboard"},
            {"id": "dashboard.personalizar", "label": "Personalizar"},
        ],
    },
    {
        "module": "ejecutar",
        "module_label": "Ejecución de pruebas",
        "module_description": "Ejecución manual, automatizada y asistida por IA.",
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
        "module_label": "Diseño de pruebas",
        "module_description": "Suites, casos, pasos, versiones y adjuntos de prueba.",
        "capabilities": [
            {"id": "crear_pruebas.suites", "label": "Suites"},
            {"id": "crear_pruebas.casos", "label": "Casos"},
            {"id": "crear_pruebas.pasos", "label": "Pasos"},
            {"id": "crear_pruebas.versiones", "label": "Versiones"},
            {"id": "crear_pruebas.adjuntos", "label": "Adjuntos de referencia"},
            {"id": "crear_pruebas.scripts", "label": "Scripts automatizados"},
            {"id": "crear_pruebas.trazabilidad", "label": "Trazabilidad de casos"},
        ],
    },
    {
        "module": "automatizacion",
        "module_label": "Automatización",
        "module_description": "Workers, jobs y funciones para ejecutar automatizaciones.",
        "capabilities": [
            {"id": "automatizacion.workers", "label": "Workers"},
            {"id": "automatizacion.jobs", "label": "Jobs"},
            {"id": "automatizacion.funciones", "label": "Funciones reutilizables"},
            {"id": "automatizacion.validacion_scripts", "label": "Validacion de scripts"},
        ],
    },
    {
        "module": "proyectos",
        "module_label": "Proyectos y datos",
        "module_description": "Proyectos, builds, ambientes, datasets, requisitos y documentación.",
        "capabilities": [
            {"id": "proyectos.portfolio", "label": "Portafolio"},
            {"id": "proyectos.componentes", "label": "Componentes"},
            {"id": "proyectos.builds", "label": "Builds"},
            {"id": "proyectos.build_scope", "label": "Alcance build-caso"},
            {"id": "proyectos.equipo", "label": "Equipo"},
            {"id": "proyectos.ambientes", "label": "Ambientes"},
            {"id": "proyectos.datasets", "label": "Datasets"},
            {"id": "proyectos.wiki", "label": "Wiki"},
            {"id": "proyectos.requisitos", "label": "Requisitos"},
            {"id": "proyectos.historias", "label": "Historias de usuario"},
            {"id": "proyectos.historias.generar_ia", "label": "Generar historias con IA"},
            {"id": "proyectos.historias.generar_casos_ia", "label": "Generar casos con IA"},
        ],
    },
    {
        "module": "inventario",
        "module_label": "Inventario técnico",
        "module_description": "Ambientes, dispositivos, nodos y categorías disponibles.",
        "capabilities": [
            {"id": "inventario.ambientes", "label": "Ambientes"},
            {"id": "inventario.dispositivos", "label": "Dispositivos"},
            {"id": "inventario.nodos", "label": "Nodos"},
            {"id": "inventario.categorias", "label": "Categorias"},
        ],
    },
    {
        "module": "reportes",
        "module_label": "Reportes y métricas",
        "module_description": "Métricas, cobertura, exportaciones y enlaces compartidos.",
        "capabilities": [
            {"id": "reportes.ver", "label": "Ver metricas"},
            {"id": "reportes.exportar", "label": "Exportar"},
            {"id": "reportes.compartir", "label": "Compartir"},
            {"id": "reportes.configurar", "label": "Configurar informes"},
            {"id": "reportes.trazabilidad", "label": "Cobertura de trazabilidad"},
        ],
    },
    {
        "module": "bugs",
        "module_label": "Gestión de bugs",
        "module_description": "Registro, análisis, asignación, resolución y seguimiento de bugs.",
        "capabilities": [
            {"id": "bugs.ver", "label": "Ver bugs"},
            {"id": "bugs.crear", "label": "Crear bugs"},
            {"id": "bugs.editar", "label": "Editar bugs"},
            {"id": "bugs.triage", "label": "Triage y estados"},
            {"id": "bugs.asignar", "label": "Asignar responsables"},
            {"id": "bugs.tomar", "label": "Tomar bugs sin asignar"},
            {"id": "bugs.resolver", "label": "Resolver bugs propios"},
            {"id": "bugs.cerrar", "label": "Cerrar bugs"},
            {"id": "bugs.comentar", "label": "Comentar"},
            {"id": "bugs.adjuntos", "label": "Adjuntar evidencia"},
            {"id": "bugs.vincular_externo", "label": "Vincular tracker externo"},
            {"id": "bugs.exportar", "label": "Exportar markdown"},
            {"id": "bugs.admin", "label": "Administrar bug tracker"},
        ],
    },
    {
        "module": "incidencias",
        "module_label": "Centro de incidencias",
        "module_description": "Bandeja operativa para revisar y devolver incidencias a QA.",
        "capabilities": [
            {"id": "incidencias.ver", "label": "Ver centro de incidencias"},
        ],
    },
    {
        "module": "motor_ia",
        "module_label": "Motor de IA",
        "module_description": "Estado, configuración y workflows de inteligencia artificial.",
        "capabilities": [
            {"id": "motor_ia.ver", "label": "Ver estado"},
            {"id": "motor_ia.configuracion", "label": "Configuracion"},
            {"id": "motor_ia.workflows", "label": "Workflows"},
            {"id": "motor_ia.workflow_view", "label": "Ver workflows"},
            {"id": "motor_ia.workflow_execute", "label": "Ejecutar workflows"},
            {"id": "motor_ia.workflow_drafts", "label": "Crear y editar borradores"},
            {"id": "motor_ia.workflow_publish", "label": "Publicar versiones"},
            {"id": "motor_ia.workflow_activate", "label": "Activar workflows"},
            {"id": "motor_ia.workflow_archive", "label": "Archivar workflows"},
            {"id": "motor_ia.workflow_integrations", "label": "Usar agentes externos"},
            {"id": "motor_ia.workflow_blocked_reviews", "label": "Revisar ejecuciones bloqueadas"},
            {"id": "motor_ia.logs", "label": "Logs"},
            {"id": "motor_ia.scheduler", "label": "Scheduler"},
        ],
    },
    {
        "module": "redmine",
        "module_label": "Integración con trackers",
        "module_description": "Conexión con trackers externos y vínculos de seguimiento.",
        "capabilities": [
            {"id": "redmine.ver", "label": "Ver"},
            {"id": "redmine.configuracion", "label": "Configurar"},
            {"id": "redmine.reportar", "label": "Reportar"},
            {"id": "redmine.vinculos", "label": "Vinculos issue/snapshot"},
        ],
    },
    {
        "module": "integraciones",
        "module_label": "Integraciones externas",
        "module_description": "Conectores, credenciales, webhooks y auditoría de servicios externos.",
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
        "module_label": "Complementos instalables",
        "module_description": "Catálogo y administración de extensiones aprobadas.",
        "capabilities": [
            {"id": "plugins.catalogo", "label": "Catalogo"},
            {"id": "plugins.instalar", "label": "Instalar"},
            {"id": "plugins.desinstalar", "label": "Desinstalar"},
            {"id": "plugins.habilitar", "label": "Habilitar"},
            {"id": "plugins.configurar", "label": "Configurar"},
            {"id": "plugins.gestionar_secretos", "label": "Gestionar secretos"},
            {"id": "plugins.auditoria", "label": "Auditoria"},
            {"id": "plugins.provider.case_portability.importar_casos", "label": "Exportar, importar y revertir casos"},
        ],
    },
    {
        "module": "notificaciones",
        "module_label": "Correo y notificaciones",
        "module_description": "Preferencias, reglas, plantillas y entregas de correo del sistema.",
        "capabilities": [
            {"id": "notificaciones.ver", "label": "Ver notificaciones"},
            {"id": "notificaciones.inbox", "label": "Bandeja personal"},
            {"id": "notificaciones.configuracion", "label": "Configuracion SMTP"},
            {"id": "notificaciones.reglas", "label": "Reglas"},
            {"id": "notificaciones.plantillas", "label": "Plantillas"},
            {"id": "notificaciones.destinatarios", "label": "Stakeholders y destinatarios externos"},
            {"id": "notificaciones.resumenes", "label": "Resúmenes programados"},
            {"id": "notificaciones.auditoria", "label": "Auditoria"},
            {"id": "notificaciones.admin", "label": "Administracion"},
        ],
    },
    {
        "module": "historial",
        "module_label": "Historial de ejecuciones",
        "module_description": "Consultas, detalles y evidencias de ejecuciones anteriores.",
        "capabilities": [
            {"id": "historial.ver", "label": "Ver historial"},
            {"id": "historial.detalle", "label": "Detalle"},
            {"id": "historial.evidencias", "label": "Evidencias"},
        ],
    },
    {
        "module": "configuracion",
        "module_label": "Administración y configuración",
        "module_description": "Usuarios, roles, preferencias, seguridad, licencia y mantenimiento.",
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
            {"id": "mcp.usar", "label": "Usar MCP"},
            {"id": "configuracion.sesion", "label": "Sesion y seguridad"},
            {"id": "configuracion.adjuntos", "label": "Adjuntos y evidencias"},
            {"id": "settings.evidence_sanitization.manage", "label": "Gestionar sanitizacion de evidencias"},
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

# Metadata shown to administrators.  Permission IDs remain stable; this layer
# only explains where a permission is used in the product.
_SCREEN_CAPABILITIES = {
    "dashboard.ver", "ejecutar.ver", "ejecutar.evidencias", "ejecutar.historial_build",
    "crear_pruebas.suites", "crear_pruebas.casos", "crear_pruebas.versiones",
    "crear_pruebas.trazabilidad", "proyectos.portfolio", "proyectos.componentes",
    "proyectos.builds", "proyectos.build_scope", "proyectos.equipo", "proyectos.ambientes",
    "proyectos.datasets", "proyectos.wiki", "proyectos.requisitos", "proyectos.historias",
    "inventario.ambientes", "inventario.dispositivos", "inventario.nodos", "inventario.categorias",
    "reportes.ver", "reportes.trazabilidad", "bugs.ver", "incidencias.ver", "motor_ia.ver",
    "motor_ia.workflows", "motor_ia.workflow_view", "motor_ia.logs", "motor_ia.scheduler",
    "redmine.ver", "integraciones.catalogo", "integraciones.ver_estado", "integraciones.auditoria",
    "plugins.catalogo", "plugins.auditoria", "notificaciones.ver", "notificaciones.inbox",
    "notificaciones.auditoria", "historial.ver", "historial.detalle", "historial.evidencias",
    "configuracion.preferencias", "configuracion.perfil", "configuracion.clientes",
    "configuracion.usuarios", "configuracion.roles", "configuracion.integraciones",
    "configuracion.pruebas_ia", "configuracion.monitor", "configuracion.api_keys",
    "configuracion.sesion", "configuracion.adjuntos", "configuracion.licencia",
    "configuracion.actualizaciones",
}

_MODULE_ROUTES = {
    "dashboard": "Dashboard",
    "ejecutar": "Ejecutar pruebas",
    "crear_pruebas": "Añadir pruebas",
    "automatizacion": "Automatización",
    "proyectos": "Proyectos",
    "inventario": "Inventario",
    "reportes": "Reportes y métricas",
    "bugs": "Bug Tracker",
    "incidencias": "Centro de incidencias",
    "motor_ia": "Motor de IA",
    "redmine": "Complementos > Trackers externos",
    "integraciones": "Configuración > Integraciones",
    "plugins": "Complementos",
    "notificaciones": "Configuración > Correo y notificaciones",
    "historial": "Historial Runs",
    "configuracion": "Configuración",
}

_CONFIG_SUBSECTIONS = {
    "configuracion.preferencias": "Cuenta y preferencias",
    "configuracion.perfil": "Cuenta y preferencias",
    "configuracion.sesion": "Cuenta y preferencias",
    "configuracion.clientes": "Organización y acceso",
    "configuracion.usuarios": "Organización y acceso",
    "configuracion.roles": "Organización y acceso",
    "configuracion.integraciones": "Integraciones y conexiones",
    "configuracion.api_keys": "Integraciones y conexiones",
    "mcp.usar": "Integraciones y conexiones",
    "configuracion.pruebas_ia": "Inteligencia artificial",
    "configuracion.adjuntos": "Evidencias y archivos",
    "settings.evidence_sanitization.manage": "Evidencias y archivos",
    "configuracion.monitor": "Plataforma",
    "configuracion.licencia": "Plataforma",
    "configuracion.actualizaciones": "Plataforma",
}


# Explain the operational consequence of a permission, not just its route.
_CAPABILITY_PURPOSES = {
    "integraciones.catalogo": "Permite consultar las integraciones disponibles para instalar.",
    "integraciones.ver_estado": "Permite consultar el estado y la salud de las integraciones instaladas.",
    "integraciones.test_conexion": "Permite probar una conexión sin cambiar su configuración.",
    "integraciones.configurar": "Permite cambiar URLs, opciones y comportamiento de una integración.",
    "integraciones.secretos": "Permite crear o reemplazar credenciales usadas por integraciones.",
    "integraciones.webhooks": "Permite administrar webhooks entrantes y salientes.",
    "integraciones.auditoria": "Permite consultar las acciones y eventos de las integraciones.",
    "plugins.catalogo": "Permite consultar el catálogo de complementos aprobados.",
    "plugins.instalar": "Permite instalar complementos en la plataforma.",
    "plugins.desinstalar": "Permite retirar complementos instalados.",
    "plugins.habilitar": "Permite activar o desactivar complementos.",
    "plugins.configurar": "Permite cambiar la configuración de un complemento.",
    "plugins.gestionar_secretos": "Permite gestionar credenciales usadas por complementos.",
    "plugins.auditoria": "Permite consultar la actividad y auditoría de complementos.",
    "notificaciones.ver": "Permite consultar notificaciones del sistema.",
    "notificaciones.inbox": "Permite consultar y gestionar la bandeja personal.",
    "notificaciones.configuracion": "Permite configurar el correo saliente institucional.",
    "notificaciones.reglas": "Permite crear y modificar reglas de envío.",
    "notificaciones.plantillas": "Permite modificar plantillas de correo.",
    "notificaciones.auditoria": "Permite consultar entregas, fallos y trazabilidad del correo.",
    "historial.ver": "Permite consultar ejecuciones anteriores.",
    "historial.detalle": "Permite abrir el detalle completo de una ejecución.",
    "historial.evidencias": "Permite consultar las evidencias de ejecuciones anteriores.",
    "configuracion.preferencias": "Permite cambiar preferencias generales del workspace.",
    "configuracion.perfil": "Permite editar el propio perfil y preferencias personales.",
    "configuracion.usuarios": "Permite crear, editar, activar o inactivar usuarios.",
    "configuracion.roles": "Permite crear y modificar roles y sus permisos.",
    "configuracion.integraciones": "Permite administrar integraciones desde Configuración.",
    "configuracion.api_keys": "Permite crear, consultar y revocar API keys.",
    "mcp.usar": "Permite descubrir y utilizar MCP; el nivel edit también permite administrar sus credenciales.",
    "configuracion.sesion": "Permite configurar sesión, expiración y seguridad de acceso.",
    "configuracion.adjuntos": "Permite configurar límites y sanitización de archivos.",
    "configuracion.licencia": "Permite consultar e instalar la licencia de la instancia.",
    "configuracion.actualizaciones": "Permite consultar y aplicar actualizaciones.",
    "reportes.ver": "Permite consultar métricas y reportes de calidad.",
    "reportes.exportar": "Permite descargar reportes y métricas fuera de Treseko.",
    "reportes.compartir": "Permite generar enlaces compartidos de reportes.",
    "bugs.ver": "Permite consultar bugs y su historial.",
    "bugs.crear": "Permite registrar nuevos bugs.",
    "bugs.editar": "Permite modificar la información de un bug.",
    "bugs.triage": "Permite cambiar prioridad, estado y clasificación durante el triage.",
    "bugs.asignar": "Permite asignar bugs a responsables.",
    "bugs.comentar": "Permite agregar comentarios y seguimiento a un bug.",
    "bugs.adjuntos": "Permite adjuntar evidencias a un bug.",
    "bugs.cerrar": "Permite cerrar definitivamente un bug.",
}


def capability_metadata(capability_id: str, module: str, label: str) -> dict:
    """Add human context without changing the persisted capability contract."""
    scope = "screen" if capability_id in _SCREEN_CAPABILITIES else "action"
    route = _MODULE_ROUTES.get(module, module.replace("_", " ").title())
    if scope == "screen":
        impact = f"Controla la pantalla o consulta de {route}."
    else:
        impact = f"Controla la acción «{label.lower()}» dentro de {route}."
    metadata = {
        "scope": scope,
        "route": route,
        "impact": impact,
        "purpose": _CAPABILITY_PURPOSES.get(
            capability_id,
            f"Permite {'abrir y consultar' if scope == 'screen' else 'ejecutar'} «{label.lower()}» en {route}.",
        ),
        "status": "active",
    }
    if capability_id in _CONFIG_SUBSECTIONS:
        metadata["subsection"] = _CONFIG_SUBSECTIONS[capability_id]
    if capability_id == "incidencias.ver":
        metadata["compatibility_note"] = "Permiso explícito requerido para abrir el Centro de incidencias."
    if capability_id == "motor_ia.workflows":
        metadata["compatibility_note"] = "Acceso a la sección; las acciones se controlan con los permisos workflow_* ."
    if capability_id == "settings.evidence_sanitization.manage":
        metadata["route"] = "Configuración > Adjuntos y evidencias"
    return metadata


def get_capability_module(capability_id: str) -> str | None:
    return CAPABILITY_TO_MODULE.get(capability_id)
