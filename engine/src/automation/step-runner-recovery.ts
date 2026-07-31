import type { Page } from 'playwright';
import type { BrowserObservation, ExecutionCheckpoint, QAEngineStep, StepContract, StrictAIAction, StructuredHistoryItem } from './action-types.ts';
import { normalizeUrl } from './action-executor.ts';
import { observeBrowser } from './observation.ts';
import { buildStepContract, evaluateStepContract, parseStepData, stepDataValue } from './step-contract.ts';
import { interpretStepData } from './context-data-interpreter.ts';
import { normalizeText, observationCorpus, expectsDynamicResults, evidenceTerms, hasDynamicResultEvidence } from './step-runner-helpers.ts';

export function extractKeyValue(step: QAEngineStep, keys: string[]): string {
  return stepDataValue(step, keys);
}

export function extractExpectedFalseClaim(step: QAEngineStep): string {
  return extractKeyValue(step, ['expected_false_claim', 'afirmacion_falsa', 'false_claim', 'claim_falso']);
}

export function findSearchInput(observation: BrowserObservation): string {
  const candidates = observation.elements.filter((element) => {
    if (!element.visible || element.disabled || !element.editable) return false;
    const corpus = normalizeText([
      element.role,
      element.name,
      element.label,
      element.placeholder,
      element.title,
      element.type,
    ].filter(Boolean).join(' '));
    return element.role === 'searchbox'
      || element.type === 'search'
      || /(search|buscar|busqueda|consulta|query)/.test(corpus);
  });
  return candidates[0]?.ref || observation.elements.find((element) => element.visible && !element.disabled && element.editable)?.ref || '';
}

export function findCredentialField(observation: BrowserObservation, kind: 'username' | 'password'): string {
  const candidates = observation.elements.filter((element) => {
    if (!element.visible || element.disabled || !element.editable) return false;
    const corpus = normalizeText([
      element.role,
      element.name,
      element.label,
      element.placeholder,
      element.title,
      element.type,
    ].filter(Boolean).join(' '));
    if (kind === 'password') return element.type === 'password' || /password|contrase/.test(corpus);
    return element.type !== 'password' && /(username|usuario|email|login|user)/.test(corpus);
  });
  if (candidates[0]?.ref) return candidates[0].ref;
  const fallback = observation.elements.find((element) => (
    element.visible
    && !element.disabled
    && element.editable
    && (kind === 'password' ? element.type === 'password' : element.type !== 'password')
  ));
  return fallback?.ref || '';
}

export function wordsForMatch(value: string): string[] {
  return normalizeText(value)
    .replace(/[^a-z0-9]+/g, ' ')
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 3);
}

export function findPreferredResultTarget(observation: BrowserObservation, preferred: string): string {
  const words = wordsForMatch(preferred);
  if (!words.length) return '';
  const candidates = observation.elements.filter((element) => {
    if (!element.visible || element.disabled || (!element.clickable && element.role !== 'link')) return false;
    const corpus = normalizeText([
      element.role,
      element.name,
      element.label,
      element.text,
      element.value,
      element.placeholder,
      element.title,
    ].filter(Boolean).join(' '));
    return words.every((word) => corpus.includes(word));
  });
  return candidates[0]?.ref || '';
}

export function preferredWikipediaUrl(currentUrl: string, preferred: string): string {
  if (!preferred || !/wikipedia\.org/i.test(currentUrl)) return '';
  try {
    const url = new URL(currentUrl);
    const slug = preferred.trim().replace(/\s+/g, '_');
    return `${url.origin}/wiki/${encodeURIComponent(slug).replace(/%28/g, '(').replace(/%29/g, ')')}`;
  } catch {
    return '';
  }
}

