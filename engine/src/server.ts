import express from "express";
import { deliverTerminalResult } from "./delivery/terminal-callback.ts";
import { createServer } from "http";
import { Server } from "socket.io";
import cors from "cors";
import { runTask } from "./index.ts";
import { AIClient } from "./ai/client.ts";
import { traceEntry, traceRequestId } from "./test-trace.ts";
import {
  ENGINE_LOCAL_EVIDENCE_ENABLED,
  ENGINE_NAME,
  ENGINE_VERSION,
} from "./runtime-config.ts";

const CORS_ORIGIN = process.env.ENGINE_CORS_ORIGIN || "*";
const corsOrigin =
  CORS_ORIGIN === "*"
    ? "*"
    : CORS_ORIGIN.split(",")
        .map((origin) => origin.trim())
        .filter(Boolean);

const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const FULL_TRACE_ENABLED = /^(1|true|yes|on)$/i.test(
  process.env.QA_TEST_TRACE_ENABLED || "",
);
const SENSITIVE_KEY_PATTERN =
  /(authorization|cookie|token|secret|password|api[-_]?key|credential|session)/i;

function sanitizeTraceValue(value: any, depth = 0): any {
  if (depth > 3) return "[truncated]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string")
    return value.length > 500 ? `${value.slice(0, 500)}...[truncated]` : value;
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

