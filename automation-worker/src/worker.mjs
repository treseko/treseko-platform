import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { createJobExecutor } from "./job-executor.mjs";
import { createScriptRuntime } from "./script-runtime.mjs";
import { createReportRuntime } from "./report-runtime.mjs";
import { createApiRuntime } from "./api-runtime.mjs";
import { createArtifactRuntime } from "./artifact-runtime.mjs";
import { createWorkerValues } from "./worker-values.mjs";
import { createResultDelivery } from "./result-delivery.mjs";
import { createUpdateAdmission } from "./update-admission.mjs";
import { createClaimIntent } from "./claim-intent.mjs";
import { createLeaseHeartbeat } from "./lease-manager.mjs";
import { buildHeartbeatPayload } from "./heartbeat-payload.mjs";
import { claimConflictMessage, isClaimConflict } from "./queue-messages.mjs";
import { createTraceRuntime } from "./trace-runtime.mjs";
import { loadEnv, localIps, normalizeApiBase, readWorkerVersion } from "./worker-runtime-info.mjs";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { createWorkerCapabilities } from "./worker-capabilities.mjs";

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(ROOT_DIR, "..");
const envPath = path.join(ROOT_DIR, ".env");
const restartMarkerPath = path.join(ROOT_DIR, ".treseko-update-restart"); const rollbackMarkerPath = path.join(ROOT_DIR, ".treseko-update-rollback");
const RUN_ONCE = process.argv.includes("--once");
const startedAt = Date.now();
const STARTED_AT_ISO = new Date(startedAt).toISOString();

loadEnv(envPath, fs);

// Keep credentials outside the code tree for systemd installs. The local
// default remains compatible with Docker and developer checkouts.
const tokenPath = process.env.QA_RUNNER_TOKEN_FILE || path.join(ROOT_DIR, ".runner-token");
const pairingStatePath = process.env.QA_RUNNER_PAIRING_STATE_FILE || `${tokenPath}.pairing`;
const workerInstanceIdPath = process.env.QA_WORKER_INSTANCE_ID_FILE || path.join(ROOT_DIR, ".worker-instance-id");
const API_BASE = normalizeApiBase(process.env.QA_API_BASE || "http://localhost:8000");
const ORGANIZACION_ID = process.env.QA_ORGANIZACION_ID || process.env.QA_ORGANIZATION_ID || "";
const POLL_INTERVAL_MS = Number(process.env.QA_POLL_INTERVAL_MS || 3000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.QA_HEARTBEAT_INTERVAL_MS || 10000);
const REQUEST_TIMEOUT_MS = Number(process.env.QA_REQUEST_TIMEOUT_MS || 10000);
const HEADLESS = String(process.env.QA_HEADLESS || "true").toLowerCase() !== "false";
const ARTIFACT_MAX_BYTES = 10 * 1024 * 1024;
const ARTIFACT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt", ".json", ".csv", ".xml", ".pdf", ".zip", ".xls", ".xlsx", ".doc", ".docx", ".ppt", ".pptx", ".mp4", ".webm"]);
const RUNNER_NAME = process.env.QA_RUNNER_NAME || os.hostname() || "Local Playwright Worker";
const workerInstanceId = readOrCreateWorkerInstanceId();
const MAX_PARALLEL_JOBS = Number(process.env.QA_MAX_PARALLEL_JOBS || 1);
const TAGS = String(process.env.QA_RUNNER_TAGS || "local,v1,playwright")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const WORKER_VERSION = readWorkerVersion({
  candidates: [process.env.TRESEKO_WORKER_VERSION, process.env.TRESEKO_VERSION, path.join(ROOT_DIR, "VERSION"), process.env.npm_package_version].filter(Boolean),
  fs,
  require,
  packagePath: path.join(ROOT_DIR, "package.json"),
  fallback: "0.0.0-dev",
});
const RESULT_SPOOL_DIR = process.env.QA_RESULT_SPOOL_DIR
  || path.join(os.homedir(), ".treseko", "automation-worker", "result-spool");
const RESULT_RETRY_ATTEMPTS = Number(process.env.QA_RESULT_RETRY_ATTEMPTS || 3);
const RESULT_RETRY_BASE_MS = Number(process.env.QA_RESULT_RETRY_BASE_MS || 1000);
const RESULT_RETRY_MAX_MS = Number(process.env.QA_RESULT_RETRY_MAX_MS || 30_000);
const claimIntent = createClaimIntent(process.env.QA_CLAIM_INTENT_DIR
  || path.join(path.dirname(RESULT_SPOOL_DIR), "claim-intent"));
