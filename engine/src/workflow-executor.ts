import { executeWorkflowGraph, type WorkflowDefinition, type WorkflowTrace } from './ai/workflow.ts';
import { compileBlockWorkflow } from './ai/block-workflow.ts';
import { validateWorkflowRuntime } from './ai/agent-registry.ts';
import { runLlmAgent, runReporterAgent, runRuleAgent, runScriptAgent, runValidatorAgent, runWebhookAgent } from './ai/custom-agents.ts';
import { interpretStepData } from './automation/context-data-interpreter.ts';

export async function executeConfiguredWorkflow(context: any): Promise<any> {
  const { options, testId, task, expected, url, urlCandidate, manualSteps, qaSteps, ai, page, emit, emitAgent, navigateToResolvedBaseUrl, runQaSteps, runResult: initialRunResult, normalizeEngineUrl, firstStepUrl, performFinalAudit, workflowTimeoutMs } = context;
  let runResult = initialRunResult;
  let workflowTraces: WorkflowTrace[] = [];
  if (options.workflowDefinition?.nodes?.length) {
    const compiledWorkflow = compileBlockWorkflow(options.workflowDefinition);
    const runtimeErrors = validateWorkflowRuntime(compiledWorkflow);
    if (runtimeErrors.length) throw new Error(runtimeErrors.join(' | '));
    emitAgent('WORKFLOW', 'INFO', `Ejecutando workflow ${options.workflowDefinition.workflow?.name || options.workflowDefinition.workflow?.id}`);
    const workflowResult = await executeWorkflowGraph(
      compiledWorkflow,
      {
        executionId: testId,
        caseId: options.caseId || testId,
        context: {
          task,
          expected,
          received_url: url,
          url_candidate: urlCandidate,
          manualSteps,
          qaSteps,
          ...(options.contextData || {}),
        },
        sharedMemory: {
          base_url_candidate: urlCandidate,
          current_step: qaSteps[0]?.number ?? null,
          retry_count: {},
      resolved_context: qaSteps.map((step: any) => ({
            step_number: step.number,
            ...interpretStepData(step.data, options.contextData || {}),
          })),
        },
      },
      {
        ContextResolver: async (node, input) => {
          const fallbackUrl = normalizeEngineUrl(input.sharedMemory.base_url)
            || normalizeEngineUrl(input.sharedMemory.base_url_candidate)
            || normalizeEngineUrl(input.context.url_candidate)
            || firstStepUrl(qaSteps);
          const explicitStepUrl = firstStepUrl(qaSteps);
          if (explicitStepUrl && fallbackUrl === explicitStepUrl) {
            return {
              status: 'SUCCESS',
              confidence: 100,
              reason: 'URL resuelta desde los datos explicitos del caso de prueba',
              events: [],
              sharedMemoryPatch: {
                base_url: explicitStepUrl,
                total_steps: qaSteps.length,
                workflow_node: node.name,
                context_resolver_used: true,
                context_resolver_deterministic: true,
              },
            };
          }
          if (!fallbackUrl) {
            return {
              status: 'BLOCKED',
              confidence: 100,
              reason: 'Falta una URL inicial ejecutable: agrega url o base_url en el ambiente, datos del caso o un paso.',
              events: [],
              sharedMemoryPatch: {
                base_url: '',
                total_steps: qaSteps.length,
                workflow_node: node.name,
                context_resolver_used: true,
                context_resolver_blocked: true,
                failure_category: 'missing_base_url',
              },
            };
          }
          try {
            const output = await runLlmAgent(ai, node, {
              ...input,
              context: {
                ...input.context,
                resolver_role: 'Resolver contexto de ejecución sin ejecutar el navegador. Elegir la URL/base_url únicamente desde ambiente, dataset, inventario, datos del caso o un paso explícito. Interpretar los datos libres de cada paso y devolver resolved_context con source, confidence, inputs y ambiguities. No inventar URLs, credenciales, selectores ni valores.',
                expected_shared_memory_patch: {
                  base_url: 'URL absoluta http/https elegida para iniciar la prueba',
                  reason: 'por que se eligio esa URL',
                  relevant_variables: 'variables o datos usados',
                  resolved_context: 'interpretación estructurada de los datos por paso',
                  input_mapping: 'rol semántico, valor respaldado, origen y confianza',
                },
              },
            });
            const decidedUrl = normalizeEngineUrl(output.sharedMemoryPatch?.base_url)
              || normalizeEngineUrl(output.decision?.base_url)
              || normalizeEngineUrl(output.decision?.url)
              || normalizeEngineUrl(output.decision?.target_url);
            return {
              ...output,
              status: output.status || 'SUCCESS',
              confidence: output.confidence ?? (decidedUrl ? 95 : 80),
              reason: output.reason || (decidedUrl ? 'Contexto resuelto por agente' : 'Contexto resuelto con fallback'),
              sharedMemoryPatch: {
                ...(output.sharedMemoryPatch || {}),
                base_url: decidedUrl || fallbackUrl,
                total_steps: qaSteps.length,
                workflow_node: node.name,
                context_resolver_used: true,
              },
            };
          } catch (error: any) {
            return {
              status: fallbackUrl ? 'SUCCESS' : 'BLOCKED',
              confidence: fallbackUrl ? 70 : 100,
              reason: fallbackUrl
                ? `Context Resolver no pudo consultar el LLM; se usa URL candidata: ${error?.message || error}`
                : `Context Resolver no encontro URL ejecutable: ${error?.message || error}`,
              events: [],
              sharedMemoryPatch: {
                base_url: fallbackUrl,
                total_steps: qaSteps.length,
                workflow_node: node.name,
                context_resolver_used: true,
                context_resolver_fallback: true,
              },
            };
          }
        },
        PreExecutionAnalyst: async (node) => ({
          status: 'SUCCESS',
          confidence: 96,
          reason: 'Contratos temporales de validacion preparados antes de ejecutar los pasos.',
          events: [],
          sharedMemoryPatch: {
            workflow_node: node.name,
              execution_validation_plans: qaSteps.map((step: any) => ({
              step_number: step.number,
              mode: step.validation_plan?.mode || 'visual_semantic',
              confidence: step.validation_plan?.confidence || 0,
            })),
              resolved_context: qaSteps.map((step: any) => ({
              step_number: step.number,
              ...interpretStepData(step.data, options.contextData || {}),
            })),
          },
        }),
        Observer: async (_node, input) => {
          if (input.sharedMemory.qa_run_complete) {
            return {
              status: 'BLOCKED',
              confidence: 100,
              reason: 'no_more_steps',
              events: [],
              sharedMemoryPatch: { current_step: null },
            };
          }
          return {
            status: 'SUCCESS',
            confidence: 95,
            reason: 'Observacion delegada al runner de pasos',
            events: [],
          };
        },
        Planner: async () => ({
          status: 'SUCCESS',
          confidence: 90,
          reason: 'Planificacion delegada al agente IA por paso',
          events: [],
        }),
        SecurityGuard: async () => ({
          status: 'SUCCESS',
          confidence: 90,
          reason: 'Guard activo dentro de cada accion del runner',
          events: [],
          decision: { approved: true },
        }),
        Executor: async (_node, input) => {
          await navigateToResolvedBaseUrl(input.sharedMemory.base_url, 'Context Resolver');
          runResult = await runQaSteps(page, ai, qaSteps, {
            executionId: testId,
            task,
            ...(expected ? { expected } : {}),
            maxAttempts: 2,
            contextData: options.contextData || {},
            emit,
            logger: { log: emitAgent },
            ...(options.agentWorkflow ? { agentWorkflow: options.agentWorkflow } : {}),
          });
          const ok = runResult.errors.length === 0;
          return {
            status: ok ? 'SUCCESS' : 'FAILED',
            confidence: ok ? 90 : 60,
            reason: ok ? 'Pasos ejecutados por el runner' : runResult.errors.join(' | '),
            events: [],
            sharedMemoryPatch: {
              qa_run_complete: true,
              visited_urls: runResult.visited_urls,
              detected_errors: runResult.errors,
              last_action: runResult.history.at(-1)?.action || null,
              current_step: null,
            },
          };
        },
        Validator: async (node, input) => {
          const errors = runResult?.errors || [];
          return {
            status: errors.length ? 'FAILED' : 'SUCCESS',
            confidence: errors.length ? 60 : 90,
            reason: errors.length ? errors.join(' | ') : 'Ejecucion validada sin errores detectados',
            events: [],
            sharedMemoryPatch: {
              workflow_node: node.name,
              detected_errors: errors,
            },
          };
        },
        Recovery: async (_node, input) => ({
          status: 'BLOCKED',
          confidence: 70,
          reason: (input.sharedMemory.detected_errors || []).join(' | ') || 'No hay estrategia de recuperacion automatica disponible',
          events: [],
        }),
        Auditor: async () => {
          const audit = await performFinalAudit();
          return {
            status: 'SUCCESS',
            confidence: audit.data.confidence,
            reason: audit.data.reason,
            decision: audit.data,
            events: [],
            sharedMemoryPatch: {
              audit_status: audit.data.status,
              audit_evidence_refs: audit.data.evidence_refs,
            },
          };
        },
        Reporter: async () => ({
          status: 'SUCCESS',
          confidence: 100,
          reason: 'Trazabilidad del workflow preparada',
          events: [],
        }),
        llm_agent: async (node, input) => runLlmAgent(ai, node, input),
        rule_agent: async (node, input) => runRuleAgent(node, input),
        browser_action_agent: async (_node, input) => {
          await navigateToResolvedBaseUrl(input.sharedMemory.base_url, 'Context Resolver');
          if (!runResult) {
            runResult = await runQaSteps(page, ai, qaSteps, {
              executionId: testId,
              task,
              ...(expected ? { expected } : {}),
            maxAttempts: 2,
            contextData: options.contextData || {},
            emit,
              logger: { log: emitAgent },
              ...(options.agentWorkflow ? { agentWorkflow: options.agentWorkflow } : {}),
            });
          }
          return {
            status: runResult.errors.length ? 'FAILED' : 'SUCCESS',
            confidence: runResult.errors.length ? 60 : 90,
            reason: runResult.errors.length ? runResult.errors.join(' | ') : 'Acciones browser ejecutadas',
            events: [],
            sharedMemoryPatch: {
              qa_run_complete: true,
              visited_urls: runResult.visited_urls,
              detected_errors: runResult.errors,
            },
          };
        },
        validator_agent: async (node, input) => runValidatorAgent(node, input),
        reporter_agent: async (node, input) => runReporterAgent(node, input),
        webhook_agent: async (node, input) => runWebhookAgent(node, input),
        script_agent: async (node, input) => runScriptAgent(node, input),
        human_approval_agent: async (node) => ({
          // A universal workflow cannot auto-approve. The backend can later
          // resume from an explicit approval record without executing code.
          status: 'BLOCKED', confidence: 100,
          reason: `Aprobacion humana pendiente para ${node.name}`,
          events: [{ type: 'human_approval_requested', node_id: node.id }],
        }),
        mcp_tool_agent: async (node) => ({
          // MCP stays disabled until an installed tool is explicitly
          // allowlisted. This is safer than treating it as an LLM request.
          status: 'BLOCKED', confidence: 100,
          reason: `La herramienta MCP de ${node.name} no esta autorizada en esta instalacion`,
          events: [{ type: 'mcp_tool_blocked', node_id: node.id }],
        }),
        a2a_disabled_agent: async (node) => ({
          status: 'BLOCKED', confidence: 100,
          reason: `A2A permanece deshabilitado para ${node.name} hasta configurar identidad y confianza remota`,
          events: [{ type: 'a2a_disabled', node_id: node.id }],
        }),
        default: async (node) => ({
          status: node.enabled === false ? 'SKIPPED' : 'SUCCESS',
          confidence: 80,
          reason: `Nodo generico ${node.type} procesado`,
          events: [],
        }),
      },
      {
        timeoutMs: workflowTimeoutMs,
        emitTrace: (trace) => {
          workflowTraces.push(trace);
          const traceReason = String(trace.output_json?.reason || '');
          const isNoMoreSteps = trace.node_type === 'Observer' && trace.status === 'BLOCKED' && traceReason === 'no_more_steps';
          emitAgent(trace.node_type || 'WORKFLOW', trace.status === 'FAILED' ? 'ERROR' : isNoMoreSteps ? 'INFO' : trace.status === 'BLOCKED' ? 'WARN' : 'INFO', `${trace.node_name}: ${isNoMoreSteps ? 'sin mas pasos' : trace.status}`, {
            metrics: trace.metrics_json,
            reason: traceReason,
          });
        },
      },
    );
    workflowTraces = workflowResult.traces;
    if (!runResult) {
      runResult = { steps: [], history: [], visited_urls: [], checkpoints: [], errors: workflowResult.lastOutput?.reason ? [workflowResult.lastOutput.reason] : ['Workflow finalizado sin ejecutar pasos'] };
    }
  } else {
    await navigateToResolvedBaseUrl(urlCandidate, 'fallback sin workflow');
    runResult = await runQaSteps(page, ai, qaSteps, {
      executionId: testId,
      task,
      ...(expected ? { expected } : {}),
            maxAttempts: 2,
            contextData: options.contextData || {},
            emit,
      logger: { log: emitAgent },
      ...(options.agentWorkflow ? { agentWorkflow: options.agentWorkflow } : {}),
    });
  }
  return { runResult, workflowTraces };
}
