# Compatibilidad de importación de casos

Elegí el perfil de importación según la herramienta que generó el archivo. La
extensión por sí sola no garantiza compatibilidad: cada perfil interpreta sus
columnas, pasos y campos de forma específica.

| Perfil | Formato | Estado | Recomendación |
|---|---|---|---|
| `treseko/tcases-v1` | `.tcases` | Estable | Usalo para respaldos y traslados entre proyectos Treseko. |
| `csv/structured-v1` | CSV Treseko | Estable | Usalo con la plantilla CSV oficial. |
| TestLink, TestRail, Xray, Azure Test Plans, Qase, PractiTest, qTest, Zephyr y Gherkin | CSV, XML, JSON, XLSX o `.feature` | Beta | Revisá siempre la vista previa y las advertencias. |
| `zephyr/csv-v1` | CSV | En revisión | No está disponible para importar todavía. |

## Elegir un perfil

1. Abrí **Proyectos → Importar / Exportar → Importar**.
2. Seleccioná el archivo.
3. Elegí el perfil que corresponda a su origen.
4. Revisá la vista previa antes de confirmar.

La vista previa indica campos ignorados, diferencias y posibles pérdidas de
información. Los perfiles **Beta** pueden requerir ajustes manuales después de
la importación. Los perfiles **En revisión** se muestran para informar su
estado, pero no se pueden usar.

Los adjuntos binarios viajan únicamente en `.tcases`. En otros formatos Treseko
puede conservar referencias, pero no archivos que no estén incluidos en el
origen.
