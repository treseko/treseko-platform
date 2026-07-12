import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Col, Form, Modal, Row, Tab, Tabs, Table } from 'react-bootstrap'
import { Copy, Plus, Save, Trash2 } from 'lucide-react'
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
  const projectEnvironments = useMemo(() => environments.filter((env: any) => env.projectId === projectId), [environments, projectId])
  const currentComponent = componentsList.find(component => component.id === componentId)
  const [selectedEnvId, setSelectedEnvId] = useState('')
  const [newDataset, setNewDataset] = useState({ name: '', description: '', variablesText: '', isDefault: false })
  const [editingDatasets, setEditingDatasets] = useState<Record<string, any>>({})
  const [componentVariablesText, setComponentVariablesText] = useState('')
  const [localCaseDataText, setLocalCaseDataText] = useState(caseDataText || '')
  const [savingKey, setSavingKey] = useState('')

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
        throw new Error(error?.detail || `Backend respondio ${response.status}`)
      }
      addDatasetToState(selectedEnv.id, await response.json())
      setNewDataset({ name: '', description: '', variablesText: '', isDefault: false })
      showFeedback('Dataset', 'Dataset guardado.', 'success')
    } catch (error: any) {
      showFeedback('Dataset', error.message || 'No se pudo guardar dataset.', 'danger')
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
        throw new Error(error?.detail || `Backend respondio ${response.status}`)
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
      showFeedback('Dataset', 'Dataset actualizado.', 'success')
    } catch (error: any) {
      showFeedback('Dataset', error.message || 'No se pudo actualizar dataset.', 'danger')
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
        throw new Error(error?.detail || `Backend respondio ${response.status}`)
      }
      setEnvironments((prev: any[]) => prev.map(env => env.id !== selectedEnv.id ? env : {
        ...env,
        datasets: (env.datasets || []).filter((item: any) => item.id !== dataset.id)
      }))
      showFeedback('Dataset', 'Dataset ocultado.', 'success')
    } catch (error: any) {
      showFeedback('Dataset', error.message || 'No se pudo ocultar dataset.', 'danger')
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
        throw new Error(error?.detail || `Backend respondio ${response.status}`)
      }
      setComponentsList((prev: any[]) => prev.map(component => component.id === componentId ? { ...component, variables } : component))
      showFeedback('Variables tecnicas', 'Variables del componente actualizadas.', 'success')
    } catch (error: any) {
      showFeedback('Variables tecnicas', error.message || 'No se pudieron guardar variables.', 'danger')
    } finally {
      setSavingKey('')
    }
  }

  const applyCaseData = () => {
    setCaseDataText(localCaseDataText)
    showFeedback('Datos del caso', 'Overrides actualizados en el formulario. Guarda el caso para persistirlos.', 'success')
  }

  const resolvedRows = useMemo(() => {
    const envVars = selectedEnv?.variables || {}
    const componentVars = parseKeyValueText(componentVariablesText)
    const datasetVars = defaultDataset?.variables || {}
    const caseVars = parseKeyValueText(localCaseDataText)
    const rows: Array<{ key: string, value: string, source: string, token: string }> = []
    Object.entries(envVars).forEach(([key, value]) => rows.push({ key, value: String(value), source: 'Ambiente', token: `{{${key}}}` }))
    Object.entries(componentVars).forEach(([key, value]) => rows.push({ key, value: String(value), source: 'Componente', token: `{{COMPONENT.${key}}}` }))
    Object.entries(datasetVars).forEach(([key, value]) => rows.push({ key, value: String(value), source: 'Dataset', token: `{{DATASET.${key}}}` }))
    Object.entries(caseVars).forEach(([key, value]) => rows.push({ key, value: String(value), source: 'Caso', token: `{{${key}}}` }))
    return rows
  }, [selectedEnvId, environments, componentVariablesText, localCaseDataText])

  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      showFeedback('Copiado', 'Variable copiada al portapapeles.', 'success')
    } catch {
      showFeedback('Variable', text, 'info')
    }
  }

  return (
    <Modal show={show} onHide={onHide} size="xl" centered>
      <Modal.Header closeButton>
        <Modal.Title>Variables configuradas</Modal.Title>
      </Modal.Header>
      <Modal.Body>
        <Tabs defaultActiveKey="datasets" className="mb-3">
          <Tab eventKey="datasets" title="Ambiente y datasets">
            <Row className="g-3">
              <Col md={4}>
                <Form.Label>Ambiente</Form.Label>
                <Form.Select value={selectedEnv?.id || ''} onChange={e => setSelectedEnvId(e.target.value)}>
                  {projectEnvironments.map((env: any) => <option key={env.id} value={env.id}>{env.name}</option>)}
                </Form.Select>
                {selectedEnv && <div className="small text-muted mt-2 font-monospace">{selectedEnv.url}</div>}
              </Col>
              <Col md={8}>
                <div className="border rounded-3 p-3 bg-light">
                  <div className="fw-bold mb-2">Nuevo dataset</div>
                  <Row className="g-2">
                    <Col md={5}><Form.Control size="sm" placeholder="Nombre del dataset" value={newDataset.name} disabled={!canEdit} onChange={e => setNewDataset({ ...newDataset, name: e.target.value })} /></Col>
                    <Col md={7}><Form.Control size="sm" placeholder="Descripcion / uso" value={newDataset.description} disabled={!canEdit} onChange={e => setNewDataset({ ...newDataset, description: e.target.value })} /></Col>
                    <Col xs={12}><Form.Control as="textarea" rows={3} size="sm" className="font-monospace" placeholder={'usuario=qa_user\npassword=qa_password'} value={newDataset.variablesText} disabled={!canEdit} onChange={e => setNewDataset({ ...newDataset, variablesText: e.target.value })} /></Col>
                    <Col xs={12} className="d-flex justify-content-between">
                      <Form.Check label="Usar como default" checked={newDataset.isDefault} disabled={!canEdit} onChange={e => setNewDataset({ ...newDataset, isDefault: e.target.checked })} />
                      {canEdit && <Button size="sm" disabled={savingKey === 'new-dataset'} onClick={saveNewDataset}><Plus size={14} className="me-1" />Crear dataset</Button>}
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
                        <Badge bg={dataset.isDefault ? 'success' : 'light'} text={dataset.isDefault ? undefined : 'dark'} className="border">{dataset.isDefault ? 'Default' : 'Dataset'}</Badge>
                        <span className="font-monospace small">{dataset.id}</span>
                      </div>
                      <div className="d-flex gap-2">
                        {canEdit && <Button size="sm" variant="primary" disabled={savingKey === dataset.id} onClick={() => saveDataset(dataset)}><Save size={14} /></Button>}
                        {canEdit && <Button size="sm" variant="outline-danger" disabled={savingKey === dataset.id} onClick={() => deleteDataset(dataset)}><Trash2 size={14} /></Button>}
                      </div>
                    </div>
                    <Row className="g-2">
                      <Col md={4}><Form.Control size="sm" value={draft.name} disabled={!canEdit} onChange={e => setEditingDatasets(prev => ({ ...prev, [dataset.id]: { ...draft, name: e.target.value } }))} /></Col>
                      <Col md={5}><Form.Control size="sm" value={draft.description} disabled={!canEdit} onChange={e => setEditingDatasets(prev => ({ ...prev, [dataset.id]: { ...draft, description: e.target.value } }))} /></Col>
                      <Col md={3}><Form.Check label="Default" checked={draft.isDefault} disabled={!canEdit} onChange={e => setEditingDatasets(prev => ({ ...prev, [dataset.id]: { ...draft, isDefault: e.target.checked } }))} /></Col>
                      <Col xs={12}><Form.Control as="textarea" rows={3} className="font-monospace small" value={draft.variablesText} disabled={!canEdit} onChange={e => setEditingDatasets(prev => ({ ...prev, [dataset.id]: { ...draft, variablesText: e.target.value } }))} /></Col>
                    </Row>
                  </div>
                )
              })}
              {selectedDatasets.length === 0 && <Alert variant="info">Este ambiente no tiene datasets activos.</Alert>}
            </div>
          </Tab>
          <Tab eventKey="component" title="Variables del componente">
            <Alert variant="light" className="border">Configuracion tecnica del componente actual. Ejemplos: <code>api_path</code>, <code>health_endpoint</code>, <code>service_name</code>.</Alert>
            <Form.Control as="textarea" rows={10} className="font-monospace" value={componentVariablesText} disabled={!canEdit} onChange={e => setComponentVariablesText(e.target.value)} />
            {canEdit && <Button className="mt-3" disabled={savingKey === 'component-vars'} onClick={saveComponentVariables}>Guardar variables tecnicas</Button>}
          </Tab>
          <Tab eventKey="case" title="Datos del caso">
            <Alert variant="light" className="border">Overrides puntuales del caso. Se guardan cuando guardes el caso de prueba.</Alert>
            <Form.Control as="textarea" rows={10} className="font-monospace" value={localCaseDataText} disabled={!canEdit} onChange={e => setLocalCaseDataText(e.target.value)} />
            {canEdit && <Button className="mt-3" onClick={applyCaseData}>Aplicar al formulario</Button>}
          </Tab>
          <Tab eventKey="resolved" title="Vista resuelta">
            {resolvedRows.length === 0 ? <Alert variant="info">No hay variables disponibles para previsualizar.</Alert> : (
              <Table responsive hover className="align-middle">
                <thead><tr><th>Origen</th><th>Clave</th><th>Valor actual</th><th>Token</th><th></th></tr></thead>
                <tbody>
                  {resolvedRows.map((row, index) => (
                    <tr key={`${row.source}-${row.key}-${index}`}>
                      <td><Badge bg="light" text="dark" className="border">{row.source}</Badge></td>
                      <td className="font-monospace">{row.key}</td>
                      <td className="font-monospace small">{row.value}</td>
                      <td><code>{row.token}</code></td>
                      <td><Button size="sm" variant="outline-primary" onClick={() => copyText(row.token)}><Copy size={14} /></Button></td>
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
