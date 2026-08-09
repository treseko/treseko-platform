import { ACCEPTANCE_CRITERION_TYPES, CASE_NODE_TYPES, CASE_SCHEMAS, COMPACT_STORY_GENERATION_SCHEMA, STORY_INTENT_COMPARISON_SCHEMA, STORY_NODE_TYPES, STORY_SCHEMAS, allowedEndpoint, allowedFallbacks, analysisFromOutput, caseAnalysis, caseWorkflowNodes, compactPriorProposals, completeStoryProposalSet, enrichCompactStoryProposal, extractStoryProposals, formatStoryDescription, generationAnalysisContext, isCompleteStoryProposal, normalizeCaseProposalCategory, normalizeGeneratedProposal, normalizeIntentComparisons, proposalForSlot, sourceReferencesForGeneration, storyContractIssues, untrustedSources, validCaseProposal, workflowNodes } from "./generation-contracts.ts";
import { registerGenerationRoutes } from "./generation-routes.ts";
import { registerQualityDiagnosisRoutes } from "./quality-diagnosis-routes.ts";
import { registerRunRoutes } from "./run-routes.ts";
import express from "express";
import { deliverTerminalResult, persistPendingTerminalDelivery, redeliverPendingTerminalResults } from "./delivery/terminal-callback.ts";
import fs from "node:fs";
import path from "node:path";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import crypto from "crypto";
import { runTask } from "./index.ts";
import { AIClient } from "./ai/client.ts";
import { shouldReuseCaseGenerationScenarios } from "./ai/case-generation-flow.ts";
import { traceEntry, traceRequestId } from "./test-trace.ts";
import { OpenCodeDriver } from "./ai/opencode-driver.ts";
import { ProviderRequestError } from "./ai/provider-adapters.ts";
import {
  ENGINE_LOCAL_EVIDENCE_ENABLED,
  ENGINE_NAME,
  ENGINE_VERSION,
} from "./runtime-config.ts";
for (const name of ["APP_ENV", "NODE_ENV"] as const) {
  const configured = (process.env[name] || "").trim().toLowerCase();
  if (configured && !["prod", "production"].includes(configured)) {
    throw new Error(`${name}=${JSON.stringify(configured)} no está permitido: Treseko Engine sólo se ejecuta en producción.`);
  }
}
const IS_PRODUCTION = true;
function configuredInternalToken(): string {
  const direct = String(process.env.AI_ENGINE_INTERNAL_TOKEN || "").trim();
  if (direct) return direct;
  const tokenFile = String(process.env.AI_ENGINE_INTERNAL_TOKEN_FILE || "").trim();
  if (!tokenFile) return "";
  try {
    return fs.readFileSync(tokenFile, "utf8").trim();
  } catch (_error) {
    return "";
  }
}
const ENGINE_INTERNAL_TOKEN = configuredInternalToken();
const CORS_ORIGIN = process.env.ENGINE_CORS_ORIGIN || (IS_PRODUCTION ? "" : "*");
const corsOrigin =
  CORS_ORIGIN === "*"
    ? "*"
    : CORS_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);
const app = express();
app.use(cors({ origin: corsOrigin || false }));
// Establish the ID before body parsing so malformed JSON and oversized
// payloads are correlated by the same error handler as normal requests.
app.use((req, res, next) => {
  const correlation = correlationId(req);
  (req as any).correlationId = correlation;
  res.setHeader("X-Correlation-ID", correlation);
  next();
});
app.use(express.json({ limit: process.env.ENGINE_MAX_BODY || "256kb" }));
// The backend owns global scheduling. This guard makes a repeated dispatch for
// the same execution id harmless while the Engine is already running it.
const activeExecutionIds = new Set<string>();
const FULL_TRACE_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.QA_TEST_TRACE_ENABLED || "",
);
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|token|secret|password|api[-_]?key|credential|session)/i;
const CORRELATION_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
function correlationId(req: express.Request): string {
  const existing = String((req as any).correlationId || "").trim();
  if (CORRELATION_ID_RE.test(existing)) return existing;
  const candidate = String(req.header("x-correlation-id") || req.header("x-request-id") || "").trim();
  return CORRELATION_ID_RE.test(candidate) ? candidate : `engine-${crypto.randomUUID()}`;
}
function requestCorrelationId(req: express.Request): string {
  return (req as any).correlationId;
}
function publicError(req: express.Request, status: number, message: unknown, errorCode?: string, details: unknown = {}) {
  const safeMessage = sanitizeSensitiveText(String(message || "Error de servicio"));
  const statusErrorCodes: Record<number, string> = {
    400: "BAD_REQUEST", 401: "UNAUTHORIZED", 403: "FORBIDDEN", 404: "NOT_FOUND",
    408: "REQUEST_TIMEOUT", 409: "CONFLICT", 413: "PAYLOAD_TOO_LARGE",
    422: "VALIDATION_ERROR", 429: "RATE_LIMITED", 499: "CLIENT_DISCONNECTED",
    502: "UPSTREAM_UNAVAILABLE", 503: "SERVICE_UNAVAILABLE", 504: "UPSTREAM_TIMEOUT",
  };
  const resolvedErrorCode = errorCode || statusErrorCodes[status] || (status >= 500 ? "INTERNAL_SERVER_ERROR" : "REQUEST_ERROR");
  const retryable = [408, 425, 429, 499, 502, 503, 504].includes(status) || status >= 500;
  return {
    error: {
      error_code: resolvedErrorCode,
      message: safeMessage,
      correlation_id: (req as any).correlationId,
      retryable,
      details: details && typeof details === "object" ? sanitizeTraceValue(details) : {},
    },
    // Compatibility with existing Engine/API consumers during V1.0.1.
    detail: safeMessage,
  };
}

