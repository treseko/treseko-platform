import { useState, useEffect } from 'react'
import { Card, Button, Modal, Form, Badge, Table, Alert } from 'react-bootstrap'
import { Plus, Edit2, Trash2, Code, History, Save } from 'lucide-react'
import Editor from '@monaco-editor/react'
import { isValidUUID } from '../../../app/validation'
import { formatDateTime } from '../../../shared/utils/dateTime'

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
    if (!raw) return `Backend respondio ${response.status}`
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
        showFeedback('Funciones', await readErrorMessage(response), 'danger')
      }
    } catch (error) {
      showFeedback('Funciones', 'No se pudieron cargar las funciones.', 'danger')
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
      showFeedback('Componente requerido', 'Selecciona el componente que podra usar esta funcion.', 'warning')
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
        showFeedback('Éxito', editingFuncion ? 'Función actualizada' : 'Función creada', 'success')
        setShowModal(false)
        loadFunciones()
      } else {
        const error = await response.json().catch(() => null)
        showFeedback('Error', error.detail || 'Error al guardar', 'danger')
      }
    } catch (error) {
      showFeedback('Error', 'Error de conexión', 'danger')
    }
  }

  const handleDelete = async (funcion: Funcion) => {
    const confirmed = await confirmAction({
      title: 'Eliminar función',
      message: `Se eliminará la función "${funcion.nombre}" y todas sus versiones.`,
      variant: 'danger',
      confirmLabel: 'Eliminar función'
    })
    if (!confirmed) return

    try {
      const response = await fetchWithAuth(`/api/funciones/${funcion.master_id}/`, {
        method: 'DELETE'
      })

      if (response.ok) {
        showFeedback('Éxito', 'Función eliminada', 'success')
        loadFunciones()
      } else {
        showFeedback('Error', await readErrorMessage(response), 'danger')
      }
    } catch (error: any) {
      showFeedback('Error', error?.message || 'Error al eliminar', 'danger')
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
      showFeedback('Error', 'Error al cargar versiones', 'danger')
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
            Biblioteca de Funciones Automatizadas
          </h5>
          {canEdit && (
            <Button variant="primary" size="sm" onClick={handleCreate} className="d-flex align-items-center gap-2">
              <Plus size={16} />
              Nueva Función
            </Button>
          )}
        </Card.Header>
        <Card.Body className="p-0">
          {loading ? (
            <div className="text-center py-5">
              <div className="spinner-border text-primary" role="status">
                <span className="visually-hidden">Cargando...</span>
              </div>
            </div>
          ) : funciones.length === 0 ? (
            <Alert variant="info" className="m-4">
              No hay funciones creadas. Las funciones reutilizables permiten definir código que puede ser usado en múltiples casos de prueba.
            </Alert>
          ) : (
            <Table hover responsive className="mb-0">
              <thead className="table-light">
                <tr>
                  <th>Nombre</th>
                  <th>Alcance</th>
                  <th>Framework</th>
                  <th>Parámetros</th>
                  <th>Versión</th>
                  <th>Descripción</th>
                  <th>Acciones</th>
                </tr>
              </thead>
              <tbody>
                {funciones.map((funcion) => (
                  <tr key={funcion.id}>
                    <td>
                      <strong>{funcion.nombre || 'Sin nombre'}</strong>
                      {funcion.suite_id && (
                        <Badge bg="secondary" className="ms-2" style={{ fontSize: '0.7rem' }}>
                          Suite
                        </Badge>
                      )}
                    </td>
                    <td>
                      {funcion.componente_id ? (
                        <Badge bg="primary">
                          {componentsList.find(component => component.id === funcion.componente_id)?.name || 'Componente'}
                        </Badge>
                      ) : (
                        <Badge bg="secondary">Proyecto</Badge>
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
                          title="Ver versiones"
                        >
                          <History size={14} />
                        </Button>
                        {canEdit && (
                          <Button
                            variant="outline-secondary"
                            size="sm"
                            onClick={() => handleEdit(funcion)}
                            title="Editar"
                          >
                            <Edit2 size={14} />
                          </Button>
                        )}
                        {canEdit && (
                          <Button
                            variant="outline-danger"
                            size="sm"
                            onClick={() => handleDelete(funcion)}
                            title="Eliminar"
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
      <Modal show={showModal} onHide={() => setShowModal(false)} size="xl" centered>
        <Modal.Header closeButton>
          <Modal.Title>
            {editingFuncion ? 'Editar Función' : 'Nueva Función'}
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          <Form>
            <Form.Group className="mb-3">
              <Form.Label>Nombre de la función</Form.Label>
              <Form.Control
                type="text"
                value={formData.nombre}
                onChange={(e) => setFormData({ ...formData, nombre: e.target.value })}
                placeholder="Ej: login, logout, navegar_a"
              />
            </Form.Group>

            <Form.Group className="mb-3">
              <Form.Label>Descripción</Form.Label>
              <Form.Control
                type="text"
                value={formData.descripcion}
                onChange={(e) => setFormData({ ...formData, descripcion: e.target.value })}
                placeholder="Descripción breve de lo que hace la función"
              />
            </Form.Group>

            <div className="row">
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>Framework</Form.Label>
                  <Form.Select
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
                  <Form.Label>Parámetros (separados por coma)</Form.Label>
                  <Form.Control
                    type="text"
                    value={formData.parametros}
                    onChange={(e) => setFormData({ ...formData, parametros: e.target.value })}
                    placeholder="Ej: page, usuario, password"
                  />
                </Form.Group>
              </div>
            </div>

            <div className="row">
              <div className="col-md-6">
                <Form.Group className="mb-3">
                  <Form.Label>Alcance</Form.Label>
                  <Form.Select
                    value={formData.scope}
                    onChange={(e) => setFormData({
                      ...formData,
                      scope: e.target.value,
                      componente_id: e.target.value === 'PROYECTO'
                        ? ''
                        : formData.componente_id || defaultComponentId
                    })}
                  >
                    <option value="PROYECTO">Proyecto</option>
                    <option value="COMPONENTE">Componente</option>
                  </Form.Select>
                </Form.Group>
              </div>
              {formData.scope === 'COMPONENTE' && (
                <div className="col-md-6">
                  <Form.Group className="mb-3">
                    <Form.Label>Componente</Form.Label>
                    <Form.Select
                      value={formData.componente_id}
                      onChange={(e) => setFormData({ ...formData, componente_id: e.target.value })}
                      required
                    >
                      <option value="">Selecciona componente...</option>
                      {componentsList.filter(component => component.projectId === proyectoId).map(component => (
                        <option key={component.id} value={component.id}>{component.name}</option>
                      ))}
                    </Form.Select>
                  </Form.Group>
                </div>
              )}
            </div>

            <Form.Group className="mb-3">
              <Form.Label>Código de la función</Form.Label>
              <div className="border rounded" style={{ height: '400px' }}>
                <Editor
                  height="100%"
                  language={getLanguage(formData.framework)}
                  value={formData.codigo}
                  onChange={(value) => setFormData({ ...formData, codigo: value || '' })}
                  theme="vs-dark"
                  options={{
                    minimap: { enabled: false },
                    fontSize: 13,
                    lineNumbers: 'on',
                    scrollBeyondLastLine: false,
                    automaticLayout: true
                  }}
                />
              </div>
            </Form.Group>
          </Form>
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowModal(false)}>
            Cancelar
          </Button>
          {canEdit && (
            <Button variant="primary" onClick={handleSave} className="d-flex align-items-center gap-2">
              <Save size={16} />
              {editingFuncion ? 'Actualizar' : 'Crear'}
            </Button>
          )}
        </Modal.Footer>
      </Modal>

      {/* Modal Versiones */}
      <Modal show={showVersionsModal} onHide={() => setShowVersionsModal(false)} size="lg" centered>
        <Modal.Header closeButton>
          <Modal.Title>
            <History size={20} className="me-2" />
            Historial de Versiones
          </Modal.Title>
        </Modal.Header>
        <Modal.Body>
          {selectedVersions.length === 0 ? (
            <Alert variant="info">No hay versiones registradas</Alert>
          ) : (
            <Table hover responsive>
              <thead className="table-light">
                <tr>
                  <th>Versión</th>
                  <th>Fecha</th>
                  <th>Creado por</th>
                </tr>
              </thead>
              <tbody>
                {selectedVersions.map((version, index) => (
                  <tr key={version.id} className={index === 0 ? 'table-primary' : ''}>
                    <td>
                      <Badge bg={index === 0 ? 'primary' : 'secondary'}>
                        v{version.version}
                      </Badge>
                      {index === 0 && <span className="ms-2 small text-muted">(actual)</span>}
                    </td>
                    <td>{formatDateTime(version.fecha_creacion)}</td>
                    <td className="small text-muted">{version.creado_por.slice(0, 8)}</td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Modal.Body>
        <Modal.Footer>
          <Button variant="secondary" onClick={() => setShowVersionsModal(false)}>
            Cerrar
          </Button>
        </Modal.Footer>
      </Modal>
    </>
  )
}
