import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

const RETRYABLE_NETWORK_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENETUNREACH",
  "ENOTFOUND",
  "EAI_AGAIN",
  "ETIMEDOUT",
  "UPSTREAM_UNAVAILABLE",
  "UPSTREAM_TIMEOUT",
]);

function ensureDirectory(directory) {
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(directory, 0o700); } catch (_) { /* best effort on Windows */ }
}

function safeName(value) {
  return String(value || "unknown").replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 120);
}

function publicError(error) {
  const status = Number(error?.http_status || error?.status || 0) || null;
  const code = String(error?.error_code || error?.code || "DELIVERY_ERROR").slice(0, 80);
  const message = String(error?.message || "Error desconocido")
    .replace(/(bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/((?:token|secret|password|api[_-]?key|authorization)\s*[:=]\s*)[^\s,;}]+/gi, "$1[redacted]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 500);
  return { status, code, message };
}

function statusOf(error) {
  return Number(error?.http_status || error?.status || String(error?.error_code || "").match(/^HTTP_(\d+)$/)?.[1] || 0);
}

function isRetryableDeliveryError(error) {
  const status = statusOf(error);
  if (status >= 500 || [408, 425, 429].includes(status)) return true;
  if (status >= 400) return false;
  if (error?.retryable === true) return true;
  return RETRYABLE_NETWORK_CODES.has(String(error?.error_code || error?.code || "").toUpperCase())
    || error?.name === "TypeError"
    || error?.name === "AbortError";
}

function deliveryMessage(error, jobId) {
  const text = String(error?.message || "").toLowerCase();
  if (/lease|vencid|expir|reemplaz/.test(text)) return `El lease del job ${jobId} venció o fue reemplazado; el resultado quedó en cuarentena.`;
  if (/otro runner|otro worker|owner|tomado por otro/.test(text)) return `El job ${jobId} pertenece a otro worker; el resultado quedó en cuarentena.`;
  if (/diferente|idempot|event_id|evento/.test(text)) return `El backend rechazó un resultado diferente para el job ${jobId}; quedó en cuarentena.`;
  return `El backend rechazó el resultado del job ${jobId}; quedó en cuarentena.`;
}

function backoffMs(attempt, baseMs, maxMs) {
  return Math.min(maxMs, baseMs * (2 ** Math.max(0, attempt - 1)));
}

export function createResultDelivery({
  spoolDir,
  postResult,
  log = () => {},
  sleep = (ms) => new Promise(resolve => setTimeout(resolve, ms)),
  now = () => new Date().toISOString(),
  uuid = randomUUID,
  maxAttempts = 3,
  retryBaseMs = 1000,
  retryMaxMs = 30_000,
  fsImpl = fs,
} = {}) {
  if (!spoolDir) throw new Error("Se requiere un directorio de spool para las entregas.");
  if (typeof postResult !== "function") throw new Error("Se requiere una función para reportar resultados.");

  const quarantineDir = path.join(spoolDir, "quarantine");

  function envelopePath(envelope) {
    return path.join(spoolDir, `${safeName(envelope.job_id)}-${safeName(envelope.result_event_id)}.json`);
  }

  function persist(envelope) {
    ensureDirectory(spoolDir);
    const target = envelopePath(envelope);
    if (fsImpl.existsSync(target)) return target;
    const temporary = `${target}.${process.pid}.${uuid()}.tmp`;
    const contents = JSON.stringify(envelope);
    fsImpl.writeFileSync(temporary, contents, { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fsImpl.chmodSync(temporary, 0o600); } catch (_) { /* best effort on Windows */ }
    fsImpl.renameSync(temporary, target);
    return target;
  }

  function readEnvelope(filePath) {
    return JSON.parse(fsImpl.readFileSync(filePath, "utf8"));
  }

  function pendingFiles() {
    ensureDirectory(spoolDir);
    return fsImpl.readdirSync(spoolDir)
      .filter(name => name.endsWith(".json"))
      .sort()
      .map(name => path.join(spoolDir, name));
  }

  function quarantine(filePath, envelope, error, attempts) {
    ensureDirectory(quarantineDir);
    const stem = path.basename(filePath, ".json");
    const target = path.join(quarantineDir, `${stem}.quarantine.json`);
    fsImpl.renameSync(filePath, target);
    const diagnosticPath = path.join(quarantineDir, `${stem}.diagnostic.json`);
    const diagnostic = {
      job_id: envelope.job_id,
      result_event_id: envelope.result_event_id,
      quarantined_at: now(),
      attempts,
      reason: publicError(error),
    };
    fsImpl.writeFileSync(diagnosticPath, JSON.stringify(diagnostic, null, 2), { encoding: "utf8", mode: 0o600, flag: "wx" });
    try { fsImpl.chmodSync(diagnosticPath, 0o600); } catch (_) { /* best effort on Windows */ }
    return target;
  }

  async function deliverEnvelope(envelope, { persistedPath = null, runOnce = false } = {}) {
    const filePath = persistedPath || persist(envelope);
    let lastError = null;
    const attemptsLimit = Math.max(1, Number(maxAttempts) || 1);
    for (let attempt = 1; attempt <= attemptsLimit; attempt += 1) {
      try {
        await postResult(envelope.job_id, envelope.payload);
        fsImpl.unlinkSync(filePath);
        log("confirmed", `Resultado del job ${envelope.job_id} confirmado y spool eliminado.`);
        return { status: "CONFIRMED", attempts: attempt };
      } catch (error) {
        lastError = error;
        if (!isRetryableDeliveryError(error)) {
          quarantine(filePath, envelope, error, attempt);
          log("quarantined", deliveryMessage(error, envelope.job_id));
          const outcome = { status: "QUARANTINED", attempts: attempt, error: publicError(error) };
          if (runOnce) {
            const deliveryError = new Error(`La entrega del resultado del job ${envelope.job_id} fue rechazada y quedó en cuarentena.`);
            deliveryError.error_code = "RESULT_DELIVERY_QUARANTINED";
            deliveryError.retryable = false;
            deliveryError.delivery = outcome;
            throw deliveryError;
          }
          return outcome;
        }
        if (attempt < attemptsLimit) {
          log("pending", `Resultado del job ${envelope.job_id} pendiente de reenvío; se reintentará con backoff.`);
          await sleep(backoffMs(attempt, retryBaseMs, retryMaxMs));
        }
      }
    }
    log("pending", `Resultado del job ${envelope.job_id} pendiente de reenvío; se conserva en spool.`);
    const error = new Error(`No se confirmó la entrega del resultado del job ${envelope.job_id}.`);
    error.error_code = "RESULT_DELIVERY_PENDING";
    error.retryable = true;
    error.cause = lastError;
    if (runOnce) throw error;
    return { status: "PENDING", attempts: attemptsLimit, error: publicError(lastError) };
  }

  async function deliver({ jobId, leaseToken, resultEventId = uuid(), result, runOnce = false } = {}) {
    if (!jobId || !leaseToken || !result) throw new Error("La entrega requiere job, lease y resultado.");
    const payload = { ...result, lease_token: leaseToken, result_event_id: resultEventId };
    const envelope = {
      version: 1,
      job_id: String(jobId),
      result_event_id: String(resultEventId),
      lease_token: String(leaseToken),
      created_at: now(),
      payload,
    };
    const filePath = persist(envelope);
    // If the same event was already durably persisted, use that exact copy.
    // This prevents a second in-process attempt from changing the payload
    // associated with an event id before the backend confirms it.
    return deliverEnvelope(readEnvelope(filePath), { persistedPath: filePath, runOnce });
  }

  async function flushPending({ runOnce = false, beforeEach = null } = {}) {
    let allConfirmed = true;
    for (const filePath of pendingFiles()) {
      let envelope;
      try {
        envelope = readEnvelope(filePath);
      } catch (error) {
        const fallback = { job_id: path.basename(filePath), result_event_id: "unknown" };
        quarantine(filePath, fallback, error, 0);
        log("quarantined", `Se aisló una entrega pendiente inválida en cuarentena.`);
        continue;
      }
      if (typeof beforeEach === "function") await beforeEach(envelope);
      const outcome = await deliverEnvelope(envelope, { persistedPath: filePath, runOnce });
      if (outcome.status === "PENDING") {
        allConfirmed = false;
        break;
      }
    }
    return allConfirmed;
  }

  return { deliver, flushPending, pendingFiles, persist, quarantine, isRetryableDeliveryError };
}

export { deliveryMessage, isRetryableDeliveryError };
