import type { QAEngineStep } from './action-types.ts';
import { parseStepData } from './step-contract-base.ts';

export function semanticEvidenceRequirement(step: QAEngineStep): string | undefined {
  const data = { ...parseStepData(step.action), ...parseStepData(step.data) };
  const claim = data.expected_false_claim || data.afirmacion_falsa || data.false_claim || data.claim_falso;
  if (claim) return `Evaluar la afirmacion completa, incluidas negaciones y relaciones: ${claim}. Citar evidencia que la respalde o contradiga; palabras dispersas no prueban su veracidad.`;
  const expected = String(step.expected || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
  if (/no\s+se\s+muestran\s+productos.*(?:carrito|lista)|(?:carrito|lista).*sin\s+productos|(?:carrito|lista).*vaci[oa]|(?:empty).*(?:cart|list)|(?:cart|list).*empty/.test(expected)) {
    return 'Comprobar que el carrito o lista termino de cargar, que no hay error ni indicador de carga, y citar evidencia positiva de vacio: contador cero, contenedor sin filas identificado o mensaje explicito de vacio. La ausencia de botones Remove no prueba un carrito vacio.';
  }
  return undefined;
}