function sanitizeSensitiveText(value: string): string {
  return value
    .replace(/(authorization|cookie|token|secret|password|api[-_]?key|credential|session)(\s*[:=]\s*)(bearer\s+)?[^\s,;]+/gi, "$1$2[redacted]")
    .replace(/https?:\/\/[^\s]+/gi, "[redacted-url]");
}
function sendPublicError(req: express.Request, res: express.Response, status: number, message: string, errorCode?: string, details: unknown = {}) {
  return res.status(status).json(publicError(req, status, message, errorCode, details));
}
function providerFailure(error: unknown): { status: number; code: string; category: string } {
  const category = error instanceof ProviderRequestError
    ? error.category
    : String((error as any)?.category || (error as any)?.code || "provider_unavailable");
  const mapping: Record<string, { status: number; code: string }> = {
    authentication_failed: { status: 401, code: "AI_PROVIDER_UNAUTHORIZED" },
    permission_denied: { status: 403, code: "AI_PROVIDER_FORBIDDEN" },
    payment_required: { status: 402, code: "AI_PROVIDER_PAYMENT_REQUIRED" },
    rate_limited: { status: 429, code: "AI_PROVIDER_RATE_LIMITED" },
    timeout: { status: 504, code: "AI_PROVIDER_TIMEOUT" },
    invalid_response: { status: 502, code: "AI_PROVIDER_INVALID_RESPONSE" },
    network_error: { status: 502, code: "AI_PROVIDER_UNAVAILABLE" },
    provider_unavailable: { status: 502, code: "AI_PROVIDER_UNAVAILABLE" },
  };
  const resolved = mapping[category] || mapping.provider_unavailable;
  return { ...resolved, category };
}
function sendProviderFailure(req: express.Request, res: express.Response, error: unknown) {
  const failure = providerFailure(error);
  return sendPublicError(
    req,
    res,
    failure.status,
    failure.code === "AI_PROVIDER_TIMEOUT"
      ? "El proveedor IA agotó el tiempo de espera."
      : failure.code === "AI_PROVIDER_UNAUTHORIZED"
        ? "Las credenciales del proveedor IA no son válidas."
        : failure.code === "AI_PROVIDER_FORBIDDEN"
          ? "El proveedor IA rechazó el acceso solicitado."
          : "El proveedor IA no está disponible.",
    failure.code,
    { category: failure.category },
  );
}

function sanitizeTraceValue(value: any, depth = 0): any {
  if (depth > 3) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const safe = sanitizeSensitiveText(value);
    return safe.length > 500 ? `${safe.slice(0, 500)}...[truncated]` : safe;
  }
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value))
    return value
      .slice(0, 25)
      .map((item) => sanitizeTraceValue(item, depth + 1));
  if (typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .slice(0, 50)
        .map(([key, item]) => [
          key,
          SENSITIVE_KEY_PATTERN.test(key)
            ? "[redacted]"
            : sanitizeTraceValue(item, depth + 1),
        ]),
    );
  }
  return String(value);
}

function traceHeaders(headers: any) {
  return sanitizeTraceValue(headers || {});
}

function traceBody(body: any) {
  return FULL_TRACE_ENABLED
    ? sanitizeTraceValue(body)
    : "[disabled: set QA_TEST_TRACE_ENABLED=true]";
}

