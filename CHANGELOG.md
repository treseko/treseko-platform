# Treseko 1.0.7

- MCP: amplía el flujo gobernado para que asistentes puedan descubrir las funciones disponibles, recorrer sitios públicos autorizados y registrar cambios y resultados con evidencia persistida.
- Historias y casos: conserva aclaraciones, criterios, trazabilidad y revisión antes de aplicar propuestas.
- Suites, historial, ejecución y reportes: mejora guardados recuperables, paginación, evidencia por formato y cálculo de resultados.
- Instalación: los instaladores gráficos de escritorio se retiran temporalmente del paquete; se mantienen los scripts Bash y PowerShell.
- Privacidad: el ping de instalación es opcional y permanece desactivado salvo activación explícita del administrador.

# Treseko 1.0.6

- La exportación PDF mantiene las tablas dentro de la página. Las funciones de prueba Playwright conservan capturas finales y vídeos, y la evidencia excluye archivos internos del worker. La comprobación de perfiles IA distingue disponibilidad, JSON y visión.

- Reportes y Métricas: errores Chatbot consistentes, predecesor cronológico real, filtros de evidencia completos, navegación de todo el detalle, historial con recuperación y protección de contexto, expectativas exportables y tiempos con muestras explícitas.

- Ejecución: guardado de avance manual, protección ante respuestas tardías, restauración parcial, errores de historial visibles, contexto Chatbot congelado y cifrado, aprobación con todos los turnos, métricas corregidas y monitor API secuencial.

Esta versión reúne las mejoras acumuladas desde Treseko 1.0.2. Al actualizar,
encontrarás nuevas formas de probar, organizar y compartir el trabajo de QA, con
controles más claros para administrar el equipo y mantener la instalación.

## Nuevas herramientas de prueba

- La generación de historias y casos respeta la espera total configurada hasta dos horas, sin recortarla a quince minutos; cada llamada conserva el límite del perfil.

- La planificación de casos conserva hasta 20 escenarios antes de elegir cuántos generar, evitando perder el sexto escenario por un límite implícito de cinco.

- La continuación automática exige supuestos LOW completos y sin preguntas. La generación respeta los límites del perfil activo y cancela solicitudes al proveedor cuando el backend se desconecta.

- Los reintentos de generación de historias y casos conservan el alcance, las aclaraciones y las reglas originales. Los supuestos de riesgo medio o incompletos no se aceptan automáticamente como de bajo riesgo. La pantalla indica que las preguntas pendientes deben responderse antes de continuar. El analizador distingue hechos confirmados, dudas necesarias y capacidades fuera de alcance.

- Generación de historias y casos más confiable: conserva aclaraciones, comprueba fuentes vigentes y protege el guardado y la revisión de propuestas.
- Creá y ejecutá pruebas de API con variables, validaciones y resultados
  registrados junto con la evidencia.
- Prepará pruebas conversacionales con varios turnos y revisá sus respuestas,
  tiempos y resultados en el contexto del caso.
- Usá asistencia de IA para redactar y mejorar requisitos, historias y casos; las
  propuestas quedan disponibles para revisar antes de aplicarlas.
- Configurá perfiles de IA y elegí modelos y flujos de trabajo según la tarea.

## Organización y seguimiento

- Los editores API y conversacional, el resumen de workflows y el explorador de suites se adaptan al ancho disponible del panel para evitar controles o textos recortados.

- El editor de pasos adapta columnas al ancho del panel y muestra botones solo con iconos cuando falta espacio, conservando sus descripciones accesibles.

- Suites: restauración que conserva estados anteriores, destinos y permisos más claros, guardado protegido y ordenamiento de carpetas.

- El historial distingue el estado de cada caso del resultado global del run,
  muestra las pruebas IA en curso, las capturas por URL y los tiempos por
  solicitud API. Los filtros aplicados quedan visibles y crear bugs desde
  informes respeta los permisos del usuario y del proyecto.

