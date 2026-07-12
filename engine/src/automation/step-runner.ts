import type { Page } from 'playwright';
import type { AIClient, AIResult } from '../ai/client.ts';
import type { BrowserObservation, QAEngineStep, StepRunResult, StrictAIAction, StructuredHistoryItem } from './action-types.ts';
import { executeStrictAction, normalizeAction, normalizeUrl, shouldUseCoordinateClickFallback, toCoordinateClickFallback, validateAction } from './action-executor.ts';
import { formatObservation, observeBrowser } from './observation.ts';

export interface StepRunnerOptions {
  executionId: string;
  task: string;
  expected?: string;
  maxAttempts?: number;
  agentWorkflow?: any[];
  emit?: (event: string, data: any) => void;
  logger?: { log: (source: string, level: string, message: string, details?: Record<string, unknown>) => void };
}

export interface RunStepsResult {
  steps: StepRunResult[];
  history: StructuredHistoryItem[];
  visited_urls: string[];
  errors: string[];
}

function stepGoal(task: string, step: QAEngineStep): string {
  return [
    `Caso: ${task}`,
    `Paso ${step.number}`,
    `Accion esperada: ${step.action || '-'}`,
    `Datos: ${step.data || '-'}`,
    `Resultado esperado: ${step.expected || '-'}`,
  ].join('\n');
}

function summarizeHistory(history: StructuredHistoryItem[]): string {
  return history.slice(-8).map((item) => {
    const status = item.execution.ok ? 'OK' : 'ERROR';
    const target = item.action.target_ref || (item.action.action === 'click_at' ? `${item.action.x},${item.action.y}` : '');
    return `Paso ${item.step_number} intento ${item.attempt}: ${item.action.action} ${target} ${item.action.value || ''} -> ${status}: ${item.execution.message}`;
  }).join('\n') || 'Sin acciones previas.';
}

function statusFromAction(action: StrictAIAction, ok: boolean): 'PASO' | 'FALLO' | 'BLOQUEADO' {
  if (ok && action.action !== 'fail' && action.action !== 'blocked') return 'PASO';
  if (action.action === 'blocked') return 'BLOQUEADO';
  return 'FALLO';
}

function isBrowserOpenStep(step: QAEngineStep): boolean {
  const text = `${step.action || ''} ${step.data || ''}`.toLowerCase();
  return /(abrir|abre|open).*(navegador|browser|chrome|crome|firefox|edge)/.test(text) || /(navegador|browser|chrome|crome|firefox|edge).*(abrir|abre|open)/.test(text);
}

