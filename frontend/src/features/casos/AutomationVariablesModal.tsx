import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Col, Form, Modal, Row, Tab, Tabs, Table } from 'react-bootstrap'
import { Database, Copy, Plus, Save, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
import { API_BASE } from '../../app/constants'

type AutomationVariablesModalProps = {
  show: boolean
  onHide: () => void
  projectId: string
  componentId: string
  componentsList: any[]
  environments: any[]
  setEnvironments: (updater: any) => void
  setComponentsList: (updater: any) => void
  caseDataText: string
  setCaseDataText: (value: string) => void
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, type: string) => void
  canEdit?: boolean
}

const parseKeyValueText = (text: string) => {
  return String(text || '').split(/\r?\n/).reduce((acc: Record<string, string>, rawLine) => {
    const line = rawLine.trim()
    if (!line || line.startsWith('#')) return acc
    const index = line.indexOf('=')
    if (index === -1) return acc
    const key = line.slice(0, index).trim()
    const value = line.slice(index + 1).trim()
    if (key) acc[key] = value
    return acc
  }, {})
}

const formatKeyValue = (value: any) => {
  if (typeof value === 'string') return value
  return Object.entries(value || {}).map(([key, val]) => `${key}=${String(val)}`).join('\n')
}

const normalizeDataset = (dataset: any) => ({
  id: dataset.id,
  environmentId: dataset.environmentId || dataset.entorno_id,
  name: dataset.name || dataset.nombre || '',
  description: dataset.description || dataset.descripcion || '',
  variables: dataset.variables || {},
  active: dataset.active ?? dataset.activo ?? true,
  isDefault: dataset.isDefault ?? dataset.es_default ?? false
})

const normalizeApiState = (item: any) => ({
  key: String(item.key || ''),
  value: item.value,
  version: Number(item.version || 0),
  fechaActualizacion: item.fecha_actualizacion || null,
})