function traceResponseBody(body: any) {
  return FULL_TRACE_ENABLED ? sanitizeTraceValue(body) : undefined;
}

function parseLegacyFormStylePayload(rawBody: string) {
  const parsed: Record<string, string> = {};
  const parts = rawBody.split(/[&\n;,\r]+/);
  for (const part of parts) {
    const line = String(part || "").trim();
    if (!line) continue;
    let key = "";
    let value = "";
    if (line.includes(":")) {
      const separatorIndex = line.indexOf(":");
      key = line.slice(0, separatorIndex).trim();
      value = line.slice(separatorIndex + 1).trim();
    } else if (line.includes("=")) {
      const separatorIndex = line.indexOf("=");
      key = line.slice(0, separatorIndex).trim();
      value = line.slice(separatorIndex + 1).trim();
    }
    if (!key) continue;
    parsed[key] = value;
  }
  if (!Object.keys(parsed).length) return null;
  return parsed;
}

function normalizeProviderHealthBody(rawBody: unknown) {
  if (!rawBody && rawBody !== "") return null;
  if (typeof rawBody === "string") {
    const bodyText = rawBody.trim();
    if (!bodyText) return null;
    if (bodyText.startsWith("{") || bodyText.startsWith("[")) {
      try {
        const parsed = JSON.parse(bodyText);
        if (parsed && typeof parsed === "object") return parsed;
      } catch (_error) {
        // Fallback to legacy "provider:openrouter" style payload.
      }
    }
    return parseLegacyFormStylePayload(bodyText);
  }
  if (typeof Buffer !== "undefined" && rawBody instanceof Buffer) {
    return normalizeProviderHealthBody(rawBody.toString("utf8"));
  }
  if (rawBody instanceof ArrayBuffer) {
    return normalizeProviderHealthBody(new TextDecoder().decode(rawBody));
  }
  if (typeof rawBody === "object") return rawBody;
  return null;
}

async function executeProviderHealth(req: express.Request, res: express.Response, rawBody: unknown) {
  if (!protectedStoryEndpoint(req, res)) return;
  const payload = normalizeProviderHealthBody(rawBody);
  const provider = payload?.provider;
  const llmEndpoint = payload?.llm_endpoint;
  const model = payload?.model;
  const provider_api_key = payload?.provider_api_key;
  const max_retries = payload?.max_retries;
  if (!provider || !model || !allowedEndpoint(llmEndpoint)) {
    return sendPublicError(req, res, 400, "Perfil IA inválido o endpoint no permitido", "INVALID_PROVIDER_PROFILE");
  }
  const client = new AIClient({
    provider,
    endpoint: llmEndpoint,
    model,
    apiKey: provider_api_key,
    maxRetries: max_retries,
    maxCompletionTokens: 16,
  });
  let health: Awaited<ReturnType<AIClient["checkHealthDetailed"]>>;
  try {
    health = await client.checkHealthDetailed();
  } catch (error: any) {
    // Provider adapters normalize expected failures, but a transport/parser
    // failure must still produce a stable response instead of an unhandled
    // async Express rejection.
    return sendProviderFailure(req, res, error);
  }
  if (!health.ok) {
    return sendProviderFailure(req, res, new ProviderRequestError("Proveedor IA no disponible", health.category || "provider_unavailable"));
  }
  return res.status(200).json({
    status: health.ok ? "ok" : "error",
    provider: String(provider),
    model: String(model),
    ...(health.category ? { error: `Proveedor IA: ${health.category}` } : {}),
    ...(health.status ? { provider_status: health.status } : {}),
  });
}

app.use((req, res, next) => {
  const correlation = correlationId(req);
  (req as any).correlationId = correlation;
  res.setHeader("X-Correlation-ID", correlation);
  const requestId = correlation;
  const started = Date.now();
  let responseLogged = false;
  traceEntry("http_request", {
    request_id: requestId,
    method: req.method,
    path: req.path,
    url: req.originalUrl,
    headers: traceHeaders(req.headers),
    body: traceBody(req.body),
    client_ip: req.ip,
  });
  const logResponse = (responseBody: unknown) => {
    if (responseLogged) return;
    responseLogged = true;
    traceEntry("http_response", {
      request_id: requestId,
      method: req.method,
      path: req.path,
      url: req.originalUrl,
      status: res.statusCode,
      headers: traceHeaders(res.getHeaders()),
      body: traceBody(req.body),
      response_body: traceResponseBody(responseBody),
      duration_ms: Date.now() - started,
    });
  };
  const originalJson = res.json.bind(res);
  res.json = (body: any) => {
    logResponse(body);
    return originalJson(body);
  };
  res.on("finish", () => {
    logResponse(undefined);
  });
  next();
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"],
  },
});

