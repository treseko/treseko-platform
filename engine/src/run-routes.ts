import express from "express";
import { deliverTerminalResult, persistPendingTerminalDelivery } from "./delivery/terminal-callback.ts";
export function registerRunRoutes(app: express.Express, deps: any) {
  const { protectedStoryEndpoint, requestCorrelationId, allowedEndpoint, allowedFallbacks, sendPublicError, runTask, traceRequestId, traceEntry, traceBody, publicError, sanitizeTraceValue, ENGINE_NAME, ENGINE_VERSION, io, activeExecutionIds } = deps;
  app.post("/run-task", async (req, res) => {
    if (!protectedStoryEndpoint(req, res)) return;
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
      provider_fallbacks,
      provider_max_retries,
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
      progress_ws_url,
      ai_execution_driver,
      opencode_url,
      opencode_username,
      opencode_password,
      opencode_model,
      opencode_agent,
      opencode_timeout_seconds,
    } = req.body;
    const requestCorrelation = requestCorrelationId(req);

    if (!task) {
      return sendPublicError(req, res, 400, "task es obligatorio.", "TASK_REQUIRED");
    }
    if (!allowedEndpoint(llm_endpoint) || !allowedFallbacks(provider_fallbacks)) {
      return sendPublicError(req, res, 400, "El endpoint del modelo no está permitido.", "LLM_ENDPOINT_NOT_ALLOWED");
    }
    const executionKey = String(testId || "").trim();
    if (executionKey && activeExecutionIds.has(executionKey)) {
      return res.status(202).json({ message: "Task already started", testId: executionKey, duplicate: true, correlation_id: (req as any).correlationId });
    }
    if (executionKey) activeExecutionIds.add(executionKey);

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
            fallbacks: Array.isArray(provider_fallbacks) ? provider_fallbacks : [],
            maxRetries: Number(provider_max_retries),
            temperature: Number(temperature),
            promptTokenCostPer1K: Number(token_cost_prompt_per_1k || 0),
            completionTokenCostPer1K: Number(token_cost_completion_per_1k || 0),
            tokenCostPer1K: Number(token_cost_per_1k || 0.01),
            visionEnabled: vision_enabled === true,
            executionDriver: ai_execution_driver === 'opencode' ? 'opencode' : 'treseko_engine',
            opencodeUrl: opencode_url,
            opencodeUsername: opencode_username,
            opencodePassword: opencode_password,
            opencodeModel: opencode_model,
            opencodeAgent: opencode_agent,
            opencodeTimeoutMs: Number(opencode_timeout_seconds || 30) * 1000,
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
          progressWsUrl: progress_ws_url,
          correlationId: requestCorrelation,
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
        const correlatedResult = { ...result, correlation_id: requestCorrelation };
        await deliverTerminalResult({
          url: callback_url,
          token: callbackToken,
          executionId: testId,
          payload: correlatedResult,
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
          persistPendingTerminalDelivery({ url: callback_url, token: callbackToken, executionId: testId, payload: correlatedResult });
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
      const safeMessage = publicError(req, 500, error?.message || error, "ENGINE_EXECUTION_FAILED").error.message;
      if (callback_url) {
        const callbackToken =
          callback_token || process.env.AI_ENGINE_CALLBACK_TOKEN;
        const errorPayload = {
          correlation_id: (req as any).correlationId,
          status: "FALLO",
          duration_seconds: 0,
          observations: safeMessage,
          error_code: "ENGINE_EXECUTION_FAILED",
          error_message: safeMessage,
          logs: "",
          metadata: { engine: ENGINE_NAME, version: ENGINE_VERSION },
          ai_report: {
            schema_version: 1,
            execution_id: testId,
            summary: safeMessage,
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
                message: safeMessage,
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
            errors: [safeMessage],
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
          persistPendingTerminalDelivery({ url: callback_url, token: callbackToken, executionId: testId, payload: errorPayload });
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
    } finally {
      if (executionKey) activeExecutionIds.delete(executionKey);
    }
  });

  app.post("/run-task-sync", async (req, res) => {
    if (!protectedStoryEndpoint(req, res)) return;
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
      provider_fallbacks,
      provider_max_retries,
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
      progress_ws_url,
      callback_token,
      ai_execution_driver,
      opencode_url,
      opencode_username,
      opencode_password,
      opencode_model,
      opencode_agent,
      opencode_timeout_seconds,
    } = req.body;
    const requestCorrelation = requestCorrelationId(req);

    if (!task) {
      return sendPublicError(req, res, 400, "task es obligatorio.", "TASK_REQUIRED");
    }
    if (!allowedEndpoint(llm_endpoint) || !allowedFallbacks(provider_fallbacks)) {
      return sendPublicError(req, res, 400, "El endpoint del modelo no está permitido.", "LLM_ENDPOINT_NOT_ALLOWED");
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
            fallbacks: Array.isArray(provider_fallbacks) ? provider_fallbacks : [],
            maxRetries: Number(provider_max_retries),
            temperature: Number(temperature),
            promptTokenCostPer1K: Number(token_cost_prompt_per_1k || 0),
            completionTokenCostPer1K: Number(token_cost_completion_per_1k || 0),
            tokenCostPer1K: Number(token_cost_per_1k || 0.01),
            executionDriver: ai_execution_driver === 'opencode' ? 'opencode' : 'treseko_engine',
            opencodeUrl: opencode_url,
            opencodeUsername: opencode_username,
            opencodePassword: opencode_password,
            opencodeModel: opencode_model,
            opencodeAgent: opencode_agent,
            opencodeTimeoutMs: Number(opencode_timeout_seconds || 30) * 1000,
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
          callbackToken: callback_token,
          progressWsUrl: progress_ws_url,
          correlationId: requestCorrelation,
        },
      );
      res.json(result);
    } catch (error: any) {
      const safeMessage = "El Engine no pudo completar la ejecución. Revisa el código de soporte y vuelve a intentar.";
      const errorCode = "ENGINE_EXECUTION_FAILED";
      console.error(`Error executing sync task ${testId} correlation_id=${(req as any).correlationId}:`, sanitizeTraceValue({ error: error?.message || String(error) }));
      res.status(500).json({
        error: publicError(req, 500, safeMessage, errorCode).error,
        detail: safeMessage,
        status: "FALLO",
        duration_seconds: 0,
        observations: safeMessage,
        error_code: errorCode,
        correlation_id: (req as any).correlationId,
        error_message: safeMessage,
        logs: "",
        metadata: { engine: ENGINE_NAME, version: ENGINE_VERSION },
        ai_report: {
          schema_version: 1,
          execution_id: testId,
          summary: safeMessage,
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
              message: safeMessage,
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
          errors: [safeMessage],
          steps: [],
        },
        steps: [],
      });
    }
  });

}
