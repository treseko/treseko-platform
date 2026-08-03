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
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(ROOT_DIR, "..");
const envPath = path.join(ROOT_DIR, ".env");
const restartMarkerPath = path.join(ROOT_DIR, ".treseko-update-restart"); const rollbackMarkerPath = path.join(ROOT_DIR, ".treseko-update-rollback");
const RUN_ONCE = process.argv.includes("--once");
const startedAt = Date.now();
const STARTED_AT_ISO = new Date(startedAt).toISOString();

loadEnv(envPath);

// Keep credentials outside the code tree for systemd installs. The local
// default remains compatible with Docker and developer checkouts.
const tokenPath = process.env.QA_RUNNER_TOKEN_FILE || path.join(ROOT_DIR, ".runner-token");
const API_BASE = (process.env.QA_API_BASE || "http://localhost:8000").replace(/\/+$/, "");
const ORGANIZACION_ID = process.env.QA_ORGANIZACION_ID || process.env.QA_ORGANIZATION_ID || "";
const POLL_INTERVAL_MS = Number(process.env.QA_POLL_INTERVAL_MS || 3000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.QA_HEARTBEAT_INTERVAL_MS || 10000);
const REQUEST_TIMEOUT_MS = Number(process.env.QA_REQUEST_TIMEOUT_MS || 10000);
const HEADLESS = String(process.env.QA_HEADLESS || "true").toLowerCase() !== "false";
const ARTIFACT_MAX_BYTES = 10 * 1024 * 1024;
const ARTIFACT_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".webp",
  ".gif",
  ".txt",
  ".json",
  ".csv",
  ".xml",
  ".pdf",
  ".zip",
  ".xls",
  ".xlsx",
  ".doc",
  ".docx",
  ".ppt",
  ".pptx",
  ".mp4",
  ".webm",
]);
const RUNNER_NAME = process.env.QA_RUNNER_NAME || os.hostname() || "Local Playwright Worker";
const MAX_PARALLEL_JOBS = Number(process.env.QA_MAX_PARALLEL_JOBS || 1);
const TAGS = String(process.env.QA_RUNNER_TAGS || "local,v1,playwright")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);
const WORKER_VERSION = readWorkerVersion();

let runnerToken = process.env.QA_RUNNER_TOKEN || readTokenFile();
let runnerId = "";
let activeJobId = "";
let activeJobs = 0;
let activeCorrelationId = "";

function localIps() {
  const interfaces = os.networkInterfaces();
  const ips = [];
  for (const entries of Object.values(interfaces)) {
    for (const entry of entries || []) {
      if (!entry.internal && entry.family === "IPv4") ips.push(entry.address);
    }
  }
  return ips;
}

function readWorkerVersion() {
  const candidates = [
    process.env.TRESEKO_WORKER_VERSION,
    process.env.TRESEKO_VERSION,
    path.join(ROOT_DIR, "VERSION"),
    process.env.npm_package_version,
  ].filter(Boolean);
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (!String(candidate).includes("/") && !String(candidate).includes("\\")) return String(candidate).trim();
    try {
      if (fs.existsSync(candidate)) {
        const version = fs.readFileSync(candidate, "utf8").trim();
        if (version) return version;
      }
    } catch (_) {
      // Version lookup must not prevent worker startup.
    }
  }
  try {
    return require(path.join(ROOT_DIR, "package.json")).version || "0.0.0-dev";
  } catch (_) {
    return "0.0.0-dev";
  }
}

function traceEnabled() {
  return String(process.env.QA_TEST_TRACE_ENABLED || "").toLowerCase().match(/^(1|true|yes|on)$/);
}

const TRACE_SECRET_KEY = /(authorization|api[_-]?key|cookie|password|refresh[_-]?token|secret|token|credential|private[_-]?key)/i;
const TRACE_SECRET_TEXT = /(authorization|api[_-]?key|cookie|password|refresh[_-]?token|secret|token|credential|private[_-]?key|key)(\s*[:=]\s*)(bearer\s+)?[^\s&,'"}]+/gi;
function redactTraceText(value) {
  return String(value).replace(TRACE_SECRET_TEXT, (_match, key, separator) => `${key}${separator}[redacted]`);
}

function safeTraceValue(value, depth = 0) {
  if (depth > 8) return "[max-depth]";
  if (value == null || typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "string") {
    const redacted = redactTraceText(value);
    return redacted.length > 2000 ? `${redacted.slice(0, 2000)}…` : redacted;
  }
  if (Array.isArray(value)) return value.slice(0, 50).map(item => safeTraceValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [
      key,
      TRACE_SECRET_KEY.test(key) ? "[redacted]" : safeTraceValue(item, depth + 1),
    ]));
  }
  return String(value);
}

function traceEntry(event, payload = {}) {
  if (!traceEnabled()) return;
  const dir = path.join(REPO_ROOT, "logs", "test-trace");
  fs.mkdirSync(dir, { recursive: true });
  const day = new Date().toISOString().slice(0, 10);
  const entry = {
    ts: new Date().toISOString(),
    source: "automation-worker",
    event,
    ...payload,
  };
  fs.appendFileSync(path.join(dir, `automation-worker-${day}.jsonl`), `${JSON.stringify(safeTraceValue(entry))}\n`, "utf8");
}

function loadEnv(filePath) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

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

function formatLogArg(arg) {
  if (typeof arg === "string") return redactTraceText(arg);
  if (arg instanceof Error) return redactTraceText(arg.message || String(arg));
  try {
    return JSON.stringify(safeTraceValue(arg));
  } catch {
    return redactTraceText(String(arg));
  }
}

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
  API_BASE, REQUEST_TIMEOUT_MS, RUNNER_NAME, ORGANIZACION_ID, tokenPath, state: apiState,
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

