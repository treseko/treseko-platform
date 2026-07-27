# Datos, persistencia y respaldos

Treseko guarda los datos operativos en una base de datos relacional y los
archivos adjuntos en almacenamiento persistente. Esta guía ayuda a comprender
qué se conserva y cómo preparar una operación segura.

## Qué información conserva Treseko

| Área | Información principal |
|---|---|
| Organización y proyectos | Soluciones, proyectos, componentes, builds, equipos, ambientes y datasets. |
| Diseño de pruebas | Suites, casos, versiones, pasos, requisitos, historias y vínculos. |
| Ejecución | Runs, resultados por caso, snapshots de pasos, observaciones y duración. |
| Calidad | Bugs, comentarios, estados, vínculos externos y métricas. |
| Administración | Usuarios, roles, permisos, preferencias, auditoría y licencias. |
| Evidencias | Metadatos de adjuntos y la ubicación de los archivos asociados. |

## Cómo se conserva el historial

Cuando ejecutás un caso, Treseko guarda una instantánea de los pasos, datos y
resultado esperado. Por eso el historial conserva el contexto utilizado aunque
el caso se edite más adelante.

Los cambios operativos importantes, como modificaciones de usuarios, roles,
bugs y configuraciones, quedan disponibles para auditoría según los permisos
del usuario.

## Alcance de una build

Una build define qué casos pueden ejecutarse y reportarse. Antes de iniciar una
ejecución automatizada o externa, verificá que el caso esté activo y asignado a
la build correspondiente.

## Respaldos recomendados

Realizá una copia antes de actualizar Treseko, cambiar de servidor o ejecutar
una importación importante:

1. Respaldá la base de datos PostgreSQL.
2. Respaldá el volumen o directorio de adjuntos.
3. Guardá de forma protegida los archivos de configuración y secretos de
   despliegue, sin incluirlos en repositorios.
4. Probá la restauración en una instancia aislada antes de depender del backup.

La restauración debe recuperar base de datos y adjuntos del mismo momento para
que las evidencias sigan vinculadas correctamente.

## Mantenimiento

- Usá migraciones incluidas con la versión de Treseko al actualizar la base de
  datos.
- No edites registros directamente salvo que sigas un procedimiento técnico
  validado y tengas un backup recuperable.
- Revisá el almacenamiento de evidencias y los límites de la edición antes de
  permitir cargas masivas.

## Ayuda rápida

| Situación | Qué revisar |
|---|---|
| Un resultado histórico no coincide con el caso actual | Consultá el snapshot de la ejecución; el caso pudo cambiar después. |
| No se puede reportar un caso en una build | Confirmá que el caso esté activo y dentro del alcance de esa build. |
| Falta una evidencia tras restaurar | Verificá que se restauró también el almacenamiento de adjuntos. |
| Una actualización falla | Restaurá el backup probado y revisá las migraciones de la versión instalada. |
