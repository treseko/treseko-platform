import { buildAiReport } from './run-report-builder.ts';
import { normalizeAuditDecision, resolveAuditConsensus, type AuditEvidenceBundle } from './audit/consensus.ts';
import { ENGINE_LOCAL_EVIDENCE_ENABLED, ENGINE_NAME, ENGINE_VERSION } from './runtime-config.ts';

export async function finalizeSuccessfulRun(context: any): Promise<any> {
  const { runResult, qaSteps, report, emitAgent, emit, browser, opencode, testId, startedAt, ai, task, suite,
    validation, auditEvidence, visualAuditUsed, finalScreenshot, timeline, workflowTraces, options, maxSteps,
    workflowTimeoutMs, resultSteps, url, flushAndCloseBackendWs } = context;

  for (const step of runResult.steps) {
    const last = step.history[step.history.length - 1];
    if (last?.metrics) report.addUsage(last.metrics);
    report.addStep(step.number, last ? JSON.stringify(last.action) : 'Sin accion',
      qaSteps.find((item: any) => item.number === step.number)?.expected || context.expected || 'Validar resultado esperado',
      step.observations || '', step.status === 'PASO' ? 'PASSED' : 'FAILED', step.screenshot_base64 || '', step.error_log || step.observations || '');
    const persisted: any = { number: step.number, status: step.status };
    for (const key of ['observations', 'error_log', 'screenshot_base64', 'agent', 'failure_category', 'reason', 'action_summary', 'url']) {
      if (step[key]) persisted[key] = step[key];
    }
    if (typeof step.action_executed === 'boolean') persisted.action_executed = step.action_executed;
    resultSteps.push(persisted);
  }
  emitAgent('SYSTEM', 'INFO', 'Pasos QA finalizados. Iniciando auditoria final.');
  const consensusDecision = resolveAuditConsensus(auditEvidence as AuditEvidenceBundle, validation);
  emitAgent('AUDITOR', 'INFO', visualAuditUsed
    ? `Auditoria visual aplicada sobre ${validation.evidence_refs.length} captura(s) citada(s).`
    : 'Auditoria visual no aplicada: se uso validacion determinista o el modelo no soporta vision.', {
      confidence: validation.confidence, reason: validation.reason, visual_audit: visualAuditUsed,
      evidence_refs: visualAuditUsed ? validation.evidence_refs : undefined,
    });
  emitAgent('AUDITOR', consensusDecision.human_review_required ? 'WARN' : 'INFO',
    `Resultado visual: ${validation.status}; resultado final: ${consensusDecision.final_status}`, {
      confidence: consensusDecision.confidence, reason: consensusDecision.reason, validation,
    });
  emitAgent('AUDITOR', 'INFO', `Resolucion de consenso: ${consensusDecision.resolution}`, {
    confidence: consensusDecision.confidence, reason: consensusDecision.reason,
  });
  report.setFinalStatus(consensusDecision.final_status, consensusDecision.reason, consensusDecision.confidence);
  await browser.close();
  await opencode?.closeRun(testId);
  const reportPath = await report.generate();
  const localEvidenceLog = ENGINE_LOCAL_EVIDENCE_ENABLED ? `Reporte generado: ${reportPath}` : reportPath;
  emitAgent('SYSTEM', 'SUCCESS', `Test ${testId} finalizado.`);
  const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const finalStatus = consensusDecision.final_status;
  const aiReport = buildAiReport({ task, testId, suite, model: ai.model, status: finalStatus, durationSeconds,
    validation, auditDecision: validation, consensusDecision, auditEvidence: auditEvidence as AuditEvidenceBundle,
    visualAuditUsed, runResult, resultSteps, errors: runResult.errors, startedAt, url,
    finalScreenshotBase64: finalScreenshot?.toString('base64'), timeline, workflowTraces,
    parameters: { maxSteps, timeout_seconds: Math.round(workflowTimeoutMs / 1000), headless: Boolean(options.headless),
      viewport: options.viewport, llm_endpoint: options.aiConfig?.endpoint, provider: options.aiConfig?.provider,
      model: ai.model, temperature: options.aiConfig?.temperature, step_count: qaSteps.length,
      agent_workflow: options.agentWorkflow || [], workflow_definition: options.workflowDefinition || null,
      context: options.contextData || {} },
  });
  emit('execution_finished', { status: finalStatus, report_pending: true, duration_seconds: durationSeconds,
    observations: consensusDecision.reason, confidence: aiReport.confidence, consensus: aiReport.consensus,
    failure_category: aiReport.failure_category, human_review_required: aiReport.human_review_required, model: ai.model,
    message: `Ejecucion finalizada: ${finalStatus}`, ai_report_summary: { confidence: aiReport.confidence,
      consensus: aiReport.consensus, failure_category: aiReport.failure_category, human_review_required: aiReport.human_review_required } });
  await flushAndCloseBackendWs();
  return { status: finalStatus, duration_seconds: durationSeconds, observations: consensusDecision.reason,
    logs: localEvidenceLog, metadata: { engine: ENGINE_NAME, version: ENGINE_VERSION,
      local_evidence_enabled: ENGINE_LOCAL_EVIDENCE_ENABLED, model: ai.model, confidence: consensusDecision.confidence,
      audit_status: validation.status, structured_history: true, report_complete: true,
      ai_report_summary: { confidence: aiReport.confidence, consensus: aiReport.consensus,
        failure_category: aiReport.failure_category, human_review_required: aiReport.human_review_required } },
    ai_report: aiReport, steps: resultSteps, visited_urls: runResult.visited_urls, errors: runResult.errors,
    final_result: consensusDecision.reason, final_screenshot_base64: finalScreenshot?.toString('base64') };
}

