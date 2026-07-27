# Guía de proyectos

Un proyecto reúne el trabajo de QA de un producto o iniciativa: sus
componentes, builds, ambientes, casos, ejecuciones, evidencias y trazabilidad.
Esta guía propone un orden para configurarlo y dejarlo listo para trabajar.

## Antes de crear un proyecto

Verificá que estés trabajando dentro de la **Solución** correcta. La solución
agrupa los proyectos de una organización o cliente. Si necesitás crear o
administrar soluciones, pedí acceso a **Configuración → Clientes / Soluciones**.

También necesitás permisos de edición en Proyectos. Si no aparece la opción de
crear o editar, un administrador debe revisar tu rol.

## 1. Crear el proyecto

1. Abrí **Proyectos**.
2. Escribí el nombre en **Nuevo proyecto**.
3. Seleccioná **Crear**.
4. Abrí el proyecto recién creado.
5. Entrá a **Configuración y equipo** para completar su descripción, estado y
   responsables.

Usá un nombre que identifique el producto o iniciativa. Evitá crear un proyecto
por cada build: las builds se administran dentro del proyecto.

## 2. Configuración y equipo

En **Configuración y equipo** podés actualizar el nombre, la descripción, el
estado y las personas que participan del proyecto.

- Usá **Activo** mientras el equipo trabaja normalmente.
- Usá **En QA** cuando el foco esté en validar una entrega.
- Usá **Bloqueado**, **En pausa** o **Mantenimiento** para comunicar una
  condición operativa especial.
- Usá **Cerrado** o **Archivado** al finalizar, sin perder el historial.

Definí responsables que puedan mantener componentes, builds y alcance de
ejecución. Consultá [Estados de proyecto](PROJECT_STATUS_RESTRICTIONS.md) para
elegir el estado adecuado.

## 3. Componentes y builds

Abrí **Componentes y Builds** para separar las partes del producto y las
entregas que vas a validar.

1. Creá los componentes, por ejemplo `Frontend`, `API` o `Aplicación móvil`.
2. Dentro de cada componente, creá una build con una versión o nombre legible.
3. Definí el alcance de la build: los casos que se podrán ejecutar y reportar.
4. Activá la build cuando esté lista para validación.

Una build es el contexto de una entrega. Asigná solo los casos que correspondan
a esa versión; así los resultados, bugs y reportes conservan un alcance claro.

## 4. Ambientes y datasets

En **Ambientes y Datasets** registrá dónde se ejecutarán las pruebas y con qué
datos.

- Un ambiente identifica el destino, por ejemplo `QA`, `Staging` o Producción
  controlada.
- Un dataset describe la información preparada para una ejecución, por ejemplo
  cuentas de prueba, catálogo o condiciones iniciales.

Seleccioná el ambiente y dataset al ejecutar una prueba. No cargues contraseñas
reales ni secretos en los datos visibles del proyecto.

## 5. Requisitos e historias

Abrí **Requisitos e Historias** para mantener la relación entre el objetivo
funcional y los casos de prueba.

1. Registrá el requisito.
2. Agregá las historias y criterios de aceptación.
3. Vinculá los casos que verifican cada historia.
4. Revisá los vínculos cuando cambie una historia.

Podés usar IA para proponer historias o casos, pero revisá y seleccioná las
propuestas antes de guardarlas. Consultá [Trazabilidad y generación asistida]
(TRACEABILITY.md) para conocer el flujo completo.

## 6. Wiki, tickets e incidencias

- En **Wiki / Documentación**, creá páginas Markdown para acuerdos, guías del
  proyecto, decisiones y enlaces útiles. Cada página conserva historial.
- En **Tickets e Incidencias**, registrá o vinculá incidencias del proyecto
  cuando tengas la integración y permisos habilitados.

No uses la Wiki para guardar API keys, contraseñas o secretos. Para defectos
detectados durante una ejecución, preferí [Bug Tracker](BUG_TRACKER.md), que
conserva el contexto QA completo.

## 7. Importar y exportar casos

Abrí **Importar / Exportar** para incorporar suites y casos, descargar un
respaldo `.tcases` o revertir un lote reciente dentro de la ventana disponible.

Antes de una importación masiva, exportá un respaldo y revisá la vista previa.
Consultá [Importar y exportar suites y casos](CASE_PORTABILITY.md) para el
paso a paso y los formatos compatibles.

## Orden recomendado para empezar

```text
Solución → Proyecto → Equipo → Componentes → Builds → Ambientes/Datasets
→ Suites y casos → Alcance de build → Ejecución → Reportes
```

No necesitás completar todas las subsecciones el primer día. Empezá con un
proyecto, un componente, una build activa y un conjunto pequeño de casos; luego
ampliá ambientes, trazabilidad, documentación e integraciones según el equipo.

## Ayuda rápida

| Situación | Qué revisar |
|---|---|
| No puedo crear un proyecto o una build | Tu rol y el estado de la solución/proyecto. |
| Un caso no aparece al ejecutar | Que esté activo y dentro del alcance de la build seleccionada. |
| No veo una subsección | Los permisos de Proyectos, trazabilidad, Wiki o integraciones. |
| Una historia cambió | Revisá los vínculos con casos antes de confiar en su cobertura. |
| Necesito mover casos a otro proyecto | Exportalos como `.tcases` e importalos desde el proyecto destino. |
