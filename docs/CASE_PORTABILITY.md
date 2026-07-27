# Importar y exportar suites y casos

Treseko permite trasladar o respaldar suites y casos desde la sección
**Proyectos → Importar / Exportar**. La exportación oficial usa paquetes
`.tcases`; la importación admite además perfiles compatibles para otros formatos.

## Exportar casos

1. Abrí el proyecto y entrá a **Importar / Exportar**.
2. Seleccioná **Exportar**.
3. En el selector elegí suites completas, casos individuales o una combinación.
4. Revisá la selección y confirmá la exportación.
5. Guardá el archivo `.tcases` en una ubicación segura.

Al marcar una suite se incluyen los casos que contiene. Podés abrirla para
revisar la selección antes de descargar.

## Importar casos

1. Abrí **Importar / Exportar** en el proyecto de destino.
2. Seleccioná **Importar** y elegí el archivo.
3. Elegí el perfil de origen cuando el formato lo requiera.
4. Usá la vista previa para revisar suites, casos, advertencias y campos que no
   puedan trasladarse.
5. Confirmá los elementos que querés incorporar.
6. Revisá el lote reciente para comprobar el resultado o revertirlo dentro de
   la ventana disponible.

La vista previa no modifica el proyecto. La reversión solo afecta al lote de
importación elegido y no deshace cambios posteriores hechos manualmente.

## Recomendaciones

- Exportá un paquete antes de una importación masiva.
- Probá primero con una suite pequeña cuando el archivo viene de otra
  herramienta.
- Revisá los pasos, prioridades y vínculos después de importar.
- Conservá los archivos originales hasta validar el lote.

Consultá la [compatibilidad de importación](CASE_IMPORT_COMPATIBILITY.md) para
conocer el estado de cada perfil.
