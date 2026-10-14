import type { Page } from 'playwright';
import type { BrowserObservation, StrictAIAction, BrowserElementSnapshot } from './action-types.ts';

function identity(element: BrowserElementSnapshot): string | undefined {
  const name = element.name || element.label || element.text || element.title;
  return name?.trim() ? JSON.stringify([element.tag, element.role || '', name.trim(), element.type || '']) : undefined;
}

export function refreshCoordinateTarget(action: StrictAIAction, before: BrowserObservation, after: BrowserObservation): StrictAIAction | null {
  const original = before.elements.find((element) => element.ref === action.target_ref);
  const key = original && identity(original);
  if (!key || before.url !== after.url || after.readyState !== 'complete' || after.loadingSignals.length) return null;
  const matches = after.elements.filter((element) => identity(element) === key && element.visible && !element.disabled);
  if (matches.length !== 1) return null;
  const target = matches[0];
  const box = target.bbox;
  if (!box || box.width <= 0 || box.height <= 0) return null;
  return { ...action, target_ref: target.ref, x: box.x + box.width / 2, y: box.y + box.height / 2 };
}

export async function coordinateTargetAtPoint(page: Page, action: StrictAIAction): Promise<boolean> {
  if (!action.target_ref || !Number.isFinite(action.x) || !Number.isFinite(action.y)) return false;
  return page.evaluate(({ ref, x, y }) => {
    const targets = [...document.querySelectorAll('[data-ai-ref]')].filter((element) => element.getAttribute('data-ai-ref') === ref);
    if (targets.length !== 1) return false;
    const target = targets[0];
    const box = target.getBoundingClientRect();
    const hit = document.elementFromPoint(x, y);
    const style = getComputedStyle(target);
    return style.visibility !== 'hidden' && style.display !== 'none' && style.opacity !== '0'
      && !target.matches(':disabled, [aria-disabled="true"]')
      && x >= box.left && x <= box.right && y >= box.top && y <= box.bottom
      && Boolean(hit && (hit === target || target.contains(hit)));
  }, { ref: action.target_ref, x: Number(action.x), y: Number(action.y) }).catch(() => false);
}
