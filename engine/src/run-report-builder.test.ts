import test from 'node:test';
import assert from 'node:assert/strict';
import { AI_REPORT_DELIVERY_BUDGET_BYTES, compactAiReportForDelivery } from './run-report-builder.ts';

test('bounds duplicated workflow telemetry while preserving steps and evidence', () => {
  const verbose = 'x'.repeat(4000);
  const traces = Array.from({ length: 70 }, (_, index) => ({
    ts: new Date().toISOString(),
    node_id: `node-${index}`,
    node_name: `Agent ${index}`,
    node_type: 'universal_agent',
    status: 'SUCCESS',
    started_at: new Date().toISOString(),
    ended_at: new Date().toISOString(),
    input_json: { executionId: 'execution-1', current_step: index + 1, repeated_context: verbose },
    output_json: { status: 'SUCCESS', confidence: 95, reason: 'ok', sharedMemoryPatch: { repeated_context: verbose } },
    metrics_json: { latency_ms: 5 },
  }));
  const steps = Array.from({ length: 12 }, (_, index) => ({
    number: index + 1,
    status: 'PASO',
    action: `Action ${index + 1}`,
    evidence: { screenshot_available: true, note: `Evidence ${index + 1}` },
  }));
  const report = compactAiReportForDelivery({
    status: 'PASO',
    audit_evidence: { steps, summary: { passed: 12 } },
    steps,
    workflow_traces: traces,
    agent_conversation: traces.map((trace) => ({ ...trace, message: 'SUCCESS', reason: 'ok' })),
    timeline: traces.map((trace) => ({ ...trace, agent: 'WORKFLOW', level: 'INFO', message: verbose })),
  });

  assert.ok(Buffer.byteLength(JSON.stringify(report), 'utf8') <= AI_REPORT_DELIVERY_BUDGET_BYTES);
  assert.equal(report.steps.length, 12);
  assert.equal(report.audit_evidence.steps.length, 12);
  assert.equal(report.workflow_traces.length, 70);
  assert.equal(report.status, 'PASO');
  assert.equal(report.report_compaction.applied, true);
});
