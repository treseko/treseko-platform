import { useState, type FormEvent } from 'react'
import { BotMessageSquare, FileCode, Plus } from 'lucide-react'
import { Button, Form, Modal } from 'react-bootstrap'
import { useI18n } from '../../../../i18n'

type Props = {
  show: boolean
  onHide: () => void
  onCreate: (payload: Record<string, any>) => Promise<any>
}

const templates = {
  empty: { label: 'Vacío seguro', adapter: 'universal-rules/v1', strategy: 'rules', mode: 'deterministic', capabilities: ['rules.evaluate'], category: 'custom' },
  context: { label: 'Contexto', adapter: 'universal-rules/v1', strategy: 'mapping', mode: 'deterministic', capabilities: ['context.read_case', 'context.read_variables', 'context.resolve_url', 'memory.write'], category: 'context' },
  llm: { label: 'Análisis con IA', adapter: 'universal-llm/v1', strategy: 'prompt', mode: 'llm', capabilities: ['llm.reason', 'memory.read', 'memory.write'], category: 'analysis' },
  browser: { label: 'Navegador', adapter: 'universal-browser/v1', strategy: 'hybrid', mode: 'tool_orchestrated', capabilities: ['browser.navigate', 'browser.observe', 'browser.execute_safe_action', 'evidence.capture', 'memory.write'], category: 'browser' },
  rules: { label: 'Reglas seguras', adapter: 'universal-rules/v1', strategy: 'rules', mode: 'deterministic', capabilities: ['rules.evaluate', 'rules.route', 'memory.read', 'memory.write'], category: 'validation' },
  validation: { label: 'Validación', adapter: 'universal-rules/v1', strategy: 'rules', mode: 'deterministic', capabilities: ['validation.evaluate_contract', 'validation.compare_value', 'evidence.read', 'memory.write'], category: 'validation' },
  audit: { label: 'Auditoría', adapter: 'universal-llm/v1', strategy: 'hybrid', mode: 'hybrid', capabilities: ['evidence.read', 'llm.audit', 'memory.read', 'memory.write'], category: 'audit' },
  recovery: { label: 'Recuperación', adapter: 'universal-rules/v1', strategy: 'rules', mode: 'deterministic', capabilities: ['rules.evaluate', 'rules.route', 'memory.read', 'memory.write'], category: 'recovery' },
  approval: { label: 'Aprobación humana', adapter: 'universal-human-approval/v1', strategy: 'none', mode: 'deterministic', capabilities: ['human.request_approval', 'trace.write'], category: 'approval' },
  report: { label: 'Reporte', adapter: 'universal-reporter/v1', strategy: 'none', mode: 'deterministic', capabilities: ['report.generate', 'trace.write', 'memory.read'], category: 'reporting' },
} as const

function keyFromName(value: string) {
  return value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 100)
}

