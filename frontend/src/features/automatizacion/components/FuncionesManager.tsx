import { useState, useEffect } from 'react'
import { Card, Button, Modal, Form, Badge, Table, Alert } from 'react-bootstrap'
import { Plus, Edit2, Trash2, Code, History, Save } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { useI18n } from '../../../i18n'
import { isValidUUID } from '../../../app/validation'
import { formatDateTime } from '../../../shared/utils/dateTime'
import { APP_EDITOR_FONT_SIZE } from '../../../shared/ui/typography'

type Funcion = {
  id: string
  master_id: string
  nombre: string
  descripcion: string
  codigo: string
  parametros: string[]
  framework: string
  version: number
  proyecto_id: string
  suite_id: string | null
  scope: string
  componente_id: string | null
  creado_por: string
  fecha_creacion: string
}

type FuncionesManagerProps = {
  proyectoId: string
  currentCompId: string
  componentsList?: any[]
  fetchWithAuth: (url: string, options?: any) => Promise<Response>
  showFeedback: (title: string, message: string, type: string) => void
  confirmAction: (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>
  canEdit?: boolean
}

export const FuncionesManager = ({ proyectoId, currentCompId, componentsList = [], fetchWithAuth, showFeedback, confirmAction, canEdit = true }: FuncionesManagerProps) => {
  const { t } = useI18n()
  const [funciones, setFunciones] = useState<Funcion[]>([])
  const [loading, setLoading] = useState(false)
  const [showModal, setShowModal] = useState(false)
  const [showVersionsModal, setShowVersionsModal] = useState(false)
  const [editingFuncion, setEditingFuncion] = useState<Funcion | null>(null)
  const [selectedVersions, setSelectedVersions] = useState<Funcion[]>([])
  const [formData, setFormData] = useState({
    nombre: '',
    descripcion: '',
    codigo: '',
    parametros: '',
    framework: 'playwright',
    suite_id: '',
    scope: 'PROYECTO',
    componente_id: ''
  })

  const defaultScope = isValidUUID(currentCompId) ? 'COMPONENTE' : 'PROYECTO'
  const defaultComponentId = isValidUUID(currentCompId) ? currentCompId : ''

  useEffect(() => {
    if (proyectoId) {
      loadFunciones()
    }
  }, [proyectoId, currentCompId])

  const readErrorMessage = async (response: Response) => {
    const raw = await response.text().catch(() => '')
    if (!raw) return t('automatizacion.backendResponded', { status: response.status })
    try {
      const parsed = JSON.parse(raw)
      return parsed?.detail || parsed?.message || raw
    } catch {
      return raw
    }
  }

  const loadFunciones = async () => {
    setLoading(true)
    try {
      const params = new URLSearchParams({ include_componentes: 'true', limit: '500' })
      if (isValidUUID(currentCompId)) params.set('component_id', currentCompId)
      const url = `/api/proyectos/${proyectoId}/funciones/?${params.toString()}`
      const response = await fetchWithAuth(url)
      if (response.ok) {
        const data = await response.json()
        setFunciones(data)
      } else {
        showFeedback(t('automatizacion.functionsTitle'), await readErrorMessage(response), 'danger')
      }
    } catch (error) {
        showFeedback(t('automatizacion.functionsTitle'), t('automatizacion.loadFunctionsError'), 'danger')
    } finally {
      setLoading(false)
    }
  }

  const handleCreate = () => {
    setEditingFuncion(null)
    setFormData({
      nombre: '',
      descripcion: '',
      codigo: '',
      parametros: '',
      framework: 'playwright',
      suite_id: '',
      scope: defaultScope,
      componente_id: defaultComponentId
    })
    setShowModal(true)
  }

  const handleEdit = (funcion: Funcion) => {
    setEditingFuncion(funcion)
    setFormData({
      nombre: funcion.nombre,
      descripcion: funcion.descripcion || '',
      codigo: funcion.codigo,
      parametros: funcion.parametros.join(', '),
      framework: funcion.framework,
      suite_id: funcion.suite_id || '',
      scope: funcion.scope || (funcion.componente_id ? 'COMPONENTE' : 'PROYECTO'),
      componente_id: funcion.componente_id || ''
    })
    setShowModal(true)
  }

  const handleSave = async () => {
    if (formData.scope === 'COMPONENTE' && !formData.componente_id) {
      showFeedback(t('automatizacion.componentRequired'), t('automatizacion.componentRequiredMessage'), 'warning')
      return
    }
    const payload = {
      nombre: formData.nombre,
      descripcion: formData.descripcion,
      codigo: formData.codigo,
      parametros: formData.parametros.split(',').map(p => p.trim()).filter(p => p),
      framework: formData.framework,
      suite_id: formData.suite_id || null,
      scope: formData.scope,
      componente_id: formData.scope === 'COMPONENTE' ? formData.componente_id || null : null,
      proyecto_id: proyectoId
    }

    try {
      const url = editingFuncion
        ? `/api/funciones/${editingFuncion.master_id}/`
        : `/api/funciones/`

      const method = editingFuncion ? 'PUT' : 'POST'

      const response = await fetchWithAuth(url, {
        method,
        body: JSON.stringify(payload)
      })

      if (response.ok) {
        showFeedback(t('automatizacion.success'), editingFuncion ? t('automatizacion.functionUpdated') : t('automatizacion.functionCreated'), 'success')
        setShowModal(false)
        loadFunciones()
      } else {
        const error = await response.json().catch(() => null)
        showFeedback(t('automatizacion.error'), error.detail || t('automatizacion.saveError'), 'danger')
      }
    } catch (error) {
      showFeedback(t('automatizacion.error'), t('automatizacion.connectionError'), 'danger')
    }
  }

  const handleDelete = async (funcion: Funcion) => {
    const confirmed = await confirmAction({
      title: t('automatizacion.deleteFunction'),
      message: t('automatizacion.deleteFunctionConfirm', { name: funcion.nombre }),
      variant: 'danger',
      confirmLabel: t('automatizacion.deleteLabel')
    })
    if (!confirmed) return

    try {
      const response = await fetchWithAuth(`/api/funciones/${funcion.master_id}/`, {
        method: 'DELETE'
      })

      if (response.ok) {
        showFeedback(t('automatizacion.success'), t('automatizacion.functionDeleted'), 'success')
        loadFunciones()
      } else {
        showFeedback(t('automatizacion.error'), await readErrorMessage(response), 'danger')
      }
    } catch (error: any) {
        showFeedback(t('automatizacion.error'), error?.message || t('automatizacion.deleteError'), 'danger')
    }
  }

  const handleViewVersions = async (funcion: Funcion) => {
    try {
      const response = await fetchWithAuth(`/api/funciones/${funcion.master_id}/versions/`)
      if (response.ok) {
        const data = await response.json()
        setSelectedVersions(data)
        setShowVersionsModal(true)
      }
    } catch (error) {
      showFeedback(t('automatizacion.error'), t('automatizacion.loadVersionsError'), 'danger')
    }
  }

  const getLanguage = (framework: string) => {
    return ['playwright', 'cypress', 'puppeteer'].includes(framework) ? 'javascript' : 'python'
  }

  return (
    <>
      <Card className="border-0 shadow-sm rounded-3 bg-white mb-4">
        <Card.Header className="bg-white border-bottom d-flex justify-content-between align-items-center py-3">
          <h5 className="mb-0 d-flex align-items-center gap-2">
            <Code size={20} className="text-primary" />
            {t('automatizacion.functionsTitle')}
          </h5>
          {canEdit && (
            <Button variant="primary" size="sm" onClick={handleCreate} className="d-flex align-items-center gap-2">
              <Plus size={16} />
              {t('automatizacion.newFunction')}
            </Button>
          )}
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">{t('automatizacion.loading')}</span>
              </div>
            </div>
          ) : funciones.length === 0 ? (
            <Alert variant="info" className="m-4">
              {t('automatizacion.noFunctions')}
            </Alert>
          ) : (
            <Table hover responsive className="mb-0">
              <thead className="table-light">
                <tr>
                  <th>{t('automatizacion.name')}</th>
                  <th>{t('automatizacion.scope')}</th>
                  <th>{t('automatizacion.framework')}</th>
                  <th>{t('automatizacion.parameters')}</th>
                  <th>{t('automatizacion.version')}</th>
                  <th>{t('automatizacion.description')}</th>
                  <th>{t('automatizacion.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {funciones.map((funcion) => (
                  <tr key={funcion.id}>
                    <td>
                      <strong>{funcion.nombre || t('automatizacion.noName')}</strong>
                      {funcion.suite_id && (
                        <Badge bg="secondary" className="ms-2 app-label">
                          {t('automatizacion.suite')}
                        </Badge>
                      )}
                    </td>
                    <td>
                      {funcion.componente_id ? (
                        <Badge bg="primary">
                          {componentsList.find(component => component.id === funcion.componente_id)?.name || t('automatizacion.componentScope')}
                        </Badge>
                      ) : (
                        <Badge bg="secondary">{t('automatizacion.projectScope')}</Badge>
                      )}
                    </td>
                    <td>
                      <Badge bg="info">{funcion.framework}</Badge>
                    </td>
                    <td>
                      <code className="small">
                        {funcion.parametros.length > 0 ? funcion.parametros.join(', ') : '-'}
                      </code>
                    </td>
                    <td>
                      <Badge bg="secondary">v{funcion.version}</Badge>
                    </td>
                    <td className="text-muted small">
                      {funcion.descripcion || '-'}
                    </td>
                    <td>
                      <div className="d-flex gap-1">
                        <Button
                          variant="outline-primary"
                          size="sm"
                          onClick={() => handleViewVersions(funcion)}
                          title={t('automatizacion.versionHistory')}
                        >
                          <History size={14} />
                        </Button>
                        {canEdit && (
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => handleEdit(funcion)}
                            title={t('automatizacion.editFunction')}
                          >
                            <Edit2 size={14} />
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={() => handleDelete(funcion)}
                            title={t('automatizacion.deleteFunction')}
                          >
                            <Trash2 size={14} />
                          </Button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card.Body>
      </Card>

      {/* Modal Crear/Editar */}
      <Modal show={showModal && !showVersionsModal} onHide={() => setShowModal(false)} size="xl" centered scrollable>
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="d-flex align-items-center gap-2">
            <Code size={20} className="text-primary" />
            {editingFuncion ? t('automatizacion.editFunction') : t('automatizacion.createFunction')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body className="pt-0">
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>{t('automatizacion.functionName')}</Form.Label>
              <Form.Control name="a11y-funcionesmanagertsx-335" aria-label="Campo de formulario"
                type="text"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                placeholder={t('automatizacion.functionNamePlaceholder')}
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>{t('automatizacion.functionDescription')}</Form.Label>
              <Form.Control name="a11y-funcionesmanagertsx-345" aria-label="Campo de formulario"
                type="text"
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                placeholder={t('automatizacion.functionDescriptionPlaceholder')}
              />
            </Form.Group>

            <div className="row">
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>{t('automatizacion.framework')}</Form.Label>
                  <Form.Select name="a11y-funcionesmanagertsx-357" aria-label="Campo de formulario"
                    value={formData.framework}
                    onChange={(e) => setFormData({ ...formData, framework: e.target.value })}
                  >
                    <option value="playwright">Playwright</option>
                    <option value="selenium">Selenium</option>
                    <option value="cypress">Cypress</option>
                    <option value="puppeteer">Puppeteer</option>
                  </Form.Select>
                </Form.Group>
              </div>
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>{t('automatizacion.functionParameters')}</Form.Label>
                  <Form.Control name="a11y-funcionesmanagertsx-371" aria-label="Campo de formulario"
                    type="text"
                    value={formData.parametros}
                    onChange={(e) => setFormData({ ...formData, parametros: e.target.value })}
                    placeholder={t('automatizacion.functionParametersPlaceholder')}
                  />
                </Form.Group>
              </div>
            </div>

            <div className="row">
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>{t('automatizacion.scope')}</Form.Label>
                  <Form.Select name="a11y-funcionesmanagertsx-385" aria-label="Campo de formulario"
                    value={formData.scope}
                    onChange={(e) => setFormData({
                      ...formData,
                      scope: e.target.value,
                      componente_id: e.target.value === 'PROYECTO'
                        ? ''
                        : formData.componente_id || defaultComponentId
                    })}
                  >
                    <option value="PROYECTO">{t('automatizacion.projectScope')}</option>
                    <option value="COMPONENTE">{t('automatizacion.componentScope')}</option>
                  </Form.Select>
                </Form.Group>
              </div>
              {formData.scope === 'COMPONENTE' && (
                <div className="col-md-6">
                  <Form.Group className="mb-3">
                    <Form.Label>{t('automatizacion.componentScope')}</Form.Label>
                    <Form.Select name="a11y-funcionesmanagertsx-404" aria-label="Campo de formulario"
                      value={formData.componente_id}
                      onChange={(e) => setFormData({ ...formData, componente_id: e.target.value })}
                      required
                    >
                      <option value="">{t('automatizacion.selectComponent')}</option>
                      {componentsList.filter(component => component.projectId === proyectoId).map(component => (
                        <option key={component.id} value={component.id}>{component.name}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>
              )}
            </div>

            <Form.Group className="mb-3">
              <Form.Label>{t('automatizacion.functionCode')}</Form.Label>
              <div className="border rounded" style={{ height: '400px' }}>
                <Editor
                  height="100%"
                  language={getLanguage(formData.framework)}
                  value={formData.codigo}
                  onChange={(value) => setFormData({ ...formData, codigo: value || '' })}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: APP_EDITOR_FONT_SIZE,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true
                  }}
                />
              </div>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            {t('automatizacion.cancel')}
          </Button>
          {canEdit && (
            <Button variant="primary" onClick={handleSave} className="d-flex align-items-center gap-2">
              <Save size={16} />
              {editingFuncion ? t('automatizacion.update') : t('automatizacion.create')}
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {/* Modal Versiones */}
      <Modal show={showVersionsModal} onHide={() => setShowVersionsModal(false)} size="lg" centered scrollable>
        <Modal.Header closeButton className="border-0 pb-2">
          <Modal.Title className="d-flex align-items-center gap-2">
            <History size={20} className="me-2" />
            {t('automatizacion.versionHistory')}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedVersions.length === 0 ? (
            <Alert variant="info">{t('automatizacion.noVersions')}</Alert>
          ) : (
            <Table hover responsive>
              <thead className="table-light">
                <tr>
                  <th>{t('automatizacion.versionCol')}</th>
                  <th>{t('automatizacion.date')}</th>
                  <th>{t('automatizacion.createdBy')}</th>
                </tr>
              </thead>
              <tbody>
                {selectedVersions.map((version, index) => (
                  <tr key={version.id} className={index === 0 ? 'table-primary' : ''}>
                    <td>
                      <Badge bg={index === 0 ? 'primary' : 'secondary'}>
                        v{version.version}
                      </Badge>
                      {index === 0 && <span className="ms-2 small text-muted">({t('automatizacion.current')})</span>}
                    </td>
                    <td>{formatDateTime(version.fecha_creacion)}</td>
                    <td className="small text-muted">{version.creado_por.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal.Body>
        <Modal.Footer className="border-0 pt-0">
          <Button variant="secondary" onClick={() => setShowVersionsModal(false)}>
            {t('automatizacion.close')}
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