app.use((req, res, next) => {
  const requestId = req.header("x-request-id") || traceRequestId("engine-http");
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

function formatStoryDescription(value: unknown) {
  const source = String(value || "").trim();
  const match = source.match(
    /^Como\s+(.+?),\s*quiero\s+(.+?)(?:\.\s*Para\s+(.+?))?\.?$/is,
  );
  if (!match) return source;
  const [, role, capability, benefit] = match;
  return [
    `**Como:** ${role.trim()}`,
    `**Quiero:** ${capability.trim()}`,
    benefit?.trim() ? `**Para:** ${benefit.trim()}` : "",
  ]
    .filter(Boolean)
    .join("\n");
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

app.post("/generate-stories-sync", async (req, res) => {
  const {
    phase,
    context,
    instructions,
    max_stories,
    provider,
    llm_endpoint,
    model,
    provider_api_key,
    temperature,
  } = req.body || {};
  if (
    !["estimate", "generate"].includes(String(phase)) ||
    !context?.requisito
  ) {
    return res
      .status(400)
      .json({ error: "phase y context.requisito son obligatorios" });
  }
  const limit = Math.max(1, Math.min(20, Number(max_stories || 5)));
  const outputSchema =
    phase === "estimate"
      ? {
          estimacion: {
            cantidad_recomendada: "number 1..20",
            rango_min: "number",
            rango_max: "number",
            justificacion: "string",
          },
          fuentes_usadas: ["string"],
        }
      : {
          historias: [
            {
              titulo: "string",
              descripcion_markdown: "string",
              criterios_aceptacion_markdown: "string",
              prioridad: "ALTA|MEDIA|BAJA",
            },
          ],
        };
  const prompt =
    phase === "estimate"
      ? "Analiza el requisito y el contexto seleccionado. Estima cuántas historias de usuario independientes conviene generar. No generes historias todavía. Responde JSON con estimacion y fuentes_usadas."
      : `Genera como máximo ${limit} historias de usuario independientes. Cada una debe tener título, descripción Markdown y criterios de aceptación Markdown verificables. El título debe ser corto (4 a 9 palabras), describir solo la capacidad y no incluir "Como usuario", "quiero", "para" ni la explicación completa. La descripción debe conservar el formato de historia de usuario en tres líneas: "Como [rol]", "quiero [capacidad]" y "para [beneficio]". No inventes integraciones, tickets ni requisitos fuera del contexto. Responde solo JSON con historias.`;
  try {
    const ai = new AIClient({
      provider,
      endpoint: llm_endpoint,
      model,
      apiKey: provider_api_key,
      temperature: Number(temperature),
      // Gemma served by LM Studio can consume the full response budget in
      // reasoning_content. Story generation needs the JSON in content instead.
      disableThinking: String(provider || "").toLowerCase() === "lm-studio",
      maxCompletionTokens: phase === "generate" ? 1024 : 512,
    });
    const result = await ai.runWorkflowAgent({
      nodeName:
        phase === "estimate" ? "Estimar historias" : "Generar historias",
      promptTemplate: `${prompt}\nInstrucciones adicionales del usuario: ${String(instructions || "").slice(0, 4000)}`,
      input: { context, phase, max_historias: limit },
      outputSchema,
    });
    const output =
      result.data?.decision && typeof result.data.decision === "object"
        ? result.data.decision
        : result.data;
    if (phase === "generate" && Array.isArray(output?.historias)) {
      output.historias = output.historias.map((story: any) => ({
        ...story,
        descripcion_markdown: formatStoryDescription(
          story?.descripcion_markdown,
        ),
      }));
    }
    return res.json({ ...output, metrics: result.metrics });
  } catch (error: any) {
    return res.status(502).json({
      error: "No se pudo consultar el modelo configurado",
      detail: String(error?.message || "").slice(0, 300),
    });
  }
});

app.post("/run-task", async (req, res) => {
  const {
    task,
    url,
    maxSteps,
    timeout_seconds,
    testId,
    suite,
    expected,
    guidance,
    step_map,
    callback_url,
    callback_token,
    engine_ws_token,
    headless,
    viewport_width,
    viewport_height,
    provider,
    llm_endpoint,
    model,
    provider_api_key,
    temperature,
    token_cost_prompt_per_1k,
    token_cost_completion_per_1k,
    token_cost_per_1k,
    vision_enabled,
    steps,
    environment,
    dataset,
    variables,
    dataset_ambiente,
    dataset_caso,
    agent_workflow,
    workflow_definition,
    case_id,
  } = req.body;

  if (!task) {
    return res.status(400).json({ error: "Task is required" });
  }

  res.json({ message: "Task started", testId });

  try {
    const result = await runTask(
      task,
      url,
      maxSteps || 10,
      testId || "TL-000",
      suite || "smoke",
      expected,
      guidance,
      step_map,
      {
        headless: Boolean(headless),
        viewport: {
          width: Number(viewport_width || 1920),
          height: Number(viewport_height || 1080),
        },
        io,
        aiConfig: {
          provider,
          endpoint: llm_endpoint,
          model,
          apiKey: provider_api_key,
          temperature: Number(temperature),
          promptTokenCostPer1K: Number(token_cost_prompt_per_1k || 0),
          completionTokenCostPer1K: Number(token_cost_completion_per_1k || 0),
          tokenCostPer1K: Number(token_cost_per_1k || 0.01),
          visionEnabled: vision_enabled === true,
        },
        steps: Array.isArray(steps) ? steps : undefined,
        contextData: {
          environment,
          dataset,
          variables,
          dataset_ambiente,
          dataset_caso,
        },
        agentWorkflow: Array.isArray(agent_workflow)
          ? agent_workflow
          : undefined,
        workflowDefinition: workflow_definition?.nodes
          ? workflow_definition
          : undefined,
        timeoutSeconds: Number(timeout_seconds),
        caseId: case_id,
        engineWsToken: engine_ws_token,
        callbackToken: callback_token,
        callbackUrl: callback_url,
      },
    );
    if (callback_url) {
      const callbackToken =
        callback_token || process.env.AI_ENGINE_CALLBACK_TOKEN;
      const callbackRequestId = traceRequestId("engine-callback");
      traceEntry("http_request", {
        request_id: callbackRequestId,
        method: "POST",
        url: callback_url,
        body: traceBody(result),
      });
      const callbackStarted = Date.now();
      await deliverTerminalResult({
        url: callback_url,
        token: callbackToken,
        executionId: testId,
        payload: result,
        onAttempt: (attempt) =>
          traceEntry(attempt.error ? "error" : "http_response", {
            request_id: callbackRequestId,
            method: "POST",
            url: callback_url,
            status: attempt.status,
            attempt: attempt.attempt,
            duration_ms: Date.now() - callbackStarted,
            ...(attempt.error ? { error: { message: attempt.error } } : {}),
          }),
      }).catch((callbackError) => {
        traceEntry("error", {
          request_id: callbackRequestId,
          method: "POST",
          url: callback_url,
          duration_ms: Date.now() - callbackStarted,
          error: { message: callbackError?.message || String(callbackError) },
        });
        console.error(
          `Terminal callback could not be acknowledged for task ${testId}:`,
          callbackError,
        );
      });
    }
  } catch (error: any) {
    console.error(`Error executing task ${testId}:`, error);
    if (callback_url) {
      const callbackToken =
        callback_token || process.env.AI_ENGINE_CALLBACK_TOKEN;
      const errorPayload = {
        status: "FALLO",
        duration_seconds: 0,
        observations: `Error critico del Motor IA: ${error?.message || error}`,
        error_message: error?.message || String(error),
        logs: error?.stack || String(error),
        metadata: { engine: ENGINE_NAME, version: ENGINE_VERSION },
        ai_report: {
          schema_version: 1,
          execution_id: testId,
          summary: `Error critico del Motor IA: ${error?.message || error}`,
          status: "FALLO",
          confidence: 0,
          consensus: "FALLO",
          failure_category: "engine_server_error",
          human_review_required: true,
          timeline: [
            {
              ts: new Date().toISOString(),
              agent: "SYSTEM",
              level: "ERROR",
              message: error?.message || String(error),
            },
          ],
          agent_conversation: [],
          metrics: {
            totalTokens: 0,
            promptTokens: 0,
            completionTokens: 0,
            latencyMs: 0,
            estimatedCost: 0,
            aiCalls: 0,
          },
          errors: [error?.message || String(error)],
          steps: [],
        },
        steps: [],
      };
      const callbackRequestId = traceRequestId("engine-callback");
      traceEntry("http_request", {
        request_id: callbackRequestId,
        method: "POST",
        url: callback_url,
        body: traceBody(errorPayload),
      });
      const callbackStarted = Date.now();
      await deliverTerminalResult({
        url: callback_url,
        token: callbackToken,
        executionId: testId,
        payload: errorPayload,
        onAttempt: (attempt) =>
          traceEntry(attempt.error ? "error" : "http_response", {
            request_id: callbackRequestId,
            method: "POST",
            url: callback_url,
            status: attempt.status,
            attempt: attempt.attempt,
            duration_ms: Date.now() - callbackStarted,
            ...(attempt.error ? { error: { message: attempt.error } } : {}),
          }),
      }).catch((callbackError) => {
        traceEntry("error", {
          request_id: callbackRequestId,
          method: "POST",
          url: callback_url,
          body: traceBody(errorPayload),
          duration_ms: Date.now() - callbackStarted,
          error: {
            message: callbackError?.message || String(callbackError),
            stack: callbackError?.stack,
          },
        });
        console.error(
          `Terminal error callback could not be acknowledged for task ${testId}:`,
          callbackError,
        );
      });
    }
  }
});

app.post("/run-task-sync", async (req, res) => {
  const {
    task,
    url,
    maxSteps,
    timeout_seconds,
    testId,
    suite,
    expected,
    guidance,
    step_map,
    headless,
    viewport_width,
    viewport_height,
    provider,
    llm_endpoint,
    model,
    provider_api_key,
    temperature,
    token_cost_prompt_per_1k,
    token_cost_completion_per_1k,
    token_cost_per_1k,
    steps,
    environment,
    dataset,
    variables,
    dataset_ambiente,
    dataset_caso,
    agent_workflow,
    workflow_definition,
    case_id,
  } = req.body;

  if (!task) {
    return res.status(400).json({ error: "Task is required" });
  }

  try {
    const result = await runTask(
      task,
      url,
      maxSteps || 10,
      testId || "AI-DRY-RUN",
      suite || "ai-dry-run",
      expected,
      guidance,
      step_map || {},
      {
        headless: Boolean(headless),
        viewport: {
          width: Number(viewport_width || 1920),
          height: Number(viewport_height || 1080),
        },
        io,
        aiConfig: {
          provider,
          endpoint: llm_endpoint,
          model,
          apiKey: provider_api_key,
          temperature: Number(temperature),
          promptTokenCostPer1K: Number(token_cost_prompt_per_1k || 0),
          completionTokenCostPer1K: Number(token_cost_completion_per_1k || 0),
          tokenCostPer1K: Number(token_cost_per_1k || 0.01),
        },
        steps: Array.isArray(steps) ? steps : undefined,
        contextData: {
          environment,
          dataset,
          variables,
          dataset_ambiente,
          dataset_caso,
        },
        agentWorkflow: Array.isArray(agent_workflow)
          ? agent_workflow
          : undefined,
        workflowDefinition: workflow_definition?.nodes
          ? workflow_definition
          : undefined,
        timeoutSeconds: Number(timeout_seconds),
        caseId: case_id,
      },
    );
    res.json(result);
  } catch (error: any) {
    console.error(`Error executing sync task ${testId}:`, error);
    res.status(500).json({
      status: "FALLO",
      duration_seconds: 0,
      observations: `Error critico del Motor IA: ${error?.message || error}`,
      error_message: error?.message || String(error),
      logs: error?.stack || String(error),
      metadata: { engine: ENGINE_NAME, version: ENGINE_VERSION },
      ai_report: {
        schema_version: 1,
        execution_id: testId,
        summary: `Error critico del Motor IA: ${error?.message || error}`,
        status: "FALLO",
        confidence: 0,
        consensus: "FALLO",
        failure_category: "engine_server_error",
        human_review_required: true,
        timeline: [
          {
            ts: new Date().toISOString(),
            agent: "SYSTEM",
            level: "ERROR",
            message: error?.message || String(error),
          },
        ],
        agent_conversation: [],
        metrics: {
          totalTokens: 0,
          promptTokens: 0,
          completionTokens: 0,
          latencyMs: 0,
          estimatedCost: 0,
          aiCalls: 0,
        },
        errors: [error?.message || String(error)],
        steps: [],
      },
      steps: [],
    });
  }
});

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
httpServer.listen(PORT, () => {
  console.log(
    `${ENGINE_NAME} running on port ${PORT}. Local evidence: ${ENGINE_LOCAL_EVIDENCE_ENABLED ? "enabled" : "disabled"}`,
  );
});

export { io };
