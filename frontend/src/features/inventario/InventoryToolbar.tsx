import { Alert, Button, Card, Col, Form, InputGroup, Row } from 'react-bootstrap'
import { Boxes, Globe, Info, Network, Plus, Search, Server } from 'lucide-react'

const ASSET_TYPES = ['Servidor', 'Computadora', 'Laptop', 'Dispositivo movil', 'Tablet', 'Router/Switch', 'Impresora', 'Dispositivo IoT', 'Nodo de ejecucion', 'Maquina virtual', 'Contenedor', 'Herramienta digital', 'Servicio', 'API', 'Base de datos', 'Otro']
const NATURES = ['fisico', 'virtual', 'digital']
const STATUSES = ['Activo', 'Online', 'Offline', 'Mantenimiento', 'En Pausa', 'Retirado', 'Desconocido']
const CRITICALITIES = ['Baja', 'Media', 'Alta', 'Critica']

export function InventoryToolbar({ options }: { options: any }) {
  const { t, canEditInventory, newCategoryName, setNewCategoryName, inventoryCategories, currentProjectId, setInventoryCategories, openAddModal, error, filters, setFilters, parentOptions, filteredAssets } = options
  return (
    <>
<div className="d-flex flex-wrap justify-content-between align-items-start gap-3 mb-3">
  <div>
    <h4 className="fw-bold text-primary m-0 d-flex align-items-center gap-2">
      <Network size={28} /> {t('inventario.pageTitle')}
    </h4>
    <div className="small text-muted mt-1 d-flex align-items-center gap-2">
      <Info size={14} />
      {t('inventario.pageDescription')}
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
          <Form.Control name="a11y-inventorytoolbartsx-37" aria-label="Campo de formulario"
            size="sm"
            value={newCategoryName}
            onChange={event => setNewCategoryName(event.target.value)}
            placeholder={t('inventario.newCategory')}
            className="border-0 shadow-none bg-transparent px-3"
            style={{ width: 170 }}
          />
          <Button type="submit" size="sm" variant="primary" className="fw-bold rounded-pill px-3 m-1">
            {t('inventario.createCategory')}
          </Button>
        </Form>
        <Button size="sm" variant="primary" className="fw-bold rounded-pill px-3" onClick={() => openAddModal({ tipo: 'Computadora', naturaleza: 'fisico' })}>
          <Plus size={14} className="me-1" /> {t('inventario.addPhysical')}
        </Button>
        <Button size="sm" variant="outline-primary" className="fw-bold rounded-pill px-3" onClick={() => openAddModal({ tipo: 'Servidor', naturaleza: 'fisico' })}>
          <Server size={14} className="me-1" /> {t('inventario.addServer')}
        </Button>
        <Button size="sm" variant="outline-primary" className="fw-bold rounded-pill px-3" onClick={() => openAddModal({ tipo: 'Servicio', naturaleza: 'digital' })}>
          <Globe size={14} className="me-1" /> {t('inventario.addTool')}
        </Button>
        <Button size="sm" variant="outline-secondary" className="fw-bold rounded-pill px-3" onClick={() => openAddModal({ tipo: 'Otro', naturaleza: 'fisico' })}>
          <Boxes size={14} className="me-1" /> {t('inventario.addOther')}
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
          <Form.Control name="a11y-inventorytoolbartsx-74" aria-label="Campo de formulario" value={filters.q} onChange={event => setFilters({ ...filters, q: event.target.value })} placeholder={t('inventario.search')} />
        </InputGroup>
      </Col>
      <Col xl={2} md={4}>
        <Form.Select name="a11y-inventorytoolbartsx-78" aria-label="Campo de formulario" size="sm" value={filters.tipo} onChange={event => setFilters({ ...filters, tipo: event.target.value })}>
          <option value="">{t('inventario.type')}</option>
          {ASSET_TYPES.map(type => <option key={type} value={type}>{type}</option>)}
        </Form.Select>
      </Col>
      <Col xl={2} md={4}>
        <Form.Select name="a11y-inventorytoolbartsx-84" aria-label="Campo de formulario" size="sm" value={filters.naturaleza} onChange={event => setFilters({ ...filters, naturaleza: event.target.value })}>
          <option value="">{t('inventario.nature')}</option>
          {NATURES.map(nature => <option key={nature} value={nature}>{nature}</option>)}
        </Form.Select>
      </Col>
      <Col xl={2} md={4}>
        <Form.Select name="a11y-inventorytoolbartsx-90" aria-label="Campo de formulario" size="sm" value={filters.estado} onChange={event => setFilters({ ...filters, estado: event.target.value })}>
          <option value="">{t('inventario.status')}</option>
          {STATUSES.map(status => <option key={status} value={status}>{status}</option>)}
        </Form.Select>
      </Col>
      <Col xl={2} md={4}>
        <Form.Select name="a11y-inventorytoolbartsx-96" aria-label="Campo de formulario" size="sm" value={filters.criticidad} onChange={event => setFilters({ ...filters, criticidad: event.target.value })}>
          <option value="">{t('inventario.criticality')}</option>
          {CRITICALITIES.map(criticality => <option key={criticality} value={criticality}>{criticality}</option>)}
        </Form.Select>
      </Col>
      <Col xl={3} md={6}>
        <Form.Select name="a11y-inventorytoolbartsx-102" aria-label="Campo de formulario" size="sm" value={filters.parentId} onChange={event => setFilters({ ...filters, parentId: event.target.value })}>
          <option value="">{t('inventario.parentAsset')}</option>
          {parentOptions.map(asset => <option key={asset.id} value={asset.id}>{asset.nombre}</option>)}
        </Form.Select>
      </Col>
      <Col xl={2} md={6} className="d-flex align-items-center">
        <span className="small text-muted fw-bold">{t('inventario.resultsCount', { count: filteredAssets.length })}</span>
      </Col>
    </Row>
  </Card.Body>
</Card>

    </>
  )
}