- El guardado de casos conserva la prueba al reintentar vínculos fallidos y evita
  creaciones duplicadas. Las referencias se reemplazan por paso sin perder
  evidencias previas, las copias de suites incluyen solo versiones vigentes y
  el archivado respeta las builds activas en todas las rutas.

- El Historial de Ejecuciones incorpora páginas y totales, conserva los filtros
  al actualizar y muestra observaciones y evidencia API o conversacional.
  Los errores permiten reintentar y la vista móvil facilita abrir el detalle.

- El Centro de Incidencias conserva borradores entre pestañas, recupera los
  comentarios y accesos relacionados, y muestra acciones según los permisos.
- La solución del bug y la resolución de pantalla se guardan por separado.
  La bandeja permite priorizar y filtrar desde los indicadores, también en móvil.


- La creación de proyectos conserva el formulario ante errores y evita envíos
  simultáneos. Las organizaciones vacías mantienen su selección y las respuestas
  antiguas de casos o suites no reemplazan el contexto del proyecto actual.
- Los componentes con contenido y las builds con ejecuciones no se eliminan;
  el historial conserva sus referencias. Las builds se pueden ocultar.

- El Bug Tracker permite recorrer todos los bugs, ordenar por prioridad o
  antigüedad y consultar indicadores que respetan los filtros seleccionados.
- La edición conserva los cambios pendientes al comentar o cambiar de estado,
  muestra el historial y permite vincular duplicados al bug principal según
  los permisos y la edición disponibles.
- El listado de bugs ofrece filtros desplegables y filas legibles en móvil.

- Los proyectos pueden compartir nombre entre soluciones distintas; se validan
  los nombres vacíos y los duplicados dentro de una misma solución.
- Los listados de proyectos, componentes y builds cargan todos los registros,
  y los cambios rápidos de proyecto conservan la selección correcta.
- Se refuerzan los límites al crear, importar, reactivar o trasladar proyectos,
  y las notificaciones de cierre y reapertura.
- El inventario conserva categorías por proyecto, guarda los activos y sus
  endpoints juntos y permite consultar sus detalles con permiso de lectura.
- Se evita que cambios rápidos de proyecto mezclen listados de inventario y
  que las relaciones entre activos formen ciclos.

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

- Se corrigió la instalación desde una base vacía y la conexión inicial de los
  workers cuando el servidor tarda en responder.

- Las actualizaciones preparan y verifican los componentes antes de activarse;
  si una actualización falla durante el proceso, se conserva una ruta de
  recuperación con respaldo.
- La versión nueva se confirma solo después de que los componentes hayan
  iniciado y pasado sus comprobaciones.
- Se reforzaron la protección de datos sensibles, la validación de conexiones y
  la administración de credenciales y permisos.
- Los resultados desconocidos de automatización ya no se presentan como pruebas
  aprobadas.

### AI engine evidence guards / Guardas de evidencia del motor IA

- Claims and empty carts require cited evidence; coordinate recovery refreshes and checks its target and outcome. Internal scores show provenance and remain uncalibrated until reviewed samples are available.
- Afirmaciones y carritos vacios requieren evidencia citada; la recuperacion por coordenadas actualiza y comprueba objetivo y resultado. Las puntuaciones internas registran origen y permanecen sin calibrar hasta disponer de muestras revisadas.

### Programación IA / AI scheduling

- Reintento de fallos temporales, conservación de programaciones al proteger la build, prevención de doble envío y cancelación resistente a respuestas antiguas. Las tareas de mantenimiento ya no bloquean el scheduler ante un fallo aislado.
- Temporary failures retry; build protection preserves schedules; double submission and stale cancellation responses are guarded. Independent maintenance failures no longer block scheduling.

### Correcciones de reportes y métricas

- Los reportes conservan el proyecto y la build seleccionados al recibir respuestas tardías, y permiten reintentar errores de carga.
- La cobertura distingue resultados finales de ejecuciones en curso; se conservan métricas de versiones anteriores y se corrige el P95 de respuesta.
- Las exportaciones PDF y Excel evitan repetir datos de casos fuera de la tabla.
