import { FormEvent, useEffect, useMemo, useState } from 'react'
import { Alert, Badge, Button, Card, Col, Form, InputGroup, Modal, Row, Spinner } from 'react-bootstrap'
import {
  Boxes,
  Cpu,
  Database,
  Edit,
  Globe,
  HardDrive,
  Info,
  Laptop,
  Network,
  Plus,
  Router,
  Search,
  Server,
  Smartphone,
  Trash2,
  Wrench
} from 'lucide-react'
import { API_BASE } from '../../app/constants'
import { RequiredLabel } from '../../shared/ui/RequiredLabel'

type InventoryEndpoint = {
  id?: string
  asset_id?: string
  tipo: string
  valor: string
  puerto?: number | ''
  protocolo?: string
  descripcion?: string
  principal?: boolean
  activo?: boolean
}

type InventoryAsset = {
  id: string
  proyecto_id: string
  categoria_id?: string
  parent_id?: string | null
  nombre: string
  tipo: string
  naturaleza: string
  estado: string
  criticidad: string
  descripcion?: string
  ubicacion?: string
  responsable?: string
  fabricante?: string
  modelo?: string
  serial?: string
  asset_tag?: string
  sistema_operativo?: string
  metadata?: Record<string, any>
  activo?: boolean
  endpoints: InventoryEndpoint[]
  children_count?: number
}

type InventoryModalState = {
  show: boolean
  mode: 'add' | 'edit'
  preset?: Partial<InventoryAsset>
  asset?: InventoryAsset
}

type InventarioPageProps = {
  currentProjectId: string | null
  inventoryCategories: any[]
  setInventoryCategories: (categories: any[]) => void
  environments: any[]
  setEnvironments: (environments: any[]) => void
  devices: any[]
  setDevices: (devices: any[]) => void
  agents: any[]
  setAgents: (agents: any[]) => void
  customInventoryItems: any[]
  setCustomInventoryItems: (items: any[]) => void
  confirmAction: (options: { title: string; message: string; variant?: 'danger' | 'warning' | 'info'; confirmLabel?: string; cancelLabel?: string | null }) => Promise<boolean>
  currentProjectInventoryCategories: any[]
  currentProjectEnvironments: any[]
  currentProjectDevices: any[]
  currentProjectCustomInventoryItems: any[]
  currentProjectAgents: any[]
  setInvModalConfig: (config: any) => void
  canAccessCapability?: (capabilityId: any, level?: any) => boolean
  fetchWithAuth: (url: string, options?: RequestInit) => Promise<Response>
}

const ASSET_TYPES = [
  'Servidor',
  'Computadora',
  'Laptop',
  'Dispositivo movil',
  'Tablet',
  'Router/Switch',
  'Impresora',
  'Dispositivo IoT',
  'Nodo de ejecucion',
  'Maquina virtual',
  'Contenedor',
  'Herramienta digital',
  'Servicio',
  'API',
  'Base de datos',
  'Otro'
]

const NATURES = ['fisico', 'virtual', 'digital']
const STATUSES = ['Activo', 'Online', 'Offline', 'Mantenimiento', 'En Pausa', 'Retirado', 'Desconocido']
const CRITICALITIES = ['Baja', 'Media', 'Alta', 'Critica']
const ENDPOINT_TYPES = ['ip', 'url', 'hostname', 'dns', 'puerto', 'otro']

const defaultAsset = (projectId: string, preset: Partial<InventoryAsset> = {}): InventoryAsset => ({
  id: '',
  proyecto_id: projectId,
  categoria_id: preset.categoria_id || '',
  parent_id: preset.parent_id || null,
  nombre: preset.nombre || '',
  tipo: preset.tipo || 'Computadora',
  naturaleza: preset.naturaleza || 'fisico',
  estado: preset.estado || 'Activo',
  criticidad: preset.criticidad || 'Media',
  descripcion: preset.descripcion || '',
  ubicacion: preset.ubicacion || '',
  responsable: preset.responsable || '',
  fabricante: preset.fabricante || '',
  modelo: preset.modelo || '',
  serial: preset.serial || '',
  asset_tag: preset.asset_tag || '',
  sistema_operativo: preset.sistema_operativo || '',
  metadata: preset.metadata || {},
  endpoints: preset.endpoints || []
})