function protectedStoryEndpoint(req: express.Request, res: express.Response) {
  const token = ENGINE_INTERNAL_TOKEN;
  if (token && req.header("x-engine-internal-token") !== token) {
    sendPublicError(req, res, 401, "El token interno del Engine no es válido.", "UNAUTHORIZED");
    return false;
  }
  if (IS_PRODUCTION && !token) {
    sendPublicError(req, res, 503, "El Engine no está configurado para aceptar solicitudes internas.", "ENGINE_AUTH_NOT_CONFIGURED");
    return false;
  }
  return true;
}

app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "treseko-engine",
    engine: ENGINE_NAME,
    version: ENGINE_VERSION,
    local_evidence_enabled: ENGINE_LOCAL_EVIDENCE_ENABLED,
  });
});

app.get("/internal/executions/:executionId/recovery-evidence", (req, res) => {
  // This endpoint is only bound to the private Compose network. When an
  // internal token is configured it remains mandatory; development installs
  // without that token can still recover a callback stranded by a restart.
  // Use the resolved token rather than only the direct environment variable:
  // production installs commonly load AI_ENGINE_INTERNAL_TOKEN from a file.
  if (ENGINE_INTERNAL_TOKEN && !protectedStoryEndpoint(req, res)) return;
  const executionId = String(req.params.executionId || "");
  if (!/^[0-9a-f-]{36}$/i.test(executionId)) return sendPublicError(req, res, 400, "execution_id debe ser un UUID válido.", "INVALID_EXECUTION_ID");
  const logsRoot = process.env.ENGINE_LOGS_DIR || "/engine/logs";
  let logPath = "";
  try {
    const dates = fs.readdirSync(logsRoot, { withFileTypes: true }).filter((entry) => entry.isDirectory());
    for (const date of dates) {
      const datePath = path.join(logsRoot, date.name);
      for (const suite of fs.readdirSync(datePath, { withFileTypes: true }).filter((entry) => entry.isDirectory())) {
        const candidate = path.join(datePath, suite.name, executionId, "execution.log");
        if (fs.existsSync(candidate)) { logPath = candidate; break; }
      }
      if (logPath) break;
    }
  } catch {
    return sendPublicError(req, res, 404, "La evidencia del Engine no está disponible.", "ENGINE_EVIDENCE_UNAVAILABLE");
  }
  if (!logPath) return sendPublicError(req, res, 404, "No se encontró evidencia para esta ejecución.", "EXECUTION_EVIDENCE_NOT_FOUND");
  const log = fs.readFileSync(logPath, "utf8");
  const passedSteps = [...log.matchAll(/Paso\s+(\d+):\s+\[PASO\]/g)].map((match) => Number(match[1]));
  const finalPass = /Resultado visual:\s+PASSED; resultado final:\s+PASO/.test(log)
    && new RegExp(`Test ${executionId} finalizado\\.`).test(log);
  if (!finalPass) return sendPublicError(req, res, 409, "La evidencia no acredita una finalización PASO recuperable.", "RECOVERY_NOT_AVAILABLE", { recoverable: false });
  return res.json({
    recoverable: true,
    status: "PASO",
    passed_steps: [...new Set(passedSteps)].sort((a, b) => a - b),
    consensus: "PASO",
    summary: "Resultado recuperable: el Engine finalizo correctamente, pero el callback terminal no fue confirmado.",
  });
});

app.all("/agent-health", async (req, res) => {
  if (!protectedStoryEndpoint(req, res)) return;
const driver = String(req.query.driver || process.env.AI_EXECUTION_DRIVER || "treseko_engine");
  if (driver !== "opencode") return res.json({ status: "ok", driver: "treseko_engine", version: ENGINE_VERSION });
  const body = req.body || {};
  let health;
  try {
    health = await new OpenCodeDriver({
      baseUrl: body.opencode_url || process.env.OPENCODE_URL,
      username: process.env.OPENCODE_USERNAME,
      password: process.env.OPENCODE_PASSWORD,
      apiKey: body.provider_api_key,
      provider: body.provider,
      model: body.opencode_model || body.model || process.env.OPENCODE_MODEL,
    }).ensureAvailable();
  } catch (_error) {
    return sendPublicError(req, res, 503, "El proveedor de ejecución no está disponible.", "OPENCODE_UNAVAILABLE");
  }
  if (health.status !== "ok") {
    return sendPublicError(req, res, 503, "El proveedor de ejecución no está disponible.", "OPENCODE_UNAVAILABLE");
  }
  return res.status(200).json(health);
});

