# Matriz RBAC granular por capacidades

Fecha: 2026-06-29

Convencion: `permisos_detallados` guarda `none`, `read` o `edit`. `none` explicito permite negar una capacidad hija aunque el modulo padre tenga acceso.

| Modulo | Capacidad | Label UI | Nivel base recomendado | Backend relacionado | Estado |
|---|---|---|---|---|---|
| dashboard | dashboard.ver | Ver dashboard | Todos: read | `/dashboard/summary` | Catalogo |
| dashboard | dashboard.personalizar | Personalizar | ADMIN: edit | Preferencias dashboard | Pendiente |
| ejecutar | ejecutar.ver | Ver casos ejecutables | QA_LEAD/TESTER: read | test-runs lectura | Implementado parcial |
| ejecutar | ejecutar.manual | Iniciar manual | QA_LEAD/TESTER: edit | `POST /test-runs/` | Implementado |
| ejecutar | ejecutar.automatizada | Iniciar automatizada | QA_LEAD/TESTER: edit | endpoints automatizados | Implementado parcial |
| ejecutar | ejecutar.ia | Iniciar IA | QA_LEAD: edit | IA/review | Implementado parcial |
| ejecutar | ejecutar.evidencias | Evidencias | QA_LEAD/TESTER: edit | snapshots/evidencias | Implementado parcial |
| ejecutar | ejecutar.historial_build | Historial de build | Todos con ejecutar: read | ultimos resultados | UI protegido |
| crear_pruebas | crear_pruebas.suites | Suites | QA_LEAD/TESTER: edit | suites | Implementado |
| crear_pruebas | crear_pruebas.casos | Casos | QA_LEAD/TESTER: edit | casos | Implementado |
| crear_pruebas | crear_pruebas.pasos | Pasos | QA_LEAD/TESTER: edit | pasos | UI protegido |
| crear_pruebas | crear_pruebas.versiones | Versiones | QA_LEAD/TESTER: read | versions | Implementado |
| crear_pruebas | crear_pruebas.adjuntos | Adjuntos de referencia | QA_LEAD/TESTER: edit | paso attachments | Implementado |
| crear_pruebas | crear_pruebas.scripts | Scripts automatizados | QA_LEAD: edit | scripts/dry-run | Implementado |
| automatizacion | automatizacion.workers | Workers | QA_LEAD: edit | automation-runners | Implementado |
| automatizacion | automatizacion.jobs | Jobs | QA_LEAD: read | automation-jobs | Implementado |
| automatizacion | automatizacion.funciones | Funciones reutilizables | QA_LEAD: edit | funciones | Implementado |
| automatizacion | automatizacion.validacion_scripts | Validacion de scripts | QA_LEAD/TESTER: read | scripts/validate | Implementado |
| proyectos | proyectos.portfolio | Portafolio | Todos con proyectos: read | proyectos CRUD | Implementado |
| proyectos | proyectos.componentes | Componentes | QA_LEAD: edit | componentes | Implementado |
| proyectos | proyectos.builds | Builds | QA_LEAD: edit | builds | Implementado |
| proyectos | proyectos.build_scope | Alcance build-caso | QA_LEAD: edit | build-casos | Implementado |
| proyectos | proyectos.equipo | Equipo | QA_LEAD: edit | proyecto miembros | Implementado |
| proyectos | proyectos.ambientes | Ambientes | QA_LEAD: edit | entornos | Implementado |
| proyectos | proyectos.datasets | Datasets | QA_LEAD: edit | entorno datasets | Implementado |
| proyectos | proyectos.wiki | Wiki | QA_LEAD/TESTER: edit | wiki | Implementado |
| inventario | inventario.ambientes | Ambientes | QA_LEAD: edit | inventario UI | UI protegido |
| inventario | inventario.dispositivos | Dispositivos | QA_LEAD: edit | dispositivos | Implementado |
| inventario | inventario.nodos | Nodos | QA_LEAD: edit | nodos | Implementado parcial |
| inventario | inventario.categorias | Categorias | ADMIN: edit | catalogos UI | UI protegido |
| reportes | reportes.ver | Ver metricas | VIEWER: read | metrics/dashboard | Implementado |
| reportes | reportes.exportar | Exportar | QA_LEAD: read | export/reportes | UI protegido |
| reportes | reportes.compartir | Compartir | QA_LEAD: read | reports/share | Implementado |
| bugs | bugs.ver | Ver bugs | VIEWER: read | bugs list/detail/summary | Implementado |
| bugs | bugs.crear | Crear bugs | QA_LEAD/TESTER: edit | `POST /bugs/`, `POST /snapshots/{id}/bugs/` | Implementado |
| bugs | bugs.editar | Editar bugs | QA_LEAD/TESTER: edit | `PATCH /bugs/{id}` | Implementado |
| bugs | bugs.triage | Triage y estados | QA_LEAD: edit | transitions/duplicates | Implementado |
| bugs | bugs.asignar | Asignar responsables | QA_LEAD: edit | campo `asignado_a` | Implementado parcial |
| bugs | bugs.comentar | Comentar | QA_LEAD/TESTER: edit | bug_comments | Implementado |
| bugs | bugs.adjuntos | Adjuntar evidencia | QA_LEAD/TESTER: edit | bug_attachments + attachments | Implementado |
| bugs | bugs.vincular_externo | Vincular tracker externo | QA_LEAD: edit | external_issue_links | Implementado |
| bugs | bugs.exportar | Exportar markdown | QA_LEAD: read | external-preview | Implementado |
| bugs | bugs.admin | Administrar bug tracker | ADMIN: edit | configuracion futura | Catalogo |
| motor_ia | motor_ia.ver | Ver estado | QA_LEAD: read | health | Implementado |
| motor_ia | motor_ia.configuracion | Configuracion | QA_LEAD: edit | ai-engine/config | Implementado |
| motor_ia | motor_ia.workflows | Workflows | QA_LEAD: edit | ai-workflows | Implementado parcial |
| motor_ia | motor_ia.logs | Logs | QA_LEAD: read | traces/report | Implementado parcial |
| motor_ia | motor_ia.scheduler | Scheduler | QA_LEAD: edit | scheduler IA | Pendiente |
| redmine | redmine.ver | Ver | QA_LEAD: read | redmine config | Pendiente |
| redmine | redmine.configuracion | Configurar | QA_LEAD: edit | redmine config | Implementado parcial |
| redmine | redmine.reportar | Reportar | QA_LEAD: edit | reporte Redmine | Pendiente |
| redmine | redmine.vinculos | Vinculos issue/snapshot | QA_LEAD: read | bugs/vinculos | Pendiente |
| integraciones | integraciones.catalogo | Catalogo | QA_LEAD: read | registry integraciones | Implementado |
| integraciones | integraciones.ver_estado | Ver estado | QA_LEAD: read | estado provider | Catalogo |
| integraciones | integraciones.test_conexion | Probar conexion | QA_LEAD: read | test conexion futuro | Catalogo |
| integraciones | integraciones.configurar | Configurar | ADMIN: edit | configuracion provider | Catalogo |
| integraciones | integraciones.secretos | Gestionar secretos | ADMIN: edit | secretos separados | Catalogo |
| integraciones | integraciones.webhooks | Webhooks | ADMIN: edit | webhook_events | Catalogo |
| integraciones | integraciones.auditoria | Auditoria | ADMIN: read | auditoria provider | Catalogo |
| integraciones | integraciones.provider.redmine.ver | Redmine ver | QA_LEAD: read | alias redmine legacy | Implementado |
| integraciones | integraciones.provider.redmine.configurar | Redmine configurar | ADMIN: edit | redmine config | Implementado parcial |
| integraciones | integraciones.provider.redmine.reportar | Redmine reportar | QA_LEAD: edit | bug tracker V2 | Catalogo |
| integraciones | integraciones.provider.redmine.vincular | Redmine vincular | QA_LEAD: edit | external_issue_links | Catalogo |
| integraciones | integraciones.provider.jira.ver | Jira ver | QA_LEAD: read | provider planificado | Catalogo |
| integraciones | integraciones.provider.jira.configurar | Jira configurar | ADMIN: edit | provider planificado | Catalogo |
| integraciones | integraciones.provider.jira.reportar | Jira reportar | QA_LEAD: edit | bug tracker V2 | Catalogo |
| integraciones | integraciones.provider.github_issues.ver | GitHub Issues ver | QA_LEAD: read | provider planificado | Catalogo |
| integraciones | integraciones.provider.github_issues.configurar | GitHub Issues configurar | ADMIN: edit | provider planificado | Catalogo |
| integraciones | integraciones.provider.github_issues.reportar | GitHub Issues reportar | QA_LEAD: edit | bug tracker V2 | Catalogo |
| plugins | plugins.catalogo | Catalogo plugins | QA_LEAD: read | registry plugins | Implementado |
| plugins | plugins.instalar | Instalar plugins | ADMIN: edit | marketplace V3 | Catalogo |
| plugins | plugins.desinstalar | Desinstalar plugins | ADMIN: edit | marketplace V3 | Catalogo |
| plugins | plugins.habilitar | Habilitar plugins | ADMIN: edit | marketplace V3 | Catalogo |
| plugins | plugins.configurar | Configurar plugins | ADMIN: edit | provider config V3 | Catalogo |
| plugins | plugins.gestionar_secretos | Gestionar secretos plugins | ADMIN: edit | secretos separados | Catalogo |
| plugins | plugins.auditoria | Auditoria plugins | ADMIN: read | auditoria V3 | Catalogo |
| plugins | plugins.provider.junit_importer.importar_resultados | Importar JUnit/XML | QA_LEAD: edit | plugin planificado | Catalogo |
| plugins | plugins.provider.excel_importer.importar_casos | Importar Excel | QA_LEAD: edit | plugin planificado | Catalogo |
| plugins | plugins.provider.custom_dashboard.agregar_widget | Agregar widget | ADMIN: edit | plugin planificado | Catalogo |
| plugins | plugins.provider.ai_case_generator.generar_casos | Generar casos IA | QA_LEAD: edit | plugin planificado | Catalogo |
| notificaciones | notificaciones.ver | Ver notificaciones | VIEWER: read | inbox/campana | Implementado |
| notificaciones | notificaciones.inbox | Bandeja personal | VIEWER: read | inbox usuario | Implementado |
| notificaciones | notificaciones.configuracion | Configuracion SMTP | ADMIN: edit, QA_LEAD: read | SMTP AppSetting | Implementado |
| notificaciones | notificaciones.reglas | Reglas | ADMIN: edit, QA_LEAD: read | notification_rules | Implementado |
| notificaciones | notificaciones.plantillas | Plantillas | ADMIN: edit, QA_LEAD: read | notification_templates | Implementado |
| notificaciones | notificaciones.auditoria | Auditoria | ADMIN: edit, QA_LEAD: read | events/deliveries | Implementado |
| notificaciones | notificaciones.admin | Administracion | ADMIN: edit | processor/retry | Implementado |
| historial | historial.ver | Ver historial | VIEWER: read | historial runs | UI protegido |
| historial | historial.detalle | Detalle | VIEWER: read | detalle ejecucion | UI protegido |
| historial | historial.evidencias | Evidencias | VIEWER: read | evidencias | UI protegido |
| configuracion | configuracion.preferencias | Preferencias | Usuario: read/edit propio | tab Configuracion | UI protegido |
| configuracion | configuracion.perfil | Mi Perfil | Usuario: edit propio | profile | UI protegido |
| configuracion | configuracion.clientes | Clientes / Soluciones | ADMIN: edit | clientes | UI protegido |
| configuracion | configuracion.usuarios | Gestion Usuarios | ADMIN: edit | usuarios | Implementado |
| configuracion | configuracion.roles | Roles | ADMIN: edit | roles | Implementado |
| configuracion | configuracion.integraciones | Integraciones | ADMIN: edit | tab integraciones | UI protegido |
| configuracion | configuracion.pruebas_ia | Pruebas con IA | QA_LEAD: read | tab IA | UI protegido |
| configuracion | configuracion.api_keys | API keys | Usuario: edit propio | `/users/me/api-keys` | Implementado |
| configuracion | configuracion.sesion | Sesion y seguridad | ADMIN: edit | session-config | Implementado |
| configuracion | configuracion.adjuntos | Adjuntos y evidencias | ADMIN: edit | attachments config | Implementado parcial |