const getAssetIcon = (tipo: string, naturaleza: string) => {
  if (tipo === 'Servidor') return Server
  if (tipo === 'Base de datos') return Database
  if (tipo === 'API' || tipo === 'Servicio' || tipo === 'Herramienta digital') return Globe
  if (tipo === 'Laptop' || tipo === 'Computadora') return Laptop
  if (tipo === 'Dispositivo movil' || tipo === 'Tablet') return Smartphone
  if (tipo === 'Router/Switch') return Router
  if (tipo === 'Nodo de ejecucion') return Cpu
  if (naturaleza === 'virtual') return HardDrive
  return Boxes
}

const statusVariant = (estado: string) => {
  if (estado === 'Activo' || estado === 'Online') return 'success'
  if (estado === 'Mantenimiento') return 'info'
  if (estado === 'En Pausa') return 'warning'
  if (estado === 'Offline' || estado === 'Retirado') return 'secondary'
  return 'light'
}

const criticalityVariant = (criticidad: string) => {
  if (criticidad === 'Critica') return 'danger'
  if (criticidad === 'Alta') return 'warning'
  if (criticidad === 'Baja') return 'secondary'
  return 'primary'
}

const metadataToText = (metadata: Record<string, any> = {}) =>
  Object.entries(metadata).map(([key, value]) => `${key}=${String(value)}`).join('\n')

const textToMetadata = (value: string) => Object.fromEntries(
  value
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .map(line => {
      const [key, ...rest] = line.split('=')
      return [key.trim(), rest.join('=').trim()]
    })
    .filter(([key]) => key)
)

const endpointLabel = (endpoint: InventoryEndpoint) => {
  const port = endpoint.puerto ? `:${endpoint.puerto}` : ''
  const protocol = endpoint.protocolo ? `/${endpoint.protocolo}` : ''
  return `${endpoint.valor}${port}${protocol}`
}

