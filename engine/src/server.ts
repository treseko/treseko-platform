import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { runTask } from './index.ts';
import { traceEntry, traceRequestId } from './test-trace.ts';
import { ENGINE_LOCAL_EVIDENCE_ENABLED, ENGINE_NAME, ENGINE_VERSION } from './runtime-config.ts';

const CORS_ORIGIN = process.env.ENGINE_CORS_ORIGIN || '*';
const corsOrigin = CORS_ORIGIN === '*'
  ? '*'
  : CORS_ORIGIN.split(',').map((origin) => origin.trim()).filter(Boolean);

const app = express();
app.use(cors({ origin: corsOrigin }));
app.use(express.json());

const FULL_TRACE_ENABLED = /^(1|true|yes|on)$/i.test(process.env.QA_TEST_TRACE_ENABLED || '');
const SENSITIVE_KEY_PATTERN = /(authorization|cookie|token|secret|password|api[-_]?key|credential|session)/i;

function sanitizeTraceValue(value: any, depth = 0): any {
  if (depth > 3) return '[truncated]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') return value.length > 500 ? `${value.slice(0, 500)}...[truncated]` : value;
  if (typeof value === 'number' || typeof value === 'boolean') return value;
  if (Array.isArray(value)) return value.slice(0, 25).map(item => sanitizeTraceValue(item, depth + 1));
  if (typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).slice(0, 50).map(([key, item]) => [
        key,
        SENSITIVE_KEY_PATTERN.test(key) ? '[redacted]' : sanitizeTraceValue(item, depth + 1),
      ])
    );
  }
  return String(value);
}

function traceHeaders(headers: any) {
  return sanitizeTraceValue(headers || {});
}

function traceBody(body: any) {
  return FULL_TRACE_ENABLED ? sanitizeTraceValue(body) : '[disabled: set QA_TEST_TRACE_ENABLED=true]';
}

function traceResponseBody(body: any) {
  return FULL_TRACE_ENABLED ? sanitizeTraceValue(body) : undefined;
}

app.use((req, res, next) => {
  const requestId = req.header('x-request-id') || traceRequestId('engine-http');
  const started = Date.now();
  let responseLogged = false;
  traceEntry('http_request', {
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
    traceEntry('http_response', {
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
  res.on('finish', () => {
    logResponse(undefined);
  });
  next();
});

const httpServer = createServer(app);
const io = new Server(httpServer, {
  cors: {
    origin: corsOrigin,
    methods: ["GET", "POST"]
  }
});

app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'treseko-engine',
    engine: ENGINE_NAME,
    version: ENGINE_VERSION,
    local_evidence_enabled: ENGINE_LOCAL_EVIDENCE_ENABLED,
  });
});