export function AutomationVariablesModal({
  show,
  onHide,
  projectId,
  componentId,
  componentsList,
  environments,
  setEnvironments,
  setComponentsList,
  caseDataText,
  setCaseDataText,
  fetchWithAuth,
  showFeedback,
  canEdit = true
}: AutomationVariablesModalProps) {
  const { t } = useI18n()
  const projectEnvironments = useMemo(() => environments.filter((env: any) => env.projectId === projectId), [environments, projectId])
  const currentComponent = componentsList.find(component => component.id === componentId)
  const [selectedEnvId, setSelectedEnvId] = useState('')
  const [newDataset, setNewDataset] = useState({ name: '', description: '', variablesText: '', isDefault: false })
  const [editingDatasets, setEditingDatasets] = useState<Record<string, any>>({})
  const [componentVariablesText, setComponentVariablesText] = useState('')
  const [localCaseDataText, setLocalCaseDataText] = useState(caseDataText || '')
  const [savingKey, setSavingKey] = useState('')
  const [apiState, setApiState] = useState<any[]>([])
  const [apiStateDrafts, setApiStateDrafts] = useState<Record<string, any>>({})
  const [newApiState, setNewApiState] = useState({ key: 'api.', value: '' })

  useEffect(() => {
    if (show) {
      setSelectedEnvId(prev => prev || projectEnvironments[0]?.id || '')
      setComponentVariablesText(formatKeyValue(currentComponent?.variables || {}))
      setLocalCaseDataText(caseDataText || '')
    }
  }, [show, projectEnvironments.length, componentId])

  const selectedEnv = projectEnvironments.find((env: any) => env.id === selectedEnvId) || projectEnvironments[0]
  const selectedDatasets = (selectedEnv?.datasets || []).map(normalizeDataset)
  const defaultDataset = selectedDatasets.find((dataset: any) => dataset.isDefault) || selectedDatasets[0]

  useEffect(() => {
    if (!show || !selectedEnv?.id) return
    let cancelled = false
    Promise.resolve(fetchWithAuth(`${API_BASE}/proyectos/${projectId}/entornos/${selectedEnv.id}/api-state`))
      .then(async response => response.ok ? response.json() : null)
      .then(payload => {
        if (cancelled) return
        const items = Array.isArray(payload?.items) ? payload.items.map(normalizeApiState) : []
        setApiState(items)
        setApiStateDrafts(Object.fromEntries(items.map((item: any) => [item.key, item])))
      })
      .catch(() => { if (!cancelled) setApiState([]) })
    return () => { cancelled = true }
  }, [show, projectId, selectedEnv?.id])

  const getDatasetDraft = (dataset: any) => editingDatasets[dataset.id] || {
    name: dataset.name,
    description: dataset.description,
    variablesText: formatKeyValue(dataset.variables),
    isDefault: dataset.isDefault
  }

  const updateDatasetInState = (envId: string, datasetId: string, updater: any) => {
    setEnvironments((prev: any[]) => prev.map(env => env.id !== envId ? env : {
      ...env,
      datasets: (env.datasets || []).map((dataset: any) => dataset.id === datasetId ? updater(dataset) : dataset)
    }))
  }

  const addDatasetToState = (envId: string, dataset: any) => {
    setEnvironments((prev: any[]) => prev.map(env => {
      if (env.id !== envId) return env
      const normalized = normalizeDataset(dataset)
      const nextDatasets = [...(env.datasets || []), normalized].map((item: any) => ({
        ...item,
        isDefault: normalized.isDefault ? item.id === normalized.id : item.isDefault
      }))
      return { ...env, datasets: nextDatasets }
    }))
  }

  const saveNewDataset = async () => {
    if (!selectedEnv || !newDataset.name.trim()) return
    setSavingKey('new-dataset')
    try {
      const response = await fetchWithAuth(`${API_BASE}/entornos/${selectedEnv.id}/datasets/`, {
        method: 'POST',
        body: JSON.stringify({
          nombre: newDataset.name.trim(),
          descripcion: newDataset.description.trim(),
          variables: parseKeyValueText(newDataset.variablesText),
          activo: true,
          es_default: newDataset.isDefault
        })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || t('automatizacion.backendResponded', { status: response.status }))
      }
      addDatasetToState(selectedEnv.id, await response.json())
      setNewDataset({ name: '', description: '', variablesText: '', isDefault: false })
      showFeedback(t('casos.feedbackDataset'), t('casos.feedbackDatasetSaved'), 'success')
    } catch (error: any) {
      showFeedback(t('casos.feedbackDataset'), error.message || t('casos.feedbackDatasetSaveError'), 'danger')
    } finally {
      setSavingKey('')
    }
  }

  const saveDataset = async (dataset: any) => {
    const draft = getDatasetDraft(dataset)
    setSavingKey(dataset.id)
    try {
      const response = await fetchWithAuth(`${API_BASE}/entorno-datasets/${dataset.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          nombre: draft.name.trim(),
          descripcion: draft.description.trim(),
          variables: parseKeyValueText(draft.variablesText),
          activo: true,
          es_default: draft.isDefault
        })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || t('automatizacion.backendResponded', { status: response.status }))
      }
      const updated = normalizeDataset(await response.json())
      setEnvironments((prev: any[]) => prev.map(env => env.id !== selectedEnv.id ? env : {
        ...env,
        datasets: (env.datasets || []).map((item: any) => ({
          ...item,
          ...(item.id === dataset.id ? updated : {}),
          isDefault: updated.isDefault ? item.id === dataset.id : item.isDefault
        }))
      }))
      setEditingDatasets(prev => {
        const next = { ...prev }
        delete next[dataset.id]
        return next
      })
      showFeedback(t('casos.feedbackDataset'), t('casos.feedbackDatasetUpdated'), 'success')
    } catch (error: any) {
      showFeedback(t('casos.feedbackDataset'), error.message || t('casos.feedbackDatasetUpdateError'), 'danger')
    } finally {
      setSavingKey('')
    }
  }

  const deleteDataset = async (dataset: any) => {
    setSavingKey(dataset.id)
    try {
      const response = await fetchWithAuth(`${API_BASE}/entorno-datasets/${dataset.id}/`, { method: 'DELETE' })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || t('automatizacion.backendResponded', { status: response.status }))
      }
      setEnvironments((prev: any[]) => prev.map(env => env.id !== selectedEnv.id ? env : {
        ...env,
        datasets: (env.datasets || []).filter((item: any) => item.id !== dataset.id)
      }))
      showFeedback(t('casos.feedbackDataset'), t('casos.feedbackDatasetHidden'), 'success')
    } catch (error: any) {
      showFeedback(t('casos.feedbackDataset'), error.message || t('casos.feedbackDatasetHideError'), 'danger')
    } finally {
      setSavingKey('')
    }
  }

  const saveComponentVariables = async () => {
    if (!currentComponent) return
    const variables = parseKeyValueText(componentVariablesText)
    setSavingKey('component-vars')
    try {
      const response = await fetchWithAuth(`${API_BASE}/componentes/${componentId}`, {
        method: 'PATCH',
        body: JSON.stringify({ variables })
      })
      if (!response.ok) {
        const error = await response.json().catch(() => null)
        throw new Error(error?.detail || t('automatizacion.backendResponded', { status: response.status }))
      }
      setComponentsList((prev: any[]) => prev.map(component => component.id === componentId ? { ...component, variables } : component))
      showFeedback(t('casos.feedbackTechnicalVariables'), t('casos.feedbackTechnicalVariablesUpdated'), 'success')
    } catch (error: any) {
      showFeedback(t('casos.feedbackTechnicalVariables'), error.message || t('casos.feedbackTechnicalVariablesError'), 'danger')
    } finally {
      setSavingKey('')
    }
  }

  const applyCaseData = () => {
    setCaseDataText(localCaseDataText)
    showFeedback(t('casos.feedbackCaseData'), t('casos.feedbackCaseDataUpdated'), 'success')
  }

  const apiStateValueText = (value: any) => typeof value === 'string' ? value : JSON.stringify(value ?? '', null, 2)

  const saveApiState = async (item: any) => {
    const key = String(item.key || '').trim()
    if (!key.startsWith('api.')) return
    setSavingKey(`api-state:${key}`)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/entornos/${selectedEnv.id}/api-state/${encodeURIComponent(key)}`, {
        method: 'PUT',
        body: JSON.stringify({ value: item.value, version: item.version || 0 }),
      })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.detail || t('automatizacion.backendResponded', { status: response.status }))
      const updated = normalizeApiState(payload)
      setApiState(prev => [...prev.filter(current => current.key !== updated.key), updated].sort((a, b) => a.key.localeCompare(b.key)))
      setApiStateDrafts(prev => ({ ...prev, [updated.key]: updated }))
      showFeedback(t('automatizacion.apiState'), t('automatizacion.apiStateSaved'), 'success')
    } catch (error: any) {
      showFeedback(t('automatizacion.apiState'), error.message || t('automatizacion.apiStateSaveError'), 'danger')
    } finally {
      setSavingKey('')
    }
  }

  const deleteApiState = async (item: any) => {
    setSavingKey(`api-state:${item.key}`)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/entornos/${selectedEnv.id}/api-state/${encodeURIComponent(item.key)}`, { method: 'DELETE' })
      const payload = await response.json().catch(() => null)
      if (!response.ok) throw new Error(payload?.detail || t('automatizacion.backendResponded', { status: response.status }))
      setApiState(prev => prev.filter(current => current.key !== item.key))
      setApiStateDrafts(prev => { const next = { ...prev }; delete next[item.key]; return next })
      showFeedback(t('automatizacion.apiState'), t('automatizacion.apiStateDeleted'), 'success')
    } catch (error: any) {
      showFeedback(t('automatizacion.apiState'), error.message || t('automatizacion.apiStateDeleteError'), 'danger')
    } finally {
      setSavingKey('')
    }
  }

  const addApiState = () => {
    const key = newApiState.key.trim()
    if (!key.startsWith('api.') || apiStateDrafts[key]) return
    const item = { key, value: newApiState.value, version: 0 }
    setApiState(prev => [...prev, item].sort((a, b) => a.key.localeCompare(b.key)))
    setApiStateDrafts(prev => ({ ...prev, [key]: item }))
    setNewApiState({ key: 'api.', value: '' })
  }

  const resolvedRows = useMemo(() => {
    const envVars = selectedEnv?.variables || {}
    const componentVars = parseKeyValueText(componentVariablesText)
    const datasetVars = defaultDataset?.variables || {}
    const caseVars = parseKeyValueText(localCaseDataText)
    const rows: Array<{ key: string, value: string, source: string, token: string }> = []
    Object.entries(envVars).forEach(([key, value]) => rows.push({ key, value: String(value), source: t('common.environment'), token: `{{${key}}}` }))
    Object.entries(componentVars).forEach(([key, value]) => rows.push({ key, value: String(value), source: t('common.component'), token: `{{COMPONENT.${key}}}` }))
    Object.entries(datasetVars).forEach(([key, value]) => rows.push({ key, value: String(value), source: t('common.dataset'), token: `{{DATASET.${key}}}` }))
    Object.entries(caseVars).forEach(([key, value]) => rows.push({ key, value: String(value), source: t('common.case'), token: `{{${key}}}` }))
    return rows
  }, [selectedEnvId, environments, componentVariablesText, localCaseDataText, t])

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showFeedback(t('casos.feedbackCopied'), t('casos.feedbackVariableCopied'), 'success')
    } catch {
      showFeedback(t('casos.feedbackCopied'), text, 'info')
    }
  }

  return (
    <Modal show={show} onHide={onHide} size="xl" centered scrollable>
      <Modal.Header closeButton className="border-0 pb-2">
        <Modal.Title className="fw-bold d-flex align-items-center gap-2">
          <Database size={18} className="text-primary" />
          {t('casos.configuredVariables')}
        </Modal.Title>
      </Modal.Header>
      <Modal.Body className="pt-0">
        <Tabs defaultActiveKey="datasets" className="mb-3">
          <Tab eventKey="datasets" title={t('casos.environmentAndDatasets')}>
            <Row className="g-3">
              <Col md={4}>
                <Form.Label>{t('common.environment')}</Form.Label>
                <Form.Select name="a11y-automationvariablesmodaltsx-265" aria-label={t('common.environment')} value={selectedEnv?.id || ''} onChange={e => setSelectedEnvId(e.target.value)}>
                  {projectEnvironments.map((env: any) => <option key={env.id} value={env.id}>{env.name}</option>)}
                </Form.Select>
                {selectedEnv && <div className="small text-muted mt-2 font-monospace">{selectedEnv.url}</div>}
              </Col>
              <Col md={8}>
                <div className="border rounded-3 p-3 bg-light">
                  <div className="fw-bold mb-2">{t('casos.newDataset')}</div>
                  <Row className="g-2">
                    <Col md={5}><Form.Control name="a11y-automationvariablesmodaltsx-274" aria-label={t('proyectos.datasetNamePlaceholder')} size="sm" placeholder={t('proyectos.datasetNamePlaceholder')} value={newDataset.name} disabled={!canEdit} onChange={e => setNewDataset({ ...newDataset, name: e.target.value })} /></Col>
                    <Col md={7}><Form.Control name="a11y-automationvariablesmodaltsx-275" aria-label={t('proyectos.datasetDescriptionPlaceholder')} size="sm" placeholder={t('proyectos.datasetDescriptionPlaceholder')} value={newDataset.description} disabled={!canEdit} onChange={e => setNewDataset({ ...newDataset, description: e.target.value })} /></Col>
                    <Col xs={12}><Form.Control name="a11y-automationvariablesmodaltsx-276" aria-label={t('proyectos.datasetVariablesPlaceholder')} as="textarea" rows={3} size="sm" className="font-monospace" placeholder={t('proyectos.datasetVariablesPlaceholder')} value={newDataset.variablesText} disabled={!canEdit} onChange={e => setNewDataset({ ...newDataset, variablesText: e.target.value })} /></Col>
                    <Col xs={12} className="d-flex justify-content-between">
                      <Form.Check name="a11y-automationvariablesmodaltsx-278" aria-label={t('casos.useAsDefault')} label={t('casos.useAsDefault')} checked={newDataset.isDefault} disabled={!canEdit} onChange={e => setNewDataset({ ...newDataset, isDefault: e.target.checked })} />
                      {canEdit && <Button size="sm" disabled={savingKey === 'new-dataset'} onClick={saveNewDataset}><Plus size={14} className="me-1" />{t('casos.createDataset')}</Button>}
                    </Col>
                  </Row>
                </div>
              </Col>
            </Row>
            <div className="mt-3 d-flex flex-column gap-2">
              {selectedDatasets.map((dataset: any) => {
                const draft = getDatasetDraft(dataset)
                return (
                  <div key={dataset.id} className="border rounded-3 p-3">
                    <div className="d-flex justify-content-between align-items-center mb-2">
                      <div className="d-flex gap-2 align-items-center">
                        <Badge bg={dataset.isDefault ? 'success' : 'light'} text={dataset.isDefault ? undefined : 'dark'} className="border">{dataset.isDefault ? t('casos.default') : t('casos.dataset')}</Badge>
                        <span className="font-monospace small">{dataset.id}</span>
                      </div>
                      <div className="d-flex gap-2">
                        {canEdit && <Button size="sm" variant="primary" aria-label={t('common.save')} title={t('common.save')} disabled={savingKey === dataset.id} onClick={() => saveDataset(dataset)}><Save size={14} /></Button>}
                        {canEdit && <Button size="sm" variant="outline-danger" aria-label={t('common.delete')} title={t('common.delete')} disabled={savingKey === dataset.id} onClick={() => deleteDataset(dataset)}><Trash2 size={14} /></Button>}
                      </div>
                    </div>
                    <Row className="g-2">
                      <Col md={4}><Form.Control name="a11y-automationvariablesmodaltsx-301" aria-label={t('proyectos.datasetNamePlaceholder')} size="sm" value={draft.name} disabled={!canEdit} onChange={e => setEditingDatasets(prev => ({ ...prev, [dataset.id]: { ...draft, name: e.target.value } }))} /></Col>
                      <Col md={5}><Form.Control name="a11y-automationvariablesmodaltsx-302" aria-label={t('proyectos.datasetDescriptionPlaceholder')} size="sm" value={draft.description} disabled={!canEdit} onChange={e => setEditingDatasets(prev => ({ ...prev, [dataset.id]: { ...draft, description: e.target.value } }))} /></Col>
                      <Col md={3}><Form.Check name="a11y-automationvariablesmodaltsx-303" aria-label={t('casos.default')} label={t('casos.default')} checked={draft.isDefault} disabled={!canEdit} onChange={e => setEditingDatasets(prev => ({ ...prev, [dataset.id]: { ...draft, isDefault: e.target.checked } }))} /></Col>
                      <Col xs={12}><Form.Control name="a11y-automationvariablesmodaltsx-304" aria-label={t('proyectos.datasetVariablesPlaceholder')} as="textarea" rows={3} className="font-monospace small" value={draft.variablesText} disabled={!canEdit} onChange={e => setEditingDatasets(prev => ({ ...prev, [dataset.id]: { ...draft, variablesText: e.target.value } }))} /></Col>
                    </Row>
                  </div>
                )
              })}
              {selectedDatasets.length === 0 && <Alert variant="info">{t('casos.noActiveDatasets')}</Alert>}
            </div>
          </Tab>
          <Tab eventKey="api-state" title={t('automatizacion.apiState')}>
            <Alert variant="warning" className="small border">
              {t('automatizacion.apiStateHelp')}
            </Alert>
            <Row className="g-2 mb-3">
              <Col md={5}><Form.Label htmlFor="new-api-state-key" className="small fw-semibold">{t('automatizacion.apiStateNewKey')}</Form.Label><Form.Control id="new-api-state-key" aria-label={t('automatizacion.apiStateNewKey')} className="font-monospace" value={newApiState.key} disabled={!canEdit} onChange={event => setNewApiState(prev => ({ ...prev, key: event.target.value }))} placeholder="api.items.last_id" /></Col>
              <Col md={5}><Form.Label className="small fw-semibold">{t('automatizacion.apiStateInitialValue')}</Form.Label><Form.Control className="font-monospace" aria-label={t('automatizacion.apiStateInitialValue')} value={newApiState.value} disabled={!canEdit} onChange={event => setNewApiState(prev => ({ ...prev, value: event.target.value }))} /></Col>
              <Col md={2} className="d-flex align-items-end">{canEdit && <Button className="w-100" onClick={addApiState} disabled={!newApiState.key.startsWith('api.')}>{t('automatizacion.add')}</Button>}</Col>
            </Row>
            {apiState.length === 0 ? <Alert variant="info">{t('automatizacion.apiStateEmpty')}</Alert> : <div className="d-flex flex-column gap-2">{apiState.map(item => {
              const draft = apiStateDrafts[item.key] || item
              return <div key={item.key} className="border rounded-3 p-3"><Row className="g-2 align-items-end"><Col md={4}><Form.Label className="small fw-semibold">{t('automatizacion.apiStateKey')}</Form.Label><Form.Control className="font-monospace" aria-label={t('automatizacion.apiStateKey')} value={draft.key} disabled /></Col><Col md={5}><Form.Label className="small fw-semibold">{t('automatizacion.apiStateValue')}</Form.Label><Form.Control className="font-monospace" aria-label={t('automatizacion.apiStateValue')} value={apiStateValueText(draft.value)} disabled={!canEdit} onChange={event => setApiStateDrafts(prev => ({ ...prev, [item.key]: { ...draft, value: event.target.value } }))} /></Col><Col md={3} className="d-flex gap-2">{canEdit && <Button size="sm" className="flex-grow-1" aria-label={t('common.save')} disabled={savingKey === `api-state:${item.key}`} onClick={() => saveApiState(draft)}><Save size={14} /></Button>}{canEdit && <Button size="sm" variant="outline-danger" aria-label={t('automatizacion.deleteApiState')} disabled={savingKey === `api-state:${item.key}`} onClick={() => deleteApiState(item)}><Trash2 size={14} /></Button>}</Col></Row><div className="small text-muted mt-2">{t('automatizacion.apiStateVersion', { version: draft.version || 0 })}{draft.fechaActualizacion ? ` · ${t('automatizacion.apiStateUpdated', { date: draft.fechaActualizacion })}` : ''}</div></div>
            })}</div>}
          </Tab>
          <Tab eventKey="component" title={t('casos.componentVariables')}>
            <Alert variant="light" className="border">{t('casos.componentTechnicalConfig')} <code>api_path</code>, <code>health_endpoint</code>, <code>service_name</code>.</Alert>
            <Form.Control name="a11y-automationvariablesmodaltsx-314" aria-label={t('casos.componentVariables')} as="textarea" rows={10} className="font-monospace" value={componentVariablesText} disabled={!canEdit} onChange={e => setComponentVariablesText(e.target.value)} />
            {canEdit && <Button className="mt-3" disabled={savingKey === 'component-vars'} onClick={saveComponentVariables}>{t('casos.saveTechnicalVariables')}</Button>}
          </Tab>
          <Tab eventKey="case" title={t('casos.caseData')}>
            <Alert variant="light" className="border">{t('casos.caseOverridesHelp')}</Alert>
            <Form.Control name="a11y-automationvariablesmodaltsx-319" aria-label={t('casos.caseData')} as="textarea" rows={10} className="font-monospace" value={localCaseDataText} disabled={!canEdit} onChange={e => setLocalCaseDataText(e.target.value)} />
            {canEdit && <Button className="mt-3" onClick={applyCaseData}>{t('casos.applyToForm')}</Button>}
          </Tab>
          <Tab eventKey="resolved" title={t('casos.resolvedView')}>
            {resolvedRows.length === 0 ? <Alert variant="info">{t('common.noVariablesPreview')}</Alert> : (
              <Table responsive hover className="align-middle">
                <thead><tr><th>{t('common.source')}</th><th>{t('common.key')}</th><th>{t('common.currentValue')}</th><th>{t('common.token')}</th><th></th></tr></thead>
                <tbody>
                  {resolvedRows.map((row, index) => (
                    <tr key={`${row.source}-${row.key}-${index}`}>
                      <td><Badge bg="light" text="dark" className="border">{row.source}</Badge></td>
                      <td className="font-monospace">{row.key}</td>
                      <td className="font-monospace small">{row.value}</td>
                      <td><code>{row.token}</code></td>
                      <td><Button size="sm" variant="outline-primary" aria-label={`${t('casos.copyVariableToken')} ${row.key}`} title={t('casos.copyVariableToken')} onClick={() => copyText(row.token)}><Copy size={14} /></Button></td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Tab>
        </Tabs>
      </Modal.Body>
    </Modal>
  )
}
