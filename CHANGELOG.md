# Treseko 1.0.7

## Integridad y actualización segura

- La consulta del canal Premium informa correctamente que la instalación está actualizada, sin mostrarlo como un error.
- Fija `jsonschema` en 4.26.0 para que reconstruir el backend durante una actualización Premium no seleccione una dependencia 4.x diferente.
- Corrige la verificación de releases inmutables anteriores cuando cambia el filtro de archivos entre versiones. El updater valida los hashes registrados por el manifiesto original y sigue rechazando cambios o archivos inesperados.
- Permite verificar y actualizar instalaciones existentes desde 1.0.6 sin confundir los archivos históricos excluidos por el árbol actual.
- Valida la cadena de configuración spool, puente y controlador, junto con sus mounts, antes de instalar el helper de actualización coordinada.
- Acepta el prefijo `/` que la guía documenta para instalaciones reales, manteniendo bloqueadas las demás rutas amplias.
- Monta el directorio de control dedicado dentro del backend coordinado para que la barrera de admisión funcione durante actualizaciones.


## Correcciones y actualización Premium

- La actualización Premium `1.0.7` se distribuye por `premium-stable` para instalaciones `1.0.6`; Community continúa en `1.0.6`.
- Historias y casos: conserva alcance, aclaraciones y reglas al reintentar; mejora la revisión de supuestos y propuestas antes de aplicarlas y evita perder escenarios por límites implícitos.
- Actualizaciones Compose: incorpora la aplicación atómica del árbol completo, con preservación de configuración y volúmenes, comprobación de servicios y recuperación transaccional.
- Worker y Motor IA: conserva las rutas persistentes de ejecución y la compatibilidad con instalaciones anteriores durante la actualización.
- MCP: mantiene la resolución compatible durante la transición para no interrumpir a los asistentes conectados.


## Corrección de mantenimiento

- Corrige el contador de mantenimiento y conserva el tiempo límite cuando vence aunque el servidor siga reiniciando.

## Asistentes y MCP

- El catálogo MCP reúne 65 herramientas para consultar y gestionar flujos de QA. Cada herramienta sigue su alcance, los permisos del usuario y las confirmaciones requeridas.
- Los asistentes pueden explorar sitios públicos accesibles y registrar requisitos, historias, casos y resultados manuales observados. Los casos automatizados compatibles se ejecutan mediante el worker de Treseko.

## Historias, casos y suites

- La generación conserva el alcance, las aclaraciones y los criterios de aceptación; agrega trazabilidad y revisión antes de aplicar propuestas.
- Mejora la recuperación ante respuestas incompletas y errores del proveedor, y conserva las preguntas pendientes al continuar una generación.
- Las suites protegen los cambios, facilitan restaurar y ordenar carpetas, copian solo versiones vigentes y respetan las builds activas al archivar casos.

## Ejecución, seguimiento e informes

- El guardado de ejecuciones recupera avances y evita duplicados. El historial mejora paginación, filtros y consulta de evidencias para formatos API y conversacional.
- Bug Tracker y Centro de Incidencias mejoran filtros, borradores, permisos y vínculos entre bugs duplicados. Proyectos e inventario conservan mejor el contexto y las relaciones de sus datos.
- Los informes distinguen ejecuciones en curso de resultados finales, conservan el contexto al actualizar y corrigen métricas y exportaciones.

## Motor IA

- La programación resiste errores temporales y envíos duplicados, y conserva las tareas al proteger una build.
- La evaluación de IA exige evidencia para afirmar estados, incluido un carrito vacío, y comprueba el objetivo y el efecto tras recuperar un clic. Las puntuaciones de confianza se identifican como internas y no calibradas.

## Instalación, seguridad y privacidad

