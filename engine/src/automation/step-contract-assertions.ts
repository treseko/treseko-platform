import type {
  BrowserElementSnapshot,
  BrowserObservation,
  QAEngineStep,
  StepAssertion,
  StepAssertionResult,
  StepContract,
  StrictAIAction,
} from './action-types.ts';

import { normalizeText, parseStepData } from './step-contract-base.ts';

function assertionId(step: QAEngineStep, index: number): string {
  return `step-${step.number}-assertion-${index + 1}`;
}

function splitExpectation(value: string): string[] {
  return value
    .split(/(?:\s+y\s+|;|\n)/i)
    .map((item) => item.trim().replace(/[.!]+$/g, ''))
    .filter(Boolean);
}

function addAssertion(assertions: StepAssertion[], step: QAEngineStep, assertion: Omit<StepAssertion, 'id'>): void {
  const fingerprint = JSON.stringify([assertion.type, assertion.target, assertion.expected, assertion.alternatives]);
  if (assertions.some((item) => JSON.stringify([item.type, item.target, item.expected, item.alternatives]) === fingerprint)) return;
  assertions.push({ id: assertionId(step, assertions.length), ...assertion });
}

function parseExplicitAssertions(step: QAEngineStep, assertions: StepAssertion[], recognized: string[]): void {
  const data = parseStepData(step.data);
  const mappings: Array<{ keys: string[]; type: StepAssertion['type']; target?: string }> = [
    { keys: ['expected_text', 'texto_esperado'], type: 'text_contains' },
    { keys: ['expected_url', 'url_esperada'], type: 'url_matches' },
    { keys: ['status_code', 'http_status'], type: 'http_status' },
    { keys: ['expected_count', 'cantidad_esperada'], type: 'element_count', ...(data.count_target || data.objeto ? { target: data.count_target || data.objeto } : {}) },
  ];
  for (const { keys, type, target } of mappings) {
    const key = keys.find((candidate) => Object.prototype.hasOwnProperty.call(data, candidate));
    if (!key) continue;
    const raw = data[key] ?? '';
    addAssertion(assertions, step, {
      type,
      source: `${key}=${raw}`,
      ...(target ? { target } : {}),
      expected: type === 'http_status' || type === 'element_count' ? Number(raw) : raw,
      ...(type === 'element_count' ? { comparator: 'equals' as const } : {}),
    });
    recognized.push(`${key}=${raw}`);
  }
  for (const [key, value] of Object.entries(data)) {
    if (!key.startsWith('json.')) continue;
    addAssertion(assertions, step, { type: 'json_field_equals', source: `${key}=${value}`, target: key.slice(5), expected: value });
    recognized.push(`${key}=${value}`);
  }
}

