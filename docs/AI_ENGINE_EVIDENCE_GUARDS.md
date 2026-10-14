# Evidencia y puntuación interna del motor IA

## Afirmaciones y estados vacíos

Una afirmación configurada mediante `expected_false_claim`, `afirmacion_falsa`,
`false_claim` o `claim_falso` exige evaluar su significado completo con evidencia.
La presencia de palabras dispersas no decide su veracidad. Se conserva como
expectativa pendiente del auditor, incluso si hay un plan anterior de validación.
Los contratos explícitos existentes para texto, URL, campos y JSON siguen disponibles.

Una expectativa de carrito o lista vacía exige comprobar que la vista terminó de
cargar, que no hay error o indicador de carga y que existe evidencia positiva:
contador cero, contenedor identificado sin filas o mensaje explícito de vacío.
La ausencia de botones `Remove` no genera una aserción concluyente. El auditor
recibe estos requisitos y debe citar evidencia de ese paso. Si falta evidencia,
el resultado queda bloqueado para revisión; un modelo sin visión no confirma
este estado automáticamente.

## Recuperación de clics

Al recuperar un clic inválido se obtiene una observación y una captura nuevas.
El objetivo debe existir en la observación anterior y tener una identidad visible
única en la nueva, con la misma URL y sin señales de carga. Se recalcula el punto
con su caja actual. Antes del clic se comprueba mediante `elementFromPoint` que
el punto sigue dentro del objetivo y no está cubierto. Si desaparece, es ambiguo
o cambia la página, se rechaza la recuperación y se replantea el paso.

Después del clic se comprueba el resultado esperado. Si el contrato no demuestra
el efecto, el paso queda bloqueado para revisión y no se repite el clic en ese
intento. Estas restricciones se aplican a la conversión de `click` en `click_at`;
las acciones visuales `click_at` solicitadas directamente conservan su contrato.

## Puntuación y calibración

Los campos históricos `confidence` se mantienen para compatibilidad. Son
puntuaciones internas de 0 a 100, no probabilidades medidas. El motor registra
`confidence_source` (`rules` o `model`) y `confidence_calibration=uncalibrated`.
El informe incorpora `confidence_assessment`, el origen del consenso y los
componentes por paso. El valor del paso procede de la acción terminal; el informe
final usa el valor del consenso. No se promedian reglas y autoevaluaciones del
modelo para construir el resultado final. Los dashboards históricos muestran
sus promedios como puntuaciones internas sin calibrar.

Para medir la relación con resultados comprobados:

```bash
cd engine
node --import tsx src/calibrate-internal-scores.ts reviewed-scores.json > calibration.json
```

La entrada es un array de ejecuciones revisadas independientemente, con campos:
`execution_id`, `source`, `model`, `workflow_version`, `score`, `predicted_status`,
`reviewed_status`, `reviewed_by` y `evidence_refs` no vacío. Los estados admitidos
son `PASO`, `FALLO` y `BLOQUEADO`. La revisión debe comprobar la evidencia original;
el programa valida la estructura y no autentica al revisor.

El programa rechaza muestras incompletas o duplicadas. Agrupa por origen, modelo,
versión del workflow y bandas de puntuación; devuelve tamaño de muestra, acuerdo
observado con la revisión e intervalo de Wilson del 95 %. No aplica la curva al
runtime ni cambia los veredictos. No equivale a probabilidad de que una prueba
pase: mide acuerdo con el dictamen revisado en las muestras aportadas. Una
calibración representativa requiere muestras reales de aciertos y errores,
reservar ejecuciones para evaluación y revisar nuevamente al cambiar modelo o
workflow. Hasta disponer de esa evidencia, la UI mantiene «sin calibrar».