export async function finalizeFailedRun(context: any): Promise<any> {
  const { error, safeExecutionError, emitAgent, emit, report, browser, opencode, testId, startedAt, task, suite,
    ai, resultSteps, timeline, options, maxSteps, workflowTimeoutMs, url, flushAndCloseBackendWs } = context;
  const safeError = safeExecutionError(error);
  emitAgent('SYSTEM', 'ERROR', `Error en ${testId}: ${safeError}`);
  emit('status', { agent: 'SYSTEM', level: 'ERROR', message: 'El Engine no pudo completar la ejecución.', error_code: 'ENGINE_EXECUTION_FAILED' });
  report.setFinalStatus('FAILED', safeError, 0);
  let finalScreenshot: string | undefined;
  try { const page = browser.getPage(); finalScreenshot = page.isClosed() ? undefined : (await page.screenshot()).toString('base64'); } catch (_) {}
  await browser.close();
  await opencode?.closeRun(testId);
  const durationSeconds = Math.max(0, Math.round((Date.now() - startedAt) / 1000));
  const catchAuditDecision = normalizeAuditDecision({ status: 'FAILED', reason: safeError, confidence: 0,
    evidence_refs: [], failed_expectations: [safeError], missing_evidence: [], contradictions: [] });
  const catchEvidence: AuditEvidenceBundle = { schema_version: 1, objective: task, technical_status: 'FALLO',
    technical_errors: [safeError], final_url: '', final_title: '', steps: [], summary: { total_steps: 0,
      passed_steps: 0, failed_steps: 1, conclusive_assertions: 0, failed_assertions: 0, screenshot_count: finalScreenshot ? 1 : 0,
      full_contract_steps: 0, partial_contract_steps: 0, semantic_audit_steps: 0 } };
  const catchConsensus = resolveAuditConsensus(catchEvidence, catchAuditDecision);
  const errorReport = buildAiReport({ task, testId, suite, model: ai.model, status: 'FALLO', durationSeconds,
    validation: catchAuditDecision, auditDecision: catchAuditDecision, consensusDecision: catchConsensus, auditEvidence: catchEvidence,
    visualAuditUsed: false, resultSteps, errors: [safeError], startedAt, url, finalScreenshotBase64: finalScreenshot,
    timeline, workflowTraces: [], parameters: { maxSteps, timeout_seconds: Math.round(workflowTimeoutMs / 1000),
      headless: Boolean(options.headless), viewport: options.viewport, llm_endpoint: options.aiConfig?.endpoint,
      provider: options.aiConfig?.provider, model: ai.model, temperature: options.aiConfig?.temperature,
      agent_workflow: options.agentWorkflow || [], workflow_definition: options.workflowDefinition || null, context: options.contextData || {} } });
  emit('execution_finished', { status: 'FALLO', report_pending: true, duration_seconds: durationSeconds, observations: safeError,
    error_message: safeError, confidence: errorReport.confidence, consensus: errorReport.consensus,
    failure_category: errorReport.failure_category, human_review_required: true, model: ai.model,
    message: 'Ejecucion finalizada con error', ai_report_summary: { confidence: errorReport.confidence,
      consensus: errorReport.consensus, failure_category: errorReport.failure_category, human_review_required: errorReport.human_review_required } });
  await flushAndCloseBackendWs();
  return { status: 'FALLO', duration_seconds: durationSeconds, observations: safeError, error_message: safeError, logs: '',
    metadata: { engine: ENGINE_NAME, version: ENGINE_VERSION, local_evidence_enabled: ENGINE_LOCAL_EVIDENCE_ENABLED,
      model: ai.model, report_complete: true, ai_report_summary: { confidence: errorReport.confidence,
        consensus: errorReport.consensus, failure_category: errorReport.failure_category, human_review_required: errorReport.human_review_required } },
    ai_report: errorReport, steps: resultSteps, final_screenshot_base64: finalScreenshot };
}
