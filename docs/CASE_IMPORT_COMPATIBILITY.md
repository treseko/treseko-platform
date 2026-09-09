# Compatibilidad de importación de casos

Elegí el perfil de importación según la herramienta que generó el archivo. La
extensión por sí sola no garantiza compatibilidad: cada perfil interpreta sus
columnas, pasos y campos de forma específica.

| Perfil | Formato | Estado | Recomendación |
|---|---|---|---|
| `treseko/tcases-v1` | `.tcases` | Estable | Usalo para respaldos y traslados entre proyectos Treseko. |
| `treseko/legacy-project-v1` | JSON histórico guardado como `.treseko` o `.json` | Estable | Importa exportaciones antiguas, incluidas suites anidadas, códigos, versiones y pasos. Revisá los diagnósticos para campos que el formato anterior no tenía. |
| `csv/structured-v1` | CSV Treseko | Estable | Usalo con la plantilla CSV oficial. |
| `testlink/xml-v1` | XML | Beta | Revisá siempre la vista previa y las advertencias. |
| `xray/json-v1`, `qase/json-v1` | JSON | Beta | La extensión debe coincidir con el perfil seleccionado. |
| `testrail/xml-v1`, `testrail/csv-v1` | XML o CSV | Beta | Elegí el perfil exacto según la exportación. |
| `xray/csv-v1`, `azure-test-plans/csv-v1`, `practitest/csv-v1`, `qase/csv-v1` | CSV | Beta | Revisá columnas y vista previa. |
| `zephyr/json-v1`, `zephyr/xml-v1` | JSON o XML | Beta | Elegí el perfil exacto según el producto Zephyr. |
| `qtest/excel-v1` | XLS o XLSX | Beta | Revisá la vista previa antes de confirmar. |
| `gherkin/feature-v1` | `.feature` | Beta | Revisá pasos y etiquetas después de importar. |
| `postman/collection-v2.1` | JSON | Beta | Importa configuración declarativa; los scripts externos no se ejecutan automáticamente. |
| `zephyr/csv-v1` | CSV | Bloqueado | No está disponible para importar todavía. |

Los IDs de perfil son parte del contrato; no uses sólo el nombre de la
herramienta. Los perfiles estables son `treseko/tcases-v1`,
`treseko/legacy-project-v1` y `csv/structured-v1`; los demás perfiles
habilitados se consideran Beta.

## Elegir un perfil

1. Abrí **Proyectos → Importar / Exportar → Importar**.
2. Seleccioná el archivo.
3. Elegí el perfil que corresponda a su origen.
4. Revisá la vista previa antes de confirmar.

La vista previa indica campos ignorados, diferencias y posibles pérdidas de
información. Los perfiles **Beta** pueden requerir ajustes manuales después de
la importación. Los perfiles **Bloqueados** se muestran para informar su
estado, pero no se pueden usar.

Los adjuntos binarios viajan únicamente en `.tcases`. En otros formatos Treseko
puede conservar referencias, pero no archivos que no estén incluidos en el
origen.
