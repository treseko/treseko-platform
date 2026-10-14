import type { Page } from 'playwright'; import type { AIClient, AIResult } from '../ai/client.ts'; import type { BrowserObservation, ExecutionCheckpoint, QAEngineStep, StepContract, StepRunResult, StrictAIAction, StructuredHistoryItem } from './action-types.ts';
import { executeStrictAction, normalizeAction, normalizeUrl, shouldUseCoordinateClickFallback, toCoordinateClickFallback, validateAction } from './action-executor.ts'; import { formatObservation, observeBrowser } from './observation.ts'; import { buildStepContract, evaluateStepContract, inferConventionalUiAction, inferStructuredAction, parseStepData, stepDataValue } from './step-contract.ts'; import { displayResolvedInput, interpretStepData } from './context-data-interpreter.ts';
import { auditCoordinatePostValidation, revalidateCoordinateClick } from './step-runner-coordinate.ts';
import type { RunStepsResult, StepRunnerOptions } from './step-runner-types.ts'; export type { RunStepsResult, StepRunnerOptions } from './step-runner-types.ts';
import {
  stepGoal,
  summarizeHistory,
  latestCheckpointContext,
  actionExplicitlySubmits,
  buildCheckpoint,
  isBrowserOpenStep,
  extractStepUrl,
  isUrlNavigationStep,
  normalizeText,
  evidenceTerms,
  observationCorpus,
  expectsDynamicResults,
  expectsVisibleOutcome,
  expectedCountRequirement,
  countVisibleTerm,
  hasDynamicResultEvidence,
  confidencePayload,
  confidenceRecord,
  finalizeStepResult,
} from './step-runner-helpers.ts';
import {
  extractKeyValue,
  extractExpectedFalseClaim,
  findSearchInput,
  findCredentialField,
  wordsForMatch,
  findPreferredResultTarget,
  preferredWikipediaUrl,
  deterministicRecoveryAction,
  isCompoundFlowStep,
  needsCompoundContinuation,
  waitForExpectedEvidence,
  validateExpectedOutcome,
  stepLooksActionable,
  isActionableBlocked,
  getWorkflowAgent,
  retryLimitFromWorkflow,
  conventionalUiInferenceEnabled,
} from './step-runner-recovery.ts';
export async function runQaSteps(
  page: Page,
  ai: AIClient,
  steps: QAEngineStep[],
  options: StepRunnerOptions
): Promise<RunStepsResult> {
  const maxAttempts = retryLimitFromWorkflow(options.agentWorkflow, Math.max(1, options.maxAttempts || 2));
  const useConventionalUiInference = conventionalUiInferenceEnabled(options.agentWorkflow);
  const results: StepRunResult[] = [];
  const globalHistory: StructuredHistoryItem[] = [];
  const visitedUrls = new Set<string>();
  const errors: string[] = [];
  const checkpoints: ExecutionCheckpoint[] = [];
  for (const sourceStep of steps) {
    const resolvedData = interpretStepData(sourceStep.data, options.contextData || {});
    const step = resolvedData.normalizedData ? { ...sourceStep, data: resolvedData.normalizedData } : sourceStep;
    const contract = buildStepContract(step);
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
        observation_after: {
          url: observation.url,
          title: observation.title,
          readyState: observation.readyState,
          loadingSignals: observation.loadingSignals,
          visibleText: observation.visibleText,
          bodyText: observation.bodyText,
        },
        action: {
          action: 'finish',
          reason: 'El navegador ya esta abierto y la pagina inicial esta cargada.',
          confidence: 100,
          ...confidenceRecord('rules'),
          step_number: step.number,
          ...(step.expected ? { expected: step.expected } : {}),
        },
        execution: {
          ok: true,
          command: 'browser already initialized',
          message: 'Navegador disponible',
        },
        duration_ms: 0,
        screenshot_base64: screenshotBase64,
        validation: { ok: true, reason: 'Navegador disponible', conclusive: false },
        post_validation: { ok: true, reason: 'Pagina inicial cargada y observable', conclusive: false },
        contract,
      };
      item.checkpoint = buildCheckpoint(step, 1, contract, observation, observation, true);
      checkpoints.push(item.checkpoint);
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
        ...confidencePayload(item.action),
      });
      options.logger?.log('BROWSER', 'INFO', `Paso ${step.number}: navegador disponible`, {
        step: step.number,
        action: item.action,
        execution: item.execution,
        ...confidencePayload(item.action),
      });
      results.push({
        number: step.number,
        status: 'PASO',
        observations: item.action.reason,
        screenshot_base64: screenshotBase64,
        history: stepHistory,
        contract,
        checkpoints: [item.checkpoint],
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
        confidence: 100,
        ...confidenceRecord('rules'),
        step_number: step.number,
        ...(step.expected ? { expected: step.expected } : {}),
      };
      const execution = await executeStrictAction(page, action);
      const afterObservation = await waitForExpectedEvidence(page, step, action, options.executionId);
      const postValidation = execution.ok
        ? validateExpectedOutcome(step, observation, afterObservation)
        : { ok: false, reason: execution.message, conclusive: false };
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
        observation_after: {
          url: afterObservation.url,
          title: afterObservation.title,
          readyState: afterObservation.readyState,
          loadingSignals: afterObservation.loadingSignals,
          visibleText: afterObservation.visibleText,
          bodyText: afterObservation.bodyText,
        },
        action,
        execution,
        duration_ms: Date.now() - startedAt,
        screenshot_base64: afterScreenshot.toString('base64'),
        validation: { ok: true, reason: 'URL detectada en datos del paso', conclusive: false },
        post_validation: postValidation,
        contract,
      };
      item.checkpoint = buildCheckpoint(step, 1, contract, observation, afterObservation, Boolean(item.screenshot_base64));
      checkpoints.push(item.checkpoint);
      stepHistory.push(item);
      globalHistory.push(item);
      const status = !execution.ok ? 'BLOQUEADO' : postValidation.ok ? 'PASO' : 'FALLO';
      const message = execution.ok
        ? postValidation.reason
        : `No se pudo navegar a ${url}: ${execution.message}`;
      const failureCategory = status === 'PASO'
        ? 'passed'
        : /(falta|faltan|no se encontro|no visible|missing)/i.test(message)
          ? 'required_element_not_found'
          : !execution.ok ? 'navigation_error' : 'expected_result_not_met';
      if (status !== 'PASO') errors.push(`Paso ${step.number}: ${message}`);
      options.emit?.('step_result', {
        agent: 'SENTINEL',
        step: step.number,
        status,
        screenshot: item.screenshot_base64,
        message,
        reason: message,
        failure_category: failureCategory,
        action_summary: execution.command || action.action || 'No se ejecuto una accion',
        action_executed: Boolean(execution.ok && !['blocked', 'fail'].includes(String(action.action || '').toLowerCase())),
        url: afterObservation.url,
        ...confidencePayload(action),
        contract,
        checkpoints: [item.checkpoint],
        deterministic: true,
        action,
        execution,
      });
      options.logger?.log('SENTINEL', execution.ok ? 'INFO' : 'ERROR', `Paso ${step.number}: ${message}`, {
        step: step.number,
        action,
        execution,
        validation: item.validation,
        post_validation: item.post_validation,
        confidence: action.confidence,
        duration_ms: item.duration_ms,
      });
      const navigationResult: StepRunResult = {
        number: step.number,
        status,
        observations: message,
        history: stepHistory,
        confidence: action.confidence,
      };
      if (item.screenshot_base64) navigationResult.screenshot_base64 = item.screenshot_base64;
      if (status !== 'PASO') {
        navigationResult.error_log = execution.ok ? postValidation.reason : (execution.error || execution.message);
        navigationResult.failure_category = execution.ok ? 'expected_result_not_met' : 'navigation_error';
      }
      results.push(navigationResult);
      if (status !== 'PASO') break;
      continue;
    }
    const stepMaxAttempts = isCompoundFlowStep(step) ? Math.max(maxAttempts, 6) : maxAttempts;
    for (let attempt = 1; attempt <= stepMaxAttempts; attempt++) {
      let observation = await observeBrowser(page, options.executionId, step.number);
      visitedUrls.add(observation.url);
      const observationText = formatObservation(observation);
      let screenshot = await page.screenshot();
      const screenshotBase64 = screenshot.toString('base64');
      options.emit?.('status', {
        agent: 'AI_AGENT',
        level: 'INFO',
        step: step.number,
        attempt,
        message: `Paso ${step.number}: planificando intento ${attempt}`,
        resolved_context: {
          normalized_data: resolvedData.inputs.map(displayResolvedInput).join('; ') || '(sin datos estructurados)',
          inputs: resolvedData.inputs.map(displayResolvedInput),
          ambiguities: resolvedData.ambiguities,
        },
      });
      options.logger?.log('AI_AGENT', 'INFO', `Paso ${step.number}: solicitando accion estricta intento ${attempt}`, {
        step: step.number,
        attempt,
        observation_excerpt: observationText.slice(0, 1200),
        resolved_inputs: resolvedData.inputs.map(displayResolvedInput),
        ambiguities: resolvedData.ambiguities,
      });
      const deterministicAction = inferStructuredAction(step, observation)
        || (useConventionalUiInference ? inferConventionalUiAction(step, observation) : null)
        || deterministicRecoveryAction(step, observation);
      const aiResult: AIResult<any> = deterministicAction
        ? {
          data: deterministicAction,
          metrics: {
            latencyMs: 0,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
            estimatedCost: 0,
          },
          prompt: { deterministic: true, step: step.number },
          rawResponse: { deterministic: true, action: deterministicAction },
        } as AIResult<any>
        : await ai.planStepAction({
          step,
          goal: stepGoal(options.task, step, contract),
          observationText,
          historyText: `${summarizeHistory(globalHistory)}\n\n${latestCheckpointContext(globalHistory)}`,
          screenshotBase64,
          attempt,
        });
      let action = normalizeAction(aiResult.data, step.number);
      Object.assign(action, confidenceRecord(deterministicAction ? 'rules' : 'model'));
      if (action.action === 'fill_form' && action.submit_after_type && !actionExplicitlySubmits(step)) {
        action = {
          ...action,
          submit_after_type: false,
          reason: `${action.reason} El envio queda separado para preservar atomicidad.`,
        };
      }
      options.logger?.log(deterministicAction ? 'RECOVERY' : 'AI_AGENT', 'INFO', `Paso ${step.number}: accion propuesta ${action.action}`, {
        step: step.number,
        attempt,
        action,
        metrics: aiResult.metrics,
        prompt_excerpt: JSON.stringify(aiResult.prompt).slice(0, 2000),
        raw_response_excerpt: JSON.stringify(aiResult.rawResponse).slice(0, 2000),
      });
      let validation = validateAction(action, observation, step.number);
      if (validation.ok && isActionableBlocked(action, step, observation)) {
        const recovered = deterministicRecoveryAction(step, observation);
        if (recovered) {
          options.logger?.log('RECOVERY', 'INFO', `Paso ${step.number}: blocked recuperado como ${recovered.action}`, {
            step: step.number,
            attempt,
            original_action: action,
            recovered_action: recovered,
          });
          action = { ...recovered, confidence_source: 'rules', confidence_calibration: 'uncalibrated' };
          validation = validateAction(action, observation, step.number);
        } else {
          validation = {
            ok: false,
            reason: 'La IA devolvio blocked para un paso ejecutable. Debe elegir type, click, select, press, navigate, assert_visible o assert_text usando los datos y target_ref visibles.',
          };
        }
      }
      if (!validation.ok && shouldUseCoordinateClickFallback(action, validation.reason)) {
        const refreshed = await revalidateCoordinateClick(page, action, observation, options.executionId, step.number, validation);
        ({ action, observation, screenshot, validation } = refreshed);
        options.logger?.log('QA_GUARD', validation.ok ? 'INFO' : 'WARN', `Paso ${step.number}: fallback visual click_at -> ${validation.reason}`, {
          step: step.number,
          attempt,
          action,
          original_validation: refreshed.originalValidation,
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
      let actionExecutionSucceeded = false;
      let afterObservation = observation;
      let postValidation: { ok: boolean; reason: string; conclusive?: boolean } = {
        ok: false,
        reason: 'La accion no llego a ejecutarse.',
        conclusive: true,
      };
      if (!validation.ok) {
        execution = {
          ok: false,
          command: 'validateAction',
          message: validation.reason,
          error: validation.reason,
        };
        postValidation = {
          ok: false,
          reason: validation.reason,
          conclusive: true,
        };
      } else {
        execution = await executeStrictAction(page, action);
        actionExecutionSucceeded = execution.ok;
        if (execution.ok) {
          await page.waitForLoadState('networkidle', { timeout: 8000 }).catch(() => undefined);
          afterObservation = await waitForExpectedEvidence(page, step, action, options.executionId);
          postValidation = auditCoordinatePostValidation(action, validateExpectedOutcome(step, observation, afterObservation));
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
        } else {
          afterObservation = await observeBrowser(page, options.executionId, step.number).catch(() => observation);
          postValidation = {
            ok: false,
            reason: execution.message,
            conclusive: true,
          };
        }
      }
      await ai.sendAgentExecutionResult({
        ok: Boolean(execution.ok),
        observation: { url: afterObservation.url, title: afterObservation.title, visible_text: afterObservation.visibleText.slice(0, 20) },
      });
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
        observation_after: {
          url: afterObservation.url,
          title: afterObservation.title,
          readyState: afterObservation.readyState,
          loadingSignals: afterObservation.loadingSignals,
          visibleText: afterObservation.visibleText,
          bodyText: afterObservation.bodyText,
        },
        action,
        execution,
        duration_ms: Number(aiResult.metrics?.latencyMs || 0),
        screenshot_base64: afterScreenshot.toString('base64'),
        metrics: aiResult.metrics,
        validation,
        post_validation: postValidation,
        raw_ai_response: aiResult.rawResponse,
        contract,
      };
      item.checkpoint = buildCheckpoint(step, attempt, contract, observation, afterObservation, Boolean(item.screenshot_base64));
      checkpoints.push(item.checkpoint);
      stepHistory.push(item);
      globalHistory.push(item);
      options.emit?.('step_result', {
        agent: execution.ok ? 'SENTINEL' : 'QA_GUARD',
        step: step.number,
        attempt,
        status: execution.ok ? 'PASO' : (execution.command === 'postActionValidation' && postValidation.conclusive ? 'FALLO' : 'BLOQUEADO'),
        metadata: aiResult.metrics,
        screenshot: item.screenshot_base64,
        message: execution.message,
        reason: execution.ok ? (action.reason || execution.message) : execution.message,
        failure_category: execution.ok
          ? (/(falta|faltan|no se encontro|no visible|missing)/i.test(postValidation.reason || action.reason || '') ? 'required_element_not_found' : 'passed')
          : 'browser_action_failed',
        action_summary: execution.command || action.action || 'No se ejecuto una accion',
        action_executed: Boolean(execution.ok && !['blocked', 'fail'].includes(String(action.action || '').toLowerCase())),
        url: afterObservation.url,
        action,
        validation,
        execution,
        ...confidencePayload(action),
      });
      const terminalModelDecision = validation.ok && (action.action === 'blocked' || action.action === 'fail');
      const compoundContinuation = actionExecutionSucceeded && isCompoundFlowStep(step) && needsCompoundContinuation(step, afterObservation);
      const conclusiveAssertionFailure = execution.command === 'postActionValidation' && postValidation.conclusive && !compoundContinuation;
      if ((execution.ok && !compoundContinuation) || (action.coordinate_fallback && actionExecutionSucceeded && !postValidation.conclusive) || terminalModelDecision || conclusiveAssertionFailure || attempt === stepMaxAttempts) {
        const finalized = finalizeStepResult({ step, execution, action, validation, postValidation, contract, history: stepHistory, screenshot: item.screenshot_base64 });
        if (!execution.ok) errors.push(`Paso ${step.number}: ${finalized.reason}`);
        finalResult = finalized.result;
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
    checkpoints,
  };
}
