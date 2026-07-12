import type { Page } from 'playwright';
import type { ActionExecutionResult, BrowserObservation, StrictAIAction } from './action-types.ts';

const ACTIONS_WITH_TARGET = new Set(['click', 'type', 'select', 'assert_visible', 'assert_text']);
const ALLOWED_ACTIONS = new Set([
  'navigate',
  'click',
  'click_at',
  'type',
  'select',
  'press',
  'wait',
  'assert_visible',
  'assert_text',
  'finish',
  'fail',
  'blocked',
]);

const PLACEHOLDER_REASON_PATTERNS = [
  /motivo breve/i,
  /raz[oó]n breve/i,
  /^reason$/i,
  /^todo$/i,
  /^n\/a$/i,
  /^sin razon informada/i,
  /^la ia no informo un motivo util/i,
];

const MAX_WAIT_MS = 5 * 60 * 1000;
const STABLE_AFTER_ACTION_MS = 1000;
const TYPE_KEY_DELAY_MS = 45;

async function waitForInteractionSettle(page: Page, previousUrl?: string): Promise<void> {
  await Promise.race([
    previousUrl ? page.waitForURL((url) => url.toString() !== previousUrl, { timeout: 4000 }).catch(() => undefined) : Promise.resolve(undefined),
    page.waitForLoadState('networkidle', { timeout: 6000 }).catch(() => undefined),
    page.waitForTimeout(1200),
  ]);
  await page.waitForLoadState('domcontentloaded', { timeout: 3000 }).catch(() => undefined);
  await page.waitForTimeout(STABLE_AFTER_ACTION_MS);
}

function parseWaitMs(value: unknown): number {
  const raw = String(value ?? '').trim().toLowerCase();
  if (!raw) return 1500;
  const numeric = Number(raw);
  if (Number.isFinite(numeric)) {
    return numeric > 0 && numeric < 1000 ? numeric * 1000 : numeric;
  }
  const match = raw.match(/(\d+(?:[.,]\d+)?)\s*(ms|milisegundos?|s|seg|segundos?|m|min|minutos?)?/i);
  if (!match) return 1500;
  const amount = Number(match[1].replace(',', '.'));
  const unit = String(match[2] || 'ms').toLowerCase();
  if (!Number.isFinite(amount)) return 1500;
  if (unit.startsWith('m') && unit !== 'ms') return amount * 60 * 1000;
  if (unit === 's' || unit.startsWith('seg')) return amount * 1000;
  return amount;
}

export function isPlaceholderReason(reason?: string): boolean {
  const value = String(reason || '').trim();
  if (!value) return true;
  return PLACEHOLDER_REASON_PATTERNS.some((pattern) => pattern.test(value));
}

export function normalizeUrl(value: string): string {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}

export function normalizeAction(raw: any, fallbackStepNumber: number): StrictAIAction {
  const action = String(raw?.action || 'blocked').trim() as StrictAIAction['action'];
  const rawReason = String(raw?.reason || raw?.thought || '').slice(0, 500);
  const x = raw?.x ?? raw?.coordinate_x ?? raw?.coords?.x ?? raw?.coordinates?.x;
  const y = raw?.y ?? raw?.coordinate_y ?? raw?.coords?.y ?? raw?.coordinates?.y;
  return {
    action: (ALLOWED_ACTIONS.has(action) ? action : 'blocked') as StrictAIAction['action'],
    target_ref: raw?.target_ref || raw?.elementId || raw?.selector || undefined,
    x: Number.isFinite(Number(x)) ? Number(x) : undefined,
    y: Number.isFinite(Number(y)) ? Number(y) : undefined,
    value: raw?.value ?? raw?.text ?? raw?.url ?? undefined,
    reason: isPlaceholderReason(rawReason) ? 'La IA no informo un motivo util para esta accion.' : rawReason,
    expected: raw?.expected || raw?.expected_result || undefined,
    confidence: Number.isFinite(Number(raw?.confidence)) ? Number(raw.confidence) : 0,
    step_number: Number.isFinite(Number(raw?.step_number)) ? Number(raw.step_number) : fallbackStepNumber,
  };
}

export function validateAction(action: StrictAIAction, observation: BrowserObservation, currentStepNumber: number): { ok: boolean; reason: string } {
  if (!ALLOWED_ACTIONS.has(action.action)) return { ok: false, reason: `Accion no permitida: ${action.action}` };
  if (action.step_number !== currentStepNumber) return { ok: false, reason: `La accion apunta al paso ${action.step_number}, pero se esta ejecutando el paso ${currentStepNumber}` };
  if (['blocked', 'fail'].includes(action.action) && isPlaceholderReason(action.reason)) {
    return { ok: false, reason: 'La IA devolvio un bloqueo sin motivo diagnostico real' };
  }
  if (ACTIONS_WITH_TARGET.has(action.action)) {
    if (!action.target_ref) return { ok: false, reason: `La accion ${action.action} requiere target_ref` };
    const target = observation.elements.find((el) => el.ref === action.target_ref);
    if (!target) return { ok: false, reason: `No existe el target ${action.target_ref} en el snapshot actual` };
    if (!target.visible) return { ok: false, reason: `El target ${action.target_ref} no esta visible` };
    if (target.disabled) return { ok: false, reason: `El target ${action.target_ref} esta deshabilitado` };
    if (action.action === 'type' && !target.editable) return { ok: false, reason: `El target ${action.target_ref} no es editable` };
    if (action.action === 'click' && !target.clickable && !target.editable) return { ok: false, reason: `El target ${action.target_ref} no parece clickeable` };
  }
  if (action.action === 'click_at') {
    if (!Number.isFinite(action.x) || !Number.isFinite(action.y)) return { ok: false, reason: 'La accion click_at requiere coordenadas x/y' };
    const viewport = observation.viewport;
    if (viewport && (Number(action.x) < 0 || Number(action.y) < 0 || Number(action.x) > viewport.width || Number(action.y) > viewport.height)) {
      return { ok: false, reason: `Las coordenadas ${action.x},${action.y} estan fuera del viewport` };
    }
  }
  if (['navigate', 'type', 'select', 'press', 'assert_text'].includes(action.action) && !String(action.value || '').trim()) {
    return { ok: false, reason: `La accion ${action.action} requiere value` };
  }
  return { ok: true, reason: 'Accion valida' };
}