function parseExpectationFragment(step: QAEngineStep, fragment: string, assertions: StepAssertion[]): boolean {
  const normalized = normalizeText(fragment);
  const quoted = Array.from(fragment.matchAll(/["'“”]([^"'“”]{2,160})["'“”]/g)).map((match) => String(match[1]).trim());
  if (quoted.length) {
    quoted.forEach((value) => addAssertion(assertions, step, { type: 'text_contains', source: fragment, expected: value }));
    return true;
  }

  const status = normalized.match(/(?:status(?: code)?|codigo http)\s*[:=]?\s*(\d{3})/);
  if (status?.[1]) {
    addAssertion(assertions, step, { type: 'http_status', source: fragment, expected: Number(status[1]) });
    return true;
  }

  // Natural-language URL suffixes are common in imported test cases and are
  // deterministic to verify without asking the auditor to infer them.
  const urlSuffix = normalized.match(/(?:url|direccion|pagina)\s+(?:termina|finaliza|acaba)\s+(?:en|con)\s+([\w./-]+)/);
  if (urlSuffix?.[1]) {
    addAssertion(assertions, step, { type: 'url_matches', source: fragment, expected: urlSuffix[1].replace(/[.,;:]+$/g, '') });
    return true;
  }

  const urlContains = normalized.match(/(?:url|direccion|pagina)\s+(?:contiene|incluye)\s+([\w./-]+)/);
  if (urlContains?.[1]) {
    addAssertion(assertions, step, { type: 'url_matches', source: fragment, expected: urlContains[1].replace(/[.,;:]+$/g, '') });
    return true;
  }

  // Do not infer JSON fields from ordinary URLs such as inventory-item.html.
  // A JSON assertion is only valid when the expectation explicitly refers to
  // a JSON response/document.
  const jsonFields = /\b(?:json|respuesta)\b/.test(normalizeText(step.expected))
    ? Array.from(normalized.matchAll(/\b(status|items?|environment)\s*(?:es|=|:)?\s*([\w.-]+)/g))
    : [];
  if (jsonFields.length) {
    for (const match of jsonFields) {
      if (!match[1] || !match[2]) continue;
      const field = match[1] === 'item' ? 'items' : match[1];
      addAssertion(assertions, step, {
        type: 'json_field_equals',
        source: fragment,
        target: field,
        expected: match[2].replace(/[.,;:]+$/g, ''),
      });
    }
    return true;
  }

  const row = normalized.match(/fila de\s+([\w@.-]+).*?(?:indicar|mostrar|contener|dice|estado)\s+(.+)$/);
  if (row?.[1] && row[2]) {
    addAssertion(assertions, step, {
      type: 'element_contains',
      source: fragment,
      target: row[1],
      expected: row[2].trim(),
    });
    return true;
  }

  const count = normalized.match(/\b(\d+)\s+(productos?|filas?|items?|elementos?|imagenes?)\b/);
  if (count?.[1] && count[2]) {
    addAssertion(assertions, step, { type: 'element_count', source: fragment, target: count[2].replace(/s$/, ''), expected: Number(count[1]), comparator: 'equals' });
    return true;
  }

  if (/(imagenes?).*(cargan|cargadas|sin errores|ninguna.*rota)/.test(normalized)) {
    addAssertion(assertions, step, { type: 'images_loaded', source: fragment });
    return true;
  }
  if (/(titulo).*(obligatorio|required)|(?:obligatorio|required).*(titulo)/.test(normalized)) {
    addAssertion(assertions, step, { type: 'field_required', source: fragment, target: 'titulo' });
    return true;
  }
  if (/opcion alta.*seleccionada|alta queda seleccionada/.test(normalized)) {
    addAssertion(assertions, step, { type: 'option_selected', source: fragment, target: 'severity', expected: 'high' });
    return true;
  }
  if (/control.*marcado|queda marcado|confirmar datos.*activ/.test(normalized)) {
    addAssertion(assertions, step, { type: 'checkbox_checked', source: fragment, target: 'confirm' });
    return true;
  }
  const button = normalized.match(/boton\s+(.+?)(?:\s+esta\s+habilitado|\s+habilitado|\s+visible|$)/);
  if (button && button[1]) {
    addAssertion(assertions, step, {
      type: /habilitado/.test(normalized) ? 'button_enabled' : 'element_visible',
      source: fragment,
      target: button[1].trim(),
    });
    return true;
  }
  if (/(formulario).*(visible|disponible)|(?:visible|disponible).*(formulario)/.test(normalized)) {
    addAssertion(assertions, step, { type: 'element_visible', source: fragment, target: 'formulario' });
    return true;
  }
  if (/(error|invalid|incorrect).*(credencial|usuario|password|contrasena)|(?:credencial|usuario|password|contrasena).*(error|invalid|incorrect)/.test(normalized)) {
    addAssertion(assertions, step, {
      type: 'text_contains_any', source: fragment,
      alternatives: ['invalid', 'incorrect', 'error', 'invalido', 'invalida', 'incorrecto', 'incorrecta'],
    });
    return true;
  }
  if (/(no se ingreso|no ingresar|fuera).*(area segura|secure area)/.test(normalized)) {
    addAssertion(assertions, step, { type: 'url_not_matches', source: fragment, expected: '/secure' });
    return true;
  }

  const visibleContent = normalized.match(/(?:mostrar(?:se)?|muestra|contener|contiene|aparece|verse|visualiza(?:rse)?|informa(?:r)?|indicar)\s+(.+)$/);
  if (visibleContent?.[1]) {
    const expected = visibleContent[1]
      .replace(/^(?:inmediatamente\s+)?(?:el|la|los|las)\s+/, '')
      .replace(/^(?:exactamente\s+)?(?:el|la|los|las)?\s*(?:titulo|mensaje|nombre)\s+/, '')
      .trim();
    const wordCount = expected.split(/\s+/).filter(Boolean).length;
    if (expected.length >= 3 && wordCount <= 10 && !/\s+o\s+/.test(expected)) {
      addAssertion(assertions, step, { type: 'text_contains', source: fragment, expected });
      return true;
    }
  }
  return false;
}

export function buildStepContract(step: QAEngineStep): StepContract {
  if (step.validation_plan) {
    const assertions = step.validation_plan.assertions.map((item, index) => ({
      ...item,
      id: assertionId(step, index),
    }));
    const isDomPlan = step.validation_plan.mode === 'dom' && assertions.length > 0;
    return {
      version: 1,
      step_number: step.number,
      assertions,
      recognized_fragments: isDomPlan ? [step.validation_plan.reason] : [],
      unresolved_fragments: isDomPlan ? [] : (step.expected ? [step.expected] : []),
      coverage: isDomPlan ? 'full' : 'none',
      requires_semantic_audit: !isDomPlan,
    };
  }
  const assertions: StepAssertion[] = [];
  const recognizedFragments: string[] = [];
  const unresolvedFragments: string[] = [];
  parseExplicitAssertions(step, assertions, recognizedFragments);
  for (const fragment of splitExpectation(String(step.expected || ''))) {
    if (parseExpectationFragment(step, fragment, assertions)) recognizedFragments.push(fragment);
    else unresolvedFragments.push(fragment);
  }
  const coverage: StepContract['coverage'] = assertions.length === 0
    ? 'none'
    : unresolvedFragments.length === 0 ? 'full' : 'partial';
  return {
    version: 1,
    step_number: step.number,
    assertions,
    recognized_fragments: recognizedFragments,
    unresolved_fragments: unresolvedFragments,
    coverage,
    requires_semantic_audit: coverage !== 'full',
  };
}
