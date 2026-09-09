# Guía de automatización

**Automatización** centraliza workers, funciones reutilizables y códigos de
integración para el proyecto seleccionado.

Hay dos caminos distintos:

- El **Automation Worker unificado** ejecuta trabajos preparados por Treseko,
  incluidos casos clásicos y casos API declarativos.
- La **API externa** recibe resultados de un runner ejecutado fuera de Treseko.
  No inicia trabajos ni es otro worker.

## Requisitos

Seleccioná solución y proyecto. Para ejecutar contra una build, seleccioná también una build activa. Las opciones visibles dependen de tus permisos y de la edición instalada.

## Workers

Un worker recibe trabajos de ejecución automatizada y devuelve resultados a Treseko.

1. Abrí **Automatización**.
2. Revisá el estado y el último heartbeat del worker.
3. Iniciá el worker local con su configuración aprobada y vinculalo mediante el código de la pantalla cuando tengas permiso de edición.
4. Confirmá que quede **online** antes de enviar pruebas automatizadas.

Community permite un worker local por solución. La administración distribuida de varios workers y el scheduler requieren las capacidades correspondientes.

## Funciones reutilizables

En **Biblioteca de Funciones Automatizadas** podés crear funciones compartidas por casos. Documentá su propósito, parámetros y efecto esperado. Antes de eliminar o modificar una función, revisá qué scripts la utilizan.

## Códigos para automatización externa

La sección también ofrece el contexto necesario para conectar un runner o servicio externo. La API se autentica con una API key creada desde **Configuración → Preferencias → API keys de automatización externa**.

Seguí la [guía de automatización externa](API_USAGE_GUIDE.md) para crear la key y reportar los resultados de manera segura.

## Evidencia y snapshots

Los trabajos automatizados se ejecutan con una definición congelada de caso,
build, ambiente, dataset y variables. En API se conserva el resultado
`treseko.api-result/v1`, con límites de tiempo/tamaño y variables sensibles
separadas de la evidencia visible.
