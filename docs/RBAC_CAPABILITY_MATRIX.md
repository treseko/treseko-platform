# Capacidades y permisos

Esta referencia ayuda a los administradores a decidir qué acceso asignar. Las
capacidades se aplican mediante roles y permisos de módulo; no es necesario
configurar identificadores técnicos manualmente.

| Área | Capacidades habituales | Recomendación |
|---|---|---|
| Proyectos | Portafolio, componentes, builds, equipo, ambientes, datasets, wiki, requisitos e historias | QA Lead para editar; Tester para consultar o colaborar según el rol. |
| Casos | Suites, casos, pasos, versiones, adjuntos, scripts y trazabilidad | QA Lead y Tester con edición cuando diseñan pruebas. |
| Ejecución | Ejecución manual, automatizada, IA, evidencias e historial | QA Lead y Tester según el método autorizado. |
| Automatización | Workers, jobs, validación y funciones reutilizables | QA Lead o un rol técnico específico. |
| Reportes | Métricas, exportación, compartir y trazabilidad | Lectura para quienes toman decisiones; edición solo cuando corresponda. |
| Bugs | Crear, editar, asignar, comentar, adjuntar, triage y vínculos externos | Tester para reportar; QA Lead para triage y asignación. |
| Configuración | Preferencias, perfil, usuarios, roles, licencia, IA y API keys | Administración restringida; cada usuario administra sus propias API keys. |
| Notificaciones | Bandeja personal, reglas, plantillas, SMTP y auditoría | Usuarios para bandeja; administrador para configuración. |

## Aplicar el menor privilegio necesario

- Otorgá **Lector** si la persona solo necesita consultar información.
- Otorgá **Editor** solo si debe crear, cambiar o administrar recursos.
- Separá los roles de ejecución de los roles de configuración global.
- Revisá los permisos luego de cambios de equipo o responsabilidades.

Si una acción no aparece pese a tener acceso al módulo, revisá la edición,
licencia, estado del proyecto y permisos específicos con un administrador.