export function InventarioPage({
  currentProjectId,
  inventoryCategories,
  setInventoryCategories,
  confirmAction,
  currentProjectInventoryCategories,
  canAccessCapability,
  fetchWithAuth
}: InventarioPageProps) {
  const canUseCapability = canAccessCapability || (() => true)
  const canEditInventory = canUseCapability('inventario.categorias', 'edit')
  const [assets, setAssets] = useState<InventoryAsset[]>([])
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [filters, setFilters] = useState({ q: '', tipo: '', naturaleza: '', estado: '', criticidad: '', parentId: '' })
  const [newCategoryName, setNewCategoryName] = useState('')
  const [modalState, setModalState] = useState<InventoryModalState>({ show: false, mode: 'add' })
  const [formAsset, setFormAsset] = useState<InventoryAsset | null>(null)
  const [metadataText, setMetadataText] = useState('')

  const loadAssets = async () => {
    if (!currentProjectId) return
    setLoading(true)
    setError('')
    try {
      const allAssets: InventoryAsset[] = []
      let skip = 0
      while (true) {
        const response = await fetchWithAuth(`${API_BASE}/infraestructura/activos/?proyecto_id=${encodeURIComponent(currentProjectId)}&skip=${skip}&limit=200`)
        if (!response.ok) {
          const body = await response.json().catch(() => null)
          throw new Error(body?.detail || 'No se pudo cargar el inventario.')
        }
        const page = await response.json()
        allAssets.push(...page)
        if (!Array.isArray(page) || page.length < 200) break
        skip += 200
      }
      setAssets(allAssets)
    } catch (err: any) {
      setError(err?.message || 'No se pudo cargar el inventario.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadAssets()
  }, [currentProjectId])

  const parentOptions = useMemo(() => assets.filter(asset => asset.naturaleza !== 'digital'), [assets])

  const filteredAssets = useMemo(() => {
    const query = filters.q.trim().toLowerCase()
    return assets.filter(asset => {
      const endpointsText = asset.endpoints.map(endpointLabel).join(' ').toLowerCase()
      const matchesQuery = !query || [
        asset.nombre,
        asset.tipo,
        asset.naturaleza,
        asset.descripcion,
        asset.ubicacion,
        asset.responsable,
        asset.serial,
        asset.asset_tag,
        endpointsText
      ].some(value => String(value || '').toLowerCase().includes(query))
      return matchesQuery
        && (!filters.tipo || asset.tipo === filters.tipo)
        && (!filters.naturaleza || asset.naturaleza === filters.naturaleza)
        && (!filters.estado || asset.estado === filters.estado)
        && (!filters.criticidad || asset.criticidad === filters.criticidad)
        && (!filters.parentId || asset.parent_id === filters.parentId)
    })
  }, [assets, filters])

  const assetsByParent = useMemo(() => {
    const grouped: Record<string, InventoryAsset[]> = {}
    assets.forEach(asset => {
      if (!asset.parent_id) return
      grouped[asset.parent_id] = [...(grouped[asset.parent_id] || []), asset]
    })
    return grouped
  }, [assets])

  const openAddModal = (preset: Partial<InventoryAsset>) => {
    if (!currentProjectId) return
    const nextAsset = defaultAsset(currentProjectId, preset)
    setFormAsset(nextAsset)
    setMetadataText(metadataToText(nextAsset.metadata))
    setModalState({ show: true, mode: 'add', preset })
  }

  const openEditModal = (asset: InventoryAsset) => {
    const normalizedEndpoints: InventoryEndpoint[] = asset.endpoints.length
      ? asset.endpoints.map(endpoint => ({ ...endpoint, puerto: typeof endpoint.puerto === 'number' ? endpoint.puerto : '' }))
      : []
    const nextAsset: InventoryAsset = {
      ...defaultAsset(asset.proyecto_id),
      ...asset,
      endpoints: normalizedEndpoints
    }
    setFormAsset(nextAsset)
    setMetadataText(metadataToText(nextAsset.metadata))
    setModalState({ show: true, mode: 'edit', asset })
  }

  const hideModal = () => {
    setModalState({ show: false, mode: 'add' })
    setFormAsset(null)
    setMetadataText('')
  }

  const updateFormAsset = (patch: Partial<InventoryAsset>) => {
    setFormAsset(current => current ? { ...current, ...patch } : current)
  }

  const updateEndpoint = (index: number, patch: Partial<InventoryEndpoint>) => {
    setFormAsset(current => {
      if (!current) return current
      return {
        ...current,
        endpoints: current.endpoints.map((endpoint, itemIndex) => itemIndex === index ? { ...endpoint, ...patch } : endpoint)
      }
    })
  }

  const addEndpoint = () => {
    setFormAsset(current => current ? {
      ...current,
      endpoints: [...current.endpoints, { tipo: 'ip', valor: '', puerto: '', protocolo: '', descripcion: '', principal: current.endpoints.length === 0 }]
    } : current)
  }

  const removeEndpoint = (index: number) => {
    setFormAsset(current => current ? {
      ...current,
      endpoints: current.endpoints.filter((_, itemIndex) => itemIndex !== index)
    } : current)
  }

  const submitAsset = async (event: FormEvent) => {
    event.preventDefault()
    if (!currentProjectId || !formAsset) return
    setSaving(true)
    setError('')
    try {
      const cleanEndpoints = formAsset.endpoints
        .filter(endpoint => endpoint.valor.trim())
        .map(endpoint => ({
          ...endpoint,
          puerto: endpoint.puerto ? Number(endpoint.puerto) : null,
          protocolo: endpoint.protocolo || null,
          descripcion: endpoint.descripcion || null,
          principal: Boolean(endpoint.principal)
        }))
      const payload = {
        categoria_id: formAsset.categoria_id || null,
        parent_id: formAsset.parent_id || null,
        nombre: formAsset.nombre,
        tipo: formAsset.tipo,
        naturaleza: formAsset.naturaleza,
        estado: formAsset.estado,
        criticidad: formAsset.criticidad,
        descripcion: formAsset.descripcion || null,
        ubicacion: formAsset.ubicacion || null,
        responsable: formAsset.responsable || null,
        fabricante: formAsset.fabricante || null,
        modelo: formAsset.modelo || null,
        serial: formAsset.serial || null,
        asset_tag: formAsset.asset_tag || null,
        sistema_operativo: formAsset.sistema_operativo || null,
        metadata: textToMetadata(metadataText),
        activo: true
      }

      if (modalState.mode === 'add') {
        const response = await fetchWithAuth(`${API_BASE}/infraestructura/activos/?proyecto_id=${encodeURIComponent(currentProjectId)}`, {
          method: 'POST',
          body: JSON.stringify({ ...payload, endpoints: cleanEndpoints })
        })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || 'No se pudo guardar el activo.')
      } else if (modalState.asset) {
        const response = await fetchWithAuth(`${API_BASE}/infraestructura/activos/${modalState.asset.id}`, {
          method: 'PATCH',
          body: JSON.stringify(payload)
        })
        if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || 'No se pudo actualizar el activo.')

        const originalEndpointIds = new Set((modalState.asset.endpoints || []).map(endpoint => endpoint.id).filter(Boolean))
        const currentEndpointIds = new Set(cleanEndpoints.map(endpoint => endpoint.id).filter(Boolean))
        for (const endpoint of cleanEndpoints) {
          if (endpoint.id) {
            const endpointResponse = await fetchWithAuth(`${API_BASE}/infraestructura/endpoints/${endpoint.id}`, {
              method: 'PATCH',
              body: JSON.stringify(endpoint)
            })
            if (!endpointResponse.ok) throw new Error((await endpointResponse.json().catch(() => null))?.detail || 'No se pudo actualizar un endpoint.')
          } else {
            const endpointResponse = await fetchWithAuth(`${API_BASE}/infraestructura/activos/${modalState.asset.id}/endpoints/`, {
              method: 'POST',
              body: JSON.stringify(endpoint)
            })
            if (!endpointResponse.ok) throw new Error((await endpointResponse.json().catch(() => null))?.detail || 'No se pudo agregar un endpoint.')
          }
        }
        for (const endpointId of originalEndpointIds) {
          if (!currentEndpointIds.has(endpointId)) {
            await fetchWithAuth(`${API_BASE}/infraestructura/endpoints/${endpointId}`, { method: 'DELETE' })
          }
        }
      }
      hideModal()
      await loadAssets()
    } catch (err: any) {
      setError(err?.message || 'No se pudo guardar el activo.')
    } finally {
      setSaving(false)
    }
  }

  const deleteAsset = async (asset: InventoryAsset) => {
    const children = assetsByParent[asset.id] || []
    const confirmed = await confirmAction({
      title: 'Eliminar activo',
      message: children.length
        ? `Se eliminará "${asset.nombre}" y ${children.length} servicio/herramienta quedará sin servidor padre.`
        : `Se eliminará "${asset.nombre}" del inventario.`,
      variant: 'danger',
      confirmLabel: 'Eliminar activo'
    })
    if (!confirmed) return
    const response = await fetchWithAuth(`${API_BASE}/infraestructura/activos/${asset.id}`, { method: 'DELETE' })
    if (!response.ok) {
      const body = await response.json().catch(() => null)
      setError(body?.detail || 'No se pudo eliminar el activo.')
      return
    }
    await loadAssets()
  }

  return (
    <div className="p-3 p-xl-4 animate__animated animate__fadeIn text-dark text-start bg-light h-100 overflow-auto">
      <div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
        <div>
          <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
            <Network size={28} /> Inventario de Infraestructura
          </h4>
          <div className="small text-muted mt-1 d-flex align-items-center gap-2">
            <Info size={14} />
            Las IPs pueden repetirse. Treseko distingue activos por ID y permite modelar servicios o herramientas alojadas en un mismo servidor.
          </div>
        </div>

        <div className="d-flex flex-wrap gap-2 justify-content-end">
          {canEditInventory && (
            <>
              <Form
                className="d-flex align-items-center bg-white rounded-pill shadow-sm border border-light-subtle overflow-hidden"
                onSubmit={(event) => {
                  event.preventDefault()
                  const name = newCategoryName.trim()
                  if (!name) return
                  setInventoryCategories([...inventoryCategories, { id: `cat_${Date.now()}`, projectId: currentProjectId, name, type: 'custom' }])
                  setNewCategoryName('')
                }}
              >
                <Form.Control
                  size="sm"
                  value={newCategoryName}
                  onChange={event => setNewCategoryName(event.target.value)}
                  placeholder="Nueva carpeta..."
                  className="border-0 shadow-none bg-transparent px-3"
                  style={{ width: 170 }}
                />
                <Button type="submit" size="sm" variant="primary" className="fw-bold rounded-pill px-3 m-1">
                  Crear
                </Button>
              </Form>
              <Button size="sm" variant="primary" className="fw-bold rounded-pill px-3" onClick={() => openAddModal({ tipo: 'Computadora', naturaleza: 'fisico' })}>
                <Plus size={14} className="me-1" /> Equipo físico
              </Button>
              <Button size="sm" variant="outline-primary" className="fw-bold rounded-pill px-3" onClick={() => openAddModal({ tipo: 'Servidor', naturaleza: 'fisico' })}>
                <Server size={14} className="me-1" /> Servidor
              </Button>
              <Button size="sm" variant="outline-primary" className="fw-bold rounded-pill px-3" onClick={() => openAddModal({ tipo: 'Servicio', naturaleza: 'digital' })}>
                <Globe size={14} className="me-1" /> Herramienta / Servicio
              </Button>
              <Button size="sm" variant="outline-secondary" className="fw-bold rounded-pill px-3" onClick={() => openAddModal({ tipo: 'Otro', naturaleza: 'fisico' })}>
                <Boxes size={14} className="me-1" /> Otro activo
              </Button>
            </>
          )}
        </div>
      </div>

      {error && <Alert variant="warning" className="py-2 small">{error}</Alert>}

      <Card className="border-0 shadow-sm rounded-3 mb-3">
        <Card.Body className="p-3">
          <Row className="g-2">
            <Col xl={4} lg={6}>
              <InputGroup size="sm">
                <InputGroup.Text className="bg-white"><Search size={14} /></InputGroup.Text>
                <Form.Control value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} placeholder="Buscar por nombre, IP, responsable, serial..." />
              </InputGroup>
            </Col>
            <Col xl={2} md={4}>
              <Form.Select size="sm" value={filters.tipo} onChange={event => setFilters({ ...filters, tipo: event.target.value })}>
                <option value="">Todos los tipos</option>
                {ASSET_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
              </Form.Select>
            </Col>
            <Col xl={2} md={4}>
              <Form.Select size="sm" value={filters.naturaleza} onChange={event => setFilters({ ...filters, naturaleza: event.target.value })}>
                <option value="">Toda naturaleza</option>
                {NATURES.map(nature => <option key={nature} value={nature}>{nature}</option>)}
              </Form.Select>
            </Col>
            <Col xl={2} md={4}>
              <Form.Select size="sm" value={filters.estado} onChange={event => setFilters({ ...filters, estado: event.target.value })}>
                <option value="">Todos los estados</option>
                {STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
              </Form.Select>
            </Col>
            <Col xl={2} md={4}>
              <Form.Select size="sm" value={filters.criticidad} onChange={event => setFilters({ ...filters, criticidad: event.target.value })}>
                <option value="">Toda criticidad</option>
                {CRITICALITIES.map(criticality => <option key={criticality} value={criticality}>{criticality}</option>)}
              </Form.Select>
            </Col>
            <Col xl={3} md={6}>
              <Form.Select size="sm" value={filters.parentId} onChange={event => setFilters({ ...filters, parentId: event.target.value })}>
                <option value="">Cualquier servidor padre</option>
                {parentOptions.map(asset => <option key={asset.id} value={asset.id}>{asset.nombre}</option>)}
              </Form.Select>
            </Col>
            <Col xl={2} md={6} className="d-flex align-items-center">
              <span className="small text-muted fw-bold">{filteredAssets.length} activos</span>
            </Col>
          </Row>
        </Card.Body>
      </Card>

      {loading ? (
        <div className="d-flex align-items-center gap-2 text-muted small py-5 justify-content-center">
          <Spinner size="sm" /> Cargando inventario...
        </div>
      ) : filteredAssets.length === 0 ? (
        <Card className="border-0 shadow-sm rounded-3">
          <Card.Body className="text-center py-5 text-muted">
            <Network size={32} className="mb-2 opacity-50" />
            <div className="fw-bold">Sin activos para mostrar</div>
            <div className="small">Crea un servidor, equipo físico o herramienta digital para empezar.</div>
          </Card.Body>
        </Card>
      ) : (
        <Row className="g-3">
          {filteredAssets.map(asset => {
            const Icon = getAssetIcon(asset.tipo, asset.naturaleza)
            const children = assetsByParent[asset.id] || []
            const mainEndpoints = asset.endpoints.filter(endpoint => endpoint.activo !== false).slice(0, 3)
            const parent = asset.parent_id ? assets.find(item => item.id === asset.parent_id) : null
            return (
              <Col xxl={3} xl={4} lg={6} key={asset.id}>
                <Card className="border-0 shadow-sm rounded-3 h-100 inventory-asset-card">
                  <Card.Body className="p-3 d-flex flex-column">
                    <div className="d-flex justify-content-between gap-2 mb-3">
                      <div className="d-flex gap-2 min-w-0">
                        <span className="d-inline-flex align-items-center justify-content-center bg-primary bg-opacity-10 text-primary rounded-3 flex-shrink-0" style={{ width: 38, height: 38 }}>
                          <Icon size={20} />
                        </span>
                        <div className="min-w-0">
                          <div className="fw-bold text-dark text-truncate">{asset.nombre}</div>
                          <div className="small text-muted text-truncate">{asset.tipo} · {asset.naturaleza}</div>
                        </div>
                      </div>
                      <div className="d-flex flex-column align-items-end gap-1">
                        <Badge bg={statusVariant(asset.estado)}>{asset.estado}</Badge>
                        <Badge bg={criticalityVariant(asset.criticidad)}>{asset.criticidad}</Badge>
                      </div>
                    </div>

                    <div className="d-flex flex-wrap gap-1 mb-3">
                      {mainEndpoints.length ? mainEndpoints.map((endpoint, index) => (
                        <Badge key={`${endpoint.id || index}-${endpoint.valor}`} bg="light" text="dark" className="border fw-normal font-monospace">
                          {endpoint.tipo}: {endpointLabel(endpoint)}
                        </Badge>
                      )) : <span className="small text-muted">Sin endpoints registrados</span>}
                    </div>

                    <div className="small text-muted flex-grow-1">
                      {parent && <div className="mb-1"><Server size={13} className="me-1" />Alojado en {parent.nombre}</div>}
                      {asset.ubicacion && <div className="mb-1">Ubicación: {asset.ubicacion}</div>}
                      {asset.responsable && <div className="mb-1">Responsable: {asset.responsable}</div>}
                      {asset.sistema_operativo && <div className="mb-1">SO: {asset.sistema_operativo}</div>}
                      {children.length > 0 && (
                        <div className="mt-2">
                          <div className="x-small fw-bold text-secondary mb-1">Servicios asociados</div>
                          <div className="d-flex flex-wrap gap-1">
                            {children.slice(0, 4).map(child => <Badge key={child.id} bg="info" className="fw-normal">{child.nombre}</Badge>)}
                            {children.length > 4 && <Badge bg="secondary">+{children.length - 4}</Badge>}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="d-flex justify-content-between align-items-center mt-3 pt-2 border-top">
                      {canEditInventory && (asset.tipo === 'Servidor' || asset.naturaleza !== 'digital') ? (
                        <Button size="sm" variant="outline-primary" className="rounded-pill fw-bold x-small" onClick={() => openAddModal({ tipo: 'Servicio', naturaleza: 'digital', parent_id: asset.id })}>
                          <Plus size={12} className="me-1" /> Servicio
                        </Button>
                      ) : <span />}
                      <div className="d-flex gap-1">
                        {canEditInventory && <Button size="sm" variant="white" className="border text-secondary p-1" title="Editar activo" onClick={() => openEditModal(asset)}><Edit size={15} /></Button>}
                        {canEditInventory && <Button size="sm" variant="white" className="border text-danger p-1" title="Eliminar activo" onClick={() => deleteAsset(asset)}><Trash2 size={15} /></Button>}
                      </div>
                    </div>
                  </Card.Body>
                </Card>
              </Col>
            )
          })}
        </Row>
      )}

      <Modal show={modalState.show && !!formAsset} onHide={hideModal} size="lg" centered backdrop="static">
        <Form onSubmit={submitAsset}>
          <Modal.Header closeButton className="bg-light border-bottom">
            <Modal.Title className="fs-5 fw-bold d-flex align-items-center gap-2">
              <Wrench size={20} className="text-primary" />
              {modalState.mode === 'add' ? 'Registrar activo' : 'Editar activo'}
            </Modal.Title>
          </Modal.Header>
          {formAsset && (
            <Modal.Body className="p-4">
              <h6 className="fw-bold text-primary mb-3">Datos generales</h6>
              <Row className="g-3">
                <Col md={6}>
                  <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Nombre</RequiredLabel></Form.Label>
                  <Form.Control required value={formAsset.nombre} onChange={event => updateFormAsset({ nombre: event.target.value })} placeholder="Ej: Servidor QA-01" />
                </Col>
                <Col md={3}>
                  <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Tipo</RequiredLabel></Form.Label>
                  <Form.Select required value={formAsset.tipo} onChange={event => updateFormAsset({ tipo: event.target.value })}>
                    {ASSET_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Naturaleza</RequiredLabel></Form.Label>
                  <Form.Select required value={formAsset.naturaleza} onChange={event => updateFormAsset({ naturaleza: event.target.value })}>
                    {NATURES.map(nature => <option key={nature} value={nature}>{nature}</option>)}
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Label className="x-small fw-bold text-muted">Estado</Form.Label>
                  <Form.Select value={formAsset.estado} onChange={event => updateFormAsset({ estado: event.target.value })}>
                    {STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Label className="x-small fw-bold text-muted">Criticidad</Form.Label>
                  <Form.Select value={formAsset.criticidad} onChange={event => updateFormAsset({ criticidad: event.target.value })}>
                    {CRITICALITIES.map(criticality => <option key={criticality} value={criticality}>{criticality}</option>)}
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Label className="x-small fw-bold text-muted">Carpeta</Form.Label>
                  <Form.Select value={formAsset.categoria_id || ''} onChange={event => updateFormAsset({ categoria_id: event.target.value })}>
                    <option value="">Sin carpeta</option>
                    {currentProjectInventoryCategories.map(cat => <option key={cat.id} value={cat.id}>{cat.name}</option>)}
                  </Form.Select>
                </Col>
                <Col md={3}>
                  <Form.Label className="x-small fw-bold text-muted">Servidor padre</Form.Label>
                  <Form.Select value={formAsset.parent_id || ''} onChange={event => updateFormAsset({ parent_id: event.target.value || null })}>
                    <option value="">Sin padre</option>
                    {parentOptions.filter(asset => asset.id !== formAsset.id).map(asset => <option key={asset.id} value={asset.id}>{asset.nombre}</option>)}
                  </Form.Select>
                </Col>
                <Col md={12}>
                  <Form.Label className="x-small fw-bold text-muted">Descripción</Form.Label>
                  <Form.Control as="textarea" rows={2} value={formAsset.descripcion || ''} onChange={event => updateFormAsset({ descripcion: event.target.value })} />
                </Col>
              </Row>

              <h6 className="fw-bold text-primary mt-4 mb-3">Hardware / sistema</h6>
              <Row className="g-3">
                <Col md={4}><Form.Label className="x-small fw-bold text-muted">Ubicación</Form.Label><Form.Control value={formAsset.ubicacion || ''} onChange={event => updateFormAsset({ ubicacion: event.target.value })} /></Col>
                <Col md={4}><Form.Label className="x-small fw-bold text-muted">Responsable</Form.Label><Form.Control value={formAsset.responsable || ''} onChange={event => updateFormAsset({ responsable: event.target.value })} /></Col>
                <Col md={4}><Form.Label className="x-small fw-bold text-muted">Sistema operativo</Form.Label><Form.Control value={formAsset.sistema_operativo || ''} onChange={event => updateFormAsset({ sistema_operativo: event.target.value })} /></Col>
                <Col md={3}><Form.Label className="x-small fw-bold text-muted">Fabricante</Form.Label><Form.Control value={formAsset.fabricante || ''} onChange={event => updateFormAsset({ fabricante: event.target.value })} /></Col>
                <Col md={3}><Form.Label className="x-small fw-bold text-muted">Modelo</Form.Label><Form.Control value={formAsset.modelo || ''} onChange={event => updateFormAsset({ modelo: event.target.value })} /></Col>
                <Col md={3}><Form.Label className="x-small fw-bold text-muted">Serial</Form.Label><Form.Control value={formAsset.serial || ''} onChange={event => updateFormAsset({ serial: event.target.value })} /></Col>
                <Col md={3}><Form.Label className="x-small fw-bold text-muted">Asset tag</Form.Label><Form.Control value={formAsset.asset_tag || ''} onChange={event => updateFormAsset({ asset_tag: event.target.value })} /></Col>
              </Row>

              <div className="d-flex justify-content-between align-items-center mt-4 mb-3">
                <h6 className="fw-bold text-primary m-0">Red y endpoints</h6>
                <Button type="button" size="sm" variant="outline-primary" className="rounded-pill fw-bold" onClick={addEndpoint}>
                  <Plus size={14} className="me-1" /> Endpoint
                </Button>
              </div>
              <div className="d-flex flex-column gap-2">
                {formAsset.endpoints.map((endpoint, index) => (
                  <Row className="g-2 align-items-end" key={endpoint.id || index}>
                    <Col md={2}>
                      <Form.Label className="x-small fw-bold text-muted">Tipo</Form.Label>
                      <Form.Select value={endpoint.tipo} onChange={event => updateEndpoint(index, { tipo: event.target.value })}>
                        {ENDPOINT_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
                      </Form.Select>
                    </Col>
                    <Col md={4}>
                      <Form.Label className="x-small fw-bold text-muted"><RequiredLabel required>Valor</RequiredLabel></Form.Label>
                      <Form.Control required value={endpoint.valor} onChange={event => updateEndpoint(index, { valor: event.target.value })} placeholder="IP, URL o hostname" />
                    </Col>
                    <Col md={2}>
                      <Form.Label className="x-small fw-bold text-muted">Puerto</Form.Label>
                      <Form.Control type="number" min={1} max={65535} value={endpoint.puerto || ''} onChange={event => updateEndpoint(index, { puerto: event.target.value ? Number(event.target.value) : '' })} />
                    </Col>
                    <Col md={2}>
                      <Form.Label className="x-small fw-bold text-muted">Protocolo</Form.Label>
                      <Form.Control value={endpoint.protocolo || ''} onChange={event => updateEndpoint(index, { protocolo: event.target.value })} placeholder="https" />
                    </Col>
                    <Col md={1} className="pb-2">
                      <Form.Check checked={Boolean(endpoint.principal)} onChange={event => updateEndpoint(index, { principal: event.target.checked })} label="Ppal." className="x-small" />
                    </Col>
                    <Col md={1} className="pb-1">
                      <Button type="button" variant="white" className="border text-danger p-2" onClick={() => removeEndpoint(index)} title="Quitar endpoint">
                        <Trash2 size={14} />
                      </Button>
                    </Col>
                  </Row>
                ))}
              </div>

              <h6 className="fw-bold text-primary mt-4 mb-3">Campos personalizados</h6>
              <Form.Control
                as="textarea"
                rows={3}
                value={metadataText}
                onChange={event => setMetadataText(event.target.value)}
                placeholder={'owner_team=QA\nrack=R1\ncontrato_soporte=Gold'}
                className="font-monospace small"
              />
            </Modal.Body>
          )}
          <Modal.Footer className="bg-light border-top">
            <Button variant="outline-secondary" onClick={hideModal} className="rounded-pill px-4">Cancelar</Button>
            <Button variant="primary" type="submit" disabled={saving || !formAsset?.nombre} className="rounded-pill px-4 fw-bold">
              {saving && <Spinner size="sm" className="me-2" />} Guardar activo
            </Button>
          </Modal.Footer>
        </Form>
      </Modal>
    </div>
  )
}