- El Plugin Runner conserva la versión de la release al reconstruirse durante una actualización atómica.
- Mantiene la compatibilidad con instalaciones Docker 1.0.6 durante la actualización del runtime: conserva el resolver MCP anterior y guarda temporalmente la evidencia en volúmenes persistentes ya existentes.
- El actualizador local atómico aplica el Compose completo de la release con respaldos de volúmenes y rollback. En Premium 1.0.6, primero se instala el bridge 1.0.7 según la guía de actualización; después Configuración → Actualizaciones aplica la release completa.
- El manifest principal marca el árbol Compose completo; el helper 1.0.6 rechaza ese flujo antes de cambiar servicios. Se genera un paquete de bootstrap por componentes, con checksum y firma propios, para instalar primero el bridge 1.0.7.
- El paquete completo conserva las seis plantillas `.env*.example` de la release y excluye las configuraciones `.env` locales, para que la actualización no omita ejemplos ni copie secretos.
- El staging del bridge conserva las plantillas `.env*.example` dentro del árbol público y sigue rechazando archivos `.env` locales y marcadores de identidad.
- El coordinador exige que Plugin Runner pase su healthcheck antes de activar una release Compose completa.
- El coordinador de actualización verifica la release activa y rechaza candidatas más antiguas antes de modificar servicios o datos.
- Corrige los permisos de lectura de recursos estáticos al instalar paquetes extraídos con permisos restrictivos.
- El coordinador detiene con `SIGTERM` el frontend heredado de 1.0.6 y el frontend actual reenvía `SIGQUIT` a Nginx para cerrar limpiamente al detener el Compose.
- Retira temporalmente los instaladores gráficos. Se mantienen los scripts de instalación para Bash y PowerShell.
- Actualiza Handlebars del worker a 4.7.10, que incluye una corrección de seguridad para versiones anteriores.
- El ping de instalación es opcional y permanece desactivado por defecto.

# Treseko 1.0.6

Esta versión reúne las mejoras acumuladas desde Treseko 1.0.2. Al actualizar,
encontrarás nuevas formas de probar, organizar y compartir el trabajo de QA, con
controles más claros para administrar el equipo y mantener la instalación.

## Nuevas herramientas de prueba

- Creá y ejecutá pruebas de API con variables, validaciones y resultados
  registrados junto con la evidencia.
- Prepará pruebas conversacionales con varios turnos y revisá sus respuestas,
  tiempos y resultados en el contexto del caso.
- Usá asistencia de IA para redactar y mejorar requisitos, historias y casos; las
  propuestas quedan disponibles para revisar antes de aplicarlas.
- Configurá perfiles de IA y elegí modelos y flujos de trabajo según la tarea.

## Organización y seguimiento

- Consultá reportes ejecutivos y de equipo que conservan una vista compartible
  de los resultados, con opciones para revocar o dejar vencer el acceso.
- Seguí la relación entre requisitos, historias, casos, ejecuciones y bugs con
  más contexto y trazabilidad.
- Administrá organizaciones, integrantes, roles y permisos con controles más
  claros sobre las funciones disponibles.
- Consultá la Wiki y el inventario de activos desde la plataforma cuando estén
  habilitados para tu edición.
- Usá la automatización con workers registrados, estado visible y controles para
  evitar asignar trabajo a workers inactivos o revocados.

## Integraciones y experiencia de uso

- Conectá herramientas compatibles mediante funciones de integración gobernadas
  y permisos explícitos para consultar o modificar información.
- Encontrá mejoras de navegación, evidencias, adjuntos, reportes y uso en
  pantallas de distintos tamaños.
- La interfaz está disponible en español, inglés y portugués.

## Actualizaciones y seguridad

- Las actualizaciones preparan y verifican los componentes antes de activarse;
  si una actualización falla durante el proceso, se conserva una ruta de
  recuperación con respaldo.
- La versión nueva se confirma solo después de que los componentes hayan
  iniciado y pasado sus comprobaciones.
- Se reforzaron la protección de datos sensibles, la validación de conexiones y
  la administración de credenciales y permisos.
- Los resultados desconocidos de automatización ya no se presentan como pruebas
  aprobadas.
