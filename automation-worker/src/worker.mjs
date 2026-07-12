import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { performance } from "node:perf_hooks";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO_ROOT = path.resolve(ROOT_DIR, "..");
const envPath = path.join(ROOT_DIR, ".env");
const tokenPath = path.join(ROOT_DIR, ".runner-token");
const RUN_ONCE = process.argv.includes("--once");
const startedAt = Date.now();
const STARTED_AT_ISO = new Date(startedAt).toISOString();

loadEnv(envPath);

const API_BASE = (process.env.QA_API_BASE || "http://localhost:8000").replace(/\/+$/, "");
const ORGANIZACION_ID = process.env.QA_ORGANIZACION_ID || process.env.QA_ORGANIZATION_ID || "";
const POLL_INTERVAL_MS = Number(process.env.QA_POLL_INTERVAL_MS || 3000);
const HEARTBEAT_INTERVAL_MS = Number(process.env.QA_HEARTBEAT_INTERVAL_MS || 10000);
const REQUEST_TIMEOUT_MS = Number(process.env.QA_REQUEST_TIMEOUT_MS || 10000);
const HEADLESS = String(process.env.QA_HEADLESS || "true").toLowerCase() !== "false";
const ARTIFACT_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif", ".txt"]);
const RUNNER_NAME = process.env.QA_RUNNER_NAME || os.hostname() || "Local Playwright Worker";
const MAX_PARALLEL_JOBS = Number(process.env.QA_MAX_PARALLEL_JOBS || 1);
const TAGS = String(process.env.QA_RUNNER_TAGS || "local,v1,playwright")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

let runnerToken = process.env.QA_RUNNER_TOKEN || readTokenFile();
let runnerId = "";
let activeJobId = "";
let activeJobs = 0;

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

function traceEnabled() {
  return String(process.env.QA_TEST_TRACE_ENABLED || "").toLowerCase().match(/^(1|true|yes|on)$/);
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
  fs.appendFileSync(path.join(dir, `automation-worker-${day}.jsonl`), `${JSON.stringify(entry)}\n`, "utf8");
}

