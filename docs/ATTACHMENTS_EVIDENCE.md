# Adjuntos y evidencias

Fecha: 2026-06-20

## Alcance v1

Esta version agrega adjuntos binarios sin guardar archivos en Base64 dentro de la base de datos.

Hay dos usos distintos:

- Referencia de paso: archivos que forman parte de la definicion del caso de prueba. Ejemplos: imagen de accion e imagen esperada.
- Evidencia de ejecucion: archivos producidos durante una ejecucion. Ejemplos: screenshot, foto, PDF o log asociado a un snapshot.

La exportacion/importacion de binarios queda para una version posterior.

## Almacenamiento

Los archivos se guardan en filesystem local bajo:

```text
backend/app/static/attachments/{sha256[0:2]}/{sha256[2:4]}/{sha256}.{ext}
```

La base de datos guarda solo metadata:

- `attachments`: archivo, tipo MIME, tamano, SHA-256, ruta local, URL publica, scope y usuario creador.
- `paso_attachments`: vincula un attachment a un paso con tipo `ACTION_REFERENCE` o `EXPECTED_REFERENCE`.
- `snapshot_attachments`: vincula un attachment a un snapshot con tipo `SCREENSHOT`, `PHOTO`, `PDF`, `LOG` u `OTHER`.

El hash SHA-256 permite evitar duplicados fisicos. Si dos usuarios suben el mismo archivo, puede reutilizarse el mismo contenido fisico.

## Compatibilidad legacy

Se mantiene lectura de campos anteriores:

- `PasoPrueba.metadata_ai.actionImg`
- `PasoPrueba.metadata_ai.expectedImg`
- `SnapshotPaso.evidencia_url`

El flujo nuevo usa `Attachment` y tablas puente.

## Configuracion admin

Ruta UI:

```text
Configuracion > Preferencias > Adjuntos y evidencias
```

Valores configurables:

- `allowed_mime_types`
- `max_file_size_mb`
- `max_files_per_step`
- `max_files_per_snapshot`
- `enable_clipboard_paste`
- `require_evidence_on_failure`

La validación real se hace siempre en backend.

Defaults:

- PNG, JPG/JPEG, WEBP, GIF, PDF y TXT.
- Maximo 10 MB.
- Maximo 5 archivos por paso.
- Maximo 10 archivos por snapshot.
- Clipboard paste activo.
- Evidencia obligatoria al fallar desactivada.

## Endpoints

### Configuracion

```http
GET /attachments/config/
PATCH /attachments/config/
```

Requieren `configuracion:read` y `configuracion:edit`.

### Subida de archivo

```http
POST /attachments/?scope=CASE_STEP_REFERENCE
POST /attachments/?scope=EXECUTION_EVIDENCE
```

Body multipart:

```text
file=<binary>
```

Respuesta:

```json
{
  "id": "uuid",
  "filename_original": "captura.png",
  "content_type": "image/png",
  "size": 12345,
  "sha256": "...",
  "storage_path": "app/static/attachments/...",
  "public_url": "/static/attachments/...",
  "scope": "EXECUTION_EVIDENCE",
  "created_by": "uuid",
  "created_at": "2026-06-20T..."
}
```

### Referencias de pasos

```http
POST /pasos/{paso_id}/attachments/
GET /pasos/{paso_id}/attachments/
DELETE /pasos/{paso_id}/attachments/{attachment_id}/
```

Tipos soportados:

```text
ACTION_REFERENCE
EXPECTED_REFERENCE
```

Requieren permisos del módulo `crear_pruebas`.

### Evidencias de snapshots

```http
POST /snapshots/{snapshot_id}/attachments/
GET /snapshots/{snapshot_id}/attachments/
DELETE /snapshots/{snapshot_id}/attachments/{attachment_id}/
```

Tipos soportados:

```text
SCREENSHOT
PHOTO
PDF
LOG
OTHER
```

Requieren permisos del módulo `ejecutar`.

## UI

En `Anadir Pruebas`, cada paso puede tener:

- Imagen de accion.
- Imagen esperada.

En `Ejecutar Pruebas`, cada snapshot puede tener evidencias adjuntas. Se soporta:

- Botón de subida.
- Pegado de imagen con `Ctrl + V` cuando la configuracion lo permite.
- Vista de imagen o archivo adjunto.

En `Historial Detallado`, `Historial Runs` y `Reportes y Métricas`, las evidencias se muestran desde las relaciones `snapshot_attachments`.

- Imagenes: miniatura y ampliacion.
- PDF/log/otros: botón para abrir el archivo.
- Si no hay attachments nuevos, se mantiene compatibilidad con `SnapshotPaso.evidencia_url`.

Cuando el frontend corre en Vite (`localhost:5173`), las URLs publicas `/static/...` se consumen como `/api/static/...` para pasar por el proxy al backend.

## Reportes

`GET /proyectos/{proyecto_id}/metrics/` devuelve:

- `por_suite`: agrupacion plana compatible con versiones anteriores.
- `por_suite_tree`: arbol suite -> subsuite con totales agregados.
- `casos[].evidencias`: attachments de la ultima ejecucion del caso en la build seleccionada.
- `casos[].suite_breadcrumb`: ruta legible de carpeta, por ejemplo `Suite / Subsuite`.

La pantalla de reportes usa `por_suite_tree` para evitar que las subsuites aparezcan como suites raíz.

## Historial de ejecuciones

`GET /casos/{caso_id}/historial` devuelve:

- `evidencia_url`: primer adjunto o URL legacy, para compatibilidad.
- `evidencias`: lista completa de attachments asociados a los snapshots de esa ejecucion.

`GET /proyectos/{proyecto_id}/test-runs/` devuelve un resumen real de runs con conteos por estado y evidencias agregadas del run.

## Export/import futuro

Para exportar binarios se recomienda un ZIP:

```text
package.zip
  manifest.json
  assets/
    attachments/
      ab/cd/{sha256}.png
```

`manifest.json` debe incluir:

- casos y pasos;
- attachments por `sha256`;
- relaciones `paso_attachments`;
- ejecuciones/snapshots;
- relaciones `snapshot_attachments`;
- rutas relativas en `assets/`.

Al importar, el sistema debe reconstruir las tablas puente y evitar duplicar archivos si ya existe el SHA-256.
