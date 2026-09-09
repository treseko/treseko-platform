import { buildFailedExecutedStep, buildValidatedExecutedStep, captureScreenshotBase64 } from './browser-action-evidence.ts';
import { validateExecutedBrowserStep } from './browser-step-validation.ts';

/*
 * Built-in graph-native QA adapters.
 *
 * These adapters intentionally execute one technical responsibility per graph
 * node. In particular, the browser action executor never invokes runQaSteps or
 * any complete-test runner.
 */

type AnyRecord = Record<string, any>;
type AnyHandler = (...args: any[]) => any;

export type AtomicAdapterResult = {
  [key: string]: unknown;
  status: 'SUCCESS' | 'FAILED' | 'BLOCKED' | 'RETRYABLE' | 'SKIPPED' | 'CANCELLED';
  output_port: string;
  outputPort?: string;
  reason_code: string;
  reasonCode?: string;
  message?: string;
  data: AnyRecord;
  metrics?: AnyRecord;
  evidence_refs?: string[];
};

function isRecord(value: unknown): value is AnyRecord {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function walkObjects(values: unknown[], maxDepth = 4): AnyRecord[] {
  const found: AnyRecord[] = [];
  const seen = new Set<unknown>();
  const visit = (value: unknown, depth: number) => {
    if (depth > maxDepth || !isRecord(value) || seen.has(value)) return;
    seen.add(value);
    found.push(value);
    for (const nested of Object.values(value)) {
      if (isRecord(nested)) visit(nested, depth + 1);
    }
  };
  values.forEach((value) => visit(value, 0));
  return found;
}

function findValue(objects: AnyRecord[], keys: string[]): any {
  for (const object of objects) {
    for (const key of keys) {
      if (object[key] !== undefined && object[key] !== null) return object[key];
    }
  }
  return undefined;
}

function findPage(objects: AnyRecord[]): AnyRecord | undefined {
  const direct = findValue(objects, ['page', 'browserPage', 'playwrightPage']);
  if (isRecord(direct)) return direct;
  return objects.find((candidate) =>
    typeof candidate.url === 'function'
    && typeof candidate.locator === 'function'
    && typeof candidate.goto === 'function');
}

function declaredOutputPorts(objects: AnyRecord[]): string[] {
  const ports: string[] = [];
  const add = (value: unknown) => {
    if (typeof value === 'string' && value.trim() && !ports.includes(value.trim())) ports.push(value.trim());
    else if (isRecord(value)) add(value.id ?? value.key ?? value.name ?? value.port);
  };
  for (const object of objects) {
    for (const value of [object.output_ports, object.outputPorts, object.outputs]) {
      if (Array.isArray(value)) value.forEach(add);
      else if (isRecord(value)) Object.keys(value).forEach(add);
    }
    const contract = object.universal_agent?.contract ?? object.universalAgent?.contract;
    const contractPorts = contract?.output_ports ?? contract?.outputPorts ?? contract?.outputs;
    if (Array.isArray(contractPorts)) contractPorts.forEach(add);
  }
  return ports;
}

function preferredOutputPort(objects: AnyRecord[], candidates: string[], fallback: string): string {
  const declared = declaredOutputPorts(objects);
  for (const candidate of candidates) if (declared.includes(candidate)) return candidate;
  const nonError = declared.find((port) => !/fail|error|block|retry|invalid|exhaust/i.test(port));
  return nonError ?? fallback;
}

function normalizeAction(raw: any): AnyRecord | undefined {
  if (!raw) return undefined;
  if (isRecord(raw.data) && isRecord(raw.data.action)) raw = raw.data.action;
  if (isRecord(raw.action)) raw = raw.action;
  if (!isRecord(raw)) return undefined;
  const actionType = String(
    raw.type ?? raw.kind ?? raw.action_type ?? raw.actionType ?? raw.name ?? '',
  ).trim().toLowerCase();
  if (!actionType) return undefined;
  const parameters = isRecord(raw.parameters) ? raw.parameters : isRecord(raw.args) ? raw.args : {};
  return { ...parameters, ...raw, __type: actionType };
}

function findAction(objects: AnyRecord[]): AnyRecord | undefined {
  const direct = findValue(objects, [
    'proposed_action', 'proposedAction', 'planned_action', 'plannedAction',
    'next_action', 'nextAction', 'browser_action', 'browserAction', 'action',
  ]);
  // Only graph state explicitly designated as an action is authoritative.
  // Never infer an action by scanning arbitrary runtime objects: Playwright's
  // Page contains methods/properties such as `select` and `type`, which can be
  // mistaken for a planner decision and lead to an unrelated browser action.
  return normalizeAction(direct);
}

function abortSignalFor(objects: AnyRecord[]): AbortSignal | undefined {
  const signal = findValue(objects, ['signal', 'abortSignal', 'abort_signal']);
  return signal && typeof signal === 'object' && 'aborted' in signal ? signal as AbortSignal : undefined;
}

function boundedNumber(value: unknown, fallback: number, min: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, parsed));
}