app.post("/opencode/providers", async (req, res) => {
  if (!protectedStoryEndpoint(req, res)) return;
  const body = req.body || {};
  try {
    const driver = new OpenCodeDriver({ baseUrl: 'http://127.0.0.1:4096', apiKey: body.provider_api_key, provider: 'opencode', model: body.model });
    return res.json(await driver.providers());
  } catch (error: any) {
    return sendPublicError(req, res, 503, "El proveedor de ejecución no está disponible.", "OPENCODE_UNAVAILABLE");
  }
});

app.post("/provider-health", async (req, res) => {
  if (!protectedStoryEndpoint(req, res)) return;
  return executeProviderHealth(req, res, req.body);
});

registerGenerationRoutes(app, { protectedStoryEndpoint, sendPublicError, sendProviderFailure, allowedEndpoint, allowedFallbacks, traceEntry, traceRequestId, ENGINE_INTERNAL_TOKEN });
registerQualityDiagnosisRoutes(app, { protectedStoryEndpoint, sendPublicError, sendProviderFailure, allowedEndpoint, allowedFallbacks });
registerRunRoutes(app, { protectedStoryEndpoint, requestCorrelationId, allowedEndpoint, allowedFallbacks, sendPublicError, runTask, traceRequestId, traceEntry, traceBody, publicError, sanitizeTraceValue, ENGINE_NAME, ENGINE_VERSION, io, activeExecutionIds });
io.on("connection", (socket) => {
  console.log("Client connected to Engine:", socket.id);
  traceEntry("ws_event", { action: "connection", socket_id: socket.id });

  socket.on("subscribe", (testId) => {
    socket.join(testId);
    console.log(`Socket ${socket.id} subscribed to test ${testId}`);
    traceEntry("ws_event", {
      action: "subscribe",
      socket_id: socket.id,
      test_id: testId,
    });
  });

  socket.on("disconnect", () => {
    console.log("Client disconnected");
    traceEntry("ws_event", { action: "disconnect", socket_id: socket.id });
  });

  socket.on("error", (error) => {
    traceEntry("error", {
      action: "socket_error",
      socket_id: socket.id,
      error: String(error),
    });
  });
});
const PORT = process.env.ENGINE_PORT || 3010;
const shutdownEngine = async () => {
  await OpenCodeDriver.shutdown();
  httpServer.close(() => process.exit(0));
};
process.once("SIGTERM", shutdownEngine);
process.once("SIGINT", shutdownEngine);

app.use((error: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  if (
    req.method === "POST" &&
    req.path === "/provider-health" &&
    error instanceof SyntaxError &&
    ((error as any).status === 400 || (error as any).statusCode === 400)
  ) {
    executeProviderHealth(req, res, (error as any).body || "")
      .catch((handlerError) => next(handlerError));
    return;
  }
  const status = Number(error?.status || error?.statusCode || 500);
  if (res.headersSent) return next(error);
  return res.status(status >= 400 && status < 600 ? status : 500).json(publicError(req, status >= 400 && status < 600 ? status : 500, status >= 500 ? "El Motor IA no está disponible." : error?.message || "Solicitud inválida.", error?.code));
});

httpServer.listen(PORT, () => {
  console.log(
    `${ENGINE_NAME} running on port ${PORT}. Local evidence: ${ENGINE_LOCAL_EVIDENCE_ENABLED ? "enabled" : "disabled"}`,
  );
  void redeliverPendingTerminalResults();
  setInterval(() => { void redeliverPendingTerminalResults(); }, 15_000).unref();
  const restartMarker = path.join(process.env.TRESEKO_ENGINE_DIR || "/engine", ".treseko-update-restart"); const rollbackMarker = path.join(process.env.TRESEKO_ENGINE_DIR || "/engine", ".treseko-update-rollback");
  setInterval(() => {
    if (fs.existsSync(rollbackMarker) || !fs.existsSync(restartMarker) || activeExecutionIds.size > 0) return;
    try {
      fs.unlinkSync(restartMarker);
      console.info("Update de Engine preparado; reiniciando sin ejecuciones activas.");
      void shutdownEngine();
    } catch (error) {
      console.error("No se pudo aplicar el reinicio diferido del Engine:", error);
    }
  }, 2_000).unref();
});

export { io };
