import { useEffect, useMemo, useState } from 'react'
import { Accordion, Button, Col, Form, Row } from 'react-bootstrap'
import { Code2, Plus, Trash2 } from 'lucide-react'
import { ApiKeyValueEditor, type ApiKeyValueItem } from './ApiKeyValueEditor'

type Props = {
  config: Record<string, any>
  request: Record<string, any>
  onConfigChange: (config: Record<string, any>) => void
  onRequestChange: (key: string, value: any) => void
  t: (key: string) => string
}

function variableRows(variables: unknown): ApiKeyValueItem[] {
  if (!variables || typeof variables !== 'object' || Array.isArray(variables)) return []
  return Object.entries(variables).map(([key, value]) => ({ key, value, enabled: true }))
}

function variablesFromRows(rows: ApiKeyValueItem[]) {
  return Object.fromEntries(rows.filter(row => row.enabled !== false && String(row.key || '').trim()).map(row => [String(row.key).trim(), row.value ?? '']))
}

export function ApiAdvancedSettings({ config, request, onConfigChange, onRequestChange, t }: Props) {
  const [rawConfig, setRawConfig] = useState('')
  const [rawDirty, setRawDirty] = useState(false)
  const [rawError, setRawError] = useState('')
  const variables = useMemo(() => variableRows(config.variables), [config.variables])
  const extractors = Array.isArray(config.extractors) ? config.extractors : []
  const execution = config.execution || {}

  useEffect(() => {
    if (rawDirty) return
    setRawConfig(JSON.stringify(config, null, 2))
  }, [config, rawDirty])

  const updateConfig = (key: string, value: any) => onConfigChange({ ...config, schema_version: 'treseko.api-test/v2', [key]: value })
  const updateExtractor = (index: number, changes: Record<string, any>) => updateConfig('extractors', extractors.map((item: any, currentIndex: number) => currentIndex === index ? { ...item, ...changes } : item))
  const addExtractor = () => updateConfig('extractors', [...extractors, { name: '', source: 'response.body', selector: '$', required: true }])
  const removeExtractor = (index: number) => updateConfig('extractors', extractors.filter((_: any, currentIndex: number) => currentIndex !== index))

  const applyRawConfig = () => {
    try {
      const parsed = JSON.parse(rawConfig)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        setRawError(t('casos.apiAdvancedJsonObjectError'))
        return
      }
      onConfigChange({ ...parsed, schema_version: 'treseko.api-test/v2' })
      setRawDirty(false)
      setRawError('')
    } catch {
      setRawError(t('casos.apiAdvancedJsonInvalid'))
    }
  }

  return (
    <Accordion className="api-advanced-settings">
      <Accordion.Item eventKey="http">
        <Accordion.Header>{t('casos.apiAdvancedHttpTitle')}</Accordion.Header>
        <Accordion.Body>
          <div className="small text-muted mb-3">{t('casos.apiAdvancedHttpHelp')}</div>
          <ApiKeyValueEditor
            t={t}
            items={Array.isArray(request.cookies) ? request.cookies : []}
            onChange={items => onRequestChange('cookies', items)}
            fieldName="cookie"
            fieldLabel={t('casos.apiCookieField')}
            emptyText={t('casos.apiAdvancedCookiesEmpty')}
            addLabel={t('casos.apiAdvancedAddCookie')}
            keyPlaceholder={t('casos.apiAdvancedCookieName')}
            valuePlaceholder={t('casos.apiValue')}
          />
          <Row className="g-3 mt-2">
            <Col md={6}>
              <Form.Label htmlFor="api-advanced-timeout" className="small fw-semibold">{t('casos.apiAdvancedTimeout')}</Form.Label>
              <div className="input-group input-group-sm">
                <Form.Control id="api-advanced-timeout" type="number" min={100} max={120000} value={request.timeout?.total_ms || 45000} onChange={event => onRequestChange('timeout', { ...(request.timeout || {}), total_ms: Number(event.target.value) })} />
                <span className="input-group-text">ms</span>
              </div>
            </Col>
            <Col md={6} className="d-flex align-items-end">
              <Form.Check type="switch" label={t('casos.apiAdvancedFollowRedirects')} checked={request.redirects?.follow === true} onChange={event => onRequestChange('redirects', { ...(request.redirects || {}), follow: event.target.checked })} />
            </Col>
          </Row>
        </Accordion.Body>
      </Accordion.Item>

      <Accordion.Item eventKey="variables">
        <Accordion.Header>{t('casos.apiAdvancedVariablesTitle')}</Accordion.Header>
        <Accordion.Body>
          <div className="small fw-semibold mb-1">{t('casos.apiAdvancedCaseVariables')}</div>
          <div className="small text-muted mb-2">{t('casos.apiAdvancedVariablesHelp')} <code>{'{{nombre}}'}</code>.</div>
          <ApiKeyValueEditor
            t={t}
            items={variables}
            onChange={items => updateConfig('variables', variablesFromRows(items))}
            fieldName="variable"
            fieldLabel={t('casos.apiVariableField')}
            emptyText={t('casos.apiAdvancedVariablesEmpty')}
            addLabel={t('casos.apiAdvancedAddVariable')}
            keyPlaceholder={t('casos.apiAdvancedVariableName')}
            valuePlaceholder={t('casos.apiValue')}
          />

          <div className="small fw-semibold mt-4 mb-1">{t('casos.apiAdvancedResponseDataTitle')}</div>
          <div className="small text-muted mb-2">{t('casos.apiAdvancedResponseDataHelp')}</div>
          {extractors.length === 0 && <div className="small text-muted py-3 text-center border rounded-2 bg-light-subtle">{t('casos.apiAdvancedExtractorsEmpty')}</div>}
          {extractors.map((extractor: any, index: number) => (
            <div className="api-extractor-row" key={extractor.id || index}>
              <Form.Check aria-label={`${t('casos.apiAdvancedRequiredExtractor')} ${index + 1}`} checked={extractor.required !== false} onChange={event => updateExtractor(index, { required: event.target.checked })} />
              <Form.Control size="sm" value={extractor.name || ''} onChange={event => updateExtractor(index, { name: event.target.value })} placeholder={t('casos.apiAdvancedVariableName')} />
              <Form.Select size="sm" value={extractor.source || 'response.body'} onChange={event => updateExtractor(index, { source: event.target.value })}>
                <option value="response.body">{t('casos.apiAdvancedSourceBody')}</option>
                <option value="response.headers">{t('casos.apiAdvancedSourceHeaders')}</option>
                <option value="response.cookies">{t('casos.apiAdvancedSourceCookies')}</option>
                <option value="response.text">{t('casos.apiAdvancedSourceText')}</option>
                <option value="response.status">{t('casos.apiAdvancedSourceStatus')}</option>
              </Form.Select>
              <Form.Control size="sm" className="font-monospace" value={extractor.selector || ''} onChange={event => updateExtractor(index, { selector: event.target.value })} placeholder="$.token" />
              <Form.Check
                type="switch"
                label={t('casos.apiAdvancedPersist')}
                checked={extractor.persist === true}
                disabled={!String(extractor.name || '').startsWith('api.')}
                onChange={event => updateExtractor(index, { persist: event.target.checked })}
                title={t('casos.apiAdvancedPersistTitle')}
              />
              <Button variant="outline-danger" size="sm" aria-label={`${t('casos.apiAdvancedRemoveExtractor')} ${index + 1}`} onClick={() => removeExtractor(index)}><Trash2 size={14} /></Button>
            </div>
          ))}
          <Button variant="outline-primary" size="sm" className="mt-2" onClick={addExtractor}><Plus size={14} className="me-1" /> {t('casos.apiAdvancedAddExtractor')}</Button>
        </Accordion.Body>
      </Accordion.Item>

      <Accordion.Item eventKey="scripts">
        <Accordion.Header>{t('casos.apiAdvancedScriptsTitle')}</Accordion.Header>
        <Accordion.Body>
          <div className="small text-muted mb-3">{t('casos.apiAdvancedScriptsHelp')}</div>
          <Row className="g-3">
            <Col md={6}>
              <Form.Label htmlFor="api-advanced-pre-request" className="small fw-semibold">{t('casos.apiAdvancedBeforeRequest')}</Form.Label>
              <Form.Control id="api-advanced-pre-request" as="textarea" rows={7} value={typeof config.pre_request_script === 'string' ? config.pre_request_script : ''} onChange={event => updateConfig('pre_request_script', event.target.value || null)} placeholder="pm.variables.set('id', '123')" className="font-monospace" />
              <Form.Text>{t('casos.apiAdvancedPreRequestHelp')}</Form.Text>
            </Col>
            <Col md={6}>
              <Form.Label htmlFor="api-advanced-post-response" className="small fw-semibold">{t('casos.apiAdvancedAfterResponse')}</Form.Label>
              <Form.Control id="api-advanced-post-response" as="textarea" rows={7} value={typeof config.post_response_script === 'string' ? config.post_response_script : ''} onChange={event => updateConfig('post_response_script', event.target.value || null)} placeholder="pm.test('status', () => pm.response.to.have.status(200))" className="font-monospace" />
              <Form.Text>{t('casos.apiAdvancedPostResponseHelp')}</Form.Text>
            </Col>
          </Row>
        </Accordion.Body>
      </Accordion.Item>

      <Accordion.Item eventKey="runner">
        <Accordion.Header>{t('casos.apiAdvancedRunnerTitle')}</Accordion.Header>
        <Accordion.Body>
          <div className="small text-muted mb-3">{t('casos.apiAdvancedRunnerHelp')}</div>
          <Row className="g-3 align-items-end">
            <Col md={3}><Form.Label htmlFor="api-advanced-iterations" className="small fw-semibold">{t('casos.apiAdvancedIterations')}</Form.Label><Form.Control id="api-advanced-iterations" type="number" min={1} max={100} value={execution.iterations || 1} onChange={event => updateConfig('execution', { ...execution, iterations: Number(event.target.value) || 1 })} /></Col>
            <Col md={3}><Form.Label htmlFor="api-advanced-parallelism" className="small fw-semibold">{t('casos.apiAdvancedParallelism')}</Form.Label><Form.Control id="api-advanced-parallelism" type="number" min={1} max={20} value={execution.parallelism || 1} onChange={event => updateConfig('execution', { ...execution, parallelism: Number(event.target.value) || 1 })} /></Col>
            <Col md={6}><Form.Check type="switch" label={t('casos.apiAdvancedFailFast')} checked={execution.fail_fast !== false} onChange={event => updateConfig('execution', { ...execution, fail_fast: event.target.checked })} /></Col>
          </Row>
        </Accordion.Body>
      </Accordion.Item>

      <Accordion.Item eventKey="json">
        <Accordion.Header>{t('casos.apiAdvancedJsonTitle')}</Accordion.Header>
        <Accordion.Body>
          <div className="d-flex align-items-center gap-2 mb-2">
            <Code2 size={16} />
            <span className="small text-muted">{t('casos.apiAdvancedJsonHelp')}</span>
          </div>
          <Form.Control as="textarea" rows={14} value={rawConfig} onChange={event => { setRawConfig(event.target.value); setRawDirty(true); setRawError('') }} className={`font-monospace ${rawError ? 'is-invalid' : ''}`} aria-label={t('casos.apiAdvancedJsonAria')} />
          {rawError && <div className="invalid-feedback d-block">{rawError}</div>}
          <Button variant="outline-primary" size="sm" className="mt-2" disabled={!rawDirty} onClick={applyRawConfig}>{t('casos.apiAdvancedJsonApply')}</Button>
        </Accordion.Body>
      </Accordion.Item>
    </Accordion>
  )
}