function validateNavigationUrl(rawUrl: unknown, objects: AnyRecord[]): { url?: string; error?: AtomicAdapterResult } {
  if (typeof rawUrl !== 'string' || !rawUrl.trim()) {
    return { error: blocked('ACTION_URL_REQUIRED', 'Navigation action requires a URL') };
  }
  let parsed: URL;
  try { parsed = new URL(rawUrl); } catch {
    return { error: blocked('ACTION_URL_INVALID', 'Navigation URL is invalid', { url: rawUrl }) };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { error: blocked('ACTION_URL_PROTOCOL_DENIED', `Navigation protocol ${parsed.protocol} is not allowed`, { url: rawUrl }) };
  }
  const allowed = findValue(objects, ['allowed_origins', 'allowedOrigins', 'navigation_allowlist', 'navigationAllowlist']);
  if (Array.isArray(allowed) && allowed.length > 0) {
    const normalized = allowed.map(String);
    if (!normalized.includes(parsed.origin) && !normalized.includes(parsed.hostname)) {
      return { error: blocked('ACTION_URL_NOT_ALLOWED', `Navigation origin ${parsed.origin} is outside the execution allowlist`, { url: rawUrl }) };
    }
  }
  return { url: parsed.toString() };
}

function selectorFor(action: AnyRecord): string | undefined {
  const value = action.selector ?? action.locator ?? action.target_selector
    ?? action.targetSelector ?? action.css ?? action.xpath;
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function textFor(action: AnyRecord): string {
  const value = action.value ?? action.text ?? action.input ?? action.keys ?? action.content ?? '';
  return value === undefined || value === null ? '' : String(value);
}

function success(port: string, reason: string, data: AnyRecord = {}, message?: string): AtomicAdapterResult {
  return { status: 'SUCCESS', output_port: port, outputPort: port, reason_code: reason, reasonCode: reason, message, data };
}

function blocked(reason: string, message: string, data: AnyRecord = {}): AtomicAdapterResult {
  return { status: 'BLOCKED', output_port: 'blocked', outputPort: 'blocked', reason_code: reason, reasonCode: reason, message, data };
}

function failed(reason: string, message: string, data: AnyRecord = {}): AtomicAdapterResult {
  return { status: 'FAILED', output_port: 'failed', outputPort: 'failed', reason_code: reason, reasonCode: reason, message, data };
}

async function observeBrowserOnce(...args: any[]): Promise<AtomicAdapterResult> {
  const objects = walkObjects(args);
  const signal = abortSignalFor(objects);
  if (signal?.aborted) return { status: 'CANCELLED', output_port: 'cancelled', outputPort: 'cancelled', reason_code: 'EXECUTION_CANCELLED', reasonCode: 'EXECUTION_CANCELLED', data: {} };
  const page = findPage(objects);
  if (!page) return blocked('BROWSER_PAGE_UNAVAILABLE', 'Observer requires a Playwright page in the execution context');

  const startedAt = Date.now();
  const url = typeof page.url === 'function' ? String(page.url()) : '';
  let title = '';
  try { if (typeof page.title === 'function') title = String(await page.title()); } catch { /* optional */ }

  let text = '';
  try {
    if (typeof page.locator === 'function') {
      const body = page.locator('body');
      if (body && typeof body.innerText === 'function') text = String(await body.innerText({ timeout: 5_000 }));
    }
  } catch { /* observation remains useful without body text */ }

  const maxText = Number(findValue(objects, ['max_observation_chars', 'maxObservationChars']) ?? 20_000);
  const outputPort = preferredOutputPort(objects, ['observed', 'success', 'continue', 'default'], 'observed');
  const observation = { url, title, text: text.slice(0, Number.isFinite(maxText) ? maxText : 20_000) };
  return {
    ...success(outputPort, 'BROWSER_OBSERVED', { observation }),
    observation,
    metrics: { duration_ms: Date.now() - startedAt },
  };
}

async function executeBrowserActionOnce(...args: any[]): Promise<AtomicAdapterResult> {
  const objects = walkObjects(args);
  const signal = abortSignalFor(objects);
  if (signal?.aborted) return { status: 'CANCELLED', output_port: 'cancelled', outputPort: 'cancelled', reason_code: 'EXECUTION_CANCELLED', reasonCode: 'EXECUTION_CANCELLED', data: {} };
  const page = findPage(objects);
  if (!page) return blocked('BROWSER_PAGE_UNAVAILABLE', 'Executor requires a Playwright page in the execution context');
  const action = findAction(objects);
  if (!action) return blocked('PLANNED_ACTION_UNAVAILABLE', 'Executor requires one planned browser action from the graph state');

  const startedAt = Date.now();
  const urlBefore = typeof page.url === 'function' ? String(page.url()) : '';
  const type = String(action.__type);
  const selector = selectorFor(action);
  const sharedMemory = findValue(objects, ['sharedMemory', 'shared_memory']);
  const executionId = String(findValue(objects, ['executionId', 'execution_id']) ?? '');
  const currentStep = Number(sharedMemory?.current_step ?? 1);
  const qaSteps = findValue(objects, ['qaSteps', 'manualSteps']);
  const caseStep = Array.isArray(qaSteps)
    ? qaSteps.find((step: any) => Number(step?.number ?? step?.numero_paso) === currentStep)
    : undefined;
  const expected = String(caseStep?.expected ?? caseStep?.resultado_esperado ?? '');
  try {
    if (type.includes('double') && type.includes('click')) {
      if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Double-click action requires a selector', { action });
      await page.locator(selector).dblclick({ timeout: boundedNumber(action.timeout_ms ?? action.timeout, 15_000, 100, 120_000) });
    } else if (type === 'click' || type.includes('click')) {
      if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Click action requires a selector', { action });
      await page.locator(selector).click({ timeout: boundedNumber(action.timeout_ms ?? action.timeout, 15_000, 100, 120_000) });
    } else if (type === 'fill' || type === 'type' || type.includes('input')) {
      if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Fill action requires a selector', { action });
      const locator = page.locator(selector);
      if (type === 'type' && typeof locator.type === 'function') {
        await locator.type(textFor(action), { delay: boundedNumber(action.delay_ms ?? action.delay, 0, 0, 2_000) });
      } else {
        await locator.fill(textFor(action));
      }
    } else if (type === 'goto' || type === 'navigate' || type.includes('navigation') || type.includes('navigate') || type.includes('goto')) {
      const navigation = validateNavigationUrl(action.url ?? action.href ?? action.value, objects);
      if (navigation.error) return navigation.error;
      await page.goto(navigation.url, { waitUntil: action.wait_until ?? 'domcontentloaded', timeout: boundedNumber(action.timeout_ms ?? action.timeout, 30_000, 100, 120_000) });
    } else if (type === 'clear' || type.includes('clear_input')) {
      if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Clear action requires a selector', { action });
      await page.locator(selector).fill('');
    } else if (type === 'focus') {
      if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Focus action requires a selector', { action });
      await page.locator(selector).focus();
    } else if (type === 'reload' || type.includes('refresh')) {
      await page.reload({ waitUntil: action.wait_until ?? 'domcontentloaded', timeout: boundedNumber(action.timeout_ms ?? action.timeout, 30_000, 100, 120_000) });
    } else if (type === 'go_back' || type === 'back') {
      await page.goBack({ waitUntil: action.wait_until ?? 'domcontentloaded', timeout: boundedNumber(action.timeout_ms ?? action.timeout, 30_000, 100, 120_000) });
    } else if (type === 'go_forward' || type === 'forward') {
      await page.goForward({ waitUntil: action.wait_until ?? 'domcontentloaded', timeout: boundedNumber(action.timeout_ms ?? action.timeout, 30_000, 100, 120_000) });
    } else if (type === 'press' || type.includes('key')) {
      if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Press action requires a selector', { action });
      await page.locator(selector).press(String(action.key ?? action.value ?? 'Enter'));
    } else if (type.includes('select')) {
      if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Select action requires a selector', { action });
      await page.locator(selector).selectOption(action.value ?? action.option ?? action.label);
    } else if (type === 'check' || type === 'uncheck') {
      if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', `${type} action requires a selector`, { action });
      const locator = page.locator(selector);
      if (type === 'check') await locator.check(); else await locator.uncheck();
    } else if (type === 'hover') {
      if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Hover action requires a selector', { action });
      await page.locator(selector).hover();
    } else if (type === 'scroll' || type.includes('scroll')) {
      const x = Number(action.x ?? action.delta_x ?? action.deltaX ?? 0);
      const y = Number(action.y ?? action.delta_y ?? action.deltaY ?? 600);
      if (page.mouse && typeof page.mouse.wheel === 'function') await page.mouse.wheel(x, y);
      else await page.evaluate(({ x: dx, y: dy }: { x: number; y: number }) => (globalThis as any).scrollBy(dx, dy), { x, y });
    } else if (/^(done|complete|completed|finish|finished|noop|no_op)$/.test(type)) {
      // Observation-only steps still pass through the validation and evidence
      // pipeline below. Returning here would approve them without checking the
      // expected result.
    } else if (type.includes('assert') || type.includes('verify')) {
      const expected = String(action.expected ?? action.value ?? action.text ?? '');
      let assertionPassed = false;
      let actual: unknown;
      if (type.includes('url')) {
        actual = String(page.url());
        assertionPassed = expected ? String(actual).includes(expected) : Boolean(actual);
      } else if (type.includes('title')) {
        actual = await page.title();
        assertionPassed = expected ? String(actual).includes(expected) : Boolean(actual);
      } else if (type.includes('visible')) {
        if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Visibility assertion requires a selector', { action });
        actual = await page.locator(selector).isVisible();
        assertionPassed = Boolean(actual) === (action.visible ?? true);
      } else {
        if (!selector) return blocked('ACTION_SELECTOR_REQUIRED', 'Text assertion requires a selector', { action });
        actual = await page.locator(selector).innerText();
        assertionPassed = expected ? String(actual).includes(expected) : Boolean(actual);
      }
      if (!assertionPassed) {
        const assertionError = new Error(`The browser assertion did not match the expected value. Expected: ${expected}; actual: ${String(actual)}`);
        (assertionError as any).reasonCode = 'BROWSER_ASSERTION_FAILED';
        throw assertionError;
      }
    } else if (type === 'wait' || type.includes('wait')) {
      await page.waitForTimeout(boundedNumber(action.duration_ms ?? action.timeout_ms ?? action.value, 500, 0, 120_000));
    } else if (type === 'screenshot') {
      const screenshot = await page.screenshot({ fullPage: Boolean(action.full_page ?? action.fullPage) });
      return {
        ...success(preferredOutputPort(objects, ['executed', 'success', 'continue', 'default'], 'executed'), 'SCREENSHOT_CAPTURED', { action, screenshot }),
        action,
        screenshot,
        sharedMemoryPatch: { planned_action: null, last_action: action },
        metrics: { duration_ms: Date.now() - startedAt },
      };
    } else {
      return blocked('UNSUPPORTED_BROWSER_ACTION', `Unsupported graph-native browser action: ${type}`, { action });
    }

    const validation = await validateExecutedBrowserStep({ caseStep, currentStep, executionId, page, urlBefore });
    const urlAfter = validation.after.url;
    const durationMs = Date.now() - startedAt;
    const screenshotBase64 = await captureScreenshotBase64(page);
    const executedStep = buildValidatedExecutedStep({
      action, currentStep, durationMs, screenshotBase64, type, urlBefore, validation,
    });
    const previousSteps = Array.isArray(sharedMemory?.executed_steps) ? sharedMemory.executed_steps : [];
    const executedSteps = [...previousSteps.filter((step: any) => Number(step?.number) !== currentStep), executedStep];
    if (!validation.result.ok) {
      return {
        status: 'FAILED',
        output_port: 'failed',
        outputPort: 'failed',
        reason_code: 'STEP_ASSERTION_FAILED',
        reasonCode: 'STEP_ASSERTION_FAILED',
        message: validation.result.reason,
        data: { action, validation: validation.result },
        sharedMemoryPatch: {
          executed_steps: executedSteps,
          detected_errors: Array.from(new Set([...(Array.isArray(sharedMemory?.detected_errors) ? sharedMemory.detected_errors : []), validation.result.reason])),
          last_action: action,
          planned_action: null,
        },
        metrics: { duration_ms: durationMs },
      };
    }
    return {
      ...success(preferredOutputPort(objects, ['executed', 'success', 'continue', 'default'], 'executed'), 'BROWSER_ACTION_EXECUTED', { action, url_before: urlBefore, url_after: urlAfter }),
      action,
      executedAction: action,
      sharedMemoryPatch: {
        executed_steps: executedSteps,
        visited_urls: Array.from(new Set([...(Array.isArray(sharedMemory?.visited_urls) ? sharedMemory.visited_urls : []), urlAfter].filter(Boolean))),
        last_action: action,
        planned_action: null,
      },
      metrics: { duration_ms: durationMs },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const retryable = /timeout|detached|closed|navigation|network/i.test(message);
    const reasonCode = String((error as any)?.reasonCode || (retryable ? 'BROWSER_ACTION_TRANSIENT_ERROR' : 'BROWSER_ACTION_FAILED'));
    const screenshotBase64 = await captureScreenshotBase64(page);
    const urlAfter = typeof page.url === 'function' ? String(page.url()) : urlBefore;
    let titleAfter = '';
    try { if (typeof page.title === 'function') titleAfter = String(await page.title()); } catch { /* optional evidence */ }
    const durationMs = Date.now() - startedAt;
    const failedStep = buildFailedExecutedStep({ action, currentStep, durationMs, message, retryable, screenshotBase64, titleAfter, type, urlAfter, urlBefore });
    const previousSteps = Array.isArray(sharedMemory?.executed_steps) ? sharedMemory.executed_steps : [];
    const executedSteps = [...previousSteps.filter((step: any) => Number(step?.number) !== currentStep), failedStep];
    return {
      status: retryable ? 'RETRYABLE' : 'FAILED',
      output_port: retryable ? 'retry' : 'failed',
      outputPort: retryable ? 'retry' : 'failed',
      reason_code: reasonCode,
      reasonCode,
      message,
      data: { action },
      sharedMemoryPatch: {
        executed_steps: executedSteps,
        detected_errors: Array.from(new Set([...(Array.isArray(sharedMemory?.detected_errors) ? sharedMemory.detected_errors : []), message])),
        last_action: action,
        planned_action: null,
      },
      metrics: { duration_ms: durationMs },
    };
  }
}
function resolveContextOnce(...args: any[]): AtomicAdapterResult {
  const objects = walkObjects(args, 2);
  const input = findValue(objects, ['input', 'inputs', 'mappedInput', 'mapped_input']) ?? {};
  return success('resolved', 'CONTEXT_RESOLVED', { context: input });
}


function findCallable(objects: AnyRecord[], names: string[]): { owner: AnyRecord; fn: AnyHandler } | undefined {
  for (const owner of objects) {
    for (const name of names) {
      const candidate = owner[name];
      if (typeof candidate === 'function' && !/runQaSteps|runWorkflow|executeWorkflow/i.test(candidate.name || name)) {
        return { owner, fn: candidate as AnyHandler };
      }
    }
  }
  return undefined;
}

function normalizeAgentResult(raw: any, successPort: string, reasonCode: string): AtomicAdapterResult {
  if (raw && typeof raw === 'object' && typeof raw.status === 'string') {
    const explicitPort = raw.output_port ?? raw.outputPort ?? raw.port;
    const status = String(raw.status).toUpperCase();
    const inferredCandidates = status === 'BLOCKED' || status === 'CANCELLED'
      ? ['blocked']
      : status === 'FAILED'
        ? ['failed']
        : status === 'RETRYABLE'
          ? ['retry']
          : [successPort, 'success', 'continue'];
    const port = String(explicitPort ?? preferredOutputPort(walkObjects([raw]), inferredCandidates, inferredCandidates[0]));
    const reason = String(raw.reason_code ?? raw.reasonCode ?? reasonCode);
    return {
      ...raw,
      output_port: port,
      outputPort: port,
      reason_code: reason,
      reasonCode: reason,
      data: isRecord(raw.data) ? raw.data : { result: raw.data ?? raw.result },
    } as AtomicAdapterResult;
  }
  return success(successPort, reasonCode, isRecord(raw) ? raw : { result: raw });
}

function singleResponsibilityAgent(
  adapter: string,
  serviceNames: string[],
  successPort: string,
  reasonCode: string,
  fallback?: AnyHandler,
): AnyHandler {
  return async function graphNativeSingleResponsibilityAgent(...args: any[]) {
    const objects = walkObjects(args);
    const signal = abortSignalFor(objects);
    if (signal?.aborted) {
      return { status: 'CANCELLED', output_port: 'cancelled', outputPort: 'cancelled', reason_code: 'EXECUTION_CANCELLED', reasonCode: 'EXECUTION_CANCELLED', data: {} } as AtomicAdapterResult;
    }
    const service = findCallable(objects, serviceNames);
    if (service) {
      try {
        const raw = service.fn.length <= 1
          ? await service.fn.call(service.owner, args[0] ?? {})
          : await service.fn.apply(service.owner, args);
        return normalizeAgentResult(raw, preferredOutputPort(objects, [successPort, 'success', 'continue'], successPort), reasonCode);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return failed('ATOMIC_AGENT_FAILED', message, { adapter });
      }
    }
    if (fallback) {
      const raw = await fallback(...args);
      return normalizeAgentResult(raw, preferredOutputPort(objects, [successPort, 'success', 'continue'], successPort), reasonCode);
    }
    return blocked('ATOMIC_AGENT_SERVICE_UNAVAILABLE', `No runtime service is registered for ${adapter}`, { adapter });
  };
}

/**
 * Returns only truly atomic built-ins. Other agent adapters intentionally use
 * the established single-node handlers through the canonical alias registry.
 */
export function builtInAtomicHandlerFor(adapter: string, fallback?: AnyHandler): AnyHandler | undefined {
  switch (adapter) {
    case 'qa-context-resolver/v2':
      return singleResponsibilityAgent(adapter, ['resolveContext', 'resolveExecutionContext'], 'resolved', 'CONTEXT_RESOLVED', fallback);
    case 'qa-pre-execution-analyst/v2':
      return singleResponsibilityAgent(adapter, ['analyzePreconditions', 'analyzeExecution', 'runPreExecutionAnalysis'], 'ready', 'PRE_EXECUTION_ANALYZED', fallback);
    case 'qa-browser-observer/v2':
      return singleResponsibilityAgent(adapter, ['observeBrowser', 'captureObservation', 'observePage'], 'observed', 'BROWSER_OBSERVED', fallback);
    case 'qa-action-planner/v2':
      return singleResponsibilityAgent(adapter, ['planNextAction', 'planAction', 'proposeAction'], 'planned', 'ACTION_PLANNED', fallback);
    case 'qa-security-guard/v2':
      return singleResponsibilityAgent(adapter, ['validateActionSecurity', 'guardAction', 'authorizeAction'], 'allowed', 'ACTION_ALLOWED', fallback);
    case 'qa-browser-action-executor/v2':
      // Never delegate to the legacy Executor: it owns the hidden runQaSteps loop.
      return executeBrowserActionOnce;
    case 'qa-step-validator/v2':
      return singleResponsibilityAgent(adapter, ['validateStepResult', 'validateActionResult', 'verifyStep'], 'valid', 'STEP_VALIDATED', fallback);
    case 'qa-recovery-strategist/v2':
      return singleResponsibilityAgent(adapter, ['planRecovery', 'createRecoveryStrategy', 'recoverStep'], 'recovered', 'RECOVERY_PLANNED', fallback);
    case 'qa-final-auditor/v2':
      return singleResponsibilityAgent(adapter, ['auditExecution', 'auditResult'], 'audited', 'EXECUTION_AUDITED', fallback);
    case 'qa-execution-reporter/v2':
      return singleResponsibilityAgent(adapter, ['buildExecutionReport', 'reportExecution'], 'reported', 'EXECUTION_REPORTED', fallback);
    default:
      return undefined;
  }
}
