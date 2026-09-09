# Treseko

## 1.0.3 — Release de plataforma

### Actualización desde 1.0.2

### Mejoras

- Se separan el formato del caso y la modalidad de ejecución para evitar que
  un caso conversacional, API o clásico se envíe al flujo equivocado.
- El historial, la trazabilidad y los reportes conservan mejor el vínculo entre
  solución, proyecto, componente, build, suite, caso, ejecución y bug.
- El dashboard y los estados de ejecución muestran diagnósticos más claros,
  bloqueos distinguibles y recuperación guiada cuando corresponde.
- Se amplían RBAC, capacidades por edición, temas, conexiones y configuración
  para que las funciones habilitadas sean visibles y auditables.

### Nueva funcionalidad

- Casos API con contrato declarativo, variables, aserciones y ejecución manual,
  automatizada o asistida por IA.
- Capacidad `treseko-api/declarative` en el Automation Worker existente; no se
  introduce un worker API separado.
- Casos conversacionales con endpoint, perfiles, datasets, turnos, memoria,
  herramientas, evaluación y evidencia persistida.
- Contextos de evidencia y bugs para pruebas API y conversacionales, además del
  flujo clásico.
- Informes ejecutivo, de desarrollo e interno mediante snapshots compartibles,
  con bugs de la build actual e historial de pendientes.

### Correcciones

- Las migraciones `20260812_0045` y `20260812_0046` agregan de forma idempotente
  el formato de caso, conservan los casos existentes y normalizan el nombre
  final a `CLASICA`; se ejecutan automáticamente durante el arranque del
  actualizador.
- El dashboard muestra un mensaje legible y permite reintentar si una API aún
  no está disponible durante la actualización.

### Seguridad y datos

- Las evidencias API y conversacionales aplican límites y redacción antes de
  persistirse o exportarse.
- Las configuraciones de casos conversacionales quedan congeladas durante la
  ejecución para conservar una evidencia reproducible.
- Los snapshots de reportes son fotografías del estado de una build: compartir
  un informe no reescribe el historial operativo.

## 1.0.2 — Release de plataforma

### Mejoras

- Trazabilidad, evidencias, reportes y ejecuciones con contexto más consistente.
- Historial de calidad y riesgo de release más claro para comparar builds.

### Nueva funcionalidad

- Análisis de estabilidad, bloqueos y pruebas inestables con revisión humana.
- Diagnósticos y recomendaciones de calidad con evidencia asociada.

### Correcciones

- Actualizaciones con validación de versiones, backups, health checks y
  recuperación ante fallos.
- Migraciones aditivas verificadas en instalaciones nuevas y existentes.

### Seguridad

- Evidencias y diagnósticos redactados antes de persistirse o mostrarse.
- Auditoría y recuperación reforzadas para conservar la integridad de los datos.

## 1.0.1 — Actualizador preparado para futuras migraciones

- Contrato documentado para planes de actualización, hooks y rollback.
- Validación automática de la versión instalada del frontend.
- Protección contra sobrescritura por imágenes antiguas.
- Backups, health checks y limpieza posterior definidos para futuras actualizaciones.

## 1.0.1-rc.4 — Compatibilidad de actualización Premium

- Actualizaciones más confiables, con verificación del paquete y recuperación ante inconvenientes.
- Historial de actualizaciones más claro después de reiniciar la instalación.
- Primer acceso e instalación Community más simples y consistentes.
- Importación y portabilidad de casos con más formatos, plantillas y diagnósticos.
- Trazabilidad ampliada entre requisitos, historias, casos, ejecuciones, evidencias y bugs.
- Reportes y métricas de build mejorados para acompañar decisiones de release.
- Automatización e IA con mejores evidencias y seguimiento de resultados.
- Mejoras en permisos, configuración, notificaciones y administración.
- Preparación de funciones Premium, renovación de licencias y gestión de suscripciones.
- Compatibilidad del cliente con los metadatos firmados de facturación y upgrades de licencias Premium.
- Corrección de las rutas de consulta y descarga de actualizaciones Premium para servidores configurados con dominio base.
- Actualizaciones Premium aplicables desde instalaciones 1.0.0 y RC anteriores compatibles.

Este resumen describe las funciones y mejoras operativas disponibles para los
usuarios. No incluye detalles internos de implementación.

## 1.0.0-rc.1

Esta versión incorpora mejoras principales respecto de la RC anterior:

- Importación, exportación y reversión auditable de casos de prueba.
- Trazabilidad entre requisitos, historias, casos, ejecuciones y evidencias.
- Generación asistida de historias y casos de prueba con revisión humana.
- Ejecución manual, automatizada y asistida por IA desde un mismo flujo QA.
- Bug Tracker con contexto de ejecución, evidencias y vínculos externos.
- Reportes y métricas de build con cobertura de trazabilidad.
- Workers de automatización vinculados por código temporal.
- Permisos granulares, configuraciones de IA y límites por edición.
- Actualización Community con verificación, backup, migraciones y estado final
  consistente de la versión instalada.

Esta es la versión estable de Treseko Community para uso productivo.