function extractStepUrl(step: QAEngineStep): string {
  const text = `${step.action || ''}\n${step.data || ''}`.trim();
  if (!text) return '';
  const keyMatch = text.match(/\b(?:url|base_url|url_base)\s*[:=]\s*([^\s,;]+)/i);
  const directMatch = text.match(/\bhttps?:\/\/[^\s,;]+|\b(?:www\.)[^\s,;]+/i);
  const candidate = keyMatch?.[1] || directMatch?.[0] || '';
  return normalizeUrl(candidate.replace(/^["']|["']$/g, ''));
}

function isUrlNavigationStep(step: QAEngineStep): boolean {
  const text = `${step.action || ''} ${step.data || ''}`.toLowerCase();
  return Boolean(extractStepUrl(step)) && /(ingresar|abrir|navegar|cargar|visitar|ir a|go to|navigate|url)/i.test(text);
}

function confidenceFromHistory(history: StructuredHistoryItem[]): number {
  const values = history
    .map((item) => Number(item.action?.confidence || 0))
    .filter((value) => value > 0);
  if (!values.length) return 0;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function normalizeText(value: string): string {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

function evidenceTerms(step: QAEngineStep, action: StrictAIAction): string[] {
  const source = String(step.data || action.value || '').trim();
  if (!source || source === '-') return [];
  return Array.from(new Set(
    normalizeText(source)
      .replace(/https?:\/\/\S+/g, ' ')
      .replace(/[^a-z0-9]+/g, ' ')
      .split(/\s+/)
      .map((term) => term.trim())
      .filter((term) => term.length >= 3)
  )).slice(0, 5);
}

function observationCorpus(observation: Pick<BrowserObservation, 'url' | 'title' | 'visibleText' | 'elements'>): string {
  const elementText = observation.elements.map((el) => [
    el.name,
    el.label,
    el.text,
    el.value,
    el.placeholder,
    el.title,
    el.role,
  ].filter(Boolean).join(' '));
  return normalizeText([observation.url, observation.title, ...observation.visibleText, ...elementText].join(' '));
}

function expectsDynamicResults(step: QAEngineStep): boolean {
  const text = normalizeText(`${step.action || ''} ${step.expected || ''}`);
  return /(aparece|aparecen|resultado|resultados|sugerencia|sugerencias|desplegable|dropdown|lista|opciones)/.test(text);
}

function expectsVisibleOutcome(step: QAEngineStep, action: StrictAIAction): boolean {
  if (action.action === 'type') return expectsDynamicResults(step);
  if (!['click', 'click_at', 'press', 'select'].includes(action.action)) return false;
  const text = normalizeText(`${step.action || ''} ${step.expected || ''}`);
  return /(visualiza|aparece|muestra|informacion|informacion|pagina|navega|abre|resultado)/.test(text);
}

function hasDynamicResultEvidence(step: QAEngineStep, action: StrictAIAction, observation: BrowserObservation): boolean {
  if (action.action !== 'type' || !expectsDynamicResults(step)) return true;
  const terms = evidenceTerms(step, action);
  if (!terms.length) return true;
  const visibleTextCorpus = normalizeText(observation.visibleText.join(' '));
  if (terms.some((term) => visibleTextCorpus.includes(term))) return true;
  return observation.elements.some((el) => {
    if (el.ref === action.target_ref || el.editable) return false;
    const elementCorpus = normalizeText([el.name, el.label, el.text, el.value, el.placeholder, el.title].filter(Boolean).join(' '));
    return terms.some((term) => elementCorpus.includes(term));
  });
}

async function waitForExpectedEvidence(page: Page, step: QAEngineStep, action: StrictAIAction, executionId?: string): Promise<BrowserObservation> {
  const deadline = Date.now() + (action.action === 'type' && expectsDynamicResults(step) ? 2500 : 0);
  let latest = await observeBrowser(page, executionId, step.number);
  if (!deadline) return latest;

  while (Date.now() < deadline) {
    if (hasDynamicResultEvidence(step, action, latest)) return latest;
    await page.waitForTimeout(200);
    latest = await observeBrowser(page, executionId, step.number);
  }
  return latest;
}

function validateExpectedOutcome(
  step: QAEngineStep,
  action: StrictAIAction,
  before: Pick<BrowserObservation, 'url'>,
  after: Pick<BrowserObservation, 'url' | 'title' | 'visibleText' | 'elements'>
): { ok: boolean; reason: string } {
  if (!expectsVisibleOutcome(step, action)) return { ok: true, reason: 'Validacion funcional no requerida para este paso' };
  if (action.action === 'type' && expectsDynamicResults(step) && !hasDynamicResultEvidence(step, action, after as BrowserObservation)) {
    return {
      ok: false,
      reason: 'La accion escribio el valor, pero no aparecieron resultados, sugerencias o una lista visible relacionada con los datos del paso',
    };
  }
  const terms = evidenceTerms(step, action);
  if (!terms.length) return { ok: true, reason: 'Sin terminos funcionales especificos para validar' };
  const corpus = observationCorpus(after);
  const missing = terms.filter((term) => !corpus.includes(term));
  if (missing.length) {
    return {
      ok: false,
      reason: `La accion se ejecuto, pero no se encontro evidencia visual del resultado esperado. Faltan: ${missing.join(', ')}`,
    };
  }
  if (normalizeText(before.url) === normalizeText(after.url) && /navega|navegar|abre pagina|abrir pagina/.test(normalizeText(`${step.action || ''} ${step.expected || ''}`))) {
    return {
      ok: false,
      reason: 'La accion se ejecuto, pero la URL no cambio para un paso que parecia requerir navegacion o informacion de destino',
    };
  }
  return { ok: true, reason: 'Resultado esperado validado en URL/titulo/texto visible' };
}

function getWorkflowAgent(workflow: any[] | undefined, id: string): any | undefined {
  return (workflow || []).find((item) => String(item?.id || '').toUpperCase() === id);
}

function retryLimitFromWorkflow(workflow: any[] | undefined, fallbackAttempts: number): number {
  const sentinel = getWorkflowAgent(workflow, 'SENTINEL');
  if (sentinel?.enabled === false) return 1;
  const retryLimit = Number(sentinel?.retry_limit);
  if (Number.isFinite(retryLimit)) {
    return Math.max(1, Math.min(6, retryLimit + 1));
  }
  return fallbackAttempts;
}

export async function runQaSteps(
  page: Page,
  ai: AIClient,
  steps: QAEngineStep[],
  options: StepRunnerOptions
): Promise<RunStepsResult> {
  const maxAttempts = retryLimitFromWorkflow(options.agentWorkflow, Math.max(1, options.maxAttempts || 2));
  const results: StepRunResult[] = [];
  const globalHistory: StructuredHistoryItem[] = [];
  const visitedUrls = new Set<string>();
  const errors: string[] = [];

  for (const step of steps) {
    const stepHistory: StructuredHistoryItem[] = [];
    let finalResult: StepRunResult | null = null;

    if (isBrowserOpenStep(step)) {
      const observation = await observeBrowser(page, options.executionId, step.number);
      const screenshot = await page.screenshot();
      const screenshotBase64 = screenshot.toString('base64');
      const item: StructuredHistoryItem = {
        step_number: step.number,
        attempt: 1,
        observation_before: {
          url: observation.url,
          title: observation.title,
          readyState: observation.readyState,
          loadingSignals: observation.loadingSignals,
        },
        action: {
          action: 'finish',
          reason: 'El navegador ya esta abierto y la pagina inicial esta cargada.',
          expected: step.expected,
          confidence: 100,
          step_number: step.number,
        },
        execution: {
          ok: true,
          command: 'browser already initialized',
          message: 'Navegador disponible',
        },
        duration_ms: 0,
        screenshot_base64: screenshotBase64,
      };
      stepHistory.push(item);
      globalHistory.push(item);
      visitedUrls.add(observation.url);
      options.emit?.('step_result', {
        agent: 'BROWSER',
        step: step.number,
        status: 'PASO',
        screenshot: screenshotBase64,
        message: item.action.reason,
        action: item.action,
        confidence: item.action.confidence,
      });
      options.logger?.log('BROWSER', 'INFO', `Paso ${step.number}: navegador disponible`, {
        step: step.number,
        action: item.action,
        execution: item.execution,
        confidence: item.action.confidence,
      });
      results.push({
        number: step.number,
        status: 'PASO',
        observations: item.action.reason,
        screenshot_base64: screenshotBase64,
        history: stepHistory,
      });
      continue;
    }

    if (isUrlNavigationStep(step)) {
      const url = extractStepUrl(step);
      const observation = await observeBrowser(page, options.executionId, step.number);
      const startedAt = Date.now();
      const action: StrictAIAction = {
        action: 'navigate',
        value: url,
        reason: `Navegacion deterministica usando la URL del paso: ${url}`,
        expected: step.expected,
        confidence: 100,
        step_number: step.number,
      };
      const execution = await executeStrictAction(page, action);
      const afterObservation = await observeBrowser(page, options.executionId, step.number);
      visitedUrls.add(afterObservation.url);
      const afterScreenshot = await page.screenshot();
      const item: StructuredHistoryItem = {
        step_number: step.number,
        attempt: 1,
        observation_before: {
          url: observation.url,
          title: observation.title,
          readyState: observation.readyState,
          loadingSignals: observation.loadingSignals,
        },
        action,
        execution,
        duration_ms: Date.now() - startedAt,
        screenshot_base64: afterScreenshot.toString('base64'),
        validation: { ok: true, reason: 'URL detectada en datos del paso' },
      };
      stepHistory.push(item);
      globalHistory.push(item);
      const status = execution.ok ? 'PASO' : 'BLOQUEADO';
      const message = execution.ok
        ? `Se navego a ${url}`
        : `No se pudo navegar a ${url}: ${execution.message}`;
      if (!execution.ok) errors.push(`Paso ${step.number}: ${message}`);
      options.emit?.('step_result', {
        agent: 'SENTINEL',
        step: step.number,
        status,
        screenshot: item.screenshot_base64,
        message,
        confidence: action.confidence,
        deterministic: true,
        action,
        execution,
      });
      options.logger?.log('SENTINEL', execution.ok ? 'INFO' : 'ERROR', `Paso ${step.number}: ${message}`, {
        step: step.number,
        action,
        execution,
        validation: item.validation,
        confidence: action.confidence,
        duration_ms: item.duration_ms,
      });
      results.push({
        number: step.number,
        status,
        observations: message,
        error_log: execution.ok ? undefined : execution.error || execution.message,
        screenshot_base64: item.screenshot_base64,
        history: stepHistory,
        confidence: action.confidence,
        failure_category: execution.ok ? undefined : 'navigation_error',
      });
      continue;
    }

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const observation = await observeBrowser(page, options.executionId, step.number);
      visitedUrls.add(observation.url);
      const observationText = formatObservation(observation);
      const screenshot = await page.screenshot();
      const screenshotBase64 = screenshot.toString('base64');
      options.emit?.('status', {
        agent: 'AI_AGENT',
        level: 'INFO',
        step: step.number,
        attempt,
        message: `Paso ${step.number}: planificando intento ${attempt}`,
      });
      options.logger?.log('AI_AGENT', 'INFO', `Paso ${step.number}: solicitando accion estricta intento ${attempt}`, {
        step: step.number,
        attempt,
        observation_excerpt: observationText.slice(0, 1200),
      });

      const aiResult: AIResult<any> = await ai.planStepAction({
        step,
        goal: stepGoal(options.task, step),
        observationText,
        historyText: summarizeHistory(globalHistory),
        screenshotBase64,
        attempt,
      });
      let action = normalizeAction(aiResult.data, step.number);
      options.logger?.log('AI_AGENT', 'INFO', `Paso ${step.number}: accion propuesta ${action.action}`, {
        step: step.number,
        attempt,
        action,
        metrics: aiResult.metrics,
        prompt_excerpt: JSON.stringify(aiResult.prompt).slice(0, 2000),
        raw_response_excerpt: JSON.stringify(aiResult.rawResponse).slice(0, 2000),
      });
      let validation = validateAction(action, observation, step.number);
      if (!validation.ok && shouldUseCoordinateClickFallback(action, validation.reason)) {
        const originalValidation = validation;
        action = toCoordinateClickFallback(action, originalValidation.reason);
        validation = validateAction(action, observation, step.number);
        options.logger?.log('QA_GUARD', validation.ok ? 'INFO' : 'WARN', `Paso ${step.number}: fallback visual click_at -> ${validation.reason}`, {
          step: step.number,
          attempt,
          action,
          original_validation: originalValidation,
          validation,
        });
      }
      options.logger?.log('QA_GUARD', validation.ok ? 'INFO' : 'WARN', `Paso ${step.number}: ${validation.reason}`, {
        step: step.number,
        attempt,
        action,
        validation,
      });
      let execution;

      if (!validation.ok) {
        execution = {
          ok: false,
          command: 'validateAction',
          message: validation.reason,
          error: validation.reason,
        };
      } else {
        execution = await executeStrictAction(page, action);
        if (execution.ok) {
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
          const afterObservation = await waitForExpectedEvidence(page, step, action, options.executionId);
          const postValidation = validateExpectedOutcome(step, action, observation, afterObservation);
          options.logger?.log('VALIDATOR', postValidation.ok ? 'INFO' : 'WARN', `Paso ${step.number}: ${postValidation.reason}`, {
            step: step.number,
            attempt,
            action,
            post_validation: postValidation,
            before_url: observation.url,
            after_url: afterObservation.url,
            after_title: afterObservation.title,
          });
          if (!postValidation.ok) {
            execution = {
              ok: false,
              command: 'postActionValidation',
              message: postValidation.reason,
              error: postValidation.reason,
            };
          }
        }
      }
      options.logger?.log('SENTINEL', execution.ok ? 'INFO' : 'WARN', `Paso ${step.number}: ${action.action} -> ${execution.message}`, {
        step: step.number,
        attempt,
        action,
        execution,
      });

      const afterScreenshot = await page.screenshot().catch(() => screenshot);
      const item: StructuredHistoryItem = {
        step_number: step.number,
        attempt,
        observation_before: {
          url: observation.url,
          title: observation.title,
          readyState: observation.readyState,
          loadingSignals: observation.loadingSignals,
        },
        action,
        execution,
        duration_ms: Number(aiResult.metrics?.latencyMs || 0),
        screenshot_base64: afterScreenshot.toString('base64'),
        metrics: aiResult.metrics,
        validation,
        raw_ai_response: aiResult.rawResponse,
      };
      stepHistory.push(item);
      globalHistory.push(item);

      options.emit?.('step_result', {
        agent: execution.ok ? 'SENTINEL' : 'QA_GUARD',
        step: step.number,
        attempt,
        status: execution.ok ? 'PASO' : 'BLOQUEADO',
        metadata: aiResult.metrics,
        screenshot: item.screenshot_base64,
        message: execution.message,
        action,
        validation,
        execution,
        confidence: action.confidence,
      });

      const terminalModelDecision = validation.ok && (action.action === 'blocked' || action.action === 'fail');
      if (execution.ok || terminalModelDecision || attempt === maxAttempts) {
        const status = execution.command === 'postActionValidation'
          ? 'BLOQUEADO'
          : statusFromAction(action, execution.ok);
        const reason = execution.ok
          ? action.reason || `Paso ${step.number} ejecutado correctamente`
          : execution.message || action.reason || `Paso ${step.number} no pudo ejecutarse`;
        if (!execution.ok) errors.push(`Paso ${step.number}: ${reason}`);
        finalResult = {
          number: step.number,
          status,
          observations: reason,
          error_log: execution.ok ? undefined : execution.error || execution.message,
          screenshot_base64: item.screenshot_base64,
          history: stepHistory,
          confidence: confidenceFromHistory(stepHistory),
          failure_category: execution.ok ? undefined : (execution.command === 'postActionValidation' ? 'expected_result_not_met' : (validation.ok ? 'model_blocked' : 'invalid_model_action')),
        };
        break;
      }

      options.logger?.log('RECOVERY', 'INFO', `Paso ${step.number}: reintentando con nuevo snapshot por ${execution.message}`, {
        step: step.number,
        attempt,
        action,
        execution,
        validation,
      });
    }

    if (finalResult) {
      results.push(finalResult);
      if (finalResult.status !== 'PASO') break;
    }
  }

  return {
    steps: results,
    history: globalHistory,
    visited_urls: Array.from(visitedUrls),
    errors,
  };
}