const updateAdmission = createUpdateAdmission({
  directory: process.env.QA_UPDATE_CONTROL_DIR || path.join(path.dirname(RESULT_SPOOL_DIR), "update-control"),
  version: WORKER_VERSION,
});

let runnerToken = process.env.QA_RUNNER_TOKEN || readTokenFile();
let runnerId = "";
let activeJobId = "";
let activeJobLeaseToken = "";
let activeJobs = 0;
let activeCorrelationId = "";

const { redactTraceText, safeTraceValue, traceEntry, formatLogArg } = createTraceRuntime({
  fs,
  path,
  repoRoot: REPO_ROOT,
  enabled: /^(1|true|yes|on)$/i.test(String(process.env.QA_TEST_TRACE_ENABLED || "")),
});

function readTokenFile() {
  if (!fs.existsSync(tokenPath)) return "";
  return fs.readFileSync(tokenPath, "utf8").trim();
}

function saveTokenFile(token) {
  fs.writeFileSync(tokenPath, token, { encoding: "utf8", mode: 0o600 });
}

function clearTokenFile() {
  try {
    fs.unlinkSync(tokenPath);
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
}

function isInvalidRunnerTokenError(error) {
  const code = String(error?.error_code || "").toUpperCase();
  const message = String(error?.message || "");
  return code === "UNAUTHORIZED" || code === "HTTP_401" || /runner token invalido/i.test(message);
}

function clearRunnerCredentials() {
  runnerToken = "";
  runnerId = "";
  clearTokenFile();
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const { contentTypeForFile, artifactFromBuffer, artifactFromFile, collectArtifacts } = createArtifactRuntime({
  fs, path, ARTIFACT_MAX_BYTES, ARTIFACT_EXTENSIONS,
});

const { traceRequestId, safeJsonParse, formatErrorDetail: formatErrorDetailRuntime, errorFromResponse, isDebugMode, shouldRunHeadless } = createWorkerValues({
  HEADLESS, redactTraceText,
});

const CORRELATION_HEADER = "X-Correlation-ID";
function formatErrorDetail(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return redactTraceText(detail);
  return formatErrorDetailRuntime(detail);
}

const apiState = {
  get runnerToken() { return runnerToken; },
  set runnerToken(value) { runnerToken = value; },
  get runnerId() { return runnerId; },
  set runnerId(value) { runnerId = value; },
  get activeCorrelationId() { return activeCorrelationId; },
  set activeCorrelationId(value) { activeCorrelationId = value; },
};

const { fetchJson, api, registerIfNeeded, pairWithPlatform, createPairingRequest } = createApiRuntime({
  API_BASE, REQUEST_TIMEOUT_MS, RUNNER_NAME, ORGANIZACION_ID, tokenPath, pairingStatePath, workerInstanceId, state: apiState,
  capabilities: () => capabilities(), isInvalidRunnerTokenError, clearRunnerCredentials,
  saveTokenFile, traceEntry, traceRequestId, errorFromResponse, safeJsonParse, sleep, performance,
});

function getPlaywrightVersion() {
  try {
    return require("playwright/package.json").version;
  } catch {
    return "unknown";
  }
}

function readOrCreateWorkerInstanceId() {
  try {
    if (fs.existsSync(workerInstanceIdPath)) return fs.readFileSync(workerInstanceIdPath, "utf8").trim();
    const id = randomUUID();
    fs.writeFileSync(workerInstanceIdPath, `${id}\n`, { mode: 0o600 });
    return id;
  } catch (_error) {
    return randomUUID();
  }
}

function getPackageVersion(packageName) {
  try {
    return require(`${packageName}/package.json`).version;
  } catch {
    return "unknown";
  }
}

function getPythonCommand() {
  return process.env.QA_PYTHON_BIN || (process.platform === "win32" ? "python" : "python3");
}

const { capabilities, resources } = createWorkerCapabilities({
  os, fs, process, rootDir: ROOT_DIR, workerVersion: WORKER_VERSION,
  apiBase: API_BASE, runnerName: RUNNER_NAME, tags: TAGS,
  maxParallelJobs: MAX_PARALLEL_JOBS, startedAtIso: STARTED_AT_ISO, startedAt,
  localIps, getPlaywrightVersion, getPackageVersion, getPythonCommand,
  getSeleniumVersion: () => process.env.QA_SELENIUM_VERSION || "python",
  workerInstanceId,
  getActiveJobs: () => activeJobs, getActiveJobId: () => activeJobId,
});

async function heartbeat(status = "ONLINE") {
  if (!runnerId) return;
  await api(`/automation-runners/${runnerId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify(buildHeartbeatPayload({
      status,
      capabilities: capabilities(),
      resources: resources(),
      activeJobs,
      currentJobId: activeJobId,
      leaseToken: activeJobLeaseToken,
      uptimeSeconds: Math.round((Date.now() - startedAt) / 1000),
    })),
  });
  restartIfUpdateIsReady();
}

const leaseHeartbeat = createLeaseHeartbeat({
  intervalMs: HEARTBEAT_INTERVAL_MS,
  heartbeat: () => heartbeat("BUSY"),
  log: (_event, message) => console.warn(message),
});

function restartIfUpdateIsReady() {
  if (activeJobs > 0 || fs.existsSync(rollbackMarkerPath) || !fs.existsSync(restartMarkerPath)) return;
  console.info("Actualizacion del worker lista; reiniciando el proceso para cargarla.");
  try {
    fs.unlinkSync(restartMarkerPath);
  } catch (error) {
    console.error("No se pudo consumir la marca de actualizacion del worker:", error?.message || error);
    return;
  }
  process.exit(0);
}

const {
  getValue, replacePlaceholders, normalizeDataset, compileScript, detectScriptFormat,
  playwrightBrowserForJob, frameworkKey, languageKey, localWorkerSupports,
  getPlaywrightCliPath, getPackageBinPath, preparePlaywrightTestSource, runCommand,
  scriptFileForJob, serializeJsonForSource, prepareNodeScriptSource,
  prepareSeleniumPythonSource,
} = createScriptRuntime({ capabilities, require, path, spawn, process });

const {
  classifyProcessFailure, processResultPayload, redact, withCorrelation: withCorrelationRuntime, isAssertionLike,
  normalizeJobStatus, normalizeStepStatus, normalizeStepResult, classifyPlaywrightFailure,
  parsePlaywrightJsonReport, decodePlaywrightOutputItem, collectPlaywrightTests,
  playwrightReportStatus, summarizePlaywrightReport, compactPlaywrightMetadata,
  playwrightReportArtifact,
} = createReportRuntime({
  performance, RUNNER_NAME, os, shouldRunHeadless, getPackageVersion, redactTraceText,
  artifactFromBuffer, getCorrelationId: () => activeCorrelationId,
});

function withCorrelation(result) {
  return {
    ...result,
    correlation_id: activeCorrelationId,
    ...(result.status === "ERROR" || result.status === "TIMEOUT"
      ? { error_code: result.error_code || (result.status === "TIMEOUT" ? "WORKER_TIMEOUT" : "WORKER_EXECUTION_ERROR") }
      : {}),
  };
}

const executeJob = createJobExecutor({
  RUNNER_NAME, ROOT_DIR, state: { get activeCorrelationId() { return activeCorrelationId; } },
  setActiveCorrelationId: (value) => { activeCorrelationId = value; },
  playwrightBrowserForJob, scriptFileForJob, preparePlaywrightTestSource, shouldRunHeadless,
  getPlaywrightCliPath, runCommand, parsePlaywrightJsonReport, summarizePlaywrightReport,
  classifyPlaywrightFailure, withCorrelation, collectArtifacts, playwrightReportArtifact,
  getPlaywrightVersion, isDebugMode, processResultPayload, prepareNodeScriptSource,
  getPackageBinPath, serializeJsonForSource, prepareSeleniumPythonSource, getPythonCommand,
  compileScript, normalizeDataset, normalizeStepResult, normalizeJobStatus, isAssertionLike,
  artifactFromBuffer, formatLogArg, formatErrorDetail, redact, replacePlaceholders,
  frameworkKey, languageKey, localWorkerSupports, detectScriptFormat, compactPlaywrightMetadata,
  allowLoopbackForTests: process.env.NODE_ENV === "test" && process.env.QA_API_WORKER_ALLOW_LOOPBACK_TESTS === "true",
});

const resultDelivery = createResultDelivery({
  spoolDir: RESULT_SPOOL_DIR,
  maxAttempts: RESULT_RETRY_ATTEMPTS,
  retryBaseMs: RESULT_RETRY_BASE_MS,
  retryMaxMs: RESULT_RETRY_MAX_MS,
  postResult: async (jobId, payload) => {
    const result = await api(`/automation-jobs/${jobId}/result`, {
      method: "POST", body: JSON.stringify(payload),
    });
    claimIntent.confirmed(jobId);
    return result;
  },
  log: (_event, message) => console.info(message),
});

async function activatePendingDeliveryLease(envelope) {
  activeJobId = String(envelope.job_id || "");
  activeJobLeaseToken = String(envelope.lease_token || "");
  activeJobs = activeJobId && activeJobLeaseToken ? 1 : 0;
  if (!activeJobs) return;
  leaseHeartbeat.start();
  // tick() deliberately absorbs temporary and permanent heartbeat errors.
  // The result POST remains authoritative: it either ACKs the event or sends
  // it to quarantine with the backend's final lease/ownership diagnosis.
  await leaseHeartbeat.tick();
}

async function releasePendingDeliveryLease() {
  leaseHeartbeat.stop();
  activeJobId = "";
  activeJobLeaseToken = "";
  activeJobs = 0;
  await heartbeat("ONLINE");
}

async function loop() {
  let lastHeartbeat = 0;

  while (true) {
    try {
      // Unpaired/idle workers can also acknowledge a safe stop. Pending results
      // must still go through normal delivery/lease handling before readiness.
      if (!claimIntent.pending() && activeJobs === 0 && resultDelivery.pendingFiles().length === 0
          && updateAdmission.pause({ activeJobs, pendingResults: 0 })) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (!runnerId) {
        await registerIfNeeded();
        if (!runnerId) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        await heartbeat("ONLINE");
        traceEntry("job_event", { message: "worker_started", runner_name: RUNNER_NAME, api_base: API_BASE, capabilities: capabilities() });
  console.log(`Worker ${RUNNER_NAME} conectado a ${API_BASE}. Ctrl+C para detener.`);
      }

      const hadPendingDelivery = resultDelivery.pendingFiles().length > 0;
      const pendingDelivered = await resultDelivery.flushPending({
        runOnce: RUN_ONCE,
        beforeEach: activatePendingDeliveryLease,
      });
      if (!pendingDelivered) {
        if (RUN_ONCE) {
          process.exitCode = 1;
          return;
        }
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      if (hadPendingDelivery && activeJobId) {
        await releasePendingDeliveryLease();
      }
      if (claimIntent.pending()) {
        updateAdmission.pause({ activeJobs, pendingResults: resultDelivery.pendingFiles().length,
          unresolvedClaims: 1 });
        const attemptId = claimIntent.attemptId();
        if (attemptId) {
          const decision = await api(`/automation-jobs/${claimIntent.pending()}/claim-intents/${attemptId}/reconcile`,
            { method: "POST" });
          claimIntent.reconciled(decision);
        }
        // No new jobs until the previous intent is authoritatively resolved.
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        await heartbeat(activeJobs > 0 ? "BUSY" : "ONLINE");
        lastHeartbeat = Date.now();
      }

      if (activeJobs >= MAX_PARALLEL_JOBS) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      if (updateAdmission.pause({ activeJobs, pendingResults: resultDelivery.pendingFiles().length })) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      const job = await api("/automation-jobs/next");
      if (!job) {
        if (RUN_ONCE) return;
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      traceEntry("job_event", {
        message: "job_received",
        job_id: job.id,
        job_type: job.job_type,
        required_framework: job.required_framework,
        required_language: job.required_language,
      });

      let claimed;
      try {
        // The request may have arrived while /next was in flight. If it arrives
        // during /claim, finish that claimed job before acknowledging readiness.
        if (updateAdmission.pause({ activeJobs, pendingResults: resultDelivery.pendingFiles().length })) {
          await sleep(POLL_INTERVAL_MS);
          continue;
        }
        claimIntent.begin(job.id);
        claimed = await api(`/automation-jobs/${job.id}/claim`, {
          method: "POST", headers: { "X-Claim-Intent": claimIntent.attemptId() },
        });
      } catch (error) {
        if (isClaimConflict(error)) {
          console.warn(claimConflictMessage(job.id));
          traceEntry("job_event", { message: "job_claim_conflict", job_id: job.id });
          await sleep(0);
          continue;
        }
        throw error;
      }
      traceEntry("job_event", {
        message: "job_claimed",
        job_id: claimed.id,
        job_type: claimed.job_type,
        required_framework: claimed.required_framework,
        required_language: claimed.required_language,
        attempt_count: claimed.attempt_count,
      });
      if (!claimed.lease_token || !claimed.lease_expires_at || !Number.isFinite(Number(claimed.attempt_count)) || !Number.isFinite(Number(claimed.max_attempts))) {
        throw new Error("El backend devolvió un claim incompleto: se requieren lease_token, lease_expires_at, attempt_count y max_attempts.");
      }
      activeJobId = claimed.id;
      activeJobLeaseToken = claimed.lease_token;
      activeJobs = 1;
      await heartbeat("BUSY");
      leaseHeartbeat.start();
      const isDryRun = claimed.job_type === "DRY_RUN" || claimed.payload_congelado?.dry_run === true;
      const jobLabel = claimed.payload_congelado?.case_code || claimed.caso_id || "DRY-RUN";
      console.log(`${isDryRun ? "Ejecutando prueba temporal del editor" : "Ejecutando job"} ${claimed.id} (${jobLabel})`);
      traceEntry("job_event", { message: "job_execution_started", job_id: claimed.id, job_label: jobLabel, dry_run: isDryRun });
      const result = await executeJob(claimed);
      console.log(`Resultado local del job ${claimed.id}: ${result.status}`);
      traceEntry("job_event", {
        message: "job_execution_finished",
        job_id: claimed.id,
        status: result.status,
        duration_seconds: result.duration_seconds,
      });
      const delivery = await resultDelivery.deliver({
        jobId: claimed.id,
        leaseToken: claimed.lease_token,
        resultEventId: randomUUID(),
        result,
        runOnce: RUN_ONCE,
      });
      if (delivery.status === "PENDING") {
        traceEntry("job_event", { message: "job_result_pending", job_id: claimed.id, status: result.status });
        console.warn(`Resultado del job ${claimed.id} pendiente; el lease seguirá renovándose hasta confirmar la entrega.`);
        continue;
      }
      leaseHeartbeat.stop();
      traceEntry("job_event", { message: "job_result_reported", job_id: claimed.id, status: result.status, delivery_status: delivery.status });
      if (delivery.status === "CONFIRMED") console.info(`Job ${claimed.id} reportado como ${result.status}. Resultado confirmado.`);
      activeJobId = "";
      activeJobLeaseToken = "";
      activeJobs = 0;
      await heartbeat("ONLINE");
      if (RUN_ONCE) return;
    } catch (error) {
      const failedJobId = activeJobId;
      const failedCorrelationId = activeCorrelationId;
      leaseHeartbeat.stop();
      activeJobId = "";
      activeJobLeaseToken = "";
      activeJobs = 0;
      console.error("Error procesando worker:", formatLogArg(error?.message || error), `correlation_id=${failedCorrelationId}`);
      traceEntry("error", {
        message: "worker_loop_error",
        active_job_id: failedJobId,
        correlation_id: failedCorrelationId,
        error: safeTraceValue({ message: error?.message || String(error), stack: error?.stack }),
      });
      if (error?.stack) console.error(formatLogArg(error.stack));
      await heartbeat("DEGRADED").catch(() => {});
      if (RUN_ONCE) {
        process.exitCode = 1;
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

export {
  artifactFromBuffer,
  classifyPlaywrightFailure,
  classifyProcessFailure,
  collectPlaywrightTests,
  compactPlaywrightMetadata,
  contentTypeForFile,
  detectScriptFormat,
  frameworkKey,
  getValue,
  isAssertionLike,
  isInvalidRunnerTokenError,
  languageKey,
  normalizeDataset,
  normalizeJobStatus,
  normalizeStepResult,
  normalizeStepStatus,
  parsePlaywrightJsonReport,
  playwrightReportStatus,
  redact,
  replacePlaceholders,
  safeJsonParse,
};

const invokedAsMain = process.argv[1]
  && path.resolve(process.argv[1]) === path.resolve(fileURLToPath(import.meta.url));
if (invokedAsMain) {
  // Diagnostic identity only: not a readiness/drain acknowledgement.
  updateAdmission.publishIdentity();
  loop();
}