function resources() {
  const memoryUsedMb = Math.round((os.totalmem() - os.freemem()) / 1024 / 1024);
  let diskFreeMb = null;
  try {
    if (typeof fs.statfsSync === "function") {
      const stats = fs.statfsSync(ROOT_DIR);
      diskFreeMb = Math.round((stats.bavail * stats.bsize) / 1024 / 1024);
    }
  } catch {
    diskFreeMb = null;
  }
  return {
    memory_used_mb: memoryUsedMb,
    memory_total_mb: Math.round(os.totalmem() / 1024 / 1024),
    disk_free_mb: diskFreeMb,
    loadavg: os.loadavg?.() || [],
  };
}

function capabilities() {
  const frameworkLanguages = {
    playwright: ["javascript", "typescript"],
    puppeteer: ["javascript", "typescript"],
    cypress: ["javascript", "typescript"],
    selenium: ["python"],
  };
  const versions = {
    automation_worker: WORKER_VERSION,
    playwright: getPlaywrightVersion(),
    puppeteer: getPackageVersion("puppeteer"),
    cypress: getPackageVersion("cypress"),
    selenium: process.env.QA_SELENIUM_VERSION || "python",
  };
  return {
    frameworks: ["playwright", "puppeteer", "cypress", "selenium"],
    component: "automation-worker",
    component_version: WORKER_VERSION,
    worker_version: WORKER_VERSION,
    framework_languages: frameworkLanguages,
    languages: frameworkLanguages,
    language_status: {
      playwright: { javascript: "local_worker_supported", typescript: "local_worker_supported" },
      puppeteer: { javascript: "local_worker_supported", typescript: "local_worker_supported" },
      cypress: { javascript: "local_worker_supported", typescript: "local_worker_supported" },
      selenium: { python: "local_worker_supported" },
    },
    versions,
    playwright_version: getPlaywrightVersion(),
    puppeteer_version: versions.puppeteer,
    cypress_version: versions.cypress,
    selenium_version: versions.selenium,
    selenium_language: "python",
    python_bin: getPythonCommand(),
    browsers: ["chromium", "firefox", "webkit", "chrome (puppeteer)", "cypress"],
    os: `${os.type()} ${os.release()}`,
    platform: process.platform,
    arch: process.arch,
    hostname: os.hostname(),
    local_ips: localIps(),
    pid: process.pid,
    api_base: API_BASE,
    started_at: STARTED_AT_ISO,
    node_version: process.version,
    tags: TAGS,
    max_parallel_jobs: MAX_PARALLEL_JOBS,
    active_jobs: activeJobs,
    current_job_id: activeJobId || null,
    uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
  };
}

async function heartbeat(status = "ONLINE") {
  if (!runnerId) return;
  await api(`/automation-runners/${runnerId}/heartbeat`, {
    method: "POST",
    body: JSON.stringify({
      estado: status,
      capabilities: capabilities(),
      resources: resources(),
      active_jobs: activeJobs,
      current_job_id: activeJobId || null,
      uptime_seconds: Math.round((Date.now() - startedAt) / 1000),
    }),
  });
  restartIfUpdateIsReady();
}

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
});

async function loop() {
  let lastHeartbeat = 0;

  while (true) {
    try {
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

      if (Date.now() - lastHeartbeat > HEARTBEAT_INTERVAL_MS) {
        await heartbeat(activeJobs > 0 ? "BUSY" : "ONLINE");
        lastHeartbeat = Date.now();
      }

      if (activeJobs >= MAX_PARALLEL_JOBS) {
        await sleep(POLL_INTERVAL_MS);
        continue;
      }

      const job = await api("/automation-jobs/next");
      if (!job) {
        if (RUN_ONCE) return;
        await sleep(POLL_INTERVAL_MS);
        continue;
      }
      traceEntry("job_event", { message: "job_received", job });

      const claimed = await api(`/automation-jobs/${job.id}/claim`, { method: "POST" });
      traceEntry("job_event", { message: "job_claimed", job: claimed });
      activeJobId = claimed.id;
      activeJobs = 1;
      await heartbeat("BUSY");
      const isDryRun = claimed.job_type === "DRY_RUN" || claimed.payload_congelado?.dry_run === true;
      const jobLabel = claimed.payload_congelado?.case_code || claimed.caso_id || "DRY-RUN";
      console.log(`${isDryRun ? "Ejecutando prueba temporal del editor" : "Ejecutando job"} ${claimed.id} (${jobLabel})`);
      traceEntry("job_event", { message: "job_execution_started", job_id: claimed.id, job_label: jobLabel, dry_run: isDryRun });
      const result = await executeJob(claimed);
      console.log(`Resultado local del job ${claimed.id}: ${result.status}`);
      traceEntry("job_event", { message: "job_execution_finished", job_id: claimed.id, result });
      await api(`/automation-jobs/${claimed.id}/result`, {
        method: "POST",
        body: JSON.stringify(result),
      });
      traceEntry("job_event", { message: "job_result_reported", job_id: claimed.id, status: result.status });
      console.log(`Job ${claimed.id} reportado como ${result.status}`);
      activeJobId = "";
      activeJobs = 0;
      await heartbeat("ONLINE");
      if (RUN_ONCE) return;
    } catch (error) {
      const failedJobId = activeJobId;
      const failedCorrelationId = activeCorrelationId;
      activeJobId = "";
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
if (invokedAsMain) loop();
