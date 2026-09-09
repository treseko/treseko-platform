type AnyRecord = Record<string, any>;

export function buildValidatedExecutedStep(args: {
  action: AnyRecord;
  currentStep: number;
  durationMs: number;
  screenshotBase64?: string;
  type: string;
  urlBefore: string;
  validation: AnyRecord;
}): AnyRecord {
  const { action, currentStep, durationMs, screenshotBase64, type, urlBefore, validation } = args;
  const after = validation.after;
  const result = validation.result;
  const contract = validation.contract;
  return {
    number: currentStep,
    status: result.ok ? 'PASO' : 'FALLO',
    confidence: Number(action.confidence ?? 100),
    observations: `Accion ${type} ejecutada. URL final: ${after.url}`,
    action_executed: true,
    ...(screenshotBase64 ? { screenshot_base64: screenshotBase64 } : {}),
    history: [{
      step_number: currentStep,
      attempt: 1,
      observation_before: { url: urlBefore, title: '', readyState: 'complete', loadingSignals: [] },
      observation_after: {
        url: after.url,
        title: after.title,
        readyState: after.readyState,
        loadingSignals: after.loadingSignals,
        visibleText: after.visibleText,
        bodyText: after.bodyText,
      },
      action: {
        action: type,
        reason: action.reason ?? 'Accion planificada por el workflow V3',
        confidence: Number(action.confidence ?? 100),
        step_number: currentStep,
        ...action,
      },
      execution: { ok: true, command: type, message: 'Accion ejecutada por el adapter graph-native' },
      duration_ms: durationMs,
      validation: { ok: result.ok, reason: result.reason, conclusive: result.conclusive },
      post_validation: { ok: result.ok, reason: result.reason, conclusive: result.conclusive },
      contract,
      ...(screenshotBase64 ? { screenshot_base64: screenshotBase64 } : {}),
    }],
    checkpoints: [{
      step_number: currentStep,
      attempt: 1,
      url: after.url,
      title: after.title,
      ready_state: after.readyState,
      visible_text_excerpt: after.visibleText.slice(0, 12),
      assertion_results: result.results,
      contract_coverage: contract.coverage,
      screenshot_available: Boolean(screenshotBase64),
      recoverable: true,
    }],
  };
}

export async function captureScreenshotBase64(page: AnyRecord): Promise<string | undefined> {
  try {
    if (typeof page.screenshot !== 'function') return undefined;
    const screenshot = await page.screenshot({ fullPage: false });
    if (typeof screenshot === 'string') return screenshot;
    if (screenshot && typeof screenshot.toString === 'function') return screenshot.toString('base64');
  } catch { /* evidence capture must not change the technical result */ }
  return undefined;
}

export function buildFailedExecutedStep(args: {
  action: AnyRecord;
  currentStep: number;
  durationMs: number;
  message: string;
  retryable: boolean;
  screenshotBase64?: string;
  titleAfter: string;
  type: string;
  urlAfter: string;
  urlBefore: string;
}): AnyRecord {
  const { action, currentStep, durationMs, message, retryable, screenshotBase64, titleAfter, type, urlAfter, urlBefore } = args;
  return {
    number: currentStep,
    status: retryable ? 'BLOQUEADO' : 'FALLO',
    confidence: Number(action.confidence ?? 100),
    observations: message,
    action_executed: false,
    failure_category: retryable ? 'technical_block' : 'assertion_or_action_failure',
    ...(screenshotBase64 ? { screenshot_base64: screenshotBase64 } : {}),
    history: [{
      step_number: currentStep,
      attempt: 1,
      observation_before: { url: urlBefore, title: '', readyState: 'complete', loadingSignals: [] },
      observation_after: { url: urlAfter, title: titleAfter, readyState: 'complete', loadingSignals: [], visibleText: [], bodyText: '' },
      action: { action: type, reason: action.reason ?? 'Accion planificada por el workflow V3', confidence: Number(action.confidence ?? 100), step_number: currentStep, ...action },
      execution: { ok: false, command: type, message },
      duration_ms: durationMs,
      validation: { ok: false, reason: message, conclusive: !retryable },
      post_validation: { ok: false, reason: message, conclusive: !retryable },
      ...(screenshotBase64 ? { screenshot_base64: screenshotBase64 } : {}),
    }],
    checkpoints: [{
      step_number: currentStep,
      attempt: 1,
      url: urlAfter,
      title: titleAfter,
      screenshot_available: Boolean(screenshotBase64),
    }],
  };
}
