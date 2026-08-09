import { useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Col, Form, Modal, Row, Table } from 'react-bootstrap'
import { Code2, Copy, Edit2, Plus, Save, Trash2 } from 'lucide-react'
import { useI18n } from '../../i18n'
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
  const { t } = useI18n()
  const [functions, setFunctions] = useState<any[]>([])
  const [loading, setLoading] = useState(false)
  const [search, setSearch] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [form, setForm] = useState({ ...emptyForm, framework, componente_id: componentId })
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null)
  const [formError, setFormError] = useState('')
  const [saving, setSaving] = useState(false)
  const isDeleteOpen = Boolean(deleteTarget)

  const loadFunctions = async () => {
    if (!projectId) return
    setLoading(true)
    try {
      const response = await fetchWithAuth(`${API_BASE}/proyectos/${projectId}/funciones/?component_id=${componentId || ''}&include_herencia=true`)
      if (!response.ok) throw new Error(`Backend respondio ${response.status}`)
      setFunctions(await response.json())
    } catch (error: any) {
      showFeedback(t('casos.functionsTitle'), error.message || t('casos.loadFunctionsError'), 'danger')
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
        showFeedback(t('casos.functionsTitle'), message, 'danger')
        return
      }
      setFormOpen(false)
        showFeedback(t('casos.functionsTitle'), editing ? t('casos.functionUpdated') : t('casos.functionCreated'), 'success')
      await loadFunctions()
    } catch (error: any) {
      const message = error?.message || 'Error de conexion al guardar la funcion.'
      setFormError(message)
        showFeedback(t('casos.functionsTitle'), message, 'danger')
    } finally {
      setSaving(false)
    }
  }

  const deleteFunction = async () => {
    if (!deleteTarget) return
    const response = await fetchWithAuth(`${API_BASE}/funciones/${deleteTarget.master_id}/`, { method: 'DELETE' })
    if (!response.ok) {
        showFeedback(t('casos.functionsTitle'), await readErrorMessage(response), 'danger')
      return
    }
    setDeleteTarget(null)
    showFeedback(t('casos.functionsTitle'), t('casos.functionDeleted'), 'success')
    await loadFunctions()
  }

  return (
    <>
      <Modal show={show && !isDeleteOpen} onHide={onHide} size="xl" centered scrollable>
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold fs-5 d-flex align-items-center gap-2">
            <Code2 size={20} className="text-primary" />
            {t('casos.availableFunctions')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <div className="d-flex gap-2 justify-content-between align-items-center mb-3">
            <Form.Control name="a11y-automationfunctionsmodaltsx-194" aria-label="Campo de formulario" value={search} onChange={e => setSearch(e.target.value)} placeholder={t('casos.searchFunction')} />
            {canEdit && <Button className="d-flex align-items-center gap-2 text-nowrap" onClick={openCreate}><Plus size={16} /> {t('casos.newFunction')}</Button>}
          </div>
          {loading ? (
            <div className="text-center text-muted py-4">{t('casos.loadingFunctions')}</div>
          ) : visibleFunctions.length === 0 ? (
            <Alert variant="info">{t('casos.noFunctions')}</Alert>
          ) : (
            <Table responsive hover className="align-middle">
              <thead>
                <tr>
                  <th>{t('casos.function')}</th>
                  <th>{t('casos.scope')}</th>
                  <th>{t('casos.framework')}</th>
                  <th>{t('casos.parameters')}</th>
                  <th>{t('casos.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {visibleFunctions.map(fn => (
                  <tr key={fn.id}>
                    <td>
                      <div className="fw-bold">{fn.nombre}</div>
                      <div className="small text-muted">{fn.descripcion || t('casos.noDescription')}</div>
                    </td>
                    <td>{fn.componente_id ? <Badge bg="primary">{t('casos.componentScope')}</Badge> : <Badge bg="secondary">{t('casos.projectScope')}</Badge>}</td>
                    <td><Badge bg="info">{fn.framework}</Badge></td>
                    <td><code className="small">{(fn.parametros || []).join(', ') || '-'}</code></td>
                    <td>
                      <div className="d-flex gap-1">
                        <Button size="sm" variant="outline-primary" onClick={() => copyText(buildUsage(fn), 'Uso copiado')}><Copy size={14} /></Button>
                        <Button size="sm" variant="outline-success" onClick={() => onInsertUsage(buildUsage(fn))}>{t('casos.insert')}</Button>
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

      <Modal show={formOpen && !isDeleteOpen} onHide={() => setFormOpen(false)} size="xl" centered scrollable>
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold fs-5 d-flex align-items-center gap-2">
            <Code2 size={20} className="text-primary" />
            {form.master_id ? t('casos.editFunction') : t('casos.newFunction')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {formError && <Alert variant="danger">{formError}</Alert>}
          <Row className="g-3">
            <Col md={6}>
              <Form.Label><RequiredLabel required>{t('casos.name')}</RequiredLabel></Form.Label>
              <Form.Control name="a11y-automationfunctionsmodaltsx-254" aria-label="Campo de formulario" required value={form.nombre} onChange={e => setForm({ ...form, nombre: e.target.value })} />
            </Col>
            <Col md={6}>
              <Form.Label>{t('casos.functionDescription')}</Form.Label>
              <Form.Control name="a11y-automationfunctionsmodaltsx-258" aria-label="Campo de formulario" value={form.descripcion} onChange={e => setForm({ ...form, descripcion: e.target.value })} />
            </Col>
            <Col md={4}>
              <Form.Label>{t('casos.framework')}</Form.Label>
              <Form.Select name="a11y-automationfunctionsmodaltsx-262" aria-label="Campo de formulario" value={form.framework} onChange={e => setForm({ ...form, framework: e.target.value })}>
                <option value="playwright">Playwright</option>
                <option value="cypress">Cypress</option>
                <option value="selenium">Selenium</option>
                <option value="puppeteer">Puppeteer</option>
              </Form.Select>
            </Col>
            <Col md={4}>
              <Form.Label>{t('casos.scope')}</Form.Label>
              <Form.Select name="a11y-automationfunctionsmodaltsx-271" aria-label="Campo de formulario" value={form.scope} onChange={e => setForm({ ...form, scope: e.target.value, componente_id: e.target.value === 'PROYECTO' ? '' : componentId })}>
                <option value="COMPONENTE">{t('casos.componentScope')}</option>
                <option value="PROYECTO">{t('casos.projectScope')}</option>
              </Form.Select>
            </Col>
            <Col md={4}>
              <Form.Label>{t('casos.componentScope')}</Form.Label>
              <Form.Select name="a11y-automationfunctionsmodaltsx-278" aria-label="Campo de formulario" value={form.componente_id} disabled={form.scope !== 'COMPONENTE'} onChange={e => setForm({ ...form, componente_id: e.target.value })}>
                <option value="">{t('casos.selectComponent')}</option>
                {componentsList.filter(c => c.projectId === projectId).map(component => (
                  <option key={component.id} value={component.id}>{component.name}</option>
                ))}
              </Form.Select>
            </Col>
            <Col xs={12}>
              <Form.Label>{t('casos.parametersCommaSeparated')}</Form.Label>
              <Form.Control name="a11y-automationfunctionsmodaltsx-287" aria-label="Campo de formulario" value={form.parametros} onChange={e => setForm({ ...form, parametros: e.target.value })} placeholder="page, variables, log" />
            </Col>
            <Col xs={12}>
              <Form.Label><RequiredLabel required>{t('casos.code')}</RequiredLabel></Form.Label>
              <Form.Control name="a11y-automationfunctionsmodaltsx-291" aria-label="Campo de formulario" required as="textarea" rows={12} className="font-monospace small" value={form.codigo} onChange={e => setForm({ ...form, codigo: e.target.value })} />
            </Col>
          </Row>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setFormOpen(false)} disabled={saving}>{t('common.cancel')}</Button>
          <Button onClick={saveFunction} disabled={saving} className="d-flex align-items-center gap-2"><Save size={16} /> {saving ? t('common.loading') : t('casos.save')}</Button>
        </Modal.Footer>
      </Modal>

      <Modal show={Boolean(deleteTarget)} onHide={() => setDeleteTarget(null)} centered>
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="fw-bold fs-5 d-flex align-items-center gap-2">
            <Trash2 size={20} className="text-danger" />
            {t('casos.deleteFunction')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <p className="mb-0">
            {t('automatizacion.deleteFunctionConfirm', { name: deleteTarget?.nombre || '' })}
          </p>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="outline-secondary" onClick={() => setDeleteTarget(null)}>{t('common.cancel')}</Button>
          <Button variant="danger" onClick={deleteFunction}>{t('casos.deleteFunction')}</Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
