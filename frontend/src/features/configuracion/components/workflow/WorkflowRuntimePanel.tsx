import { Badge, Button, Form, Tab, Tabs } from 'react-bootstrap'
import { Activity } from 'lucide-react'
import { useI18n } from '../../../../i18n'

type Props = {
  traceExecutionId: string
  setTraceExecutionId: (value: string) => void
  runtimeTraces: any[]
  workflowRuntimeExpanded: boolean
  setWorkflowRuntimeExpanded: (expanded: boolean) => void
  loadRuntimeTraces: () => void
}

export function WorkflowRuntimePanel({
  traceExecutionId,
  setTraceExecutionId,
  runtimeTraces,
  workflowRuntimeExpanded,
  setWorkflowRuntimeExpanded,
  loadRuntimeTraces,
}: Props) {
  const { t } = useI18n()
  return (
    <div className={`workflow-runtime ${workflowRuntimeExpanded ? 'is-expanded' : 'is-collapsed'}`}>
      <div className="workflow-runtime-header">
        <div>
          <div className="fw-bold small"><Activity size={14} className="me-1" /> {t('configuracion.runtimeTraceability')}</div>
          <div className="x-small text-muted">{t('configuracion.runtimeDesc')}</div>
        </div>
        <div className="workflow-runtime-actions">
          <Form.Label visuallyHidden htmlFor="workflow-trace-execution-id">{t('configuracion.executionId')}</Form.Label>
          <Form.Control id="workflow-trace-execution-id" name="workflow_trace_execution_id" autoComplete="off" size="sm" placeholder={`${t('configuracion.executionId')}…`} value={traceExecutionId} onChange={(event) => setTraceExecutionId(event.target.value)} />
          <Button size="sm" variant="outline-primary" className="fw-bold" type="button" onClick={loadRuntimeTraces}>{t('configuracion.load')}</Button>
          <Button size="sm" variant="light" type="button" onClick={() => setWorkflowRuntimeExpanded(!workflowRuntimeExpanded)}>{workflowRuntimeExpanded ? t('configuracion.collapse') : t('configuracion.expand')}</Button>
        </div>
      </div>
      {workflowRuntimeExpanded && (
        <Tabs defaultActiveKey="timeline" className="workflow-runtime-tabs">
          <Tab eventKey="timeline" title={t('configuracion.timeline')}>
            <div className="workflow-runtime-strip">
              {runtimeTraces.map((trace, index) => (
                <div key={trace.id} className={`workflow-runtime-chip is-${String(trace.status || '').toLowerCase()}`}>
                  <span>{index + 1}</span>
                  <strong>{trace.node_id ? String(trace.node_id).slice(0, 8) : 'workflow'}</strong>
                  <small>{trace.status}</small>
                </div>
              ))}
              {runtimeTraces.length === 0 && <div className="small text-muted">{t('configuracion.noTraces')}</div>}
            </div>
          </Tab>
          <Tab eventKey="events" title={t('configuracion.events')}>
            <div className="workflow-runtime-list">
              {runtimeTraces.map(trace => (
                <details key={trace.id} className="workflow-runtime-item">
                  <summary><Badge bg={trace.status === 'SUCCESS' ? 'success' : trace.status === 'FAILED' ? 'danger' : trace.status === 'BLOCKED' ? 'primary' : 'secondary'}>{trace.status}</Badge><span className="font-monospace">{trace.node_id || 'workflow'}</span><span className="text-muted">{trace.started_at || '-'}</span></summary>
                  <pre>{JSON.stringify({ input: trace.input_json, output: trace.output_json, metrics: trace.metrics_json }, null, 2)}</pre>
                </details>
              ))}
            </div>
          </Tab>
          <Tab eventKey="variables" title={t('configuracion.variables')}>
            <pre>{JSON.stringify(runtimeTraces.at(-1)?.output_json?.sharedMemoryPatch || {}, null, 2)}</pre>
          </Tab>
          <Tab eventKey="metrics" title={t('configuracion.metrics')}>
            <pre>{JSON.stringify(runtimeTraces.map(trace => trace.metrics_json || {}), null, 2)}</pre>
          </Tab>
          <Tab eventKey="logs" title={t('configuracion.logs')}>
            <pre>{JSON.stringify(runtimeTraces.map(trace => ({ status: trace.status, output: trace.output_json })), null, 2)}</pre>
          </Tab>
        </Tabs>
      )}
    </div>
  )
}
