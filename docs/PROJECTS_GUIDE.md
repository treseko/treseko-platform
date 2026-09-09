# Guía de proyectos

Un proyecto reúne componentes, builds, ambientes, datasets, suites, casos,
ejecuciones, evidencias y trazabilidad.

```text
Solución → Proyecto → Componentes → Builds → Ambientes/Datasets → Casos
```

## Antes de crear un proyecto

Verificá que estés dentro de la **Solución** correcta. La solución agrupa
proyectos relacionados. Si no ves la acción para crear o editar, necesitás que
un administrador revise tu rol y permisos.

## 1. Crear el proyecto

1. Abrí **Proyectos**.
2. Elegí **Nuevo proyecto**.
3. Completá un nombre legible y una descripción si corresponde.
4. Seleccioná **Crear**.
5. Abrí **Configuración y equipo** para completar estado, responsables e
   identidad visual.

No crees un proyecto por cada build: las builds representan entregas dentro del
mismo proyecto y permiten comparar resultados sin perder historial.

## 2. Configuración y equipo

En **Configuración y equipo** podés mantener nombre, descripción, estado, logo
o identidad visual y miembros. El rol global no equivale automáticamente a
todas las capacidades del proyecto; el acceso efectivo depende también del
permiso específico. Si necesitás revisar el modelo de acceso, pedí a un
administrador que confirme tu rol y capacidades.

## 3. Componentes y builds

1. En **Componentes y Builds**, creá componentes como `Frontend`, `API` o
   `Aplicación móvil`.
2. Creá una build con un nombre o versión identificable.
3. Definí el alcance de build-caso.
4. Activá la build cuando esté lista para validar.

Una build histórica conserva su contexto para consulta y comparación. No la
trates como activa: sus casos, configuración, trazabilidad y ejecución no deben
modificarse desde ese contexto.

## 4. Ambientes y datasets

Un **ambiente** define dónde se conecta la prueba y un **dataset** define los
datos preparados. Evitá secretos reales.

- clásica usa pasos, datos y resultados esperados;
- `API` usa contrato declarativo y aserciones;
- `CONVERSACIONAL` usa endpoint, perfil, variables, turnos, expectativas,
  memoria, herramientas y evaluación;
- `PERFORMANCE` es reservado: no asumas un ejecutor de carga ni copies la
  configuración de API o Chatbot.

Consultá [Casos de prueba](TEST_CASES_GUIDE.md) y [Ejecución](TEST_EXECUTION_GUIDE.md).

## 5. Requisitos e historias

1. Abrí **Requisitos e Historias**.
2. Registrá requisitos, historias y criterios de aceptación.
3. Vinculá los casos que cubren cada historia.
4. Revisá y confirmá los vínculos cuando una historia cambie.

La IA propone contenido: no publica automáticamente historias, casos ni
scripts. Consultá [Trazabilidad y generación asistida](TRACEABILITY.md).

## 6. Wiki, tickets e incidencias

Usá **Wiki / Documentación** para acuerdos y decisiones, nunca para secretos.
Usá [Bug Tracker](BUG_TRACKER.md) para defectos detectados durante pruebas y
el [Centro de Incidencias](INCIDENT_CENTER_GUIDE.md) para el seguimiento
operativo centralizado. Las integraciones externas dependen de la instalación y
permisos; no crean tickets externos por defecto.

## 7. Importar y exportar casos

Antes de importar, exportá un respaldo y revisá la vista previa. Consultá
[Compatibilidad de importadores](CASE_IMPORT_COMPATIBILITY.md) y las
instrucciones de respaldo disponibles en tu instalación.

## Orden recomendado para empezar

```text
Solución → Proyecto → Equipo → Componentes → Builds → Ambientes/Datasets
→ Suites y casos → Alcance de build → Ejecución → Historial → Reportes
```

## Ayuda rápida

| Situación | Qué revisar |
|---|---|
| No puedo crear o editar | Rol, permiso y estado del proyecto. |
| Una build no aparece | Que esté activa y el caso esté dentro de su alcance. |
| Un caso no aparece | Estado, suite, build y filtros. |
| Una build histórica no permite editar | Es un contexto de consulta. |
| Una historia cambió | Revisá y confirmá sus vínculos. |
| Necesito mover casos | Exportá `.tcases`, revisá advertencias e importá en destino. |
