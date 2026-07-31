import fs from 'node:fs';
import path from 'node:path';

export interface TerminalCallbackOptions {
  url: string;
  token?: string;
  executionId: string;
  payload: Record<string, any>;
  attempts?: number;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  onAttempt?: (details: { attempt: number; status?: number; error?: string }) => void;
}

export interface TerminalCallbackAck {
  acknowledged: true;
  delivery_id: string;
  attempts: number;
  status: number;
}

type PendingTerminalDelivery = Pick<TerminalCallbackOptions, 'url' | 'token' | 'executionId' | 'payload'>;

const pendingDeliveryDir = () => process.env.ENGINE_PENDING_DELIVERIES_DIR || '/engine/pending-deliveries';
const pendingDeliveryPath = (executionId: string) => path.join(pendingDeliveryDir(), `${executionId}.json`);

// The terminal payload is written only to the Engine's private runtime volume
// (0700 directory, 0600 file). It is never emitted to logs and is removed as
// soon as the backend confirms its idempotent receipt.
export function persistPendingTerminalDelivery(options: PendingTerminalDelivery): void {
  fs.mkdirSync(pendingDeliveryDir(), { recursive: true, mode: 0o700 });
  const target = pendingDeliveryPath(options.executionId);
  const temporary = `${target}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(options), { mode: 0o600 });
  fs.renameSync(temporary, target);
  fs.chmodSync(target, 0o600);
}

export async function redeliverPendingTerminalResults(): Promise<number> {
  let names: string[] = [];
  try { names = fs.readdirSync(pendingDeliveryDir()).filter((name) => name.endsWith('.json')); } catch { return 0; }
  let delivered = 0;
  for (const name of names) {
    const file = path.join(pendingDeliveryDir(), name);
    try {
      const pending = JSON.parse(fs.readFileSync(file, 'utf8')) as PendingTerminalDelivery;
      if (!pending?.url || !pending?.token || !pending?.executionId || !pending?.payload) continue;
      await deliverTerminalResult({ ...pending, attempts: 3 });
      fs.unlinkSync(file);
      delivered += 1;
    } catch {
      // Keep the item for the next background recovery attempt.
    }
  }
  return delivered;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function terminalDeliveryId(executionId: string): string {
  return `ai-terminal:${executionId}`;
}

export async function deliverTerminalResult(options: TerminalCallbackOptions): Promise<TerminalCallbackAck> {
  const fetchImpl = options.fetchImpl || fetch;
  // A backend container can take tens of seconds to come back after a deploy
  // or migration. Keep retrying long enough to bridge that normal window.
  const maxAttempts = Math.max(1, Math.min(16, Number(options.attempts || 12)));
  const timeoutMs = Math.max(1000, Number(options.timeoutMs || 15_000));
  const deliveryId = terminalDeliveryId(options.executionId);
  const payload: Record<string, any> = {
    ...options.payload,
    metadata: {
      ...(options.payload.metadata || {}),
      terminal_delivery_id: deliveryId,
      terminal_sequence: 1,
      terminal_completed_at: new Date().toISOString(),
    },
  };
  let lastError = 'sin respuesta';

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'X-Idempotency-Key': deliveryId,
      };
      const correlationId = String(payload.correlation_id || '').trim();
      if (correlationId) headers['X-Correlation-ID'] = correlationId;
      if (options.token) headers['X-AI-Engine-Token'] = options.token;
      const response = await fetchImpl(options.url, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
        signal: controller.signal,
      });
      const body = await response.json().catch(() => ({}));
      const acknowledged = response.ok
        && String(body?.execution_id || body?.id || '') === String(options.executionId)
        && (body?.acknowledged === true || body?.ai_report?.report_complete === true)
        && (body?.report_complete === true || body?.ai_report?.report_complete === true)
        && String(body?.terminal_delivery_id || body?.ai_report?.terminal_delivery_id || '') === deliveryId;
      options.onAttempt?.({ attempt, status: response.status, ...(acknowledged ? {} : { error: 'ACK terminal incompleto' }) });
      if (acknowledged) return { acknowledged: true, delivery_id: deliveryId, attempts: attempt, status: response.status };
      lastError = `HTTP ${response.status}: ACK terminal incompleto`;
    } catch (error: any) {
      lastError = error?.name === 'AbortError' ? 'timeout de callback terminal' : String(error?.message || error);
      options.onAttempt?.({ attempt, error: lastError });
    } finally {
      clearTimeout(timeout);
    }
    if (attempt < maxAttempts) await sleep(Math.min(15_000, 500 * (2 ** (attempt - 1))));
  }
  throw new Error(`No se pudo confirmar la persistencia terminal despues de ${maxAttempts} intentos: ${lastError}`);
}