app.post('/run-task', async (req, res) => {
  const { task, url, maxSteps, timeout_seconds, testId, suite, expected, guidance, step_map, callback_url, engine_ws_token, headless, viewport_width, viewport_height, llm_endpoint, model, temperature, token_cost_prompt_per_1k, token_cost_completion_per_1k, token_cost_per_1k, steps, environment, dataset, variables, dataset_ambiente, dataset_caso, agent_workflow, workflow_definition, case_id } = req.body;
  
  if (!task || !url) {
    return res.status(400).json({ error: 'Task and URL are required' });
  }

  res.json({ message: 'Task started', testId });

  try {
    const result = await runTask(
      task,
      url,
      maxSteps || 10,
      testId || 'TL-000',
      suite || 'smoke',
      expected,
      guidance,
      step_map,
      {
        headless: Boolean(headless),
        viewport: { width: Number(viewport_width || 1920), height: Number(viewport_height || 1080) },
        io,
        aiConfig: {
          endpoint: llm_endpoint,
          model,
          temperature: Number(temperature),
          promptTokenCostPer1K: Number(token_cost_prompt_per_1k || 0),
          completionTokenCostPer1K: Number(token_cost_completion_per_1k || 0),
          tokenCostPer1K: Number(token_cost_per_1k || 0.01),
        },
        steps: Array.isArray(steps) ? steps : undefined,
        contextData: { environment, dataset, variables, dataset_ambiente, dataset_caso },
        agentWorkflow: Array.isArray(agent_workflow) ? agent_workflow : undefined,
        workflowDefinition: workflow_definition?.nodes ? workflow_definition : undefined,
        timeoutSeconds: Number(timeout_seconds),
        caseId: case_id,
        engineWsToken: engine_ws_token,
      }
    );
    if (callback_url) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.AI_ENGINE_CALLBACK_TOKEN) {
        headers['X-AI-Engine-Token'] = process.env.AI_ENGINE_CALLBACK_TOKEN;
      }
      const callbackRequestId = traceRequestId('engine-callback');
      const callbackBody = JSON.stringify(result);
      traceEntry('http_request', {
        request_id: callbackRequestId,
        method: 'POST',
        url: callback_url,
        headers: traceHeaders(headers),
        body: traceBody(result),
      });
      const callbackStarted = Date.now();
      const callbackResponse = await fetch(callback_url, {
        method: 'POST',
        headers,
        body: callbackBody,
      });
      const callbackText = await callbackResponse.clone().text().catch(() => '');
      traceEntry('http_response', {
        request_id: callbackRequestId,
        method: 'POST',
        url: callback_url,
        status: callbackResponse.status,
        headers: traceHeaders(Object.fromEntries(callbackResponse.headers.entries())),
        body: traceBody(result),
        response_body: traceResponseBody(callbackText),
        duration_ms: Date.now() - callbackStarted,
      });
      if (!callbackResponse.ok) {
        console.error(`Callback failed for task ${testId}: HTTP ${callbackResponse.status}`);
      }
    }
  } catch (error: any) {
    console.error(`Error executing task ${testId}:`, error);
    if (callback_url) {
      const headers: Record<string, string> = { 'Content-Type': 'application/json' };
      if (process.env.AI_ENGINE_CALLBACK_TOKEN) {
        headers['X-AI-Engine-Token'] = process.env.AI_ENGINE_CALLBACK_TOKEN;
      }
      const errorPayload = {
        status: 'FALLO',
        duration_seconds: 0,
        observations: `Error critico del Motor IA: ${error?.message || error}`,
        error_message: error?.message || String(error),
        logs: error?.stack || String(error),
        metadata: { engine: ENGINE_NAME, version: ENGINE_VERSION },
        ai_report: {
          schema_version: 1,
          execution_id: testId,
          summary: `Error critico del Motor IA: ${error?.message || error}`,
          status: 'FALLO',
          confidence: 0,
          consensus: 'FALLO',
          failure_category: 'engine_server_error',
          human_review_required: true,
          timeline: [{
            ts: new Date().toISOString(),
            agent: 'SYSTEM',
            level: 'ERROR',
            message: error?.message || String(error),
          }],
          agent_conversation: [],
          metrics: { totalTokens: 0, promptTokens: 0, completionTokens: 0, latencyMs: 0, estimatedCost: 0, aiCalls: 0 },
          errors: [error?.message || String(error)],
          steps: [],
        },
        steps: [],
      };
      const callbackRequestId = traceRequestId('engine-callback');
      traceEntry('http_request', {
        request_id: callbackRequestId,
        method: 'POST',
        url: callback_url,
        headers: traceHeaders(headers),
        body: traceBody(errorPayload),
      });
      const callbackStarted = Date.now();
      await fetch(callback_url, {
        method: 'POST',
        headers,
        body: JSON.stringify(errorPayload),
      }).then(async (response) => {
        traceEntry('http_response', {
          request_id: callbackRequestId,
          method: 'POST',
          url: callback_url,
          status: response.status,
          headers: traceHeaders(Object.fromEntries(response.headers.entries())),
          body: traceBody(errorPayload),
          response_body: traceResponseBody(await response.text().catch(() => '')),
          duration_ms: Date.now() - callbackStarted,
        });
      }).catch((callbackError) => {
        traceEntry('error', {
          request_id: callbackRequestId,
          method: 'POST',
          url: callback_url,
          body: traceBody(errorPayload),
          duration_ms: Date.now() - callbackStarted,
          error: { message: callbackError?.message || String(callbackError), stack: callbackError?.stack },
        });
        console.error(`Callback error for task ${testId}:`, callbackError);
      });
    }
  }
});

