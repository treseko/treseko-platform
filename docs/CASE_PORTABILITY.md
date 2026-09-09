# Importar y exportar suites y casos

La portabilidad se administra desde Proyectos → Importar / Exportar y requiere
la capability de provider. La exportación nativa usa
treseko.test-cases-package/v1 y extensión .tcases.

## Paquete nativo

Incluye manifiesto y suites.json, cases.json, versions.json y attachments.json.
El manifiesto conserva checksums SHA-256 y se verifican antes de crear registros;
los adjuntos también se validan. Los casos conservan códigos estables,
versiones, datasets, metadatos de automatización, configuración API/Chatbot y
vínculos de trazabilidad soportados.

## Paquetes históricos `.treseko`

Las exportaciones de proyectos antiguos de Treseko eran JSON y a menudo se
guardaban con extensión `.treseko`. Importalas con el perfil
`treseko/legacy-project-v1`. Se reconstruyen suites anidadas, códigos,
versiones y pasos; los campos que el formato histórico no tenía se completan
con valores compatibles y se informan en el diagnóstico. No confundas este
paquete de casos con `license.treseko`, que es un archivo de licencia y no
contiene casos de prueba.

## Perfiles

| Perfil | Extensión | Estado |
|---|---|---|
| treseko/tcases-v1 | .tcases | Estable |
| treseko/legacy-project-v1 | .treseko, .json | Estable; compatibilidad histórica |
| csv/structured-v1 | .csv | Estable |
| testlink/xml-v1 | .xml | Beta |
| xray/json-v1, xray/csv-v1 | .json, .csv | Beta |
| zephyr/json-v1, zephyr/xml-v1 | .json, .xml | Beta |
| zephyr/csv-v1 | .csv | Bloqueado; sin fixture validado |
| azure-test-plans/csv-v1 | .csv | Beta |
| qtest/excel-v1 | .xls, .xlsx | Beta |
| practitest/csv-v1 | .csv | Beta |
| testrail/xml-v1, testrail/csv-v1 | .xml, .csv | Beta |
| qase/json-v1, qase/csv-v1 | .json, .csv | Beta |
| gherkin/feature-v1 | .feature | Beta |
| postman/collection-v2.1 | .json | Beta |

Beta no significa compatibilidad universal. Revisá vista previa y diagnósticos.
La carga máxima es 20 MB. Extensión incorrecta, checksum inválido o perfil
bloqueado detienen la importación.

## Importar

1. Abrí Importar / Exportar en el proyecto destino.
2. Elegí perfil y archivo.
3. Revisá duplicados, nuevas versiones, advertencias y campos no trasladables.
4. Seleccioná elementos y confirmá.
5. Revisá el lote.

La vista previa no modifica. La importación guarda referencias externas y hashes
para detectar duplicados y nuevas versiones. No ejecuta scripts arbitrarios.

## Reversión

Un lote completado puede revertirse durante una hora si los casos no tienen
ejecuciones ni cambios posteriores. No deshace cambios manuales y puede
rechazarse si el lote ya fue usado o modificado.

## Recomendaciones

- Respaldá base y adjuntos antes de importar masivamente.
- Probá con un archivo pequeño.
- Revisá pasos, formato CLASICA/API/CONVERSACIONAL, prioridades y vínculos.
- Consultá el estado del perfil en la aplicación.
