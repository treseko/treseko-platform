import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Col, Form, Modal, Row, Table } from 'react-bootstrap'
import { Copy, Edit2, Plus, Save, Trash2 } from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'

type AutomationFunctionsModalProps = {
  show: boolean
  onHide: () => void
  projectId: string
  componentId: string
  framework: string
  componentsList: any[]
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, type: string) => void
  onInsertUsage: (snippet: string) => void
  canEdit?: boolean
}

const emptyForm = {
  id: '',
  master_id: '',
  nombre: '',
  descripcion: '',
  parametros: '',
  codigo: '',
  framework: 'playwright',
  scope: 'COMPONENTE',
  componente_id: ''
}

export function AutomationFunctionsModal({
  show,
  onHide,
  projectId,
  componentId,
  framework,
  componentsList,
  fetchWithAuth,
  showFeedback,
  onInsertUsage,
  canEdit = true
}: AutomationFunctionsModalProps) {
  const [functions, setFunctions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ ...emptyForm, framework, componente_id: componentId })
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)

  const loadFunctions = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/funciones/?component_id=${componentId || ''}&include_herencia=true`)
      if (!response.ok) throw new Error(`Backend respondio ${response.status}`)
      setFunctions(await response.json())
    } catch (error: any) {
      showFeedback('Funciones', error.message || 'No se pudieron cargar funciones.', 'danger')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (show) loadFunctions()
  }, [show, projectId, componentId])

  const visibleFunctions = useMemo(() => {
    const q = search.trim().toLowerCase()
    return functions
      .filter(fn => !fn.componente_id || fn.componente_id === componentId)
      .filter(fn => !q || [fn.nombre, fn.descripcion, fn.framework].some(value => String(value || '').toLowerCase().includes(q)))
  }, [functions, search, componentId])

  const openCreate = () => {
    setForm({ ...emptyForm, framework, scope: componentId ? 'COMPONENTE' : 'PROYECTO', componente_id: componentId })
    setFormError('')
    setFormOpen(true)
  }

  const openEdit = (fn: any) => {
    setForm({
      id: fn.id,
      master_id: fn.master_id,
      nombre: fn.nombre || '',
      descripcion: fn.descripcion || '',
      parametros: (fn.parametros || []).join(', '),
      codigo: fn.codigo || '',
      framework: fn.framework || framework,
      scope: fn.scope || (fn.componente_id ? 'COMPONENTE' : 'PROYECTO'),
      componente_id: fn.componente_id || ''
    })
    setFormError('')
    setFormOpen(true)
  }

  const buildUsage = (fn: any) => {
    const params = (fn.parametros || []).join(', ')
    return `await ${fn.nombre}(${params});`
  }

  const copyText = async (text: string, label = 'Copiado') => {
    try {
      await navigator.clipboard.writeText(text)
      showFeedback(label, 'Texto copiado al portapapeles.', 'success')
    } catch {
      showFeedback(label, text, 'info')
    }
  }

  const readErrorMessage = async (response: Response) => {
    const raw = await response.text().catch(() => '')
    if (!raw) return `Backend respondio ${response.status}`
    try {
      const parsed = JSON.parse(raw)
      return parsed?.detail || parsed?.message || raw
    } catch {
      return raw
    }
  }

  const saveFunction = async () => {
    if (!form.nombre.trim()) return
    if (form.scope === 'COMPONENTE' && !form.componente_id) {
      setFormError('Selecciona un componente para esta funcion.')
      return
    }
    setSaving(true)
    setFormError('')
    const payload = {
      nombre: form.nombre.trim(),
      descripcion: form.descripcion.trim(),
      codigo: form.codigo,
      parametros: form.parametros.split(',').map(p => p.trim()).filter(Boolean),
      framework: form.framework,
      scope: form.scope,
      componente_id: form.scope === 'COMPONENTE' ? form.componente_id : null,
      suite_id: null,
      proyecto_id: projectId
    }
    const editing = Boolean(form.master_id)
    try {
      const response = await fetchWithAuth(editing ? `${API_BASE}/funciones/${form.master_id}/` : `${API_BASE}/funciones/`, {
        method: editing ? 'PUT' : 'POST',
        body: JSON.stringify(payload)
      })
      if (!response.ok) {
        const message = await readErrorMessage(response)
        setFormError(message)
        showFeedback('Funciones', message, 'danger')
        return
      }
      setFormOpen(false)
      showFeedback('Funciones', editing ? 'Funcion actualizada.' : 'Funcion creada.', 'success')
      await loadFunctions()
    } catch (error: any) {
      const message = error?.message || 'Error de conexion al guardar la funcion.'
      setFormError(message)
      showFeedback('Funciones', message, 'danger')
    } finally {
      setSaving(false)
    }
  }

  const deleteFunction = async () => {
    if (!deleteTarget) return
    const response = await fetchWithAuth(`${API_BASE}/funciones/${deleteTarget.master_id}/`, { method: 'DELETE' })
    if (!response.ok) {
      showFeedback('Funciones', await readErrorMessage(response), 'danger')
      return
    }
    setDeleteTarget(null)
    showFeedback('Funciones', 'Funcion eliminada.', 'success')
    await loadFunctions()
  }

  return (
    <>
      <Modal show={show} onHide={onHide} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title>Funciones disponibles</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex gap-2 justify-content-between align-items-center mb-3">
            <Form.Control value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar funcion..." />
            {canEdit && <Button className="d-flex align-items-center gap-2 text-nowrap" onClick={openCreate}><Plus size={16} /> Nueva funcion</Button>}
          </div>
          {loading ? (
            <div className="text-center text-muted py-4">Cargando funciones...</div>
          ) : visibleFunctions.length === 0 ? (
            <Alert variant="info">No hay funciones disponibles para este caso.</Alert>
          ) : (
            <Table responsive hover className="align-middle">
              <thead>
                <tr>
                  <th>Funcion</th>
                  <th>Alcance</th>
                  <th>Framework</th>
                  <th>Parametros</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {visibleFunctions.map(fn => (
                  <tr key={fn.id}>
                    <td>
                      <div className="fw-bold">{fn.nombre}</div>
                      <div className="small text-muted">{fn.descripcion || 'Sin descripcion'}</div>
                    </td>
                    <td>{fn.componente_id ? <Badge bg="primary">Componente</Badge> : <Badge bg="secondary">Proyecto</Badge>}</td>
                    <td><Badge bg="info">{fn.framework}</Badge></td>
                    <td><code className="small">{(fn.parametros || []).join(', ') || '-'}</code></td>
                    <td>
                      <div className="d-flex gap-1">
                        <Button size="sm" variant="outline-primary" onClick={() => copyText(buildUsage(fn), 'Uso copiado')}><Copy size={14} /></Button>
                        <Button size="sm" variant="outline-success" onClick={() => onInsertUsage(buildUsage(fn))}>Insertar</Button>
                        {canEdit && (
                          <>
                            <Button size="sm" variant="outline-secondary" onClick={() => openEdit(fn)}><Edit2 size={14} /></Button>
                            <Button size="sm" variant="outline-danger" onClick={() => setDeleteTarget(fn)}><Trash2 size={14} /></Button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal.Body>
      </Modal>

      <Modal show={formOpen} onHide={() => setFormOpen(false)} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title>{form.master_id ? 'Editar funcion' : 'Nueva funcion'}</Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formError && <Alert variant="danger">{formError}</Alert>}
          <Row className="g-3">
            <Col md={6}>
              <Form.Label><RequiredLabel required>Nombre</RequiredLabel></Form.Label>
              <Form.Control required value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </Col>
            <Col md={6}>
              <Form.Label>Descripcion</Form.Label>
              <Form.Control value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} />
            </Col>
            <Col md={4}>
              <Form.Label>Framework</Form.Label>
              <Form.Select value={form.framework} onChange={e => setForm({ ...form, framework: e.target.value })}>
                <option value="playwright">Playwright</option>
                <option value="cypress">Cypress</option>
                <option value="selenium">Selenium</option>
                <option value="puppeteer">Puppeteer</option>
              </Form.Select>
            </Col>
            <Col md={4}>
              <Form.Label>Alcance</Form.Label>
              <Form.Select value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value, componente_id: e.target.value === 'PROYECTO' ? '' : componentId })}>
                <option value="COMPONENTE">Componente</option>
                <option value="PROYECTO">Proyecto</option>
              </Form.Select>
            </Col>
            <Col md={4}>
              <Form.Label>Componente</Form.Label>
              <Form.Select value={form.componente_id} disabled={form.scope !== 'COMPONENTE'} onChange={e => setForm({ ...form, componente_id: e.target.value })}>
                <option value="">Selecciona componente...</option>
                {componentsList.filter(c => c.projectId === projectId).map(component => (
                  <option key={component.id} value={component.id}>{component.name}</option>
                ))}
              </Form.Select>
            </Col>
            <Col xs={12}>
              <Form.Label>Parametros separados por coma</Form.Label>
              <Form.Control value={form.parametros} onChange={e => setForm({ ...form, parametros: e.target.value })} placeholder="page, variables, log" />
            </Col>
            <Col xs={12}>
              <Form.Label><RequiredLabel required>Codigo</RequiredLabel></Form.Label>
              <Form.Control required as="textarea" rows={12} className="font-monospace small" value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value })} />
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setFormOpen(false)} disabled={saving}>Cancelar</Button>
          <Button onClick={saveFunction} disabled={saving} className="d-flex align-items-center gap-2"><Save size={16} /> {saving ? 'Guardando...' : 'Guardar'}</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={Boolean(deleteTarget)} onHide={() => setDeleteTarget(null)} centered>
        <Modal.Header closeButton>
          <Modal.Title>Eliminar funcion</Modal.Title>
        </Modal.Header>
        <Modal.Body>Se eliminara la funcion <strong>{deleteTarget?.nombre}</strong> y sus versiones.</Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setDeleteTarget(null)}>Cancelar</Button>
          <Button variant="danger" onClick={deleteFunction}>Eliminar</Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
