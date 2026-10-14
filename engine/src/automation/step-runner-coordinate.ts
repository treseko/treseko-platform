import type { Page } from 'playwright';
import type { BrowserObservation, StrictAIAction } from './action-types.ts';
import { observeBrowser } from './observation.ts';
import { toCoordinateClickFallback, validateAction } from './action-executor.ts';
import { refreshCoordinateTarget } from './coordinate-click-safety.ts';

export async function revalidateCoordinateClick(
  page: Page,
  action: StrictAIAction,
  before: BrowserObservation,
  executionId: string,
  stepNumber: number,
  failureValidation: { ok: boolean; reason: string; [key: string]: unknown },
) {
  const observation = await observeBrowser(page, executionId, stepNumber);
  const screenshot = await page.screenshot();
  const originalValidation = failureValidation;
  const refreshedTarget = refreshCoordinateTarget(action, before, observation);
  const nextAction = refreshedTarget ? toCoordinateClickFallback(refreshedTarget, failureValidation.reason) : action;
  const validation = refreshedTarget
    ? validateAction(nextAction, observation, stepNumber)
    : { ok: false, reason: 'El objetivo del clic no se pudo confirmar en la observacion nueva; se requiere replanificar.' };
  return { action: nextAction, observation, screenshot, validation, originalValidation };
}

export function auditCoordinatePostValidation(action: StrictAIAction, result: { ok: boolean; reason: string; conclusive?: boolean }) {
  if (action.coordinate_fallback && !result.conclusive) {
    return { ok: false, conclusive: false, reason: 'Clic por coordenadas ejecutado; su efecto requiere auditoria con la evidencia posterior.' };
  }
  return result;
}