app.post('/run-task-sync', async (req, res) => {
  const { task, url, maxSteps, timeout_seconds, testId, suite, expected, guidance, step_map, headless, viewport_width, viewport_height, llm_endpoint, model, temperature, token_cost_prompt_per_1k, token_cost_completion_per_1k, token_cost_per_1k, steps, environment, dataset, variables, dataset_ambiente, dataset_caso, agent_workflow, workflow_definition, case_id } = req.body;

  if (!task || !url) {
    return res.status(400).json({ error: 'Task and URL are required' });
  }

  try {
    const result = await runTask(
      task,
      url,
      maxSteps || 10,
      testId || 'AI-DRY-RUN',
      suite || 'ai-dry-run',
      expected,
      guidance,
      step_map || {},
      {
        headless: Boolean(headless),
        viewport: { width: Number(viewport_width || 1920), height: Number(viewport_height || 1080) },
        io,
        aiConfig: {
          endpoint: llm_endpoint,
          model,
          temperature: Number(temperature),
          promptTokenCostPer1K: Number(token_cost_prompt_per_1k || 0),
          completionTokenCostPer1K: Number(token_cost_completion_per_1k || 0),
          tokenCostPer1K: Number(token_cost_per_1k || 0.01),
        },
        steps: Array.isArray(steps) ? steps : undefined,
        contextData: { environment, dataset, variables, dataset_ambiente, dataset_caso },
        agentWorkflow: Array.isArray(agent_workflow) ? agent_workflow : undefined,
        workflowDefinition: workflow_definition?.nodes ? workflow_definition : undefined,
        timeoutSeconds: Number(timeout_seconds),
        caseId: case_id,
      }
    );
    res.json(result);
  } catch (error: any) {
    console.error(`Error executing sync task ${testId}:`, error);
    res.status(500).json({
      status: 'FALLO',
      duration_seconds: 0,
      observations: `Error critico del Motor IA: ${error?.message || error}`,
      error_message: error?.message || String(error),
      logs: error?.stack || String(error),
      metadata: { engine: ENGINE_NAME, version: ENGINE_VERSION },
      ai_report: {
        schema_version: 1,
        execution_id: testId,
        summary: `Error critico del Motor IA: ${error?.message || error}`,
        status: 'FALLO',
        confidence: 0,
        consensus: 'FALLO',
        failure_category: 'engine_server_error',
        human_review_required: true,
        timeline: [{
          ts: new Date().toISOString(),
          agent: 'SYSTEM',
          level: 'ERROR',
          message: error?.message || String(error),
        }],
        agent_conversation: [],
        metrics: { totalTokens: 0, promptTokens: 0, completionTokens: 0, latencyMs: 0, estimatedCost: 0, aiCalls: 0 },
        errors: [error?.message || String(error)],
        steps: [],
      },
      steps: [],
    });
  }
});

io.on('connection', (socket) => {
  console.log('Client connected to Engine:', socket.id);
  traceEntry('ws_event', { action: 'connection', socket_id: socket.id });
  
  socket.on('subscribe', (testId) => {
    socket.join(testId);
    console.log(`Socket ${socket.id} subscribed to test ${testId}`);
    traceEntry('ws_event', { action: 'subscribe', socket_id: socket.id, test_id: testId });
  });

  socket.on('disconnect', () => {
    console.log('Client disconnected');
    traceEntry('ws_event', { action: 'disconnect', socket_id: socket.id });
  });

  socket.on('error', (error) => {
    traceEntry('error', { action: 'socket_error', socket_id: socket.id, error: String(error) });
  });
});

const PORT = process.env.ENGINE_PORT || 3010;
httpServer.listen(PORT, () => {
  console.log(`${ENGINE_NAME} running on port ${PORT}. Local evidence: ${ENGINE_LOCAL_EVIDENCE_ENABLED ? 'enabled' : 'disabled'}`);
});

export { io };