export function UniversalAgentCreatorModal({ show, onHide, onCreate }: Props) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [template, setTemplate] = useState<keyof typeof templates>('llm')
  const [instructions, setInstructions] = useState('')
  const [saving, setSaving] = useState(false)
  const selected = templates[template]
  const key = keyFromName(name)

  const submit = async (event: FormEvent) => {
    event.preventDefault()
    if (!key) return
    setSaving(true)
    try {
      await onCreate({
        key, name, description, category: selected.category, origin_type: 'user', version: '1.0.0',
        contract: {
          contract_version: 'treseko.universal-agent/v1', key, version: '1.0.0', name, description, status: 'DRAFT',
          metadata: { author_type: 'user', source_agent_id: null, source_package: null, tags: [], engine_compatibility: '>=1.0.0' },
          implementation: { runtime_key: 'universal-agent-runtime/v1', capability_profile: selected.category, native_adapter: selected.adapter, editable_strategy: selected.strategy },
          inputs: { schema: {}, mapping: {}, allowed_context_sources: ['case', 'shared_memory', 'evidence'] },
          instructions: { mode: selected.mode === 'llm' ? 'llm' : 'rules', system_policy_ref: 'qa-safe-agent/v1', role: name, objective: description || name, constraints: ['No ejecutar código arbitrario', 'No exponer secretos'], user_instructions: instructions, context_sources: ['case', 'shared_memory'], output_format: 'json_schema' },
          capabilities: selected.capabilities, tools: { allowed: [], configuration: {} },
          decision_policy: { strategy: selected.mode === 'llm' ? 'llm' : 'rules', on_success: 'success', on_failure: 'failed', on_inconclusive: 'blocked', fallback: null },
          output_contract: { schema: {}, publish: {}, required_evidence: [] },
          memory: { read_namespaces: ['execution'], write_namespaces: ['execution'], retention: 'execution' },
          execution: { timeout_sec: 60, max_retries: 0, retry_backoff_ms: 0, model: { selection: 'runtime_default', allowed_models: [], temperature: null, max_tokens: null, requires_vision: false } },
          ports: { control_inputs: ['input'], control_outputs: ['success', 'failed', 'blocked', 'retry'], data_inputs: {}, data_outputs: {} },
          security: { required_permissions: ['motor_ia.workflow_execute'], required_secret_refs: [], allow_private_network: false, allow_filesystem: false, allow_shell: false, allow_arbitrary_code: false, audit_level: 'full' },
          ui: { category: selected.category, icon_key: 'bot', color: '', help_text: `Agente universal creado desde plantilla ${selected.label}.` },
        },
      })
      onHide()
      setName('')
      setDescription('')
      setInstructions('')
      setTemplate('llm')
    } finally {
      setSaving(false)
    }
  }

  return (
    <Modal show={show} onHide={onHide} centered>
      <Form onSubmit={submit}>
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold d-flex align-items-center gap-2">
            <BotMessageSquare size={20} className="text-primary" />
            {t('configuracion.universalAgentCreateTitle')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-0 d-flex flex-column gap-3">
          <div className="small text-muted">
            {t('configuracion.universalAgentDraftDescription')}
          </div>
          <Form.Group>
            <Form.Label>{t('configuracion.universalAgentName')}</Form.Label>
            <Form.Control
              value={name}
              onChange={event => setName(event.target.value)}
              required
              maxLength={150}
              autoFocus
            />
            <Form.Text>{t('configuracion.universalAgentKey')}: {key || t('configuracion.universalAgentKeyGenerated')}</Form.Text>
          </Form.Group>
          <Form.Group>
            <Form.Label>{t('configuracion.universalAgentDescription')}</Form.Label>
            <Form.Control as="textarea" rows={2} value={description} onChange={event => setDescription(event.target.value)} maxLength={2000} />
          </Form.Group>
          <Form.Group>
            <Form.Label>{t('configuracion.universalAgentTemplate')}</Form.Label>
            <Form.Select
              value={template}
              onChange={event => setTemplate(event.target.value as keyof typeof templates)}
            >
              {Object.entries(templates).map(([value, item]) => (
                <option key={value} value={value}>
                  {t(`configuracion.universalAgentTemplate${value[0].toUpperCase()}${value.slice(1)}` as any)}
                </option>
              ))}
            </Form.Select>
            <Form.Text>{t('configuracion.universalAgentCapabilities')}: {selected.capabilities.join(', ')}</Form.Text>
          </Form.Group>
          {selected.strategy !== 'none' && (
            <Form.Group>
              <Form.Label>{t('configuracion.universalAgentInstructions')}</Form.Label>
              <Form.Control
                as="textarea"
                rows={4}
                value={instructions}
                onChange={event => setInstructions(event.target.value)}
                placeholder={t('configuracion.universalAgentInstructionsPlaceholder')}
              />
              <Form.Text>{t('configuracion.universalAgentSecurityPolicyHint')}</Form.Text>
            </Form.Group>
          )}
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="outline-secondary" onClick={onHide}>
            {t('common.cancel')}
          </Button>
          <Button type="submit" disabled={!key || saving} variant="primary" className="d-flex align-items-center gap-2">
            <FileCode size={16} />
            {saving ? t('configuracion.universalAgentCreating') : t('configuracion.universalAgentCreateDraft')}
          </Button>
        </Modal.Footer>
      </Form>
    </Modal>
  )
}