export function deterministicRecoveryAction(step: QAEngineStep, observation: BrowserObservation): StrictAIAction | null {
  const text = normalizeText(`${step.action || ''} ${step.data || ''} ${step.expected || ''}`);
  const expectedFalseClaim = extractExpectedFalseClaim(step);
  if (expectedFalseClaim) {
    const corpus = observationCorpus(observation);
    const claimWords = wordsForMatch(expectedFalseClaim);
    const claimLooksSupported = claimWords.length > 0 && claimWords.every((word) => corpus.includes(word));
    const action: StrictAIAction = {
      action: claimLooksSupported ? 'finish' : 'fail',
      value: expectedFalseClaim,
      reason: claimLooksSupported
        ? `La afirmacion negativa "${expectedFalseClaim}" aparece respaldada por el contenido visible.`
        : `Fallo funcional esperado: la pagina no respalda la afirmacion "${expectedFalseClaim}".`,
      confidence: 98,
      step_number: step.number,
    };
    if (step.expected) action.expected = step.expected;
    return action;
  }
  const username = extractKeyValue(step, ['username', 'usuario', 'user', 'email', 'login']);
  const password = extractKeyValue(step, ['password', 'contraseña', 'contrasena', 'pass']);
  if (username && password && /(login|sesion|iniciar|ingresar|credencial|usuario|password|contrase)/.test(text)) {
    const usernameTarget = findCredentialField(observation, 'username');
    const passwordTarget = findCredentialField(observation, 'password');
    if (usernameTarget && passwordTarget) {
      const shouldSubmit = /(iniciar\s+sesion|iniciar\s+login|login\s+valido|hacer\s+login|enviar|submit|ingreso exitoso|area segura)/.test(text);
      const action: StrictAIAction = {
        action: 'fill_form',
        fields: [
          { target_ref: usernameTarget, value: username },
          { target_ref: passwordTarget, value: password },
        ],
        submit_after_type: shouldSubmit,
        reason: shouldSubmit
          ? 'Recuperacion deterministica: completar credenciales y enviar formulario.'
          : 'Recuperacion deterministica: completar credenciales visibles.',
        confidence: 95,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
  }

  const searchTerm = extractKeyValue(step, ['search_term', 'termino', 'term', 'query', 'busqueda']);
  if (searchTerm && /(buscar|busqueda|search)/.test(text)) {
    const target = findSearchInput(observation);
    if (target) {
      const action: StrictAIAction = {
        action: 'type',
        target_ref: target,
        value: searchTerm,
        submit_after_type: true,
        reason: `Recuperacion deterministica: escribir el termino de busqueda "${searchTerm}".`,
        confidence: 92,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
  }

  const preferredResult = extractKeyValue(step, ['resultado_preferido', 'preferred_result', 'preferred', 'result']);
  if (preferredResult && /(abrir|abre|resultado|relevante|navegar)/.test(text)) {
    const target = findPreferredResultTarget(observation, preferredResult);
    if (target) {
      const action: StrictAIAction = {
        action: 'click',
        target_ref: target,
        reason: `Recuperacion deterministica: abrir el resultado preferido "${preferredResult}".`,
        confidence: 94,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
    const url = preferredWikipediaUrl(observation.url, preferredResult);
    if (url) {
      const action: StrictAIAction = {
        action: 'navigate',
        value: url,
        reason: `Recuperacion deterministica: navegar al articulo preferido "${preferredResult}".`,
        confidence: 90,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
  }

  if (/(validar|confirmar|verificar|registrar evidencia|buscar visualmente|observar|visual)/.test(text)) {
    const expectedText = extractKeyValue(step, ['expected_keyword', 'keyword', 'texto', 'text']);
    if (expectedText) {
      const action: StrictAIAction = {
        action: 'assert_text',
        value: expectedText,
        reason: `Recuperacion deterministica: validar texto visible "${expectedText}".`,
        confidence: 90,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
    const corpus = observationCorpus(observation);
    const finishAction: StrictAIAction = {
      action: 'finish',
      reason: '',
      confidence: 90,
      step_number: step.number,
    };
    if (step.expected) finishAction.expected = step.expected;
    const expectedTerms = evidenceTerms(step, finishAction);
    const hasEvidence = expectedTerms.length === 0 || expectedTerms.some((term) => corpus.includes(term));
    if (hasEvidence && observation.readyState === 'complete') {
      const action: StrictAIAction = {
        action: 'finish',
        reason: 'Recuperacion deterministica: la pagina esta cargada y el snapshot contiene evidencia visual suficiente.',
        confidence: 88,
        step_number: step.number,
      };
      if (step.expected) action.expected = step.expected;
      return action;
    }
  }

  return null;
}

export function isCompoundFlowStep(step: QAEngineStep): boolean {
  const action = normalizeText(step.action || '');
  return /\by\s+(?:abrir|hacer clic|luego|completar|finalizar)|(?:luego|despues)\s+en|menu.*(?:reset|logout)|back home.*menu|completar checkout|completar datos.*(?:continue|finalizar)|reemplazar.*(?:clic|login)/.test(action);
}

export function needsCompoundContinuation(step: QAEngineStep, observation: BrowserObservation): boolean {
  const action = normalizeText(step.action || '');
  const url = normalizeText(observation.url);
  if (/completar checkout|completar datos.*finalizar/.test(action)) return !observationCorpus(observation).includes('thank you for your order');
  if (/checkout/.test(action) && /(abrir|agregar)/.test(action) && !/checkout-step-one\.html/.test(url)) return true;
  if (/(abrir.*carrito|agregar.*carrito)/.test(action) && !/cart\.html/.test(url)) return true;
  if (/continue shopping/.test(action) && !/inventory\.html/.test(url)) return true;
  if (/continue.*(?:luego|despues).*cancel/.test(action) && !/inventory\.html/.test(url)) return true;
  if (/back home.*menu.*logout/.test(action) && !/saucedemo\.com\/?$/.test(url)) return true;
  if (/menu.*reset app state/.test(action)) return observationCorpus(observation).includes('shopping_cart_badge');
  if (/reemplazar.*(?:clic|login)/.test(action) && !/inventory\.html/.test(url)) return true;
  return false;
}

export async function waitForExpectedEvidence(page: Page, step: QAEngineStep, action: StrictAIAction, executionId?: string): Promise<BrowserObservation> {
  const shouldWait = (action.action === 'type' && expectsDynamicResults(step))
    || ['click', 'check', 'fill_form', 'select'].includes(action.action);
  const deadline = Date.now() + (shouldWait ? 3000 : 0);
  const initialUrl = page.url();
  let latest = await observeBrowser(page, executionId, step.number);
  if (!deadline) return latest;
  const contract = buildStepContract(step);

  while (Date.now() < deadline) {
    const evaluation = evaluateStepContract(contract, { url: initialUrl }, latest);
    if (evaluation.ok && evaluation.conclusive) return latest;
    if (!evaluation.conclusive && hasDynamicResultEvidence(step, action, latest)) return latest;
    await page.waitForTimeout(200);
    latest = await observeBrowser(page, executionId, step.number);
  }
  return latest;
}

export function validateExpectedOutcome(
  step: QAEngineStep,
  before: Pick<BrowserObservation, 'url'>,
  after: Pick<BrowserObservation, 'url' | 'title' | 'visibleText' | 'bodyText' | 'elements'>
): { ok: boolean; reason: string; conclusive?: boolean } {
  const contract = buildStepContract(step);
  const evaluation = evaluateStepContract(contract, before, after as BrowserObservation);
  return {
    ok: evaluation.ok,
    reason: evaluation.reason,
    conclusive: evaluation.conclusive,
  };
}

export function stepLooksActionable(step: QAEngineStep, observation: BrowserObservation): boolean {
  const text = normalizeText(`${step.action || ''} ${step.data || ''} ${step.expected || ''}`);
  const mentionsAction = /(ingresar|completar|escribir|tipear|buscar|seleccionar|click|clic|presionar|enviar|abrir|navegar|validar|confirmar|registrar|evidencia|visual|observar|verificar)/.test(text);
  if (!mentionsAction) return false;
  const hasUsableElement = observation.elements.some((element) => (
    element.visible
    && !element.disabled
    && (element.editable || element.clickable || ['button', 'link', 'textbox', 'combobox', 'searchbox'].includes(String(element.role || '').toLowerCase()))
  ));
  if (!hasUsableElement) return false;
  const hasStructuredData = /(username|usuario|user|email|password|contrase|search_term|query|termino|url|base_url)\s*[:=]/i.test(`${step.data || ''}`);
  const needsNoData = /(click|clic|presionar|abrir|navegar|validar|confirmar)/.test(text);
  return hasStructuredData || needsNoData || observation.elements.some((element) => element.editable);
}

export function isActionableBlocked(action: StrictAIAction, step: QAEngineStep, observation: BrowserObservation): boolean {
  if (action.action !== 'blocked') return false;
  const reason = normalizeText(action.reason || '');
  const realBlocker = /(falta|faltan|missing|no existe|no esta disponible|no visible|sin dato|sin datos|imposible|no se puede|requiere credencial|requiere acceso)/.test(reason);
  return !realBlocker && stepLooksActionable(step, observation);
}

export function getWorkflowAgent(workflow: any[] | undefined, id: string): any | undefined {
  return (workflow || []).find((item) => String(item?.id || '').toUpperCase() === id);
}

export function retryLimitFromWorkflow(workflow: any[] | undefined, fallbackAttempts: number): number {
  const sentinel = getWorkflowAgent(workflow, 'SENTINEL');
  if (sentinel?.enabled === false) return 1;
  const retryLimit = Number(sentinel?.retry_limit);
  if (Number.isFinite(retryLimit)) {
    return Math.max(1, Math.min(6, retryLimit + 1));
  }
  return fallbackAttempts;
}

export function conventionalUiInferenceEnabled(workflow: any[] | undefined): boolean {
  return (workflow || []).some((agent) => (
    agent?.enabled !== false
    && (agent?.config?.conventional_ui_inference === true || agent?.config_json?.conventional_ui_inference === true)
  ));
}