export function shouldUseCoordinateClickFallback(action: StrictAIAction, validationReason: string): boolean {
  return action.action === 'click'
    && Number.isFinite(action.x)
    && Number.isFinite(action.y)
    && /(no parece clickeable|requiere target_ref|no existe el target)/i.test(validationReason);
}

export function toCoordinateClickFallback(action: StrictAIAction, validationReason: string): StrictAIAction {
  const reason = String(action.reason || '').trim();
  return {
    ...action,
    action: 'click_at',
    target_ref: undefined,
    reason: `${reason || 'Click visual por coordenadas.'} Fallback visual: ${validationReason}`,
  };
}

export async function executeStrictAction(page: Page, action: StrictAIAction): Promise<ActionExecutionResult> {
  const started = Date.now();
  try {
    let command = '';
    const target = action.target_ref ? page.locator(`[data-ai-ref="${action.target_ref}"]`) : null;

    switch (action.action) {
      case 'navigate': {
        const url = normalizeUrl(String(action.value || ''));
        command = `page.goto(${JSON.stringify(url)})`;
        await page.goto(url, { waitUntil: 'networkidle', timeout: 30000 });
        await page.waitForTimeout(STABLE_AFTER_ACTION_MS);
        break;
      }
      case 'click': {
        if (!target) throw new Error('click requiere target_ref');
        const previousUrl = page.url();
        command = `locator(${action.target_ref}).click()`;
        await target.scrollIntoViewIfNeeded({ timeout: 5000 });
        await target.click({ timeout: 8000 });
        await waitForInteractionSettle(page, previousUrl);
        break;
      }
      case 'click_at': {
        const x = Number(action.x);
        const y = Number(action.y);
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('click_at requiere coordenadas x/y');
        const previousUrl = page.url();
        command = `page.mouse.click(${Math.round(x)}, ${Math.round(y)})`;
        await page.mouse.click(x, y);
        await waitForInteractionSettle(page, previousUrl);
        break;
      }
      case 'type': {
        if (!target) throw new Error('type requiere target_ref');
        const previousUrl = page.url();
        command = `locator(${action.target_ref}).pressSequentially(${JSON.stringify(action.value || '')})`;
        await target.scrollIntoViewIfNeeded({ timeout: 5000 });
        await target.click({ timeout: 5000 });
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+A' : 'Control+A').catch(() => undefined);
        await target.pressSequentially(String(action.value || ''), { delay: TYPE_KEY_DELAY_MS, timeout: 15000 });
        await waitForInteractionSettle(page, previousUrl);
        break;
      }
      case 'select': {
        if (!target) throw new Error('select requiere target_ref');
        const previousUrl = page.url();
        command = `locator(${action.target_ref}).selectOption(${JSON.stringify(action.value || '')})`;
        await target.scrollIntoViewIfNeeded({ timeout: 5000 });
        await target.selectOption(String(action.value || ''), { timeout: 8000 });
        await waitForInteractionSettle(page, previousUrl);
        break;
      }
      case 'press': {
        const previousUrl = page.url();
        command = `page.keyboard.press(${JSON.stringify(action.value || 'Enter')})`;
        if (target) await target.focus();
        await page.keyboard.press(String(action.value || 'Enter'));
        await waitForInteractionSettle(page, previousUrl);
        break;
      }
      case 'wait': {
        const ms = Math.min(MAX_WAIT_MS, Math.max(500, parseWaitMs(action.value)));
        command = `page.waitForTimeout(${ms})`;
        await page.waitForTimeout(ms);
        break;
      }
      case 'assert_visible': {
        if (!target) throw new Error('assert_visible requiere target_ref');
        command = `expect locator(${action.target_ref}) visible`;
        await target.waitFor({ state: 'visible', timeout: 5000 });
        break;
      }
      case 'assert_text': {
        const text = String(action.value || '');
        command = `assert text visible ${JSON.stringify(text)}`;
        if (target) {
          const content = await target.innerText({ timeout: 5000 }).catch(() => '');
          if (!content.toLowerCase().includes(text.toLowerCase())) throw new Error(`Texto no encontrado en target: ${text}`);
        } else {
          const bodyText = await page.locator('body').innerText({ timeout: 5000 });
          if (!bodyText.toLowerCase().includes(text.toLowerCase())) throw new Error(`Texto no visible: ${text}`);
        }
        break;
      }
      case 'finish':
        command = 'finish';
        break;
      case 'fail':
        command = 'fail';
        throw new Error(action.reason || 'La IA marco el paso como fallido');
      case 'blocked':
        command = 'blocked';
        throw new Error(action.reason || 'La IA bloqueo el paso');
      default:
        throw new Error(`Accion no soportada: ${(action as any).action}`);
    }

    await page.waitForLoadState('networkidle', { timeout: 5000 }).catch(() => undefined);
    return { ok: true, command, message: `Accion ejecutada en ${Date.now() - started}ms` };
  } catch (error: any) {
    return {
      ok: false,
      command: action.action,
      message: error?.message || String(error),
      error: error?.stack || error?.message || String(error),
    };
  }
}