function traceRequestId() {
  return `worker-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function safeJsonParse(text) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function formatLogArg(arg) {
  if (typeof arg === "string") return arg;
  if (arg instanceof Error) return arg.stack || arg.message;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function formatErrorDetail(detail) {
  if (!detail) return "";
  if (typeof detail === "string") return detail;
  return formatLogArg(detail);
}

function isDebugMode(job) {
  const payload = job?.payload_congelado || {};
  return payload.debug_mode === true || payload.debug_mode === "true" || payload.debug === true || payload.debug === "true";
}

function shouldRunHeadless(job) {
  return HEADLESS && !isDebugMode(job);
}

function contentTypeForFile(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".png") return "image/png";
  if (ext === ".jpg" || ext === ".jpeg") return "image/jpeg";
  if (ext === ".webp") return "image/webp";
  if (ext === ".gif") return "image/gif";
  if (ext === ".txt") return "text/plain";
  return "application/octet-stream";
}

function artifactFromBuffer({ filename, contentType = "image/png", buffer, type = "screenshot", stepNumber = null }) {
  if (!buffer?.length) return null;
  return {
    type,
    filename,
    content_type: contentType,
    base64: Buffer.from(buffer).toString("base64"),
    step_number: stepNumber,
  };
}

function artifactFromFile(filePath, type = "screenshot") {
  try {
    const stat = fs.statSync(filePath);
    if (!stat.isFile() || stat.size <= 0 || stat.size > 10 * 1024 * 1024) return null;
    return artifactFromBuffer({
      filename: path.basename(filePath),
      contentType: contentTypeForFile(filePath),
      buffer: fs.readFileSync(filePath),
      type,
    });
  } catch {
    return null;
  }
}

function collectArtifacts(rootDir) {
  const artifacts = [];
  const visit = (dir) => {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        visit(fullPath);
      } else if (ARTIFACT_EXTENSIONS.has(path.extname(entry.name).toLowerCase())) {
        const artifact = artifactFromFile(fullPath, path.extname(entry.name).toLowerCase() === ".txt" ? "log" : "screenshot");
        if (artifact) artifacts.push(artifact);
      }
    }
  };
  visit(rootDir);
  return artifacts;
}

async function fetchJson(url, options = {}) {
  const requestId = options.requestId || traceRequestId();
  const started = performance.now();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  traceEntry("http_request", {
    request_id: requestId,
    method: options.method || "GET",
    url,
    headers: options.headers || {},
    body: safeJsonParse(options.body),
  });
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    traceEntry("http_response", {
      request_id: requestId,
      method: options.method || "GET",
      url,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: safeJsonParse(options.body),
      response_body: data ?? text,
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
    });
    if (!response.ok) throw new Error(formatErrorDetail(data?.detail || text || `HTTP ${response.status}`));
    return data;
  } catch (error) {
    traceEntry("error", {
      request_id: requestId,
      method: options.method || "GET",
      url,
      headers: options.headers || {},
      body: safeJsonParse(options.body),
      duration_ms: Math.round((performance.now() - started) * 100) / 100,
      error: { message: error?.message || String(error), stack: error?.stack },
    });
    if (error?.name === "AbortError") {
      throw new Error(`Timeout conectando con ${url}. Verifica que el backend este iniciado y reiniciado en ${API_BASE}.`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function api(pathname, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    ...(runnerToken ? { "X-Runner-Token": runnerToken } : {}),
    ...(options.headers || {}),
  };
  return fetchJson(`${API_BASE}${pathname}`, { ...options, headers });
}

async function registerIfNeeded() {
  if (runnerToken) {
    const me = await api("/automation-runners/me");
    runnerId = me.id;
    return;
  }

  const registrationToken = process.env.QA_REGISTRATION_TOKEN || "";
  if (!registrationToken || registrationToken.includes("paste_registration_token_here")) {
    await pairWithPlatform();
    return;
  }

  const registerUrl = `${API_BASE}/automation-runners/register`;
  const registerBody = {
    registration_token: registrationToken,
    nombre: RUNNER_NAME,
    tipo: "LOCAL",
    capabilities: capabilities(),
  };
  const registerRequestId = traceRequestId();
  const registerStarted = performance.now();
  traceEntry("http_request", {
    request_id: registerRequestId,
    method: "POST",
    url: registerUrl,
    headers: { "Content-Type": "application/json" },
    body: registerBody,
  });
  const created = await fetch(registerUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(registerBody),
  }).then(async (response) => {
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    traceEntry("http_response", {
      request_id: registerRequestId,
      method: "POST",
      url: registerUrl,
      status: response.status,
      headers: Object.fromEntries(response.headers.entries()),
      body: registerBody,
      response_body: data ?? text,
      duration_ms: Math.round((performance.now() - registerStarted) * 100) / 100,
    });
    if (!response.ok) throw new Error(data?.detail || text || `HTTP ${response.status}`);
    return data;
  });

  runnerToken = created.runner_token;
  runnerId = created.id;
  saveTokenFile(runnerToken);
  console.log(`Worker vinculado como ${created.nombre}. Token guardado en ${tokenPath}`);
}

async function pairWithPlatform() {
  while (!runnerToken) {
    console.log(`Solicitando vinculacion a ${API_BASE}...`);
    const request = await createPairingRequest();
    const expiresAt = new Date(request.expires_at).getTime();
    console.log("");
    console.log(`Worker esperando vinculacion. Codigo: ${request.code}.`);
    console.log(`Apruebalo en Automatizacion > Workers. Expira: ${new Date(request.expires_at).toLocaleString()}.`);

    while (Date.now() < expiresAt && !runnerToken) {
      await sleep(3000);
      const status = await fetchJson(`${API_BASE}/automation-runners/pairing-requests/${encodeURIComponent(request.code)}`, {
        headers: {
          "Content-Type": "application/json",
          "X-Pairing-Token": request.pairing_token,
        },
      });

      if (status.estado === "APPROVED" && status.runner_token) {
        runnerToken = status.runner_token;
        runnerId = status.runner?.id || "";
        saveTokenFile(runnerToken);
        console.log(`Worker vinculado como ${status.runner?.nombre || RUNNER_NAME}. Token guardado en ${tokenPath}`);
        return;
      }

      if (status.estado === "DENIED") {
        console.log("Solicitud rechazada. Se generara un nuevo codigo en unos segundos.");
        break;
      }

      if (status.estado === "EXPIRED") {
        console.log("Solicitud expirada. Se generara un nuevo codigo.");
        break;
      }
    }
  }
}

async function createPairingRequest() {
  return fetchJson(`${API_BASE}/automation-runners/pairing-requests`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      nombre: RUNNER_NAME,
      tipo: "LOCAL",
      organizacion_id: ORGANIZACION_ID || null,
      capabilities: capabilities(),
      ttl_minutes: 10,
    }),
  });
}

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
    playwright: getPlaywrightVersion(),
    puppeteer: getPackageVersion("puppeteer"),
    cypress: getPackageVersion("cypress"),
    selenium: process.env.QA_SELENIUM_VERSION || "python",
  };
  return {
    frameworks: ["playwright", "puppeteer", "cypress", "selenium"],
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
    browsers: ["chromium"],
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
}

function getValue(source, key) {
  if (!source || !key) return "";
  if (Object.prototype.hasOwnProperty.call(source, key)) return source[key];
  const shortKey = key.includes(".") ? key.split(".").pop() : key;
  return source[shortKey] ?? "";
}

function replacePlaceholders(text, variables) {
  return String(text || "").replace(/\{\{\s*([A-Za-z0-9_.-]+)\s*\}\}/g, (_, key) => {
    const value = getValue(variables, key);
    return String(value ?? "");
  });
}

function normalizeDataset(dataset) {
  const output = {};
  if (Array.isArray(dataset)) {
    for (const item of dataset) {
      if (item && item.key) output[item.key] = item.value ?? "";
    }
  } else if (dataset && typeof dataset === "object") {
    Object.assign(output, dataset);
  }
  return output;
}

function compileScript(script) {
  const source = String(script || "").trim();
  if (!source) throw new Error("El job no incluye script automatizado");
  try {
    const candidate = new Function(`return (${source});`)();
    if (typeof candidate === "function") return candidate;
  } catch {
    // Si no es una funcion, se ejecuta como cuerpo async.
  }
  return async (context) => {
    const runner = new Function("context", `with (context) { return (async () => {\n${source}\n})(); }`);
    return runner(context);
  };
}

function detectScriptFormat(script) {
  const source = String(script || "");
  if (/@playwright\/test/.test(source) || /\btest\s*\(/.test(source) || /\bexpect\s*\(/.test(source)) {
    return "playwright_test";
  }
  return "worker_function";
}

function frameworkKey(job) {
  const payload = job.payload_congelado || {};
  return String(payload.framework || job.required_framework || "playwright").split(":", 1)[0].split("@", 1)[0].trim().toLowerCase() || "playwright";
}

function languageKey(job) {
  const payload = job.payload_congelado || {};
  const framework = frameworkKey(job);
  const language = String(job.required_language || payload.language || payload.lenguaje || "").trim().toLowerCase();
  if (language) return language === "ts" ? "typescript" : language === "js" ? "javascript" : language;
  return framework === "selenium" ? "python" : "javascript";
}

function localWorkerSupports(framework, language) {
  const matrix = capabilities().framework_languages || {};
  return Array.isArray(matrix[framework]) && matrix[framework].includes(language);
}

function getPlaywrightCliPath() {
  const packagePath = require.resolve("playwright/package.json");
  return path.join(path.dirname(packagePath), "cli.js");
}

function getPackageBinPath(packageName, relativeBinPath) {
  const packagePath = require.resolve(`${packageName}/package.json`);
  return path.join(path.dirname(packagePath), relativeBinPath);
}

function getPlaywrightTestRequirePath() {
  return JSON.stringify(require.resolve("playwright/test"));
}

function preparePlaywrightTestSource(script, variables) {
  let source = String(script || "").trim();
  const playwrightTestRequirePath = getPlaywrightTestRequirePath();
  source = source.replace(
    /import\s+\{([^}]+)\}\s+from\s+['"]@playwright\/test['"];?/g,
    `const {$1} = require(${playwrightTestRequirePath});`
  );
  source = source.replace(
    /import\s+\*\s+as\s+(\w+)\s+from\s+['"]@playwright\/test['"];?/g,
    `const $1 = require(${playwrightTestRequirePath});`
  );
  source = source.replace(
    /require\(\s*['"](?:@playwright\/test|playwright\/test)['"]\s*\)/g,
    `require(${playwrightTestRequirePath})`
  );
  if (!/(?:@playwright\/test|playwright\/test)/.test(source)) {
    source = `const { test, expect } = require(${playwrightTestRequirePath});\n` + source;
  }
  const serializedVariables = JSON.stringify(variables || {}, null, 2);
  return [
    `const variables = ${serializedVariables};`,
    "const dataset = variables;",
    source,
  ].join("\n\n");
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: options.cwd,
      env: options.env || process.env,
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs || 300000);

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      resolve({ code: 1, stdout, stderr: `${stderr}\n${error.stack || error.message}`, timedOut });
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      resolve({ code: code ?? 1, stdout, stderr, timedOut });
    });
  });
}

function executableScriptFile(script) {
  const source = String(script || "");
  return /\b(import|export)\s|:\s*[A-Za-z_$][A-Za-z0-9_$<>,\s[\]]*(?:[=,)])|interface\s+\w+|type\s+\w+\s*=/.test(source)
    ? "job.ts"
    : "job.js";
}

function scriptFileForJob(job, script) {
  const payload = job.payload_congelado || {};
  return String(payload.language || payload.lenguaje || "").toLowerCase() === "typescript"
    ? "job.ts"
    : executableScriptFile(script);
}

function serializeJsonForSource(value) {
  return JSON.stringify(value || {}, null, 2).replace(/<\/script/gi, "<\\/script");
}

function prepareNodeScriptSource(script, variables, job, framework) {
  return [
    `globalThis.variables = ${serializeJsonForSource(variables)};`,
    "globalThis.dataset = globalThis.variables;",
    `globalThis.job = ${serializeJsonForSource(job)};`,
    `globalThis.QA_FRAMEWORK = ${JSON.stringify(framework)};`,
    "globalThis.QA_ARTIFACTS_DIR = process.env.QA_ARTIFACTS_DIR;",
    "globalThis.captureScreenshot = async (page, name = 'screenshot.png') => {",
    "  const path = await import('node:path');",
    "  const fileName = String(name).toLowerCase().endsWith('.png') ? String(name) : `${name}.png`;",
    "  const output = path.join(globalThis.QA_ARTIFACTS_DIR || '.', fileName);",
    "  return page.screenshot({ path: output, fullPage: true });",
    "};",
    String(script || "").trim(),
  ].join("\n\n");
}

function prepareSeleniumPythonSource(script, variables, job) {
  return [
    "import json",
    "import os",
    `variables = json.loads(${JSON.stringify(JSON.stringify(variables || {}))})`,
    "dataset = variables",
    `job = json.loads(${JSON.stringify(JSON.stringify(job || {}))})`,
    "QA_ARTIFACTS_DIR = os.environ.get('QA_ARTIFACTS_DIR')",
    "QA_HEADLESS = os.environ.get('QA_HEADLESS') == 'true'",
    "def capture_screenshot(driver, name='screenshot.png'):",
    "    if not QA_ARTIFACTS_DIR:",
    "        return None",
    "    filename = name if str(name).lower().endswith('.png') else f'{name}.png'",
    "    output = os.path.join(QA_ARTIFACTS_DIR, filename)",
    "    driver.save_screenshot(output)",
    "    return output",
    "",
    String(script || "").trim(),
  ].join("\n");
}

function classifyProcessFailure(output, timedOut) {
  if (timedOut) return "TIMEOUT";
  const text = String(output || "");
  if (/AssertionError|assertion failed|expected .* to|Timed out retrying|cy\..*failed|expect\(.*\)/i.test(text)) {
    return "FAILED";
  }
  if (/SyntaxError|ReferenceError|ImportError|ModuleNotFoundError|Cannot find module|ERR_MODULE|No tests found|Can't run because|Executable doesn't exist|WebDriverException|SessionNotCreatedException/i.test(text)) {
    return "ERROR";
  }
  return "FAILED";
}

function processResultPayload({ job, framework, started, result, successObservation, failureObservation, metadata = {}, artifacts = [] }) {
  const output = redact([result.stdout, result.stderr].filter(Boolean).join("\n"));
  const status = result.code === 0 ? "PASSED" : classifyProcessFailure(output, result.timedOut);
  return {
    status,
    duration_seconds: Math.round((performance.now() - started) / 1000),
    observations: status === "PASSED"
      ? successObservation
      : result.timedOut
        ? "La ejecucion supero el timeout configurado."
        : failureObservation,
    logs: output,
    error_message: status === "PASSED" ? null : output,
    metadata: {
      worker: RUNNER_NAME,
      framework,
      framework_version: getPackageVersion(framework === "selenium" ? "selenium-webdriver" : framework),
      headless: shouldRunHeadless(job),
      os: os.type(),
      ...metadata,
    },
    artifacts: status === "PASSED" ? [] : artifacts,
    steps: [],
  };
}

function redact(text) {
  return String(text || "").replace(/(password|token|secret|key)=([^\s\n]+)/gi, "$1=[redacted]");
}

function isAssertionLike(error) {
  const name = String(error?.name || "");
  const message = String(error?.message || "");
  return name.includes("Assertion") || message.includes("strictEqual") || message.includes("not ok");
}

function normalizeJobStatus(status) {
  const value = String(status || "PASSED").trim().toUpperCase();
  if (["PASS", "PASO", "PASSED", "OK"].includes(value)) return "PASSED";
  if (["FAIL", "FALLO", "FAILED"].includes(value)) return "FAILED";
  if (["BLOCK", "BLOQUEADO", "BLOCKED"].includes(value)) return "BLOCKED";
  if (["ERROR", "TIMEOUT", "CANCELLED"].includes(value)) return value;
  return "PASSED";
}

function normalizeStepStatus(status) {
  const value = String(status || "PASO").trim().toUpperCase();
  if (["PASS", "PASSED", "PASO", "OK"].includes(value)) return "PASO";
  if (["FAIL", "FAILED", "FALLO"].includes(value)) return "FALLO";
  if (["BLOCK", "BLOCKED", "BLOQUEADO"].includes(value)) return "BLOQUEADO";
  if (value === "SIN_CORRER") return "SIN_CORRER";
  return "PASO";
}

function normalizeStepResult(step, index) {
  return {
    number: Number(step?.number ?? step?.numero_paso ?? step?.step ?? index + 1),
    status: normalizeStepStatus(step?.status ?? step?.estado ?? step?.resultado),
    observations: step?.observations ?? step?.observaciones ?? step?.comment ?? step?.comentarios ?? null,
    evidence_url: step?.evidence_url ?? step?.evidencia_url ?? null,
    error_log: step?.error_log ?? step?.errorLog ?? step?.error ?? null,
  };
}

function classifyPlaywrightFailure(output, timedOut) {
  if (timedOut) return "TIMEOUT";
  const text = String(output || "");
  if (/SyntaxError|ReferenceError|Cannot find module|Executable doesn't exist|No tests found|Error: Cannot|ERR_MODULE/i.test(text)) {
    return "ERROR";
  }
  return "FAILED";
}

function parsePlaywrightJsonReport(stdout) {
  const text = String(stdout || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      try {
        return JSON.parse(text.slice(start, end + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}

function decodePlaywrightOutputItem(item) {
  if (!item) return "";
  if (typeof item.text === "string") return item.text;
  if (typeof item.buffer === "string") {
    try {
      return Buffer.from(item.buffer, "base64").toString("utf8");
    } catch {
      return item.buffer;
    }
  }
  return "";
}

function collectPlaywrightTests(report) {
  const tests = [];
  const visitSuite = (suite, parents = []) => {
    const suiteTitle = suite?.title ? [...parents, suite.title] : parents;
    for (const spec of suite?.specs || []) {
      const titleParts = [...suiteTitle, spec.title].filter(Boolean);
      for (const test of spec.tests || []) {
        for (const result of test.results || []) {
          tests.push({
            title: titleParts.join(" > "),
            status: result.status || test.status || "unknown",
            expected_status: test.expectedStatus || "passed",
            duration_ms: Number(result.duration || 0),
            worker_index: result.workerIndex,
            retry: result.retry,
            errors: (result.errors || []).map((error) => error.message || error.stack || String(error)).filter(Boolean),
            stdout: (result.stdout || []).map(decodePlaywrightOutputItem).filter(Boolean),
            stderr: (result.stderr || []).map(decodePlaywrightOutputItem).filter(Boolean),
          });
        }
      }
    }
    for (const child of suite?.suites || []) {
      visitSuite(child, suiteTitle);
    }
  };
  for (const suite of report?.suites || []) {
    visitSuite(suite);
  }
  return tests;
}

function playwrightReportStatus(report, tests) {
  const explicitStatus = report?.stats?.status || report?.status;
  if (explicitStatus) return explicitStatus;
  if (!tests || tests.length === 0) {
    return (report?.errors || []).length > 0 ? "error" : "unknown";
  }
  const statuses = tests.map((test) => String(test.status || "").toLowerCase());
  if (statuses.some((status) => ["failed", "unexpected"].includes(status))) return "failed";
  if (statuses.some((status) => ["timedout", "timedOut".toLowerCase()].includes(status))) return "timedOut";
  if (statuses.some((status) => status === "interrupted")) return "interrupted";
  if (statuses.every((status) => status === "skipped")) return "skipped";
  if (statuses.every((status) => ["passed", "skipped"].includes(status))) return "passed";
  return "unknown";
}

function summarizePlaywrightReport(report, stderr = "") {
  if (!report) return null;
  const tests = collectPlaywrightTests(report);
  const stats = report.stats || {};
  const overallStatus = playwrightReportStatus(report, tests);
  const lines = [];
  lines.push("Respuesta de Playwright");
  lines.push("=======================");
  lines.push(`Estado general: ${String(overallStatus).toUpperCase()}`);
  lines.push(`Inicio: ${stats.startTime || "-"}`);
  lines.push(`Duracion: ${Math.round(Number(stats.duration || 0))} ms`);
  lines.push(`Tests detectados: ${tests.length}`);
  lines.push("");

  if (tests.length > 0) {
    lines.push("Resultados por test:");
    for (const test of tests) {
      lines.push(`- ${String(test.status).toUpperCase()} | ${test.title} | ${test.duration_ms} ms`);
      if (test.stdout.length > 0) {
        lines.push("  stdout:");
        for (const value of test.stdout) lines.push(`  ${value.trim()}`);
      }
      if (test.stderr.length > 0) {
        lines.push("  stderr:");
        for (const value of test.stderr) lines.push(`  ${value.trim()}`);
      }
      if (test.errors.length > 0) {
        lines.push("  errores:");
        for (const value of test.errors) lines.push(`  ${value.trim()}`);
      }
    }
  }

  if ((report.errors || []).length > 0) {
    lines.push("");
    lines.push("Errores del runner:");
    for (const error of report.errors) {
      lines.push(`- ${(error.message || error.stack || String(error)).trim()}`);
    }
  }

  if (stderr) {
    lines.push("");
    lines.push("stderr del proceso:");
    lines.push(String(stderr).trim());
  }

  return { text: lines.join("\n"), tests };
}

async function executePlaywrightTestJob(job, script, variables, started) {
  const payload = job.payload_congelado || {};
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "qa-worker-"));
  const specFile = scriptFileForJob(job, script).endsWith(".ts") ? "job.spec.ts" : "job.spec.js";
  const specPath = path.join(workspace, specFile);
  const configPath = path.join(workspace, "playwright.config.cjs");
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(specPath, preparePlaywrightTestSource(script, variables), "utf8");
    fs.writeFileSync(configPath, [
      "module.exports = {",
      `  timeout: ${timeoutMs},`,
      "  use: {",
      `    headless: ${shouldRunHeadless(job) ? "true" : "false"},`,
      "    screenshot: 'only-on-failure'",
      "  }",
      "};",
    ].join("\n"), "utf8");
    const playwrightCli = getPlaywrightCliPath();
    const result = await runCommand(
      process.execPath,
      [
        playwrightCli,
        "test",
        specFile,
        "--reporter=json",
        "--config",
        configPath,
        shouldRunHeadless(job) ? "" : "--headed",
      ].filter(Boolean),
      {
        cwd: workspace,
        timeoutMs,
        env: {
          ...process.env,
          QA_WORKER_JOB_ID: job.id,
          QA_WORKER_DRY_RUN: payload.dry_run ? "true" : "false",
          QA_ARTIFACTS_DIR: workspace,
        },
      }
    );
    const report = parsePlaywrightJsonReport(result.stdout);
    const summary = summarizePlaywrightReport(report, result.stderr);
    const combined = [
      summary?.text,
      report ? `\nReporte JSON de Playwright:\n${JSON.stringify(report, null, 2)}` : null,
      !report ? result.stdout : null,
      result.stderr,
    ].filter(Boolean).join("\n");
    const testStatuses = summary?.tests?.map((test) => test.status) || [];
    const hasFunctionalFailure = testStatuses.some((status) => ["failed", "timedOut", "interrupted"].includes(status));
    const status = result.code === 0
      ? "PASSED"
      : report && hasFunctionalFailure
        ? "FAILED"
        : classifyPlaywrightFailure(combined, result.timedOut);
    return {
      status,
      duration_seconds: Math.round((performance.now() - started) / 1000),
      observations: status === "PASSED"
        ? "Playwright Test finalizo correctamente."
        : result.timedOut
          ? "La ejecucion supero el timeout configurado."
          : "Playwright Test finalizo con errores.",
      logs: redact(combined),
      error_message: status === "PASSED" ? null : redact(combined),
      metadata: {
        worker: RUNNER_NAME,
        framework: payload.framework || "playwright",
        framework_version: getPlaywrightVersion(),
        script_format: "playwright_test",
        playwright_report: report,
        playwright_tests: summary?.tests || [],
        headless: shouldRunHeadless(job),
        debug_mode: isDebugMode(job),
        os: os.type(),
      },
      artifacts: status === "PASSED" ? [] : collectArtifacts(workspace),
      steps: [],
    };
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function executePuppeteerJob(job, script, variables, started) {
  const payload = job.payload_congelado || {};
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "qa-worker-puppeteer-"));
  const scriptFile = scriptFileForJob(job, script);
  const scriptPath = path.join(workspace, scriptFile);
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(scriptPath, prepareNodeScriptSource(script, variables, job, "puppeteer"), "utf8");
    const tsxCli = getPackageBinPath("tsx", "dist/cli.mjs");
    const result = await runCommand(process.execPath, [tsxCli, scriptPath], {
      cwd: workspace,
      timeoutMs,
      env: {
        ...process.env,
        NODE_PATH: path.join(ROOT_DIR, "node_modules"),
        QA_WORKER_JOB_ID: job.id,
        QA_WORKER_DRY_RUN: payload.dry_run ? "true" : "false",
        QA_HEADLESS: shouldRunHeadless(job) ? "true" : "false",
        QA_ARTIFACTS_DIR: workspace,
      },
    });
    return processResultPayload({
      job,
      framework: "puppeteer",
      started,
      result,
      successObservation: "Puppeteer finalizo correctamente.",
      failureObservation: "Puppeteer finalizo con errores.",
      metadata: { script_format: "node_script" },
      artifacts: collectArtifacts(workspace),
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function executeCypressJob(job, script, variables, started) {
  const payload = job.payload_congelado || {};
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "qa-worker-cypress-"));
  const specPath = path.join(workspace, scriptFileForJob(job, script).endsWith(".ts") ? "job.cy.ts" : "job.cy.js");
  const configPath = path.join(workspace, "cypress.config.cjs");
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(specPath, String(script || "").trim(), "utf8");
    fs.writeFileSync(configPath, [
      "const { defineConfig } = require('cypress');",
      "module.exports = defineConfig({",
      "  video: false,",
      "  screenshotOnRunFailure: true,",
      `  screenshotsFolder: ${JSON.stringify(path.join(workspace, "cypress", "screenshots").replace(/\\/g, "/"))},`,
      "  e2e: {",
      "    supportFile: false,",
      `    specPattern: ${JSON.stringify(specPath.replace(/\\/g, "/"))},`,
      `    baseUrl: ${JSON.stringify(variables.base_url || variables.BASE_URL || variables["ENV.BASE_URL"] || null)},`,
      `    env: ${serializeJsonForSource(variables)}`,
      "  }",
      "});",
    ].join("\n"), "utf8");
    const cypressBin = getPackageBinPath("cypress", path.join("bin", "cypress"));
    const result = await runCommand(process.execPath, [
      cypressBin,
      "run",
      "--config-file",
      configPath,
      "--spec",
      specPath,
      "--browser",
      "chromium",
      shouldRunHeadless(job) ? "--headless" : "--headed",
    ], {
      cwd: workspace,
      timeoutMs,
      env: {
        ...process.env,
        NODE_PATH: path.join(ROOT_DIR, "node_modules"),
        QA_WORKER_JOB_ID: job.id,
        QA_WORKER_DRY_RUN: payload.dry_run ? "true" : "false",
        QA_ARTIFACTS_DIR: workspace,
      },
    });
    return processResultPayload({
      job,
      framework: "cypress",
      started,
      result,
      successObservation: "Cypress finalizo correctamente.",
      failureObservation: "Cypress finalizo con errores.",
      metadata: { script_format: "cypress_spec" },
      artifacts: collectArtifacts(workspace),
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function executeSeleniumPythonJob(job, script, variables, started) {
  const payload = job.payload_congelado || {};
  const workspace = fs.mkdtempSync(path.join(os.tmpdir(), "qa-worker-selenium-"));
  const scriptPath = path.join(workspace, "job.py");
  const timeoutMs = Math.max(1, Number(job.timeout_seconds || payload.timeout_seconds || 300)) * 1000;
  try {
    fs.writeFileSync(scriptPath, prepareSeleniumPythonSource(script, variables, job), "utf8");
    const result = await runCommand(getPythonCommand(), [scriptPath], {
      cwd: workspace,
      timeoutMs,
      env: {
        ...process.env,
        QA_WORKER_JOB_ID: job.id,
        QA_WORKER_DRY_RUN: payload.dry_run ? "true" : "false",
        QA_HEADLESS: shouldRunHeadless(job) ? "true" : "false",
        QA_ARTIFACTS_DIR: workspace,
      },
    });
    return processResultPayload({
      job,
      framework: "selenium",
      started,
      result,
      successObservation: "Selenium Python finalizo correctamente.",
      failureObservation: "Selenium Python finalizo con errores.",
      metadata: {
        script_format: "python_script",
        language: "python",
        python_bin: getPythonCommand(),
      },
      artifacts: collectArtifacts(workspace),
    });
  } finally {
    fs.rmSync(workspace, { recursive: true, force: true });
  }
}

async function executePlaywrightWorkerFunctionJob(job, script, variables, started) {
  const logs = [];
  const payload = job.payload_congelado || {};
  let browser;
  let page;
  try {
    const { chromium } = await import("playwright");
    browser = await chromium.launch({ headless: shouldRunHeadless(job) });
    page = await browser.newPage();
    const fn = compileScript(script);
    const context = {
      page,
      browser,
      variables,
      dataset: normalizeDataset(payload.dataset),
      job,
      assert,
      log: (...args) => logs.push(args.map(formatLogArg).join(" ")),
    };
    const customResult = await fn(context);
    const steps = Array.isArray(customResult?.steps)
      ? customResult.steps.map(normalizeStepResult)
      : [];
    return {
      status: normalizeJobStatus(customResult?.status),
      duration_seconds: Math.round((performance.now() - started) / 1000),
      observations: customResult?.observations || "Worker automatizado finalizo correctamente.",
      logs: redact([logs.join("\n"), formatErrorDetail(customResult?.logs)].filter(Boolean).join("\n")),
      metadata: {
        worker: RUNNER_NAME,
        framework: payload.framework || "playwright",
        framework_version: getPlaywrightVersion(),
        script_format: "worker_function",
        headless: shouldRunHeadless(job),
        debug_mode: isDebugMode(job),
        os: os.type(),
      },
      artifacts: Array.isArray(customResult?.artifacts) ? customResult.artifacts : [],
      steps,
    };
  } catch (error) {
    const functionalFailure = isAssertionLike(error);
    let screenshotArtifact = null;
    if (page) {
      try {
        screenshotArtifact = artifactFromBuffer({
          filename: `automation-${String(job.id).slice(0, 8)}-failure.png`,
          buffer: await page.screenshot({ fullPage: true }),
          type: "screenshot",
        });
      } catch {
        screenshotArtifact = null;
      }
    }
    return {
      status: functionalFailure ? "FAILED" : "ERROR",
      duration_seconds: Math.round((performance.now() - started) / 1000),
      observations: error?.message || "La prueba automatizada fallo.",
      logs: redact(logs.join("\n")),
      error_message: redact(error?.stack || String(error)),
      metadata: {
        worker: RUNNER_NAME,
        framework: payload.framework || "playwright",
        framework_version: getPlaywrightVersion(),
        script_format: "worker_function",
        headless: shouldRunHeadless(job),
        debug_mode: isDebugMode(job),
        os: os.type(),
      },
      artifacts: screenshotArtifact ? [screenshotArtifact] : [],
      steps: [],
    };
  } finally {
    if (browser) await browser.close().catch(() => {});
  }
}

async function executeJob(job) {
  const payload = job.payload_congelado || {};
  const variables = {
    ...(payload.variables || {}),
    ...normalizeDataset(payload.dataset),
    ...normalizeDataset(payload.case_variables),
  };
  const script = replacePlaceholders(payload.script, variables);
  const started = performance.now();

  const framework = frameworkKey(job);
  const language = languageKey(job);
  if (!localWorkerSupports(framework, language)) {
    return {
      status: "ERROR",
      duration_seconds: 0,
      observations: `Lenguaje no soportado por este worker: ${framework} + ${language}`,
      logs: "",
      error_message: `Este worker local no ejecuta ${framework} + ${language}. Vincula un worker especializado que anuncie esa capacidad.`,
      metadata: { worker: RUNNER_NAME, framework, language, os: os.type() },
      steps: [],
    };
  }
  if (framework === "puppeteer") return executePuppeteerJob(job, script, variables, started);
  if (framework === "cypress") return executeCypressJob(job, script, variables, started);
  if (framework === "selenium") return executeSeleniumPythonJob(job, script, variables, started);
  if (framework !== "playwright") {
    return {
      status: "ERROR",
      duration_seconds: 0,
      observations: `Framework no soportado por este worker: ${framework}`,
      logs: "",
      error_message: `Framework no soportado por este worker: ${framework}`,
      metadata: { worker: RUNNER_NAME, framework, os: os.type() },
      steps: [],
    };
  }

  const detectedScriptFormat = detectScriptFormat(script);
  const scriptFormat = payload.script_format === "playwright_test" || detectedScriptFormat === "playwright_test"
    ? "playwright_test"
    : "worker_function";
  if (scriptFormat === "playwright_test") {
    return executePlaywrightTestJob(job, script, variables, started);
  }
  return executePlaywrightWorkerFunctionJob(job, script, variables, started);
}

async function loop() {
  await registerIfNeeded();
  await heartbeat("ONLINE");
  traceEntry("job_event", { message: "worker_started", runner_name: RUNNER_NAME, api_base: API_BASE, capabilities: capabilities() });
  console.log(`Worker ${RUNNER_NAME} conectado a ${API_BASE}. Ctrl+C para detener.`);
  let lastHeartbeat = 0;

  while (true) {
    try {
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
      activeJobId = "";
      activeJobs = 0;
      console.error("Error procesando worker:", formatLogArg(error?.message || error));
      traceEntry("error", { message: "worker_loop_error", active_job_id: activeJobId, error: { message: error?.message || String(error), stack: error?.stack } });
      if (error?.stack) console.error(error.stack);
      await heartbeat("DEGRADED").catch(() => {});
      if (RUN_ONCE) {
        process.exitCode = 1;
        return;
      }
      await sleep(POLL_INTERVAL_MS);
    }
  }
}

loop();
